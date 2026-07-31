# Design: smaller features from v1

**Status: none of these are built.** Six self-contained features salvaged from QwixPBX v1. Each is
small enough to do in isolation; they are collected here rather than given a document each.

All are tenant-scoped by `organizationId`, all belong in `portal/api/src/db/schema.ts` (the only
source of truth — the installer applies it with `drizzle-kit push --force`), and all API routes go
through `crudRoutes` with a required `permission`.

---

## SMS / messaging

- `smsMessage` — `(direction, fromNumber, toNumber, body, mediaUrls text[], status, provider,
  providerId, errorCode, cost numeric)`.
- `smsTemplate` — `(name, body, category)`.
- `smsCampaign` — `(name, templateId?, messageBody, scheduleAt, status, totalRecipients, sentCount,
  failedCount)`.
- `smsOptOut` — `(phoneNumber, reason, createdAt)`.

**`smsOptOut` is a legal requirement, not a feature.** Honouring STOP is mandatory under the TCPA
in the US and CASL in Canada, with per-message statutory damages. It must be enforced at send time
for every outbound path — single message, template and campaign alike — which means the check
belongs in one send function that all three call, not in three route handlers.

Carrier delivery is a provider integration (v1 lists Twilio, Plivo, Bandwidth), so `providerId` and
`errorCode` exist to reconcile asynchronous delivery receipts. `cost` is `numeric` and feeds
`usageRecord` in [billing](billing.md).

Note this is carrier-API SMS, not SIP MESSAGE. Kamailio would be involved only if in-dialog
messaging between endpoints were wanted, which is a different feature.

## Conferences

- `conference` — `(name, description, enabled)` plus a dialable number.
- `conferenceParticipant` — `(conferenceId, userId?, joinTime, leaveTime)`.

v1's schema is thin — no PIN, no moderator, no recording — so treat it as a starting point rather
than a specification. FreeSWITCH's `mod_conference` provides the machinery; as with
`mod_callcenter`, our schema should hold configuration that projects into its profiles rather than
reimplementing anything.

`mod_conference` is built (it is on by default in stock `modules.conf`) but is **not** in
`FS_AUTOLOAD_ADD` (`steps/31-freeswitch-config.sh:53`), so it does not load at boot. Adding it also
means deploying a `conference.conf.xml` — the minimal config tree ships none, and an autoloaded
module without its config logs `Error Loading module` on every start.

A conference is a destination, so it resolves through `qwixbox.go` in `resources/lua/qwixbox.lua`
with every other polymorphic destination.

## Device provisioning

- `userDevice` — `(userId, deviceLabel, deviceType, sipUsername, sipPassword, authRealm,
  callerIdName, callerIdNumber, outboundProxy, enabled)`.

This is the multi-device story: one extension, several registrations (desk phone, softphone,
WebRTC). The current `extension` table assumes one set of credentials per extension, so this is a
real schema change rather than an addition — worth thinking through before starting.

**`sipPassword` must not be stored in plaintext.** The existing pattern is the `*Enc` columns
described in `CLAUDE.md`: AES-256-GCM via `portal/api/src/lib/crypto.ts`, stored as
`iv:tag:ciphertext`, with `portal/api/src/services/kamailio-sync.ts` decrypting to compute HA1/HA1b
and writing only the digest into Kamailio's `subscriber` table. Any new credential follows that
path.

Zero-touch provisioning (serving a config file to a phone by MAC address) is a separate and much
larger feature. `userDevice` is the prerequisite, not the whole thing.

## Contacts

- `contact` — `(name, company, phone, email, notes)`.

A tenant directory. Useful on its own for click-to-dial and caller-ID name lookup — and this stack
already builds `mod_cidlookup`, so there is an obvious consumer. Reverse lookup is on the call path,
so it must come from Redis with a key shape registered in `keys.tenantPatterns`
(`portal/api/src/services/redis.ts`), never a Postgres query during call setup.

## Music on hold

- `musicOnHold` — `(name, path, rate, shuffle, channels, interval, timerName)`.

The `rate` column matters: `FS_SOUND_RATES` in the installer defaults to `8000 48000`, and MoH at
the wrong rate is resampled and sounds worse than it should. `mod_shout` is built, so streaming
MoH from a URL is possible as well as local files.

`queue.mohSound` already exists in the schema as free text; this table is what it should reference.

## Parking lots

- `parkingLot` — `(name, lotExtension, slotStart, slotEnd, timeoutSeconds,
  timeoutDestinationType, timeoutDestinationData, musicOnHoldClass, enabled)`.

Call park with a slot range. `timeoutDestinationType`/`Data` is the same polymorphic destination
pattern used by inbound routes, ring-group failover and time conditions — so it resolves through
`qwixbox.go` too, and a parked call that times out is just another destination lookup.

FreeSWITCH provides `mod_valet_parking`; check whether it is in `FS_ENABLE_MODULES`
(`steps/30-freeswitch.sh`) before designing around it — it is not currently enabled.
