# Product roadmap

Carried over from QwixPBX v1's `ROADMAP.md` (27 areas), **re-marked against what this codebase
actually contains**. v1's own status markers were unreliable — it marked Billing, FAX and
SMS/Messaging as complete when they had schema and no working feature — so every line below was
checked against the code rather than copied.

For what blocks a shippable product, see **[mvp.md](mvp.md)** — this file is the long view.

Inventory re-checked against `bbbad56` on 2026-10-27. Current test evidence is in
[status](status.md); open findings are in [issues](issues.md).

## Status key

| Mark | Meaning |
|---|---|
| **Implemented** | Source implementation exists; consult current status for tested behavior and historical runtime evidence |
| **Untested** | Code exists; end-to-end acceptance evidence is missing |
| **Partial** | Real but incomplete — the gap is named |
| **Schema only** | A table exists; nothing reads or writes it as a feature |
| **Not started** | No live backend workflow; design and preview UI may exist |

Implementation and runtime acceptance are separate claims. Four bugs found on
2026-07-31 were all code that read as correct and did nothing, and static review caught none of
them. "Deployed" is not evidence.

**Historical telephony proofs cover signalling only.** Two-way audio has not been
confirmed on any call, so voicemail recording, IVR DTMF and fax remain unproven regardless of how
complete their code looks. [mvp.md](mvp.md) item 1 is that test.

## Where the product is

| # | Area | Status | Notes |
|---|---|---|---|
| 1 | Multi-tenancy & administration | **Implemented** | Tenant = better-auth organization; `requireTenant` refuses an unscoped request |
| 2 | User management & authentication | **Implemented** | better-auth, RBAC via `createAccessControl`, no self-service registration by design. Users page in the portal, roles enforced server-side per request, password reset by email verified end to end. The installer creates the first account and tenant |
| 3 | Extension & device management | **Partial** | Extensions work; one credential set per extension. Multi-device in [backlog](design/backlog.md) |
| 4 | Dialplan & call routing | **Partial** | Historical extension/DID/outbound signalling. Outbound caller ID (I03), authorized peer forwarding (R11) and one number namespace per tenant (I19) are fixed and pass container harnesses; real-carrier checks are owed |
| 5 | Call features | **Partial** | Historical ring-group/time-condition/feature-code signalling. Ring-group member DND/call waiting and sequential timing fixed (I05); caller concurrency fixed in code (I06), live check owed; no MoH management or parking |
| 6 | Voicemail | **Partial** | Reached and answered (`*97`, ring-group failover) with prompts loading; no message has been left or delivered to email, and that needs real audio |
| 7 | IVR | **Partial** | A call traverses the menu and the timeout destination is honoured; DTMF selection needs a real endpoint |
| 8 | Conference rooms | **Not started** | [backlog](design/backlog.md) |
| 9 | Call centre / contact centre | **Schema only** | A bare `queue` table. The big one — [design](design/call-centre.md) |
| 10 | CDR & reporting | **Partial** | CDR ingest wired; call list with filters, aggregate summary and CSV export in the portal. No reporting beyond that |
| 11 | Real-time monitoring | **Not started** | ESL client exists (`services/esl.ts`); no wallboard |
| 12 | Trunks & providers | **Implemented** | IP trunks and Kamailio projection; outbound signalling historically verified. Enabled registration trunks are rejected until their registration/challenge path exists |
| 13 | Contacts & directory | **Not started** | [backlog](design/backlog.md); `mod_cidlookup` is built and unused |
| 14 | WebRTC & softphone | **Untested** | WSS listens and rtpengine is in the media path in config; no browser client has connected. A native softphone does register |
| 15 | System administration | **Partial** | Installer, setup wizard, pinned bootstrap, health checks and log rotation exist. Cloudflare publication is implemented; Domain Connect discovery exists but provider approval is unverified. Backups reject missing encryption config; `restore.sh` restored a snapshot onto a fresh arm64 container (I13), and a real-host restore (gate 5) is owed |
| 16 | Integration & APIs | **Partial** | The REST API is the integration surface and the portal is a client of it. Audit trail readable via `/api/audit`. No webhooks |
| 17 | Billing & invoicing | **Not started** | v1 marked this complete; it was not — [design](design/billing.md) |
| 18 | Call transcription & AI | **Not started** | Premium in v1's plan |
| 19 | AI digital receptionist | **Not started** | See below |
| 20 | FAX | **Untested** | Inbound fax to email is written end to end (`fax_receive.lua`, `/fs/fax`, `services/fax.ts`) with T.38 via `mod_spandsp`; no fax has been sent or received |
| 21 | SMS / messaging | **Not started** | v1 marked complete; schema only — [backlog](design/backlog.md) |
| 22 | Hospitality / hotel module | **Not started** | Speculative |
| 23 | Omnichannel | **Not started** | Speculative |
| 24 | Storage & infrastructure | **Partial** | Local disk plus scheduled `pg_dump`; no object storage |
| 25 | Grafana monitoring | **Not started** | `prometheus-node-exporter` is installed by `52-monitoring.sh` |
| 26 | ClickHouse analytics | **Not started** | Premium in v1's plan |
| 27 | STIR/SHAKEN | **Partial** | `33-stir-shaken.sh` exists, off by default; source build historically failed on Debian 13; current build not rerun |

## Editions

v1 split the product into a free **Basic** edition and a **Premium** contact-centre edition, with
the call centre, transcription/AI, ClickHouse and HA as the premium line. That split is worth
keeping in mind while building area 9, because it determines whether the call centre is a bolt-on
or an assumption — but nothing in this codebase enforces an edition boundary today, and adding one
before there is a product to sell would be the wrong order.

## Notes on specific areas

**4 — Call routing.** All three paths were broken and are now fixed and verified: outbound died
in Kamailio's empty `dr_*` tables (and again in `mod_hiredis` corrupting the route pattern), while
extension-to-extension and inbound DID both died because FreeSWITCH held no registrations —
endpoints register to Kamailio. See `CLAUDE.md` for the mechanics. Registration is now proven on
real hardware, but **media has still never been tested** — only signalling; [mvp.md](mvp.md)
covers what that leaves open.

**9 — Call centre.** The largest single gap and the best-documented part of v1. The architecture is
settled: `mod_callcenter` runs the queue, we own configuration and history. See
[design/call-centre.md](design/call-centre.md).

**17 — Billing.** Blocked on nothing technical. The design is in
[design/billing.md](design/billing.md); the decision it needs is whether prepaid (real-time credit
control on the call path) is in scope, because that is most of the work.

**19 — AI digital receptionist.** v1 had a 255-line design document and a six-table schema
(`ai_receptionist_config`, `ai_intents`, `ai_training_data`, `ai_conversations`, `ai_messages`,
`ai_analytics`). It is an IVR whose branching is driven by speech recognition and intent matching
rather than DTMF, which means it slots into the existing destination model — an AI receptionist is
just another destination type resolved by `qwixbox.go`. The hard parts are latency (speech
recognition sits on the call path, where the existing budget for a Redis lookup is 200ms) and cost
per minute. Not designed further here; the schema is recoverable from the archived v1 repo at
`6c4ea50` if it is picked up.

**25 — Grafana.** `52-monitoring.sh` already installs `prometheus-node-exporter` and its
collectors, so host metrics are being produced and nothing consumes them. That is the cheapest gap
on this list to close.

**27 — STIR/SHAKEN.** An earlier `libstirshaken` source build failed on Debian 13 with a
deprecated OpenSSL API under `-Werror`; this review did not rerun it. The step is off by default, so
this does not affect installs, but the area is not simply "not enabled".

---

## Portal UI Mock-to-Live (TODO)

The portal (`portal/web`) has UI screens for features the API does not implement yet. These screens
read their data through `getPreview()` in `portal/web/src/lib/api.ts`. The API answers `404` for each
of these paths, and the screen then shows "Not available on this server". Until 2026-10-25 a 404
returned seed data from `portal/web/mock/data.ts` instead, which showed invented E911 locations in
production (I01, fixed). The Vite build now refuses to bundle `mock/` outside mock mode.

The per-feature engineering detail lives in one place, so it cannot drift:
**[implementation design](design/implementation-plan.md)**. It is proposed architecture retained
from 2026-10-24, not current implementation status. The duplicate summary was retired.

| Portal screen | Route / component | Endpoints with no live route | Plan section |
| :--- | :--- | :--- | :--- |
| Dashboard counters | `src/routes/_app/index.tsx` | `/voicemails`, `/sms-threads`, `/queues` | Follows 2.4, 3.1, 3.5 |
| Voicemail | `src/routes/_app/messages.tsx` | `/voicemails` | 2.4 |
| Call recordings | `src/routes/_app/messages.tsx` | `/recordings` | 2.3 |
| SMS / opt-outs | `src/routes/_app/messages.tsx` | `/sms-threads`, `/sms-opt-outs` | 3.5 |
| Contacts | `src/routes/_app/contacts.tsx` | `/contacts` | 3.4 |
| Queues & wallboard | `src/routes/_app/queues.tsx` | `/queues`, `/queue-agents` | 3.1 |
| Emergency (E911) | `src/routes/_app/emergency.tsx` | `/emergency-locations` | 2.1 |
| Conferences, parking, MoH | `src/routes/_app/conferences.tsx` | `/conferences`, `/parking-lots`, `/music-on-hold` | 3.2 |
| Devices & provisioning | `src/routes/_app/devices.tsx` | `/devices` | 3.3 |
| WebRTC softphone | `src/components/WebphoneDrawer.tsx` (mock mode only) | None: a UI timer with no SIP stack | 3.6 |

The plan's design rules (§0, invariants 8–10) record three things that change how several of these
features have to be built:

- **Inbound carrier calls never reach `xml_handler.lua`.** They are resolved by `fs-xml.ts` and then
  `destination.lua`.
- **FreeSWITCH holds no registrations and no subscriptions, and Kamailio has no presence modules.**
  Voicemail lamps, BLF keys and phone resync have no delivery path yet.
- **No portal user is linked to an extension.** Anything scoped to "my extension" needs
  that link first (plan §2.0).
