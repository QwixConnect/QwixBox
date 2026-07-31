# QwixPBX v1 — what it was, and what was kept

`QwixPBX_v1` was the first attempt at this product. It is archived; this document is what was
worth carrying out of it.

**Provenance:** `github.com/QwixPBX/QwixPBX_v1` at `6c4ea50`, 28 commits, last touched
2026-01-13. 193 files, ~123k lines.

## What it was

A Go API (42 files) and a React portal, driving FreeSWITCH through **static dialplan XML** and
**Lua that queried Postgres directly**, with Kamailio in front. Its own `TODO.md` put it at ~23%
complete, and nearly all of that was the authentication system: JWT sessions, password policies,
an email/branding stack, and a partial RBAC layer.

It also carried a very complete *schema* for features it had not built — a call centre, billing,
SMS, conferencing — which is the part that had lasting value.

## Why none of the code came across

This project solved the same problems differently, and in most cases had already gone further.

| v1 | Why it was dropped |
|---|---|
| Go API, 42 files | Different language. Porting is a rewrite in any case, so the *design* is the only transferable part. |
| Auth system (v1's Phases 1–3) | Superseded. This project uses better-auth with organizations-as-tenants, a role re-read from the `member` row on every request, and `requirePermission`. v1's equivalent was ~23% done and had no equivalent of the structural gate in `crudRoutes`. |
| `resources/freeswitch/scripts/*.lua` | **Deliberately not reintroduced.** These query Postgres from Lua. That tier was planned here, half-written, never called, and removed — see the note in `CLAUDE.md`. Reimplementing DID, feature-number and outbound-route resolution in a second language is the cost; the case it was for (a cold cache) is handled by the API's warm watchdog. |
| Static dialplan XML | Different architecture. Call-time resolution here is `mod_lua` → Redis → `mod_xml_curl`, with every polymorphic destination resolving in one place (`qwixbox.go` in `resources/lua/qwixbox.lua`). Static XML cannot express that. |
| `install/` shell scripts | This project's installer is substantially further along — idempotent step markers keyed on content hashes, role-based step selection, templated config under `resources/conf/`, a setup wizard and a postflight suite. |
| `reference/` | Empty apart from a README and one screenshot. No third-party code was vendored, so there is no licensing question to resolve. |

## What was kept

Design only — no schema in this repo changed as a result. See `docs/design/`:

- **[Call centre](design/call-centre.md)** — the largest gap, and v1's best-developed schema.
- **[Billing](design/billing.md)** — rate cards, usage, invoicing.
- **[Tenancy and resellers](design/tenancy-and-resellers.md)** — the branding-inheritance idea, and
  why a level above the tenant is awkward here.
- **[Backlog](design/backlog.md)** — SMS, conferences, device provisioning, contacts,
  music-on-hold, parking lots.
- **[Roadmap](roadmap.md)** — v1's 27-area product roadmap, re-marked against what actually exists.

## The finding that mattered most

v1's `agents`, `members` and `tiers` tables are not a design — they are **`mod_callcenter`'s own
schema**, copied. The column sets give it away: `instance_id`, `wrap_up_time`, `busy_delay_time`,
`no_answer_delay_time`, `calls_answered`, `talk_time`, `ready_time` on agents; `session_uuid`,
`joined_epoch`, `bridge_epoch`, `abandoned_epoch`, `base_score`, `skill_score`, `serving_agent` on
members. v1's `queue_settings` is likewise a one-to-one map of `mod_callcenter`'s queue parameters.

So v1 had already decided to run the queueing engine inside FreeSWITCH rather than build one. That
is the right call and it settles the architecture here too — this project already builds
`mod_callcenter` (`steps/30-freeswitch.sh:78`). The consequences are worked through in
[design/call-centre.md](design/call-centre.md).

## A caution about v1's own status markers

`ROADMAP.md` in v1 marks Billing, FAX and SMS/Messaging as complete (`✅`). They were not — those
areas have schema and, in the billing case, a `billing.go`, but no working feature. `TODO.md`,
written later, is the more honest document and puts the whole project at ~23%. Where the two
disagree, trust `TODO.md`.

The same caution applies to reading `IMPLEMENTATION_STATUS.md`: it describes Phase 2 as "complete"
in considerable detail, and that detail is about code that exists, not about a shipped feature.
