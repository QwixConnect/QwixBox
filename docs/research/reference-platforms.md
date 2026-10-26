# Reference platforms — historical comparison

Snapshot retained from the 2026-10-24 planning work; classified as research on 2026-10-25.
This is not a current capability, security, licensing or release comparison. FS PBX/OpenWeb PBX
claims below lack the pinned evidence of the separate [FusionPBX review](fusionpbx.md) and need
upstream revalidation before adoption. QwixBox implementation status is in [status](../status.md)
and [issues](../issues.md); the comparison below must not override those records.

## Reference Links

- **FusionPBX**
  - Website: https://www.fusionpbx.com/
  - GitHub: https://github.com/fusionpbx/fusionpbx
- **FS PBX**
  - Website: https://www.fspbx.com/
  - GitHub: https://github.com/nemerald-voip/fspbx
- **OpenWeb PBX**
  - Website: https://openwebpbx.com/
  - GitHub: https://github.com/embire2/openwebpbx

> Proposed feature architecture is retained in [implementation design](../design/implementation-plan.md).
> Its duplicate summary was retired. All feature proposals need source and runtime validation.

---

## 1. Executive Summary & Architectural Overview

All four platforms—**FusionPBX**, **FS PBX**, **OpenWeb PBX**, and **QwixBox**—use **FreeSWITCH** as their underlying telephony and media engine and **PostgreSQL** as their primary relational datastore. However, they represent three distinct generations of FreeSWITCH PBX architecture:

1. **FusionPBX** is the classic, full-featured open-source multi-tenant FreeSWITCH GUI. Written in procedural/OOP PHP with a PostgreSQL schema (`v_*` tables), it relies on FreeSWITCH's `mod_lua` to connect directly to PostgreSQL at call time, generate XML dialplans/directories/configurations, and cache raw XML files on disk (`/var/cache/fusionpbx/`).
2. **FS PBX** began as a fork of FusionPBX and systematically modernizes the control plane into **Laravel (PHP 8.1/8.4), Vue 3, Inertia.js, VueForm, Tailwind CSS, Redis, Laravel Horizon, and Reverb WebSockets**. It retains legacy `/public/app/...` FusionPBX scripts during migration while introducing native Eloquent models, Redis-backed Lua scripts (`mod_hiredis`), event-driven Lua BLF daemons, cloud phone provisioning, omnichannel SMS/MMS webhooks, AI agents/transcription, and PostgreSQL logical-replication High Availability (HA).
3. **OpenWeb PBX** also forked from FusionPBX (5.6 branch) with the explicit mission of achieving **3CX V20 feature parity** (tracking 133 roadmap items). It wraps the admin experience in a **Windows 11-inspired browser desktop**, adds a **3CX V20 backup importer**, supports both **Debian 13 amd64 and Windows Server 2025** (via a C#/.NET 10 background service and WinUI 3 manager), ships a native **Kotlin/Linphone Android app** (with 1-use QR enrollment and UnifiedPush/VAPID wake-up), includes built-in **WebRTC video conferencing (Meet)**, and emphasizes **operational safety** (Phone Health & controlled firewall block recovery, "First Calls" trunk readiness testing, and atomic rollback updaters).
4. **QwixBox** is a clean-slate VoIP PBX stack for Debian 13 built around a **carrier-grade perimeter topology**: **Kamailio** owns the public SIP edge (5060/5061/WSS, digest auth, registrations, flood/pike protection), **FreeSWITCH** runs isolated on loopback (`127.0.0.1:5080`), and **rtpengine** relays media. The control plane is a single-writer **Bun + Hono + Drizzle ORM** API with a **React + TanStack Router/Query + Mantine** SPA. Call-time resolution uses a strict two-tier read-only contract: `mod_lua` (`xml_handler.lua`) reading pre-projected keys from **Redis** (`mod_hiredis`, patched against printf format-string vulnerabilities), falling through to `mod_xml_curl` (`/fs/xml`) on cache miss.

### High-Level Stack Comparison

| Dimension | FusionPBX | FS PBX | OpenWeb PBX | QwixBox |
|---|---|---|---|---|
| **Public SIP Edge** | FreeSWITCH (`mod_sofia`) directly on public ports | FreeSWITCH (`mod_sofia`) directly on public ports | FreeSWITCH (`mod_sofia`) directly on public ports | **Kamailio** on 5060/5061/WSS; FreeSWITCH on `127.0.0.1:5080` |
| **Media Relay & NAT** | FreeSWITCH RTP + Sofia NAT settings | FreeSWITCH RTP + Sofia NAT settings | FreeSWITCH RTP + managed `coturn` STUN (`UDP 3478`) | **rtpengine** kernel/userspace relay (`FreeSWITCH -nonat`) |
| **Registrations (`location`)** | FreeSWITCH `sofia_reg` DB | FreeSWITCH `sofia_reg` DB | FreeSWITCH `sofia_reg` DB | **Kamailio `usrloc`** (`save("location")` / `lookup("location")`) |
| **SIP Secret Storage** | Plaintext in `v_extensions.password` | Plaintext in `v_extensions.password` | Preserved password bytes / hashes in DB + sealed proofs | **AES-256-GCM (`*Enc`)** in API DB; **HA1/HA1b only** in Kamailio `subscriber` |
| **Call-Time XML & Routing** | `mod_lua` (`xml_handler/index.lua`) queries Postgres & writes file cache | `mod_lua` (`xml_handler` + Redis `mod_hiredis` for call block) + Postgres fallback | `mod_lua` (`xml_handler` + custom policy/callback/meet Lua scripts) | **Tier 1:** `mod_lua` reads Redis (`mod_hiredis`, no DB in Lua)<br>**Tier 2:** `mod_xml_curl` → Hono API → Postgres |
| **Dialplan Model** | Materialized XML strings stored in `v_dialplans.dialplan_xml` | Materialized XML strings in `v_dialplans` via `CallRoutingOptionsService` | Materialized XML in `v_dialplans` + Lua runtime helpers | **Dynamic runtime dispatch** via `qwixbox.go()` in Lua with `MAX_DEPTH = 10` loop guard |
| **Backend Control Plane** | Custom PHP (`core/`, `app/`) | Laravel 10/11 + Horizon (Redis queues) + Reverb (WebSockets) | Custom PHP + Python/C# (.NET 10) system workers & systemd timers | **Bun + Hono + Drizzle ORM** (`portal/api`) |
| **Frontend UI** | Server-rendered PHP + Smarty + vanilla JS | **Vue 3 + Inertia.js + VueForm + Tailwind CSS** (+ legacy PHP pages) | **Windows 11-style Web Desktop** (windowed apps, taskbar, Start menu, light/dark) | **React 19 + Vite + TanStack Router & Query + Mantine** (`portal/web`) |
| **Multi-Tenancy Boundary** | `domain_uuid` in PHP `$_SESSION` | `session('domain_uuid')` + Eloquent scopes & Spatie permissions | Tenant workspaces (`domain_uuid`) + Department sub-scoping + 6 staff roles | `better-auth` Organization (`session.activeOrganizationId`) + per-request `member` role re-read + mandatory `permission` on `crudRoutes` |
| **Target OS** | Debian, Ubuntu, FreeBSD, CentOS | Debian 12 / Debian 13 | Debian 13 amd64 & Windows Server 2025 x64 | Debian 13 (arm64 & amd64) |

---

## 2. How Each Reference App Functions & Implements Features

### 2.1 FusionPBX (`fusionpbx/fusionpbx`)

#### Core Architecture & Request Lifecycle
1. **Database-First Configuration (`v_*` Schema):** Every PBX concept (`v_domains`, `v_extensions`, `v_gateways`, `v_dialplans`, `v_dialplan_details`, `v_ring_groups`, `v_ivr_menus`, `v_call_center_queues`, `v_voicemails`, `v_devices`, `v_default_settings`, `v_domain_settings`) lives in PostgreSQL.
2. **Materialized Dialplan Generation:** When an administrator creates or edits a Ring Group, IVR, Time Condition, Call Flow, or Inbound/Outbound Route in PHP, FusionPBX synthesizes the FreeSWITCH XML dialplan and writes it into `v_dialplans.dialplan_xml` (and child rows in `v_dialplan_details`), then clears the file cache (`/var/cache/fusionpbx/dialplan.<context>`).
3. **Lua XML Handler (`app/switch/resources/scripts/app/xml_handler/index.lua`):**
   - Bound in `lua.conf.xml` to `configuration`, `directory`, `dialplan`, and `languages`.
   - On a cache miss in `resources.functions.cache` (which reads `/var/cache/fusionpbx/` files or memcache), the Lua script opens a direct database connection (`Database.new('system')`), queries `v_extensions` / `v_dialplans` / `v_vars`, builds the XML string via `resources.functions.xml`, writes it to `/var/cache/fusionpbx/`, and returns `XML_STRING` to FreeSWITCH.
4. **Background Daemons (`core/services/` & `app/*/resources/service/`):**
   - `event_guard`: Monitors FreeSWITCH ESL `CUSTOM sofia::register_failure` events and blocks offending IPs via `iptables` / `nftables` / `pf`.
   - `email_queue` & `fax_queue`: PHP CLI workers polling `v_email_queue` and `v_fax_queue` to send emails and retry outbound faxes via ESL `originate`.
   - `xml_cdr`: Ingests FreeSWITCH CDRs via HTTP POST or spool directory into `v_xml_cdr`.
   - `operator_panel` / `active_calls`: Uses ESL (`event_socket`) and WebSockets (`core/websockets`) to show live channels and execute transfer/eavesdrop/hangup commands.

#### Notable Feature Implementations in FusionPBX
- **Device Auto-Provisioning (`app/devices/`, `app/provision/`):** Stores MAC addresses, line keys (`v_device_keys`), profiles (`v_device_profiles`), and vendor settings (`v_device_settings`). When an IP phone requests `/app/provision/?mac=...` (authenticated via HTTP Digest or URL token), `provision.php` renders Smarty templates under `resources/templates/provision/{vendor}/{model}/` for **14+ vendors** (Yealink, Poly/Polycom, Grandstream, Fanvil, Cisco, Snom, Htek, Flyingvoice, Avaya, Aastra, Algo, Panasonic, Swissvoice).
- **Follow Me & Simultaneous Ring (`app/follow_me/`):** Allows an extension to ring multiple internal/external numbers with per-leg delay, timeout, and optional prompt confirmation ("Press 1 to accept this call") via `app/switch/resources/scripts/app/follow_me/index.lua`.
- **Call Flows / Day-Night Mode (`app/call_flows/`):** Dialable toggle extension (with a PIN and a BLF presence lamp `flow+<ext>@domain`) that flips a boolean state in the DB between an "Active" destination (e.g., normal ring group) and an "Alternate" destination (e.g., night voicemail/announcement) and fires a `PRESENCE_IN` ESL event so desk phone BLF keys turn red/green.
- **FIFO & Call Center (`app/fifo/`, `app/call_centers/`):** Supports both lightweight queues (`mod_fifo`) and full ACD queues (`mod_callcenter`), projecting `v_call_center_queues`, `v_call_center_agents`, and `v_call_center_tiers` into `callcenter.conf.xml` and executing live `callcenter_config` ESL commands.
- **Call Broadcast (`app/call_broadcast/`):** Mass outbound automated dialing that originates calls to a list of numbers and plays a recording or connects to an IVR/queue.
- **Paging & Intercom (`app/paging_groups/`):** Uses `page.lua` to check active channels (skipping busy extensions unless force-paged), sets `sip_auto_answer=true` / `Alert-Info: Ring Answer` headers, and bridges/conferences target extensions.

---

### 2.2 FS PBX (`nemerald-voip/fspbx`)

#### Core Architecture & Request Lifecycle
1. **Strangler-Fig Modernization Over FusionPBX:** FS PBX keeps the `v_*` PostgreSQL compatibility tables so existing FreeSWITCH Lua scripts continue to work, while systematically replacing legacy PHP screens with **Laravel controllers (`app/Http/Controllers/`), Services (`app/Services/`), Eloquent Models (`app/Models/`), Jobs (`app/Jobs/`), and Vue 3 + Inertia.js + VueForm pages (`resources/js/Pages/`)**.
2. **Centralized Polymorphic Routing (`app/Services/CallRoutingOptionsService.php`):**
   - Defines a single static registry (`destinations()`) mapping 17 destination types (`extensions`, `voicemails`, `ring_groups`, `ivrs`, `business_hours`, `time_conditions`, `contact_centers`, `bridges`, `faxes`, `call_flows`, `dynamic_routes`, `recordings`, `conferences`, `conference_centers`, `ai_agents`, `check_voicemail`, `company_directory`, `hangup`) to their Eloquent model, target column, display field, and FreeSWITCH transfer/action format.
   - Shared across Business Hours, Phone Numbers (DIDs), Ring Groups, IVRs, Call Flows, Basic Queues, Basic Dialer, and Extension Forwarding.
3. **Redis-Backed Runtime Lua (`resources/freeswitch_scripts/lua/`):**
   - Uses `mod_hiredis` (`hiredis_raw default ...`) for hot-path call evaluation (e.g., `call_block.lua` caches domain-versioned rule sets `call_block:version:{domain_uuid}` and `call_block:rules:v{version}:{domain_uuid}:{direction}:{scope}` in Redis, falling back to Postgres on miss, and failing open if both are down).
4. **Event-Driven Lua BLF Daemons (`resources/freeswitch_scripts/lua/*_blf.lua`):**
   - Runs persistent background Lua scripts under `lua.conf.xml` (`vm_blf.lua`, `flow_blf.lua`, `followme_blf.lua`, `agent_blf.lua`) using non-blocking `freeswitch.EventConsumer("PRESENCE_PROBE")` loops.
   - Desk phones subscribe to `vm200@domain`, `flow300@domain`, `fm200@domain`, or `agent101@domain` / `break101@domain`, and get immediate LED state updates without polling.

#### Notable Feature Implementations in FS PBX
- **Device Key Templates, Blade Provisioning & Cloud RPS/ZTP:**
  - Replaces static file provisioning with database-seeded **Blade templates** (`provisioning_templates`, `ProvisioningController.php`), supporting live credential-gated **Provisioning Previews** in the UI with inline XML comments explaining vendor P-values.
  - Introduces reusable domain-scoped **Device Key Templates** (`DeviceKeyTemplateController`) with a strict 4-layer merge order: legacy Device Profile → Device Key Template → legacy per-device keys → modern per-device `device_keys`, plus separate Yealink expansion module tabs.
  - Integrates **Yealink RPS** (`YealinkRpsCloudProvider.php`) and **Polycom ZTP** (`PolycomZtpCloudProvider.php`) so adding a MAC address automatically registers the device with the manufacturer's cloud redirect server.
- **Vendor-Normalized Remote Phonebooks (`app/Services/Provisioning/Phonebook/PhonebookBuilder.php`):**
  - Combines optional internal extensions (`include_extensions` toggle) with custom phonebook contacts (`phonebook_contacts`).
  - Serves digest-authenticated XML directories at `/prov/directory/{book}/{mac}` formatted per vendor: Grandstream automatically receives a single merged `/prov/directory/all/{mac}` (`AddressBook` XML) because Grandstream firmware only supports one XML phonebook URL, whereas Yealink receives multiple individual `remote_phonebook.data.X` URLs (`YealinkIPPhoneDirectory` XML).
- **Multi-Rate Music on Hold Families (`MusicOnHoldController.php`):**
  - Treats every Music on Hold stream as a 4-rate family (`8000`, `16000`, `32000`, `48000` Hz). When a user uploads an audio file, FS PBX uses `ffmpeg` to convert it into mono 16-bit PCM WAV across all four sample rates under `$${sounds_dir}/music/{domain}/{stream}/{rate}`, eliminating runtime FreeSWITCH transcoding CPU overhead and muffled resampling.
- **Omnichannel SMS/MMS & Ringotel Integration (`app/Services/Messaging/`):**
  - Dedicated webhook pipeline (`InboundWebhook` → `ProcessWebhookJob` → provider normalizers) supporting **9 SMS/MMS carriers** (Bandwidth, Telnyx, Commio, Sinch, Voxutel, ClickSend, Apidaze, BulkVS, VoIP.ms, Fibernetics).
  - Stores MMS media in S3-compatible object storage (`MessageMediaObjectStorageService`) and delivers inbound SMS/MMS to **Ringotel** mobile softphone apps (`DeliverMessageToRingotel`) and email (`DeliverMessageToEmail`).
- **AI Agents, AI Tool Invocations & Call Transcription (`AiAgentController`, `CallTranscriptionController`):**
  - Integrates OpenAI, AssemblyAI, IBM Watson, and Azure Speech (`AiProviderRegistry`, `CallTranscriptionService`) for automatic call recording and voicemail transcription, post-call AI summaries (`FetchTranscriptionSummary`), and dialable `AiAgent` voice assistants with tool sync (`AiProviderToolSync`).
- **Hospitality / Hotel PMS (`HotelRoomController`, `TigerTmsWebhookController`, `CharPmsWebhookController`, `WakeupCallsController`):**
  - Full hotel room management (`hotel_rooms`, `hotel_room_statuses`, `hotel_housekeeping_definitions`), dialable housekeeping status codes (`hotel_room_status_update.lua`), automated guest wake-up calls with retry/escalation (`wakeup_call.lua`, `ExecuteWakeUpCall`), and webhook integrations with **TigerTMS** and **CharPMS**.
- **Voicemail Escalation (`VmNotifyProfile`, `vm_escalation_notify.lua`):**
  - When a voicemail is left, triggers a tiered outbound call/notification escalation chain (`CreateVoicemailEscalationNotificationsJob`) that calls on-call recipients in sequence until someone listens to and acknowledges the message.
- **Scheduled Announcements / Bell Scheduler (`ScheduledAnnouncementController`):**
  - Generic bell/tone/announcement scheduler with day/time events and holiday date exclusions. Crucially, it **does not use `sched_api`** inside FreeSWITCH; Laravel evaluates due schedules and fires via `FreeswitchEslService` with a strict **"on time or missed, never late"** fire window and a short silence lead-in before playback so auto-answering speakers don't clip the first syllable.
- **Active-Node HA Coordinator & S3 Archiving (`app/Services/Ha/ActiveNodeResolver.php`, `S3RecordingArchiver.php`):**
  - Coordinates scheduled jobs (LDAP sync, S3 recording upload, callbacks) across redundant active/standby PBX nodes sharing PostgreSQL 16+ bi-directional logical replication (`setup_logical_replication.sh`) and Syncthing file sync (`install_syncthing.sh`).
  - Uses PostgreSQL `pg_control_system()` cluster identity, signed HTTPS peer probes, explicit `active_node_generation` fencing (`claimExecution` / `withExecution`), and draining handoffs rather than trusting local Redis locks.

---

### 2.3 OpenWeb PBX (`embire2/openwebpbx`)

#### Core Architecture & Request Lifecycle
1. **3CX V20 Workflow & Desktop UX Over FreeSWITCH:** OpenWeb PBX transforms the administrative surface into a **Windows 11-style browser desktop** (`app/pbx_core`, `app/pbx_setup`) with familiar 3CX V20 terminology (**Users**, **Voice & Chat**, **Call Handling**, **Office Hours**, **Switchboard**, **Wallboard**, **Meet**, **Phone Health**).
2. **Cross-Platform Server & Native Workers (`packaging/debian/`, `packaging/windows/`):**
   - Runs on both **Debian 13 amd64** and **Windows Server 2025 Desktop Experience** (using a C#/.NET 10 background service and WinUI 3 native administration manager).
   - Uses isolated, privilege-dropped Python/C# workers (`phone-health.py`, `backups.py`, `upgrade.py`, `call-diagnostics.py`, `tenant-domains.py`) coordinated via a shared filesystem/flock maintenance lock (`/run/openwebpbx-upgrade.lock`).
3. **Strict Answer-Hook Recording & Audible Ringback:**
   - Solves classic FreeSWITCH early-media bugs: anchors call legs explicitly, generates audible ringback on 180 Ringing while preserving genuine carrier 183 early media, and binds `record_session` to a **post-answer hook** so pre-answer ringing never sends silent 183 media or creates empty WAV files for unanswered calls.

#### Notable Feature Implementations in OpenWeb PBX
- **Phone Health & Controlled Office Block Recovery (`app/pbx_phone_health/`, `packaging/debian/phone-health.py`):**
  - A 30-second background monitor (`openwebpbx-phone-health.timer`) drops privileges (`setuid(33)` + `PR_SET_NO_NEW_PRIVS`) and inspects active phone contacts and trunk states against a 30-day history of verified desk-phone IPs.
  - Requires a 90-second disappearance before opening an offline incident, shows persistent critical banners in Admin, and sends deduplicated opening/recovery emails via the global mail queue.
  - **Controlled Recovery:** When an office's desk phones are locked out by `event_guard` (`iptables`) due to a stale credential after a migration, the tenant owner can click **Recover** in Phone Health. The backend verifies that the blocked IPv4 address previously succeeded in authenticating a desk phone for *that specific tenant*, refuses shared/foreign/unverified IPs, issues a targeted single-IP unblock request to Event Guard with a 15-minute cooldown, and writes an audit record—without ever whitelisting the IP permanently or restarting the firewall.
- **"First Calls" Trunk Readiness & Guided Cutover (`docs/core-calling.md`, `app/pbx_setup/live.php`):**
  - **Atomic Trunk Wizard:** Saving a SIP trunk creates the gateway, main DID route, office hours, and ordered outbound rule together—keeping the trunk disabled until the handover window. Automatically resolves incoming carrier IPs from the trunk's hostname/SRV records.
  - **Readiness Checks:** Tests DNS, TCP, and TLS reachability without sending SIP REGISTER or call traffic.
  - **Call My Connected Phone:** An interactive test worker that rings the admin's own registered extension first, then dials out through the selected trunk for up to 3 minutes, recording every provider considered in **Provider Call Results** and verifying same-call primary→backup trunk failover (e.g., 503 triggers backup trunk; 486 Busy stops immediately).
  - **"Where Will This Call Go?" Routing Simulator:** Lets an admin pick any incoming DID or user extension and any local date/time to preview the exact routing path across office hours, breaks, holidays, and temporary Open/Closed overrides.
- **Meet — Built-In WebRTC Video Conferencing (`app/pbx_meet/`):**
  - Full browser-based audio/video conferencing (up to 25 participants, VP8 mixed video + screen sharing) built directly on FreeSWITCH without external media servers.
  - Includes scheduled rooms, calendar invites, URL fragment tokens (hashed in DB), a **Waiting Room** with host Admit/Reject/Lock/Mute/Remove/End controls, registered desk-phone audio dial-in, and **ephemeral room-scoped browser SIP credentials** that are rejected (`SIP 603`) if used to dial any ordinary extension outside the meeting room.
- **Native Companion Apps (`OpenWebPBX Free Phone` for Android & Windows):**
  - Native **Kotlin/Linphone Android app** (`mobile/android`) provisioned via a **single-use, 10-minute QR code** that enrolls device-specific credentials into the Android hardware Keystore.
  - Supports TLS/SRTP voice, colleague-to-colleague VP8 video upgrade with consent, hold/resume, blind/attended transfer, 3-way local conference merge, native voicemail playback, per-queue login/logout, and **UnifiedPush/VAPID wake-up** (using an optional Cloudflare Worker relay—zero Firebase project required).
  - **Managed App Update Feed:** The PBX hosts signed APK metadata and can enforce voluntary, auto-download, or mandatory minimum app versions per tenant or instance-wide (deferring installation if a call is active).
- **Queue Callbacks & Receptionist Switchboard (`docs/core-calling.md`):**
  - **Switchboard:** Polls every 3 seconds when visible; supports permission-gated (`pbx_core_control`) live call Hold/Resume, Transfer, Pick Up, End, and 20-slot shared parking (`*701`–`*7020`).
  - **Queue Callbacks:** Supports key-press (`2`), timed-offer, or automatic callbacks with two ordering policies: **Live Callers First** or **Keep Original Queue Position** (which tracks the caller's original queue timestamp against live waiting callers and reserves an available agent across all their assigned queues before dialing out).
- **Call Me Back Service & PIN-Free Own Voicemail (`121`) / Talking Clock (`1026`):**
  - **Call Me Back (`docs/call-me-back.md`):** A specialized inbound DID service where callers authenticate (e.g., via HMAC-hashed ID or saved CLI), hang up, and the PBX calls them back within a strict per-user lifetime minute quota and a native 600-second hard cutoff.
  - **PIN-Free Voicemail (`121`):** Retires voicemail PINs completely (eliminating toll-fraud/voicemail-hacking vectors); dialing `121` opens the caller's own mailbox strictly by verifying the authenticated SIP realm/extension/device identity.
- **Guarded Atomic Upgrades & SFTP Encrypted Backups (`packaging/debian/upgrade.py`, `backups.py`):**
  - Before any upgrade or migration, `upgrade.py` acquires `/run/openwebpbx-upgrade.lock`, pauses calls, snapshots all 150+ DB table multisets and file/permission manifests, applies the signed update, and **automatically rolls back to the exact byte/permission state** if any post-upgrade health or migration check fails.

---

## 3. Comprehensive Feature Matrix

Status key for **QwixBox**:
- **Working**: Built, deployed, and verified at the signaling/API layer (`docs/roadmap.md`).
- **Partial / Untested**: Code is deployed in `portal/api` / `resources/lua`, but either incomplete or awaiting real-hardware audio/carrier verification.
- **Mock UI / Schema Only**: Has a polished React UI in `portal/web` (backed by `getWithFallback` mock data and `<MockFeatureBanner>`) and/or a table in `schema.ts`, but **no backend route or FreeSWITCH runtime execution**.
- **Not Started**: Absent from runtime code (may have design notes in `docs/design/`).

| # | Feature / Capability | FusionPBX | FS PBX | OpenWeb PBX | QwixBox Current Status |
|---|---|---|---|---|---|
| **1** | **Multi-Tenancy & Isolation** | Domain-based (`v_domains`) | Domain-based + unified email login | Tenant workspaces + Departments + tenant subdomains | **Working** (`better-auth` Org + strict `requireTenant` on every route) |
| **2** | **RBAC & Staff Permissions** | Group permissions (`v_group_permissions`) | Spatie action + record-scope permissions (`_view_all` / `_view_self`) | 6 scoped staff roles (Owner, Admin, Dept Mgr, Receptionist, Queue Sup, User) | **Working** (`createAccessControl` in `auth.ts`, re-read from `member` row per request) |
| **3** | **Public SIP Security & Edge** | FreeSWITCH `mod_sofia` + `event_guard` + `fail2ban` | FreeSWITCH `mod_sofia` + `event_guard` + `fail2ban` | FreeSWITCH `mod_sofia` + `event_guard` + Phone Health unblock | **Working & Superior** (Kamailio edge: `htable` flood/pike/auth-ban + `rtpengine` + `fail2ban` + loopback FreeSWITCH) |
| **4** | **Credential Cryptography** | Plaintext SIP passwords & VM PINs in DB | Plaintext SIP passwords & VM PINs in DB | Preserved password bytes + sealed proofs; VM PINs retired (`121`) | **Working & Superior** (AES-256-GCM `*Enc` in API DB; only `ha1`/`ha1b` in Kamailio `subscriber`) |
| **5** | **SIP Trunks (IP Auth)** | Gateways + ACL (`v_access_controls`) | Gateways + ACL | Trunks + auto-DNS IP discovery + Trunk Options | **Working** (Kamailio `address` table projection + `X-Trunk-Target` routing) |
| **6** | **SIP Trunks (Register Auth & Failover)** | Native `mod_sofia` gateway registration + multiple bridges | Native `mod_sofia` gateway registration + outbound failover | Registration + same-call primary→backup trunk failover | **Partial** (`authMode="register"` rejected when enabled; 1 trunk per outbound route, no failover list) |
| **7** | **Inbound DID & Outbound Routing** | Regex/prefix dialplan XML | `PhoneNumbersController` + `CallRoutingOptionsService` | Trunk inline incoming routes + Outbound rules per department | **Working** (Global exact DID ownership + PCRE outbound routes with strip/prepend) |
| **8** | **Extensions (DND, Forwarding, Call Waiting)** | Full (`call_forward`, `follow_me`, DND, limit) | Full + per-extension stats & welcome emails | Full + office-hours status switching + Ring My Mobile | **Working** (`extension.lua` handles DND, `forwardAll/Busy/NoAnswer`, `limit_usage` call waiting, `*72/*78/*90/*92`) |
| **9** | **Multi-Device per Extension** | Multiple registrations on shared AoR or separate `v_devices` | Shared AoR + `Devices` + Ringotel mobile users | Shared AoR + individual QR-enrolled mobile device credentials | **Mock UI / Not Started** (1 credential set per extension; `devices.tsx` is mock-backed; `userDevice` in `backlog.md`) |
| **10** | **Device Auto-Provisioning & RPS/ZTP** | 14+ vendors via Smarty templates | Database Blade templates + Key Templates + Yealink RPS / Polycom ZTP + Provisioning Preview | Guided desk-phone handover + W60B/V62W support | **Mock UI / Partial** (`services/provisioning.ts` stub + `devices.tsx` mock UI; no `/prov` route or vendor templates) |
| **11** | **Contacts & Remote Phonebooks** | `core/contacts` | Vendor-specific `/prov/directory/{book}/{mac}` + LDAP/AD sync + `mod_cidlookup` | Company/department directory in Web & Android app | **Mock UI / Not Started** (`contacts.tsx` is mock-backed; `mod_cidlookup` compiled but unwired) |
| **12** | **Ring Groups** | Simultaneous, Enterprise, Sequence, Random, Rollover + Follow-Me prompt | Simultaneous, Sequence, Enterprise, Random, Rollover | Simultaneous & Hunting with preserved member order + audible ringback | **Working** (`ring_group.lua`: simultaneous, sequential, random, per-member delay, failover destination) |
| **13** | **IVR / Digital Receptionist** | Multi-level, multi-digit, direct-dial extensions, TTS/phrases | `VirtualReceptionistController` + VueForm editor | Digital Receptionists with DTMF mapping | **Partial** (`ivr.lua` single-digit `[0-9*#]` menu + retries + timeout; no direct extension dialing in IVR) |
| **14** | **Time Conditions & Business Hours** | Flexible `v_dialplans` time conditions + `call_flows` Day/Night toggle | Dedicated `BusinessHoursController` (periods + holidays) + Day/Night `CallFlowController` | Office Hours, Breaks, Holidays, Temporary 15m–24h Overrides, "Where Will This Call Go?" preview | **Working** (`time_condition.lua` with `invert` holiday rules; lacks temporary override & routing preview UI) |
| **15** | **Voicemail & MWI / Escalation** | Full VM, greetings, VM-to-email, MWI | Full VM + Vue UI + `vm_blf.lua` + Voicemail Escalation calls | PIN-free `121` own VM, Nathaniel UK voice pack, native Android VM player | **Mock UI / Partial** (`*97/*98` & `vm-mailto` configured in FreeSWITCH; `messages.tsx` VM tab is mock-backed, no VM API) |
| **16** | **Call Recordings & Archiving** | `call_recordings` + manual `*2` record | Policy-based recording + `S3RecordingArchiver` + retention | Post-answer hook stereo recording + retention/playback | **Mock UI / Partial** (`recordingPolicy` in `schema.ts` & `cdr.recordingPath`, but `extension.lua`/`xml_handler.lua` never invoke `record_session`; `messages.tsx` recordings tab is mock-backed) |
| **17** | **Call Queues (ACD) & Wallboard** | `mod_callcenter` & `mod_fifo` (Wallboard is $500/mo Purple member app) | Basic Queues (built-in) + Contact Center Pro module | Queues + Wallboard + Queue Reports + Agent-First Queue Callbacks | **Mock UI / Schema Only** (`queue` table in `schema.ts`, `telephony.ts` returns `"Queues are not implemented"`, `queues.tsx` is mock-backed) |
| **18** | **Conferences (Audio / Video)** | `conferences` + `conference_centers` (`mod_conference`) | Native `ConferenceController` + Active Conferences live control | **Meet** (WebRTC VP8 video + screen share + waiting room + phone dial-in) | **Mock UI / Not Started** (`conferences.tsx` is mock-backed; `mod_conference` not autoloaded; video disabled via `--disable-libvpx`) |
| **19** | **Call Parking & Valet Park** | `valet_park` (`*5900` / `*5901–*5999`) + BLF | Monitored Call Park (`park+*5901`) with key templates | 20-slot shared parking (`*701`–`*7020`) + Switchboard park/pickup | **Mock UI / Not Started** (`conferences.tsx` Parking tab is mock-backed; `mod_valet_parking` not enabled) |
| **20** | **Music on Hold (MoH)** | `music_on_hold` + `streams` | Multi-rate `ffmpeg` (`8k/16k/32k/48k`) stream families + global/domain streams | Bundled CC0 hold music + custom streams | **Mock UI / Not Started** (`conferences.tsx` MoH tab is mock-backed; `mod_shout` compiled but no MoH API/table) |
| **21** | **WebRTC Softphone & Switchboard** | `operator_panel` + `basic_operator_panel` | Active Calls + Ringotel softphone integration | Receptionist Switchboard (Hold/Transfer/Park/Pickup) + Android/Windows apps | **Mock UI / Untested** (Kamailio WSS & rtpengine configured; `WebphoneDrawer.tsx` is a pure UI timer mockup with no SIP.js client) |
| **22** | **Emergency Calling (E911)** | `app/emergency` + `emergency_notify.lua` | `EmergencyCallController` + `fs-esl-listener-emergency` + email/member alerts | Explicit emergency routes + location caller ID | **Mock UI / Partial** (`isEmergency` route flag works; `emergency_location` table is unused in API/Lua; `emergency.tsx` is mock-backed) |
| **23** | **Fax Server (Inbound / Outbound)** | `fax` + `fax_queue` (inbound & outbound + cover pages) | Inbound & Outbound (`outbound_faxes` + `FaxSendService` + retention cleanup) | Fax / analogue gateway support | **Partial (Inbound Only)** (`fax_receive.lua` + `/fs/fax` + email PDF delivery written; no outbound faxing) |
| **24** | **SMS / MMS Messaging** | Community/member plugins | Native 9-carrier SMS/MMS webhooks + S3 media + Ringotel/Email delivery | Planned (`MESSAGE-01` to `MESSAGE-07`) | **Mock UI / Not Started** (`messages.tsx` SMS & Opt-Out tabs are mock-backed; design in `backlog.md`) |
| **25** | **Call Blocking / Spam Control** | `app/call_block` | Redis-cached `call_block.lua` + `WhitelistedNumbersController` | Blocked numbers & anonymous rejection in Call Routing | **Not Started** (No call-block table, Redis key, or Lua check) |
| **26** | **AI Transcription & Voice Assistants** | None built-in | Native `AiAgent`, `CallTranscription` (OpenAI, AssemblyAI, Watson, Azure) | Roadmap (`AI-01` to `AI-04`) + ElevenLabs greeting generator | **Not Started** (Notes in `roadmap.md`) |
| **27** | **Hospitality / Wake-Up / Bells** | `wakeup` / `call_broadcast` | Full PMS (`TigerTMS`, `CharPMS`), room status, Wake-up Calls, Scheduled Announcements | Hotel check-in/out, DND, vacant restrictions, admin wake-up calls, Talking Clock `1026` | **Not Started** |
| **28** | **Backups, Restore & Updaters** | Cron shell script (`fusionpbx-backup`) | Logical replication HA + Syncthing + S3 archiver + `php artisan app:update` | Encrypted local/SFTP backups + 3CX V20 importer + atomic rollback updater (`upgrade.py`) | **Partial** (`51-backups.sh` runs `pg_dump` + `/etc/qwixbox/config.env`; restore not yet automated/proven) |

---

## 4. Architectural Comparison: How QwixBox Functions vs. Reference Apps

### 4.1 Where QwixBox Is Architecturally Ahead (Keep & Protect)

1. **SIP Perimeter Separation (Kamailio + Loopback FreeSWITCH + rtpengine):**
   - **Reference Apps:** FusionPBX, FS PBX, and OpenWeb PBX all expose FreeSWITCH's `mod_sofia` directly to the internet on UDP/TCP/TLS 5060/5080. FreeSWITCH is a back-to-back user agent (B2BUA) and media engine; exposing it directly means every SIP scanner hit allocates Sofia parser threads and fires ESL events that a secondary daemon (`event_guard` or `fail2ban`) must chase after the fact.
   - **QwixBox:** Kamailio sits in front on 5060/5061/WSS, handling stateless/stateful packet validation, `pike` flood detection, `htable` per-IP authentication failure bans, `usrloc` registrations, and `rtpengine` media pinning. FreeSWITCH listens *only* on `127.0.0.1:5080`. **Never regress to exposing FreeSWITCH directly.**

2. **Zero-Plaintext Credential Storage:**
   - **Reference Apps:** Because `mod_sofia` normally computes SIP digest responses from `<param name="password" value="..."/>` in the directory XML, FusionPBX and FS PBX store every extension's SIP password in plaintext in `v_extensions.password`. A single SQL injection or database dump compromises every phone on the switch.
   - **QwixBox:** Application secrets (`sipPasswordEnc`, `voicemailPinEnc`, `passwordEnc`) are encrypted at rest with **AES-256-GCM** (`portal/api/src/lib/crypto.ts`). Kamailio authenticates endpoints using pre-computed **`ha1`/`ha1b` MD5 digests** (`calculate_ha1=0`) projected one-way into Kamailio's `subscriber` table (`services/kamailio-sync.ts`), with `subscriber.password` kept empty.

3. **Two-Tier Read-Only Call-Time Resolution & `mod_hiredis` Hardening:**
   - **Reference Apps:** FusionPBX's `xml_handler` executes SQL queries inside Lua during call setup and writes generated XML files to `/var/cache/fusionpbx/`. FS PBX moved `call_block.lua` to Redis (`mod_hiredis`), *but* calls `api:execute("hiredis_raw", ...)` on an unpatched FreeSWITCH build—which is vulnerable to the exact upstream FreeSWITCH `mod_hiredis` printf format-string bug documented in QwixBox's `CLAUDE.md` (any `%` in a cached string corrupts memory or crashes FreeSWITCH).
   - **QwixBox:** Patches `mod_hiredis` at build time (`30-freeswitch.sh`), keeps Lua 100% free of PostgreSQL connections, serves call setup from contractual Redis keys (`xml_handler.lua`) with an automatic warm-sentinel watchdog (`qwixbox:warm`), and falls back cleanly to `mod_xml_curl` (`/fs/xml`) if Redis misses.

4. **Loop-Bounded Runtime Destination Dispatch (`qwixbox.go`):**
   - **Reference Apps:** FusionPBX and FS PBX compile routing into static `dialplan_xml` strings stored in `v_dialplans` when saving a form. If routing logic changes in code, existing records keep their old XML until re-saved (`AGENTS.md` line 111 in FS PBX explicitly warns about this). Furthermore, circular routes (IVR → Time Condition → Ring Group → IVR) can loop until FreeSWITCH hits `max_forwards`.
   - **QwixBox:** Evaluates routing dynamically from structured JSON state in Redis via `qwixbox.go()` (`resources/lua/qwixbox.lua`), enforcing `MAX_DEPTH = 10` across all hops (including external transfers via the `qwixbox_depth` channel variable).

5. **Structural Multi-Tenant Authorization:**
   - **Reference Apps:** Rely on developers remembering to filter by `session('domain_uuid')` (FS PBX's `AGENTS.md` documents historical bugs where `Extensions::voicemail()` lacked a `domain_uuid` constraint and leaked/mutated cross-tenant voicemails).
   - **QwixBox:** Enforces `requireTenant` and requires a `permission` key on `crudRoutes()` (`portal/api/src/lib/crud.ts`), while re-reading the user's `member` role on every request.

---

### 4.2 Where the Reference Apps Excel (Best Practices to Adopt in QwixBox)

By studying the codebases of **FusionPBX**, **FS PBX**, and **OpenWeb PBX**, we can adopt twelve high-impact engineering and product best practices to elevate QwixBox:

#### Best Practice 1: Post-Answer Recording Hook & Audible Ringback Preservation (from OpenWeb PBX)
- **The Problem OpenWeb PBX Solved:** In FreeSWITCH, starting `record_session` before the B-leg answers causes FreeSWITCH to pre-answer the A-leg with silent `183 Session Progress` early media (so callers hear dead silence instead of ringing) and writes empty WAV files for unanswered calls.
- **How to Apply in QwixBox:** When wiring `tenantSettings.recordingPolicy` (`none | inbound | outbound | all`) in `xml_handler.lua` and `extension.lua`, **never** invoke `record_session` directly before `bridge`. Instead, set `media_bug_answer_req=true` and bind `execute_on_answer=record_session <path>` so recording starts strictly upon B-leg answer, preserving `180 Ringing` to the caller and avoiding zero-second orphan recordings.

#### Best Practice 2: Multi-Rate Pre-Transcoded Audio Families for Music on Hold & Prompts (from FS PBX)
- **The Problem FS PBX Solved:** Uploading an arbitrary MP3/WAV for Music on Hold or IVR greetings forces FreeSWITCH to resample audio on the fly for every bridged channel, degrading audio quality (especially between 8 kHz PSTN G.711 legs and 48 kHz Opus legs) and wasting CPU.
- **How to Apply in QwixBox:** QwixBox already installs `8000` and `48000` Callie sound rates (`FS_SOUND_RATES="8000 48000"`). When implementing custom Music on Hold and IVR greeting uploads in `portal/api`, transcode uploaded audio once at upload time via `ffmpeg` into mono 16-bit PCM WAV at both `8000` and `48000` Hz (`sounds/music/<domain>/<stream>/8000` and `/48000`), and let `mod_local_stream` serve the native sample rate of each call leg with zero transcoding.

#### Best Practice 3: Silence Lead-In Before Auto-Answer / IVR / Voicemail Prompts (from FS PBX & QwixBox)
- **The Problem FS PBX Solved:** On paging/auto-answer endpoints and newly established RTP streams, the first 200–500ms of audio is often clipped while RTP NAT pinholes (`rtpengine`) and jitter buffers stabilize.
- **How to Apply in QwixBox:** QwixBox already uses `silence_stream://500` in `ivr.lua` and `silence_stream://300` in `feature_code.lua`. Preserve this pattern everywhere new audio is introduced (Queues, Conferences, Paging, Scheduled Announcements, and Voicemail greeting playback).

#### Best Practice 4: "Where Will This Call Go?" Date/Time Route Simulator & Temporary Overrides (from OpenWeb PBX)
- **The Problem OpenWeb PBX Solved:** Administrators configuring time conditions, holiday rules, and ring groups frequently misconfigure weekday numbers, timezones, or rule inversion, and only discover the mistake when customers complain that the main number went to voicemail during business hours.
- **How to Apply in QwixBox:** Add a read-only `POST /api/tenant/simulate-route` endpoint (and a "Test Route / Where Will This Call Go?" drawer in `portal/web/src/routes/_app/routing.tsx` and `call-flows.tsx`) that takes `{ number, timestamp }` and evaluates the exact DID → Time Condition → Ring Group / IVR → Extension chain against the tenant's timezone and rules, returning the visual step-by-step trace. Also add a `temporaryOverride` (`open | closed`, `expiresAt`) field to `timeCondition` so receptionists can force an office open/closed for 15m–24h with automatic expiry.

#### Best Practice 5: "First Calls" Trunk Readiness & Ordered Failover Trunks (from OpenWeb PBX)
- **The Problem OpenWeb PBX Solved:** Setting up a SIP carrier trunk is error-prone. If a primary trunk returns `503 Service Unavailable`, calls drop unless ordered backup trunks are configured; conversely, if a callee returns `486 User Busy`, failing over to a second trunk rings the busy user a second time.
- **How to Apply in QwixBox:**
  1. Support **ordered fallback trunks** on `outboundRoute` (or multiple routes sharing a pattern ordered by `priority`), where `xml_handler.lua` / `fs-xml.ts` chains `bridge` actions separated by `|` with `continue_on_fail=NORMAL_TEMPORARY_FAILURE,SWITCH_CONGESTION,NO_ROUTE_DESTINATION,GATEWAY_DOWN` (explicitly excluding `USER_BUSY`, `CALL_REJECTED`, and `ORIGINATOR_CANCEL` so busy/canceled calls stop immediately).
  2. Add a **Trunk Readiness Probe** (`POST /api/trunks/:id/check`) that validates DNS resolution, IP literal/subnet ACL status in Kamailio (`kamcmd permissions.addressDump`), and TCP/UDP reachability.

#### Best Practice 6: Phone & Trunk Health Monitor + Controlled Block Recovery (from OpenWeb PBX)
- **The Problem OpenWeb PBX Solved:** When an office router or desk phone fails SIP digest auth repeatedly (e.g., during credential rotation), Kamailio's `htable` (`authban`) or `fail2ban` blocks the office's public IP. Support teams then waste hours SSHing into the server to run `fail2ban-client` or `kamcmd`, or worse, permanently whitelist customer IPs.
- **How to Apply in QwixBox:**
  1. Expose live registration status from Kamailio's `location` table (`SELECT username, domain, contact, received, user_agent, expires FROM location`) in `portal/api` so the Extensions and Devices pages show real-time **Online / Offline** status, source IP, and User-Agent.
  2. Record successful registration source IPs per tenant (`verified_endpoint_ip`).
  3. Add a **Phone Health & Unblock** API (`GET /api/security/blocks`, `POST /api/security/unblock`) that queries Kamailio's `authban` htable (`kamcmd htable.dump authban`) and `fail2ban`, allowing a tenant `owner`/`admin` to clear a block *only* if the blocked IP matches a previously verified registration IP for their tenant, with a 15-minute cooldown and an `audit_log` entry.

#### Best Practice 7: Event-Driven Lua BLF / MWI Presence Daemons (from FS PBX & FusionPBX)
- **The Problem FS PBX Solved:** Desk phones (Yealink, Grandstream, Poly, Fanvil) expect BLF keys to light up when a shared voicemail box has messages (`vm200@domain`), when a Day/Night Call Flow toggle is active (`flow700@domain`), when DND/Follow-Me is enabled, or when an agent is logged in/on break (`agent101@domain`).
- **How to Apply in QwixBox:** Because endpoints register to Kamailio, route `SUBSCRIBE` / `PUBLISH` for feature/extension presence or relay FreeSWITCH `PRESENCE_IN` / `MESSAGE_WAITING` events via Kamailio (`presence` / `presence_xml` / `presence_mwi` or forwarding `SUBSCRIBE` to FreeSWITCH with `sip_route_uri`), backed by a lightweight FreeSWITCH Lua event consumer or API hook when `*78`/`*79` (DND), Call Flow toggles, or Voicemails change state.

#### Best Practice 8: Vendor-Normalized Remote Phonebooks & Blade-Style Provisioning Previews (from FS PBX)
- **The Problem FS PBX Solved:** Writing raw XML phone provisioning templates blind leads to broken phones, and different phone vendors handle remote XML directories incompatibly (Grandstream supports only one merged XML URL without an `https://` scheme in `P331`, whereas Yealink supports multiple URLs).
- **How to Apply in QwixBox:**
  1. When building `/prov/:token/:filename` in `portal/api`, include a permission-gated **Provisioning Preview** endpoint (`GET /api/devices/:id/preview`) so admins can inspect the rendered config in the portal before rebooting a phone.
  2. Serve remote XML directories from `/prov/:token/directory.xml` rendered directly from the tenant's `extension` + `contact` tables, auto-detecting the vendor from the `User-Agent` or device record (`YealinkIPPhoneDirectory` vs. Grandstream `AddressBook`).

#### Best Practice 9: Single-Use, Time-Bounded QR Enrollment for Mobile/WebRTC Endpoints (from OpenWeb PBX)
- **The Problem OpenWeb PBX Solved:** Copying and pasting SIP domains, usernames, and complex passwords onto mobile phones is frustrating and exposes credentials in plaintext emails or chat logs.
- **How to Apply in QwixBox:** Add `POST /api/extensions/:id/enrollment-token` (or `/api/devices/:id/enrollment-token`) that generates a single-use, 10-minute token stored in Redis (`qwixbox:enroll:<token>`, `EX 600`) and renders a QR code in the portal (`portal/web`). Scanning the QR code exchanges the token once over HTTPS for the device's SIP credentials and immediately deletes the Redis key.

#### Best Practice 10: Redis-Cached Inbound Call Blocking with Fail-Open Safety (from FS PBX)
- **The Problem FS PBX Solved:** Tenants inevitably face robocalls, spam callers, or abusive numbers and need per-tenant or per-extension block/allow rules (`Reject`, `Busy`, `Voicemail`, `Hold Forever`) that execute in microseconds during call setup.
- **How to Apply in QwixBox:** Add a `call_block` table in `schema.ts`, project active blocked numbers per tenant into Redis (`qwixbox:block:<domain>`), and check the caller number in `xml_handler.lua` (`M.dialplan`) before routing to DIDs/extensions—failing open if the key is absent.

#### Best Practice 11: PIN-Free Authenticated Own-Mailbox Access + Voicemail Brute-Force Elimination (from OpenWeb PBX)
- **The Problem OpenWeb PBX Solved:** Voicemail PINs are frequently weak (`1234` or the extension number) and are a historical vector for PBX compromise.
- **How to Apply in QwixBox:** Notice in `resources/lua/xml_handler.lua` lines 231–245:
  ```lua
  if destination == "*97" and caller then
    vm_args = string.format("check auth default %s %s", domain, caller)
  ```
  QwixBox *already* passes `auth` when `*97` is dialed by an authenticated user (`X-Auth-User`)! We should take OpenWeb PBX's best practice one step further:
  1. Refuse `*98` (cross-mailbox login by PIN) from unauthenticated external trunks (`X-Trusted-Peer == "1"`) unless explicitly enabled per tenant, preventing PSTN callers from brute-forcing voicemail PINs.
  2. Make `voicemailPinEnc` optional when `voicemailEnabled=true` if the user only checks voicemail from their own authenticated extension (`*97`) or the web portal.

#### Best Practice 12: Automated Restore Verification & Call-Aware Maintenance Guard (from OpenWeb PBX)
- **The Problem OpenWeb PBX Solved:** A backup script (`51-backups.sh`) that has never been restored is an unverified hypothesis (as `docs/mvp.md` Blocker #5 explicitly notes), and running `install.sh` or service restarts during business hours drops active calls.
- **How to Apply in QwixBox:**
  1. Add a `--drain` / call-aware check in `install.sh` (using `fs_cli -x "show calls count"` and `fs_cli -x "fsctl pause"`) before restarting FreeSWITCH or Kamailio on an already-installed system.
  2. Add a `restore-backup.sh` script (and automated container test) that restores both the PostgreSQL dump (`qwixbox` + `kamailio`) *and* `/etc/qwixbox/config.env` (`ENCRYPTION_KEY`), then triggers `rebuildTenant` and `kamailio-sync` projection and verifies that encrypted secrets decrypt cleanly.
