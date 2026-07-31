# Design: resellers, and the tenancy level above a tenant

**Status: not built, and not fully designed.** This document states a problem and the options. It
deliberately does not pretend there is a clean answer, because there is not one.

## What v1 actually had

Less than its roadmap suggests. `resellers.sql` is one table and one foreign key:

```sql
CREATE TABLE resellers (reseller_uuid, name, contact_name, contact_email, enabled, created_at);
ALTER TABLE domains ADD COLUMN reseller_uuid REFERENCES resellers(reseller_uuid);
```

The substance is elsewhere, in `auth_system.sql`:

- **Branding columns** on both levels — `domains.logo_url`, `domains.primary_color`,
  `resellers.logo_url`.
- **A constraint** that a branding/settings row belongs to exactly one level:
  `(domain_uuid IS NOT NULL AND reseller_uuid IS NULL) OR (domain_uuid IS NULL AND reseller_uuid IS NOT NULL)`.
- **Permissions** `branding.view`, `branding.update`, `domains.branding`, and a `brand-admin` role
  described as "Domain/tenant administrator. Full control over their domain including user
  management, settings, and branding."
- **Email templates** rendered with `{{primary_color}}` and a logo, resolved through an inheritance
  chain: **reseller → domain → system default**.

That inheritance chain is the genuinely reusable idea. Everything else is a table stub.

## Why this is awkward here

In this system **a tenant *is* a better-auth organization**, and `session.activeOrganizationId` is
the scope for every single request. `requireTenant` (`portal/api/src/middleware/tenant.ts`) refuses
to proceed without one rather than defaulting to "all", because an unscoped query is a data breach
rather than a bug.

A reseller is a level *above* that, and it breaks two assumptions the current design leans on:

1. **One active scope per session.** A reseller admin legitimately needs to act across many
   organizations — list them, create one, read billing for all of them. That is not expressible as
   a single `activeOrganizationId`, and the natural workaround (switch active org per request) is
   exactly the pattern that produced the "removed member kept access for eight hours" bug already
   recorded in `CLAUDE.md`.
2. **The role comes from the `member` row** for `(user_id, organization_id)`. A reseller admin has
   no member row in a customer's organization, and giving them one in every organization makes
   removal error-prone and the audit trail meaningless.

## Options, with their real costs

**A. Reseller as an organization, with a parent link.** Add `parentOrganizationId` to the
organization table; a reseller is just an organization whose children are tenants. Reuses the whole
existing model. Cost: every scoped query becomes "this org *or* an org whose parent is this org",
and that is precisely the kind of change that silently widens a scope check somewhere. If this is
chosen, the widening must live in exactly one helper that every query goes through — not be
open-coded per route.

**B. A separate reseller table with explicit grants.** A `reseller` table plus
`resellerMember(userId, resellerId, role)`, and reseller-scoped endpoints that are a distinct
surface from tenant-scoped ones (`/api/reseller/*` beside `/api/*`). Keeps `requireTenant`
untouched and the tenant boundary exactly as strict as it is now. Cost: two authorization paths to
keep correct, and the reseller path is the one with the wider blast radius.

**C. Branding only, no reseller entity.** Implement just the inheritance chain — tenant branding
with a system default — and skip the level above until there is a reseller to serve. Much the
smallest change, and it delivers the part of v1's design that had real content.

**Recommendation: C now, B when a reseller actually exists.** Option A looks cheapest and is the
one most likely to produce a cross-tenant leak, because it changes the meaning of every existing
scoped query rather than adding a new surface beside them.

## If branding is built

- Store it on the tenant, resolve `tenant → system default`, and structure the resolver so a third
  level can be inserted later without changing callers.
- The consumer that matters first is email. There is no HTML email templating in the system yet —
  voicemail and fax notifications are assembled in `portal/api/src/services/fax.ts` and by
  FreeSWITCH's `switch_simple_email()`. v1's template system (Go templates with variable
  substitution and branding injection) is a reasonable model; the substance is the inheritance, not
  the engine.
- `primaryColor` is user-supplied and ends up in HTML and CSS. Validate it as a hex colour on the
  way in rather than escaping it on the way out in five places.
- A logo is an uploaded file. That means storage, a size limit, a content-type check, and serving
  it from somewhere that is not the API's own origin if it is ever rendered in an email.

## What not to do

Do not add a reseller level "for later" with no reseller to serve. An unused tenancy tier that
appears in the schema and the UI but is enforced nowhere is the exact failure this codebase has hit
repeatedly — elaborate configuration wired to nothing, where the prose describes intent so
convincingly that absent enforcement reads as present. Build it when someone is going to use it,
and prove the boundary by signing in as a reseller admin and attempting to reach a tenant that is
not theirs.
