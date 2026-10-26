# Restoring from a backup

How to bring a QwixBox host back from a `qwixbox-backup` snapshot, on a new host or in place. To
undo an upgrade on the same host, use [rollback](rollback.md) instead: it restores the dump that
the upgrade took a moment earlier, not last night's.

## What a snapshot holds

`51-backups.sh` installs `qwixbox-backup`, which runs nightly at 03:20 and writes
`/var/backups/qwixbox/<stamp>/` (root, 0700). When `OFFSITE_RSYNC_TARGET` is set, it also copies the
snapshot offsite.

| File | Contents |
|---|---|
| `kamailio.dump`, `qwixbox.dump` | `pg_dump --format=custom` of each database |
| `globals.sql` | Postgres roles. The restore does not use it: step 22 recreates the roles from `config.env` |
| `config.tar.gz` | `/etc/qwixbox`, including `config.env` with `ENCRYPTION_KEY` and every generated secret, the STIR key and the alert targets. Also the Kamailio, rtpengine, nginx and FreeSWITCH configuration, the DKIM key, `/etc/letsencrypt`, the systemd units, nftables and fail2ban |
| `COMPLETE` | Written only when every part succeeded. Never restore a snapshot without it |

The snapshot does **not** contain voicemail messages, call recordings or fax files. Those are
lost with the host. Redis is not backed up either: it is a cache and is rebuilt.

`config.env` is the one file that cannot be replaced. The SIP passwords, voicemail PINs and trunk
credentials in `qwixbox.dump` are encrypted under its `ENCRYPTION_KEY`. A database restored under
any other key loads without complaint, but none of those secrets can be read.

## Restore onto a new host

You need:

- a fresh Debian 13 host provisioned as in the [README](../README.md);
- the snapshot directory, copied from the old host or from offsite;
- this repository at the release the snapshot was taken on.

The release matters: the restore installs the schema of the checkout and then loads the dump into
it.

```sh
git clone https://github.com/<owner>/QwixBox /usr/src/qwixbox
cd /usr/src/qwixbox && git checkout <release-the-snapshot-was-taken-on>
sudo ./restore.sh /path/to/<stamp>
```

`restore.sh` does the following, and stops at the first failure with a message saying what to fix:

1. **Checks the snapshot.** It must have `COMPLETE`, both dumps and a `config.env`. It refuses to
   run if this host already has a *different* `config.env`, because that would replace secrets
   the running services hold.
2. **Puts the secrets in place before installing.**
   - `/etc/qwixbox`, so every `config_ensure_secret` finds its value and generates nothing.
   - The DKIM key, because the public half is in DNS.
   - `/etc/letsencrypt`, so the certificate is not issued again.
3. **Runs the full install.** The installer finds the restored `config.env` complete and does not
   prompt. `RESTORE_STEPS="00-preflight.sh 01-base-packages.sh …"` runs only the listed steps
   instead. That is for a test container with no public name, where TLS cannot be issued. Leave it
   unset on a real host.
4. **Checks the key** before replacing anything. It restores `qwixbox.dump` into a scratch
   database and decrypts every stored secret with this `ENCRYPTION_KEY`
   (`src/cli/check-encryption.ts`). If any fails, it stops with nothing restored. On a fresh
   host the install has already started the services by then, but with only the fresh install's
   empty databases. No restored credential exists to fail. To recover, fetch the `config.env` that
   belongs to the snapshot, and re-run.
5. **Restores the data.**
   - It stops the API, Kamailio and FreeSWITCH, then restores both dumps over the fresh databases.
   - It re-runs step 22, because database-level grants are not in a dump.
   - It puts back the snapshot's `first-login`, or removes the file if the snapshot has none:
     the account the fresh install created is gone.
   - It starts the services and runs `reconcile-kamailio.ts`, which rebuilds the cache and
     re-projects every tenant, extension and trunk.
   - It waits for `/health` to report `ok` with no pending projections.

It is safe to re-run after fixing whatever stopped it.

**Afterwards:**

- If the host's address changed, update the A record. With `DNS_PROVIDER=cloudflare`, step 02
  already published the new address. Endpoints re-register to the name, not the address.
- If trunks are IP-authenticated, give the carrier the new address. Their inbound calls are
  refused until they do.
- Endpoints keep their SIP credentials. Kamailio's registrations are in the restored `location`
  table but point at the old host's view of each device. They are replaced as each device
  re-registers, within its registration interval.
- Sign in to the portal with an existing account. Passwords are in the restored database.

## Restore in place

On the same host with the same `config.env`, `restore.sh <stamp>` restores over the running
install. The install pass then finds every step complete and takes about a minute. Everything
written after the snapshot is lost, as with a rollback.

## Evidence

On 2026-10-26, a snapshot from the arm64 test install (`qwixbox-m2`) was restored onto a new
container from the same base image with nothing installed. `tests/restore-check.py` then registered an
extension with its pre-backup SIP password, and a call to it rang. A snapshot whose secrets do not
decrypt under its key was refused before anything changed, and an in-place re-run succeeded.
A second fresh container given an intact snapshot whose `config.env` carried a different
`ENCRYPTION_KEY` stopped at the key check (4 of 4 secrets failed): no extension or subscriber
was loaded, and the scratch database was dropped. That
is a container, not the amd64 host that gate 5 and M6 require. See [status](status.md) for the
results and limits.
