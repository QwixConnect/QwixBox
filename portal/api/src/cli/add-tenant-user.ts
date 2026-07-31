#!/usr/bin/env bun
/**
 * Give an existing account access to an existing tenant, with a role.
 *
 * `provision-tenant.ts` creates a tenant and makes one person its owner. It deliberately does
 * not do this job: adding somebody to a tenant that already exists is a different operation, and
 * conflating the two is how the previous version ended up silently ignoring a second `--owner`.
 *
 * This is also the only way to hand out any role other than owner. The roles in auth.ts
 * (owner, admin, member, viewer) were unreachable before this existed, because nothing could
 * write a `member` row with a role of the operator's choosing.
 *
 *   bun run src/cli/add-tenant-user.ts --email them@example.com --tenant acme --role admin
 *   bun run src/cli/add-tenant-user.ts --email them@example.com --tenant acme --role viewer
 *
 * Run from /opt/qwixbox-api, not the git checkout - the checkout has neither .env nor
 * dependencies.
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { member, organization, user } from "../db/schema";
import { ROLES, type RoleName } from "../auth";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const email = arg("email");
const tenant = arg("tenant");
const role = (arg("role") ?? "member") as RoleName;

if (!email || !tenant) {
  console.error(
    "Usage: add-tenant-user.ts --email <email> --tenant <slug> [--role owner|admin|member|viewer]",
  );
  process.exit(2);
}

/* Checked against the exported role table rather than a hard-coded list, so adding a role in
   auth.ts makes it assignable here without a second edit. An unknown role is refused rather
   than defaulted - a typo that silently produced a `viewer` would look like a permissions bug
   later, and one that silently produced an `owner` would be worse. */
if (!(role in ROLES)) {
  console.error(`Unknown role "${role}". Known roles: ${Object.keys(ROLES).join(", ")}`);
  process.exit(2);
}

const account = await db.query.user.findFirst({ where: eq(user.email, email) });
if (!account) {
  console.error(`No account for ${email}. Create it first with create-user.ts.`);
  process.exit(1);
}

const org = await db.query.organization.findFirst({ where: eq(organization.slug, tenant) });
if (!org) {
  console.error(`No tenant with slug "${tenant}". Create it first with provision-tenant.ts.`);
  process.exit(1);
}

/* Scoped by BOTH organization and user. Scoping by organization alone - which is what
   provision-tenant.ts did - means the first member makes every later one a no-op. */
const existing = await db.query.member.findFirst({
  where: and(eq(member.organizationId, org.id), eq(member.userId, account.id)),
});

if (existing) {
  if (existing.role === role) {
    console.log(`${email} is already ${role} of ${tenant} - nothing to do.`);
    process.exit(0);
  }
  await db.update(member).set({ role }).where(eq(member.id, existing.id));
  console.log(`Changed ${email} from ${existing.role} to ${role} in ${tenant}.`);
} else {
  await db.insert(member).values({
    id: randomUUID(),
    organizationId: org.id,
    userId: account.id,
    role,
    createdAt: new Date(),
  });
  console.log(`Added ${email} to ${tenant} as ${role}.`);
}

/* The role is read from this row on every request, so it takes effect immediately - there is no
   cache to clear and no need for the user to sign out. */
console.log("They can sign in and select the tenant now.");
process.exit(0);
