/**
 * Tenant provisioning.
 *
 * Creating a tenant is not just a database row: the SIP domain has to exist in Kamailio's
 * `domain` table before any extension in it can register, and the tenant's settings have to be
 * in Redis before Lua can route a call for it. Doing those in one place is what stops a
 * half-provisioned tenant that looks fine in the portal and fails on the wire.
 *
 * Organizations themselves are created through better-auth (`/api/auth/organization/create`);
 * this attaches the telephony configuration to one.
 */
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { member, tenantSettings, user } from "../db/schema";
import { ROLES, type RoleName } from "../auth";
import { recordAudit } from "../lib/audit";
import { rebuildTenant } from "../services/cache";
import { syncDomain, reloadKamailio } from "../services/kamailio-sync";
import {
  requireTenant,
  requireRole,
  requirePermission,
  type AppEnv,
} from "../middleware/tenant";

export const tenants = new Hono<AppEnv>();
tenants.use("*", requireTenant);

/** The active tenant's own settings. Any member may read; only admins may change. */
tenants.get("/", async (c) => {
  const row = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, c.get("organizationId")),
  });
  if (!row) return c.json({ error: "Tenant is not provisioned" }, 404);
  return c.json(row);
});

/**
 * Provisions telephony for the active organization.
 *
 * The SIP domain is the tenancy boundary at the SIP layer, so it is unique across the whole
 * platform - two tenants cannot share one, or `use_domain=1` stops distinguishing them.
 */
tenants.post("/", requireRole("owner", "admin"), async (c) => {
  const organizationId = c.get("organizationId");
  const body = await c.req.json<{
    sipDomain?: string;
    tier?: "shared" | "dedicated";
    maxConcurrentCalls?: number;
    timezone?: string;
    defaultCallerIdName?: string;
    defaultCallerIdNumber?: string;
  }>();

  if (!body.sipDomain) return c.json({ error: "sipDomain is required" }, 400);

  const existing = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.sipDomain, body.sipDomain),
  });
  if (existing && existing.organizationId !== organizationId) {
    return c.json(
      { error: `SIP domain ${body.sipDomain} is already in use` },
      409,
    );
  }

  const values = {
    organizationId,
    sipDomain: body.sipDomain,
    tier: body.tier ?? ("shared" as const),
    // A dedicated tenant gets its own dispatcher set; shared tenants all use set 1. This is
    // what keeps the two commercial tiers as one architecture.
    dispatcherSetId: body.tier === "dedicated" ? 0 : 1,
    maxConcurrentCalls: body.maxConcurrentCalls ?? 10,
    timezone: body.timezone ?? "Etc/UTC",
    defaultCallerIdName: body.defaultCallerIdName ?? null,
    defaultCallerIdNumber: body.defaultCallerIdNumber ?? null,
  };

  const [row] = await db
    .insert(tenantSettings)
    .values(values)
    .onConflictDoUpdate({ target: tenantSettings.organizationId, set: values })
    .returning();
  if (!row) return c.json({ error: "Provisioning failed" }, 500);

  if (row.dispatcherSetId === 0) {
    return c.json(
      {
        error: "Dedicated tier needs a dispatcher set assigned",
        detail:
          "Allocate a set id and PATCH dispatcherSetId before routing calls",
        tenant: row,
      },
      202,
    );
  }

  // Kamailio must know the domain before anyone can register into it.
  await syncDomain(row.sipDomain);
  await reloadKamailio();
  await rebuildTenant(organizationId);

  await recordAudit(c, {
    action: existing ? "update" : "create",
    entityType: "tenant_settings",
    entityId: organizationId,
    before: existing,
    after: row,
  });

  return c.json(row, existing ? 200 : 201);
});

/**
 * Updates tenant settings. `sipDomain` is rejected — it is the SIP tenancy boundary; changing
 * it orphans registrations, Kamailio subscriber rows, and every cached key.
 *
 * `tier` stays with provisioning. `dispatcherSetId` is writable so the dedicated-tier 202 path
 * above can be completed from the portal.
 */
tenants.patch("/", requirePermission("tenant", "update"), async (c) => {
  const organizationId = c.get("organizationId");
  const body = await c.req.json<Record<string, unknown>>();

  if ("sipDomain" in body) {
    return c.json(
      {
        error: "sipDomain cannot be changed",
        detail:
          "The SIP domain is the tenancy boundary. Changing it orphans every registration, " +
          "Kamailio subscriber row, and Redis key for this tenant.",
      },
      400,
    );
  }
  if ("tier" in body) {
    return c.json(
      {
        error: "tier cannot be changed here",
        detail: "Re-provision or edit via operator tools.",
      },
      400,
    );
  }

  const existing = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
  if (!existing) return c.json({ error: "Tenant is not provisioned" }, 404);

  const patch: Partial<typeof tenantSettings.$inferInsert> = {};
  if (typeof body.maxConcurrentCalls === "number")
    patch.maxConcurrentCalls = body.maxConcurrentCalls;
  if (typeof body.timezone === "string") patch.timezone = body.timezone;
  if ("defaultCallerIdName" in body) {
    patch.defaultCallerIdName =
      body.defaultCallerIdName === null ||
      typeof body.defaultCallerIdName === "string"
        ? (body.defaultCallerIdName as string | null)
        : existing.defaultCallerIdName;
  }
  if ("defaultCallerIdNumber" in body) {
    patch.defaultCallerIdNumber =
      body.defaultCallerIdNumber === null ||
      typeof body.defaultCallerIdNumber === "string"
        ? (body.defaultCallerIdNumber as string | null)
        : existing.defaultCallerIdNumber;
  }
  if (
    body.recordingPolicy === "none" ||
    body.recordingPolicy === "inbound" ||
    body.recordingPolicy === "outbound" ||
    body.recordingPolicy === "all"
  ) {
    patch.recordingPolicy = body.recordingPolicy;
  }
  if (typeof body.stirShakenEnabled === "boolean")
    patch.stirShakenEnabled = body.stirShakenEnabled;
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.dispatcherSetId === "number")
    patch.dispatcherSetId = body.dispatcherSetId;

  if (Object.keys(patch).length === 0) {
    return c.json({ error: "No recognised fields to update" }, 400);
  }

  const [row] = await db
    .update(tenantSettings)
    .set(patch)
    .where(eq(tenantSettings.organizationId, organizationId))
    .returning();
  if (!row) return c.json({ error: "Update failed" }, 500);

  // timezone and caller-ID defaults are read at call time from Redis.
  await rebuildTenant(organizationId);
  await recordAudit(c, {
    action: "update",
    entityType: "tenant_settings",
    entityId: organizationId,
    before: existing,
    after: row,
  });

  return c.json(row);
});

/**
 * Add an existing portal account to this tenant, or re-role them.
 *
 * Mirrors cli/add-tenant-user.ts. Invitation UI is deliberately absent — sendInvitationEmail is
 * a no-op and self-service signup is blocked, so an invite button would appear to work and do
 * nothing. When no account exists, return the create-user.ts command as `detail`.
 */
tenants.post("/members", requireRole("owner", "admin"), async (c) => {
  const organizationId = c.get("organizationId");
  const body = await c.req.json<{ email?: string; role?: string }>();
  const email = body.email?.trim().toLowerCase();
  const role = (body.role ?? "member") as RoleName;

  if (!email) return c.json({ error: "email is required" }, 400);
  if (!(role in ROLES)) {
    return c.json(
      {
        error: `Unknown role "${role}"`,
        detail: `Known roles: ${Object.keys(ROLES).join(", ")}`,
      },
      400,
    );
  }

  const account = await db.query.user.findFirst({
    where: eq(user.email, email),
  });
  if (!account) {
    return c.json(
      {
        error: `No account for ${email}`,
        detail:
          `Create it first on the server:\n` +
          `cd /opt/qwixbox-api && sudo -u qwixbox bun run src/cli/create-user.ts --email ${email}`,
      },
      404,
    );
  }

  const existing = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, organizationId),
      eq(member.userId, account.id),
    ),
  });

  if (existing) {
    if (existing.role === role) {
      return c.json({
        id: existing.id,
        userId: account.id,
        email,
        role,
        status: "unchanged",
      });
    }
    const [updated] = await db
      .update(member)
      .set({ role })
      .where(eq(member.id, existing.id))
      .returning();
    await recordAudit(c, {
      action: "update",
      entityType: "member",
      entityId: existing.id,
      before: existing,
      after: updated,
    });
    return c.json({
      id: existing.id,
      userId: account.id,
      email,
      role,
      status: "updated",
    });
  }

  const id = randomUUID();
  const [row] = await db
    .insert(member)
    .values({
      id,
      organizationId,
      userId: account.id,
      role,
      createdAt: new Date(),
    })
    .returning();

  await recordAudit(c, {
    action: "create",
    entityType: "member",
    entityId: id,
    after: row,
  });

  return c.json(
    { id, userId: account.id, email, role, status: "created" },
    201,
  );
});

/**
 * Forces a full cache rebuild for this tenant. The repair action when Redis is suspected
 * stale - after a flush, a restore, or a manual database edit.
 */
tenants.post("/rebuild-cache", requireRole("owner", "admin"), async (c) => {
  const organizationId = c.get("organizationId");
  await rebuildTenant(organizationId);
  await recordAudit(c, {
    action: "rebuild-cache",
    entityType: "tenant_settings",
    entityId: organizationId,
  });
  return c.json({ status: "rebuilt" });
});
