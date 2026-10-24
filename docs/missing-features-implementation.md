# Missing Features & Best-Practice Implementation Plan

> Companion to [`docs/reference.md`](./reference.md) (Cross-Reference Analysis of **FusionPBX**, **FS PBX**, and **OpenWeb PBX** vs. **QwixBox**).

This document is the feature-level summary for implementing QwixBox's missing features. It covers replacing the 6 mock-backed portal screens (`portal/web/mock/data.ts`) and the mock webphone (`WebphoneDrawer.tsx`), and adopting the highest-leverage best practices from the three reference PBXs.

> **Status — checked against the code on 2026-10-24.** This summary had drifted from the
> codebase. It named functions, columns, roles, paths and modules that do not exist, and described
> several things as present that are not. Those statements have been corrected inline.
> **[`comprehensive-implementation-plan.md`](./comprehensive-implementation-plan.md) is the
> authoritative version.** It holds the per-file detail, twelve pre-existing bugs to fix first,
> and a divergence log (Appendix A). Where the two disagree, that plan wins, and the code wins over both.
>
> Ordering still follows [`mvp.md`](./mvp.md). No call has been confirmed to carry audio, so
> every media feature below (recording, voicemail, queues, conferences, parking, MoH, the webphone)
> is unverifiable until mvp.md item 1 passes.

---

## 0. Architectural Guardrails Checklist

Every feature implemented in QwixBox **must** adhere to the architectural invariants enforced across the codebase (`CLAUDE.md`):

1. **Single Schema Source of Truth (`portal/api/src/db/schema.ts`):**
   - Add new tables and columns exclusively in `portal/api/src/db/schema.ts` (and `auth-schema.ts`). Do not write raw `CREATE TABLE` migrations; schema changes are applied via `drizzle-kit push --force`.
   - Every stored credential, PIN, or secret must be encrypted at rest with AES-256-GCM (`*Enc` column suffix) via `encrypt` / `decrypt` in `portal/api/src/lib/crypto.ts`. Each resource's `present` callback must strip its `*Enc` columns, because `crudRoutes` does not. The write-time audit redaction in `lib/audit.ts` matches only `passwordEnc|PinEnc|password|secret|ha1`, so widen it before adding something like `apiKeyEnc`.
   - Every tenant-owned table uses `id: text("id").primaryKey()` and `organizationId: text("organization_id")`. It is not `uuid`, and not `tenantId`.
2. **Structural RBAC & Tenant Isolation (`portal/api/src/lib/crud.ts` & `portal/api/src/auth.ts`):**
   - Add every new resource permission to `statement` and grant it across the four roles in `ROLES` (`portal/api/src/auth.ts`). The roles are `owner`, `admin`, `member` and `viewer`; `user`, `tenant_admin` and `superadmin` do not exist. `recording: ["read", "delete"]` already exists, with no route behind it. `callflow` is already taken by ring groups, IVRs and time conditions.
   - Mount CRUD endpoints via `crudRoutes` (`portal/api/src/lib/crud.ts`), which enforces `requireTenant` and `requirePermission` on every route.
   - Any custom sub-path routes (e.g., `POST /:id/preview`, `POST /:id/qrcode`) must explicitly include `requireTenant` and `requirePermission(resource, action)`.
   - **No portal user is linked to an extension.** Anything scoped to "the user's own extension" (voicemail, recordings, the webphone, personal contacts, "my devices") first needs `extension.userId`. See plan §2.0.
3. **Call-Time Resolution & Redis Key Registry (`portal/api/src/services/redis.ts` & `cache.ts`):**
   - FreeSWITCH Lua scripts (`resources/lua/`) must **never** connect directly to PostgreSQL. They read from Redis (`hiredis_raw` via `qwixbox.redis_get`) or fall back to the Hono API: `qwixbox.fetch(kind, domain, id)` posts to `/fs/state`, which is a **read-only** `{domain, kind, id}` lookup with no `op=` parameter. Side effects go to their own gateway-secret hook, the way `/fs/feature` does, sent through `qwixbox.api_post()`.
   - Register every new Redis key builder in `keys` and every wildcard pattern in `keys.tenantPatterns(domain)`, which takes the domain only, in `portal/api/src/services/redis.ts`. That keeps `rebuildTenant(organizationId)` (`portal/api/src/services/cache.ts`) complete; it purges by those patterns, and there is no `flushTenant`.
   - The format-string hazard is in `mod_hiredis`, which `30-freeswitch.sh` patches, and `qwixbox.redis_get` refuses keys containing `%`, spaces or control characters. Strip `%` from tenant-controlled strings before caching them anyway (CLAUDE.md, mod_hiredis note).
   - **Inbound PSTN calls never reach `xml_handler.lua`.** Trusted peers are declined there, and resolved by `fs-xml.ts` and then `destination.lua`. Inbound-only features (caller-name lookup, call blocking, inbound recording) belong on that path.
4. **Polymorphic Destination Dispatch (`resources/lua/qwixbox.lua`):**
   - Every new routable destination type (`conference`, `parking_lot`, `day_night`, `ai_receptionist`, etc.) is wired in **all** of the following. `queue` is already in `destinationTypeEnum` and is explicitly rejected by `badDestination()`.
     1. `destinationTypeEnum` in `schema.ts`.
     2. `badDestination()` in `portal/api/src/routes/telephony.ts` (validation on save).
     3. `callState()` in `portal/api/src/services/call-state.ts`. Its `kind` must equal the Redis key segment `qwixbox:<kind>:<domain>:<id>`, because `qwixbox.fetch` uses the same `kind` for both. Touch `destinationNumber()` only if the type is cached by number rather than id.
     4. `keys` + `keys.tenantPatterns`, a `cache*()` builder called from `rebuildTenant()`, and `cacheFeatureNumber()` if the type is dialable.
     5. `handleDialplan()` in `portal/api/src/routes/fs-xml.ts`, which looks up dialable numbers in SQL and does not read `qwixbox:num:`.
     6. `qwixbox.go(session, domain, dtype, did, depth)` in `resources/lua/qwixbox.lua`, always forwarding `depth` and honouring `MAX_DEPTH = 10`.
5. **FreeSWITCH Minimal Config & Build Manifests (`steps/30-freeswitch.sh` & `steps/31-freeswitch-config.sh`):**
   - Add a module to `FS_AUTOLOAD_ADD` in `steps/31-freeswitch-config.sh`. Add it to `FS_ENABLE_MODULES` in `steps/30-freeswitch.sh` only if upstream's default `modules.conf` does not already build it. Step 31 copies each autoloaded module's `<module>.conf.xml` from the vanilla tree when none exists. There is no `FS_KEEP_AUTOLOAD`. To control a config, ship it under `resources/conf/freeswitch/autoload_configs/`.
   - Step 31's `# step-inputs:` already lists the `resources/conf/freeswitch` and `resources/lua` directories, so new files there need no edit to that line. A **new** step, or a step reading a new directory, does need one.
   - FreeSWITCH holds **no registrations and no subscriptions**: endpoints register to Kamailio, which loads no presence modules. MWI lamps, BLF keys, `check-sync` reboots and `sofia ... flush_inbound_reg` therefore have no delivery path today.
6. **Removing Mock Fallbacks (`portal/web/src/lib/api.ts`):**
   - The 12 roadmap endpoints are read through `getWithFallback(path, key)`. There is no `mockByPath`. On a 404 it returns seed data from `mock/data.ts`, and the API 404s every unimplemented path, so **a production install currently shows invented data**, including invented E911 locations. As each backend endpoint goes live, switch it to `api.get(...)` and remove `<MockFeatureBanner />` from its route. Gate whatever fallback remains on dev mode now; see plan Bug 11. `mock/data.ts` also backs the dev mock server (`mock/api.ts`, `mock/plugin.ts`) and `tests/portal-mock.test.ts`, so stop importing it from `src/` rather than deleting it outright.

---

## Phase 1: Closing Core MVP & Trunk/Routing Gaps

### 1.1 Emergency Calling (E911 — Kari's Law & RAY BAUM'S Act)

**Current State (checked 2026-10-24):** The `emergencyLocation` table and `extension.emergencyLocationId` exist, and **nothing reads or writes either one**. `tenantSettings.defaultEmergencyLocationId` does **not** exist. Emergency classification is not a fixed number list. It is any outbound route with `isEmergency = true` whose PCRE matches the dialled number, offered only to an authenticated caller. That route sets `X-Emergency: true`, which Kamailio's egress pass honours. Beyond that:
- There is no `/api/emergency-locations` CRUD endpoint (`portal/web/src/routes/_app/emergency.tsx` shows seed data, in production too).
- Outbound emergency calls carry the route's `callerIdOverride` if set, and otherwise the `From` user, which is the extension number. The directory's caller-ID variables are never applied, because of `auth-calls=false`. The caller's `emergencyLocation.callbackNumber` (ELIN) is never used, which violates RAY BAUM'S Act. There is no `tenant.outboundCallerId`; the tenant fallback is `tenantSettings.defaultCallerIdNumber`.
- No notification is dispatched on 911 calls, which violates Kari's Law. `tenantSettings.emergencyNotifyEmail` and `emergencyNotifySms` (single values) exist but cannot be set through `PATCH /api/tenant`.
- **Critical:** Kamailio's `route[INGRESS]` runs `route(FRAUD)` before anything knows the call is an emergency, so a 911 call from an account at `MAX_CONCURRENT_CALLS` is refused with `486`. Only the *egress* pass has a bypass.

**Implementation Plan (Informed by OpenWeb PBX & FS PBX):**
1. **API & RBAC (`portal/api/src/routes/telephony.ts` & `auth.ts`):**
   - Add `emergency: ["create", "read", "update", "delete"]` to `statement` in `portal/api/src/auth.ts`, and grant it per role.
   - Mount `/api/emergency-locations` via `crudRoutes` in `portal/api/src/routes/telephony.ts`, and register it in `app.ts`. Make `emergencyLocationId` writable on extensions, checked with `tenantOwns`.
   - Add `defaultEmergencyLocationId` to `tenantSettings`. For notifications, either make the existing `emergencyNotifyEmail`/`emergencyNotifySms` writable or replace them with array columns. Do not add a parallel set beside them. No SMS sender exists yet (§2.5).
2. **ELIN Caller-ID & Cache Projection (`portal/api/src/services/cache.ts` & `fs-xml.ts`):**
   - There is no `buildEmergencyXml`. The emergency branch is `build_outbound()` in `xml_handler.lua` and `outbound(true)` in `fs-xml.ts`. Change **both**.
   - Include the resolved `emergencyCallbackNumber` and location label in the cached extension call state (`cacheExtension()` and `callState(…, "call", …)`), so the emergency branch reads it without a round trip.
   - Create `resources/lua/emergency.lua`, or inline it in the emergency branch:
     - Use the calling extension's `emergencyLocation.callbackNumber`, falling back to the tenant's default location's callback number, then `tenantSettings.defaultCallerIdNumber`.
     - Set `effective_caller_id_number` and `sip_h_X-Emergency-Location` on the channel.
     - Fire a background POST to a new gateway-secret hook (`/fs/emergency`) so the API dispatches immediate alerts (the Kari's Law notification) with the extension number, caller name, location and timestamp, without delaying call setup.
3. **Kamailio Call-Cap Bypass (`resources/conf/kamailio/kamailio.cfg`):**
   - In `route[INGRESS]`, skip `route(FRAUD)` when `$rU =~ "^(911|933|112|999)$"`. Kamailio cannot see the tenant's `isEmergency` routes, so keep this list a superset of them. Still call `dlg_manage()` and accounting. Test it with the account saturated.
4. **Portal UI (`portal/web/src/routes/_app/emergency.tsx`):**
   - Switch `emergencyLocations` in `portal/web/src/lib/api.ts` from `getWithFallback` to `api.get`, remove `<MockFeatureBanner />`, and wire the CRUD form and the extension location assignment matrix to the real API.

---

### 1.2 Outbound Route Failover Trunks & Trunk Registration (`uac` / Gateways)

**Current State:**
- `outboundRoute` only holds a single `trunkId`. If a carrier returns `503 Service Unavailable`, the call fails immediately.
- `trunk` has `authMode`, `username` and `passwordEnc` in `schema.ts`. There are no `register*` columns, and the password is set through `PUT /api/trunks/:id/password`. `kamailio.cfg` **does** load `uac.so`, but with only `restore_mode` set and no `reg_*` parameters. The `uacreg` table is never created, because `steps/34-kamailio-config.sh` leaves `uac` out of `KAM_SCHEMAS`. Enabled register-mode trunks are rejected by `trunks.validate`, and filtered out of both `cacheRouteTable()` and `fs-xml.ts`. Kamailio's `failure_route[MANAGE_CARRIER_FAILOVER]` only logs.

**Implementation Plan (Informed by OpenWeb PBX's Failover & Trunk Model):**
1. **Ordered Failover Trunks on Outbound Routes:**
   - Add `backupTrunkId: text("backup_trunk_id").references(() => trunk.id, { onDelete: "set null" })` to `outboundRoute` in `portal/api/src/db/schema.ts`, and add the backup trunk to `CachedRoute`.
   - Update `build_outbound()` (`resources/lua/xml_handler.lua`) and `outbound()` (`portal/api/src/routes/fs-xml.ts`) to adopt OpenWeb PBX's failure-cause filtering. There is no `buildOutboundXml`. Each attempt still bridges to **Kamailio's egress port**, with the trunk carried in `X-Trunk-Target`. Bridging straight to the carrier would bypass Kamailio's fraud checks, STIR signing and accounting.
     ```xml
     <action application="set" data="continue_on_fail=NORMAL_TEMPORARY_FAILURE,SWITCH_CONGESTION,NO_ROUTE_DESTINATION,NORMAL_CIRCUIT_CONGESTION,NETWORK_OUT_OF_ORDER,DESTINATION_OUT_OF_ORDER,GATEWAY_DOWN,RECOVERY_ON_TIMER_EXPIRE,EXCHANGE_ROUTING_ERROR"/>
     <action application="set" data="sip_h_X-Trunk-Target=${primary_host}:${primary_port};transport=${primary_transport}"/>
     <action application="bridge" data="sofia/external/${number}@${kam_egress}"/>
     <action application="set" data="sip_h_X-Trunk-Target=${backup_host}:${backup_port};transport=${backup_transport}"/>
     <action application="bridge" data="sofia/external/${number}@${kam_egress}"/>
     ```
     This guarantees automatic failover on network/trunk failure (`502`/`503`/`504`/timeout) while immediately stopping on user-level rejections (`USER_BUSY` `486`, `CALL_REJECTED` `603`, `UNALLOCATED_NUMBER` `404`).
2. **Registration-Based Trunks (`authMode = "register"`):**
   - Add `uac` to `KAM_SCHEMAS` in `steps/34-kamailio-config.sh`, so that `uacreg` exists. Then configure the already-loaded `uac.so` in `resources/conf/kamailio/kamailio.cfg` (`modparam("uac", "reg_db_url", DBURL)`, `reg_contact_addr`, timers).
   - Extend `syncTrunkAddress()` / `removeTrunkAddress()` in `portal/api/src/services/kamailio-sync.ts`. There is no `syncTrunksToKamailio()`.
     - Trunks with `authMode === "ip"` continue to populate `address`.
     - Trunks with `authMode === "register"` decrypt `passwordEnc` (`decrypt`), write rows into `uacreg` (`l_uuid`, `l_username`, `l_domain`, `r_username`, `r_domain`, `realm`, `auth_username`, `auth_password`, `auth_proxy`), and add `uac.reg_reload` to `reloadKamailio()`. That function checks stderr, because `kamcmd` exits 0 on failure.
   - Outbound INVITEs to a register-mode carrier also need **digest-challenge handling** on the egress pass (`uac_auth()` on 401/407). Without it, the trunk registers and every call to it is still refused.

---

### 1.3 Post-Answer Call Recording & S3 Archiving

**Current State:**
- `tenantSettings.recordingPolicy` (`none | inbound | outbound | all`) exists and is cached in Redis. `recordingRetentionDays` does **not** exist; retention is global, through `RECORDING_KEEP_DAYS` and `qwixbox-maintenance`'s pruning of `$PREFIX/recordings`. `cdr` has `recordingPath`, but no `recorded` flag. `parseCdrXml()` in `services/cdr.ts` already reads `vars.recording_file`. No dialplan or Lua script starts `record_session`. The `recording` permission exists, but `/api/recordings` does not, so `messages.tsx` shows seed data.

**Implementation Plan (Informed by OpenWeb PBX's Post-Answer Hook & FS PBX's `S3RecordingArchiver`):**
1. **Post-Answer Recording in Lua (`resources/lua/extension.lua`, `ring_group.lua`, & `fs-xml.ts`):**
   - Never call `record_session` directly before `bridge` (which forces FreeSWITCH to send `183 Session Progress` early media and silences carrier `180 Ringing` ringback, and creates 0-second files for unanswered calls).
   - Instead, when `recordingPolicy` matches the call direction (`all`, or `inbound` on DID entry, or `outbound` on PSTN egress), set:
     ```lua
     local rec_dir = "/usr/local/freeswitch/recordings/" .. domain .. "/" .. os.date("!%Y/%m/%d")  -- $PREFIX/recordings, already pruned by qwixbox-maintenance
     local rec_file = rec_dir .. "/" .. uuid .. ".wav"
     session:setVariable("media_bug_answer_req", "true")
     session:setVariable("RECORD_STEREO", "true")
     session:setVariable("recording_file", rec_file)
     session:setVariable("execute_on_answer", "record_session " .. rec_file)
     ```
   - No CDR parser change is needed. `parseCdrXml()` in `portal/api/src/services/cdr.ts` already maps `recording_file` to `cdr.recordingPath`. Arm outbound recording in both tiers' outbound builders, and inbound recording in `destination.lua`, because inbound DIDs never reach `xml_handler.lua`.
2. **Recordings API (`portal/api/src/routes/recordings.ts`):**
   - The `recording` permission already exists in `statement`. Do not add it again.
   - Create `GET /api/recordings` (CDRs where `recordingPath IS NOT NULL`, scoped by `organizationId`; restricting a `member` to their own extensions needs `extension.userId`), `GET /api/recordings/:id/audio` (path-confined streaming, like `faxPath`), and `DELETE /api/recordings/:id` (delete the file and clear `recordingPath`).
3. **Retention & Optional S3 Offload:**
   - `qwixbox-maintenance` already deletes files under `$PREFIX/recordings` older than `RECORDING_KEEP_DAYS`, but leaves `cdr.recordingPath` pointing at them. Reconcile the two. Per-tenant retention needs a new `tenantSettings.recordingRetentionDays` column. Optionally offload to S3-compatible storage, following FS PBX's `S3RecordingArchiver` pattern; roadmap item 24 has no object storage today.

---

### 1.4 Voicemail API, Portal UI & PIN-Free External Security

**Current State:**
- FreeSWITCH `mod_voicemail` handles `*97`/`*98` and stores messages on disk/SQLite, and `portal/web/src/routes/_app/messages.tsx` has a Voicemail tab, but `/api/voicemails` is missing (falling back to mock data).

**Implementation Plan (Informed by OpenWeb PBX & FS PBX):**
1. **Voicemail Access (`portal/api/src/routes/voicemails.ts`):**
   - Read `mod_voicemail`'s own SQLite store through ESL (`vm_list <ext>@<domain> xml`, `vm_read`, `vm_delete`). **Do not** point `voicemail.conf.xml`'s `odbc-dsn` at the `qwixbox` database. `drizzle-kit push --force` manages that database, with no `tablesFilter`, so foreign tables there are at risk on every re-run. If Postgres is wanted, use a separate `freeswitch` database.
   - Expose:
     - `GET /api/voicemails` (messages for the tenant; scoping a `member` to their own mailbox needs `extension.userId`). Add a `voicemail` permission to `statement`.
     - `GET /api/voicemails/:id/audio` (streams `$PREFIX/storage/voicemail/default/<domain>/<ext>/…`, path-confined, with `Range` support for browser `<audio>` seeking).
     - `PATCH /api/voicemails/:id` (read/unread via ESL `vm_read`; there is no `vm_mwi.lua`).
     - `DELETE /api/voicemails/:id` (ESL `vm_delete`).
   - **MWI lamps will not light.** FreeSWITCH holds no subscriptions, and Kamailio has no presence modules (§0.5), so that needs a presence path first.
2. **Hardening `*97`/`*98` (OpenWeb PBX Best Practice):**
   - The check belongs in the dialplan builders, `xml_handler.lua` and `fs-xml.ts`, not in `feature_code.lua`, which `*97`/`*98` never reach. The test is the authenticated `X-Auth-User` (`caller`). Under `auth-calls=false`, `sip_authorized` means nothing.
   - The exposure is smaller than it sounds. Trusted-peer (trunk) calls are stopped before feature codes on both tiers, and a transfer keeps the peer header, so the "IVR digit injection" path does not reach `*98` today. Require authentication for both codes anyway, as defence in depth.
3. **Remove Mock Fallback (`portal/web/src/lib/api.ts` & `messages.tsx`):**
   - Switch `voicemails` and `recordings` from `getWithFallback` to `api.get`.

---

## Phase 2: Replacing the 6 Mock-Backed Portal Screens & Mock Webphone

### 2.1 Call Queues (ACD), Real-Time Wallboard & Queue Callbacks (`queues.tsx`)

**Current State:**
- Full design exists in `docs/design/call-centre.md`, and `portal/web/src/routes/_app/queues.tsx` renders a queue table, agent matrix, and wallboard backed by `portal/web/mock/data.ts`.
- `mod_callcenter` is compiled by `steps/30-freeswitch.sh` (`applications/mod_callcenter`), but it is **not** in `FS_AUTOLOAD_ADD` (`steps/31-freeswitch-config.sh`). `schema.ts` **does** have a bare `queue` table (`number`, `name`, `strategy`, `mohSound`, `maxWaitSec`, `timeoutType`/`timeoutId`), and `"queue"` is in `destinationTypeEnum`. However, `badDestination()` rejects it with "Queues are not implemented", there are no agent or tier tables, and `qwixbox.go()` has no `"queue"` handler.

**Implementation Plan (Combining `docs/design/call-centre.md` + OpenWeb PBX Queue Callbacks):**
1. **FreeSWITCH Module & Config (`steps/31-freeswitch-config.sh`):**
   - Add `mod_callcenter` to `FS_AUTOLOAD_ADD` in `steps/31-freeswitch-config.sh`.
   - Ship `resources/conf/freeswitch/autoload_configs/callcenter.conf.xml`. That directory is already a declared step input. Create queues and agents at runtime with `callcenter_config`, named `<id>@<sipDomain>`.
2. **Database Schema (`portal/api/src/db/schema.ts`):**
   - **Extend** the existing `queue` table, and add `agentSkill`, `queueAgent`, `agentStateHistory`, `cdrCallCentre` and `queueCallback`. Use `organizationId` and `text` ids, as every other table does. The `queue` target shape:
     - `queue`: `id`, `organizationId`, `name`, `number`, `strategy` (`ring-all | longest-idle-agent | round-robin | top-down | agent-with-least-talk-time | agent-with-fewest-calls | sequentially-by-agent-order | random`), `mohSound`, `timeBaseScore` (`queue | system`), `maxWaitTime`, `maxWaitTimeWithNoAgent`, `tierRulesApply`, `tierRuleWaitSecond`, `wrapUpTime`, `abandonResumeAllowed`, `RecordTemplate`, `timeoutDestinationType`, `timeoutDestinationId`, `callbackEnabled` (`boolean`), `callbackMode` (`keep_position | live_first`), `slaTargetSeconds`.
     - `queueAgent`: `id`, `organizationId`, `queueId`, `extensionId`, `tierLevel`, `tierPosition`, `status` (`Logged Out | Available | On Break`).
     - `queueCallback`: `id`, `organizationId`, `queueId`, `callerNumber`, `callerName`, `status` (`pending | dialing_agent | dialing_caller | completed | failed`), `requestedAt`.
3. **Runtime Dispatch (`resources/lua/qwixbox.lua` & `resources/lua/queue.lua`):**
   - Remove the `queue` rejection in `badDestination()`, and wire the rest of the destination contract (§0.4).
   - Add `elseif dtype == "queue" then` to `qwixbox.go()` in `resources/lua/qwixbox.lua` to execute `queue.lua <domain> <did> <depth>`.
   - Create `resources/lua/queue.lua`:
     - Fetch queue config with `qwixbox.fetch("queue", domain, id)`: Redis first, then `/fs/state` with `kind = "queue"`.
     - If `callbackEnabled` is true, bind digit `*` (or `1`) during MOH wait so callers can press `1` to request a callback (`queueCallback`), confirm their Caller ID (or enter an alternate number), and hang up without losing their place.
     - Execute `session:execute("callcenter", queue_id .. "@" .. domain)`.
     - On exit, if `cc_cancel_reason` is `TIMEOUT` or `NO_AGENT_TIMEOUT` and `timeoutType` is set, call `qwixbox.go(session, domain, q.timeoutType, q.timeoutId, depth)`. `qwixbox.go` increments depth itself, so passing `depth + 1` would count the hop twice.
     - A callback request posts to a new gateway-secret hook. `/fs/state` is read-only.
   - Add feature codes `*60` (Agent Login), `*61` (Agent Logout) and `*62` (Agent Toggle Break) to the `FEATURE_CODES` tables in **both** `xml_handler.lua` and `fs-xml.ts`, with matching actions in `feature_code.lua` and `/fs/feature`.
4. **ESL Event Consumer & Wallboard SSE (`portal/api/src/services/esl.ts` & `routes/queues.ts`):**
   - `services/esl.ts` is a one-shot command client today. Add a **persistent** subscriber to `CUSTOM callcenter::info`, started from `src/index.ts` (not `app.ts`) and reconnecting on loss. It writes `agentStateHistory` and `cdrCallCentre` rows and broadcasts real-time queue metrics (`waitingCallers`, `longestWaitSec`, `agentsAvailable`, `agentsOnCall`, `slaPercent`) over Server-Sent Events (`GET /api/queues/wallboard/stream`). Re-push queues and agents into `mod_callcenter` after a FreeSWITCH restart.
5. **Remove Mock Fallback:**
   - Switch `queues` and `queueAgents` in `portal/web/src/lib/api.ts` from `getWithFallback` to `api.get`, and remove `<MockFeatureBanner />` from `portal/web/src/routes/_app/queues.tsx`.

---

### 2.2 Conferences, Valet Call Parking & Multi-Rate Music on Hold (`conferences.tsx`)

**Current State:**
- `portal/web/src/routes/_app/conferences.tsx` has tabs for Conferences, Parking Lots, and Music on Hold, all backed by `portal/web/mock/data.ts`.
- Neither `mod_conference` nor `mod_valet_parking` appears in `FS_ENABLE_MODULES`. Upstream's default `modules.conf` builds both, along with `mod_local_stream`, so check `$PREFIX/mod/` on a built host before adding them. None of them is in `FS_AUTOLOAD_ADD`.

**Implementation Plan:**
1. **FreeSWITCH Modules (`steps/30-freeswitch.sh` & `steps/31-freeswitch-config.sh`):**
   - Add a module to `FS_ENABLE_MODULES` only if the check above shows it is not built.
   - Add `mod_conference`, `mod_valet_parking` and `mod_local_stream` to `FS_AUTOLOAD_ADD` in `steps/31-freeswitch-config.sh`. Ship our own `conference.conf.xml` and `local_stream.conf.xml` under `resources/conf/freeswitch/autoload_configs/`; there is no `FS_KEEP_AUTOLOAD`.
2. **Conferences (`conference` table + `resources/lua/conference.lua`):**
   - Add `conference` to `portal/api/src/db/schema.ts`: `id`, `organizationId`, `name`, `number`, `moderatorPinEnc` (AES-256-GCM), `participantPinEnc` (AES-256-GCM), `maxMembers` (default `50`), `recordConference` (`boolean`), `waitForModerator` (`boolean`), `muteOnJoin` (`boolean`), `announceCount` (`boolean`).
   - Add `resources/lua/conference.lua`:
     - Fetch room state with `qwixbox.fetch("conf", domain, id)`.
     - Prompt for PIN (`session:playAndGetDigits`), compare against moderator/participant PINs verified by `/fs/state`, set conference flags (`wait-mod`, `moderator`, `mute`), and invoke `session:execute("conference", room_key .. "@default+flags{" .. flags .. "}")`.
   - Wire `dtype == "conference"` through the full destination contract (§0.4), including the `qwixbox:num:` entry for direct dialling and the matching SQL lookup in `fs-xml.ts`.
3. **Valet Call Parking (`parkingLot` table + `resources/lua/park.lua`):**
   - Add `parkingLot` to `portal/api/src/db/schema.ts`: `id`, `organizationId`, `name`, `parkExtension` (e.g. `5900`), `slotStart` (e.g. `5901`), `slotEnd` (e.g. `5910`), `timeoutSeconds` (default `120`), `timeoutDestinationType`, `timeoutDestinationId`.
   - Cache parking lot slot ranges in Redis under a key registered in `keys` and `keys.tenantPatterns`, e.g. `qwixbox:park:<domain>:<ext>`. Every existing key is `qwixbox:<kind>:<domain>:…`, and `rebuildTenant` purges by those enumerated patterns. Dialling `5900` executes `valet_park <lot>@<domain> auto in <slotStart> <slotEnd>` (announcing the slot number to the parker) and dialing `5901–5910` executes `valet_park <lot>@<domain> <slot>` to retrieve the parked call.
4. **Multi-Rate Music on Hold (`musicOnHold` table + `ffmpeg` Transcoder from FS PBX):**
   - Add `musicOnHold` to `portal/api/src/db/schema.ts`: `id`, `organizationId`, `name`, `directoryPath`, `files` (`jsonb`), `shuffle` (`boolean`).
   - Adopt **FS PBX's multi-rate `ffmpeg` transcoding pipeline**: when an admin uploads an `.mp3` or `.wav` file via `POST /api/music-on-hold/:id/files`, transcode it with `ffmpeg` into both `8000/` and `48000/` subdirectories as mono 16-bit PCM WAV (`-ac 1 -ar 8000 -acodec pcm_s16le` and `-ar 48000`), write the tenant stream entry to `local_stream.conf.xml`, and run `reload mod_local_stream` via ESL. Install `ffmpeg` in `41-api-deploy.sh`, since the API runs it. Call it with an argument array, confine its paths, and re-test the install on amd64.
   - Park-slot BLF lamps have no delivery path (§0.5).
5. **Remove Mock Fallback:**
   - Switch `conferences`, `parkingLots` and `musicOnHold` in `portal/web/src/lib/api.ts` from `getWithFallback` to `api.get`, and remove `<MockFeatureBanner />` from `conferences.tsx`.

---

### 2.3 Multi-Device Extensions, Auto-Provisioning & QR Enrollment (`devices.tsx`)

**Current State:**
- `extension` holds one credential: the SIP username is `extension.number`, and the password is `sipPasswordEnc`. There is no `sipUsername` column. `extension.deviceMac` already exists (indexed, one per extension), so migrate it into the new table rather than leaving two sources of truth. `portal/web/src/routes/_app/devices.tsx` shows seed data.

**Implementation Plan (Combining `docs/design/backlog.md` + FS PBX Device Templates/Preview + OpenWeb PBX QR Enrollment):**
1. **Database Schema (`portal/api/src/db/schema.ts`):**
   - Add `deviceKeyTemplate`: `id`, `organizationId`, `name`, `vendor` (`yealink | grandstream | poly | fanvil`), `keys` (`jsonb` array of `{ line, type: "line" | "blf" | "speeddial" | "park", value, label }`).
   - Add `userDevice`: `id`, `organizationId`, `extensionId`, `label` (e.g. `"Desk — Yealink T54W"`, `"Mobile App"`), `vendor`, `model`, `macAddress` (normalized lowercase hex, unique across system), `sipUsername`, `sipPasswordEnc` (AES-256-GCM), `provisioningTokenEnc`, `provisioningTokenHash` (indexed SHA-256 for fast `/prov/:token` lookup), `keyTemplateId`, `lastProvisionedAt`, `lastProvisionedIp`.
2. **Kamailio Multi-Device Sync (`portal/api/src/services/kamailio-sync.ts` & `resources/conf/kamailio/kamailio.cfg`):**
   - Project both `extension` primary credentials and every `userDevice` row into Kamailio's `subscriber` table (`ha1` / `ha1b`).
   - When an extension is rung, resolve all registered contacts across its `userDevice` SIP usernames (or share the extension AOR with `max_contacts = 5` in `usrloc` so `lookup("location")` forks to all registered endpoints simultaneously).
3. **Provisioning Server, Config Preview & QR Enrollment (`portal/api/src/routes/devices.ts` & `routes/device-prov.ts`):** `services/provisioning.ts` already exists and provisions *tenants*, so use a different name for phone provisioning.
   - Mount `/api/devices` and `/api/device-key-templates` via `crudRoutes`.
   - **Provisioning Endpoint (`GET /prov/:token/:filename`):** Verify `:token` against `provisioningTokenHash`, enforce IP/rate limits, decrypt `sipPasswordEnc` only in memory to render the vendor configuration template (`yealink.cfg.hbs`, `grandstream.xml.hbs`, `poly.cfg.hbs`, `fanvil.cfg.hbs`), and update `lastProvisionedAt` / `lastProvisionedIp`.
   - **nginx:** add an explicit, rate-limited `location /prov/` outside the `auth_request` gate in `42-nginx.sh`. Today `/prov/` would fall into the gated `location /` and return 404 to every phone.
   - **Resync:** a `check-sync` NOTIFY has to come from Kamailio, which holds the registrations. FreeSWITCH's `flush_inbound_reg` finds nothing here.
   - **FS PBX Best Practice — Rendered Config Preview (`GET /api/devices/:id/preview`):** Allow `owner` / `admin` to inspect the exact rendered XML/CFG for a device in the UI (with `sipPassword` masked unless explicitly toggled) to debug BLF/line key assignments without rebooting a physical desk phone.
   - **OpenWeb PBX Best Practice — One-Time 10-Minute QR Code Enrollment (`POST /api/devices/:id/enroll-qr`):** Generate a single-use token stored in Redis (`qwixbox:enroll:<token>`, `EX 600`) and return a QR payload (`GET /prov/enroll/:token`) for mobile SIP softphones (Groundwire / Linphone / QwixBox mobile). The token is deleted via `GETDEL` on first scan so screenshots cannot be reused.
4. **Remove Mock Fallback:**
   - Switch `devices` in `portal/web/src/lib/api.ts` from `getWithFallback` to `api.get`, and remove `<MockFeatureBanner />` from `devices.tsx`.

---

### 2.4 Contacts, Vendor-Normalized Phonebooks & Inbound CNAM Lookup (`contacts.tsx`)

**Current State:**
- `portal/web/src/routes/_app/contacts.tsx` is backed by `portal/web/mock/data.ts`.

**Implementation Plan (Informed by FS PBX's Remote Phonebook Generator & `mod_cidlookup`):**
1. **Database Schema & CRUD (`portal/api/src/db/schema.ts` & `routes/contacts.ts`):**
   - Add `contact`: `id`, `organizationId`, `ownerExtensionId` (nullable — `null` = shared company contact, non-null = personal contact), `firstName`, `lastName`, `organization`, `numbers` (`jsonb` array of `{ type: "work" | "mobile" | "home" | "fax", number: string }`), `email`, `speedDialCode`, `vip` (`boolean`).
   - Add `contact: ["create", "read", "update", "delete"]` to `statement` in `portal/api/src/auth.ts`, and mount `/api/contacts` via `crudRoutes` (plus CSV import/export).
2. **Redis Caller-ID Name Enrichment (`portal/api/src/services/cache.ts` & `destination.lua`):**
   - In a new `cacheContacts(organizationId)`, called from `rebuildTenant()`, write shared contacts into Redis under `qwixbox:cid:<domain>:<e164>` -> `firstName + " " + lastName`. Strip `%` and control characters from the names. Register `qwixbox:cid:${domain}:*` in `keys.tenantPatterns` in `portal/api/src/services/redis.ts`.
   - Inbound DID calls never reach `xml_handler.lua` (§0.3). Do the lookup in `destination.lua`, which every DID passes through on both tiers, and overwrite `effective_caller_id_name` so desk phones and CDRs show the contact's name. Normalize the caller number first.
3. **Vendor-Normalized Remote XML Phonebooks (`GET /prov/:token/directory.xml`):**
   - Adopt **FS PBX's vendor-specific XML serialization**:
     - For **Grandstream** (`User-Agent` or device `vendor === "grandstream"`): group internal extensions and external contacts into `<AddressBook><Contact>...</Contact></AddressBook>` with multiple `<Phone type="Work|Cell|Home">` children per person.
     - For **Yealink / Poly / Fanvil**: emit `<YealinkIPPhoneDirectory><DirectoryEntry><Name>...</Name><Telephone>...</Telephone></DirectoryEntry></YealinkIPPhoneDirectory>`.
4. **Remove Mock Fallback:**
   - Switch `contacts` in `portal/web/src/lib/api.ts` from `getWithFallback` to `api.get`, and remove `<MockFeatureBanner />` from `contacts.tsx`.

---

### 2.5 SMS / MMS Messaging & Mandatory Opt-Out Enforcement (`messages.tsx`)

**Current State:**
- `portal/web/src/routes/_app/messages.tsx` has SMS Conversation and Opt-Out tabs backed by `portal/web/mock/data.ts`.

**Implementation Plan (Aligned with `docs/design/backlog.md`):**
1. **Database Schema (`portal/api/src/db/schema.ts`):**
   - Add `smsProvider`: `id`, `organizationId`, `vendor` (`telnyx | bandwidth | twilio`), `apiKeyEnc` (AES-256-GCM), `webhookSigningSecretEnc` (AES-256-GCM), `enabled`.
   - Add `smsThread`: `id`, `organizationId`, `didId`, `localNumber`, `remoteNumber`, `assignedExtensionId`, `unreadCount`, `lastMessageAt`.
   - Add `smsMessage`: `id`, `organizationId`, `threadId`, `direction` (`inbound | outbound`), `body`, `mediaUrls` (`text[]`), `status` (`queued | sent | delivered | failed | blocked_opt_out`), `providerMessageId`, `createdAt`.
   - Add `smsOptOut`: `id`, `organizationId`, `localNumber`, `remoteNumber`, `keyword` (`STOP | UNSUBSCRIBE | CANCEL`), `optedOutAt` (unique index on `(organizationId, localNumber, remoteNumber)`).
2. **Inbound Carrier Webhook & Automatic `STOP` Handling (`portal/api/src/routes/sms.ts`):**
   - Verify carrier webhook signatures (`Telnyx-Signature-Ed25519` / `X-Twilio-Signature`).
   - If the inbound body matches `/^\s*(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)\s*$/i`, automatically insert into `smsOptOut` before returning `200 OK`; if `START` or `UNSTOP`, remove the opt-out record.
3. **Outbound Send Service with Structural Opt-Out Gate:**
   - Implement a single `sendSms(organizationId, fromDid, toNumber, body, mediaUrls)` function that checks `smsOptOut` **before** invoking any carrier adapter. If opted out, persist the row with `status = "blocked_opt_out"` and return `422 Unprocessable Entity` (`RECIPIENT_OPTED_OUT`).
   - The inbound webhook needs its own nginx `location` outside the session gate. `apiKeyEnc` is not covered by the write-side audit redaction (§0.1), so fix that first. Add an `sms` permission to `statement`.
4. **Remove Mock Fallback:**
   - Switch `smsThreads` and `smsOptOuts` in `portal/web/src/lib/api.ts` from `getWithFallback` to `api.get`, and remove `<MockFeatureBanner />` from `messages.tsx`.

---

### 2.6 WebRTC Softphone & Live Receptionist Switchboard (`WebphoneDrawer.tsx`)

**Current State (checked):**
- Kamailio has `WITH_WEBRTC` (`websocket.so`, `xhttp.so`), defined only when `ENABLE_WEBRTC=1` (the default) and the TLS certificate is ready. rtpengine is in its media path. All of it is **configured but untested**: no browser has ever connected (roadmap item 14). There is **no** `extension.webrtcEnabled` column.
- `portal/web/src/components/WebphoneDrawer.tsx` is a pure UI timer mockup (`useEffect` incrementing `seconds` every `1000ms` with no `SIP.js` connection).

**Implementation Plan (Informed by OpenWeb PBX's Webphone & Switchboard):**
1. **Ephemeral Webphone Credentials Endpoint (`GET /api/me/webphone-credentials`):**
   - First needs `extension.userId` (§0.2), plus a per-extension WebRTC flag, which has to be added. Prefer a dedicated WebRTC `userDevice` credential or a short-lived token that Kamailio verifies. Do not hand the desk phone's long-lived SIP password to the browser, where any XSS would turn it into toll fraud.
2. **Real `SIP.js` Client in `portal/web/src/components/WebphoneDrawer.tsx`:**
   - Add `sip.js` to `portal/web/package.json`.
   - Instantiate `UserAgent`, `Registerer`, and `Inviter` / `Invitation` handlers in `WebphoneDrawer.tsx`, binding remote media streams to a hidden `<audio autoPlay />` element and wiring Mute (`sessionDescriptionHandler.peerConnection.getSenders()`), Hold (`session.invite({ sessionDescriptionHandlerModifiers: [holdModifier] })`), DTMF (`session.info`), and Blind/Attended Transfer (`session.refer`).
3. **Live Receptionist Switchboard (`portal/api/src/routes/calls.ts`):**
   - Before any of this can be tenant-scoped, both dialplan tiers must set a tenant channel variable (e.g. `qwixbox_org`) on every result. `organization_id` comes from directory variables that are never applied (`auth-calls=false`), and `sip_h_X-Tenant-ID` is absent on inbound PSTN legs. Filter on the new variable, and refuse to act on any UUID that does not carry this tenant's value.
   - Expose active tenant calls via ESL (`show channels as json`, or a persistent `CHANNEL_*` event subscriber; `services/esl.ts` is one-shot today):
     - `GET /api/calls/active` (active calls for the tenant).
     - `POST /api/calls/:uuid/transfer` (`uuid_transfer <uuid> <dest> XML tenant_<org>` via ESL).
     - `POST /api/calls/:uuid/park` (`uuid_transfer <uuid> <parkExt> XML tenant_<org>`; the context is `tenant_<organizationId>`, not the domain).
     - `POST /api/calls/:uuid/hangup` (`uuid_kill` via ESL).
     - `POST /api/calls/:uuid/eavesdrop` (originate `user/<supExt>@<domain>` executing `eavesdrop <uuid>`. FreeSWITCH cannot reach phones through `sofia/internal`).
   - Add a `call` permission to `statement` for these routes.

---

## Phase 3: High-Leverage Best Practices from the Reference Apps

### 3.1 "Where Will This Call Go?" Simulator & Temporary Office-Hours Override (from OpenWeb PBX)

- **Why:** Time conditions, holidays, IVRs, and ring groups form deep trees (`MAX_DEPTH = 10`). Admins frequently misconfigure holiday ranges or nested fallbacks and have no way to verify routing without placing live test calls.
- **How to Implement in QwixBox:**
  1. **Route Simulator (`POST /api/routing/simulate`):**
     - Accept `{ didPattern, callerNumber, simulatedTimestamp }`.
     - Run a pure TypeScript traversal of the tenant's routing graph (`inboundRoute` -> `timeCondition` at `simulatedTimestamp` in **that condition's own `timezone`** -> `ivr` / `ringGroup` / `queue` / `extension` DND / forward rules) up to `MAX_DEPTH = 10`. There is no `holiday` table: holidays are `invert: true` rules inside `timeCondition.rules`, and a matching inverted rule breaks the loop. This is a second implementation of `time_condition.lua`, so pin the two together with a shared fixture table that both test suites run.
     - Return the step-by-step trace array `[{ step: 1, nodeType: "did", label: "+14165550100" }, { step: 2, nodeType: "time_condition", label: "Business Hours", matched: false, reason: "Holiday: Canada Day" }, { step: 3, nodeType: "voicemail", label: "Ext 100 Voicemail" }]` and render it as a visual flow trace in `portal/web/src/routes/_app/routing.tsx`.
  2. **Temporary Office-Hours Override (`force_match` / `force_no_match` with Auto-Expiry):**
     - Add `overrideMode: text("override_mode")` (`null | "force_match" | "force_no_match"`, following the `match*`/`noMatch*` columns) and `overrideUntil: timestamp("override_until", { withTimezone: true })` to `timeCondition` in `portal/api/src/db/schema.ts`.
     - In `resources/lua/time_condition.lua`, check the override **before** evaluating `rules`. Project an epoch for the expiry in both `cacheTimeConditions()` and `callState(…, "tc", …)`, so the two tiers agree. Once `now() >= overrideUntil`, normal evaluation resumes with no cleanup needed.

---

### 3.2 Day/Night Toggle (`day_night`) & Event-Driven BLF Lamps (from FusionPBX & FS PBX)

- **Why:** Receptionists want a single physical BLF button on their desk phone (or one-click toggle in the portal) to flip the office between "Day Mode" and "Night Mode" with a red/green LED indicator.
- **How to Implement in QwixBox:**
  1. Add a `dayNightToggle` table (`day_night_toggle`) in `portal/api/src/db/schema.ts`: `id`, `organizationId`, `name`, `number` (e.g. `280`), `featureCode` (e.g. `*280`), `pinEnc`, `state` (`"day" | "night"`), `dayType`, `dayId`, `nightType`, `nightId`. **Do not call it `callFlow`.** `callflow` is already the RBAC resource for ring groups, IVRs and time conditions, and `call-flows.tsx` is their page. Gate the new resource on that existing permission.
  2. Add `"day_night"` to `destinationTypeEnum`, and handle `dtype == "day_night"` in `qwixbox.go()` in `resources/lua/qwixbox.lua`: if `state == "day"`, go to the day destination, otherwise to the night destination. Wire it through the full contract (§0.4).
  3. Toggle via the feature code (matched in **both** tiers, before the directory) or `POST /api/day-night/:id/toggle`.
  4. **BLF lamps cannot work yet.** A FreeSWITCH `PRESENCE_IN` event reaches no phone, because FreeSWITCH holds no subscriptions and Kamailio has no presence modules (§0.5). Ship the toggle first, and track presence separately.

---

### 3.3 Redis-Cached Inbound Call Blocking (`call_block`) (from FS PBX)

- **Why:** Spam callers and toll-fraud probes repeatedly hit DIDs. Blocking them in Redis before ringing extensions or invoking IVRs saves channels and protects users.
- **How to Implement in QwixBox:**
  1. Add `callBlock` table in `portal/api/src/db/schema.ts`: `id`, `organizationId`, `number` (normalized E.164 or prefix), `label`, `matchType` (`exact | prefix`), `action` (`reject | busy | hangup | destination`), `destinationType`, `destinationId`, `hitCount`, `enabled`.
  2. Cache tenant blocklists in Redis (`qwixbox:block:<domain>:<number>`) via `rebuildTenant()` (`portal/api/src/services/cache.ts`), and register `qwixbox:block:${domain}:*` in `keys.tenantPatterns` (`portal/api/src/services/redis.ts`). A `prefix` match cannot be a single `GET`. Either cache exact numbers only, or check each prefix length of the caller number.
  3. Inbound DIDs never reach `xml_handler.lua` (§0.3). Check in the `peer` branch of `fs-xml.ts` before `dispatch()`, and in `destination.lua` (when `qwixbox_did` is set). On a hit, answer `respond 603` (or `486`) without ringing anything. The peer branch already queries Postgres to resolve the DID, so the saving is the ring, not the query.

---

### 3.4 "First Calls" Trunk Readiness Checker & Guided Cutover Test (from OpenWeb PBX)

- **Why:** New tenant onboarding most often fails due to subtle trunk/NAT/DID mismatches (e.g., carrier sending 10-digit DID while `inboundRoute.didPattern` expects `+1` E.164, or missing outbound caller ID).
- **How to Implement in QwixBox:**
  1. Add `GET /api/trunks/:id/readiness` in `portal/api/src/routes/telephony.ts` checking:
     - The trunk's projection in Kamailio: `permissions.addressDump` for IP trunks, `uac.reg_info` for register trunks. Read the output, since `kamcmd` exits 0 on failure.
     - At least one `outboundRoute` references the trunk, uses `patternSyntax = "pcre"` (legacy routes are quarantined from the cache), and has a caller ID from `callerIdOverride` or `tenantSettings.defaultCallerIdNumber` in E.164 format.
     - At least one `inboundRoute` has a mapped destination that passes `badDestination()`.
     - An `isEmergency` route and a default `emergencyLocation` exist for the tenant.
  2. Add `POST /api/trunks/:id/test-call` allowing an admin to trigger a controlled test call and view the SIP response code and Q.850 cause. Originate through the **real outbound path**, e.g. `originate user/<ext>@<domain> &transfer(<test_num> XML tenant_<org>)` or a loopback leg with `X-Auth-User` set. Bridging straight to `sofia/external/<num>@<trunk>` would skip Kamailio's egress pass, fraud checks and `X-Trunk-Target` handling, so it would test a path real calls never take.

---

### 3.5 Phone & Trunk Health Monitor + Controlled Office IP Unblock (from OpenWeb PBX)

- **Why:** A single misconfigured desk phone with an old SIP password at a customer's office can trip Kamailio's `authfail`/`ipban` htables (or fail2ban) for the customer's entire office NAT public IP, taking every phone in that building offline.
- **How to Implement in QwixBox:**
  1. **Controlled Office IP Unblock (`GET /api/security/banned-ips` & `POST /api/security/unban`):**
     - Query Kamailio's `ipban` and `authfail` htables (`kamcmd htable.dump ipban` / `htable.dump authfail`) from `portal/api/src/services/kamailio-sync.ts`. There is no `authban` table.
     - Delete an entry with `kamcmd htable.delete ipban <ip>` (and the same for `authfail`), with an audit log entry. Also cover fail2ban/nftables (`12-fail2ban.sh`) and the responsive firewall (`14-responsive-firewall.sh`), or the address stays blocked at the firewall. The htables are platform-wide, so limit tenant `owner`/`admin` to IPs recently authenticated by their own extensions, and leave arbitrary unbans to the operator. The `superadmin` and `tenant_admin` roles do not exist.
  2. **Endpoint & Trunk Offline Alerting (`portal/api/src/services/health-monitor.ts`):**
     - Periodically compare Kamailio `location` registrations (`usrloc`, `db_mode 2`) against extensions/devices previously seen online. When a device or trunk transitions from online to unreachable for >3 minutes, record a tenant health event and optionally send a webhook/email alert. Start the timer in `src/index.ts`, not `app.ts`.

---

### 3.6 Guarded Restore (`qwixbox-restore`) & Call-Aware Upgrade Drain Mode (from OpenWeb PBX)

- **Why:** `qwixbox-backup` (`resources/conf/backups/qwixbox-backup`, deployed and timed by `steps/51-backups.sh`) writes a custom-format `pg_dump` per database, `pg_dumpall --globals-only`, a `config.tar.gz` that must contain `/etc/qwixbox/config.env`, and a `COMPLETE` marker. Redis is not backed up, and does not need to be: it is a pure cache. No restore has ever been run (`mvp.md` blocker 5), and an upgrade while calls are active can drop them.
- **How to Implement in QwixBox:**
  1. **Create `resources/conf/backups/qwixbox-restore`, deployed by step 51:**
     - Refuse a backup directory without `COMPLETE`. Verify that the dumps and `config.tar.gz` (containing `config.env` and `ENCRYPTION_KEY`) are present before stopping anything.
     - Take a pre-restore safety snapshot. Restore `globals.sql` first, then the `kamailio` and `qwixbox` dumps. Before running `drizzle-kit push --force`, compare schemas, because a backup newer than the code would make it destructive. Then restart services, run the Kamailio sync and rebuild the Redis tenant caches.
  2. **Call-Aware Upgrade Drain Mode in `install.sh`:**
     - Before restarting `freeswitch` (`steps/31-freeswitch-config.sh`) or `rtpengine` (`steps/35-rtpengine.sh`), check `fs_cli -p "$FS_ESL_PASSWORD" -x "show calls count"`. If calls are active (and `--force-restart` was not passed), issue `fsctl pause inbound` and wait up to a configurable drain timeout (`--drain-timeout 120`) before restarting the media plane. Never prompt when `tui_available` is false.

---

## Implementation Sequencing & Effort Summary

Before any of this: fix the pre-existing bugs in plan §1 (911 at the concurrent cap, external forwarding of carrier calls, stale caches on extension disable, seed data shown in production, …) and close `mvp.md` item 1 (two-way audio).

| Phase | Deliverable | Key Files Touched | Replaces Mock Screen? |
| :--- | :--- | :--- | :--- |
| **0** | User ↔ extension binding (`extension.userId`) | `schema.ts`, `extensions.ts` | Prerequisite for 1.3, 1.4, 2.3, 2.4, 2.6 |
| **1.1** | Emergency Calling (E911 ELIN + Kari's Law Alerts + Cap Bypass) | `schema.ts`, `auth.ts`, `telephony.ts`, `extensions.ts`, `cache.ts`, `call-state.ts`, `xml_handler.lua`, `fs-xml.ts`, `kamailio.cfg`, `emergency.tsx` | Yes (`emergency.tsx`) |
| **1.2** | Outbound Route Failover Trunks + `uac` Trunk Registration | `schema.ts`, `cache.ts`, `xml_handler.lua`, `fs-xml.ts`, `kamailio-sync.ts`, `kamailio.cfg`, `34-kamailio-config.sh`, `trunks.tsx` | Enhances `trunks.tsx` / `routing.tsx` |
| **1.3** | Post-Answer Call Recording (`media_bug_answer_req`) + Retention + S3 | `qwixbox.lua`, `destination.lua`, `xml_handler.lua`, `fs-xml.ts`, `routes/recordings.ts`, `qwixbox-maintenance`, `messages.tsx` | Yes (`messages.tsx` Recordings tab) |
| **1.4** | Voicemail API, Audio Streaming & `*97`/`*98` Hardening (MWI needs presence) | `routes/voicemails.ts`, `esl.ts`, `xml_handler.lua`, `fs-xml.ts`, `messages.tsx` | Yes (`messages.tsx` Voicemail tab) |
| **2.1** | Call Queues (`mod_callcenter`), ESL Wallboard & Queue Callbacks | `31-freeswitch-config.sh`, `schema.ts`, `telephony.ts`, `call-state.ts`, `cache.ts`, `redis.ts`, `fs-xml.ts`, `qwixbox.lua`, `queue.lua`, `esl.ts`, `index.ts`, `queues.tsx` | Yes (`queues.tsx`) |
| **2.2** | Conferences (`mod_conference`), Valet Parking & Multi-Rate MOH | `31-freeswitch-config.sh`, `41-api-deploy.sh`, `schema.ts`, destination contract files, `conference.lua`, `conferences.tsx` | Yes (`conferences.tsx`) |
| **2.3** | Multi-Device Extensions, Auto-Provisioning, Preview & QR Enrollment | `schema.ts`, `kamailio-sync.ts`, `routes/devices.ts`, `routes/device-prov.ts`, `42-nginx.sh`, `devices.tsx` | Yes (`devices.tsx`) |
| **2.4** | Contacts, Vendor XML Phonebooks & Redis Inbound CNAM Lookup | `schema.ts`, `routes/contacts.ts`, `cache.ts`, `redis.ts`, `destination.lua`, `fs-xml.ts`, `contacts.tsx` | Yes (`contacts.tsx`) |
| **2.5** | SMS / MMS Threads, Carrier Webhooks & Structural Opt-Out Gate | `schema.ts`, `routes/sms.ts`, `lib/audit.ts`, `42-nginx.sh`, `messages.tsx` | Yes (`messages.tsx` SMS & Opt-Out tabs) |
| **2.6** | WebRTC `SIP.js` Softphone & Live ESL Receptionist Switchboard | `WebphoneDrawer.tsx`, `routes/calls.ts`, `esl.ts`, `xml_handler.lua`, `fs-xml.ts` | Yes (`WebphoneDrawer.tsx`) |
| **3.1** | "Where Will This Call Go?" Simulator & Office-Hours Override | `schema.ts`, `call-state.ts`, `cache.ts`, `time_condition.lua`, `routing.tsx` | Best-Practice Addition |
| **3.2** | Day/Night Toggles (`day_night`). BLF needs presence | `schema.ts`, destination contract files, `qwixbox.lua` | Best-Practice Addition |
| **3.3** | Redis-Cached Inbound Call Blocking (`call_block`) | `schema.ts`, `cache.ts`, `redis.ts`, `fs-xml.ts`, `destination.lua` | Best-Practice Addition |
| **3.4–3.6** | Trunk Readiness Checker, Office IP Unblock, Guarded Restore & Drain Mode | `telephony.ts`, `kamailio-sync.ts`, `resources/conf/backups/qwixbox-restore`, `51-backups.sh`, `31-freeswitch-config.sh`, `35-rtpengine.sh` | Best-Practice Addition |
