# Path to MVP

Last reviewed **2026-10-25** against `eca43d7`. These are acceptance gates before carrying
customer calls. [Project status](status.md) records current checks, [issues](issues.md) owns
findings and priorities, and [the change log](changelog.md) records changes and deletions.
[The delivery plan](mvp-plan.md) orders the work that closes these gates.

## What the evidence establishes

Older project records report a complete Debian arm64 install, service startup, provisioning,
registration, extension/DID/outbound signalling, ring groups, IVR timeout handling, feature codes,
portal authorization, password reset and signed outbound email. Those are historical results,
not acceptance of the current revision. Historical amd64 FreeSWITCH builds also exist; a full
current-stack amd64 run remains owed.

The 2026-10-25 review reran API validation/security, portal mock/client checks, real Kamailio
digest/risk-prefix tests, installer safety, shell/Lua checks and portal/site builds. See
[status](status.md#verification-on-2026-10-25) for environments, counts and mocked boundaries.
**No call has been confirmed to carry two-way audio in the retained evidence.** A received
INVITE or a listening rtpengine control socket does not establish working media.

## Acceptance gates

Procedures: gates 1 and 6 in [hardware testing](testing-on-real-hardware.md), gates 2, 3, 4, 5
and 7 in [acceptance procedures](acceptance.md). Record each run under
[Acceptance runs](status.md#acceptance-runs).

| Gate | Work and evidence required |
|---|---|
| 1. Remote two-way audio | Register two real endpoints, call between them, listen in both directions and repeat across internet/NAT. Inspect rtpengine sessions and codec negotiation. Follow [hardware testing](testing-on-real-hardware.md). |
| 2. Call features | Record and retrieve voicemail, deliver its email, choose IVR digits including `#`, test DND/forwarding/call waiting and every ring-group strategy. I04–I06 remain source gaps. Receive a fax and verify its delivered attachment. |
| 3. Carrier paths and identity | Verify inbound DID, outbound caller ID/translation, trusted-peer direct-dial denial, and inbound DID → external/extension forwarding. R11 and I03 are fixed and owe a real-carrier check. Enabled registration trunks stay unavailable until registration/challenge handling exists. |
| 4. Emergency behavior | Emergency calls are classified before the ingress capacity check (I02, live against a fake carrier); restrict tenant-defined emergency patterns (I31); wire dispatchable location/callback/notification behavior. Test saturation against a provider-approved test destination. Do not dial live emergency services for routine tests. Current E911 UI records are synthetic. Deployment obligations need separate jurisdiction/provider review. |
| 5. Restore | Restore databases, roles, matching `config.env` encryption key, runtime config and service credentials onto a fresh host. Decrypt an existing SIP secret, register and place a call. Prove failed/offsite-failed backups preserve good history. Backup creation alone does not pass. |
| 6. Current target-host install | Full Debian 13 amd64 install, idempotent rerun, interrupted-step recovery and service rebuild/SSH/TLS checks. Historical arm64 safety tests or amd64 FreeSWITCH-only builds are insufficient. Record component versions, including PostgreSQL 18 target versus PostgreSQL 17 regression fixture. |
| 7. Consistent published state | Close durable projection/revocation (R06), configured capacity (R08), authorized forwarding (R11) and atomic cache publication (R13). Inject dependency failures and restart services to prove convergence. |
| 8. Accurate production surface | Remove production seed fallbacks (I01), disable unsupported controls, triage/patch lockfile advisories (I15), and verify a live missing API cannot display invented emergency locations/messages. |

## Operational work before customer onboarding

- **STIR/SHAKEN:** off by default. An earlier Debian build failed on deprecated OpenSSL APIs;
  the current build was not rerun. Reproduce and repair it if platform signing is required, or
  verify the selected carrier's signing path. A `carrierSigns` field alone is not proof.
- **DNS/certificates/mail:** live Cloudflare publication and Domain Connect provider approval
  remain unaccepted. DNS mode/failure handling and the SMTP modes are fixed and checked in containers
  (I11/I12); live HTTP/DNS renewal dry-runs and production-relay delivery are still owed. Password-reset/email fixture results do not prove your relay works.
- **Monitoring:** send service/backup/certificate failures to a human and verify receipt.
- **Upgrade safety:** review schema changes and rollback/data handling before `db:push --force`.
  Step 41 now keeps a pre-upgrade dump, rehearses the push on a copy and refuses data loss unless
  accepted; the [rollback procedure](rollback.md) is drilled in a container, not yet on a real host.
  Resolve duplicate exact DIDs with their owners before adding uniqueness on an older install.
- **Postflight:** SSH and role checks and the provisioning advice match the installer (I10, fixed
  2026-10-26); a clean postflight on the amd64 host is part of gate 6.

## Outside the core MVP

Queues, billing, resellers, SMS, conferences, contacts, device provisioning, MoH/parking management
and AI features remain future backend work. Their preview screens are not implemented services.
The browser phone has no SIP stack. Voicemail/recording management APIs and user-to-extension
ownership are also absent. See the [roadmap](roadmap.md) and [design notes](design/implementation-plan.md).
