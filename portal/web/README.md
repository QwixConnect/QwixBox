# Running the portal locally

From `portal/web`:

```bash
bun install --frozen-lockfile
bun run dev:mock
```

Open **http://127.0.0.1:5174/**. The mock portal starts signed in as an owner and needs no
database, Redis, FreeSWITCH, environment file or production credentials. Port 5174 is reserved
by this command so it does not silently move to a different port when occupied.

Sample data covers extensions, trunks, routes, ring groups, IVRs, business hours, call history,
faxes, members and audit entries. Forms and toggles update the in-memory fixture; call filters,
pagination and CSV export work. The sample fax download is a text fixture, not a real fax/PDF.
Calls, email, account provisioning and carrier registration are never performed.

The **Mock data** bar lets you choose owner/admin/member/viewer and normal, empty, error or slow
responses. Changing a scenario reloads the dashboard; leaving the empty scenario restores seeded
data. **Reset demo** restores the fixtures and owner role. Sign out works; on the mock login
screen any nonempty email/password signs back into the selected demo role. Use invented values.

Data and scenario selection are shared by tabs connected to this dev-server instance, and are
discarded when it restarts (including Vite config changes). Sign-out uses a local mock cookie.

Mock routes live under `mock/` and attach only to the Vite development server in `--mode mock`.
All `/api` requests are handled there; unknown endpoints fail rather than reaching a real API.
The mock forces a same-origin API base even if a local environment file specifies another URL.
Mock builds/previews are refused and mock controls/data are excluded from production bundles.
This mode demonstrates UI behavior; it does not validate real authentication, permissions or PBX
behavior. The fixture's simplified role checks are not the production authorization boundary.

For the real local API, use `bun run dev`; Vite proxies to `http://127.0.0.1:3000` by default.
Set `VITE_API_PROXY` to change that target. This real-API mode needs the backend and its services.

Checks:

```bash
bun run typecheck
bun run lint
bun run build
# From the repository root:
bun test tests/portal-mock.test.ts
```

## Design System & Visual Tokens

The portal implements the QwixBox / iQFone enterprise design tokens (`docs/design/design-tokens.png`):

- **Typography**: `Manrope` (`400`, `500`, `600`, `700`, `800`) + `JetBrains Mono` for extensions, DIDs, SIP URIs, and call timers.
  - Display: `38px / 600` (`-0.025em`)
  - Large Title: `34px / 800` (`-0.03em`)
  - Keypad: `34px / 500`
  - Headline: `17px / 600`
  - Body: `15px / 500`
  - Caption: `13px / 500`
- **Color Palette**:
  - **Light Mode**: Background `#FFFFFF`, Surface `#F5F5F7`, Separator `#E5E5EA`, Primary `#111113`, Secondary `#6E6E73`, Accent `#2563EB`, Danger `#D70015`.
  - **Dark Mode**: Background `#000000`, Surface `#111113`, Raised/Separator `#1C1C1E`, Primary `#F2F2F7`, Secondary `#98989F`, Accent Text `#6AA2FF` (`#2563EB` solid actions), Danger `#FF6961`.
- **Shape & Ergonomics**:
  - `12px` radius for inputs and buttons, `20px` radius for borderless surface cards (`#F5F5F7` / `#111113`), `9999px` pill actions and avatars.
  - `44px+` minimum interactive touch targets, `1px` hairline row dividers, and responsive mobile bottom tab bar (`Recents`, `Contacts`, `Keypad`, `Messages`, `Settings`).

## Live vs. Mock-Backed Portal Screens

| Screen | Route | Live Backend (`apps/api`) | Mock Fallback / Seeded Store |
| :--- | :--- | :--- | :--- |
| **Dashboard** | `/` | `/api/health`, `/api/extensions`, `/api/trunks`, `/api/cdr` | `/api/voicemails`, `/api/sms-threads`, `/api/queues` |
| **Recents & Calls** | `/calls` | `/api/cdr` | Full 86-row CDR fixture in `--mode mock` |
| **Messages, Voicemail & Recordings** | `/messages` | *Pending — see `docs/roadmap.md`* | `/api/sms-threads`, `/api/voicemails`, `/api/recordings`, `/api/sms-opt-outs` |
| **Contacts Directory** | `/contacts` | *Pending — see `docs/roadmap.md`* | `/api/contacts` |
| **Extensions** | `/extensions` | `/api/extensions` (CRUD, call handling, rotate SIP/PIN) | Seeded extensions in `--mode mock` |
| **Call Flows** | `/call-flows` | `/api/ring-groups`, `/api/ivr-menus`, `/api/time-conditions` | Seeded call flows in `--mode mock` |
| **Call Queues & Wallboard** | `/queues` | *Pending — see `docs/roadmap.md`* | `/api/queues`, `/api/queue-agents` |
| **Routing** | `/routing` | `/api/inbound-routes`, `/api/outbound-routes` | Seeded routes in `--mode mock` |
| **SIP Trunks** | `/trunks` | `/api/trunks` | Seeded trunks in `--mode mock` |
| **Conferences, Park & MOH** | `/conferences` | *Pending — see `docs/roadmap.md`* | `/api/conferences`, `/api/parking-lots`, `/api/music-on-hold` |
| **T.38 Faxes** | `/faxes` | `/api/faxes` | Seeded faxes in `--mode mock` |
| **Emergency (E911)** | `/emergency` | *Pending — see `docs/roadmap.md`* | `/api/emergency-locations` |
| **Devices & Provisioning** | `/devices` | *Pending — see `docs/roadmap.md`* | `/api/devices` |
| **Portal Users** | `/users` | `/api/users` | Seeded users in `--mode mock` |
| **Audit Log** | `/audit` | `/api/audit` | Seeded audit events in `--mode mock` |
| **Settings** | `/settings` | `/api/settings` | Seeded settings in `--mode mock` |

