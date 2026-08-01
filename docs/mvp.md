# Path to MVP

What is left before this can carry a paying customer's phone calls. Ordered by what blocks what.

Last updated 2026-08-01, after the portal, installer and password-reset work.

## What is proven

Verified by doing it, in a Debian 13 arm64 container, not by reading code:

| | How it was proven |
|---|---|
| Install from bare Debian | 27 steps, exit 0, idempotent re-run, 38 postflight checks |
| All services start | postgres, redis, freeswitch, kamailio, rtpengine, nginx, api, postfix, opendkim |
| FreeSWITCH boots clean | zero `[ERR]`/`[CRIT]` scoped to the run; Opus loaded |
| Tenant provisioning | CLI creates org + tenant, projects domain and subscribers into Kamailio |
| Extension creation | via the API, encrypted SIP secret, HA1 projected to Kamailio's `subscriber` |
| **Extension-to-extension** | INVITE delivered to the registered contact |
| **Inbound DID → extension** | DID resolved, INVITE delivered to the registered contact |
| **Outbound → carrier** | INVITE delivered to the carrier with the translated number |
| Portal auth and isolation | anonymous `/` login page, app routes 404, `/api/*` 401, `viewer` refused writes |
| Outbound mail | Postfix loopback-only, OpenDKIM signature confirmed on the sendmail path |
| **Registration** | A real softphone completes digest auth against the projected HA1 |
| First sign-in | The installer creates the account and tenant; password shown once, absent from every log |
| Password reset | Emailed link validated end to end: reset works, old password refused, token single-use |
| Portal surface | Extensions, trunks, routing, call flows, calls, faxes, users, audit, settings |

## The one thing that makes everything above less than it sounds

**No call has been confirmed to carry audio.** Every call test so far has read SIP *signalling*.
The media path — rtpengine relaying RTP, codec negotiation, who actually hears whom — has not
been verified end to end. `rtpengine_manage()` is wired into the Kamailio config and rtpengine
answers on its control socket, but "the INVITE arrived" and "the two parties can hear each other"
are different claims and only the first has been made.

Everything that depends on audio is therefore unproven: voicemail recording and delivery, IVR
DTMF selection, fax. Close this before anything else on the list.

~~No phone has ever actually registered.~~ **Closed.** A real softphone now completes digest
authentication against the HA1 projection, so that projection is proven to authenticate somebody
rather than merely to exist.

## Blockers

Step-by-step instructions for items 1 and 6 are in
**[testing-on-real-hardware.md](testing-on-real-hardware.md)**.

### 1. Confirm two-way audio

Registration is done. What remains is the media path: register two extensions, call between them,
and confirm both parties hear each other. Then repeat over the internet rather than a LAN — the
NAT and `advertise` handling in the Kamailio config has not been exercised by a remote endpoint.

Nothing else on this list is worth doing before this passes. Voicemail recording, IVR DTMF and
fax all sit behind it, and a failure here invalidates the assumptions the rest rests on.

### ~~2. Verify the call features that already have code~~ — done, and four bugs fixed

Ring groups, IVR, time conditions and the forwarding feature codes are now verified by placing
calls. Getting there required fixing four things that had never worked:

- **The XML tiers were the wrong way round.** The autoload sed reversed the module list, so
  `mod_xml_curl` loaded before `mod_lua` and the API answered every lookup — `extension.lua` never
  ran, meaning DND, forwarding, call waiting and voicemail treatment were all skipped, and the
  Redis cache was bypassed on every call.
- **No language files.** The minimal config ships no `lang/` tree and no `languages` section, and
  neither `mod_say_en` nor `mod_tone_stream` autoloads — so every prompt and every tone failed.
- **`mod_curl` is not the curl command line.** The feature-code and fax notifications were built
  with `-X/-H/-u/-d`, which it ignores, so they went out as unauthenticated GETs and always
  returned `unauthorized`.
- **Extension destinations cached the UUID, not the number**, so an IVR option or ring-group
  failover pointing at an extension resolved to nothing (inbound DIDs worked, because the API
  resolves it in SQL — the two tiers disagreed).
- **`external` destinations skipped outbound routing**, so every call forwarded to an outside
  number was dropped by Kamailio with no trunk selected.

Still open here: **voicemail has been reached and answered but no message has been recorded or
delivered**, and IVR **DTMF selection** is untested — both need real audio, so they fold into
item 1.

### ~~3. A second user per tenant~~ — done

`provision-tenant.ts` queried membership by organization alone, so a second `--owner` was
silently ignored and a tenant was permanently one user. It is now scoped by user, and
`add-tenant-user.ts` adds or re-roles someone on an existing tenant. Verified end to end: a user
added as `viewer` is refused a write (403) where the owner passes to validation (400).

### 4. Emergency calling

`emergencyLocation` exists in `schema.ts` and **nothing else in the codebase references it**.
Kamailio has the bypass path (`X-Emergency` skips fraud checks and route permissions) and
`extension.lua` marks the leg, so a 911 call would be *placed* — but the dispatchable address
that makes it useful is unwired, and there is no Kari's Law notification despite the ESL listener
being mentioned in the code comments.

This is a legal obligation in the US (RAY BAUM'S Act, Kari's Law) and Canada, not a feature.
Either wire it or make it explicit to the first customer that the platform must not be their
only means of reaching emergency services.

### 5. Prove the restore

`51-backups.sh` runs `pg_dump` on a timer and has never been restored from. A backup that has
not been restored is a hypothesis. Restore into a fresh container and confirm a tenant, its
extensions and its registrations come back.

Note the ordering trap the backup script itself warns about: restoring the database without
`/etc/qwixbox/config.env` leaves `ENCRYPTION_KEY` mismatched, and every stored SIP secret and
voicemail PIN becomes undecryptable. The config file is part of the backup set.

### 6. An amd64 pass

Every run this session was arm64. Production is GCP C4 (x86_64), and CLAUDE.md records a real
production failure caused by exactly this gap. The `mod_hiredis` patch, Postfix, OpenDKIM and the
new Kamailio routing have never been built or run on x86_64.

## Before the first paying customer

Not blockers for a working phone system, but they will be asked for immediately.

- ~~**Portal coverage.**~~ Done. Faxes, users and audit now have pages, alongside extensions,
  trunks, routing, call flows, calls and settings. Still no voicemail page — there is no voicemail
  API either, and no message has been recorded to put in one.
- ~~**Self-service password reset.**~~ Done. better-auth's flow is wired to the local MTA and
  verified end to end. Account creation is also no longer a CLI-only path: the installer creates
  the first account and tenant, and the Users page adds the rest.
- **A voicemail API and page.** The one portal gap left, and it is blocked on item 1 rather than
  on effort — there is nothing to list until a message can be recorded.
- **STIR/SHAKEN.** Required for US and Canadian PSTN origination. `33-stir-shaken.sh` currently
  fails to build `libstirshaken` on Debian 13 (deprecated OpenSSL API under `-Werror`). It is off
  by default so it does not block an install, but "we can turn it on" is not true right now.
  Note `trunk.carrierSigns` exists for the case where the carrier signs on your behalf, which is
  the realistic path for a small operator and avoids the STI-CA procurement entirely.
- **DNS automation against a real provider.** Domain Connect discovery is verified against live
  records (IONOS answers; a domain without the record falls through in about a second), but no
  template has been onboarded with a DNS provider yet, so the approval flow has never completed.
  Onboarding is a per-provider agreement, not code. The Cloudflare token path is unit-tested
  against stubs and has never spoken to the real API.
- **Monitoring that reaches a human.** `52-monitoring.sh` installs `prometheus-node-exporter` and
  a healthcheck timer; nothing consumes the metrics and nothing pages anyone.

## Explicitly not MVP

Documented under `docs/design/` so they are cheap to start later, and deliberately not started:
call centre, billing, resellers, SMS, conferences, device provisioning, contacts,
music-on-hold management, parking lots, AI receptionist.

## A note on how to verify things here

Four separate bugs this session had the same shape: code that read as correct and did nothing —
`dr_gateways` with nothing populating it, `mod_hiredis` corrupting every cached `%`, the
directory dial-string duplicated in two files with only one fixed, and `kamcmd` failing silently
because it exits 0 when it cannot connect.

Static review found none of them. Each was found by running the thing and watching what came out
the other end. Anything on this list should be closed the same way: make the call, capture the
packet, restore the backup.
