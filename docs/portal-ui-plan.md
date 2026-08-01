# Portal UI — consume the full API surface

Planned 2026-08-01. In progress. This is work-to-be-done, not a description of the system —
`docs/mvp.md` is the current state of play.

### Progress

| Phase | Status | Notes |
|---|---|---|
| 0 — Dependencies and providers | **done** | `@mantine/form` + `@mantine/notifications` installed; `<Notifications />` in `main.tsx`; `lib/notify.ts` |
| 1 — Role awareness | **done** | `use-role.ts` mirrors auth.ts; role fetched once in `_app`; `RoleGate` on existing pages; nav hides faxes/audit/calls by permission |
| 2 — Three API routes | **done** | `PATCH /api/tenant`, `POST /api/tenant/members`, `GET /api/audit` (Enc-stripped), `GET /api/cdr/export` (CSV, `cdr:export`); fax list adds `onDisk` |
| 3 — New pages (faxes, users, audit) | **done** | `/faxes`, `/users`, `/audit` routes; CDR Export on `/calls`; types/endpoints in `api.ts` |
| 4 — Settings editable | **done** | Edit modal (dirty PATCH), rebuild cache, provision form with 202 handling |
| 5 — Retrofit existing pages | **done** | extensions, trunks, routing, call-flows, CallHandlingModal → useForm + dirty PATCH + notifySaved/Removed |

**Implementation complete (2026-08-01).** Remaining work is verification on the Debian 13 arm64 container — see Verification below. Static checks (`bun run typecheck` / lint / build on web; `bunx tsc` on api) pass.


## Context

The portal has seven pages covering extensions, trunks, routing, call flows, calls and a
read-only settings view. Sitting behind them is API surface that no UI reaches, and three
permissions declared in `portal/api/src/auth.ts` that no route consumes.

That second part matters more than it looks. `cdr.ts:16-18` says outright that `cdr:export` is
"reserved for a bulk download endpoint that does not exist yet"; `tenant:update` and `audit:read`
have no such note and simply sit there. This is the exact failure mode CLAUDE.md opens with —
a permission model that reads as enforced because it is well described. Closing the three gaps
turns declarations into working routes.

The goal: every API the portal owns is reachable from the UI, every write control is gated by
the role that will actually be enforced server-side, and no page shows a button that returns 403.

Scope decisions:
- UI, plus the three small API routes backing the dead permissions. Voicemail is out of scope
  (no schema, no route, and `docs/mvp.md` records that no message has ever been recorded).
- `@mantine/form` and `@mantine/notifications` are added.

---

## Phase 0 — Dependencies and providers

`portal/web/package.json`: add `@mantine/form` and `@mantine/notifications` (match the `^9.5.0`
line the other Mantine packages are on).

`portal/web/src/main.tsx`: import `@mantine/notifications/styles.css` after the existing
`@mantine/core/styles.css`, and mount `<Notifications />` inside `MantineProvider`.

There is a `mantine-form` skill at `portal/web/.claude/skills/`, scoped to `portal/web/` — worth
loading before the first `useForm`. `mantine-combobox` is there too if the destination pickers
grow.

`portal/web/src/lib/notify.ts` (new, small): `notifySaved(what)` / `notifyRemoved(what)` wrappers
so every page words success the same way. Failures keep going through `ErrorAlert` — it surfaces
the API's own message and `detail`, which is deliberate (`components/Resource.tsx:1-8`) and must
not be downgraded to a toast.

---

## Phase 1 — Role awareness (do this before any new page)

Nothing client-side knows the caller's role today, so a `viewer` sees every create and delete
control and learns the truth from a 403. The server resolves role from the `member` row on every
request (`middleware/tenant.ts:68-82`); the client must read the same source, not the session.

`portal/web/src/lib/use-role.ts` (new):

- `authClient.organization.getActiveMemberRole()` — present in better-auth 1.6.x, returns
  `{ role }` for the active organization.
- Wrap in `useQuery` keyed `["active-member-role", session?.user.id]` with `staleTime: Infinity`.
  **Fetch it once in `_app.tsx` alongside `ensureActiveOrganization`**, not per page — see the
  rate-limit risk below.
- Export `can(resource, action)` built from a table mirroring `ROLES` in `auth.ts`. Mirror rather
  than import: the API is a separate package and the client cannot reach
  `better-auth/plugins/access` server roles. Add a comment naming `portal/api/src/auth.ts:48-78`
  as the origin so the two are edited together.

Then thread it through:
- `_app.tsx` — hide nav entries the role cannot read (`/calls` for a role without `cdr:read`,
  `/audit` without `audit:read`).
- Every page — `PageHeader action` create buttons render only with `create`; row `Edit`/`Delete`
  render disabled with a Tooltip explaining the role, rather than vanishing. Disabled-with-reason
  beats hidden for edit controls: an operator who cannot find the button assumes a broken page.

`components/Resource.tsx` gains a `RoleGate` helper so this is one prop, not a conditional per
call site.

**This gate is convenience, not security.** The server check stays the boundary. Say so in the
file header, or the next reader will assume it enforces something.

---

## Phase 2 — The three API routes

### 2a. `PATCH /api/tenant` — `tenant:update`

Add to `portal/api/src/routes/tenants.ts`, after the existing `POST /`.

- Gate with `requirePermission("tenant", "update")`, not `requireRole` — the statement already
  grants it to `admin` and `owner`, and hard-coding the list is what `requirePermission` exists
  to avoid (`middleware/tenant.ts:103-113`).
- Writable: `maxConcurrentCalls`, `timezone`, `defaultCallerIdName`, `defaultCallerIdNumber`,
  `recordingPolicy`, `stirShakenEnabled`, `enabled`.
- **`sipDomain` is not patchable.** It is the tenancy boundary at the SIP layer; changing it
  orphans every registration, every Kamailio `subscriber` row and every cached key. Reject it
  with a message saying so rather than ignoring it silently.
- `tier`/`dispatcherSetId`: allow `dispatcherSetId` so the dedicated-tier 202 path at
  `tenants.ts:79-88` becomes completable from the portal. Leave `tier` to provisioning.
- On success call `rebuildTenant(organizationId)` — `timezone` and the caller-ID defaults are read
  at call time from Redis — and `recordAudit` with before/after.

### 2b. `GET /api/audit` — `audit:read`

New file `portal/api/src/routes/audit.ts`, mounted at `/api/audit` in `index.ts`.

- `requireTenant` + `requirePermission("audit", "read")`.
- Filter on `organizationId` unconditionally and first, same shape as `cdr.ts:45`.
- Query params: `entityType`, `action`, `userId`, `from`, `to`, `limit` (cap 200), `offset`.
  Reuse the `parseDate` rejection pattern from `cdr.ts:24-28`.
- Left-join `user` for an email, the way `cdr.ts:93-94` joins extension and trunk.
- **Redact before returning.** `before`/`after` are the whole row (`lib/crud.ts:172, 205`), which
  for a trunk includes `passwordEnc` and for an extension `sipPasswordEnc` / `voicemailPinEnc`.
  Encrypted, but there is no reason to ship ciphertext to a browser. Strip every key ending in
  `Enc` from both blobs in the presenter. Do this in the route, not the UI.

### 2c. `GET /api/cdr/export` — `cdr:export`

Add to `portal/api/src/routes/cdr.ts`.

- **Register it above `cdrs.get("/:id")`** or `/:id` swallows it — the same ordering that already
  makes `/summary` work.
- The blanket `cdrs.use("*", requirePermission("cdr", "read"))` at line 19 is not enough; add
  `requirePermission("cdr", "export")` on this route so `viewer` and `member` are refused. That
  distinction is the entire reason the action exists.
- Accept the same filters as `GET /`. Factor the filter-building block (`cdr.ts:37-71`) into a
  local `buildFilters(q, organizationId)` used by both — one place to add a filter, and no chance
  of the export quietly ignoring one the list honours.
- Stream CSV with `Content-Disposition: attachment`. Cap well above the list's 200 (10k is a
  reasonable ceiling); a bulk export that silently truncates is worse than one that refuses.
- Replace the stale comment at `cdr.ts:16-18` — it will be describing a route that now exists.

---

## Phase 3 — New pages

### 3a. `/faxes` — `portal/web/src/routes/_app/faxes.tsx`

Backed by `GET /api/faxes` (already live, `routes/fax.ts:69`). Columns: received, DID, caller,
pages, status badge, delivered-to email, download.

**The download cannot go through `api.get`.** `lib/api.ts:70-78` throws on any 2xx that is not
JSON, and this endpoint returns `application/pdf` or `image/tiff`. Use a plain
`<Anchor href={`/api/faxes/${id}/download`} download>` — same-origin, so the session cookie
travels without `fetch`. Do not add a blob helper for one link.

Handle **410** distinctly: `fax.ts:88-92` returns it when the row outlived the file after
retention pruning, with a precise message. An anchor will just navigate to a JSON error, so gate
the link on `status` and show "no longer on disk" rather than a dead link.

Add `Fax` type and `endpoints.faxes()` to `lib/api.ts`. Note the API strips `filePath` server-side
— do not add it to the type.

Permission is `recording` (`fax.ts:64-67`): `viewer` has none, so the whole page and its nav entry
are gated on `can("recording", "read")`.

### 3b. `/users` — `portal/web/src/routes/_app/users.tsx`

Entirely on `authClient.organization.*`; the client plugin is already loaded
(`lib/auth-client.ts:17`). No new API for the read path.

- List: `authClient.organization.listMembers()` → email, role, joined date.
- Change role: `authClient.organization.updateMemberRole({ memberId, role })`. The client types
  say `memberIdOrEmail`, the REST body documents `memberId` — check the installed version's types
  at implementation rather than trusting either.
- Remove: `authClient.organization.removeMember({ memberIdOrEmail })`.
- Guard the last owner in the UI *and* accept that better-auth guards it server-side; surface its
  error rather than pre-empting with a different message.
- Roles offered come from the same mirror table as Phase 1.

**Do not build invitation UI.** It would be the failure mode this codebase keeps hitting:
`sendInvitationEmail` only `console.warn`s a link (`auth.ts:190-196`), the SPA has no
`/accept-invitation/:id` route to land on, and self-service sign-up is 404'd at nginx *and*
blocked by a `databaseHooks` throw — so an invitee has no account to accept with. An invite button
would appear to work and do nothing.

Instead, **add member by existing email**, which is what actually works — mirror
`cli/add-tenant-user.ts`: look up `user` by email, insert or re-role the `member` row. This needs
one new route, `POST /api/tenant/members`, in `tenants.ts` gated `requireRole("owner", "admin")`.
When no account exists, return the `create-user.ts` command as `detail`, the way `NoTenant`
in `_app.tsx:149-168` already does for provisioning. Audit it.

### 3c. `/audit` — `portal/web/src/routes/_app/audit.tsx`

Consumes 2b. Table of when / who / action / entity, with filters for entity type, action and date
range. Row expands to a before/after diff — a plain two-column key/value comparison of the
redacted blobs is enough; do not pull in a diff library.

The feature-code rows are the interesting ones: `fs-feature.ts:104-116` writes
`actor: feature-code:<number>@<domain>` with a null `userId`, which is how "why did my calls go to
a mobile all week" gets answered. Render a null `userId` as that actor string rather than a blank.

---

## Phase 4 — Settings becomes editable

`portal/web/src/routes/_app/settings.tsx` is a read-only table today. Keep the table as the
default view and add an Edit action gated on `can("tenant", "update")`, posting to 2a.

Two operational actions belong here, both already live and both unreachable:

- **Rebuild cache** → `POST /api/tenant/rebuild-cache` (`tenants.ts:110`). The repair action after
  a Redis flush or a restore. Confirm before firing, and say what it does — it purges and
  repopulates every key for the tenant.
- **Provision telephony** → `POST /api/tenant` (`tenants.ts:39`). Only reachable in the state
  `settings.tsx:38` already detects: a 404 meaning the organization exists but `tenantSettings`
  does not. Replace the bare yellow alert with a form for `sipDomain`, `tier`, `timezone`,
  `maxConcurrentCalls`. Handle the **202** at `tenants.ts:79-88` — a dedicated tier returns
  success-with-a-problem and needs `dispatcherSetId` set before calls route. Treating 202 as
  plain success is how a tenant ends up looking provisioned and failing on the wire.

Add `endpoints.updateTenant`, `endpoints.provisionTenant`, `endpoints.rebuildCache`,
`endpoints.addMember` to `lib/api.ts`.

---

## Phase 5 — Retrofit the existing pages

Convert the five existing pages to `useForm` + notifications. Mechanical, but two things to get
right:

- **PATCH only dirty fields.** `crudRoutes` `validate` receives `existing` precisely because a
  PATCH carries a partial body (`lib/crud.ts:55-62`). `form.isDirty(field)` gives the correct
  patch body; sending every field back defeats the paired-field validation the API relies on.
- **Do not regress the React Query subscription rule.** `QueryState` takes `data`, `error`,
  `isPending`, `isSuccess` as separate props for a documented reason
  (`components/Resource.tsx:55-68`). Keep destructuring at the call site.

Leave `trunks.tsx`'s split password write alone — the plaintext goes through its own endpoint so
it never reaches an audit diff (`telephony.ts:141-146`), and `useForm` does not change that.

---

## Files

| Action | Path |
|---|---|
| new | `portal/web/src/routes/_app/faxes.tsx`, `users.tsx`, `audit.tsx` |
| new | `portal/web/src/lib/use-role.ts`, `lib/notify.ts` |
| new | `portal/api/src/routes/audit.ts` |
| edit | `portal/api/src/routes/tenants.ts` (PATCH, POST /members), `cdr.ts` (export + filter extraction), `index.ts` (mount audit) |
| edit | `portal/web/src/lib/api.ts` (Fax/Audit/Member types, new endpoints) |
| edit | `portal/web/src/routes/_app.tsx` (nav, role query), `_app/settings.tsx` |
| edit | `portal/web/src/components/Resource.tsx` (`RoleGate`) |
| edit | `portal/web/src/main.tsx`, `package.json` |
| edit | existing five pages (Phase 5, mechanical) |
| edit | `README.md` — the portal section lists the pages; add the three new ones |

No schema change, so `drizzle-kit push --force` has nothing to apply. No installer step changes:
`43-portal-web.sh` runs the same build, and new SPA routes fall under nginx's gated
`location /` automatically.

---

## Risks

**nginx rate-limits `/api/auth/*` to 5 r/m** (`resources/conf/nginx/conf.d/00-hardening.conf:19`,
applied at `sites-available/qwixbox-api:54`, burst 5 nodelay). `_app.beforeLoad` already calls
`authClient.getSession()` on every navigation, and Phase 1 and 3b add more auth traffic. Six
navigations in a minute may already 503 today. **Verify this before building on it** — hit the
portal and navigate quickly. If it bites: keep the role query at `staleTime: Infinity` fetched
once per session, and consider giving `/api/auth/organization/` its own looser zone, leaving the
strict one on sign-in.

**Redaction is the one security-relevant line of new code.** Get the `*Enc` strip right in
`routes/audit.ts`, and test it by creating a trunk with a password and reading the audit row back.

---

## Verification

Static, in order:

```sh
cd portal/api && bunx tsc -p tsconfig.json --noEmit   # `bun run typecheck` exits 127, see CLAUDE.md
cd portal/api && bun run format
cd portal/web && bun run typecheck && bun run lint && bun run build
```

Then the Debian 13 arm64 systemd container — static checks pass on code that fails several ways
at runtime, which is the lesson `docs/mvp.md` closes on. Remove the deployed directory before
copying the tree: `tar` does not delete files that moved, and three new route files plus a
renamed nav will leave stale ones being served.

End to end, signed in as `owner`:

1. `/faxes` lists rows; the download anchor returns a PDF, not JSON. Rename the file on disk and
   confirm the 410 path shows "no longer on disk".
2. `/users` lists members; change a role and confirm it takes effect on the *next request* with no
   sign-out — the role is re-read per request (`middleware/tenant.ts:68`).
3. Add a member by an email with no account; confirm the response carries the `create-user.ts`
   command rather than a bare failure.
4. `/audit` shows the trunk you just created. **Confirm no `*Enc` value appears in the payload** —
   check the network response, not the rendered table.
5. `/calls` → Export downloads a CSV whose row count matches the filtered total.
6. Settings → edit `maxConcurrentCalls`, save, then `redis-cli` the tenant key to confirm
   `rebuildTenant` ran. Rebuild cache from the same page and confirm the keys repopulate.

Then the part that actually matters, per CLAUDE.md's rule about proving a control by trying to
break it — **re-run the identical sequence as `viewer`**:

- `/faxes`, `/audit` and the CDR export are refused (`recording`, `audit`, `cdr:export` are all
  withheld from `viewer`); the nav entries are absent.
- The Settings edit and rebuild-cache actions are refused.
- Then bypass the UI: `curl` the same endpoints with the viewer's session cookie and confirm 403
  from the server, not just a missing button. A hidden button is not a permission check.

Repeat as `member` for the middle tier — `member` has `callflow` and `extension` writes but only
`trunk:read` and `route:read`, so the Trunks and Routing pages should be read-only while
Extensions and Call flows stay editable.

An amd64 pass is not required: nothing here touches apt dependencies or `./configure` flags.
