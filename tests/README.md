# Regression checks

For local UI fixtures, `bun test tests/portal-mock.test.ts` checks session/collection contracts,
pagination, mutation/reset behavior, IVR #, demo-role refusals and error/empty states without
external services. Start the UI with `bun run dev:mock` in `portal/web`; see its README. These
fixture tests do not prove backend security or live telephony.

Run API checks from `portal/api`: `bun run typecheck`, `bun test tests/validation.test.ts` and
`bun run format:check`. Security tests import the production `src/app.ts` assembly and require
`TEST_DATABASE_URL` pointing to a **disposable** database: they truncate users/organizations and
create simplified Kamailio fixture tables. Apply the current schema there before running
`bun test tests/security.test.ts`. Session lookup, Redis and ESL are mocked in that suite.

Run `python3 tests/installer-safety.py` inside a disposable Debian 13 container. It exercises
actual helper/SSH/backup scripts against temporary files with host services stubbed. It does
not install the whole PBX or prove remote login/service availability.

For the real SIP check, install `kamailio` and `kamailio-postgres-modules` in disposable Debian,
create a separate database named **qwixbox_sip_test**, and load `tests/sip-auth.sql` into it.
Set `SIP_TEST_DATABASE_URL` to its PostgreSQL connection URL and run `python3 tests/sip-auth.py`.
It starts a temporary loopback SIP listener on UDP 15060 and cleans it up. The `--legacy` option
intentionally restores the old plaintext settings and must fail: it demonstrates valid-password
rejection and empty-password acceptance. Fixtures contain synthetic credentials only.

Portal checks: `bun run typecheck`, `bun run lint`, `bun run build` in `portal/web` after
`bun install --frozen-lockfile`. Site checks: `npm ci`, `npm test`, `npm run build` in `site`.
Use `bash -n` / ShellCheck for installer scripts and `luac -p` for call-time Lua. Keep runtime
and full-install evidence separate from syntax/mocked tests in REVIEW-PLAN.md.

`bun test tests/portal-client.test.ts` verifies the real IVR client URL builder without a browser.
`lua tests/ivr-choice.lua /work` exercises the actual Lua IVR with synthetic menu/session objects.
The SIP harness also checks six international/emergency destination cases using the real
Kamailio risk-prefix expression. These checks do not replace an audible DTMF/media test.
