#!/usr/bin/env bun
import { changeMembership } from "../services/membership";
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

if (!(role in ROLES)) {
  console.error(
    `Unknown role "${role}". Known roles: ${Object.keys(ROLES).join(", ")}`,
  );
  process.exit(2);
}

const account = await db.query.user.findFirst({ where: eq(user.email, email) });
if (!account) {
  console.error(
    `No account for ${email}. Create it first with create-user.ts.`,
  );
  process.exit(1);
}

const org = await db.query.organization.findFirst({
  where: eq(organization.slug, tenant),
});
if (!org) {
  console.error(
    `No tenant with slug "${tenant}". Create it first with provision-tenant.ts.`,
  );
  process.exit(1);
}

await changeMembership({ organizationId: org.id, email, role });
console.log(`Updated membership for ${email} in ${tenant}.`);
process.exit(0);
