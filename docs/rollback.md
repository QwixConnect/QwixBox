# Upgrades and rollback

How an upgrade changes the database, what it keeps so the change can be undone, and the procedure
for undoing it. Applies to a single host where Postgres is local (the `db` role). Verified end to
end on 2026-10-26 by [`tests/rollback-drill.py`](../tests/rollback-drill.py) in a disposable
arm64 install. It has not been run on a production host.

## What an upgrade does to the database

The schema has no migration history. Step 41 makes the database match `portal/api/src/db/schema.ts`
with `drizzle-kit push --force`, which applies whatever the difference is without asking. So the
step guards the push (I14):

1. **Pre-upgrade dump.** `pg_dump -Fc qwixbox` to `/var/backups/qwixbox/pre-upgrade/qwixbox-<time>.dump`
   (root, 0600). The last five are kept. This is taken before anything else in the step touches the
   database, including `check-schema-tables`, which drops retired tables.
2. **Rehearsal on a copy.** The database is copied to `qwixbox_preflight` and the push runs there
   first. Its output, including every statement it ran, is kept in
   `/var/log/qwixbox/schema-preflight-<time>.log`. A push that fails on the copy stops the step
   with production unchanged. The copy is dropped afterwards.
3. **Data-loss gate.** A rehearsal that ran `DROP TABLE`, `DROP COLUMN`, `DROP TYPE`, `DROP SCHEMA`,
   `TRUNCATE`, `DELETE FROM` or `SET DATA TYPE` stops the step and prints those statements.
   Production is still unchanged. To apply them, read the statements, decide the data can go, and
   re-run for that one run:

   ```sh
   sudo SCHEMA_ACCEPT_DESTRUCTIVE=1 ./install.sh --only 41-api-deploy.sh --force
   ```

   Do not put the variable in `config.env`: that would accept every later upgrade's data loss too.

With a remote database, step 41 warns and does none of this. Take your own backup before upgrading.

The pre-upgrade dump is not the nightly backup (`51-backups.sh`) and does not replace it. It holds
only the `qwixbox` database, not `config.env`. A rollback on the same host keeps `config.env`, and
with it `ENCRYPTION_KEY`, so the stored secrets in the dump still decrypt.

## Rolling back

Use this when an upgrade must be undone: the new release misbehaves, or its schema change was
wrong. **Anything written after the dump is lost.** That includes extensions, routes and users
changed since, call records (`cdr`), the audit log and sessions. Export what must survive first,
for example `sudo -u postgres pg_dump -t cdr --data-only qwixbox > cdr-since-upgrade.sql`.

1. **Choose the dump** taken by the upgrade you are undoing. It is the newest one from before the
   upgrade's step 41 ran:

   ```sh
   ls -lt /var/backups/qwixbox/pre-upgrade/
   ```

   Step 41 takes a new dump on every run, including the rollback's own run in step 5, so note the
   file name now.

2. **Check out the previous release** in the checkout the installer runs from:

   ```sh
   cd /usr/src/qwixbox && git checkout <previous-commit>
   ```

3. **Stop the API**, so nothing writes while the database is replaced:

   ```sh
   systemctl stop qwixbox-api
   ```

4. **Restore the dump.** The `qwixbox` database is replaced. The `kamailio` database is not touched.

   ```sh
   DUMP=/var/backups/qwixbox/pre-upgrade/qwixbox-<time>.dump
   su - postgres -c 'dropdb --force qwixbox && createdb -O qwixbox qwixbox'
   su - postgres -c 'pg_restore --exit-on-error -d qwixbox' < "$DUMP"
   ```

5. **Re-apply database grants and deploy the previous API.** A dump does not carry database-level
   grants, which step 22 sets. Step 41 rehearses the previous release's schema against the restored
   database. It should report no data-losing statements, because the dump predates the upgrade. It
   then restarts the API.

   ```sh
   ./install.sh --only 22-provision-databases.sh --force
   ./install.sh --only 41-api-deploy.sh --force
   ```

   If the rest of the previous release differs too (Kamailio, FreeSWITCH or nginx configuration),
   run `./install.sh` instead of the second command. Every step whose script or declared inputs
   changed then re-runs.

6. **Reconcile Kamailio and the cache.** Both are projections of the database, and the restore did
   not touch them. Without this step, an extension created after the dump can still register, and
   a trunk added after it is still trusted.

   ```sh
   cd /opt/qwixbox-api && sudo -u qwixbox bun run src/cli/reconcile-kamailio.ts
   ```

   It deletes the Kamailio subscribers (and their registrations), trunk addresses, domains and
   emergency patterns that the database does not know. It drops cached tenants that no longer
   exist. Then it queues a projection of every tenant, extension and trunk that does exist. An
   address row with no tag was not written by QwixBox, so it is left alone.

7. **Verify.** The API drains the queued jobs within seconds:

   ```sh
   curl -s http://127.0.0.1:3000/health
   ```

   Expect `"status":"ok"` and `"projections":{"pending":0,"failing":0}`. Then place a test call.

## What the drill proves, and what it does not

`tests/rollback-drill.py` runs the steps above. It creates extension A, upgrades to a schema with
an added column, then deletes A and adds extension B and a trunk. It rolls back and checks that:

- the column is gone;
- A is back in the database, Kamailio and the cache;
- B is gone from all three;
- the trunk is no longer trusted;
- health is clean.

With the pruning in step 6 disabled, B can still register and the trunk stays trusted, and the
drill fails. Not covered:

- a remote database;
- a release whose other steps (31, 34, 42) also changed;
- restoring the nightly backup onto a new host, which is the restore runbook in M6.
