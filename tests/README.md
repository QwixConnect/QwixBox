# Regression checks

`tests/ci.sh shell|api|web|site|integration|sip` is exactly what [CI](../.github/workflows/ci.yml)
runs. The first four need no live service. Run `shell` as root in a disposable Debian 13 with
`shellcheck lua5.4 python3 nginx openssl jq git`: it binds loopback 80/443. They need a git
checkout, and `site` needs a commit (the bootstrap is pinned to `HEAD`).

`integration` needs bun, `pcre2grep`, `TEST_DATABASE_URL` (a Postgres database whose name ends in
`_test`) and `TEST_REDIS_URL`, both disposable. It pushes the schema, then runs `security.test.ts`
and `cache-publish.test.ts` in separate `bun test` runs. `sip` needs Debian 13 with `kamailio
kamailio-postgres-modules postgresql-client python3` and `SIP_TEST_DATABASE_URL` naming
`qwixbox_sip_test`; it loads the fixture and runs `sip-auth.py`. Both refuse a URL that does not
name a test database, because the suites truncate tables and delete keys.

For local UI fixtures, `bun test tests/portal-mock.test.ts` checks session/collection contracts,
pagination, mutation/reset behavior, IVR #, demo-role refusals and error/empty states without
external services. Start the UI with `bun run dev:mock` in `portal/web`; see its README. These
fixture tests do not prove backend security or live telephony.

Run API checks from `portal/api`: `bun run typecheck`, `bun test tests/validation.test.ts` and
`bun run format:check`. Security tests import the production `src/app.ts` assembly and require
`TEST_DATABASE_URL` pointing to a **disposable** database: they truncate users/organizations and
create simplified Kamailio fixture tables. Apply the current schema there before running
`bun test tests/security.test.ts`. Session lookup, Redis and ESL are mocked in that suite. It also
asserts that settings listed in `src/lib/capabilities.ts` are refused unless inert or unchanged,
and injects Kamailio/Redis failures after a commit to prove queued projections converge (R06).
Those two tests wait out real backoff, so the suite takes about five seconds longer.
`bun test tests/cache-publish.test.ts` needs `TEST_REDIS_URL` pointing to a **disposable** Redis
(for example `docker run -p 127.0.0.1:56379:6379 redis:7-alpine`). It deletes keys under the
`pub.test` domains it creates, and proves cache publication is atomic against a concurrent reader,
including a baseline showing the old delete-then-set pattern was not. Run it in its own `bun test`
invocation: a combined run shares modules with the security suite, which mocks Redis, and its
tests then time out.

Run `python3 tests/installer-safety.py` inside a disposable Debian 13 container. It exercises
actual helper/SSH/backup scripts against temporary files with host services stubbed, including
the check that role passwords reach psql on stdin, never argv (I14), and that postflight accepts
step 10's SSH policy and probes ports without a SIGPIPE-prone pipe (I10), and that the DNS mode
resolves once, a provider failure prints the manual records and the webroot `cli.ini` is HTTP-01
only (I11), and the admin SSH rule split by address family and the mail sender/mode checks
(I12), and that no multi-line producer pipes into `grep -q` under pipefail (I32). It does
not install the whole PBX or prove remote login/service availability.

Run `python3 tests/nginx-auth-limits.py` as root in the same kind of container, with `nginx` and
`openssl` installed and ports 80/443 free. It renders the deployed nginx templates in front of a
stub API on loopback and asserts that routine portal auth reads are not throttled, while sign-in,
reset, password-change and unlisted `/api/auth` paths are refused at the edge with 429. Each check
uses its own `127.0.0.x` source address so one check cannot drain another's bucket.

For the real SIP check, install `kamailio` and `kamailio-postgres-modules` in disposable Debian,
create a separate database named **qwixbox_sip_test**, and load `tests/sip-auth.sql` into it.
Set `SIP_TEST_DATABASE_URL` to its PostgreSQL connection URL and run `python3 tests/sip-auth.py`.
It starts a temporary loopback SIP listener on UDP 15060 and cleans it up. It also runs the
deployed `route[AUTHRESULT]`/`route[AUTHFAIL]` from `127.0.0.2` and `127.0.0.3`. Wrong passwords
must ban an address at `MAX_AUTH_FAILURES`. A database failure must answer 503 and ban nobody
(I29); it is simulated by briefly renaming `sip_auth_fixture`, so the URL's role must own that
table. From another container, use the database container's bridge IP: Docker's default bridge
does not resolve container names. The `--legacy` option
intentionally restores the old plaintext settings and must fail: it demonstrates valid-password
rejection and empty-password acceptance. Fixtures contain synthetic credentials only.

For the gate 7 check, install the stack in a disposable Debian 13 **systemd** container (steps
00-01, 20-22, 30-35, 40-41 and 44 with `ADMIN_EMAIL` set; TLS, DNS, firewall and mail can be
skipped) and run `python3 tests/gate7-convergence.py` as root inside it. It stops Redis, refuses
the `kamailio` database role, restarts services and creates test extensions, so never run it on a
real install. It restores the role and services on exit and deletes its extensions.

In the same container, `python3 tests/outbound-callerid.py` checks outbound caller ID as a
carrier sees it (I03). It adds a trunk to a fake carrier on UDP 127.0.0.1:5090, then places
digest-authenticated calls through Kamailio, first with only the Redis tier able to answer and
then with only the API tier. It stops the API and Redis in turn and deletes what it created on
exit. Its caller sends from the container's own address, not loopback: Kamailio trusts only
FreeSWITCH's address and profile ports (I28), so the harness sends as an ordinary endpoint would. It can run straight after gate 7: a
database outage no longer leaves the caller's address banned (I29).

`python3 tests/forwarding.py` checks carrier-originated forwarding (R11, D5) in the same container.
Its fake carrier listens on the container's address, port 5090. It is the trunk the outbound
route uses, and its address is a trusted peer. It places calls to a test DID: direct dial
(refused), DID → external, extension forwards, a loop, a no-answer forward, and that forward with
the API stopped mid-ring. It registers a handset that rings without answering. It reuses
`outbound-callerid.py`'s helpers and deletes what it created on exit.

`python3 tests/emergency-ingress.py` checks I02 in the same container. It adds a trunk to a fake
carrier on UDP 127.0.0.1:5090 with an emergency route for 933 (nothing leaves the container) and
sets the test extension's Kamailio concurrent counter to the limit with `kamcmd htable.seti`. An
ordinary call must then be refused before FreeSWITCH while 933 reaches the carrier. Clearing the
route's emergency flag must withdraw the exemption. It deletes what it created on exit.

`python3 tests/ring-group-policy.py` checks I05 in a full-install container. It uses the same
handsets as `forwarding.py`, which ring and never answer. A group of a DND member, a member with
call waiting off and an ordinary member must ring only the available members, simultaneously and
sequentially. The member with call waiting off must be skipped while it is ringing on a direct
call. Sequential members must ring one ring timeout apart, and an all-DND group must reach the
failover. It deletes what it created on exit.

`python3 tests/loopback-trust.py` checks I28 in a full-install container. From 127.0.0.1 on an
arbitrary port, an unauthenticated INVITE to the public port must get 407 and one to the egress
listener 403, and FreeSWITCH must not listen on TCP. The call harnesses above prove that
FreeSWITCH's own traffic is still trusted.

`python3 tests/restore-check.py <probe.json>` runs on a host restored with `restore.sh` (I13). The probe
file holds `{id, number, sipPassword, domain}` for an extension created on the source host before
the snapshot, which is the only time the API returns the password. The check registers that
extension with that password and requires a call to it to ring.

`python3 tests/rollback-drill.py` runs the [rollback procedure](../docs/rollback.md) end to end
(I14). **It replaces the `qwixbox` database and edits `portal/api/src/db/schema.ts` in the
checkout**, so use only a disposable full install. It upgrades to a schema with an added column,
changes data on both sides of the pre-upgrade dump, restores the dump and re-runs steps 22 and 41,
then runs `reconcile-kamailio.ts`. Kamailio and Redis must then match the restored database. It
restores `schema.ts` on exit. If a run stops partway, the database can keep the drill column; the
next run refuses to start until step 41 is re-run with `SCHEMA_ACCEPT_DESTRUCTIVE=1`.

Portal checks: `bun run typecheck`, `bun run lint`, `bun run build` in `portal/web` after
`bun install --frozen-lockfile`. Site checks: `npm ci`, `npm test`, `npm run build` in `site`.
Use `bash -n` / ShellCheck for installer scripts and `luac -p` for call-time Lua. Keep runtime
and full-install evidence separate from syntax/mocked tests in [project status](../docs/status.md).

`bun test tests/portal-client.test.ts` verifies the real IVR client URL builder without a browser,
and that a live `404` on each preview endpoint raises `FeatureUnavailableError` rather than
returning fixture records (I01).
`lua tests/ivr-choice.lua /work` exercises the actual Lua IVR with synthetic menu/session objects.
`lua tests/caller-concurrency.lua .` runs the real `xml_handler.lua` against a stubbed Redis and
checks that an authenticated caller's own slot is counted first (I06). The shell CI job runs every
`tests/*.lua` from the repository root.
The SIP harness also checks six international/emergency destination cases using the real
Kamailio risk-prefix expression. These checks do not replace an audible DTMF/media test.

Documentation checks: run `python3 tests/docs-links.py` from the repository root. After
`npm run build` in `site`, run `python3 tests/docs-links.py --site-dir site/dist` to also check
generated local links and anchors. Research/review documents link to GitHub rather than
nonexistent public-site routes. These checks do not fetch external URLs.
