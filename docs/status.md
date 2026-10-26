# Project status

Last reviewed **2026-10-25**. Source baseline: **`eca43d7`** (clean working tree at review start).
Scope: installer/helpers/templates, API/auth/schema/projections, Lua/SIP/media configuration,
portal/mock mode, public site/bootstrap, documentation and dependency advisories. This was a
source review with regression checks, not an exhaustive security audit or production acceptance test.

**QwixBox remains pre-MVP.** Current regression checks pass, but remote two-way audio, restore,
emergency behavior and a full current amd64 install remain unproven. See [active issues](issues.md) and [MVP gates](mvp.md).

## Current implementation

| Area | Current state | Evidence boundary |
|---|---|---|
| Installer | 28 ordered steps; source/template hashes, dependent invalidation, locked portal installs and first-login recovery | Safety harness passes; no complete install/rebuild/re-run in this review |
| API/auth | Tenant-scoped CRUD, live membership roles, serialized owner mutations, expected HTTP errors, encrypted credentials | 19 integration tests pass against PostgreSQL 17; sessions, Redis and ESL are mocked |
| SIP authentication | HA1/HA1b projection and `calculate_ha1=0` | Real Kamailio 6.0.1 passes 12 two-tenant credential cases plus six destination-policy cases |
| Telephony | Extensions, exact DIDs, IP trunks, outbound PCRE routes, ring groups, IVR, schedules and feature codes have source implementations | Older records report signalling tests; current media/carrier call matrix was not run |
| Media / WebRTC | rtpengine and WSS configured; no browser phone in production (the simulation is mock-only, I23) | Two-way remote audio and browser SIP remain unverified |
| Emergency | Emergency outbound route classification and egress bypass; location schema exists | Ingress cap precedes classification; location/notifications have no backend workflow |
| Portal | Live extensions, trunks, routing, call flows, CDR, faxes, users, audit and settings; preview screens report "Not available on this server"; unenforced settings are refused by the API and disabled in the UI | Typecheck/lint/build pass; fixture fallback removed and build-guarded (I01); invented capability claims removed (I22); simulated webphone confined to mock mode and build-guarded (I23) |
| Local mock | Vite-only middleware, synthetic auth/roles, editable fixture collections | Four mock tests and one real client URL test pass; not evidence of backend enforcement |
| Backup / operations | Required config archive, failure-safe retention, timers, host metrics | Safety harness passes; restore, offsite failure injection and human alert delivery remain open |
| Site / bootstrap | Static Astro site, Worker routing, immutable generated installer ref | Eight Worker checks, build and bootstrap-artifact check pass; no publication or fresh-host release install |
| Dependencies | In-range patches applied (I15): portal audit clean; API and site residuals are build/deploy tooling only | [Before](reviews/dependencies-2026-10-25.json), [after](reviews/dependencies-2026-10-25-patched.json), triage in [issues](issues.md#dependency-interpretation); Astro 7 not yet adopted; no exploit reproduction |

Configured versions are not runtime proof. The installer defaults to PostgreSQL 18; API fixtures
here used PostgreSQL 17. The SIP fixture uses Kamailio 6.0.1, not a certification of the installed
target version. Historical FreeSWITCH builds covered both architectures, but the complete current
stack has not been accepted on amd64. Ubuntu is accepted by preflight; current Ubuntu validation
is absent. Capacity figures in older prose are estimates, not benchmarks.

## Verification on 2026-10-25

Host checks ran on macOS arm64 using existing installed dependencies; Linux checks used the
existing disposable Debian 13 arm64 review container. No application or production database was
used: API tests ran in newly created `qwixbox_docs_review_20261025`, then that database was removed.
The dedicated synthetic `qwixbox_sip_test` fixture was reloaded for the SIP harness.

| Check | Result |
|---|---|
| API `bun run typecheck`, `bun run format:check` | Pass |
| API `bun test tests/validation.test.ts` | 3 tests, 13 assertions pass |
| API `bun test tests/security.test.ts` | 19 tests, 67 assertions pass; assembled app with mocked sessions/Redis/ESL |
| Root `bun test tests/portal-client.test.ts tests/portal-mock.test.ts` | 5 tests, 53 assertions pass |
| I01 follow-up: same command after the fix | 19 tests, 84 assertions pass; production bundle has no fixture records; guard fails a build that imports `mock/` |
| M1 item 2: API `security`+`validation` against disposable PostgreSQL 17 (`qwixbox_m1_test_20261025`) | 25 tests, 114 assertions pass; refusals reproduced as 200s before the fix |
| M1 item 2: portal client/mock tests; Debian `installer-safety.py`; ShellCheck over installer, helpers and steps | 20 tests / 86 assertions pass; 8 harness groups pass (new: STIR signing readiness); clean |
| I23: portal client/mock tests, typecheck/lint/build; non-mock browser pass | 20 tests / 86 assertions pass; no keypad, mobile Keypad tab or click-to-call; bundle has no simulation strings; guard fails a build importing the drawer |
| I21: Debian `python3 tests/nginx-auth-limits.py`; API `security`+`validation` | Reproduced 34/40 routine auth reads refused (503) before; after, 4 checks pass and the harness fails when `change-password` is allowlisted. 26 tests / 116 assertions; reset-rule test fails on the old `/forget-password` rule |
| I16: `db:push --force` from the old schema with an `apikey` row, stdin closed | Table dropped without a prompt, users kept, repeat push "No changes detected"; API 26 tests, typecheck, format, frozen install pass |
| R06: API `security`+`validation`; upgrade from the committed schema; API boot | 28 tests / 141 assertions; before, disabling with Kamailio down returned 500 and left the subscriber; after, it converges once dependencies return; removing the `requested` guard fails the mid-run test. Upgrade: `apikey` dropped, `projection_job` created, no prompt. Boot drained a queued job. Banner checked in mock mode |
| R13: API `cache-publish` on real Redis 7; `security`+`validation` | Baseline delete-then-set: 260/4,281 reads missing; `publishGeneration`: 0 missing, 0 mixed in 2,001 reads over 200 publishes. 30 tests / 151 assertions; both new R13 tests fail under the old behaviour. API booted against real Redis and warmed 2 tenants |
| I04: API `security`, `cache-publish`, `validation` (each its own run); portal mock tests, typecheck/lint/build; mock browser pass | Reproduced: a reused 101 inherited a DID in the warm tier, cold tier resolved nothing. After: 28 + 3 + 4 tests pass; both I04 tests fail with the check disabled, the self-reference test fails without its exclusion. Root portal tests 22 / 96 assertions; deleting a referenced extension shows the 409 reasons and keeps the row |
| I19: API `security`, `validation`, `cache-publish` (each its own run); root portal tests; portal typecheck/lint/build; step 41 `bash -n` + ShellCheck in Debian | Reproduced: shared 600 went to the IVR warm and the ring group cold. After: 31 + 5 + 3 API tests, root portal 23. Removing a registry entry, the claim, the lock (3/3 runs) or the cache order each fails its test. Duplicate audit printed a seeded duplicate and exited 0 |
| M2 exit (gate 7): fresh arm64 systemd install of steps 00-01, 20-22, 30-32, 34-35, 40-41, 44 (2 CPU / 1.4 GB); `tests/gate7-convergence.py` | Install exposed I26 (Kamailio could not start); fixed. Harness 14/14: a disable committed with Redis stopped and the `kamailio` role refused, survived an API restart, and converged 1.1s after recovery; then warm, cold, FreeSWITCH (`xml_flush_cache` each time) and Kamailio subscriber all refused and REGISTER got 401. 0 missing in 130 Redis reads and 0 misses in 126 FreeSWITCH lookups across 50 rebuilds. Redis restart: cold tier covered, watchdog refilled in 55.7s. API stopped: warm tier answered. With the projection worker disabled the harness fails (disabled extension still registers, 200). FreeSWITCH log: 0 `[ERR]`/`[CRIT]` |
| I03 + I27: API `security` (33), `validation`, `cache-publish`; root portal mock tests; portal typecheck/lint/build; `luac -p`; arm64 full install, `tests/outbound-callerid.py` | The harness first exposed I27: every authenticated call through Kamailio died `NO_ROUTE_DESTINATION`, because the tiers answered in `tenant_<org>` while the call sat in `default`. After the fix: 6/6, with digest-authenticated INVITEs through Kamailio to a fake carrier, each case with only the warm tier (API stopped) and only the cold tier (Redis stopped). The carrier saw the tenant default, then the extension's caller ID, then the route override. Breaking the Lua caller-ID actions failed the three warm cases (the carrier saw `6315`). Also found I28 (loopback is trusted without auth) and I29 (Kamailio needed a restart after its DB backends were terminated) |
| R11 + I30: API `security` (35), `validation`, `cache-publish`; root portal tests; `luac -p`; arm64 full install, `tests/forwarding.py`, `tests/outbound-callerid.py` | Forwarding harness 7/7 with a fake carrier that is both trusted peer and trunk. Direct dial from the peer refused (480, nothing sent out). DID → external presents the tenant. DID → extension → external, and a two-extension chain, present the forwarding extension. A loop ends 483 at `MAX_DEPTH`. A no-answer forward reaches the carrier. With the API stopped mid-ring: 5xx, tone, nothing sent out. Breaks: without the forward variables 2/7 (the original 404s); without the health check D5 fails. The first run of the break check exposed I30: a refused reload passed as success, and the carrier got 407. After the fix the back-to-back run passed with two logged retries. I03 harness still 6/6 |
| Debian `python3 tests/installer-safety.py` | 7 harness groups pass with host services stubbed |
| Debian `python3 tests/sip-auth.py` | 18 real Kamailio/PostgreSQL cases pass; isolated loopback listener |
| Shell `bash -n`, ShellCheck `--severity=warning`; Lua `luac -p` | Pass for installer/helpers/steps, executable templates and call-time scripts |
| Debian `lua tests/ivr-choice.lua /work` | Pass; synthetic session dispatches `#` |
| Portal `bun run typecheck`, `bun run lint`, `bun run build` | Pass |
| Site `npm test`, `npm run build` | 8 Worker cases and bootstrap artifact check pass |
| Dependency audits (baseline) | All return exit 1 with advisories; API 3 package groups, portal 7, site 15 |
| I15: audits after in-range patching | API 1 (esbuild, deploy tooling), portal 0, site 6 (Astro major, wrangler tooling); API 25 tests / 114 assertions, portal 20 / 86, typecheck/lint/format/build, site tests and build, frozen installs pass |
| Documentation / diff checks | Local Markdown targets, generated site links/anchors and `git diff --check` pass |

The SIP harness initially failed because Docker's default bridge did not resolve the database
container name. Re-running against its inspected bridge IP passed. No product change was needed.
Checks above do not establish two-way audio, audible DTMF, fax delivery, STIR signing, remote SSH,
atomic cache/projection recovery, upgrades on existing customer data or restore.

## Next work

The [MVP delivery plan](mvp-plan.md) sequences this work into milestones with owner decisions.

1. M2 items 1 to 4 are done (R06 durable outbox, R13 atomic cache publication, I04 referenced
   destinations cannot be deleted, I19 one dialable-number namespace). The M2 exit check passed on
   arm64 (gate 7 harness 14/14) and found I26, now fixed. amd64 and call-level checks are owed (M7).
   M3 item 1 is done: outbound caller ID (I03). Verifying it found I27, now fixed: no endpoint call
   had ever been routed. That fix makes the first real calls through Kamailio possible.
   M3 item 2 is done: authorized forwarding of carrier calls (R11, D5). It found I30 (refused
   Kamailio reloads were reported as success), now fixed.
   M1 code work is done: fixture fallbacks (I01), unenforced settings (I07 controls), static
   claims (I22), simulated webphone (I23), dependency advisories (I15, residuals accepted), the
   auth limiter split (I21) and the unused api-key dependency (I16). Its exit check on a deployed
   portal is still owed.
2. Close durable projection/revocation, emergency capacity, peer forwarding and cache publication
   gaps (R08 in [issues](issues.md); R06, R11 and R13 are fixed and owe service-level checks).
3. Fix postflight policy/setup drift and ring-group/concurrency behavior; test actual services.
4. Execute [MVP acceptance](mvp.md): remote audio, voicemail/IVR/fax, trusted carrier flows,
   emergency test-provider scenarios, restore and current amd64 installation.

No runtime bug listed here is marked fixed by this documentation cleanup. Changes and deletions
are recorded in the [change log](changelog.md).
