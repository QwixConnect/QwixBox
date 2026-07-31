# Design: call centre

**Status: not built.** This is a design reference salvaged from QwixPBX v1, not a description of
anything in the system today. What exists now is a single `queue` table
(`portal/api/src/db/schema.ts:573`) with a number, a name, a strategy, a MoH sound, a max wait and
a timeout destination — enough to define a queue, nothing that runs one.

## The decision that shapes everything else

**`mod_callcenter` owns the runtime; we own the configuration and the history.**

FreeSWITCH's `mod_callcenter` is already **built** by this stack (`steps/30-freeswitch.sh:78`). It
keeps its own state in three tables — `agents`, `tiers`, `members` — and those are *its* schema,
not ours to design. v1 copied them verbatim into its SQL, which is how we know it had reached the
same conclusion.

**Built is not loaded.** `mod_callcenter` is in `FS_ENABLE_MODULES` but *not* in `FS_AUTOLOAD_ADD`
(`steps/31-freeswitch-config.sh:53`), so it is compiled and sitting in `$PREFIX/mod/` and does not
load at boot. Step zero of this work is adding it to `FS_AUTOLOAD_ADD` **and** deploying a
`callcenter.conf.xml` — per `CLAUDE.md`, a module autoloaded into the minimal config without its
config file logs `Error Loading module` on every start, because the minimal tree ships no config
for it.

That gives a clean split:

| Owned by mod_callcenter | Owned by us |
|---|---|
| `agents` — live agent state, wrap-up timers, running counters | Who an agent *is*, their skills, their schedule |
| `tiers` — agent↔queue membership with position and level | The intent behind a tier (skill-based routing rules) |
| `members` — callers currently queued, scores, serving agent | Historical record of what happened to each call |

Do **not** model `agents`/`tiers`/`members` in `schema.ts`. Project into them instead: our
configuration is authoritative, and `mod_callcenter`'s tables are rebuilt from it — the same
one-way projection pattern already used for Kamailio's `subscriber` table in
`portal/api/src/services/kamailio-sync.ts`. Our schema wins on disagreement and a rebuild fixes it.

`queue_settings` in v1 is a one-to-one map of `mod_callcenter`'s queue parameters
(`tier-rules-apply`, `tier-rule-wait-second`, `tier-rule-wait-multiply-level`,
`tier-rule-no-agent-no-wait`, `discard-abandoned-after`, `abandoned-resume-allowed`,
`max-wait-time`, `max-wait-time-with-no-agent`, `time-base-score`). Those belong on our `queue`
table as the projection source, not in a separate table.

## Tables worth having

Sketches, not schema. All go in `portal/api/src/db/schema.ts`, which is the **only** source of
truth — the installer applies it with `drizzle-kit push --force`, and `--force` will apply a rename
or a narrowed column destructively to an existing install. Every table is tenant-scoped by
`organizationId` like the rest of the schema.

### Agent identity and skills

- `agentSkill` — tenant-scoped named skill (`name`, `description`, `enabled`).
- `agentSkillAssignment` — `(userId, agentSkillId, skillLevel 1–10)`. Feeds the `level` and
  `position` columns of `mod_callcenter`'s `tiers` when projecting.

Skill-based routing in `mod_callcenter` is expressed *only* through tier level and position, so
anything richer has to collapse into those two integers at projection time. Decide that mapping
once and write it down, or two people will invent two different ones.

### Agent state

- `breakType` — `(name, paid, colour, enabled)`. Whether a break is paid is a payroll question, so
  it belongs in configuration rather than being inferred from a state string.
- `agentStateHistory` — `(userId, state, breakTypeId?, reason?, startedAt, endedAt, durationSec)`.

**This is the hard part.** `mod_callcenter` does not keep state history; it keeps current state.
The history has to be assembled from the ESL event stream — `CUSTOM callcenter::info` events carry
agent status/state transitions. There is already an ESL client at
`portal/api/src/services/esl.ts` to build on, but note what this implies: an API restart drops
events, so either the consumer must be resilient about gaps or the reporting must tolerate them.
Decide which before building, because "our adherence numbers are wrong on deploy days" is
discovered late and is very hard to retrofit.

### Call outcomes

- `disposition` — `(code, name, category, requiresCallback, isSuccess, colour)`. Agent-selected
  outcome.
- `cdrCallCentre` — a 1:1 extension of the existing `cdr` table keyed on `cdr.id`, carrying
  `queueId`, `agentId`, `dispositionId`, `queueWaitSec`, `talkSec`, `wrapSec`, `holdSec`,
  `abandoned`, `transferred`, `transferToQueueId`, `recordingUrl`.

  Extend rather than widen `cdr`: every call gets a CDR, only queue calls get this, and the join
  keeps the hot CDR write path narrow.

- `callback` — `(phoneNumber, requestedAt, scheduledAt, assignedAgentId?, queueId?, status)`.
  Queue callback ("keep my place, ring me back") is the single most requested contact-centre
  feature and is cheap once dispositions exist.

### Outbound campaigns

- `campaign` — `(name, type, queueId?, dialPrefix, callerId*, maxChannels, dialRatio,
  abandonRateThreshold, retryAttempts, retryDelaySec, scheduleStart/End, timezone)`.
- `campaignMember` — `(campaignId, phoneNumber, name fields, customData jsonb, status, attempts,
  lastAttemptAt, lastDispositionId, priority, scheduledCallbackAt, assignedAgentId)`.

v1 lists campaign types `manual, preview, progressive, predictive, power`. Predictive dialling is
not a scheduling detail — `abandonRateThreshold` exists because abandoning too many answered calls
is **regulated** (Ofcom in the UK, the FCC's TCPA rules in the US, CRTC in Canada), with real
financial penalties. Do not ship predictive mode without reading the rules for the target market
and implementing the abandon-rate cap as a hard limit, not a report.

### Reporting

- `queueStatistics` — periodic rollup per queue: offered/answered/abandoned/timeout, avg and max
  wait, avg talk, avg wrap, SLA threshold and percent, agent counts, current waiting, longest wait.
- `agentPerformance` — daily per agent: login/available/break/talk/wrap/hold seconds, calls
  handled/inbound/outbound/transferred, average handle time, occupancy and utilisation percent.
- `agentSchedule` and `agentAdherence` — planned shift versus actual, with an adherence percentage.
- `callRecording` — file path/size/duration/format, plus optional transcription, sentiment,
  quality score, review flags and tags.
- `callEvaluation` — QA scoring against a form, with `criteriaScores` as JSON.
- `wallboard` — `(name, layoutConfig jsonb, refreshIntervalSec, queueIds[])`.
- `announcement` — broadcast to agents, with priority and targeting.

## Two things that will bite

**Define "abandoned" once.** SLA percentage, abandon rate and the regulatory cap all depend on it,
and there are at least three defensible definitions (caller hung up at all; hung up after the
short-abandon threshold — v1's `discard_abandoned_after`, default 60s; hung up before an agent
answered but after entering the queue). Pick one, put it in this document, and make every consumer
use the same one. Reports that disagree with each other destroy trust in the whole module faster
than missing features do.

**Recording is a legal artefact, not a file.** `recordingPolicyEnum` already exists in `schema.ts`
(`none`/`inbound`/`outbound`/`all`) but nothing writes recordings yet. Two-party consent
jurisdictions require an announcement before recording; retention is already parameterised in the
installer as `RECORDING_KEEP_DAYS`; and `callRecording.encrypted` exists in v1's schema for a
reason. Treat deletion as a feature, not as cleanup.

## Build order that works

0. Load `mod_callcenter`: add it to `FS_AUTOLOAD_ADD` and deploy `callcenter.conf.xml` alongside
   the other templates in `resources/conf/freeswitch/autoload_configs/`. Verify with
   `fs_cli -x "callcenter_config queue list"` and a clean FreeSWITCH log.
1. Project the existing `queue` into `mod_callcenter` and get calls queueing and delivering to
   agents. Nothing below is worth anything until this works end to end.
2. `agentStateHistory` off the ESL stream — everything in reporting depends on it.
3. Dispositions and `cdrCallCentre`, so a completed call has an outcome.
4. `queueStatistics` and `agentPerformance` rollups; then a wallboard reading them.
5. Callbacks.
6. Campaigns — and only reach predictive after the regulatory work above.

Schedules, adherence and evaluations are workforce-management features. They are worth doing, but
they are worth doing after the queue itself is trustworthy.

## Interfaces to respect

- API routes go through `crudRoutes` (`portal/api/src/lib/crud.ts`), where `permission` is a
  **required** option. Sub-path routes are separate Hono apps and must mount their own
  `requireTenant` + `requirePermission` — they do not inherit the parent's gate.
- Anything consulted during call setup goes through the Redis cache contract in
  `portal/api/src/services/redis.ts`, and any new key shape must be added to
  `keys.tenantPatterns` or it survives a tenant rebuild as a ghost.
- A queue is a destination type, so it resolves through `qwixbox.go` in `resources/lua/qwixbox.lua`
  like every other polymorphic destination — not in a second place.
