# Path to MVP

What is left before this can carry a paying customer's phone calls. Ordered by what blocks what.

Last updated after the call-path work of 2026-07-31.

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

## The two things that make everything above less than it sounds

**1. No call has ever carried audio.** Every test captured SIP *signalling* with `netcat`. The
media path — rtpengine relaying RTP, codec negotiation, who hears whom — has never run.
`rtpengine_manage()` is wired into the Kamailio config and rtpengine answers on its control
socket, but "the INVITE arrived" and "the two parties can hear each other" are different claims
and only the first has been made.

**2. No phone has ever actually registered.** Registrations were injected with
`kamctl ul add`. A real `REGISTER` with digest authentication was never completed end to end —
Kamailio was observed challenging correctly with `401 WWW-Authenticate`, and the test client
never finished the handshake. So the HA1 projection is proven to *exist* in the `subscriber`
table but not proven to *authenticate anyone*.

Both are cheap to close and everything else is guesswork until they are. Do them first.

## Blockers

### 1. Register a real softphone and make a real call

Point a softphone (Zoiper, Linphone, a desk phone) at the server, register extension 1001,
register 1002, and call between them. Confirm two-way audio.

This single test closes both unknowns above and exercises the whole stack the way a customer
will: digest auth against the HA1 projection, NAT handling, rtpengine media relay, codec
negotiation. Nothing else on this list is worth doing before it passes, because a failure here
invalidates the assumptions the rest rests on.

Then repeat over the internet rather than loopback — the NAT and `advertise` handling in the
Kamailio config has never seen a real remote endpoint.

### 2. Verify the call features that already have code

`ring_group.lua`, `ivr.lua`, `time_condition.lua` and `fax_receive.lua` are written, deployed,
and have never been executed. So are the feature codes (`*97`, `*72`, DND). They may work; that
is not the same as working. Each needs one call through it.

Voicemail specifically: **the fallback when the callee is unregistered is unverified.** Kamailio
returns `480 Temporarily Unavailable` as designed, but the loopback harness used for the call
tests tears the caller down before `extension.lua`'s treatment runs. Needs a real inbound leg.

### 3. A second user per tenant

`provision-tenant.ts` queries membership by organization only:

```ts
const membership = await db.query.member.findFirst({ where: eq(member.organizationId, orgId) });
if (!membership) { /* insert */ }
```

So once any member exists, a second `--owner` is **silently ignored** — no error, no message, and
the operator reasonably concludes it worked. Today a tenant is permanently one user, and that
user is an owner; the `admin`/`member`/`viewer` roles in `auth.ts` cannot be assigned to anyone.

Fix the query to scope by user as well, and add a way to invite or add a user with a chosen role.
Small change, and nothing multi-user works without it.

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

- **Portal coverage.** There are pages for extensions, trunks, routing, call flows and calls.
  There is no page for voicemail, faxes, or users — despite the APIs existing for the first two.
- **Restore-from-portal / self-service password reset.** Every account operation is a CLI run on
  the server today.
- **STIR/SHAKEN.** Required for US and Canadian PSTN origination. `33-stir-shaken.sh` currently
  fails to build `libstirshaken` on Debian 13 (deprecated OpenSSL API under `-Werror`). It is off
  by default so it does not block an install, but "we can turn it on" is not true right now.
  Note `trunk.carrierSigns` exists for the case where the carrier signs on your behalf, which is
  the realistic path for a small operator and avoids the STI-CA procurement entirely.
- **Cloudflare DNS.** The integration is unit-tested against stubs (9/9) and has never spoken to
  the real API. One manual run against a real zone.
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
