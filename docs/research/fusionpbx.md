# FusionPBX reference implementation research

Reviewed 2026-10-24 for the [QwixBox reference comparison](reference-platforms.md). This is a source and documentation review, not a deployed-system acceptance test. “Implemented” below means the public code contains the implementation; it does not establish reliability, capacity, or security of a particular deployment.

## Snapshot and product boundary

The inspected public repository is pinned to [`91dc8a67f849facd5f34124a9022f8e86ae925bf`](https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf), dated 2026-10-23. The [official site](https://www.fusionpbx.com/) announces release 5.6; the inspected default-branch commit is not asserted to equal that release tag. The temporary read-only source checkout was `/tmp/qwixbox-reference-research/fusionpbx`; no upstream installer or application code was executed.

FusionPBX is a PHP administration application around FreeSWITCH, with a standard installer stack of nginx, PHP-FPM, PostgreSQL, firewall tooling and fail2ban. Domains provide the tenant model. It is not a SIP-edge/API architecture identical to QwixBox. See the pinned [README][readme] and [Lua binding configuration][lua-conf].

Keep three distribution categories separate:

| Category | Evidence and scope |
|---|---|
| Public main repository | Core PBX, devices/provisioning, basic contact center, operator panel, CDR, conferences, contacts, fax, voicemail and administration are present in the pinned source linked below. |
| Separately installed public applications | Browser phone, transcription, language-model integration, SMS messages/providers and other optional apps are linked by the [official site](https://www.fusionpbx.com/). Their presence in the ecosystem does not mean they ship in the main checkout or are enabled by default. |
| Membership applications/services | The pinned [README][readme] associates REST API access with Gold membership and advanced call-center summary/wallboard applications with Purple/Gold membership. Its wording includes historical “coming soon” text alongside benefit lists; this review did not inspect private code or establish current contract terms. Do not mark those implementations as publicly verified. |

Examined application files carry Mozilla Public License 1.1 headers, for example [extensions.php][extensions]. This identifies the inspected file's license, not a guarantee that every bundled dependency or optional app has the same terms. The recommendations below concern behavior and architecture; source reuse needs a per-file license review.

## How the application works

1. An administrator selects a domain and edits resources through PHP pages. Application definitions describe schema, permissions and menu integration. The extensions list checks `extension_view`, scopes ordinary queries by `domain_uuid`, and permits an explicit cross-domain view only through an additional permission. This is evidence of deliberate tenant and action checks, not proof that every endpoint is isolated. [Extensions][extensions], [call-center application definition][cc-schema].
2. FreeSWITCH loads a Lua XML handler for `configuration`, `dialplan`, `directory` and `languages`. Configuration generators read stored records and emit FreeSWITCH XML. Consequently, an IVR, conference or queue is both management data and a generated switch resource. [Bindings][lua-conf], [XML handler][xml-handler].
3. Call-time Lua handles workflows including ring groups, voicemail, parking and conference-center interactions. PHP classes issue event-socket commands for live changes and invalidate relevant configuration caches. For example, queue deletion unloads `extension@domain`, and agent/tier changes use `callcenter_config`. [Call-center class][cc-class], [call-time scripts][scripts].
4. Background services handle work that should outlive an HTTP request: CDR file import, outbound fax processing, email queues and websocket event distribution. These are useful examples for QwixBox's event and job architecture. [CDR service][cdr-service], [fax queue service][fax-service], [email queue][email], [websocket services][websockets].

## Feature inventory and implementation evidence

| Area | User-visible functionality | Public implementation and boundary |
|---|---|---|
| Tenancy and settings | Separate domains; global/domain/user settings and group permissions | `core/domains`, `core/domain_settings`, `core/user_settings` and permission checks around domain-scoped records. QwixBox should preserve its existing explicit tenant guard when adopting similar features. [Core][core], [extensions][extensions]. |
| Extensions and trunks | Manage extension identities, gateways and registration information | Extension/gateway records feed directory and Sofia XML generation. SIP profile management is part of the app. [Directory and Sofia generators][xml-handler], [gateways][gateways]. |
| Inbound/outbound routing | Destinations, route matching, number translations, PIN controls and editable dialplans | Management apps persist dialplan conditions/actions; Lua emits switch dialplans. Fine-grained programmability is powerful but exposes a larger configuration surface than QwixBox's typed destinations. [Dialplan apps][dialplans], [generator][dialplan-generator]. |
| Ring groups and personal handling | Ring groups, forwarding, DND, follow-me and fallback destinations | Separate configuration apps plus Lua group routing; group scripts handle member ringing, confirmation, forwarding and wait announcements. [Ring-group scripts][ring-scripts], [follow-me][followme], [forwarding][forward]. |
| IVR and schedules | Menus, prompts, choices, time-based destination routing | IVR records map to `ivr.conf` XML; time conditions generate dialplans. [IVR generator][ivr-generator], [time conditions][time]. |
| Voicemail | Mailboxes, messages, greetings, PIN menus, forwarding, email and message-waiting indication | A substantial Lua application handles recording/menu flow, message state, email, MWI and BLF; PHP management screens expose stored messages and settings. [Voicemail scripts][voicemail], [management][voicemail-ui]. |
| Music and recordings | Prompt library, music-on-hold categories/streams, call recording access | Managed resources feed local-stream XML and recording functions. This is a stronger model than allowing arbitrary file paths in routing forms. [Music app][moh], [local-stream generator][stream-generator], [call recordings][recordings]. |
| Parking, pickup, paging and feature codes | Shared parking, intercept/pickup and paging groups | `park.lua`, `park_monitor.lua`, `intercept.lua`, valet-park scripts and paging-group configuration are present; detailed endpoint/BLF compatibility still requires tests. [Scripts][scripts], [paging groups][paging]. |
| Conferences | Rooms, profiles, controls, conference centers and active participant operations | Conference XML generator plus Lua conference-center controls for mute/unmute, raise hand and recording. [Conference generator][conference-generator], [conference-center scripts][conference-scripts]. |
| Basic contact center | Queues, agents, tiers, ring strategies, wrap-up/delay settings, login/logout and timeout destinations | Queue XML uses tenant-qualified `queue_extension@domain_name`; agent identifiers use UUIDs. Management changes drive `callcenter_config`, while `mod_callcenter` owns dispatch. Official docs describe queue strategies and agent workflow. [Generator][cc-generator], [class][cc-class], [official queue guide](https://docs.fusionpbx.com/en/latest/applications/call_center.html). |
| Operator/live status | Operator panel, active calls/conferences, registrations and SIP status | Websocket services distribute events. Operator-panel call/conference filters explicitly constrain events to authorized domains; field-level permission filtering also exists. This is a particularly relevant model for preventing cross-tenant leaks in QwixBox live updates. [Operator filters][operator], [websocket framework][websockets]. |
| CDR/reporting | Call history, details, recording associations, statistics/summary screens | XML CDR importer watches files with inotify where available and separates failure classes such as invalid XML and SQL errors. Main-repo CDR statistics should not be conflated with private advanced contact-center analytics. [CDR app][cdr], [import service][cdr-service], [membership boundary][readme]. |
| Fax | Fax inbox/sending, fax servers and queued outbound work | Fax app and queue service persist work, apply a retry interval and invoke a sending job. This extends beyond QwixBox's currently documented inbound fax path. [Fax app][fax], [queue service][fax-service]. |
| Contacts | Shared contact records and phone-directory integration | `core/contacts` manages contacts; provisioning includes phonebook request handling. Caller-ID lookup also has a Lua script. [Contacts][contacts], [provision class][provision], [scripts][scripts]. |
| Device provisioning | Device inventory, profiles, extension/line associations and vendor configuration templates | Provisioning resolves MAC/file/extension request shapes and renders vendor-specific templates. Many vendor apps/templates exist. Treat MAC as an identifier, not an authentication secret, when designing QwixBox enrollment. [Device model][devices], [provision renderer][provision], [templates][templates]. |
| Authentication | Database authentication plus LDAP, TOTP, email and passkey plugin implementations | These plugins exist in the current public tree. This review does not assert they are all enabled, enforced or independently audited. [Authentication plugins][auth]. |
| Protection and operations | ACLs, event-driven blocking, logs, service management and upgrade tools | Event Guard includes nftables, iptables and PF adapters. The upstream installer and operational documentation are separate from application code; neither an automatic HA system nor tested disaster recovery is established by their existence. [Event Guard][guard], [core services/upgrade][core], [official operations docs](https://docs.fusionpbx.com/en/latest/). |
| Emergency-call visibility | Emergency call log screen and recent-call dialplan integration | Source contains an emergency log app and corresponding dialplan. This is not evidence of address validation, provider provisioning or jurisdictional compliance. [Emergency app][emergency], [dialplan templates][dialplan-templates]. |
| Browser calling | Separately installed audio/video WebRTC phone with calling controls, contacts and local recent calls | Official documentation describes SIP.js connecting over WSS directly to FreeSWITCH, automatic extension registration and HTTPS/media prerequisites. QwixBox must adapt the workflow to Kamailio WSS + rtpengine instead of copying that network topology. Optional application source was not cloned in this review. [Official phone documentation](https://docs.fusionpbx.com/en/latest/applications/phone.html). |
| Messaging | Optional SMS/MMS providers and messages applications | Official documentation explains installing the messages app, setting up providers and assigning destination numbers. Provider integrations and delivery guarantees were not source-audited here. [Official messages documentation](https://docs.fusionpbx.com/en/latest/applications/messages.html). |
| Transcription/AI | Optional transcription of voicemail, prompts and call recordings; optional language-model application | Official docs describe provider selection, ffmpeg conversion and a transcription queue with concurrency/interval settings and stale-processing recovery. External providers/self-hosted engines remain deployment dependencies. No claim is made that a conversational AI receptionist exists in core. [Official transcription guide](https://docs.fusionpbx.com/en/latest/applications/transcribe.html), [optional apps](https://www.fusionpbx.com/). |

## Practices QwixBox can adopt

These are recommendations inferred from the inspected mechanisms, not claims that FusionPBX is categorically better.

1. **Separate saved configuration from live switch state.** Model queue/agent/tier configuration in PostgreSQL; project it into `mod_callcenter` using tenant-qualified identifiers, track failures and reconcile after restart. Do not equate a successful form save with an applied switch change. The existing [QwixBox call-center design](../design/call-centre.md) already chooses the same ownership boundary. [FusionPBX queue implementation][cc-class].
2. **Build a constrained event service before a wallboard.** Normalize switch events, determine tenant ownership server-side and apply action/field permissions before sending browser updates. An unknown tenant should drop the event. The operator panel's domain filters provide a concrete example of handling conference identifiers that do not carry the same fields as ordinary call events. [Operator filters][operator].
3. **Make operational failure visible.** Add durable job states, retry scheduling, dead-letter inspection and replay for CDR, fax, email and later transcription. Use idempotency keys so a replay does not duplicate call records or notifications. FusionPBX's importer failure directories and worker-backed fax queue show the operator workflow to support; idempotency requirements are QwixBox design recommendations, not verified properties of those implementations. [CDR importer][cdr-service], [fax worker][fax-service].
4. **Treat devices as resources separate from extensions.** Store device identity, assigned lines, profile/template version and provisioning status; support narrow device credentials and rotation. Start with one vendor/model plus a generic SIP client, then expand through tested templates. [Device implementation][devices], [renderer][provision].
5. **Build reusable media and destination selectors.** A tenant-owned prompt/MoH library and typed destination picker should serve IVRs, schedules, queues, voicemail and conferences. Add reference checks before deleting an asset or destination. FusionPBX's generated configuration illustrates reuse; deletion/reference constraints are recommendations to validate in QwixBox. [IVR][ivr-generator], [music][stream-generator], [conference][conference-generator].
6. **Provide user workflows beyond CRUD.** Receptionists need live state, transfer/park/pickup; agents need login, pause, wrap-up and missed-offer recovery; ordinary users need voicemail, forwarding and phone registration status. Deliver those role-specific workflows with scoped APIs rather than giving everyone switch administration. [Queue workflow](https://docs.fusionpbx.com/en/latest/applications/call_center.html), [operator panel][operator], [phone workflow](https://docs.fusionpbx.com/en/latest/applications/phone.html).

## Limits and follow-up validation

The core source supports substantially broader PBX administration than QwixBox's current documented backend. Prioritize QwixBox's [MVP media/restore gates](../mvp.md) before treating feature breadth as release readiness. This study did not place calls, test failover, measure latency, audit every tenant query, inspect member-only implementations, verify device firmware combinations or validate emergency-service behavior. HA, billing/reseller economics and omnichannel should not be marked “verified FusionPBX parity requirements” from general marketing alone.

For a practical acceptance comparison, configure the same two tenants and call scenarios in isolated deployments: duplicate extension numbers across tenants, registration and two-way audio, inbound/outbound routing, IVR timeout/DTMF, voicemail/MWI/email, queue overflow/no-agent handling, conference privacy, event-stream isolation, provisioning credential rotation and restore onto a fresh server. Record actual behavior separately from this source inventory.

[readme]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/readme.md
[lua-conf]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/switch/resources/conf/autoload_configs/lua.conf.xml
[extensions]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/extensions/extensions.php
[cc-schema]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/call_centers/app_config.php
[xml-handler]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/switch/resources/scripts/app/xml_handler
[cc-class]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/call_centers/resources/classes/call_center.php
[scripts]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/switch/resources/scripts
[cdr-service]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/xml_cdr/resources/classes/xml_cdr_service.php
[fax-service]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/fax_queue/resources/classes/fax_queue_service.php
[email]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/email_queue
[websockets]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/core/websockets/resources/classes
[core]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/core
[gateways]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/gateways
[dialplans]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/dialplans
[dialplan-generator]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/switch/resources/scripts/app/xml_handler/resources/scripts/dialplan/dialplan.lua
[ring-scripts]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/switch/resources/scripts/app/ring_groups
[followme]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/follow_me
[forward]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/call_forward
[ivr-generator]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/switch/resources/scripts/app/xml_handler/resources/scripts/configuration/ivr.conf.lua
[time]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/time_conditions
[voicemail]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/switch/resources/scripts/app/voicemail
[voicemail-ui]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/voicemails
[moh]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/music_on_hold
[stream-generator]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/switch/resources/scripts/app/xml_handler/resources/scripts/configuration/local_stream.conf.lua
[recordings]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/call_recordings
[paging]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/paging_groups
[conference-generator]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/switch/resources/scripts/app/xml_handler/resources/scripts/configuration/conference.conf.lua
[conference-scripts]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/switch/resources/scripts/app/conference_center
[cc-generator]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/switch/resources/scripts/app/xml_handler/resources/scripts/configuration/callcenter.conf.lua
[operator]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/operator_panel/resources/classes
[cdr]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/xml_cdr
[fax]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/fax
[contacts]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/core/contacts
[provision]: https://github.com/fusionpbx/fusionpbx/blob/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/provision/resources/classes/provision.php
[devices]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/devices
[templates]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/resources/templates/provision
[auth]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/core/authentication/resources/classes/plugins
[guard]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/event_guard/resources/classes
[emergency]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/emergency
[dialplan-templates]: https://github.com/fusionpbx/fusionpbx/tree/91dc8a67f849facd5f34124a9022f8e86ae925bf/app/dialplans/resources/switch/conf/dialplan
