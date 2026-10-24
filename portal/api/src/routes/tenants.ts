import { unsafeTenantSettings } from "../lib/dialplan-safe";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { changeMembership } from "../services/membership";
import { db } from "../db";
import { tenantSettings } from "../db/schema";
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

tenants.get("/", async (c) => {
  const row = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, c.get("organizationId")),
  });
  if (!row) return c.json({ error: "Tenant is not provisioned" }, 404);
  return c.json(row);
});

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

  const unsafe = unsafeTenantSettings(body);
  if (unsafe) return c.json({ error: unsafe }, 400);
  if (typeof body.sipDomain !== "string" || !body.sipDomain)
    return c.json({ error: "sipDomain is required" }, 400);

  const provisioned = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
  if (provisioned) {
    if (provisioned.sipDomain !== body.sipDomain)
      return c.json({ error: "sipDomain cannot be changed" }, 409);
    return c.json(provisioned);
  }
  if (!/^(?=.{1,253}$)[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(body.sipDomain))
    return c.json({ error: "Invalid SIP domain" }, 400);

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
    dispatcherSetId: body.tier === "dedicated" ? 0 : 1,
    maxConcurrentCalls: body.maxConcurrentCalls ?? 10,
    timezone: body.timezone ?? "Etc/UTC",
    defaultCallerIdName: body.defaultCallerIdName ?? null,
    defaultCallerIdNumber: body.defaultCallerIdNumber ?? null,
  };

  const [row] = await db
    .insert(tenantSettings)
    .values(values)
    .onConflictDoNothing()
    .returning();
  if (!row)
    return c.json({ error: "Tenant or domain already provisioned" }, 409);

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

tenants.patch("/", requirePermission("tenant", "update"), async (c) => {
  const organizationId = c.get("organizationId");
  const body = await c.req.json<Record<string, unknown>>();

  const unsafe = unsafeTenantSettings(body);
  if (unsafe) return c.json({ error: unsafe }, 400);
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
  if ("faxNotifyEmail" in body) {
    if (
      body.faxNotifyEmail !== null &&
      (typeof body.faxNotifyEmail !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.faxNotifyEmail))
    )
      return c.json({ error: "Invalid fax notification email" }, 400);
    patch.faxNotifyEmail = body.faxNotifyEmail as string | null;
  }
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

  if (Object.keys(patch).length === 0) {
    return c.json({ error: "No recognised fields to update" }, 400);
  }

  const [row] = await db
    .update(tenantSettings)
    .set(patch)
    .where(eq(tenantSettings.organizationId, organizationId))
    .returning();
  if (!row) return c.json({ error: "Update failed" }, 500);

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

tenants.post("/members", requireRole("owner", "admin"), async (c) => {
  const body = await c.req.json<{ email?: string; role?: string }>();
  if (typeof body.email !== "string" || !body.email.trim())
    return c.json({ error: "email is required" }, 400);
  const result = await changeMembership({
    organizationId: c.get("organizationId"),
    actorId: c.get("userId"),
    email: body.email,
    role: body.role,
  });
  await recordAudit(c, {
    action: result.status,
    entityType: "member",
    entityId: result.after?.id,
    before: result.before,
    after: result.after,
  });
  return c.json(
    { ...result.after, email: body.email, status: result.status },
    result.status === "created" ? 201 : 200,
  );
});

tenants.patch("/members/:id", requireRole("owner", "admin"), async (c) => {
  const body = await c.req.json<{ role: string }>();
  const result = await changeMembership({
    organizationId: c.get("organizationId"),
    actorId: c.get("userId"),
    memberId: c.req.param("id"),
    role: body.role,
  });
  await recordAudit(c, {
    action: "update",
    entityType: "member",
    entityId: c.req.param("id"),
    before: result.before,
    after: result.after,
  });
  return c.json(result.after);
});

tenants.delete("/members/:id", requireRole("owner", "admin"), async (c) => {
  const result = await changeMembership({
    organizationId: c.get("organizationId"),
    actorId: c.get("userId"),
    memberId: c.req.param("id"),
    remove: true,
  });
  await recordAudit(c, {
    action: "delete",
    entityType: "member",
    entityId: c.req.param("id"),
    before: result.before,
  });
  return c.body(null, 204);
});

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
