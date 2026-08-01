#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { member, organization, tenantSettings, user } from "../db/schema";
import { rebuildTenant } from "../services/cache";
import { reloadKamailio, syncDomain } from "../services/kamailio-sync";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const name = arg("name");
const slug = arg("slug");
const domain = arg("domain");
const ownerEmail = arg("owner");
const tier = (arg("tier") ?? "shared") as "shared" | "dedicated";
const maxCalls = Number(arg("max-calls") ?? "10");

if (!name || !slug || !domain || !ownerEmail) {
  console.error(
    "Usage: provision-tenant.ts --name <name> --slug <slug> --domain <sip-domain> " +
      "--owner <email> [--tier shared|dedicated] [--max-calls N]",
  );
  process.exit(2);
}

const owner = await db.query.user.findFirst({
  where: eq(user.email, ownerEmail),
});
if (!owner) {
  console.error(`No user with email ${ownerEmail}. They must sign up first.`);
  process.exit(1);
}

const clash = await db.query.tenantSettings.findFirst({
  where: eq(tenantSettings.sipDomain, domain),
});
if (clash) {
  console.error(
    `SIP domain ${domain} is already used by organization ${clash.organizationId}.`,
  );
  process.exit(1);
}

const existing = await db.query.organization.findFirst({
  where: eq(organization.slug, slug),
});
const orgId = existing?.id ?? randomUUID();

if (!existing) {
  await db
    .insert(organization)
    .values({ id: orgId, name, slug, createdAt: new Date() });
  console.log(`  created organization ${slug} (${orgId})`);
} else {
  console.log(`  organization ${slug} already exists (${orgId})`);
}

const membership = await db.query.member.findFirst({
  where: and(eq(member.organizationId, orgId), eq(member.userId, owner.id)),
});
if (!membership) {
  await db.insert(member).values({
    id: randomUUID(),
    organizationId: orgId,
    userId: owner.id,
    role: "owner",
    createdAt: new Date(),
  });
  console.log(`  ${ownerEmail} is owner`);
} else {
  console.log(`  ${ownerEmail} is already ${membership.role}`);
}

await db
  .insert(tenantSettings)
  .values({
    organizationId: orgId,
    sipDomain: domain,
    tier,
    dispatcherSetId: 1,
    maxConcurrentCalls: maxCalls,
  })
  .onConflictDoUpdate({
    target: tenantSettings.organizationId,
    set: { sipDomain: domain, tier, maxConcurrentCalls: maxCalls },
  });
console.log(
  `  telephony configured: ${domain} (${tier}, max ${maxCalls} concurrent)`,
);

await syncDomain(domain);
await reloadKamailio();
await rebuildTenant(orgId);
console.log(`  Kamailio domain registered and cache warmed`);

console.log(`\nProvisioned ${name} <${domain}>`);
process.exit(0);
