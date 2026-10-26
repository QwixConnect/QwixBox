# Change log

## 2026-10-26 — I24 auth-schema.ts is the generator's output

- `portal/api/src/db/auth-schema.ts` is replaced by `auth@1.6.25 generate` output. On upgrade,
  `push --force` renames five indexes, drops the `created_at` defaults on `organization` and
  `member`, and adds `invitation.created_at` and `invitation_email_idx`. No data-losing
  statement is involved.
- `provisioning.ts` and `membership.ts` set `createdAt`. They relied on the dropped default, and
  without the change every tenant create failed.
- `portal/api/scripts/auth-schema.sh` (`bun run auth:generate` / `auth:check`) runs the `auth`
  package at the installed better-auth version. It replaces the unpinned `@better-auth/cli`.
  `tests/ci.sh api` runs the check.

## 2026-10-26 — Acceptance procedures and the evidence table (YYZ-16, YYZ-17)

- Added `docs/acceptance.md`: pass conditions and steps for gates 2, 3, 4, 5 and 7, separating
  container-harness evidence from host evidence. Published on the site and linked from mvp.md.
- `docs/status.md` has an "Acceptance runs" table, which every gate run writes to.
- `testing-on-real-hardware.md` no longer describes R11 and the postflight SSH check as open.

## 2026-10-26 — CI service-container jobs (YYZ-15)

- `tests/ci.sh integration` pushes the schema to a disposable Postgres, then runs the API
  security and cache-publication suites. `tests/ci.sh sip` loads the SIP fixture and runs
  `sip-auth.py` against Debian's Kamailio. Both refuse a URL that does not name a `*_test`
  database.
- `.github/workflows/ci.yml` runs both against service containers created for the job.
- The api job installs `pcre2-utils`, and the shell job marks the checkout as a git
  `safe.directory`. The first GitHub run failed on both. All six jobs are green at `d0309ee`.

## 2026-10-26 — I12 implicit-TLS relay, sender validation and IPv6 admin access

- Step 15 honours `SMTP_STARTTLS="off"` with `smtp_tls_wrappermode = yes`; before, nothing read it
  and a 465 relay deferred every message. It refuses 465 with STARTTLS, an unknown mode, and an
  example.com/.net/.org `SMTP_FROM`. The wizard sets the mode from the port it asks for.
- `config.env.example` leaves `SMTP_FROM` empty, so it defaults to `pbx@<PBX_FQDN>` instead of
  the placeholder.
- Step 11 validates `ADMIN_ALLOW_CIDR` and writes separate `ip saddr` and `ip6 saddr` SSH rules.
  An IPv6 prefix used to make nft reject the whole ruleset.
- `tests/installer-safety.py` covers the rule split and the mail checks.

## 2026-10-26 — I11 DNS mode, publication failures and DNS-01 renewal

- `lib/dns.sh`: `dns_resolve_mode` sets the mode in the step's own shell. `dns_mode` ran inside
  `$( )`, so its cache died with each subshell and `auto` re-ran discovery on every call (4 times
  in step 02's sequence).
- `dns_publish` never fails the step. A record Cloudflare refuses is queued, and `dns_commit`
  prints it and returns 1, so the manual fallback the steps promise appears. Before, a failure
  aborted the step under `set -e` before anything was printed.
- Step 42 writes its webroot `/etc/letsencrypt/cli.ini` only when `ACME_CHALLENGE=http`, and
  removes its own copy otherwise. certbot applies `cli.ini` over each certificate's renewal
  config, so a DNS-01 certificate was renewing over HTTP-01.
- `tests/installer-safety.py` covers all three.

## 2026-10-26 — I10 postflight matches the installer

- `99-postflight.sh` accepts step 10's root key-only login and warns, rather than fails, when
  password authentication was left on for lack of a key. Port, telephony, Kamailio, WSS, STIR,
  Redis and Postgres checks run only on the role that installs them; the Postgres loopback check
  only on an all-in-one host.
- The port probe no longer pipes `ss` into `grep -q` under pipefail, which failed a listening port
  about one run in three.
- The closing advice points at the portal and `provision-tenant.ts`, not `kamctl add`.
- `tests/installer-safety.py` guards the SSH policy, the probe and the advice.

## 2026-10-26 — I05 ring groups apply member DND and call waiting

- `ring_group.lua` skips a member on DND, and a member already on a call with call waiting off.
  It reads the same call profile and `limit_usage` counter that `extension.lua` uses. An answered
  member leg counts against that member through `execute_on_answer=limit`.
- Sequential and random groups ring each member for `ringTimeoutSec` (`leg_timeout`). Before,
  `call_timeout` bounded the whole bridge, so only the first member ever rang.
- A group with no available member goes straight to its failover.
- Added `tests/ring-group-policy.py`.

## 2026-10-26 — I28 Kamailio trusts FreeSWITCH by port, not by address

- `kamailio.cfg`: `route[FROMFS]` trusts only UDP from `FS_HOST`/loopback on FreeSWITCH's
  internal and external profile ports. `route[AUTH]`, `route[REQINIT]` and `route[EGRESS]` use it
  instead of `$si == "127.0.0.1"`. Step 34 passes `FS_EGRESS_SIP_PORT`.
- Both FreeSWITCH SIP profiles bind `transport=udp`.
- Added `tests/loopback-trust.py`.

## 2026-10-26 — Backup failures reach the alerter (YYZ-38)

- `qwixbox-healthcheck` alerts when no complete snapshot is newer than 26h, and when the last
  `qwixbox-backup` run failed. A failed offsite copy leaves a complete local snapshot behind, so
  only the second check catches it. Step 52 passes `BACKUP_DIR` to the template.
- `tests/installer-safety.py` covers a missing snapshot, a stale snapshot, a failed run and
  recovery.

## 2026-10-26 — I13 restore command and runbook

- Added `restore.sh`. It restores a `qwixbox-backup` snapshot onto a fresh host or in place:
  secrets first, then the install, then a key check, then both databases, grants, reconcile and
  health. `RESTORE_STEPS` limits the install for test containers.
- Added `src/cli/check-encryption.ts`, which fails when any stored secret does not decrypt under
  `ENCRYPTION_KEY`.
- Added `docs/restore.md` (also published on the site), linked from the README.
- Added `tests/restore-check.py`, which proves a restored host carries calls with pre-backup
  credentials. CI's shell job now lints `restore.sh`.

## 2026-10-26 — I14 upgrade safety and role passwords out of the Postgres log

- `lib/common.sh`: `psql_secret` runs secret-bearing SQL on stdin with statement logging off for
  the session; `sql_literal` quotes a value. Steps 20 and 22 set every role password through it.
  Step 20 redacts role passwords that earlier releases left in `/var/log/postgresql/`.
- Step 41, when Postgres is local:
  - dumps `qwixbox` to `/var/backups/qwixbox/pre-upgrade/` (last five kept) before changing it;
  - rehearses `db:push --force` on a copy, logging the statements to
    `/var/log/qwixbox/schema-preflight-*.log`;
  - refuses data-losing statements unless `SCHEMA_ACCEPT_DESTRUCTIVE=1` is set for that run.
- `src/cli/reconcile-kamailio.ts` and `pruneKamailio()` bring Kamailio and Redis back in line
  after a database restore.
- Added `docs/rollback.md` (also published on the site) and `tests/rollback-drill.py`.
  `tests/installer-safety.py` checks that role passwords never reach psql's argv.

## 2026-10-26 — I17 health alerts that reach someone

- `/health` is degraded when FreeSWITCH or Kamailio is down, and reports `kamailio`
  (`kamailioResponds()`, `kamcmd core.uptime`). The portal's status pill requires it.
- `qwixbox-healthcheck` fixes:
  - It now detects units with `systemctl cat`. The old pipeline (`list-unit-files | grep -q`
    under `pipefail`) never checked a service.
  - The other `grep -q` pipelines and a doubled registration count are fixed.
- `qwixbox-healthcheck` additions:
  - It reads the API's `/health`, including failing projection jobs.
  - It counts Kamailio's auth backend errors.
  - It is the alerter: it alerts by email and/or webhook when the set of failing checks changes
    and on recovery, repeats a reminder every 6h, and retries a failed delivery.
  - Paths can be overridden for tests.
- `config.env.example`: `ALERT_EMAIL`, `ALERT_WEBHOOK`. They fall back to `INSTALL_NOTIFY_*`
  and `ADMIN_EMAIL`. Step 52 writes them to `/etc/qwixbox/alerts.env` (0600).
- `tests/installer-safety.py` exercises the alerting against stubbed services. CI's shell job
  installs `jq`.

## 2026-10-26 — I16 offline CI

- Added `.github/workflows/ci.yml`: four jobs on every push and pull request, each running
  `tests/ci.sh <job>` (`shell` in a `debian:13` container, `api`, `web`, `site`). The script holds
  the commands, so a local run and CI cannot drift.

## 2026-10-26 — I02 emergency calls exempt from the ingress capacity check

- `services/outbound-routes.ts`: `eligibleOutboundRoutes()` is the one definition of a routable
  outbound route, now used by the Redis route table, `fs-xml.ts`, and `emergencyPatterns()`.
- New projection kind `emergency`: writes each tenant's eligible, compilable emergency patterns
  to Kamailio's `emergency_pattern`. Queued by outbound route changes and re-run by trunk and
  domain jobs. `src/cli/project-emergency.ts` queues it for every tenant, run by step 41.
  `check-route-patterns --accept-pcre` queues it for the route it accepts.
- `reloadKamailio()` takes the copies to reload (`RELOADS`); the emergency job reloads only its
  htable.
- Step 34 creates `emergency_pattern` (htable layout plus `organization_id`) outside the schema
  guard. `kamailio.cfg` loads it as `emergency=><domain>[i]`, adds `route[EMERGENCY]` (`regex`
  module, `pcre_match`), and skips `route(FRAUD)` on ingress for an authenticated subscriber
  dialling a match.
- Added `tests/emergency-ingress.py` and a security test. Recorded I31.

## 2026-10-26 — I29 authentication failure accounting

- `kamailio.cfg`: both authorize calls keep their result in `$var(auth)` and go through the new
  `route[AUTHRESULT]`. A database error (-1) answers 503 with `Retry-After: 30` and is not
  counted. Only a wrong password (-2) or unknown user (-3) reaches `route[AUTHFAIL]`. Before, a
  database outage banned every address that retried, until Kamailio was restarted.
- `authfail` and `concurrent` counters use `$shtinc`/`$shtdec` with `initval=0`. The old
  `$sht(...) + 1` concatenated (1, 11, 111): a ban came at the second failure, and an account's
  third simultaneous call was refused.
- `tests/sip-auth.py` copies the authorize lines, both routes, the htables and
  `MAX_AUTH_FAILURES` from the deployed config. New cases: the ban threshold, and a database
  outage (the fixture table renamed) answered 503 with no ban. A static check refuses `$sht`
  arithmetic. It prints Kamailio's log when a case fails.

## 2026-10-25 — R11 authorized forwarding; I30 refused Kamailio reloads

- R11: `qwixbox.go` (`resources/lua/qwixbox.lua`) takes the forwarding extension as a new
  `via` argument (passed by `extension.lua`). Before transferring an external destination it
  sets `qwixbox_forward_to`, `qwixbox_forward_domain` and `qwixbox_forward_from`.
  `routes/fs-xml.ts` treats a lookup for exactly that number as a forward in that tenant, for
  carrier calls too: internal resolution plus outbound routing as the forwarding extension.
  `xml_handler.lua` does the same for endpoint calls; peer calls still go to the API.
- `outboundCallerId()` accepts no extension (tenant identity) for tenant-configured external
  destinations.
- D5: a carrier-call forward with the API unhealthy plays reorder tone and responds 503.
  Kamailio forwards that as 500.
- I30: `reloadKamailio()` now treats an RPC error on kamcmd's stdout as a failure
  (`kamcmdFailed()`), so a reload refused within `reload_delta` is retried.
- Added `tests/forwarding.py`; two security tests (R11 cold tier, kamcmd failure detection).

## 2026-10-25 — I03 outbound caller ID; I27 tenant context entry

- I03: outbound calls present route override → extension → tenant caller ID in both tiers.
  `outboundCallerId()` and `extensionCallState()` in `services/call-state.ts` build the caller's
  profile, so the cache and `/fs/call-state` cannot disagree. `fs-xml.ts` looks up the caller's
  extension. `xml_handler.lua` reads `qwixbox:call:` and declines to the API when the profile is
  missing.
- Caller ID names are limited to 64 characters with no `$`. Removed the four caller-ID
  `UNENFORCED` entries (API and portal mock); the portal inputs are enabled again.
- I27: Kamailio-forwarded calls arrive in the `default` context. Both tiers now answer there with
  a transfer into `tenant_<org>`; before, every endpoint call ended `NO_ROUTE_DESTINATION`.
- Added `tests/outbound-callerid.py`: digest-authenticated calls through Kamailio to a fake
  carrier, with each XML tier alone. Two security tests cover I03 and I27.
- Recorded I28 (loopback SIP is trusted without authentication) and I29 (Kamailio does not
  recover terminated database connections).

## 2026-10-25 — M2 exit check; I26 Kamailio database URLs

- I26: `resources/conf/kamailio/kamailio.cfg` rendered both database URLs with no `@` between
  password and host, so Kamailio could not start on a fresh install. Now `@@@`.
  `tests/installer-safety.py` checks that every rendered database URL parses.
- Added `tests/gate7-convergence.py`: failure injection on a full install (revocation with Redis
  and Kamailio's database down across an API restart, 50 concurrent rebuilds, Redis and API
  restarts), checking the warm and cold tiers, FreeSWITCH and a real REGISTER. 14/14 on arm64;
  fails when the projection worker is disabled.

## 2026-10-25 — I19: one dialable-number namespace

- Added `portal/api/src/lib/numbers.ts`: `DIALABLE` lists extensions, ring groups, IVRs and
  queues; `claimNumber()` takes a per-tenant advisory transaction lock and refuses a number any
  of them holds (409 naming the holder).
- `crudRoutes` claims on create and on number change for any listed table; the extension create
  claims in its transaction.
- `services/cache.ts`: for a legacy duplicate, the `qwixbox:num:` key keeps the ring group, as
  `routes/fs-xml.ts` does.
- Added `src/cli/check-dialable-numbers.ts`, run by step 41 after the schema push. It warns about
  duplicates and never renumbers.
- The portal mock enforces the same namespace.
- Verified: three security tests, a registry-completeness test, and a mock test; each fails when
  its piece is removed.

## 2026-10-25 — I04: referenced destinations cannot be deleted

- Added `portal/api/src/lib/references.ts`: one lookup over every destination pointer (DIDs,
  ring-group failovers, IVR timeouts and options, time-condition branches, queue timeouts),
  matching an extension by id and, for voicemail, by number. A destination's own pointers are
  excluded.
- Extension, ring-group, IVR and time-condition deletes return 409 naming the references.
- Portal: `notifyFailed()` in `lib/notify.ts`; trunk, extension, ring-group, IVR and
  time-condition deletes now show a refusal instead of doing nothing. The mock refuses the same
  deletes.
- Verified: two security tests (fail without the check), a mock parity test, and a browser
  check. `tests/README.md` now says `cache-publish` must run in its own `bun test` invocation.
- Residual: a pointer created concurrently with a delete is not serialised.

## 2026-10-25 — R13: atomic cache publication

- `services/redis.ts`: `publishGeneration(patterns, exact, entries)` scans a section's current
  keys, then one `EVAL` sets the new generation and deletes stale keys atomically. Added
  `keys.didPattern` and `keys.callFlowPatterns`.
- `services/cache.ts`: every section builds into an in-memory map and publishes it; nothing is
  written if a build fails. `rebuildTenant` no longer purges first. DID publication no longer
  deletes all DIDs before re-setting them. `cacheRingGroups`, `cacheIvrMenus` and
  `cacheTimeConditions` became `cacheCallFlows` (they share `qwixbox:num:`); deleted or disabled
  call flows now lose their keys. A rebuild flushes FreeSWITCH's directory cache after publishing.
- `services/projections.ts`: `withTenantLock()` (PostgreSQL advisory lock) serialises each
  tenant's publishers - job runs and the warm watchdog. Call-flow resources queue the
  `callflows` section instead of a full rebuild.
- Added `portal/api/tests/cache-publish.test.ts` (needs `TEST_REDIS_URL`) and two security tests.
- Verified: on real Redis 7, the old delete-then-set pattern left 260 of 4,281 reads without a
  tenant; atomic publication left 0 missing and 0 mixed in 2,001. Both new security tests fail
  under the old behaviour. API suite 30 tests; API booted against real Redis and warmed 2 tenants.
  Not yet exercised through FreeSWITCH.

## 2026-10-25 — R06: durable projection outbox

- Added `projection_job` (`schema.ts`) and `src/services/projections.ts`. Writes record their
  Redis/Kamailio work in the same transaction, try it at once, and leave it queued on failure.
  Jobs (`extension`, `trunk`, `domain`, `cache`) re-read current state, so repeats are safe; a
  `requested` counter keeps a change committed mid-run. A worker started in `src/index.ts` drains
  on startup and every 2 seconds with exponential backoff (cap 5 minutes). A failed Kamailio
  reload now fails the job.
- `crudRoutes` replaces optional `afterChange` with a required `project`. Extensions, tenants,
  ring-group members, IVR options, feature codes and `provision-tenant.ts` use the same path.
  `POST /api/tenant/rebuild-cache` answers 202 `queued` when it could not apply immediately.
- `/health` reports pending/failing counts and is degraded while any job is failing. New
  `GET /api/tenant/projections` (owner/admin). The portal shows a banner to owners and admins
  when changes are not live; the mock has a "Changes not live" scenario.
- Added `src/cli/check-schema-tables.ts`, run by step 41 before `db:push` (I25): drops retired
  tables (`apikey`) and refuses unknown ones, because a drop plus a create made drizzle-kit prompt
  and abort without a TTY.
- Verified: before, disabling an extension with Kamailio's database down returned 500 and the
  subscriber survived. After, the security tests prove convergence after Kamailio and Redis
  failures; removing the mid-run guard fails a test; an upgrade from the committed schema pushes
  without a prompt; the API boots and drains a queued job; banner checked in the browser. Not
  verified with real Redis/Kamailio restarts.

## 2026-10-25 — I16: unused api-key plugin removed

- Removed `@better-auth/api-key` from `portal/api/package.json` and `bun.lock`, and the `apikey`
  table from `src/db/auth-schema.ts`. The plugin was enabled in `889e309` and disabled in
  `71a809e`; nothing has read the table since. Step 41's `db:push --force` drops it on upgrade,
  including any rows (hashed keys with no remaining verification path).
- Verified: on a disposable PostgreSQL 17 database built from the previous schema with one user and
  one key row, the push dropped `apikey` with stdin closed (no prompt), kept the user, and a repeat
  push reported no changes. `auth:generate` output also has no `apikey`. API 26 tests,
  typecheck, format and frozen install pass.
- Recorded I24: the committed `auth-schema.ts` has drifted from the generator in unrelated ways.

## 2026-10-25 — I21: auth rate limit split

- `resources/conf/nginx/sites-available/qwixbox-api`: an exact-path allowlist (`get-session`,
  `sign-out`, organization `list`, `set-active`, `get-active-member`, `get-active-member-role`,
  `list-members`, `get-full-organization`) uses the general zone. Every other `/api/auth/` path
  keeps the 5/min strict zone, so new endpoints default to strict. The unused `/api/login` and
  `/api/token` prefixes left the strict pattern; neither route exists.
- `00-hardening.conf`: `limit_req_status 429`, so the login page's "Too many attempts" message
  shows for edge refusals instead of "credentials were not accepted".
- `portal/api/src/auth.ts`: the reset rule named `/forget-password`, a path the portal never
  calls; it now names `/request-password-reset`.
- Added `tests/nginx-auth-limits.py` and a security test for the reset rule.
- Verified: before, 34 of 40 routine requests from four tabs were refused. After, the harness
  passes in Debian 13 with nginx 1.26.3 and fails when `change-password` is allowlisted. The reset
  test fails on the old rule. API 26 tests, typecheck, format and installer harness pass. Not
  verified through a deployed nginx.

## 2026-10-25 — I15: dependency advisories patched in range

- API lockfile: Hono 4.12.32 → 4.13.11, Zod 4.4.3 → 4.6.6; `package.json` floor `hono ^4.13.11`.
- Portal lockfile: Seroval 1.6.3, Vite 8.1.6, Zod 4.6.6, brace-expansion 5.0.12, nanoid 3.3.18,
  postcss-selector-parser 7.1.6, source-map-js 1.2.2; floor `vite ^8.1.6`. Audit clean.
- Site `package-lock.json`: `npm audit fix` within ranges (Astro 6.4.8, Vite 7.3.7 and others),
  15 → 6 entries.
- Added `docs/reviews/dependencies-2026-10-25-patched.json`. Reachability triage and accepted
  residuals (esbuild via drizzle-kit; Astro/sharp/esbuild needing Astro 7; undici via wrangler)
  are in `docs/issues.md`.
- Verified: API 25 tests against disposable PostgreSQL 17, portal 20 tests, typecheck/format/lint
  and builds, site Worker tests and build, `bun install --frozen-lockfile` for both portal
  packages, `npm ci --dry-run`, mock dev server starts. Not verified by a deployed install.

## 2026-10-25 — I23: simulated webphone confined to mock mode

- `src/components/webphone-context.ts` holds a nullable context; `_app.tsx` lazy-loads
  `WebphoneProvider` only when `MODE === "mock"`. The header Keypad, mobile Keypad tab and
  click-to-call buttons on Dashboard, Recents, Extensions, Contacts, Messages and Conferences render
  only when a phone exists. `vite.config.ts` fails a non-mock build that loads `WebphoneDrawer.tsx`.
  The mock drawer reads "Simulated call · no audio (mock mode)".
- Verified: removing a null guard fails typecheck (TS18047); importing the drawer from a route fails
  the build; the production bundle contains no simulation strings; a non-mock dev server showed no
  keypad, Keypad tab or call buttons, while mock mode still opens the labelled drawer. 20 portal
  tests, typecheck/lint/build pass. Not checked on a deployed host.

## 2026-10-25 — M1 item 2: unenforced settings refused, invented UI claims removed

- Added `portal/api/src/lib/capabilities.ts`: tenant `recordingPolicy`, `maxConcurrentCalls`,
  default caller ID and `stirShakenEnabled` (unless signing is installed); extension
  `maxConcurrentCalls` and caller ID; trunk `codecPrefs`, `priority`, `fromDomain`. `crudRoutes`, the
  tenant/extension routes and `provision-tenant.ts --max-calls` refuse changes except to the inert
  or current value. Added `GET /api/capabilities` (any tenant member).
- `stir_signing_ready` in `lib/common.sh` reads the deployed Kamailio files; step 41 renders
  `STIR_SIGNING` into the API `.env`, and step 34 invalidates step 41 when the answer changes.
- Portal: `useUnenforced()` disables refused inputs with the reason and omits them from saves.
  Removed invented values: Settings personal rows and preferences modal, "Attestation A · TLS 1.3 +
  SRTP enforced", sidebar number/extension/"Online", dashboard channel capacity and "Registered",
  trunk "Priority LCR" tile and priority column, emergency tiles and round-robin location
  assignments. Register-mode trunks are a disabled option. Preview screens hide create actions when
  their API is absent. Formatting the touched files with Biome also rewrapped a few untouched lines.
- Recorded I23 (simulated webphone reachable in production). I22 fixed; I07 controls refused.
- Verified: before the fix, PATCH `recordingPolicy: "all"` returned 200. After: 25 API tests
  against disposable PostgreSQL 17, 20 portal tests (mock table drift test proven to fail on a
  one-field change), 8 installer harness groups, ShellCheck, typecheck/lint/build, and a browser
  pass over Settings, Trunks, Emergency and Dashboard in the mock `unavailable` scenario. Not
  verified on a deployed host, and STIR readiness was tested with fixture files only.

## 2026-10-25 — I01: production fixture fallback removed

Source baseline `eca43d7` plus the uncommitted documentation consolidation below. MVP plan M1,
item 1.

- Removed `getWithFallback` and the `mock/data.ts` import from `portal/web/src/lib/api.ts`. Preview
  endpoints use `getPreview`, which turns a `404` into `FeatureUnavailableError`; `ErrorAlert`
  renders it as "Not available on this server". Conferences, queue agents and SMS opt-outs, which
  rendered lists without an error state, now show it too.
- Added a `vite.config.ts` plugin that fails any non-mock build or dev server that loads `mock/`.
- Added the mock `unavailable` scenario ("Preview APIs missing") and regression tests in
  `tests/portal-client.test.ts` and `tests/portal-mock.test.ts`.
- Verified: before the fix, a mocked `404` on `/emergency-locations` returned three fixture
  locations and the production bundle contained them. After: 19 portal tests pass, typecheck/lint/
  build pass, no fixture records in `dist/`, re-adding the import fails the build, and the
  emergency and conference screens show the unavailable state in the browser (mock scenario).
  Not verified on a deployed portal.
- Recorded I22: the emergency screen hard-codes 911/notification capability claims.

## 2026-10-25 — codebase review and documentation consolidation

Reviewed clean baseline `eca43d7`. This change updates project records and site documentation
plumbing; it does not fix the runtime issues in [issues](issues.md), upgrade dependencies,
publish a release or change deployed services. Current evidence is in [status](status.md).

### Added and updated

- Added the [documentation index](README.md), [status](status.md) and [active issue register](issues.md).
  Retained R IDs and added I01–I21 with source evidence, impact and closure checks.
- Captured advisory-service responses for all three lockfiles in
  [the dated dependency audit](reviews/dependencies-2026-10-25.json). All audits report advisories;
  production reachability and patches remain open. No dependency versions were changed.
- Replaced the stale MVP narrative with explicit acceptance gates; refreshed roadmap dates and
  evidence definitions. Corrected registration-trunk support and OS/architecture/proof claims
  in the repository README and public-site copy.
- Corrected hardware instructions: conditional account provisioning, expected digest challenge,
  carrier-originated forwarding gap, current amd64 scope, postflight failure handling and restore
  ordering. Cloud provisioning examples are not a current provider-capacity guarantee.
- Corrected portal guide API paths and the claim that all fixtures are absent from production.
  Vite middleware/controls are dev-only; unsupported-screen seed fallbacks remain a real issue.
- Updated CLAUDE and test documentation pointers. Corrected CLAUDE's obsolete single-provider
  DNS description without changing its engineering invariants.
- Updated site navigation for the status/issue/change records. Link rewriting now distinguishes
  published docs from repository-only research/review files and non-Markdown artifacts.
- Added `tests/docs-links.py` to check local Markdown targets and generated HTML links/anchors.
  Run `python3 tests/docs-links.py --site-dir site/dist` after the site build.
- Added the [MVP delivery plan](mvp-plan.md): milestones M0–M7, owner decisions D1–D8 and
  gate-to-issue traceability. It sequences existing issues; it does not change their status.

### Moves and deletions

Every removed source path below is recoverable from Git at `eca43d7`. Moves retain useful
content, with relative links updated; earlier source paths inside historical prose describe
the original review. No whole source/design/asset folder was proven obsolete and removed.

| Removed path / content | Action and reason | Replacement |
|---|---|---|
| Root `CHANGELOG.md` | Moved so ongoing changes/deletions are tracked in `docs/`; earlier entries retained below | `docs/changelog.md` |
| Root `REVIEW-PLAN.md` | Moved and marked historical; its original failure descriptions must not override current fixes | `docs/reviews/2026-10-24.md`; current `docs/issues.md` |
| `docs/comprehensive-implementation-plan.md` | Moved from current status docs to future design | `docs/design/implementation-plan.md` |
| That plan's old pre-phase patch recipes (§1) | Removed contradictory/unsafe instructions, including fabricated forwarding identity and a fixed-list emergency bypass; preserved issue mapping and closure requirements | `docs/issues.md` and design §1 mapping |
| `docs/missing-features-implementation.md` | Deleted duplicate executive/engineering summary, avoiding a second feature specification | `docs/roadmap.md` and `docs/design/implementation-plan.md` |
| `docs/reference.md` | Moved to research; marked historical/unpinned where appropriate instead of claiming a current verified comparison | `docs/research/reference-platforms.md`; pinned FusionPBX research retained |
| Old MVP completed-item/session narrative | Replaced stale chronology and broad compliance assertions with explicit evidence boundaries and release gates | `docs/mvp.md`, `docs/status.md`; original text in Git at `eca43d7` |
| Disposable DB `qwixbox_docs_review_20261025` | Created for this pass, schema applied, 19 security tests run, then dropped | No repository artifact; results in `docs/status.md` |

Design/mobile reference assets, v1 provenance, pinned research, runtime templates, dependency
lockfiles and the skills manifest are retained: age or absence from runtime imports does not
make design/provenance/tooling material obsolete. Generated build output remains Git-ignored.

### Verification and limitations

API typecheck/format plus 22 API tests pass (80 assertions); five portal client/mock tests pass
(53 assertions). Real Kamailio passes 18 cases; Debian installer harness passes seven groups;
shell/Lua syntax, warning-level ShellCheck and the synthetic Lua IVR case pass. Portal typecheck,
lint and build and eight Worker cases/site build pass. Repository/generated documentation links
and `git diff --check` pass. Installed local dependencies were reused; this was not a clean
dependency installation. Dependency audits return exit 1 with unresolved advisories.

Remote audio, restore, emergency behavior, full current amd64 installation and service/projection
failure recovery remain unverified. Those gates were not closed by this review.

## Earlier change records

Entries below preserve the 2026-10-24 record. Their “current” descriptions and root document
names are historical. In particular, the mock-controls exclusion did not exclude the separate
production seed fallback introduced in the next commit; I01 records the present behavior.

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
