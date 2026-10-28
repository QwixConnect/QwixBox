# MVP delivery plan

Drafted **2026-10-25** against `eca43d7`. This plan orders the work needed to pass the eight
[MVP acceptance gates](mvp.md). It is a sequencing and closure plan, not a feature design:
detailed designs stay in [design/implementation-plan.md](design/implementation-plan.md), findings
and their closure checks stay in [issues](issues.md), and verified results go in [status](status.md).
When this plan and the code disagree, the code wins and this plan is corrected.

A gate passes only with recorded evidence: revision, platform, procedure and observed result.
Typecheck, lint, build and mocked integration tests are necessary but never sufficient. Each
control is proven by trying to break it before the fix and again after it, per [CLAUDE.md](../CLAUDE.md).

## Shape of the plan

```
M0 Test foundations + early audio spike ─┬─> M1 Truthful production surface ──────────┐
                                         ├─> M2 Consistent published state ─┐        │
                                         │                                  ├─> M3 Call-path correctness
                                         │                                  └─> M4 Emergency behavior
                                         └─> M5 Installer and operations ───> M6 Restore
                                                                                      │
                     all of the above ───> M7 Release-candidate acceptance campaign <─┘
```

M1, M2 and M5 can run in parallel once M0 has started. M3 and M4 build on M2's durable
projection, because every call-path fix publishes state the same way. M7 runs the full matrix
once, against one frozen revision.

The largest unknown is media. No retained evidence shows two-way audio, and the shared
FreeSWITCH/rtpengine RTP range (I18) could force a configuration change that touches every later
test. For that reason a **gate 1 smoke test runs in M0, not at the end**.

## Decisions needed before or during M0

These are the owner's calls. Each one changes scope, so record the answer here when it is made.

| # | Decision | Affects | Suggested default |
|---|---|---|---|
| D1 | MVP deployment topology: all-in-one only, or split roles too | I20, I10 role checks, M5 and M6 scope | All-in-one for MVP; split roles stay documented as unsupported |
| D2 | Launch jurisdiction(s) and emergency provider | I02 requirements, gate 4 tests | One jurisdiction, one provider with a documented test destination |
| D3 | Test carrier (IP-auth, DID and outbound) | Gates 3 and 4, I03, I08 | One carrier that offers IP-auth trunks and a test DID |
| D4 | STIR/SHAKEN: platform signing or carrier signing | Step 33, operational work | Carrier signing for MVP; keep step 33 off by default |
| D5 | Carrier DID → external forwarding while the API is down (R11) | R11 design | Fail closed: refuse the forward and play a failure tone instead of guessing authorization |
| D6 | Capacity model: tenant cap, extension cap or both (R08/I06) | Kamailio projection, Lua limits | Both: tenant cap at Kamailio, extension cap in FreeSWITCH |
| D7 | Repository license | I16 | Owner's choice; blocks publishing a release but no gate |
| D8 | Unsupported features: hide or disable the controls | M1 | Disable with an explanation; hiding conceals that the setting exists in the schema |

## M0 — Test foundations and early audio spike

Goal: make every later milestone measurable. Size: **M**.

1. **amd64 target host.** Provision a disposable Debian 13 amd64 VM on the production provider
   class (GCP C4). Emulated amd64 containers cannot verify systemd ([CLAUDE.md](../CLAUDE.md)), so
   gate 6 and every service-level check needs a real host. Script its creation and teardown.
2. **Endpoints and network.** Two physical or soft endpoints on different networks, at least one
   behind consumer NAT and one on mobile data. Record client names and versions.
3. **Gate 1 smoke.** Follow [hardware testing](testing-on-real-hardware.md) at the current
   revision. Capture `rtpengine-ctl list sessions`, negotiated codecs, `ss -lunp` RTP bindings for
   both FreeSWITCH and rtpengine, and a pcap on each side. If audio fails, the fix becomes M0
   work and blocks M3/M4 testing. Settle the shared RTP range question (I18) here.
4. **CI (I16).** Add a workflow that runs the checks that need no live services: shell `bash -n`
   and ShellCheck, `luac -p`, API typecheck and format check, `validation.test.ts`, portal
   typecheck/lint/build, site tests/build and `tests/docs-links.py`. Then add disposable
   PostgreSQL and Kamailio service containers for `security.test.ts` and `tests/sip-auth.py`.
   Production databases must never be reachable from CI.
   **Offline part written 2026-10-26** (YYZ-14): `.github/workflows/ci.yml` calls `tests/ci.sh
   shell|api|web|site`. It passes and fails as expected locally. **All six jobs green on GitHub at `d0309ee`.**
   The installer harnesses run in it as well.
   **Service-container jobs written 2026-10-26** (YYZ-15): `integration` (Postgres + Redis:
   security and cache-publication suites) and `sip` (Debian Kamailio + Postgres: `sip-auth.py`).
   Both pass against fresh containers locally and fail on an injected regression; green on GitHub.
5. **Evidence template.** Add an "Acceptance runs" section to [status](status.md): one row per
   run, with revision, host, architecture, component versions, procedure link and result. Every
   later closure writes there. **Done 2026-10-26 (YYZ-16):** the section exists; no run is
   recorded yet.
6. **Acceptance procedures.** [Hardware testing](testing-on-real-hardware.md) covers gates 1 and 6
   only. Write the procedures for gates 2–5 and 7 as they become testable, in the same document
   or a sibling. Each must name its pass condition before it is run. **Done 2026-10-26
   (YYZ-17):** [acceptance procedures](acceptance.md).

Exit: CI green on `main`, the amd64 host reproducible, and a gate 1 smoke result recorded,
pass or fail.

## M1 — Truthful production surface (gate 8)

Goal: the production portal never shows a record the backend does not hold, and never offers a
control the backend ignores. Size: **M**.

1. **Remove production seed fallbacks (I01). Done 2026-10-25** (see [issues](issues.md)); the
   deployed-portal check moves to M7. [`api.ts`](../portal/web/src/lib/api.ts) imported
   `seedData`, and 12 `getWithFallback` reads turned a live 404 into fixture records.
   - Move the fallback behind the Vite mock middleware so it exists only in mock mode; production
     reads use `api.get`.
   - A missing endpoint renders an explicit "not available on this server" state, using
     `QueryState`'s `isSuccess` check rather than an empty array.
   - Make the check structural: a build assertion that fails when the production bundle contains
     the fixture module, rather than a convention to remember.
   - Break it first: against the current build, request a missing endpoint and capture the
     invented E911 record. After the fix the same request must produce the unavailable state.
2. **Disable unsupported controls and claims (I07, I08, I22, D8). Done 2026-10-25** apart from the
   webphone, done as item 2a (I23). [`capabilities.ts`](../portal/api/src/lib/capabilities.ts) lists the
   stored-but-unenforced fields; the API refuses changes and `/api/capabilities` drives the UI.
   `egressMode` and the emergency notify fields were already not writable. Invented values on
   Settings, Dashboard, Trunks, Emergency and the sidebar were removed (I22). Inventory every schema field the portal can
   write with no runtime effect: `recordingPolicy`, `egressMode`, `emergencyNotifyEmail`/`Sms`,
   default ring timeout, and any enabled registration-trunk path. Refuse each in API validation
   (not only in the UI) until its runtime exists. `tenantSettings.maxConcurrentCalls` and
   `extension.maxConcurrentCalls` belong here too, until M3 wires them.
2a. **Simulated webphone (I23). Done 2026-10-25.** The provider mounts only in mock mode; the
   context is nullable so each entry point must handle a missing phone; the build refuses the
   drawer outside mock mode. A real client remains I09.
3. **Dependency advisories (I15). Done 2026-10-25;** portal clean, residuals accepted in
   [issues](issues.md#dependency-interpretation), Astro 7 deferred. For each advisory in the
   [audit](reviews/dependencies-2026-10-25.json), record whether it is reachable in production,
   build or dev only. Patch through compatible direct parents (Hono ≥ 4.13.5, Vite ≥ 8.1.6 first),
   then rerun the lockfile audits and the full regression set. Record accepted residual advisories
   with a reason in [issues](issues.md).
4. **Auth limiter (I21). Done 2026-10-25;** routine reads allowlisted, strict by default,
   verified by `tests/nginx-auth-limits.py`. Split credential and reset throttling from routine session and
   organization reads in the nginx config. Test normal multi-tab use, then confirm brute force is
   still refused through nginx.
5. **Remove the unused `@better-auth/api-key` dependency (I16). Done 2026-10-25;** the `apikey`
   table goes with it and is dropped on upgrade (verified non-interactive). Generator drift in
   `auth-schema.ts` recorded as I24, **fixed 2026-10-26 (YYZ-35)**: the file is the generator's
   output and CI checks it.

Exit: gate 8 closure checks pass on a deployed portal, with the "missing API cannot invent an
emergency location" case recorded.

## M2 — Consistent published state (gate 7)

Goal: after any database commit, Redis and Kamailio converge, including across failures and
restarts, and a cache rebuild never exposes a half-populated tenant. Size: **L**. This is the
foundation M3 and M4 publish through.

1. **Durable projection outbox (R06). Done 2026-10-25;** see [issues](issues.md) R06 and I25 (pre-push
   table check found on the way). Real-service restart check owed. Before: [`crud.ts`](../portal/api/src/lib/crud.ts) runs
   `afterChange` after the write commits, and a failed Redis or Kamailio effect is lost.
   - Add an outbox table in `schema.ts`, written in the **same transaction** as the resource
     change. Rows are coarse and idempotent: "rebuild tenant X", "sync subscriber Y",
     "reload Kamailio module Z".
   - A worker started from `src/index.ts` (never `app.ts`, which must stay timer-free) claims rows
     with `FOR UPDATE SKIP LOCKED`, retries with backoff and records the last error. It drains on
     startup, so pending work survives an API restart.
   - `reloadKamailio()` failures fail the job instead of being ignored by the caller.
   - Expose pending and failed counts to admins and to `/health` (ties into I17).
   - Make `crudRoutes` enqueue structurally, so a new resource cannot skip the outbox.
   - Revocation is the case that matters: disable an extension, kill Redis and Kamailio's DB
     connection after the commit, restart the API, restore the dependencies, and prove that the
     subscriber row and the cached directory entry are gone without operator action.
2. **Atomic cache publication (R13). Done 2026-10-25;** built in memory and published with one
   Redis script rather than a staging prefix (no rename step, nothing to clean up on failure).
   Before: [`rebuildTenant`](../portal/api/src/services/cache.ts)
   deletes every tenant key before repopulating. Recommended approach, which keeps the contractual
   key shapes unchanged for Lua: write the new generation under a staging prefix, then swap it in
   with one Redis transaction (or server-side script) that renames staged keys and deletes live
   keys absent from the new set. On a failed build the staging keys are dropped and the previous
   generation stays live. Add the staging prefix to `keys.tenantPatterns` cleanup.
   Test: concurrent rebuilds, an API kill mid-rebuild, and calls placed throughout, on both tiers.
3. **Dependent projections (I04). Done 2026-10-25;** deletion is refused while references
   exist ([`references.ts`](../portal/api/src/lib/references.ts)). Before: deleting or disabling an extension must refresh every
   DID, IVR option, ring-group failover and time-condition branch that points at it. Either
   refuse deletion while references exist, or clear them in the same transaction. Polymorphic
   destinations have no foreign key, so a reference lookup helper is needed. Test reuse of the
   same extension number afterwards, warm and cold.
4. **One dialable-number namespace (I19). Done 2026-10-25;** one registry and a locked claim
   ([`numbers.ts`](../portal/api/src/lib/numbers.ts)). Before: enforce uniqueness across extensions, ring groups,
   IVRs, feature numbers and any future dialable type, transactionally, and test concurrent
   creates. Prove the warm and cold tiers then resolve the same number to the same destination.

Exit: gate 7 failure-injection runs recorded for revocation, rebuild and restart, with both XML
tiers checked and `xml_flush_cache` run between phases. **Met 2026-10-25** with
[`gate7-convergence.py`](../tests/gate7-convergence.py) on a fresh arm64 install, 14/14 (see
[status](status.md)). Owed: the same on amd64, and with calls rather than directory lookups (M7).

## M3 — Call-path correctness (gates 2 and 3, source gaps)

Goal: close the source gaps the call-feature and carrier gates name, so that M7 tests a design that
is believed correct. Every change lands in **both** tiers: `xml_handler.lua` and
[`fs-xml.ts`](../portal/api/src/routes/fs-xml.ts). Size: **L**.

Wiring any field listed in `UNENFORCED` ([`capabilities.ts`](../portal/api/src/lib/capabilities.ts))
means deleting its entry in the same change; the portal re-enables its input from `/api/capabilities`.

1. **Outbound caller ID (I03).** Resolve route override → extension caller ID → tenant default,
   identically in `build_outbound` and the `fs-xml.ts` outbound branch. Directory variables do not
   apply under `auth-calls=false`, so the value comes from the cached profile of `X-Auth-User`.
   Verify with SIP captured at the test carrier, with and without an override.
   **Done 2026-10-25.** Verified against a fake carrier: [`outbound-callerid.py`](../tests/outbound-callerid.py),
   6/6 with each tier alone. A real carrier (D3) is still owed in M7. It found **I27**: calls from
   Kamailio sat in the `default` context and no tier answered there, so nothing had ever routed.
   Both tiers now transfer the call into `tenant_<org>` first.
2. **Authorized forwarding (R11, D5).** Carrier calls are declined by the Lua tier and kept
   DID-only by the API tier. Define a forwarding context in which the **tenant and forwarding
   extension** authorize the outbound continuation, never the peer. The forwarded leg counts
   against that extension's capacity and uses the tenant's caller ID. Tests: direct-dial from the
   trusted peer is still refused; DID → extension → external forward succeeds; a forwarding loop
   hits `MAX_DEPTH`; API-down behavior matches D5.
   **Done 2026-10-25.** `qwixbox.go` stamps the forward (`qwixbox_forward_to/_domain/_from`)
   and both tiers route a lookup for exactly that number as the forwarding extension. One change
   from the plan: the leg presents that extension's caller ID (falling back to the tenant's, as
   in I03), not always the tenant's. Kamailio's egress counter charges it to that extension;
   configured limits remain R08. D5: API down → reorder tone and 5xx. Verified by
   [`forwarding.py`](../tests/forwarding.py), 7/7, against a fake carrier. A real carrier is still
   owed (M7). Found I30: refused Kamailio reloads were reported as success.
3. **Configured capacity (R08, D6).** Kamailio hard-codes `MAX_CONCURRENT_CALLS 10` while
   `tenantSettings.maxConcurrentCalls` and `extension.maxConcurrentCalls` exist unenforced. Project
   tenant limits into a Kamailio htable through the M2 outbox, reserve on INVITE and release on
   failure, cancel and BYE. Test concurrency at the limit, CANCEL races and a Kamailio restart
   mid-call.
4. **Caller-side concurrency (I06).** Reserve the caller's slot on outbound and internal calls,
   not only the called extension's in `extension.lua`, with a symmetric release. Read
   `limit_usage` before incrementing; the `limit` application hangs up on exceed.
   **Done in code 2026-10-28:** both tiers count an authenticated caller with a maxless `limit`
   (never refuses); mod_hash releases it on hangup. A live call is owed (M7).
5. **Ring-group member policy (I05).** [`ring_group.lua`](../resources/lua/ring_group.lua) bridges
   `user/` legs directly, skipping DND and call waiting. Apply member policy when building the
   dial string, and project member state. Test each strategy with a DND member, a busy member and
   failover. Treat the sequential-timeout behavior as a hypothesis until a live test settles it.
   **Done 2026-10-26 (YYZ-20):** the hypothesis was a real bug, fixed with `leg_timeout`; member
   state is read at call time from the existing call profile rather than projected separately.
6. **Registration trunks stay unavailable (I08).** No MVP work beyond keeping them refused.
   Alternate-carrier retry is outside the MVP unless D3's carrier requires it.

Exit: each fix has a regression in CI where it can be exercised offline (Lua harness, API tests,
SIP fixture) and a listed live check for M7.

## M4 — Emergency behavior (gate 4)

Goal: an authorized emergency call is never refused by capacity, carries a dispatchable location
and callback number, and notifies the tenant. Size: **L**, and it depends on D2.

1. **Requirements review (D2).** Before code: confirm with the provider and jurisdiction what
   must be sent (callback number, location format, notification timing) and what test
   destination is approved. Record the result here. Do not dial live emergency services for
   routine tests.
2. **Ingress classification (I02).** Kamailio runs `route(FRAUD)` on ingress before FreeSWITCH
   identifies an `isEmergency` route; the `X-Emergency` bypass exists only on egress. Project each
   tenant's emergency route patterns into Kamailio through the M2 outbox. For an **authenticated
   subscriber** whose dialled number matches, skip the capacity refusal on ingress. Unauthenticated
   or peer traffic gets no bypass. Use the same pattern source as FreeSWITCH so the two cannot
   disagree. **Done 2026-10-26** (YYZ-23): `eligibleOutboundRoutes()` is that source,
   `emergency_pattern` is the projection, and `tests/emergency-ingress.py` is the live check. The
   test carrier is fake; the approved destination still waits for D2. Restricting which patterns
   a tenant may mark as emergency is I31.
3. **Locations and callback.** Implement emergency location CRUD and extension assignment as in
   [design §2.1](design/implementation-plan.md#21-emergency-calling-e911--karis-law--ray-baums-act),
   with a tenant default. Set the callback/ELIN number in both tiers on emergency routes.
4. **Notification.** Add the `/fs/emergency` hook, posted without blocking the bridge, that emails
   `emergencyNotifyEmail`. SMS waits for a messaging backend and stays refused (M1).
5. **Portal.** Switch the emergency screen to the live endpoint, which M1 has already made safe.

Exit: at the account's capacity limit, an emergency call to the approved test destination reaches
the carrier with the expected callback number and location, and the notification email arrives.

## M5 — Installer and operations (gate 6 and operational work)

Goal: a current amd64 install that is idempotent, recovers from interruption, and alerts a human
when something fails. Size: **M**.

1. **Postflight drift (I10).** Align the SSH check with step 10's root key-recovery policy, scope
   port and Postgres checks to the installed roles, and replace the `kamctl add`/write-a-dialplan
   advice with portal/CLI provisioning. **Done 2026-10-26 (YYZ-27)**, plus a SIGPIPE false
   failure in the port probe.
2. **DNS (I11).** Resolve the DNS mode once per step, guard `dns_publish` so the manual fallback
   actually runs, and stop step 42 overwriting DNS-01 renewal settings. Dry-run renewal for both
   HTTP-01 and DNS-01. **Code done 2026-10-26 (YYZ-28)**; the live dry-runs are owed.
3. **Mail and firewall (I12).** Refuse the template `SMTP_FROM` on unattended runs, document or
   add implicit-TLS relay, and split IPv4/IPv6 admin CIDR sets. Deliver a signed message through
   the production relay and check the DKIM result. **Code done 2026-10-26 (YYZ-29)**; the
   production relay delivery is owed.
4. **Upgrade safety (I14).** Before each `db:push --force`, run a diff review step and keep a
   pre-push dump. Write the rollback procedure. Suppress statement logging around role-password
   SQL in steps 20/22 and verify the logs. **Done 2026-10-26** (YYZ-30): pre-upgrade dump,
   push rehearsed on a copy with a data-loss gate, [rollback procedure](rollback.md) drilled end to
   end, role passwords kept out of the Postgres log. An upgrade on the gate 6 host is still owed.
5. **Health and alerting (I17).** `/health` reports FreeSWITCH, Kamailio and the outbox backlog,
   not only the database and Redis. Configure an alert receiver and prove receipt by stopping a
   service and letting a certificate near expiry. **Done 2026-10-26** (YYZ-31), except receipt by a person
   through the production relay/webhook, which belongs on the gate 6 host.
6. **Split roles (I20).** Only if D1 includes them; otherwise preflight refuses split-role
   configurations explicitly.
7. **STIR/SHAKEN (D4).** If platform signing is chosen, reproduce the OpenSSL build failure first.
   Otherwise verify the carrier's attestation on received calls.
8. **Gate 6 run.** On the M0 amd64 host: full install, idempotent rerun, a step killed mid-run and
   resumed, `--force` rebuild of FreeSWITCH, external SSH and TLS reload. Record component versions
   and note the PostgreSQL 18 target against the PostgreSQL 17 fixture.

Exit: gate 6 recorded on amd64, and an alert received by a human.

## M6 — Restore (gate 5)

Goal: a backup restores onto a fresh host and carries calls with existing credentials. Size: **M**.
Depends on M5 for the install path it restores onto.

1. Write the restore runbook, then a restore command if the runbook has more than a few manual
   steps. It must restore both databases and their roles, `config.env` with its encryption key,
   runtime config, service credentials and file ownership. **Done 2026-10-26** (YYZ-36):
   [runbook](restore.md) and `restore.sh`, rehearsed onto a fresh arm64 container. The key check
   for item 4 is built and break-checked; the amd64 host run in item 2 is still owed.
2. Restore onto a fresh amd64 host. Decrypt an existing SIP secret, register an endpoint with its
   old password, place a call, and sign in to the portal.
3. Inject backup and offsite-copy failures and confirm retention keeps the last good snapshots.
   **Done 2026-10-26** (YYZ-38): both kept the old snapshot, and `qwixbox-healthcheck` now alerts
   on a failed run and on no complete snapshot within 26h.
4. Restore with the wrong encryption key and confirm the failure is loud and early.

Exit: gate 5 recorded, with the runbook linked from the [README](../README.md).

## M7 — Release-candidate acceptance campaign

Goal: run every gate once against one frozen revision. Size: **M**, plus fixes found.

1. Freeze a release-candidate commit. Any fix restarts the affected gates on the new revision.
2. Fresh amd64 install from the published bootstrap (also closes R20 acceptance).
3. Run, in order: gate 6 → gate 1 across the M0 network matrix → gate 2 (voicemail record and
   email, IVR digits including `#`, DND, forwarding, call waiting, every ring-group strategy, fax
   receive with attachment) → gate 3 with the D3 carrier → gate 4 with the D2 test destination →
   gate 7 failure injection → gate 8 → gate 5 restore onto a second host.
4. Record every result in [status](status.md), close issues with their evidence, and update
   [mvp.md](mvp.md) to say which gates passed on which revision.

## Gate traceability

| Gate | Issues | Milestones |
|---|---|---|
| 1 Remote two-way audio | I18 | M0 smoke, M7 |
| 2 Call features | I04, I05, I06, I18 | M2, M3, M7 |
| 3 Carrier paths and identity | R11, I03, I08 | M3, M7 |
| 4 Emergency behavior | I02, R08 | M4, M7 |
| 5 Restore | I13 | M6, M7 |
| 6 Current target-host install | I10, I11, I12, I14, I18, I20 | M5, M7 |
| 7 Consistent published state | R06, R08, R11, R13, I04, I19 | M2, M3, M7 |
| 8 Accurate production surface | I01, I22 (fixed), I07 (controls refused), I15 (patched), I23 (fixed) | M1, M7 |
| Operational (not a gate) | I16, I17, I21, STIR | M0, M1, M5 |

Not in this plan, per [mvp.md](mvp.md#outside-the-core-mvp): queues, billing, resellers, SMS,
conferences, contacts, device provisioning, MoH/parking, recordings and voicemail management,
user-to-extension ownership, the browser phone and AI features. They stay disabled or clearly
marked as previews until after MVP (M1 enforces that).

## Maintaining this plan

Update the decisions table when a decision is made, and tick off milestones only with a link to
the [status](status.md) evidence. If a milestone changes scope, say why in the
[change log](changelog.md). Do not copy designs into this file; link to them.
