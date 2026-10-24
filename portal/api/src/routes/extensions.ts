import { unsafeDialplanFields } from "../lib/dialplan-safe";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { extension, tenantSettings } from "../db/schema";
import {
  encrypt,
  decrypt,
  generateSipPassword,
  generateVoicemailPin,
} from "../lib/crypto";
import { recordAudit } from "../lib/audit";
import {
  cacheExtension,
  invalidateExtension,
  cacheRingGroups,
} from "../services/cache";
import { syncSubscriber, removeSubscriber } from "../services/kamailio-sync";
import {
  actionForMethod,
  requirePermission,
  requireTenant,
  type AppEnv,
} from "../middleware/tenant";

export const extensions = new Hono<AppEnv>();
extensions.use("*", requireTenant);
extensions.use("*", async (c, next) =>
  requirePermission("extension", actionForMethod(c.req.method))(c, next),
);

function present(row: typeof extension.$inferSelect) {
  const { sipPasswordEnc: _p, voicemailPinEnc: _v, ...safe } = row;
  return safe;
}

extensions.get("/", async (c) => {
  const rows = await db.query.extension.findMany({
    where: eq(extension.organizationId, c.get("organizationId")),
    orderBy: (t, { asc }) => [asc(t.number)],
  });
  return c.json(rows.map(present));
});

extensions.get("/:id", async (c) => {
  const row = await db.query.extension.findFirst({
    where: and(
      eq(extension.id, c.req.param("id")),
      eq(extension.organizationId, c.get("organizationId")),
    ),
  });
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(present(row));
});

extensions.post("/", async (c) => {
  const organizationId = c.get("organizationId");
  const body = await c.req.json<{
    number?: string;
    displayName?: string;
    sipPassword?: string;
    voicemailEnabled?: boolean;
    voicemailPin?: string;
    voicemailEmail?: string;
    callerIdName?: string;
    callerIdNumber?: string;
    codecPrefs?: string;
    maxConcurrentCalls?: number;
    deviceMac?: string;
  }>();

  const unsafe = unsafeDialplanFields(body);
  if (unsafe) return c.json({ error: unsafe }, 400);
  if (!body.number || !body.displayName) {
    return c.json({ error: "number and displayName are required" }, 400);
  }

  if (!/^[0-9]{1,15}$/.test(body.number))
    return c.json({ error: "number must be 1 to 15 digits" }, 400);
  if (
    body.sipPassword !== undefined &&
    (typeof body.sipPassword !== "string" || body.sipPassword.length < 12)
  )
    return c.json(
      { error: "sipPassword must have at least 12 characters" },
      400,
    );
  if (body.voicemailPin !== undefined && !/^\d{4,10}$/.test(body.voicemailPin))
    return c.json({ error: "voicemailPin must be 4 to 10 digits" }, 400);

  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
  if (!tenant) return c.json({ error: "Tenant is not provisioned" }, 409);

  const existing = await db.query.extension.findFirst({
    where: and(
      eq(extension.organizationId, organizationId),
      eq(extension.number, body.number),
    ),
  });
  if (existing)
    return c.json({ error: `Extension ${body.number} already exists` }, 409);

  const password = body.sipPassword ?? generateSipPassword();
  const pin = body.voicemailPin ?? generateVoicemailPin();

  const [row] = await db
    .insert(extension)
    .values({
      id: randomUUID(),
      organizationId,
      number: body.number,
      displayName: body.displayName,
      sipPasswordEnc: encrypt(password),
      voicemailPinEnc: encrypt(pin),
      voicemailEnabled: body.voicemailEnabled ?? true,
      voicemailEmail: body.voicemailEmail ?? null,
      callerIdName: body.callerIdName ?? null,
      callerIdNumber: body.callerIdNumber ?? null,
      codecPrefs: body.codecPrefs ?? null,
      maxConcurrentCalls: body.maxConcurrentCalls ?? null,
      deviceMac: body.deviceMac ?? null,
    })
    .returning();

  if (!row) return c.json({ error: "Insert failed" }, 500);

  await syncSubscriber(row, tenant.sipDomain, password);
  await cacheExtension(row.id);
  await recordAudit(c, {
    action: "create",
    entityType: "extension",
    entityId: row.id,
    after: row,
  });

  return c.json(
    { ...present(row), sipPassword: password, voicemailPin: pin },
    201,
  );
});

extensions.patch("/:id", async (c) => {
  const organizationId = c.get("organizationId");
  const id = c.req.param("id");

  const before = await db.query.extension.findFirst({
    where: and(
      eq(extension.id, id),
      eq(extension.organizationId, organizationId),
    ),
  });
  if (!before) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<
    Partial<{
      displayName: string;
      sipPassword: string;
      voicemailEnabled: boolean;
      voicemailPin: string;
      voicemailEmail: string | null;
      dnd: boolean;
      forwardAllTo: string | null;
      forwardBusyTo: string | null;
      forwardNoAnswerTo: string | null;
      ringTimeoutSec: number | null;
      callWaitingEnabled: boolean;
      callerIdName: string | null;
      callerIdNumber: string | null;
      codecPrefs: string | null;
      maxConcurrentCalls: number | null;
      directoryCacheMs: number | null;
      deviceMac: string | null;
      enabled: boolean;
    }>
  >();

  const unsafe = unsafeDialplanFields(body);
  if (unsafe) return c.json({ error: unsafe }, 400);
  if ("number" in body)
    return c.json({ error: "Extension numbers are immutable" }, 400);
  if (
    body.sipPassword !== undefined &&
    (typeof body.sipPassword !== "string" || body.sipPassword.length < 12)
  )
    return c.json(
      { error: "sipPassword must have at least 12 characters" },
      400,
    );
  if (body.enabled !== undefined && typeof body.enabled !== "boolean")
    return c.json({ error: "enabled must be boolean" }, 400);
  const patch: Partial<typeof extension.$inferInsert> = {};
  if (body.displayName !== undefined) patch.displayName = body.displayName;
  if (body.voicemailEnabled !== undefined)
    patch.voicemailEnabled = body.voicemailEnabled;
  if (body.voicemailEmail !== undefined)
    patch.voicemailEmail = body.voicemailEmail;
  if (body.dnd !== undefined) patch.dnd = body.dnd;
  if (body.ringTimeoutSec !== undefined)
    patch.ringTimeoutSec = body.ringTimeoutSec;
  if (body.callWaitingEnabled !== undefined)
    patch.callWaitingEnabled = body.callWaitingEnabled;

  for (const field of [
    "forwardAllTo",
    "forwardBusyTo",
    "forwardNoAnswerTo",
  ] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (value === null || value === "") {
      patch[field] = null;
    } else if (/^[0-9*#+]{1,32}$/.test(value)) {
      patch[field] = value;
    } else {
      return c.json({ error: `${field} must be diallable digits` }, 400);
    }
  }
  if (body.callerIdName !== undefined) patch.callerIdName = body.callerIdName;
  if (body.callerIdNumber !== undefined)
    patch.callerIdNumber = body.callerIdNumber;
  if (body.codecPrefs !== undefined) patch.codecPrefs = body.codecPrefs;
  if (body.maxConcurrentCalls !== undefined)
    patch.maxConcurrentCalls = body.maxConcurrentCalls;
  if (body.directoryCacheMs !== undefined)
    patch.directoryCacheMs = body.directoryCacheMs;
  if (body.deviceMac !== undefined) patch.deviceMac = body.deviceMac;
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.sipPassword !== undefined)
    patch.sipPasswordEnc = encrypt(body.sipPassword);

  let newPin: string | undefined;
  if (body.voicemailPin !== undefined) {
    if (body.voicemailPin !== "" && !/^\d{4,10}$/.test(body.voicemailPin)) {
      return c.json({ error: "voicemailPin must be 4 to 10 digits" }, 400);
    }
    newPin =
      body.voicemailPin === "" ? generateVoicemailPin() : body.voicemailPin;
    patch.voicemailPinEnc = encrypt(newPin);
  }

  const [row] = await db
    .update(extension)
    .set(patch)
    .where(
      and(eq(extension.id, id), eq(extension.organizationId, organizationId)),
    )
    .returning();
  if (!row) return c.json({ error: "Update failed" }, 500);

  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
  if (tenant) {
    if (!row.enabled) {
      await removeSubscriber(row.number, tenant.sipDomain);
    } else {
      await syncSubscriber(row, tenant.sipDomain, decrypt(row.sipPasswordEnc));
    }
    await cacheExtension(row.id);
    await cacheRingGroups(organizationId);
  }
  await recordAudit(c, {
    action: "update",
    entityType: "extension",
    entityId: id,
    before,
    after: row,
  });

  return c.json(
    newPin ? { ...present(row), voicemailPin: newPin } : present(row),
  );
});

extensions.delete("/:id", async (c) => {
  const organizationId = c.get("organizationId");
  const id = c.req.param("id");

  const before = await db.query.extension.findFirst({
    where: and(
      eq(extension.id, id),
      eq(extension.organizationId, organizationId),
    ),
  });
  if (!before) return c.json({ error: "Not found" }, 404);

  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });

  await db
    .delete(extension)
    .where(
      and(eq(extension.id, id), eq(extension.organizationId, organizationId)),
    );

  if (tenant) {
    await removeSubscriber(before.number, tenant.sipDomain);
    await invalidateExtension(organizationId, before.number, tenant.sipDomain);
    await cacheRingGroups(organizationId);
  }
  await recordAudit(c, {
    action: "delete",
    entityType: "extension",
    entityId: id,
    before,
  });

  return c.body(null, 204);
});
