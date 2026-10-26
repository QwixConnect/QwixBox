import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { member, organization, tenantSettings, user } from "../db/schema";
import { unsafeTenantSettings } from "../lib/dialplan-safe";
import { enqueue } from "./projections";

export async function provisionTenant(input: {
  name: string;
  slug: string;
  domain: string;
  ownerEmail: string;
  tier: "shared" | "dedicated";
  maxCalls: number;
}) {
  const problem = unsafeTenantSettings({
    tier: input.tier,
    maxConcurrentCalls: input.maxCalls,
  });
  if (
    problem ||
    !/^(?=.{1,253}$)[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(input.domain)
  )
    throw new Error(problem ?? "Invalid SIP domain");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`provision:${input.slug}`}))`,
    );
    const owner = await tx.query.user.findFirst({
      where: eq(user.email, input.ownerEmail),
    });
    if (!owner)
      throw new Error("Create the account with src/cli/create-user.ts first.");
    let org = await tx.query.organization.findFirst({
      where: eq(organization.slug, input.slug),
    });
    const orgId = org?.id ?? randomUUID();
    const clash = await tx.query.tenantSettings.findFirst({
      where: eq(tenantSettings.sipDomain, input.domain),
    });
    const existing = await tx.query.tenantSettings.findFirst({
      where: eq(tenantSettings.organizationId, orgId),
    });
    if (
      (clash && clash.organizationId !== orgId) ||
      (existing && existing.sipDomain !== input.domain)
    )
      throw new Error(
        "SIP domain ownership is immutable; use the existing organization and domain.",
      );
    if (!org)
      [org] = await tx
        .insert(organization)
        .values({ id: orgId, name: input.name, slug: input.slug })
        .returning();
    if (!existing)
      await tx.insert(tenantSettings).values({
        organizationId: orgId,
        sipDomain: input.domain,
        tier: input.tier,
        dispatcherSetId: 1,
        maxConcurrentCalls: input.maxCalls,
      });
    const membership = await tx.query.member.findFirst({
      where: and(eq(member.organizationId, orgId), eq(member.userId, owner.id)),
    });
    if (!membership)
      await tx.insert(member).values({
        id: randomUUID(),
        organizationId: orgId,
        userId: owner.id,
        role: "owner",
      });
    // Recorded with the tenant itself (R06): a provisioned tenant cannot exist without its
    // domain and cache publication being queued. Repeats re-publish, which is how a rerun
    // reconciles.
    const projectionKeys = await enqueue(tx, orgId, [
      { kind: "domain" },
      { kind: "cache", target: "all" },
    ]);
    return {
      organizationId: orgId,
      domain: existing?.sipDomain ?? input.domain,
      existing: !!existing,
      projectionKeys,
    };
  });
}
