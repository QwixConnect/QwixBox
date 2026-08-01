# Portal UI — shipped

Planned and delivered 2026-08-01, in `106dff2` (web) and `79fbb21` (API). This is the record, not
a plan; the code is the detail. Kept for the decisions below, which are not recoverable from the
diff.

## What it set out to fix

The portal had seven pages, API surface no UI reached, and three permissions declared in
`portal/api/src/auth.ts` that no route consumed — `tenant:update`, `audit:read`, `cdr:export`.
That last part is this codebase's recurring failure mode: a permission model that reads as
enforced because it is well described.

## Delivered

| Phase | |
|---|---|
| 0 — Dependencies | `@mantine/form`, `@mantine/notifications`, `lib/notify.ts` |
| 1 — Role awareness | `lib/use-role.ts` mirrors `ROLES`; role fetched once per session; `RoleGate` on 7 pages; nav hidden by permission |
| 2 — The three dead permissions | `PATCH /api/tenant`, `GET /api/audit` (Enc-stripped), `GET /api/cdr/export`, plus `POST /api/tenant/members` |
| 3 — New pages | `/faxes`, `/users`, `/audit`; CDR export on `/calls` |
| 4 — Settings | Editable via dirty PATCH, plus provision-telephony (202 handled) and rebuild-cache |
| 5 — Retrofit | Every page with a form uses `useForm` + notifications |

Read-only pages — audit, calls, faxes, dashboard — have no form and correctly adopted neither.

## Decisions worth keeping

**No invitation UI, deliberately.** `sendInvitationEmail` only logs a link, the SPA had no
`/accept-invitation` route, and self-service sign-up is blocked at nginx *and* by a
`databaseHooks` throw — so an invitee has no account to accept with. An invite button would have
appeared to work and done nothing. `POST /api/tenant/members` adds an existing account by email
instead, mirroring `add-tenant-user.ts`.

**The audit route redacts `*Enc` columns.** `crudRoutes` puts the whole row in `before`/`after`,
which for a trunk includes `passwordEnc`. Encrypted, but no reason to ship ciphertext to a browser.

**`sipDomain` is not patchable.** It is the tenancy boundary at the SIP layer; changing it would
orphan every registration, every Kamailio `subscriber` row and every cached key.

**The role gate is convenience, not security.** The server re-reads the `member` row per request
and enforces via `requirePermission`. Hiding a button only stops a 403 from teaching an operator
what they cannot do.

## Found while building

The CDR export quoted correctly per RFC 4180 but did nothing about leading `=`, `+`, `-` or `@`,
which spreadsheets execute. `callerName` is `caller_id_name` off the inbound SIP profile, so an
inbound caller could name themselves a formula and read a row out of an operator's export. Fixed
in `2d46f49`, with a carve-out so `+14165550100` is not mangled — a value that is only digits and
punctuation after a leading `+` or `-` cannot reach a function name, so arithmetic is the worst it
evaluates to.

## Still open

- **Container verification of the role gates.** Static checks pass (both typechecks, lint, web
  build). What has not been re-run since these pages landed is the sequence in
  [mvp.md](mvp.md)'s closing note: sign in as `viewer`, confirm the refusals, then `curl` the same
  endpoints with that session cookie so the 403 comes from the server rather than a missing
  button. A hidden button is not a permission check.
- **`/api/auth` is rate-limited to 5 r/m** (`00-hardening.conf:19`) and `_app.beforeLoad` calls
  `getSession()` on every navigation. The role query is cached at `staleTime: Infinity`, so it
  costs one request per session, but the underlying limit was never loosened and fast navigation
  may still hit it. Unverified either way.
- **No voicemail page.** There is no voicemail API either, and nothing to list until a message can
  be recorded — blocked on [mvp.md](mvp.md) item 1, not on effort.
