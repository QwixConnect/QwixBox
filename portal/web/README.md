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
