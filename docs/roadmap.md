# Product roadmap

Carried over from QwixPBX v1's `ROADMAP.md` (27 areas), **re-marked against what this codebase
actually contains**. v1's own status markers were unreliable — it marked Billing, FAX and
SMS/Messaging as complete when they had schema and no working feature — so every line below was
checked against the code rather than copied.

## Status key

| Mark | Meaning |
|---|---|
| **Working** | Built, deployed by the installer, and exercised by the postflight checks |
| **Partial** | Real but incomplete — the gap is named |
| **Schema only** | A table exists; nothing reads or writes it as a feature |
| **Not started** | Design may exist under `docs/design/`; no code |

## Where the product is

| # | Area | Status | Notes |
|---|---|---|---|
| 1 | Multi-tenancy & administration | **Working** | Tenant = better-auth organization; `requireTenant` refuses an unscoped request |
| 2 | User management & authentication | **Working** | better-auth, RBAC via `createAccessControl`, no self-service registration by design |
| 3 | Extension & device management | **Partial** | Extensions work; one credential set per extension. Multi-device in [backlog](design/backlog.md) |
| 4 | Dialplan & call routing | **Working** | Inbound/outbound routes, `mod_lua` → Redis → `mod_xml_curl` resolution |
| 5 | Call features | **Partial** | Ring groups, time conditions, feature codes. No MoH management or parking |
| 6 | Voicemail | **Working** | `mod_voicemail`, voicemail-to-email through Postfix |
| 7 | IVR | **Working** | Menus and options, depth-limited against routing loops |
| 8 | Conference rooms | **Not started** | [backlog](design/backlog.md) |
| 9 | Call centre / contact centre | **Schema only** | A bare `queue` table. The big one — [design](design/call-centre.md) |
| 10 | CDR & reporting | **Partial** | CDR captured and attributed; no reporting beyond a call list |
| 11 | Real-time monitoring | **Not started** | ESL client exists (`services/esl.ts`); no wallboard |
| 12 | Trunks & providers | **Working** | Trunks with encrypted credentials, Kamailio projection |
| 13 | Contacts & directory | **Not started** | [backlog](design/backlog.md); `mod_cidlookup` is built and unused |
| 14 | WebRTC & softphone | **Partial** | WSS listener and rtpengine bridging work; no softphone in the portal |
| 15 | System administration | **Working** | Installer, wizard, health checks, backups, log rotation |
| 16 | Integration & APIs | **Partial** | The REST API is the integration surface; no webhooks |
| 17 | Billing & invoicing | **Not started** | v1 marked this complete; it was not — [design](design/billing.md) |
| 18 | Call transcription & AI | **Not started** | Premium in v1's plan |
| 19 | AI digital receptionist | **Not started** | See below |
| 20 | FAX | **Working** | Inbound fax to email, T.38 via `mod_spandsp` |
| 21 | SMS / messaging | **Not started** | v1 marked complete; schema only — [backlog](design/backlog.md) |
| 22 | Hospitality / hotel module | **Not started** | Speculative |
| 23 | Omnichannel | **Not started** | Speculative |
| 24 | Storage & infrastructure | **Partial** | Local disk plus scheduled `pg_dump`; no object storage |
| 25 | Grafana monitoring | **Not started** | `prometheus-node-exporter` is installed by `52-monitoring.sh` |
| 26 | ClickHouse analytics | **Not started** | Premium in v1's plan |
| 27 | STIR/SHAKEN | **Partial** | `33-stir-shaken.sh` exists, off by default; source build currently fails on Debian 13 |

## Editions

v1 split the product into a free **Basic** edition and a **Premium** contact-centre edition, with
the call centre, transcription/AI, ClickHouse and HA as the premium line. That split is worth
keeping in mind while building area 9, because it determines whether the call centre is a bolt-on
or an assumption — but nothing in this codebase enforces an edition boundary today, and adding one
before there is a product to sell would be the wrong order.

## Notes on specific areas

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

**27 — STIR/SHAKEN.** Worth knowing before planning: the `libstirshaken` source build currently
fails on Debian 13 with a deprecated OpenSSL API under `-Werror`. The step is off by default, so
this does not affect installs, but the area is not simply "not enabled".
