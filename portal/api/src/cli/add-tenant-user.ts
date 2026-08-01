#!/usr/bin/env bun
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

const existing = await db.query.member.findFirst({
  where: and(eq(member.organizationId, org.id), eq(member.userId, account.id)),
});

if (existing) {
  if (existing.role === role) {
    console.log(`${email} is already ${role} of ${tenant} - nothing to do.`);
    process.exit(0);
  }
  await db.update(member).set({ role }).where(eq(member.id, existing.id));
  console.log(
    `Changed ${email} from ${existing.role} to ${role} in ${tenant}.`,
  );
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

console.log("They can sign in and select the tenant now.");
process.exit(0);
