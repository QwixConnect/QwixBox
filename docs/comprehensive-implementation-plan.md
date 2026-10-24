# QwixBox Comprehensive Implementation Plan: Codebase Fixes & Phases 1–3

> **Companion Documents:**
> - [`docs/reference.md`](./reference.md) — Cross-Reference Analysis of **FusionPBX**, **FS PBX**, and **OpenWeb PBX** vs. **QwixBox**
> - [`docs/missing-features-implementation.md`](./missing-features-implementation.md) — Executive Feature Summary

This plan specifies the complete engineering implementation for **fixing existing bugs in the QwixBox codebase** and **building all three phases of missing features and reference-app best practices**, written strictly in QwixBox's native stack and design patterns:
- **Runtime & HTTP Framework:** Bun (`Bun.spawn`, `Bun.file`) + Hono (`new Hono<AppEnv>()`)
- **Database & ORM:** PostgreSQL 18 + Drizzle ORM (`pgTable`, `organizationId` tenant boundary, `drizzle-kit push --force`)
- **Authentication & RBAC:** Better Auth (`organization` plugin + `createAccessControl` `ROLES` in `portal/api/src/auth.ts`) + `requireTenant` / `requirePermission` (`portal/api/src/middleware/tenant.ts`) + `crudRoutes` (`portal/api/src/lib/crud.ts`)
- **Call-Time Data Plane:** Kamailio 6.1 edge (`resources/conf/kamailio/kamailio.cfg`) + `rtpengine` + FreeSWITCH 1.11 (`resources/lua/*.lua`) + Redis (`mod_hiredis` + `portal/api/src/services/redis.ts` & `cache.ts`)
- **Frontend Portal:** React 19 + TanStack Router + Mantine (`portal/web/src/routes/_app/*.tsx`) + typed `api` client (`portal/web/src/lib/api.ts`)

> **Status — checked against the code on 2026-10-24.** This is a plan, not a description of the
> system. Every "Location" and "already exists" claim below was re-read against the source on that
> date. Corrections are made inline, and Appendix A lists each one. The twelve bugs in §1 are
> **confirmed by reading the code, not by placing a call**. Prove each fix the way CLAUDE.md
> requires: reproduce the failure first, then re-run the identical sequence after the fix.
>
> **This plan does not override [`mvp.md`](./mvp.md).** Two-way audio has never been confirmed on any
> call, a backup has never been restored, and there has been no amd64 pass. Everything here that
> depends on media (recording, voicemail, queues, conferences, parking, MoH, the webphone) sits
> behind mvp.md item 1, so close that first.

---

## 0. QwixBox Design Patterns & Invariants

Every change in this plan follows these existing codebase patterns (1–7), plus three topology
constraints (8–10) that several features below would otherwise get wrong:

1. **Tenant Scoping via `organizationId`:** Every tenant-owned table in `portal/api/src/db/schema.ts` uses `id: text("id").primaryKey()` (`randomUUID()`) and `organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" })`.
2. **Encrypted Secrets (`*Enc`):** Every password, PIN, API key, or provisioning token is encrypted with `encrypt(plaintext)` from `portal/api/src/lib/crypto.ts` (AES-256-GCM) and stored in a `*Enc` column. `crudRoutes` does **not** strip `*Enc` columns on its own. Each resource's `present` callback has to do it, as `trunks` does with `passwordEnc`. Audit redaction happens in two places, and they do not agree:
   - **On write**, `redact()` in `portal/api/src/lib/audit.ts` matches `/passwordEnc|PinEnc|password|secret|ha1/i`. A column called `apiKeyEnc` (§3.5) would get past it and be stored in `audit_log`. The stored value is ciphertext, but it should not be there at all.
   - **On read**, `redactEnc` in `portal/api/src/routes/audit.ts` drops every key ending in `Enc`.

   Widen the write-side pattern to cover any `Enc$` key before adding new `*Enc` columns.
3. **RBAC Registration (`portal/api/src/auth.ts`):** Every new resource permission is added to `statement` and granted appropriately across `viewer`, `member`, `admin`, and `owner` in `ROLES` (`portal/api/src/auth.ts`). Those four are the only roles. `user`, `tenant_admin` and `superadmin` do not exist. Before adding a permission, check whether it is already there: `recording: ["read", "delete"]` already is, and no route uses it. That is the "configuration wired to nothing" failure mode CLAUDE.md warns about. The name `callflow` is also taken, by ring groups, IVRs and time conditions. See §4.2.
4. **Generic CRUD + Dialplan Sanitization (`portal/api/src/lib/crud.ts` & `dialplan-safe.ts`):** Standard resources mount via `crudRoutes({ table, orgColumn, idColumn, entityType, permission, required, writable, present, validate, beforeDelete, afterChange })`, which automatically enforces `requireTenant`, `requirePermission`, `unsafeDialplanFields(body)`, and `recordAudit(c, ...)`. Custom sub-routes (`/:id/...`) always mount `requireTenant` and `requirePermission`.
5. **Redis Key Registry (`portal/api/src/services/redis.ts` & `cache.ts`):** Every new Redis key shape is added to `keys` and `keys.tenantPatterns(domain)` in `portal/api/src/services/redis.ts` and populated in `rebuildTenant(organizationId)` (`portal/api/src/services/cache.ts`).
6. **Polymorphic Destination Contract. It touches more than three places.** A new destination type added to `destinationTypeEnum` (`portal/api/src/db/schema.ts`) is wired in all of these:
   - `badDestination()` (`portal/api/src/routes/telephony.ts`), which validates on save. Note that it currently rejects `queue` explicitly: `"Queues are not implemented"`.
   - `destinationNumber()` (`portal/api/src/services/call-state.ts`). It only translates `extension` from an id to a number, and every other type passes through by id.
   - `callState(domain, kind, id)` (`call-state.ts`), the Postgres fallback behind `/fs/state`. **The `kind` must equal the Redis key segment.** `qwixbox.fetch(kind, domain, id)` reads `qwixbox:<kind>:<domain>:<id>` first and only falls back to `/fs/state` with the same `kind`.
   - `keys.*` plus `keys.tenantPatterns(domain)` (`portal/api/src/services/redis.ts`), a `cache*()` builder in `services/cache.ts`, and a call to that builder from `rebuildTenant()`. If the type is dialable by number, also call `cacheFeatureNumber()`.
   - `handleDialplan()` in `portal/api/src/routes/fs-xml.ts`. The xml_curl tier does **not** read the `qwixbox:num:` index. It looks up ring groups and IVR menus by number in SQL, explicitly, so a new dialable type needs its own lookup there too.
   - `qwixbox.go(session, domain, dtype, did, depth)` (`resources/lua/qwixbox.lua`), which must forward `depth`.
7. **FreeSWITCH Build & Config (`steps/30-freeswitch.sh` & `steps/31-freeswitch-config.sh`):** Add the module to `FS_AUTOLOAD_ADD` in step 31. Add it to `FS_ENABLE_MODULES` in step 30 only if the stock `modules.conf` does not already build it. Re-adding an enabled module is harmless, but it is not needed. For each autoloaded module, step 31 copies `<mod>.conf.xml` from the vanilla tree, but only if no copy exists. A config we need to control therefore ships in `resources/conf/freeswitch/autoload_configs/`. That whole directory, and `resources/lua`, are already declared in step 31's `# step-inputs:`, so adding a file there needs no edit to that line.
8. **Inbound PSTN calls never reach `xml_handler.lua`.** Kamailio tags carrier traffic `X-Trusted-Peer: 1`, and `xml_handler.lua` declines every such request (`M.dialplan`, first check). An inbound DID call is therefore always resolved by `fs-xml.ts`, on its `peer` branch, and then runs `destination.lua`. Anything that has to act on inbound calls goes on that path, in `fs-xml.ts` or in `destination.lua`/`qwixbox.go`. That includes caller-name lookup (§3.4), call blocking (§4.3) and inbound recording (§2.3). Code added only to `xml_handler.lua` would never run for them.
9. **FreeSWITCH holds no registrations and no subscriptions.** Endpoints register to Kamailio, and FreeSWITCH reaches them by sending calls back out through Kamailio's egress port. Kamailio loads no presence modules (`presence`, `presence_dialoginfo`, `presence_mwi`, `pua*`). It follows that:
   - anything that needs a SIP NOTIFY to reach a phone has no delivery path today. That covers MWI lamps (§2.4), BLF keys (§3.3, §4.2) and `check-sync` reboots (§3.3).
   - `sofia profile ... flush_inbound_reg` and `sofia_contact()` find nothing.
   - `originate sofia/internal/<ext>@...` does not reach a phone. Use `user/<ext>@<domain>`, whose dial-string routes through Kamailio.
10. **FreeSWITCH accepts calls with `auth-calls=false`.** Directory `<user>` variables are therefore **not** applied to calls Kamailio forwards in. On the A-leg, `effective_caller_id_*`, `organization_id` and `user_context` from `renderDirectoryUser()` are absent. The only per-call identity is the headers Kamailio adds: `X-Auth-User` and `X-Tenant-Domain` for an endpoint, `X-Trusted-Peer` for a carrier.

---

## 1. Pre-Phase Remediation: Fixing 12 Existing Bugs in QwixBox

An audit of the codebase against the three reference PBXs found **10 concrete bugs** in QwixBox's current implementation. A re-read on 2026-10-24 found two more (11 and 12). Fix these first, so Phases 1–3 do not build on them. Every one of them is **confirmed by reading the code only**. None has been reproduced on a live call yet.

| # | Severity | Re-check result |
|---|---|---|
| 1 | High | Confirmed. `mvp.md` records the external-forward fix as verified, yet the code still fails a forward of a carrier-originated call, so that test most likely used an internal caller. Reproduce it with a carrier call |
| 2 | Medium | Confirmed, but the reason given below was wrong and has been corrected (see invariant 10) |
| 3 | **Critical** (life safety) | Confirmed. `route[INGRESS]` calls `route(FRAUD)` unconditionally |
| 4 | Low | Partly confirmed. Trusted peers cannot reach `*97`/`*98` in either tier. See the corrected text |
| 5 | Medium | Confirmed. Nothing anywhere runs `record_session` |
| 6 | High | Confirmed |
| 7 | Medium | DND/call-waiting bypass confirmed. The `call_timeout` part is **unverified** |
| 8 | Medium | Confirmed |
| 9 | Medium | Confirmed. `uac.so` is also loaded with no `reg_*` parameters |
| 10 | Low | Confirmed. Every role holds `tenant:read`, so the missing GET gate exposes nothing today |
| 11 | High | New: the production portal shows seed data for unimplemented screens |
| 12 | Medium | New: `recording` permission and `cdr.recordingPath` exist with no route |

### Bug 1: External Call Forwarding (`forwardAllTo` / `forwardBusyTo` / `forwardNoAnswerTo` / IVR -> `external`) Drops All Inbound PSTN Calls

* **Location:** [`resources/lua/extension.lua`](../resources/lua/extension.lua), [`resources/lua/qwixbox.lua`](../resources/lua/qwixbox.lua), [`resources/lua/xml_handler.lua`](../resources/lua/xml_handler.lua), and [`portal/api/src/routes/fs-xml.ts`](../portal/api/src/routes/fs-xml.ts).
* **Root Cause:**
  1. When an inbound call arrives from a carrier trunk, Kamailio sets `X-Trusted-Peer: 1` and no `X-Auth-User`.
  2. When the call reaches `extension.lua` and the extension has `forwardAllTo` (or `forwardBusyTo` / `forwardNoAnswerTo`) set to an external PSTN number (e.g. `+14165559999`), `qwixbox.go(session, domain, "external", ext.forwardAllTo, depth)` calls `session:transfer("+14165559999", "XML", "tenant_<org>")`.
  3. On the transferred dialplan lookup, `variable_sip_h_X-Trusted-Peer` is **still `"1"`** on the channel, and `variable_sip_h_X-Auth-User` is still empty.
  4. `xml_handler.lua` declines the request (`M.dialplan`, at `if p:getHeader("variable_sip_h_X-Trusted-Peer") == "1" then return nil end`), so `handleDialplan()` in `fs-xml.ts` answers it. There, `if (peer) return did ? dispatch(...) : NOT_FOUND;` treats the forwarded destination `+14165559999` as an inbound DID lookup. It finds no DID matching the mobile number and returns `NOT_FOUND`.
  5. Clearing `X-Trusted-Peer` alone is not enough. `outbound()` in `fs-xml.ts` returns `null` unless `authenticated` is true, and `build_outbound` in Lua runs only when `caller` is set. Both need a non-empty `X-Auth-User`. That is why the fix sets one.
* **Fix:**
  1. In [`resources/lua/qwixbox.lua`](../resources/lua/qwixbox.lua), when `dtype == "external"`, unset `sip_h_X-Trusted-Peer`, set `sip_h_X-Tenant-Domain` to `domain`, and if `sip_h_X-Auth-User` is empty, set `sip_h_X-Auth-User` to `sip_h_X-Forwarded-From` or `"pbx_forward"` along with `qwixbox_forwarded=true`:
     ```lua
     elseif dtype == "external" then
       session:execute("unset", "sip_h_X-Trusted-Peer")
       session:execute("set", "sip_h_X-Tenant-Domain=" .. domain)
       local auth_user = session:getVariable("sip_h_X-Auth-User")
       local fwd_from = session:getVariable("sip_h_X-Forwarded-From")
       if not auth_user or auth_user == "" then
         session:execute("set", "sip_h_X-Auth-User=" .. (fwd_from or "forward"))
       end
       session:transfer(did, "XML", "tenant_" .. (M.tenant_id(domain) or domain))
     ```
     `M.tenant_id` does not exist. The current code transfers to the channel's own `context` variable, which is already `tenant_<org>` on both tiers, so keep that. Use the forwarding extension's number as `X-Auth-User`. A bare `"forward"` would make Kamailio's `route[FRAUD]` count every forwarded call against one shared `forward@<domain>` bucket, and since it passes the `^[0-9A-Za-z_.-]+$` caller check in both tiers, nothing would flag it. Treat the forwarded leg as an outbound call by that extension: it is billed and capped as one.
  2. In [`resources/lua/extension.lua`](../resources/lua/extension.lua), release the `limit` hash lock before transferring on `no_answer_treatment`, or only acquire `limit` right before `bridge` so a forwarded call does not hold the extension's concurrency slot if the bridge failed.

---

### Bug 2: Outbound Calls Send Raw Extension Numbers (`101`) as Caller ID When `route.callerIdOverride` Is Null

* **Location:** [`resources/lua/xml_handler.lua`](../resources/lua/xml_handler.lua), [`portal/api/src/routes/fs-xml.ts`](../portal/api/src/routes/fs-xml.ts), and [`portal/api/src/services/cache.ts`](../portal/api/src/services/cache.ts).
* **Root Cause:**
  - `build_outbound` in `xml_handler.lua` and `outbound()` in `fs-xml.ts` only set `effective_caller_id_number` if `route.callerIdOverride` is non-empty.
  - `renderDirectoryUser` does set `effective_caller_id_*` and `outbound_caller_id_*` on the directory `<user>`. But both SIP profiles run with `auth-calls=false` (invariant 10), so those variables are never applied to an A-leg arriving from Kamailio. The caller ID is just the `From` user. Kamailio forces that to equal the auth user (`$au == $fU`), which makes it the extension number.
  - `cacheTenantSettings()` (`portal/api/src/services/cache.ts`) also leaves `defaultCallerIdName` and `defaultCallerIdNumber` out of the cached tenant JSON. The Lua tier therefore has nothing to fall back to.
* **Fix:**
  1. Include `defaultCallerIdName` and `defaultCallerIdNumber` in `cacheTenantSettings()` (`portal/api/src/services/cache.ts`) and `callerIdName` / `callerIdNumber` in `cacheExtension()` (`keys.extensionCall`).
  2. In `xml_handler.lua` (`build_outbound`) and `fs-xml.ts` (`outbound`), resolve outbound Caller ID with explicit precedence:
     `route.callerIdOverride ?? ext.callerIdNumber ?? tenant.defaultCallerIdNumber ?? "${outbound_caller_id_number}"`
     and set both `effective_caller_id_number` and `effective_caller_id_name`.

---

### Bug 3: Kamailio `route[INGRESS]` Rejects Emergency (`911`/`933`/`112`/`999`) Calls When Account Is at `MAX_CONCURRENT_CALLS`

* **Location:** [`resources/conf/kamailio/kamailio.cfg`](../resources/conf/kamailio/kamailio.cfg).
* **Root Cause:**
  - `route[EGRESS]` has an emergency bypass (`if ($hdr(X-Emergency) == "true")`), **but** `route[INGRESS]` runs `route(FRAUD)` on line 362 *before* relaying the call to FreeSWITCH. If an extension or shared office account already has 10 active calls, Kamailio rejects a `911` call on ingress with `486 Busy Here` before FreeSWITCH ever sees it!
* **Fix:**
  - In [`resources/conf/kamailio/kamailio.cfg`](../resources/conf/kamailio/kamailio.cfg), bypass `route(FRAUD)` on ingress when `$rU =~ "^(911|933|112|999)$"`:
    ```kamailio
    route[INGRESS] {
        remove_hf_re("^X-");
        route(AUTH);
        if (!($rU =~ "^(911|933|112|999)$")) {
            route(FRAUD);
        }
    ```
  - Kamailio cannot see which outbound routes a tenant has flagged `isEmergency`, because that decision is made later, in FreeSWITCH. A fixed list in the config is therefore the only practical ingress test. Keep it a superset of every emergency pattern a tenant can configure, and document that pairing in both places. The call must still go through `dlg_manage()` and accounting.
  - Test it under saturation. Hold `MAX_CONCURRENT_CALLS` calls open on one account, dial 911, and confirm the INVITE reaches FreeSWITCH. `mvp.md` item 4 asks for exactly this.

---

### Bug 4: Unauthenticated `*97` / `*98` Voicemail Check Allowed in `xml_handler.lua` and `fs-xml.ts`

* **Location:** [`resources/lua/xml_handler.lua`](../resources/lua/xml_handler.lua) and [`portal/api/src/routes/fs-xml.ts`](../portal/api/src/routes/fs-xml.ts).
* **Root Cause (corrected):**
  - The feature codes `*72`–`*93` reject an unauthenticated caller with `CALL_REJECTED`. `*98`, and `*97` without an authenticated `X-Auth-User`, instead run `voicemail check default <domain>`, which prompts for a mailbox and a PIN.
  - **The exposure is smaller than first claimed.** Both tiers stop trusted-peer (carrier) traffic before they reach feature codes. Lua declines it outright, and `fs-xml.ts` returns from its `peer` branch. A transfer into the context still carries `X-Trusted-Peer`, so the "IVR transfer" or "misrouted trunk" path cannot get there either. In practice, everyone who reaches `*98` today is an authenticated extension, and "any mailbox, with its PIN" is how `*98` is meant to work.
* **Fix (hardening, not an open hole):**
  - Require `caller`/`authenticated` for both codes anyway, as defence in depth against a future path that clears the peer header. Bug 1's fix is such a path. Leave `*98`'s mailbox prompt in place for authenticated callers. `mod_voicemail` already caps attempts with `max-login-attempts=3`.

---

### Bug 5: `tenantSettings.recordingPolicy` Is Stored in DB & Redis but Never Executed on Any Call Leg

* **Location:** [`resources/lua/extension.lua`](../resources/lua/extension.lua), [`resources/lua/ring_group.lua`](../resources/lua/ring_group.lua), [`resources/lua/xml_handler.lua`](../resources/lua/xml_handler.lua), and [`portal/api/src/routes/fs-xml.ts`](../portal/api/src/routes/fs-xml.ts).
* **Root Cause:**
  - `tenantSettings.recordingPolicy` (`none | inbound | outbound | all`) is editable via `PATCH /api/tenant` and cached in `qwixbox:tenant:<domain>`, and `portal/api/src/services/cdr.ts` reads `vars.recording_file`, but nothing in the Lua scripts or XML dialplan ever arms `record_session`.
* **Fix:**
  - Add one shared helper in `resources/lua/qwixbox.lua`. §2.3 calls it `M.arm_recording`; use that name throughout. Add post-answer recording actions (`media_bug_answer_req=true`, `RECORD_STEREO=true`, `execute_on_answer=record_session ...`) to the outbound builders in **both** tiers: `build_outbound` in `xml_handler.lua` and `outbound()` in `fs-xml.ts`. For inbound calls, arm it in `destination.lua`, which every inbound DID passes through (invariant 8), rather than in each destination script. Set `recording_file`, so that `parseCdrXml()` in `portal/api/src/services/cdr.ts` fills `cdr.recordingPath`. It already reads `vars.recording_file`.

---

### Bug 6: Disabling or Deleting an Extension Leaves Stale Routing Pointers in Redis (`qwixbox:did:*`, `qwixbox:ivr:*`, `qwixbox:tc:*`)

* **Location:** [`portal/api/src/routes/extensions.ts`](../portal/api/src/routes/extensions.ts), in the `PATCH /:id` and `DELETE /:id` handlers. Extension numbers are immutable (PATCH rejects `number`), so enable/disable and delete are the only triggers.
* **Root Cause:**
  - `cacheInboundRoutes`, `cacheIvrMenus`, and `cacheTimeConditions` resolve `destinationNumber(org, "extension", id)` (which checks `eq(extension.enabled, true)`) at cache-build time and store the extension's number in Redis.
  - When an extension is disabled (`PATCH /api/extensions/:id` with `{ enabled: false }`) or deleted (`DELETE /api/extensions/:id`), `extensions.ts` only refreshes `cacheExtension` and `cacheRingGroups`. Inbound DIDs, IVR options, and Time Conditions in Redis continue routing to the disabled/deleted extension!
* **Fix:**
  - In `portal/api/src/routes/extensions.ts`, when `before.enabled !== row.enabled` on `PATCH` or on `DELETE`, also call `cacheInboundRoutes(organizationId)`, `cacheIvrMenus(organizationId)`, and `cacheTimeConditions(organizationId)`.
  - Deleting an extension also leaves **dangling Postgres pointers**. `destinationId`, `failoverId`, `timeoutId`, `matchId` and `noMatchId` are plain `text`, with no foreign key. Either refuse the delete while something references the extension (a `beforeDelete`-style check, like `trunks` uses for routes), or clear those references in the same transaction.

---

### Bug 7: Ring Groups Ignore Member `dnd` and `callWaitingEnabled` Settings & Misapply `call_timeout` on Sequential Strategy

* **Location:** [`resources/lua/ring_group.lua`](../resources/lua/ring_group.lua) and [`portal/api/src/services/call-state.ts`](../portal/api/src/services/call-state.ts).
* **Root Cause:**
  - `ring_group.lua` bridges directly to `user/<number>@<domain>`, bypassing `extension.lua`. As a result, a Ring Group member who turned on DND (`*78`) or disabled Call Waiting (`callWaitingEnabled = false`) still gets rung on every Ring Group call.
  - **Unverified:** the claim that `call_timeout`, set once on the A-leg, breaks sequential (`|`) groups after the first member. FreeSWITCH treats each `|` segment as a separate originate attempt, so this has to be tested before anything is changed. Per-leg `[leg_timeout=N]` is still the explicit form and is harmless to adopt. Note too that `random` also uses `|`, so it is sequential in a shuffled order.
* **Fix:**
  - Include `dnd` and `callWaitingEnabled` in the `members` projection in `callState(domain, "rg", id)` (`portal/api/src/services/call-state.ts`).
  - In `resources/lua/ring_group.lua`, skip any member with `m.dnd == true` or (when `m.callWaitingEnabled == false`) `limit_usage hash <domain> <m.number> >= 1`, and set `[leg_timeout=<timeout>]` on each member leg.

---

### Bug 8: Extension `callWaitingEnabled = false` Does Not Count Outbound Calls Placed by That Extension

* **Location:** [`resources/lua/xml_handler.lua`](../resources/lua/xml_handler.lua), [`portal/api/src/routes/fs-xml.ts`](../portal/api/src/routes/fs-xml.ts), and [`resources/lua/extension.lua`](../resources/lua/extension.lua).
* **Root Cause:**
  - `limit hash <domain> <number>` is only executed in `extension.lua` when an extension is **called**, never when an extension **places** an outbound or internal call. Thus, if Extension `101` (`callWaitingEnabled = false`) is on an active outbound PSTN call, `limit_usage hash <domain> 101` is `0`, and incoming calls still ring `101`.
* **Fix:**
  - Whenever an authenticated extension (`caller`) initiates a call in `xml_handler.lua` and `fs-xml.ts`, add `<action application="limit" data="hash ${domain} ${caller}"/>` on the A-leg so `limit_usage hash <domain> <ext>` accurately reflects both inbound and outbound active calls for that extension.

---

### Bug 9: `steps/34-kamailio-config.sh` Omits `uac` Schema Creation

* **Location:** [`steps/34-kamailio-config.sh`](../steps/34-kamailio-config.sh).
* **Root Cause:**
  - `KAM_SCHEMAS="standard auth_db usrloc domain permissions dispatcher dialog acc"` omits `uac`, so the `uacreg` table is never created in the `kamailio` PostgreSQL database. If `subscriber` already exists on an upgrade, new schema files are skipped entirely.
  - Separately, `kamailio.cfg` **does** load `uac.so`, but it sets only `restore_mode`. With no `reg_db_url` or `reg_*` parameters, nothing registers even once the table exists. §2.2 adds those parameters.
* **Fix:**
  - Add `uac` to `KAM_SCHEMAS` in `steps/34-kamailio-config.sh` and apply `uac-create.sql` idempotently: guard it on `to_regclass('public.uacreg')`, outside the existing `subscriber` guard.

---

### Bug 10: `GET /api/tenant` Missing `requirePermission("tenant", "read")` & `PATCH /api/tenant` Ignores Several `tenantSettings` Columns

* **Location:** [`portal/api/src/routes/tenants.ts`](../portal/api/src/routes/tenants.ts), in the `GET /` and `PATCH /` handlers.
* **Root Cause:**
  - `tenants.get("/")` runs `requireTenant` but not `requirePermission("tenant", "read")`. Every role holds `tenant:read`, so nothing is exposed today. The problem is that the gate is remembered rather than structural.
  - `tenants.patch("/")` does not accept `defaultRingTimeoutSec`, `emergencyNotifyEmail`, `emergencyNotifySms` or `stirShakenAttest`, although all four columns exist in `tenantSettings`. It accepts `faxNotifyEmail`, `maxConcurrentCalls`, `timezone`, `defaultCallerIdName`, `defaultCallerIdNumber`, `recordingPolicy` and `stirShakenEnabled`.
  - `tenants.post("/")` and `PATCH /members/:id` gate on `requireRole("owner", "admin")` rather than `requirePermission`. That is a hard-coded role list, which CLAUDE.md asks not to add.
* **Fix:**
  - Add `requirePermission("tenant", "read")` to `tenants.get("/")`. Accept the four fields in `tenants.patch("/")` and validate them in `unsafeTenantSettings()` (`portal/api/src/lib/dialplan-safe.ts`). After a successful PATCH, call `cacheTenantSettings()` so the Lua tier sees the change.

---

### Bug 11 (new): The Production Portal Shows Seed Data for Every Unimplemented Screen

* **Location:** `getWithFallback()` in [`portal/web/src/lib/api.ts`](../portal/web/src/lib/api.ts) and [`portal/web/mock/data.ts`](../portal/web/mock/data.ts).
* **Root Cause:** The twelve roadmap endpoints are `/voicemails`, `/recordings`, `/sms-threads`, `/sms-opt-outs`, `/contacts`, `/queues`, `/queue-agents`, `/emergency-locations`, `/conferences`, `/parking-lots`, `/music-on-hold` and `/devices`. Each is read through `getWithFallback(path, key)`. On a `404` it returns `seedData()[key]`, and the API's `app.notFound` answers `404` for every one of those paths. `mock/data.ts` is imported statically, so it ships in the production bundle. On a live install, a tenant therefore sees invented voicemails, queues and **E911 locations**, under a `MockFeatureBanner`. Any write then fails with a 404.
* **Fix:** Gate the fallback on the Vite dev or mock mode (`import.meta.env.DEV` or the existing mock plugin). In production, render "not available yet". Fake emergency addresses on a live PBX are not acceptable, banner or not. The plan below says "remove the path from `mockByPath`", but no `mockByPath` exists. The real step is to replace `getWithFallback(...)` with `api.get(...)` for that endpoint.

---

### Bug 12 (new): `recording` Permission and `cdr.recordingPath` Are Wired to Nothing

* **Location:** `statement.recording` in [`portal/api/src/auth.ts`](../portal/api/src/auth.ts), `cdr.recordingPath` in `schema.ts`, and `app.ts`.
* **Root Cause:** The RBAC statement grants `recording: ["read", "delete"]`, and the CDR row has a `recordingPath`, but no route reads either one. Meanwhile `qwixbox-maintenance` (`resources/conf/maintenance/qwixbox-maintenance`) deletes files under `$PREFIX/recordings` after `RECORDING_KEEP_DAYS` without touching `cdr.recordingPath`. Once §2.3 lands, the CDR table would point at deleted files.
* **Fix:** This is delivered by §2.3. Note the reconciliation requirement there.

---

## 2. Phase 1: Core MVP & Trunk/Routing Completion

### 2.0 Prerequisite (new): Bind Portal Users to Extensions

Several features below assume a link that **does not exist**: "the user's own extension". These are voicemail scoped to the caller's mailbox (§2.4), recordings scoped to the user (§2.3), webphone credentials (§3.6), "my devices" (§3.3) and personal contacts (§3.4). Nothing in `schema.ts` or `auth-schema.ts` connects a better-auth `user` or `member` to an `extension`.

- Add `extension.userId` (nullable, `references(() => user.id, { onDelete: "set null" })`). A user may own several extensions. The tenant comes from `extension.organizationId`, and the code must check that the user is a member of that organization: a stale binding left after the user is removed from the tenant must grant nothing.
- Every "own extension only" check resolves through this column, per request, the same way roles are re-read from `member` rather than the session.
- Until this exists, scope those endpoints to `admin`/`owner` only rather than guessing.

### 2.1 Emergency Calling (E911 — Kari's Law & RAY BAUM'S Act)

**Current state (checked):** `emergencyLocation` and `extension.emergencyLocationId` exist, and **nothing reads or writes either one** (see `mvp.md` item 4). Emergency classification is not a fixed number list. It is any outbound route with `isEmergency = true` whose PCRE matches the number, and it is offered only to an authenticated caller. The matching route then sets `X-Emergency: true`, which Kamailio's `route[EGRESS]` honours. `extensions.ts` does not accept `emergencyLocationId` today. `tenantSettings.emergencyNotifyEmail` and `emergencyNotifySms` exist and are not writable (Bug 10). No SMS sender exists anywhere, so `emergencyNotifySms` cannot be honoured until §3.5 lands.

#### 1. RBAC & Schema (`portal/api/src/auth.ts` & `portal/api/src/db/schema.ts`)
- `emergencyLocation` and `extension.emergencyLocationId` already exist in [`portal/api/src/db/schema.ts`](../portal/api/src/db/schema.ts).
- Add `defaultEmergencyLocationId` to `tenantSettings` in `portal/api/src/db/schema.ts`:
  ```ts
  defaultEmergencyLocationId: text("default_emergency_location_id"),
  ```
- In [`portal/api/src/auth.ts`](../portal/api/src/auth.ts), add `emergency: ["create", "read", "update", "delete"]` to `statement` (`viewer`: `["read"]`, `member`: `["read"]`, `admin`/`owner`: `["create", "read", "update", "delete"]`).

#### 2. CRUD & Extension Assignment (`portal/api/src/routes/telephony.ts` & `extensions.ts`)
- Mount `emergencyLocations` via `crudRoutes` in `portal/api/src/routes/telephony.ts` and register `app.route("/api/emergency-locations", emergencyLocations)` in `portal/api/src/app.ts`:
  ```ts
  export const emergencyLocations = crudRoutes({
    table: emergencyLocation,
    orgColumn: emergencyLocation.organizationId,
    idColumn: emergencyLocation.id,
    entityType: "emergency_location",
    permission: "emergency",
    required: ["label", "street", "city", "region", "postalCode"],
    writable: [
      "label",
      "street",
      "unit",
      "city",
      "region",
      "postalCode",
      "country",
      "callbackNumber",
    ],
    validate: async (body) => {
      if (body.callbackNumber && !diallable(body.callbackNumber)) {
        return "callbackNumber must be diallable digits";
      }
      return null;
    },
    afterChange: async (organizationId) => {
      await rebuildTenant(organizationId);
    },
  });
  ```
- In `portal/api/src/routes/extensions.ts`, accept `emergencyLocationId` in `POST /api/extensions` and `PATCH /api/extensions/:id` (validating ownership via `tenantOwns(emergencyLocation, ...)`).

#### 3. Call-Time ELIN Injection & Kari's Law Notification (`resources/lua/emergency.lua` & `portal/api/src/routes/fs-state.ts`)
- In `cacheExtension()` (`portal/api/src/services/cache.ts`) and `callState(domain, "call", number)` (`portal/api/src/services/call-state.ts`), include the resolved `emergencyCallbackNumber` and `emergencyLocationLabel` (from `extension.emergencyLocationId` falling back to `tenantSettings.defaultEmergencyLocationId`, then `tenantSettings.defaultCallerIdNumber`).
- Create `resources/lua/emergency.lua`:
  - Invoked on emergency outbound routes (`route.isEmergency == true`) before `bridge`:
    1. Fetches the calling extension's cached profile (`qwixbox.fetch("call", domain, caller)`).
    2. Sets `effective_caller_id_number` to `ext.emergencyCallbackNumber` (if `route.callerIdOverride` is not set) so the PSAP receives the floor/building ELIN (RAY BAUM'S Act).
    3. Fires a non-blocking notification POST to a **new** `/fs/emergency` hook, authenticated like `/fs/feature` (`X-Gateway-Secret`), through `qwixbox.api_post()`. `/fs/state` is the wrong place: it is a read-only `{domain, kind, id}` lookup that returns `callState()`, and it should stay side-effect free. Run the POST from a background API job (`bgapi`/`luarun`) so a slow API never delays the 911 bridge. The API then sends immediate Kari's Law alert emails (`sendMail` in `portal/api/src/lib/mail.ts`) to `tenantSettings.emergencyNotifyEmail` with caller extension, display name, dialed emergency number, location address (`label`, `street`, `unit`, `city`, `region`, `postalCode`), and timestamp.

  - The ELIN must be set in **both** tiers. The emergency branch of `fs-xml.ts` `outbound(true)` serves every call while Redis is cold.
- Kamailio's ingress bypass is Bug 3. Ship it with this section, not after it.

#### 4. Portal Frontend (`portal/web/src/routes/_app/emergency.tsx`)
- Switch `emergencyLocations` in [`portal/web/src/lib/api.ts`](../portal/web/src/lib/api.ts) from `getWithFallback(...)` to `api.get(...)` (Bug 11), and remove `<MockFeatureBanner />` from `emergency.tsx`.

---

### 2.2 Outbound Route Failover Trunks & Registration-Based Trunks (`uacreg`)

**Current state (checked):** `outboundRoute.trunkId` is a single foreign key (`onDelete: "restrict"`). Kamailio's `failure_route[MANAGE_CARRIER_FAILOVER]` only logs a carrier failure. Its comment already says failover belongs in the FreeSWITCH dialplan, because only FreeSWITCH still has the dialled number. Trunk credentials are `trunk.username` and `trunk.passwordEnc`, set through `PUT /api/trunks/:id/password`. Register-mode trunks are rejected while enabled (`trunks.validate`) and are filtered out of both `cacheRouteTable()` and `fs-xml.ts` (`eq(trunk.authMode, "ip")`).

#### 1. Ordered Failover Trunks on Outbound Routes (from OpenWeb PBX)
- Add `backupTrunkId` to `outboundRoute` in [`portal/api/src/db/schema.ts`](../portal/api/src/db/schema.ts):
  ```ts
  backupTrunkId: text("backup_trunk_id").references(() => trunk.id, {
    onDelete: "set null",
  }),
  ```
- Include `backupTrunkId` in `outboundRoutes.writable` and validate ownership in `portal/api/src/routes/telephony.ts`.
- Include `backupTrunk` in `CachedRoute` (`portal/api/src/services/cache.ts`).
- In `resources/lua/xml_handler.lua` (`build_outbound`) and `portal/api/src/routes/fs-xml.ts` (`outbound`), emit OpenWeb PBX's Q.850 network-failure-only `continue_on_fail` list followed by a secondary `bridge` when `backupTrunk` is present:
  ```xml
  <action application="set" data="continue_on_fail=NORMAL_TEMPORARY_FAILURE,SWITCH_CONGESTION,NO_ROUTE_DESTINATION,NORMAL_CIRCUIT_CONGESTION,NETWORK_OUT_OF_ORDER,DESTINATION_OUT_OF_ORDER,GATEWAY_DOWN,RECOVERY_ON_TIMER_EXPIRE,EXCHANGE_ROUTING_ERROR"/>
  <action application="set" data="sip_h_X-Trunk-ID=${primary.id}"/>
  <action application="set" data="sip_h_X-Trunk-Target=${primaryHost}:${primary.port};transport=${primary.transport}"/>
  <action application="bridge" data="sofia/external/${number}@${egress}"/>
  <!-- Only reached if primary trunk failed with a network/5xx/timeout cause above -->
  <action application="set" data="sip_h_X-Trunk-ID=${backup.id}"/>
  <action application="set" data="sip_h_X-Trunk-Target=${backupHost}:${backup.port};transport=${backup.transport}"/>
  <action application="bridge" data="sofia/external/${number}@${egress}"/>
  ```

#### 2. Registration-Based Trunks (`authMode = "register"`) via Kamailio `uacreg`
- In [`resources/conf/kamailio/kamailio.cfg`](../resources/conf/kamailio/kamailio.cfg), add `uac` registration parameters:
  ```kamailio
  modparam("uac", "restore_mode", "none")
  modparam("uac", "reg_db_url", DBURL)
  modparam("uac", "reg_db_table", "uacreg")
  modparam("uac", "reg_timer_interval", 60)
  modparam("uac", "reg_retry_interval", 120)
  modparam("uac", "reg_contact_addr", "@PBX_FQDN@:@SIP_PORT@")
  ```
- In [`portal/api/src/services/kamailio-sync.ts`](../portal/api/src/services/kamailio-sync.ts), extend `syncTrunkAddress(trunk)` and `removeTrunkAddress(trunkId)`:
  - When `trunk.authMode === "register"` and `trunk.enabled`:
    - Resolve the carrier host (IP literal or DNS `A` record via `dns.promises.lookup`) into `address` so inbound INVITEs from the registered carrier pass `allow_source_address("1")`.
    - Decrypt `trunk.passwordEnc` via `decrypt()` and upsert into Kamailio's `uacreg` table (`l_uuid = trunk.id.slice(0, 64)`, `l_username = trunk.username`, `l_domain = sipDomain`, `r_username = trunk.username`, `r_domain = trunk.fromDomain ?? trunk.host`, `realm = trunk.fromDomain ?? trunk.host`, `auth_username = trunk.username`, `auth_password = plaintext`, `auth_proxy = "sip:" + trunk.host + ":" + trunk.port + ";transport=" + trunk.transport`, `expires = 3600`).
  - Add `"uac.reg_reload"` to `reloadKamailio()` in `portal/api/src/services/kamailio-sync.ts`.
  - Remove the `"Carrier registration is not implemented"` blocker in `trunks.validate` (`portal/api/src/routes/telephony.ts`). Allow `authMode === "register"` trunks in the `trunkRow.authMode === "ip"` filter in `cacheRouteTable()` and in the `eq(trunk.authMode, "ip")` join in `fs-xml.ts`.
  - Requires Bug 9, which creates the `uacreg` table. Registering is only half of it. Outbound INVITEs to a register-mode carrier also need **digest-challenge handling** on the egress pass: `uac_auth()` in a failure route on 401/407, using credentials from `uacreg`. That is what CLAUDE.md means by "registration/challenge handling". Without it, the trunk registers and then every call to it is challenged and fails.
  - IP-auth trunks must remain IP literals (`isIP` check). Do not loosen that for register trunks: resolving a hostname into `address` at sync time goes stale when the carrier changes IPs.

---

### 2.3 Post-Answer Call Recording, `/api/recordings` & Offsite Archiving

**Current state (checked):** There is no recording code (Bug 5) and no route (Bug 12). `tenantSettings.recordingPolicy` exists. A per-tenant retention column does **not**: retention is global, `RECORDING_KEEP_DAYS` in `config.env`, applied by `qwixbox-maintenance`'s `find "$PREFIX/recordings" -mtime +N -delete`. `cdr` has `recordingPath` but no `recorded` flag.

#### 1. Post-Answer Recording Hook (OpenWeb PBX Pattern)
- Record under `$PREFIX/recordings/<sipDomain>/YYYY/MM/DD/`, which is `/usr/local/freeswitch/recordings` by default. That is the directory `qwixbox-maintenance` already prunes and the `freeswitch` user can already write. Do not introduce a second root such as `/var/lib/freeswitch/recordings`. Give the API service user read access through group membership in `steps/41-api-deploy.sh`.
- In `resources/lua/qwixbox.lua`, add `M.arm_recording(session, domain, direction)`:
  - Reads `tenant = M.tenant(domain)`.
  - Checks if `tenant.recordingPolicy == "all"` or `tenant.recordingPolicy == direction`.
  - Sets:
    ```lua
    local uuid = session:get_uuid()
    local date_path = os.date("!%Y/%m/%d")
    local dir = "/usr/local/freeswitch/recordings/" .. domain .. "/" .. date_path
    local path = dir .. "/" .. uuid .. ".wav"
    session:setVariable("media_bug_answer_req", "true")
    session:setVariable("RECORD_STEREO", "true")
    session:setVariable("recording_file", path)
    session:setVariable("execute_on_answer", "record_session " .. path)
    ```
  - Using `media_bug_answer_req=true` + `execute_on_answer=record_session` guarantees that:
    1. FreeSWITCH never converts `180 Ringing` into silent `183 Session Progress` early media before the B-leg answers.
    2. Unanswered/abandoned calls never create 0-byte WAV files on disk.
    3. `vars.recording_file` is automatically present in the XML CDR, so `parseCdrXml()` in [`portal/api/src/services/cdr.ts`](../portal/api/src/services/cdr.ts) stores `cdr.recordingPath` with zero changes to the CDR parser.
  - Do not shell out from Lua. The earlier draft's `os.execute("mkdir -p " .. dir)` was removed. Confirm on the target build that `record_session` creates missing parent directories. If it does not, create the per-domain tree from the API when a tenant is provisioned.
  - Read the prefix from the environment (`runtime.env`/`freeswitch.env`) rather than hard-coding `/usr/local/freeswitch`, so a non-default `PREFIX` keeps working.
  - Arm it in both tiers and on the inbound peer path (invariant 8, Bug 5).

#### 2. Recordings API (`portal/api/src/routes/recordings.ts`)
- Create `portal/api/src/routes/recordings.ts` and mount at `/api/recordings` in `portal/api/src/app.ts`:
  - `GET /api/recordings` (`requireTenant`, `requirePermission("recording", "read")`): queries `cdr` where `eq(cdr.organizationId, org)` and `isNotNull(cdr.recordingPath)`, returning metadata (`id`, `callUuid`, `direction`, `callerNumber`, `callerName`, `destinationNumber`, `startedAt`, `durationSec`, `billsecSec`, `onDisk`).
  - `GET /api/recordings/:id/audio` (`requireTenant`, `requirePermission("recording", "read")`): validates path confinement under `/usr/local/freeswitch/recordings/<sipDomain>/` (preventing path traversal, matching `faxPath` in `portal/api/src/services/fax.ts`) and streams `Bun.file(safePath)` with `Content-Type: audio/wav`.
  - `DELETE /api/recordings/:id` (`requireTenant`, `requirePermission("recording", "delete")`): unlinks the file on disk, sets `cdr.recordingPath = null`, and writes an `auditLog` entry.
  - The `recording` permission already exists. **Do not add it again.** `viewer` has no `recording` grant at all, while `member` has `read`. Decide deliberately whether `member` sees every tenant recording or only recordings for their own extensions, which needs §2.0.
- **Retention reconciliation:** `qwixbox-maintenance` deletes old files without touching `cdr.recordingPath`. Either make the listing report `onDisk: false` (stat each file), or have the maintenance job null `recording_path` for rows older than `RECORDING_KEEP_DAYS`. Per-tenant retention needs a new `tenantSettings.recordingRetentionDays` column, which does not exist, and pruning per domain directory.
- Switch `recordings` in `portal/web/src/lib/api.ts` from `getWithFallback` to `api.get`.

---

### 2.4 Voicemail API, Audio Streaming, MWI (Blocked on Presence) & `*97`/`*98` Hardening

#### 1. Voicemail Service & API (`portal/api/src/routes/voicemails.ts`)
- FreeSWITCH `mod_voicemail` stores messages per-tenant in `/usr/local/freeswitch/storage/voicemail/default/<sipDomain>/<extNumber>/` and tracks metadata in `/usr/local/freeswitch/db/voicemail_default.db` (SQLite, or PostgreSQL when `odbc-dsn` is configured in `voicemail.conf.xml`).
- **Do not point `mod_voicemail` at the `qwixbox` database.** The earlier draft set `odbc-dsn` to `dbname=qwixbox`. The API's schema reaches that database through `drizzle-kit push --force`, and `drizzle.config.ts` has no `tablesFilter`. Tables that are not in `schema.ts`, such as `voicemail_msgs` and `voicemail_prefs`, are candidates for being dropped on the next install re-run, and `--force` skips the confirmation. Use one of these instead:
  1. *(Preferred)* Keep `mod_voicemail` on its SQLite store and read it through ESL: `vm_list <ext>@<domain> xml`, `vm_read`, `vm_delete`. That adds no new credentials and no schema coupling.
  2. Give it a separate database, e.g. `freeswitch`, created in `22-provision-databases.sh`, with its own role, and read it from the API over a separate pool. This mirrors `kamailio-sync.ts`.

  If you choose option 2 anyway, add a `tablesFilter` to `drizzle.config.ts` and prove on a scratch database that a push leaves foreign tables alone. A database password in a FreeSWITCH config file also needs the same 0640 `root:freeswitch` treatment as the ESL XML.
- Create `portal/api/src/routes/voicemails.ts` and mount at `/api/voicemails` in `portal/api/src/app.ts`:
  - `GET /api/voicemails`: lists messages where `domain = tenant.sipDomain`. Scoping a `member` to their own mailbox needs §2.0, because no user↔extension link exists. The roles are `owner`/`admin`/`member`/`viewer`. Add a `voicemail` permission to `statement`; none exists.
  - `GET /api/voicemails/:uuid/audio`: verifies path confinement under `/usr/local/freeswitch/storage/voicemail/default/<sipDomain>/` and streams `Bun.file(filePath)` (`audio/wav`).
  - `PATCH /api/voicemails/:uuid`: marks a message read or unread through ESL `vm_read <ext>@<sipDomain> <read|unread> <uuid>`. `vm_mwi` is not a `mod_voicemail` API command.
  - `DELETE /api/voicemails/:uuid`: calls `esl` `vm_delete <ext>@<sipDomain> <uuid>`, which removes the row and the WAV file.
  - `services/esl.ts` today exposes only `flushXmlCache`, `status` and `showCalls` over a one-shot connection. Add a generic, argument-validated `api(cmd)` helper. Never interpolate unvalidated input into an ESL command.

#### 2. MWI Lamps: No Delivery Path Yet
- `mod_voicemail` raises MWI events, but FreeSWITCH holds no registrations or subscriptions (invariant 9), so its `NOTIFY message-summary` has nowhere to go. The earlier draft's "MWI lamps update immediately" claim does not hold in this topology.
- Making it work means presence on the Kamailio side: `presence` + `presence_mwi` (and `pua`), with FreeSWITCH publishing to it. Alternatively, FreeSWITCH can send unsolicited NOTIFYs routed through Kamailio's egress port. Treat that as its own piece of work, and prove it with a real desk phone.

#### 3. `*97`/`*98`
- Covered by Bug 4.

---

## 3. Phase 2: Replacing All 6 Mock-Backed Screens & Mock Webphone

### 3.1 Call Queues (`mod_callcenter`), ESL Wallboard & Queue Callbacks (`queues.tsx`)

#### 1. FreeSWITCH Module & Config (`steps/31-freeswitch-config.sh`)
- `applications/mod_callcenter` is already in `FS_ENABLE_MODULES` in [`steps/30-freeswitch.sh`](../steps/30-freeswitch.sh).
- Add `mod_callcenter` to `FS_AUTOLOAD_ADD` in [`steps/31-freeswitch-config.sh`](../steps/31-freeswitch-config.sh) and ship `resources/conf/freeswitch/autoload_configs/callcenter.conf.xml`. Do not rely on the vanilla copy: step 31 would install the vanilla one if ours were missing, and that one defines a sample queue.
- Queues and agents are created at runtime with `callcenter_config queue load|reload` and `callcenter_config agent add|set|del`, not by templating the config. Name queues `<id>@<sipDomain>` so two tenants can never collide.

#### 2. Schema Additions (`portal/api/src/db/schema.ts`)
- The existing `queue` table has `number`, `name`, `strategy` (free text, default `longest-idle-agent`), `mohSound`, `maxWaitSec`, `timeoutType`/`timeoutId` and `enabled`. `"queue"` is already in `destinationTypeEnum`. Expand that table in [`portal/api/src/db/schema.ts`](../portal/api/src/db/schema.ts), and add `queueAgent` and `queueCallback`. Constrain `strategy` to `mod_callcenter`'s names in `validate`, since the column itself is unconstrained text:
  ```ts
  // Additional columns on queue:
  maxWaitNoAgentSec: integer("max_wait_no_agent_sec").default(90).notNull(),
  wrapUpSec: integer("wrap_up_sec").default(10).notNull(),
  slaTargetSec: integer("sla_target_sec").default(20).notNull(),
  callbackEnabled: boolean("callback_enabled").default(false).notNull(),
  callbackMode: text("callback_mode").default("keep_position").notNull(), // "keep_position" | "live_first"
  recordCalls: boolean("record_calls").default(false).notNull(),

  export const queueAgent = pgTable(
    "queue_agent",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      queueId: text("queue_id")
        .notNull()
        .references(() => queue.id, { onDelete: "cascade" }),
      extensionId: text("extension_id")
        .notNull()
        .references(() => extension.id, { onDelete: "cascade" }),
      tierLevel: integer("tier_level").default(1).notNull(),
      tierPosition: integer("tier_position").default(1).notNull(),
      status: text("status").default("Available").notNull(), // "Available" | "On Break" | "Logged Out"
      wrapUpTimeSec: integer("wrap_up_time_sec").default(10).notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
      uniqueIndex("queue_agent_unique_idx").on(table.queueId, table.extensionId),
      index("queue_agent_org_idx").on(table.organizationId),
    ],
  );

  export const queueCallback = pgTable(
    "queue_callback",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      queueId: text("queue_id")
        .notNull()
        .references(() => queue.id, { onDelete: "cascade" }),
      callerNumber: text("caller_number").notNull(),
      callerName: text("caller_name"),
      status: text("status").default("pending").notNull(), // "pending" | "dialing_agent" | "dialing_caller" | "completed" | "failed"
      requestedAt: timestamp("requested_at").defaultNow().notNull(),
      completedAt: timestamp("completed_at"),
    },
    (table) => [index("queue_callback_org_idx").on(table.organizationId)],
  );
  ```

#### 3. Destination & Lua Runtime (`resources/lua/queue.lua` & `qwixbox.lua`)
- Remove `if (effectiveType === "queue") return "Queues are not implemented";` in [`portal/api/src/routes/telephony.ts`](../portal/api/src/routes/telephony.ts) and add `case "queue": return tenantOwns(queue, queue.organizationId, queue.id, id_, organizationId);`.
- Add `kind === "queue"` to `callState()` (`portal/api/src/services/call-state.ts`), `keys.queue(domain, id)` to `portal/api/src/services/redis.ts`, and `cacheQueues(organizationId)` to `portal/api/src/services/cache.ts` (including `cacheFeatureNumber(tenant.sipDomain, q.number, "queue", q.id)`).
- Add `elseif dtype == "queue" then` in `resources/lua/qwixbox.lua` (`session:execute("lua", string.format("queue.lua %s %s %d", domain, did, depth))`).
- Create `resources/lua/queue.lua`:
  - Fetches queue config via `qwixbox.fetch("queue", domain, id)`.
  - Arms recording if `q.recordCalls` or tenant `recordingPolicy` applies.
  - If `q.callbackEnabled` is true, lets callers press `1` during the MOH wait to request a callback. Use `mod_callcenter`'s own exit-key handling, or `bind_digit_action`; `bind_meta_app` needs a `*` prefix. The script confirms the number, posts to a **new** `/fs/queue-callback` hook through `qwixbox.api_post()` (not `/fs/state`, which is read-only), plays a confirmation and hangs up. "Keeps its position" needs a worker that re-originates the callback when that slot comes up. Nothing like that exists yet, so plan it explicitly.
  - Executes `session:execute("callcenter", string.format("%s@%s", q.id, domain))`.
  - If `cc_cancel_reason == "TIMEOUT"` or `"NO_AGENT_TIMEOUT"` and `q.timeoutType` is set, dispatches to `qwixbox.go(session, domain, q.timeoutType, q.timeoutId, depth)`.

#### 4. API Routes & ESL Sync (`portal/api/src/routes/queues.ts` & `services/esl.ts`)
- Mount `/api/queues` and `/api/queue-agents` in `portal/api/src/app.ts`.
- Add ESL helpers in `portal/api/src/services/esl.ts` (`syncCallcenterQueue`, `syncCallcenterAgent`, `getQueueLiveStats`) to synchronize queues, agents, and tiers into `mod_callcenter` via `callcenter_config` ESL commands and expose live wallboard metrics (`GET /api/queues/wallboard`).
- `esl.ts` is a **one-shot command client** that opens a socket, sends one `api` command and closes. A wallboard and agent-state history need a **persistent event subscription** (`event plain CUSTOM callcenter::info`). That is a new long-lived consumer. Start it in `src/index.ts`, which owns the background workers (`app.ts` must stay timer-free), and reconnect on loss. Also re-sync every queue and agent into `mod_callcenter` after a FreeSWITCH restart, because its runtime state does not survive one. Treat it like the Redis warm sentinel.
- Agent feature codes (`*60`–`*62` in `missing-features-implementation.md`) go into `FEATURE_CODES` in **both** `xml_handler.lua` and `fs-xml.ts`.
- Switch `queues` and `queueAgents` in `portal/web/src/lib/api.ts` from `getWithFallback` to `api.get`, and remove `<MockFeatureBanner />` from `portal/web/src/routes/_app/queues.tsx`.

---

### 3.2 Conferences (`mod_conference`), Valet Parking (`mod_valet_parking`) & Multi-Rate MOH (`conferences.tsx`)

#### 1. FreeSWITCH Modules (`steps/30-freeswitch.sh` & `steps/31-freeswitch-config.sh`)
- Upstream's default `modules.conf` builds `mod_conference`, `mod_valet_parking` and `mod_local_stream`. First check `ls $PREFIX/mod/` on a built host. Add them to `FS_ENABLE_MODULES` only if they are missing; adding one that is already enabled is harmless.
- Add `mod_conference`, `mod_valet_parking`, and `mod_local_stream` to `FS_AUTOLOAD_ADD` in `steps/31-freeswitch-config.sh`. Ship our own `conference.conf.xml` and `local_stream.conf.xml` under `resources/conf/freeswitch/autoload_configs/`. The vanilla copies define sample rooms and default MoH streams that we do not want.
- Install `ffmpeg` with `apt_install ffmpeg` in **`steps/41-api-deploy.sh`**, since the API is what transcodes. FreeSWITCH never needs it. Re-run the install on amd64 after adding the package (CLAUDE.md architecture caveat).

#### 2. Database Schema (`portal/api/src/db/schema.ts`)
- Add `"conference"` and `"parking_lot"` to `destinationTypeEnum` in `portal/api/src/db/schema.ts`.
- Add `conference`, `parkingLot`, and `musicOnHold` tables to `portal/api/src/db/schema.ts`:
  ```ts
  export const conference = pgTable(
    "conference",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      number: text("number").notNull(),
      name: text("name").notNull(),
      moderatorPinEnc: text("moderator_pin_enc"),
      participantPinEnc: text("participant_pin_enc"),
      maxMembers: integer("max_members").default(25).notNull(),
      waitForModerator: boolean("wait_for_moderator").default(false).notNull(),
      muteOnJoin: boolean("mute_on_join").default(false).notNull(),
      recordConference: boolean("record_conference").default(false).notNull(),
      enabled: boolean("enabled").default(true).notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
      uniqueIndex("conference_org_number_idx").on(table.organizationId, table.number),
    ],
  );

  export const parkingLot = pgTable(
    "parking_lot",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      extension: text("extension").notNull(), // e.g. "5900"
      startSlot: integer("start_slot").default(5901).notNull(),
      endSlot: integer("end_slot").default(5910).notNull(),
      timeoutSec: integer("timeout_sec").default(45).notNull(),
      timeoutType: destinationTypeEnum("timeout_type"),
      timeoutId: text("timeout_id"),
      enabled: boolean("enabled").default(true).notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
      uniqueIndex("parking_lot_org_ext_idx").on(table.organizationId, table.extension),
    ],
  );

  export const musicOnHold = pgTable(
    "music_on_hold",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      category: text("category").default("custom").notNull(),
      shuffle: boolean("shuffle").default(true).notNull(),
      files: jsonb("files").default([]).notNull(), // Array<{ id, fileName, durationSec, sizeBytes }>
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [index("music_on_hold_org_idx").on(table.organizationId)],
  );
  ```

#### 3. Runtime & Multi-Rate MOH Transcoder (FS PBX Best Practice)
- Create `resources/lua/conference.lua`: fetches conference settings from Redis (`qwixbox:conf:<domain>:<id>`), prompts for PIN via `session:playAndGetDigits` if `participantPin` or `moderatorPin` is set, builds `flags{...}` (`moderator`, `wait-mod`, `mute`), and executes `session:execute("conference", string.format("%s_%s@default+flags{%s}", domain, id, flags))`.
- Create `resources/lua/parking.lua`: handles both parking into `valet_park <lot>@<domain> auto in <startSlot> <endSlot>` (when the park extension `5900` is dialed) and retrieving from a specific slot `valet_park <lot>@<domain> <slot>` (when `5901`–`5910` is dialed), setting `valet_parking_timeout` and transferring timed-out parked calls to `qwixbox.go(session, domain, lot.timeoutType, lot.timeoutId, depth)`.
- In `portal/api/src/routes/conferences.ts`, implement `POST /api/music-on-hold/:id/upload` using `Bun.spawn(["ffmpeg", ...])` to transcode uploaded `.mp3`/`.wav` audio into both `8000` Hz and `48000` Hz mono 16-bit PCM WAV files under `/usr/local/freeswitch/sounds/music/<sipDomain>/<category>/<rate>/` and reload `mod_local_stream` via ESL.
- Upload handling must confine paths, as `faxPath` does in `services/fax.ts`, cap the upload size, and invoke `ffmpeg` with an argument array, never a shell string. The API service user needs write access to the per-tenant MoH tree, which FreeSWITCH must also be able to read.
- Park-slot BLF (lamps on desk phones) has no delivery path today (invariant 9).
- Conference PINs are `*Enc` columns, and `moderatorPinEnc`/`participantPinEnc` match the write-side audit `PinEnc` pattern. Because comparing a PIN needs the plaintext, the comparison happens in the API through `/fs/state`, or in Lua from a cached value. If you cache PINs in Redis, they sit there in plaintext, as SIP passwords already do in the directory XML. Decide that deliberately.
- Switch `conferences`, `parkingLots` and `musicOnHold` in `portal/web/src/lib/api.ts` from `getWithFallback` to `api.get`, and remove `<MockFeatureBanner />` from `conferences.tsx`.

---

### 3.3 Multi-Device Provisioning, Rendered Config Preview & 10-Minute QR Enrollment (`devices.tsx`)

**Current state (checked):** `extension.deviceMac` already exists (indexed, one per extension), and the portal's `Extension` type exposes it. The new `device` table supersedes it. Migrate the existing values into `device` rows, then drop the column in a later release. Two separate sources of truth for "which phone is this" would drift. `drizzle-kit push --force` applies a dropped column destructively, so stage it.

#### 1. Database Schema (`portal/api/src/db/schema.ts`)
- Add `device` and `deviceKeyTemplate` tables to `portal/api/src/db/schema.ts`:
  ```ts
  export const deviceKeyTemplate = pgTable(
    "device_key_template",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      vendor: text("vendor").notNull(), // "yealink" | "grandstream" | "poly" | "fanvil"
      lineKeys: jsonb("line_keys").default([]).notNull(), // Array<{ line: number, type: "line"|"blf"|"speeddial"|"park", value: string, label: string }>
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [index("device_key_template_org_idx").on(table.organizationId)],
  );

  export const device = pgTable(
    "device",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      extensionId: text("extension_id").references(() => extension.id, {
        onDelete: "set null",
      }),
      templateId: text("template_id").references(() => deviceKeyTemplate.id, {
        onDelete: "set null",
      }),
      macAddress: text("mac_address").notNull(), // normalized 12-hex lowercase e.g. "001565a1b2c3"
      vendor: text("vendor").notNull(), // "yealink" | "grandstream" | "poly" | "fanvil" | "generic"
      model: text("model").notNull(),
      label: text("label"),
      provisioningSecretHash: text("provisioning_secret_hash").notNull(),
      provisioningSecretEnc: text("provisioning_secret_enc").notNull(),
      lineKeysOverride: jsonb("line_keys_override"),
      lastProvisionedAt: timestamp("last_provisioned_at"),
      lastProvisionedIp: text("last_provisioned_ip"),
      enabled: boolean("enabled").default(true).notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
      uniqueIndex("device_mac_unique_idx").on(table.macAddress),
      index("device_org_idx").on(table.organizationId),
    ],
  );
  ```

#### 2. Provisioning Endpoint, Config Preview (FS PBX) & 10-Min Single-Use QR Enrollment (OpenWeb PBX)
- Create `portal/api/src/routes/devices.ts` (and a separate `routes/device-prov.ts` for the public `/prov/` handlers. `services/provisioning.ts` already exists and provisions *tenants*, so do not reuse that name):
  - Standard CRUD via `crudRoutes` on `/api/devices` and `/api/device-templates` (`permission: "extension"`).
  - **FS PBX Best Practice — Rendered Config Preview (`GET /api/devices/:id/preview`):** Renders the exact Yealink `.cfg`, Grandstream `.xml`, Poly `.cfg`, or Fanvil `.cfg` provisioning file for the device (with `sipPassword` masked by default unless `?reveal=true` is passed by an `admin`/`owner`), allowing admins to verify BLF keys, transport, and STUN/TURN settings in the browser before rebooting a desk phone.
  - **OpenWeb PBX Best Practice — Single-Use 10-Minute QR Enrollment (`POST /api/devices/:id/enroll-token` & `GET /prov/enroll/:token`):**
    - `POST /api/devices/:id/enroll-token` generates a 32-byte random token, stores `{ deviceId, organizationId }` in Redis at `qwixbox:enroll:<token>` with `EX 600` (10 minutes), and returns `{ enrollUrl, expiresAt, qrSvg }`.
    - `GET /prov/enroll/:token` atomically consumes the token from Redis (`GETDEL`), preventing replay if a QR screenshot is leaked.
  - **Authenticated Hardware Auto-Provisioning (`GET /prov/:secret/:filename`):** Look the device up by `provisioningSecretHash` (indexed SHA-256), then confirm with `safeEqual`. Do **not** decrypt every device's secret to find a match. Then update `lastProvisionedAt` and `lastProvisionedIp`, and return the vendor-specific configuration file.
  - **nginx:** `42-nginx.sh` has no `/prov/` location, so phones would fall into the `auth_request`-gated `location /` and get a 404. Add an explicit `location /prov/` that proxies to the API, is **not** session-gated, and is rate-limited (`limit_req`). This path hands out SIP credentials, so it is the most sensitive public endpoint in the system. The `/api/` prefix is not an option either, because it requires a session.
  - **Phone Reboot / Check-Sync (`POST /api/devices/:id/resync`):** The earlier draft used `sofia profile internal flush_inbound_reg ... reboot` through ESL. That **cannot work**: FreeSWITCH holds no registrations (invariant 9). The `NOTIFY Event: check-sync` has to come from Kamailio, which holds the contact. Use `tm.t_uac_start` over `kamcmd` to the contact found with `ul.lookup location <aor>`. Inspect the output, not the exit status (CLAUDE.md `kamcmd` note).
  - **Multi-device registration:** Project each device's credentials into Kamailio `subscriber` (HA1/HA1b only), or share the extension's AOR and raise usrloc `max_contacts`. With a shared AOR, `lookup("location")` in `route[TOSUBSCRIBER]` forks to every contact automatically. With per-device usernames, it only reaches the dialled AOR. Choose one before writing `kamailio-sync.ts` changes.
  - BLF line keys in templates have no delivery path today (invariant 9). They render, but they will not light.
- Switch `devices` in `portal/web/src/lib/api.ts` from `getWithFallback` to `api.get`, and remove `<MockFeatureBanner />` from `devices.tsx`.

---

### 3.4 Contacts, Vendor-Normalized Phonebooks & Inbound CNAM Lookup (`contacts.tsx`)

#### 1. Database Schema (`portal/api/src/db/schema.ts`)
- Add `contact` table to `portal/api/src/db/schema.ts`:
  ```ts
  export const contact = pgTable(
    "contact",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      company: text("company"),
      number: text("number").notNull(),
      mobileNumber: text("mobile_number"),
      email: text("email"),
      speedDial: text("speed_dial"),
      shared: boolean("shared").default(true).notNull(),
      vip: boolean("vip").default(false).notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
      index("contact_org_idx").on(table.organizationId),
      index("contact_org_number_idx").on(table.organizationId, table.number),
    ],
  );
  ```

#### 2. Redis Inbound Caller-ID Enrichment & Vendor XML Phonebook (FS PBX Pattern)
- Register `cid: (domain: string, number: string) => \`qwixbox:cid:\${domain}:\${number}\`` and `\`qwixbox:cid:\${domain}:*\`` in [`portal/api/src/services/redis.ts`](../portal/api/src/services/redis.ts).
- Add `cacheContacts(organizationId)` to [`portal/api/src/services/cache.ts`](../portal/api/src/services/cache.ts): populates `qwixbox:cid:<domain>:<normalizedNumber>` -> `JSON.stringify({ name: c.name, company: c.company, vip: c.vip })`, and if `c.speedDial` is set (e.g. `*01`), populates `cacheFeatureNumber(domain, c.speedDial, "external", c.number)`.
- Inbound DID calls never pass through `xml_handler.lua` (invariant 8). Do the lookup in **`destination.lua`**, which runs for every DID on both tiers (the `qwixbox_did` variable marks a DID entry): `qwixbox.redis_get("qwixbox:cid:<domain>:<caller>")`, then set `effective_caller_id_name` (prefixing `[VIP] ` when `vip === true`). Normalize the caller number to the same form the cache stores. Carriers send `+1NXX…`, `1NXX…` and `NXX…` interchangeably. Strip any `%` and control characters from contact names before caching. Names are tenant-controlled, and `qwixbox.redis_get` refuses keys containing `%`, but not values.
- Speed dials cached through `cacheFeatureNumber()` resolve only in the Lua tier. `fs-xml.ts` does not read `qwixbox:num:`, so add a matching lookup there (invariant 6).
- In `portal/api/src/routes/contacts.ts`, expose:
  - `/api/contacts` via `crudRoutes` (plus `POST /api/contacts/import` for CSV import).
  - `GET /prov/:secret/phonebook.xml`: inspects `device.vendor` (or `User-Agent`) and emits **Grandstream `<AddressBook>` XML** (grouping work and mobile numbers under one `<Contact>`) for Grandstream phones and **Yealink `<YealinkIPPhoneDirectory>` XML** for Yealink/Poly/Fanvil phones, merging internal extensions and shared company contacts.
- `shared: false` (personal contacts) needs an owner, which needs §2.0. Add `ownerUserId` or `ownerExtensionId`. The table above has neither.
- Add a `contact` permission to `statement`.
- Switch `contacts` in `portal/web/src/lib/api.ts` from `getWithFallback` to `api.get`, and remove `<MockFeatureBanner />` from `contacts.tsx`.

---

### 3.5 SMS / MMS Messaging & Structural Opt-Out Gate (`messages.tsx`)

#### 1. Database Schema (`portal/api/src/db/schema.ts`)
- Add `smsProvider`, `smsThread`, `smsMessage`, and `smsOptOut` tables to `portal/api/src/db/schema.ts`:
  ```ts
  export const smsProvider = pgTable(
    "sms_provider",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      provider: text("provider").notNull(), // "telnyx" | "bandwidth" | "twilio"
      apiKeyEnc: text("api_key_enc").notNull(),
      webhookSecretEnc: text("webhook_secret_enc"),
      messagingProfileId: text("messaging_profile_id"),
      enabled: boolean("enabled").default(true).notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [uniqueIndex("sms_provider_org_idx").on(table.organizationId)],
  );

  export const smsThread = pgTable(
    "sms_thread",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      localDid: text("local_did").notNull(),
      remoteNumber: text("remote_number").notNull(),
      contactName: text("contact_name"),
      assignedExtensionId: text("assigned_extension_id").references(
        () => extension.id,
        { onDelete: "set null" },
      ),
      unreadCount: integer("unread_count").default(0).notNull(),
      lastMessagePreview: text("last_message_preview"),
      lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
      uniqueIndex("sms_thread_pair_idx").on(
        table.organizationId,
        table.localDid,
        table.remoteNumber,
      ),
    ],
  );

  export const smsMessage = pgTable(
    "sms_message",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      threadId: text("thread_id")
        .notNull()
        .references(() => smsThread.id, { onDelete: "cascade" }),
      direction: text("direction").notNull(), // "inbound" | "outbound"
      body: text("body").notNull(),
      mediaUrls: jsonb("media_urls").default([]).notNull(),
      status: text("status").default("sent").notNull(), // "queued"|"sent"|"delivered"|"failed"|"blocked_opt_out"
      providerMessageId: text("provider_message_id"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [index("sms_message_thread_idx").on(table.threadId, table.createdAt)],
  );

  export const smsOptOut = pgTable(
    "sms_opt_out",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      localDid: text("local_did").notNull(),
      remoteNumber: text("remote_number").notNull(),
      reason: text("reason").default("STOP").notNull(),
      optedOutAt: timestamp("opted_out_at").defaultNow().notNull(),
    },
    (table) => [
      uniqueIndex("sms_opt_out_unique_idx").on(
        table.organizationId,
        table.localDid,
        table.remoteNumber,
      ),
    ],
  );
  ```

#### 2. Structural Opt-Out Gate & Carrier Webhooks (`portal/api/src/routes/sms.ts`)
- Create `portal/api/src/routes/sms.ts` mounted at `/api/sms-threads`, `/api/sms-opt-outs`, and `/webhooks/sms/:provider`:
  - **Inbound Webhook (`POST /webhooks/sms/:provider`):** This route needs its own nginx `location` outside the session gate, as `/prov/` does. It verifies the provider signature before parsing anything (Telnyx Ed25519, Twilio HMAC), then resolves the tenant by matching `localDid` against `inboundRoute.didPattern`, which is globally unique. If the inbound message body matches `/^\s*(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)\s*$/i`, inserts an `smsOptOut` row immediately; if `/^\s*(START|UNSTOP|YES)\s*$/i`, deletes the `smsOptOut` row.
  - **Outbound Send Service (`POST /api/sms-threads/:id/messages` & `POST /api/sms-threads`):** Queries `smsOptOut` **before** decrypting carrier API keys or calling Telnyx/Bandwidth/Twilio. If an opt-out record exists, rejects with HTTP `422` (`{ error: "Recipient has opted out of SMS (STOP)" }`).
- `smsProvider.apiKeyEnc` does **not** match the write-side audit redaction pattern (invariant 2). Fix the pattern first.
- Put the opt-out check inside the single `sendSms()` function that every send path calls, so the gate is structural. Do not put it in each route handler.
- Add an `sms` permission to `statement`.
- Switch `smsThreads`, `smsOptOuts`, `voicemails` and `recordings` in `portal/web/src/lib/api.ts` from `getWithFallback` to `api.get`, and remove `<MockFeatureBanner />` from `messages.tsx`. `portal/web/mock/data.ts` also backs the dev-only mock server (`mock/api.ts`, `mock/plugin.ts`) and `tests/portal-mock.test.ts`. Delete it only if those go too. Otherwise, just stop importing it from `src/lib/api.ts` (Bug 11).

---

### 3.6 WebRTC `SIP.js` Softphone & Live Receptionist Switchboard (`WebphoneDrawer.tsx`)

#### 1. Webphone Credentials & Live Call Control API (`portal/api/src/routes/calls.ts`)
- Create `portal/api/src/routes/calls.ts` mounted at `/api/calls`:
  - `GET /api/calls/webphone-config`: returns `{ wssUrl, sipDomain, extensionNumber, displayName, sipPassword }` for the authenticated user's **own** extension. That needs §2.0; no "assigned extension" exists today. Returning the long-lived SIP password to a browser means an XSS on the portal hands over toll-fraud credentials. Prefer a dedicated WebRTC-only `device` (§3.3) with its own rotatable credential, or a short-lived token that Kamailio verifies. The extension's desk-phone password should never be the one sent. Also gate on an explicit per-extension WebRTC flag, which does not exist today (no `webrtcEnabled` column).
  - `GET /api/calls/active`: queries FreeSWITCH via `esl` (`show detailed_calls as json`) and filters channels by tenant. **Neither variable the earlier draft relied on is dependable.** `organization_id` comes from directory variables, which are not applied (invariant 10). `sip_h_X-Tenant-ID` is set only on outbound legs, and never on an inbound PSTN call. First make both tiers set a channel variable (e.g. `qwixbox_org=<organizationId>`) on every dialplan result, and filter on that. A channel without it is shown to nobody.
  - `POST /api/calls/:uuid/transfer`: executes `uuid_transfer <uuid> <dest> XML tenant_<organizationId>` via `esl`, after validating `diallable(dest)`.
  - `POST /api/calls/:uuid/hangup`: executes `uuid_kill <uuid>` via `esl` after confirming the channel belongs to `organizationId`.
  - `POST /api/calls/:uuid/eavesdrop`: originates a whisper/barge coaching call to the supervisor's extension (`originate user/<supExt>@<sipDomain> &eavesdrop(<uuid>)`) for `admin`/`owner` roles.

#### 2. Real `SIP.js` Client in `portal/web/src/components/WebphoneDrawer.tsx`
- Add `sip.js` to `portal/web/package.json`.
- Replace the `setInterval` mock timer in [`portal/web/src/components/WebphoneDrawer.tsx`](../portal/web/src/components/WebphoneDrawer.tsx) with a real `SIP.js` `UserAgent` + `Registerer` + `Inviter` / `Invitation` state machine connected to `wss://<pbxFqdn>:<wssPort>`. Kamailio's `WITH_WEBRTC` listener and the `rtpengine` DTLS-SRTP handling in [`resources/conf/kamailio/kamailio.cfg`](../resources/conf/kamailio/kamailio.cfg) are **configured but untested**, per roadmap item 14: no browser has ever connected. `WITH_WEBRTC` is defined only when `ENABLE_WEBRTC=1` (the default) *and* the TLS certificate is ready (`34-kamailio-config.sh`). Treat the first browser registration as a verification task, not a given.
- Every call-control route (`transfer`, `hangup`, `eavesdrop`) must check that the target UUID carries this tenant's `qwixbox_org` before acting. Add a `call` permission to `statement` for them. An `eavesdrop` originate uses `user/<ext>@<domain>`, never `sofia/internal/...` (invariant 9).

---

## 4. Phase 3: Best-Practice Operational & UX Enhancements from Reference Apps

### 4.1 "Where Will This Call Go?" Route Simulator & Temporary Office-Hours Override (from OpenWeb PBX)

#### 1. Auto-Expiring Office-Hours Override on `timeCondition`
- Add `overrideMode` and `overrideUntil` to `timeCondition` in [`portal/api/src/db/schema.ts`](../portal/api/src/db/schema.ts):
  ```ts
  overrideMode: text("override_mode"), // null | "force_match" | "force_no_match"
  overrideUntil: timestamp("override_until"),
  ```
- In [`resources/lua/time_condition.lua`](../resources/lua/time_condition.lua), before checking `cond.rules`, evaluate:
  ```lua
  if cond.overrideMode and cond.overrideUntilEpoch and os.time() < cond.overrideUntilEpoch then
    if cond.overrideMode == "force_match" then
      qwixbox.go(session, domain, cond.matchType, cond.matchId, depth)
      return
    elseif cond.overrideMode == "force_no_match" then
      qwixbox.go(session, domain, cond.noMatchType, cond.noMatchId, depth)
      return
    end
  end
  ```
  Once `os.time() >= cond.overrideUntilEpoch`, normal schedule evaluation resumes automatically without requiring an admin to remember to turn off a holiday/snow-day toggle.
- `overrideUntilEpoch` is a derived field. Compute it in `cacheTimeConditions()` and in `callState(..., "tc", ...)`, so both tiers agree. Use `force_match`/`force_no_match` everywhere. `missing-features-implementation.md` previously said `force_open`/`force_closed`; this name follows the `match*`/`noMatch*` columns. Use `timestamp(..., { withTimezone: true })`: every other timestamp in the schema is naive, and an expiry is exactly where that bites.
- Every write to a time condition already calls `rebuildTenant()`. An override that expires needs no write, because the Lua compares against `os.time()`.

#### 2. Dry-Run Call Routing Simulator (`POST /api/routing/simulate`)
- Add `POST /api/routing/simulate` in `portal/api/src/routes/telephony.ts`:
  - Accepts `{ didPattern: string, callerNumber?: string, atIsoTime?: string }`.
  - Walks the tenant's live routing graph up to `MAX_DEPTH = 10` (`callBlock` -> `contact` CNAM lookup -> `inboundRoute` -> `timeCondition` at `atIsoTime` in **that condition's own `timezone`** -> `dayNightToggle` -> `ringGroup` / `ivrMenu` / `queue` / `extension` DND & forwarding), returning `{ steps: Array<{ depth, type, label, outcome, detail }>, finalAction }` so admins can visually trace where any call will land at any future date/time in `portal/web/src/routes/_app/routing.tsx`. `timeCondition.timezone` exists per row. `tenantSettings.timezone` is only a default.
  - There is no holiday table. Holidays are rules with `invert: true` inside `timeCondition.rules`, and a matching inverted rule **breaks** the loop (CLAUDE.md). The simulator is a second implementation of `time_condition.lua`, the kind of cross-language duplication CLAUDE.md warns about. Keep it honest with a shared fixture: one JSON table of `(rules, timestamp, tz) → matched` cases that both the TypeScript simulator's tests and a Lua test run against.

---

### 4.2 Day/Night Toggles (`day_night`) & Event-Driven BLF Lamps (from FusionPBX & FS PBX)

- Add `"day_night"` to `destinationTypeEnum` and create the `dayNightToggle` table in `portal/api/src/db/schema.ts`:
  ```ts
  export const dayNightToggle = pgTable(
    "day_night_toggle",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      featureCode: text("feature_code").notNull(), // e.g. "*280"
      pinEnc: text("pin_enc"),
      state: text("state").default("day").notNull(), // "day" | "night"
      dayType: destinationTypeEnum("day_type").notNull(),
      dayId: text("day_id"),
      nightType: destinationTypeEnum("night_type").notNull(),
      nightId: text("night_id"),
      enabled: boolean("enabled").default(true).notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
      uniqueIndex("day_night_org_code_idx").on(table.organizationId, table.featureCode),
    ],
  );
  ```
- Wire `dtype == "day_night"` into `qwixbox.go()` (`resources/lua/qwixbox.lua`) and allow toggling via both `POST /api/day-night/:id/toggle` and dialing the `featureCode` (`*280`) from an internal phone.
- **Naming collision:** the RBAC statement already has `callflow`, which gates ring groups, IVRs and time conditions, and the portal route `call-flows.tsx` is that page. Do not reuse either name for this feature. Call it `dayNight` (table `day_night_toggle`, destination type `day_night`, route `/api/day-night`), and gate it on the existing `callflow` permission.
- The toggle feature code is tenant-defined, so add it to the feature-code matching in **both** tiers, before the directory (CLAUDE.md: a tenant must not be able to shadow a code with an extension).
- **BLF lamps have no delivery path today** (invariant 9). A FreeSWITCH `PRESENCE_IN` event reaches no phone, because FreeSWITCH holds no subscriptions. The earlier draft's "BLF keys turn red/green" needs Kamailio presence first. Ship the toggle without lamps, and track presence as its own item.

---

### 4.3 Redis-Cached Inbound Call Blocking (`call_block`) (from FS PBX)

- Add `callBlock` table in `portal/api/src/db/schema.ts`:
  ```ts
  export const callBlock = pgTable(
    "call_block",
    {
      id: text("id").primaryKey(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organization.id, { onDelete: "cascade" }),
      number: text("number").notNull(),
      description: text("description"),
      action: text("action").default("reject").notNull(), // "reject" | "busy" | "voicemail"
      enabled: boolean("enabled").default(true).notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => [
      uniqueIndex("call_block_org_number_idx").on(table.organizationId, table.number),
    ],
  );
  ```
- Register `keys.callBlock(domain, number)` (`qwixbox:block:${domain}:${number}`) in `portal/api/src/services/redis.ts` and populate in `rebuildTenant()` (`portal/api/src/services/cache.ts`).
- Add the key to `keys.tenantPatterns(domain)` as well, or blocks survive a rebuild as ghosts.
- Inbound DID calls never pass through `xml_handler.lua` (invariant 8). Check `qwixbox:block:<domain>:<callerNumber>` in the `peer` branch of `handleDialplan()` in `fs-xml.ts`, before `dispatch()`, for the cold-cache path, **and** in `destination.lua` (when `qwixbox_did` is set), which runs on both tiers. A check in `xml_handler.lua` alone would never fire. Normalize the caller number exactly as §3.4 does.
- "Without hitting Postgres" is not achievable here: the peer branch of `fs-xml.ts` already queries Postgres to resolve the DID. The Redis check saves the ring, not the query.

---

### 4.4 "First Calls" Trunk Readiness Checker, Office IP Unblock (`htable`) & Guarded Restore / Drain Mode (from OpenWeb PBX)

1. **"First Calls" Trunk Readiness Diagnostic (`GET /api/trunks/:id/readiness`):**
   - Queries Kamailio (`kamcmd permissions.addressDump`, `kamcmd uac.reg_info`, `kamcmd dispatcher.list`) and tenant routing tables to return a structured checklist:
     - `kamailioProjected`: whether the trunk's IP/registration is active in Kamailio.
     - `hasOutboundRoute`: whether at least one enabled `outboundRoute` uses the trunk.
     - `hasCallerId`: whether `defaultCallerIdNumber` or `callerIdOverride` is configured in E.164 format.
     - `hasInboundDid`: whether at least one enabled `inboundRoute` is mapped to a valid destination.
     - `hasEmergencyRoute`: whether an `isEmergency = true` route and `emergencyLocation` exist.
2. **Controlled Office IP Unblock (`GET /api/security/banned-ips` & `POST /api/security/unban`):**
   - Exposes `kamcmd htable.dump ipban` and `kamcmd htable.dump authfail` in `portal/api/src/services/kamailio-sync.ts`, allowing `owner`/`admin` users to unban a locked-out office IP (`kamcmd htable.delete ipban <ip>` and `kamcmd htable.delete authfail <ip>`) with full audit logging.
   - Kamailio's htables are one of three ban layers. `12-fail2ban.sh` (nftables) and `14-responsive-firewall.sh` can also block the address. An "unban" that clears only the htable leaves the office locked out at the firewall, so cover every layer or say which one was cleared.
   - The htables are platform-wide, not per tenant. Letting a tenant `admin` unban an arbitrary IP lets one tenant unblock an attacker for everyone. Limit tenant admins to IPs that have recently authenticated as one of their own extensions, and leave arbitrary unbans to the operator CLI.
3. **Guarded Restore Script (`resources/conf/backups/qwixbox-restore`) & Call-Aware Drain Mode:**
   - Deploy `/usr/local/sbin/qwixbox-restore` in `steps/51-backups.sh`: verifies archive integrity, confirms `/etc/qwixbox/config.env` (`ENCRYPTION_KEY`) is present, creates a pre-restore safety snapshot before touching PostgreSQL, restores `kamailio` and `qwixbox` databases, runs `drizzle-kit push --force`, reloads Kamailio, and rebuilds Redis tenant caches.
   - What the backup actually contains (`resources/conf/backups/qwixbox-backup`): a custom-format `pg_dump` per database, `pg_dumpall --globals-only`, and `config.tar.gz`, which must contain `etc/qwixbox/config.env`. A run is complete only if it wrote a `COMPLETE` marker. Redis is not backed up and does not need to be, because it is a pure cache that the warm watchdog rebuilds. Restore `globals.sql` first, so the roles exist before the database dumps reference them. Refuse to restore a backup directory without `COMPLETE`.
   - Running `drizzle-kit push --force` after a restore applies any destructive schema difference between the backup and the current code. If the backup is older than the code, that is intended. If it is newer, it destroys data. Compare first, and stop on any difference that would drop something.
   - This is `mvp.md` blocker 5. The script is only proven once a restore into a fresh container brings back a tenant, its extensions and its registrations.
   - In `steps/31-freeswitch-config.sh`, before `restart_service freeswitch`, check `fs_cli -x "show calls count"`. If calls are active, run `fs_cli -x "fsctl pause inbound"` and wait up to `DRAIN_TIMEOUT_SEC="${DRAIN_TIMEOUT_SEC:-60}"` for active calls to finish before restarting FreeSWITCH.
   - The same applies to rtpengine in `35-rtpengine.sh`. `fs_cli` needs `-p "$FS_ESL_PASSWORD"`, because ESL is password-protected on 127.0.0.1. During the drain, new calls are refused by FreeSWITCH after Kamailio has accepted them, so callers hear a failure rather than a busy tone. Say so in the installer output. Under `tui_available`'s false branch (CI and containers) there are no calls, so the check must not prompt.

---

## 5. Verification & Acceptance Matrix

| Step | Verification Command / Test | Expected Result |
| :--- | :--- | :--- |
| **Static** | `cd portal/api && bun run typecheck && bun run format:check`; `cd portal/web && bun run typecheck && bun run lint && bun run build`; `bash -n` + `shellcheck` on touched steps | Clean. Necessary, not sufficient: every bug in CLAUDE.md's "recurring failure mode" passed all of these. |
| **Schema** | Full installer run in the Debian 13 container (step 41 runs `drizzle-kit push --force`), then a **re-run** over the finished install | Both exit 0. On the re-run, no table outside `schema.ts`/`auth-schema.ts` is dropped. |
| **RBAC** | For every new route, sign in as `viewer` and attempt a write | `403`, while `owner` gets past the gate (to a `400` or `200`). A `200` for `viewer` means the gate is missing. |
| **Pre-Phase Bug Fixes** | Inbound carrier call (`X-Trusted-Peer: 1`) to an extension with `forwardAllTo` set to an external number. `*98` from an authenticated extension. `911` while the account holds `MAX_CONCURRENT_CALLS` calls. Disable an extension that a DID points at. Run `fs_cli -x xml_flush_cache` between phases. | The forwarded call leaves through the trunk with the tenant's caller ID and counts against the forwarding extension. `*98` still prompts. The 911 INVITE reaches FreeSWITCH. The DID stops routing to the disabled extension. |
| **Phase 1 (MVP Gaps)** | Needs `mvp.md` item 1 (two-way audio) first. Create an emergency location, a registration trunk and a failover outbound route. Test post-answer recording and voicemail playback in `messages.tsx`. | ELIN sent on 911 and the email alert delivered. `uacreg` populated, and the carrier challenge on INVITE answered. WAV created only after the B-leg answers, and none for unanswered calls. Voicemail audio streams, and read/unread round-trips. MWI is out of scope until presence exists. |
| **Phase 2 (Zero Mock Screens)** | `grep getWithFallback portal/web/src/lib/api.ts`. Open each formerly mock screen against a live API. | No `getWithFallback` left, or it is dev-only, and the production bundle does not contain `mock/data.ts`. Each page reads and writes live endpoints. A browser registers over WSS and completes a call with audio. |
| **Phase 3 (Best Practices)** | Run the route simulator against the shared time-condition fixtures. Toggle day/night by feature code and by API. Call from a blocked number with Redis warm and again with it flushed. Check trunk readiness. | The simulator agrees with `time_condition.lua` on every fixture. The toggle changes routing (lamps are out of scope until presence exists). A blocked caller is rejected on both tiers without ringing anyone. |
| **Architecture** | Any change to apt packages (`ffmpeg`) or FreeSWITCH modules | Re-run on `--platform linux/amd64` (CLAUDE.md). An arm64 pass is not a general pass. |

---

## Appendix A — Divergence Log (re-checked against the code, 2026-10-24)

What an earlier draft of this plan, or of `missing-features-implementation.md`, stated that the code contradicts:

| Claim | Code says | Where corrected |
|---|---|---|
| `crudRoutes` `present` strips `*Enc` automatically | Each resource's `present` must do it | Invariant 2 |
| `redactEnc` covers audit logs | Read-time only. The write-time regex misses e.g. `apiKeyEnc` | Invariant 2 |
| Three-point destination contract | Six or more places, including the Redis key segment and `fs-xml.ts` number lookups | Invariant 6 |
| New files need a `# step-inputs:` edit | Step 31 already declares `resources/conf/freeswitch` and `resources/lua` | Invariant 7 |
| xml_handler.lua sees inbound DIDs | Trusted peers are declined. Only `fs-xml.ts` and `destination.lua` see them | Invariant 8, §3.4, §4.3 |
| FreeSWITCH can flush, NOTIFY or BLF phones | It holds no registrations or subscriptions, and Kamailio has no presence modules | Invariant 9, §2.4, §3.3, §4.2 |
| Directory variables set the A-leg caller ID | `auth-calls=false`, so they are never applied | Invariant 10, Bug 2 |
| `*98` is reachable by PSTN callers | Peers are stopped before feature codes in both tiers | Bug 4 |
| Sequential ring groups break on `call_timeout` | Unverified | Bug 7 |
| `uac` not loaded | `uac.so` is loaded. Its `reg_*` parameters and the `uacreg` table are missing | Bug 9 |
| `mockByPath` | `getWithFallback()`, which also serves seed data in production | Bug 11 |
| Add a `recording` permission | It already exists, unused | Bug 12, §2.3 |
| User's "assigned extension" | No user↔extension link exists | §2.0 |
| `/fs/state` accepts writes (`emergency_alert`, `queue_callback`) | Read-only `{domain, kind, id}` lookup | §2.1, §3.1 |
| `voicemail.conf.xml` `odbc-dsn` → `qwixbox` DB | Conflicts with `drizzle-kit push --force` | §2.4 |
| `vm_mwi` ESL command | Not a `mod_voicemail` command. Use `vm_read` | §2.4 |
| Recordings under `/var/lib/freeswitch/recordings` | `$PREFIX/recordings`, already pruned by `qwixbox-maintenance` | §2.3 |
| `ffmpeg` in step 30 | The API transcodes, so step 41 | §3.2 |
| `extension.deviceMac` absent | It exists and must be migrated | §3.3 |
| `/prov/*` reachable | No nginx location exists. It would fall behind `auth_request` | §3.3 |
| Active-call filter on `organization_id` / `X-Tenant-ID` | Neither is set on inbound PSTN legs | §3.6 |
| A time condition uses `tenant.timezone` | Each condition has its own `timezone` | §4.1 |
| `callFlow` / `callflow` naming | Already used by ring groups/IVR/TC | §4.2 |
| Kamailio unban is enough | fail2ban and the responsive firewall also ban | §4.4 |
| `routes/provisioning.ts` for phones | `services/provisioning.ts` is tenant provisioning, so `device-prov.ts` | §3.3 |
| Absolute `file:///Users/...` links with line anchors | Repo-relative links. Line anchors removed because they drift | Throughout |
