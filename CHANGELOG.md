# Change log

## 2026-10-24 — local portal UI mock mode

- Added `portal/web`'s `dev:mock` command on loopback port 5174, with automatic synthetic sign-in,
  editable in-memory fixtures for every portal page, filtered/paginated calls, CSV export,
  sample fax download and simulated roles/empty/error/slow states.
- The Vite-only mock handles unknown API paths locally, disables the real API proxy, forces a
  local API base, refuses mock production builds/previews and removes mock controls from the
  production bundle. No production API/authentication behavior was changed.
- Added mock regression tests and `portal/web/README.md`; updated root development instructions.
  Existing uncommitted remediation work was preserved.
- Verified the dashboard and sample extensions in Chrome. Three mock regression tests (23
  assertions), the existing IVR client test, typecheck, lint and production build pass. A bundle
  scan confirms mock fixtures/controls are absent; an attempted mock build is refused; the
  running server returns sample data and locally rejects unknown API paths.

## 2026-10-24 — first review remediation batch

- **R01:** Kamailio reads HA1/HA1b with plaintext hashing disabled. The disposable
  Kamailio 6.0.1/PostgreSQL test reproduces the old empty-password acceptance and verifies
  valid/wrong/empty REGISTER and INVITE credentials for two tenants.
- **R02:** ESL XML is restricted; runtime gateway credentials moved into a root-only systemd
  EnvironmentFile. Existing credential backups are restricted. Removed the unused API DB DSN.
  Fax writers/readers now share a dedicated setgid spool group.
- **R03/R04:** FreeSWITCH rebuilds preserve existing configuration and apply hardening before
  startup; firewall replacement invalidates/restores adaptive rules. SSH retains root key
  access and does not count unprivileged users' keys as an administrative recovery path.
- **R05:** Exact DID ownership has a global unique index and API conflicts return 409. Step 41
  inventories duplicates before schema push and refuses to silently choose an owner.
- **R07:** Missing required encryption config, archive errors and offsite-copy failures prevent
  successful retention. Snapshots include DKIM, TLS and service runtime configuration.
- **R08 (partial):** The real SIP filter now handles +, 00 and 011 international prefixes.
  Configured tenant/extension limits and pending-call reservations remain open.
- **R09/R10/R12/R14:** Tenant create and PATCH share validation; enabled register-mode trunks
  are rejected/excluded from both XML tiers; production expected HTTP errors retain their
  status; the tenant cache includes its signing setting. Tests import the assembled API.
- **R13 (partial):** Legacy patterns are quarantined from outbound cache publication without
  stopping unrelated directories/call flows. Warming continues after an individual tenant
  failure and retries failures. Startup refreshes the cache contract after an API upgrade.
  Atomic generation publication remains open.
- **R15–R17:** IVR # paths are encoded and Lua treats # as a choice. Portal query/mutation
  failures are visible. CDRs use tenant-scoped trusted trunk IDs, with legacy gateway fallback.
- **R18/R19:** Bun CLI calls preserve argument boundaries. Tenant provisioning is transactional,
  repeatable, and cannot rename an existing domain. First-login credentials survive a later
  provisioning failure. Input hashing tracks shared helpers and source while excluding private
  env files, dependencies and generated output; both portal deploy steps declare their source.
- **R20:** Site builds create and verify the bootstrap asset, pin an immutable commit, rewrite
  repository Markdown links for published docs, and include prebuild in deploy/preview. Bootstrap
  execution waits for the complete script and reconnects terminal input. Publishing refuses
  uncommitted installer/runtime changes; no production deployment was performed.
- Supporting installer fixes: wizard configuration runs before log redirection; configure/menu
  cancellation is handled; postflight runs every invocation; the portal requires locked deps.
- API formatting is normalized; ShellCheck warning-level diagnostics are clean.

### Removed or replaced

- `resources/conf/freeswitch/systemd-env.conf`: replaced by `runtime.env` plus a public drop-in
  containing only the EnvironmentFile path. The unused PostgreSQL environment DSN was removed.
- Managed `/etc/ssh/sshd_config.d/90-hardening.conf`: deployment replaces this legacy drop-in
  with `00-qwixbox-hardening.conf`, so OpenSSH reads the intended settings before cloud-init.
  Only the old file bearing QwixBox's exact ownership marker is removed.
- `docs/portal-ui-plan.md`: removed the stale delivery record. Current operation is in README,
  invariants in CLAUDE, and remaining work/evidence in REVIEW-PLAN. Removed its site navigation.
- The historical conversational proposal in REVIEW-PLAN: removed duplicated/superseded UUID and
  membership-plugin recommendations; the validated findings and active status remain.
- `portal/web/src/assets/vite.svg` and `portal/web/public/icons.svg`: unused starter assets with
  no source references. The portal's active favicon is retained.

### Verification and remaining work

Test commands, fixture boundaries and prerequisites are in `tests/README.md`. The current
results and open gates are in `REVIEW-PLAN.md`. Durable reconciliation (R06), configured-call-limit
reservation (R08), trusted inbound forwarding (R11), atomic cache publication (R13), full service
upgrade/restore and real media/carrier verification remain open. These are source changes;
existing user changes were preserved. Source versioning does not imply production deployment.

Verified for this batch: 19 API security tests, three API validation tests, one portal-client
test (84 Bun assertions combined), 18 live SIP cases, seven installer harness groups, the
Lua IVR # case, eight Worker tests, API/portal typechecks, portal lint/build, site build/artifact
checks, built-document internal links, shell/Lua syntax and warning-level ShellCheck. API
format:check and git diff --check pass. A full PBX/restore/media pass remains unverified.

Repository checkpoint: the remediation and local mock are committed together. The placeholder-only
FreeSWITCH `runtime.env` template is explicitly tracked despite the general environment-file ignore
rule; deployed secrets and generated build output remain excluded. No production deployment is part
of this checkpoint.
