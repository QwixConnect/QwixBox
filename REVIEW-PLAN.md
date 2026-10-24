# QwixBox code review and remediation plan

Reviewed 2026-10-24 against the **current working tree**, including existing uncommitted fixes.
Git baseline: `1fb0bf0`. Scope: API/auth/database, portal, Lua, Kamailio, installer, backups,
site packaging, and existing review/MVP documents. Remediation began 2026-10-24 and is tracked
in Git alongside the local mock portal. No production deployment has been performed.

The validated findings and execution order below replace the obsolete historical proposal. “Implemented” means present in the inspected code, not proven in production.
P0 = critical authentication exposure; P1 = security, call availability or recovery risk;
P2 = functional/operational gap. Evidence locations refer to this review's working tree.

## Remediation status (2026-10-24)

| Items | Current result | Remaining verification |
|---|---|---|
| R01 | Fixed; live SIP regression passes 12 credential cases and reproduces old empty-password acceptance. | Full installed-stack/NAT/audio and target Kamailio-version pass. |
| R02–R04 | Restricted secret files, preserved/reapplied hardening, root-key policy fixed. Unrelated-user secret-read and installer harness checks pass. | Full service rebuild/restart and external SSH login. |
| R05 | Unique exact-DID index and pre-upgrade inventory added; concurrent claims yield one 201 and one 409. | Upgrade against an existing duplicate inventory, with explicit owner resolution. |
| R07 | Required config/archive/offsite failures prevent success/retention; DKIM/TLS/runtime config included. Harness failure/success checks pass. | Full restore and offsite failure-injection check. |
| R08 | Prefix bypass fixed; six live SIP destination-policy checks pass. | Configured tenant/extension limits and atomic pending-call reservations are still open. |
| R09/R12/R14 | Shared tenant validation, production HTTP errors and cached signing setting fixed; API tests pass. | Live STIR signing verification. |
| R10 | Unsupported enabled registration trunks rejected/excluded by both XML tiers; API tests pass. | Real registration remains unavailable, deliberately. |
| R13 | Legacy routes quarantined; unrelated call state rebuilds; warmer isolates tenant failures and refreshes contracts on startup. | Atomic cache generation publication remains open. |
| R15–R17 | IVR # client/Lua regression passes, portal errors visible, CDR attribution is tenant-scoped and tested. | Browser failure/retry checks, real DTMF/media and full CDR call matrix. |
| R18/R19 | Transactional/idempotent provisioning, safe CLI arguments, first-login recovery and source hashing tests pass. | Full deployment/re-run on systemd/target host. |
| R20 | Site tests/build and real bootstrap-artifact check pass; truncated execution and pinning covered. | Install the published release on a fresh host; no publication performed here. |
| R06/R11 | Open. | Durable side-effect reconciliation; secure peer-originated forwarding and inbound API-outage policy. |

Removed files and their replacements are recorded in CHANGELOG.md. Design notes under docs/design
remain future reference; they are not descriptions of implemented features.

The findings below record the original failure and acceptance gate. Current implementation and
verification status is reported above.

## Validated security and reliability findings

| ID | Priority | Evidence and failure | Required change and acceptance check |
|---|---|---|---|
| R01 | **P0** | `resources/conf/kamailio/kamailio.cfg:163` enables `calculate_ha1` and reads `password`; `portal/api/src/services/kamailio-sync.ts:61` deliberately writes an empty password and separate HA1 digests. Kamailio therefore hashes the empty plaintext value instead of checking the provisioned digest. This predicts rejection of real credentials and acceptance of a correctly formed empty-password digest. Confirmed configuration/source mismatch; live exploit not attempted. | Set `calculate_ha1=0`, `password_column=ha1`, and the domain-qualified column to `ha1b`. In an isolated Kamailio instance, test REGISTER and INVITE with valid, wrong and empty passwords, for two tenants with the same extension number. Empty passwords must fail. |
| R02 | **P1** | `steps/31-freeswitch-config.sh:30` installs ESL credentials as 0644; lines 65–66 install a 0644 systemd drop-in containing the gateway secret and an unused API DB DSN (`resources/conf/freeswitch/systemd-env.conf:6`). Local users can read service credentials. | Restrict credential files and remove unused DSN. Verify file access as an unrelated unprivileged account and successful service restart. Keep required FreeSWITCH access when changing ownership. |
| R03 | **P1** | `steps/30-freeswitch.sh:130` replaces the hardened config with the stock minimal tree. `install.sh:314` then skips unchanged step 31 because its marker still matches. Re-running step 11 similarly removes step 14's firewall additions. | Add dependent-step invalidation and restoration before declaring the installation healthy. Force step 30, resume normally, and verify loopback ESL, generated password, ACLs and module order; repeat the dependency check for steps 11/14. |
| R04 | **P1** | `steps/10-ssh-hardening.sh:15` counts root's authorized keys but later sets `PermitRootLogin no`. A root-only cloud installation can lose its only usable SSH login. | Preserve root public-key access until a verified non-root sudo account exists. Test root-only and non-root-key hosts, validate `sshd -t`, and establish a second login before closing the first. |
| R05 | **P1** | `portal/api/src/db/schema.ts:258` has a nonunique DID index; inbound-route writes do not enforce ownership. `routes/fs-xml.ts:129` refuses multiple matches. Another tenant can create the same DID and make an existing number unroutable. | Inventory and resolve duplicates before a unique exact-DID constraint. Enforce canonical number ownership on create/PATCH, map DB conflicts to 409, and test concurrent cross-tenant writes. Choose explicit shared-number semantics before allowing exceptions. |
| R06 | **P1** | `portal/api/src/lib/crud.ts:133` persists before its projection/cache hook. If Kamailio/Redis fails during a disable/delete, DB state changes while old trust or call state may remain live. The request fails, but reconciliation is not durably queued; `reloadKamailio()` returning false is also not enforced by all callers. | Record projection work durably with the mutation, retry it, expose pending/failed state and prioritize revocations. Test DB success followed by projection failure, restart, retry and actual Kamailio memory-state convergence. A SQL transaction alone cannot atomically update Postgres, Redis and Kamailio. |
| R07 | **P1** | `resources/conf/backups/qwixbox-backup:29` ignores failed config reads/tar failure. `fail` can remain zero and retention at line 48 deletes old backups although the encryption-key config is absent. | Treat required config/archive validation failures as backup failure, retain previous good copies, include DKIM keys, and verify offsite settings reach the timer environment. Restore databases **and** the matching encryption key in a fresh host and decrypt an existing SIP secret. |
| R08 | **P1** | `kamailio.cfg:646` uses a prefix requiring a zero: the high-risk filter matches `00252...` but misses `+252...` and `+88213...`, which the API allows. Tenant/extension call limits are stored, while the edge still uses the constant 10 and counts established dialogs only. | Normalize international formats before risk checks; test every allowed presentation and translated number. Project configured limits and reserve capacity atomically for pending calls as well as established calls; test concurrent attempts, cancellation and restart. |
| R09 | **P1** | `portal/api/src/routes/tenants.ts:62` inserts caller-ID settings without the shared dialplan validation used by PATCH. A member of an unprovisioned organization with admin/owner rights can persist `${...}` strings that later reach directory variables. | Apply one runtime schema to tenant create and PATCH, including caller ID, bounds and timezone. Test unsafe values through both public writers; XML escaping does not prevent FreeSWITCH variable expansion. |

R01's authentication interpretation was checked against [Kamailio 6.0 auth_db source](https://github.com/kamailio/kamailio/blob/6.0/src/modules/auth_db/authorize.c):
`get_ha1` calculates a digest from the selected plaintext column when `calc_ha1` is enabled.
The source has no empty-string rejection in that branch. Treat the current repository
configuration as a release blocker even though older documents report successful registration;
that historical result does not establish the behavior of this template.

## Validated functional gaps

| ID | Priority | Evidence / current behavior | Fix and proof |
|---|---|---|---|
| R10 | P1 | `routes/telephony.ts:140` accepts register-mode trunks, but there is no `uac_reg` projection or carrier 401/407 authentication path. Loading `uac.so` alone does not implement them. | Reject unavailable mode with an explicit API/UI message until registration, challenge handling, secret updates and deregistration work. Verify with a test registrar, then the intended carrier. |
| R11 | P1 | `resources/lua/xml_handler.lua:193` always declines trusted-peer calls to the API; `qwixbox.go` handles external forwarding by transfer, retaining the peer identity. Subsequent XML lookup remains DID-only (API `fs-xml.ts:124`), so carrier-originated DID→external/extension-forward-to-external cannot follow an ordinary outbound route. Peer DIDs also require the API even with warm Redis. | Add a tenant-scoped, server-authorized forwarding context without granting peers arbitrary outbound access. Test DID→external, DID→extension→forwarding, loop limits, and direct peer dialing denial. Decide whether inbound service must survive an API outage; if so, implement an ownership-safe global DID cache and removal path. |
| R12 | P2 | `portal/api/src/index.ts:90` returns 500 for every thrown error, including the membership service's intended 400/403/409 `HTTPException`s. Router-only security fixtures omit this handler. | Preserve expected HTTP errors and test the assembled production app. Refused owner changes must return the intended status and leave membership unchanged. |
| R13 | P2 | `services/cache.ts:330` purges tenant caches before rebuilding; `cacheRouteTable` at line 162 throws for legacy patterns before directories/call flows rebuild. `index.ts:97` stops the remaining tenants at the first error. | Keep legacy routes quarantined pending explicit PCRE review, but isolate tenant failures and publish cache generations safely. Verify healthy tenants/internal calling remain available and the warm sentinel is set only after the required work succeeds. |
| R14 | P2 | `cacheTenantSettings` at `services/cache.ts:234` omits `stirShakenEnabled`, while warm Lua reads it (`xml_handler.lua:157`). The API fallback reads the DB field, so signing behavior differs between tiers. | Include the setting in the cache contract and test both XML tiers with signing enabled/disabled, followed by a real signing verification. Emergency bypass currently skips the normal signing branch too; define and test that behavior. |
| R15 | P2 | `portal/web/src/lib/api.ts:407` interpolates IVR digits into URLs. For `#`, the browser sends `/options/` and discards the fragment. Lua IVR also uses `#` as the digit terminator while the API/UI offer it as a choice. | Encode URL path segments and make terminator/choice behavior consistent. Verify saving, deleting and actually selecting `#` with DTMF. |
| R16 | P2 | `portal/web/src/routes/_app.tsx:186` renders no content when organization selection errors. Destination pickers, call-flow panels and dashboard still have failure-as-empty states; extension-toggle failures lack feedback. | Provide visible loading/error/retry states, success-gated empty states and mutation errors. Exercise failed tenant selection and failed list/toggle requests. |
| R17 | P2 | `services/cdr.ts:90` resolves a gateway name, while current outbound builders send `X-Trunk-ID` over `sofia/external`. Trunk attribution can be empty. | Parse trusted trunk identity and verify it belongs to the attributed tenant. Assert direction, extension and trunk on internal, inbound, outbound and forwarded CDRs. |
| R18 | P2 | `cli/provision-tenant.ts:40` rejects a repeat of its own domain before resolving the requested org; its upsert at line 88 can change an existing org's domain. Step 44 writes first-login only after provisioning succeeds and shell-interpolates names/emails (e.g. `O'Brien`). | Make identical provisioning a no-op and refuse domain changes. Pass CLI arguments safely and persist generated credentials securely before dependent provisioning. Test partial failure, restart and apostrophes; passwords must stay unchanged and out of logs. |
| R19 | P2 | `install.sh:175` hashes all dependency-directory files, including `node_modules`, local `.env` and build output. Step 41 now declares the API directory; step 43 still omits portal source. | Define explicit source inputs/exclusions for Git and release archives, including intended new source files. API/web source changes must redeploy; dependency-cache/build artifacts must not trigger a redeploy. |
| R20 | P2 | `site/package.json:6` copies into a missing `public/` directory on a clean checkout; deploy/preview invoke Astro directly and skip prebuild. `bootstrap.sh:6` follows mutable main, is executed incrementally from a pipe, and does not reattach a terminal. Worker tests mock the asset rather than verifying it exists. | Create the output directory, build through the package script, embed a reviewed immutable ref, wrap bootstrap execution in `main`, and restore TTY input when present. Build a clean artifact and request its real bootstrap asset; test truncated downloads and interactive install. |

## Validation of the previous review (baseline before remediation)

| Previous workstream | Validated baseline | Follow-up |
|---|---|---|
| W1.1–1.2 SIP identity / peer boundary | Header stripping, stamped identity and API DID-only peer lookup implemented; not tested against a live SIP edge here. | Adversarial SIP tests plus R01/R11. Preserve the distinction between a peer's arbitrary request and an authorized tenant forwarding action. |
| W1.3 global DIDs | Partial: exact numbers and unambiguous API lookup exist; uniqueness/global cache do not. | R05 and the availability decision in R11. A new global index needs ownership-aware deletion; it cannot safely be purged with a domain wildcard. |
| W1.4–1.7 validation / trust | IP trust replacement is transactional; field safety, ESL guards, XML escaping, JSON encoding, feature/fax identity checks exist. | R06/R09 and live attack/round-trip tests. JSON over mod_curl still needs a real spaces/quotes/Unicode round trip. |
| W1.8–1.9 fraud / tenant administration | Auth failure counting and log text exist; tenant PATCH restrictions and serialized membership service exist. | R08/R12; prove ban/reload behavior against services. |
| W1.10–1.11 secrets / credentials | Timing-safe API secret checks, fax path containment, disable cleanup, SIP password minimums and PIN validation are present. Invitation URLs are no longer logged; audit uses x-real-ip. | R01/R02, PostgreSQL statement-log suppression, fax spool permissions, live credential revocation. |
| W2 call paths | PCRE helper, pattern audit, disabled-trunk filtering, DID purge, ring-group refresh/shuffle, queue rejection, restrictive trunk FK, shared directory rendering, depth propagation and token-owned warm lock exist. | R05/R11/R13/R14; collision tests and full call-path parity. No blanket “W2 done” claim. |
| W3 stored-but-unused features | Mostly open: configured call limits, carrier registration, outbound WebRTC SDP selection, dispatcher selection, recording policy and egress mode are not fully wired. DB host template and preserving the carrier failure handler are fixed. | R08/R10/R14; define scope for unsupported features. There is still no alternate-carrier retry: the current failure route logs/cleans up. TLS reload and RTP allocation checks remain. |
| W4 portal/API | Date upper bound, API TypeScript dependency, locked deploy dependencies, fax notification setting/header encoding and custom Users mutation routes exist. | R12/R15–R18, portal error states, exact-DID form labels/examples. |
| W5 installer | Mostly open. API inputs now declared, but recursive hashing includes generated files. | R02–R04/R07/R18/R19 plus wizard, DNS, mail, permissions and postflight items below. |
| W6 site/bootstrap | Open; existing Worker unit tests pass but do not prove complete deploy output. | R20 and published-doc link checks. |
| W7 docs | Open. README contains contradictory old/new account instructions; CLAUDE says no tests; docs/mvp.md is dated 2026-08-01. | Reconcile after behavior is verified, retaining dates/platform and separating historical proof from new claims. |

Corrections to the earlier prescriptions:

- **Membership:** retain the custom serialized service and blocked better-auth mutation paths.
  Simply adding the plugin's default statements would bypass this design. Test all owner
  mutation paths and the actual production error handler.
- **Voicemail:** the implemented destination contract is a tenant-owned **mailbox number**,
  consistently used by the picker, validator and Lua. Do not replace it with a UUID as an
  incidental fix. Extension destinations still use extension IDs and resolve to numbers.
- **Recording:** schema/UI values are `none`, `inbound`, `outbound`, `all`; the earlier proposed
  `always` branch would never execute. Define recording paths, access and retention alongside
  the actual policy values.
- **Carrier failover:** preserving `MANAGE_CARRIER_FAILOVER` is implemented; alternate carrier
  selection is not. Decide whether retry belongs in FreeSWITCH, where original dialed digits
  and ordered routes are available. Do not treat the handler's name as implemented failover.
- **Checks:** use `format:check` during review. `format` rewrites source and is not a read-only
  verification step. Keep this review at the root because the site publishes `docs/*.md`.

## Execution plan and completion gates

1. **Repair authentication and deployment safety first:** R01–R04 and R09. Close each with
   negative runtime tests. Keep credential permission changes separate from secret rotation;
   preserve generated secrets on ordinary re-runs.
2. **Make ownership and revocation reliable:** R05–R08. Resolve existing duplicate DIDs before
   adding constraints. Add durable reconciliation and observable failures. Prove restore before
   trusting backup retention. Include all added schema changes in an upgrade/rollback plan;
   current `db:push --force` is not a safe substitute for reviewed destructive migrations.
3. **Restore call-path parity:** R10/R11/R13/R14/R17. Audit legacy patterns before publication,
   explicitly convert intended matches to PCRE, and preserve fail-closed outbound behavior.
   Test the same call scenarios with warm Redis, empty Redis and API unavailable. The new
   `m:~` regex delimiter is supported by [FreeSWITCH 1.11.1's regex implementation](https://github.com/signalwire/freeswitch/blob/v1.11.1/src/mod/applications/mod_commands/mod_commands.c);
   actual engine behavior, alternation and false-string handling still need integration checks.
4. **Close portal/operator gaps:** R12/R15/R16/R18/R19. Verify viewers cannot write, members
   cannot change trunks, admins cannot grant owner, concurrent owner demotions preserve an
   owner, and cross-tenant IDs fail. Test real Users flows through the assembled app.
5. **Finish remaining installer/site backlog:** R20 plus wizard entry before logging redirection,
   TTY restoration, `set -e` return handling, correct DNS-mode resolution/nonfatal publication,
   DNS-01 renewal preservation, implicit mail sender, SMTP TLS mode, shared fax-spool group,
   IPv6 admin CIDRs, portal-only Redis defaults and role-aware always-run postflight. Keep
   `step-inputs` accurate. Track remaining supporting tasks in the status section below.
6. **Reconcile docs and release evidence:** remove stale setup SQL/registration instructions,
   update account/step tables, explain exact DIDs and PCRE, publish only verified provider/OS
   claims, and record unsupported features. Close MVP claims only after two-way remote audio,
   voicemail recording/delivery, IVR DTMF, fax, carrier flows, emergency configuration/notification,
   restore and an amd64 install pass. Record results rather than repeating legal claims from
   old docs without a separate jurisdiction-specific review.

Use one focused change per independently verifiable boundary. Each change should record:
finding ID, affected files, upgrade/data handling, automated checks, runtime evidence, remaining
limitations and rollback. Keep implementation fixes and their evidence in sync with this plan.
There is no acceptance gate requiring all optional W3 product features to be built: reject or
clearly disable unsupported modes until their behavior is implemented and verified.

## Verification record

Review baseline (before this remediation): API typecheck, 15 API tests, 8 Worker tests,
Lua/shell syntax passed. API formatting and ShellCheck had findings; no full PBX test was run.

Remediation evidence (2026-10-24):

- Live Kamailio 6.0.1 + dedicated PostgreSQL fixture: 12 authentication cases and six risk-prefix
  cases pass. Old settings reproduce valid-password rejection and empty-password acceptance.
- API: typecheck and formatting pass; 19 security tests (67 assertions) and three validation
  tests (13 assertions) pass. Security tests import the production app;
  session lookup, Redis operations and ESL flush remain mocked. Database constraints and
  concurrency use the disposable PostgreSQL fixture.
- Installer harness: source-hash exclusions, dependent-marker invalidation, CLI argument
  boundaries, runtime secret permissions, root-key/no-key SSH policies, backup failure retention
  and first-login failure/resume are checked using actual scripts and temporary files.
- IVR: the client test passes four URL assertions; the actual Lua script dispatches # without consuming it as a terminator; the actual
  client endpoint builder sends %23 for both save and delete.
- Portal: typecheck, lint and production build pass. Site: eight Worker tests and production build
  pass, including generated immutable bootstrap asset presence and published-doc link rewriting.
  A scan of the built docs confirms all internal /docs/ links resolve and the retired portal
  delivery page is absent.
- Shell/Lua syntax pass; ShellCheck at warning severity is clean. API formatting normalized.
- Full PBX install/rebuild, SSH access from outside, two-way audio, carrier flows, STIR signing,
  atomic projection recovery and restore have **not** been certified by these checks.

## Supporting tasks still open

- Configured fraud limits; alternate carrier retry, dispatcher/media pool
  selection, outbound WebRTC SDP handling, and coordinated RTP port allocation.
- Recording policy (`none/inbound/outbound/all`) and egress mode need implementation or explicit
  unavailability; emergency location and notification, voicemail management remain open.
- DNS mode/failure handling, DNS-01 renewal config, SMTP TLS options, IPv6 admin CIDRs,
  portal-only Redis defaults and role-aware postflight checks. Wizard startup/menu handling and
  always-run postflight have source fixes; full TTY/systemd checks remain.
- Protect PostgreSQL role-password statements from SQL statement logging; verify certificate
  reload output; narrow nginx auth rate limiting to credential/reset endpoints.
- Published-release installation, full-site link validation and remaining setup-document drift.
  The site packaging/bootstrap version fixes are implemented.
- Full Debian/amd64 install, idempotent rerun, failure recovery, media, carrier and restore evidence.

## Next implementation batch

1. R06: transactional durable projection work with restart-safe retry, revocation priority and
   visible pending/failed state. Inject Redis/Kamailio/reload failures after DB success.
2. R08: project tenant/extension limits and reserve capacity before answer; prove concurrent
   calls/cancellation/restart and emergency behavior under saturation.
3. R11: authorize tenant-controlled forwarding continuations while keeping direct peers DID-only;
   decide and test inbound service behavior during API loss.
4. R13: publish coherent cache generations without deleting the last usable state before a
   successful rebuild; include concurrency/failure tests with real Redis.
5. Complete the service upgrade, restore and media/carrier acceptance gates for this batch,
   then close the remaining DNS/mail/role-specific installer tasks.
