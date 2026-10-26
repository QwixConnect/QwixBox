# Regression checks

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
actual helper/SSH/backup scripts against temporary files with host services stubbed. It does
not install the whole PBX or prove remote login/service availability.

Run `python3 tests/nginx-auth-limits.py` as root in the same kind of container, with `nginx` and
`openssl` installed and ports 80/443 free. It renders the deployed nginx templates in front of a
stub API on loopback and asserts that routine portal auth reads are not throttled, while sign-in,
reset, password-change and unlisted `/api/auth` paths are refused at the edge with 429. Each check
uses its own `127.0.0.x` source address so one check cannot drain another's bucket.

For the real SIP check, install `kamailio` and `kamailio-postgres-modules` in disposable Debian,
create a separate database named **qwixbox_sip_test**, and load `tests/sip-auth.sql` into it.
Set `SIP_TEST_DATABASE_URL` to its PostgreSQL connection URL and run `python3 tests/sip-auth.py`.
It starts a temporary loopback SIP listener on UDP 15060 and cleans it up. The `--legacy` option
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
exit. Its caller sends from the container's own address, not loopback: Kamailio treats
`127.0.0.1` as FreeSWITCH and skips authentication (I28). If every call gets 404 after gate 7 has
run, restart Kamailio first (I29).

`python3 tests/forwarding.py` checks carrier-originated forwarding (R11, D5) in the same container.
Its fake carrier listens on the container's address, port 5090. It is the trunk the outbound
route uses, and its address is a trusted peer. It places calls to a test DID: direct dial
(refused), DID → external, extension forwards, a loop, a no-answer forward, and that forward with
the API stopped mid-ring. It registers a handset that rings without answering. It reuses
`outbound-callerid.py`'s helpers and deletes what it created on exit.

Portal checks: `bun run typecheck`, `bun run lint`, `bun run build` in `portal/web` after
`bun install --frozen-lockfile`. Site checks: `npm ci`, `npm test`, `npm run build` in `site`.
Use `bash -n` / ShellCheck for installer scripts and `luac -p` for call-time Lua. Keep runtime
and full-install evidence separate from syntax/mocked tests in [project status](../docs/status.md).

`bun test tests/portal-client.test.ts` verifies the real IVR client URL builder without a browser,
and that a live `404` on each preview endpoint raises `FeatureUnavailableError` rather than
returning fixture records (I01).
`lua tests/ivr-choice.lua /work` exercises the actual Lua IVR with synthetic menu/session objects.
The SIP harness also checks six international/emergency destination cases using the real
Kamailio risk-prefix expression. These checks do not replace an audible DTMF/media test.

Documentation checks: run `python3 tests/docs-links.py` from the repository root. After
`npm run build` in `site`, run `python3 tests/docs-links.py --site-dir site/dist` to also check
generated local links and anchors. Research/review documents link to GitHub rather than
nonexistent public-site routes. These checks do not fetch external URLs.
