import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { extension, tenantSettings } from "../db/schema";
import { cacheExtension } from "../services/cache";
import { recordAudit } from "../lib/audit";
import { safeEqual } from "../lib/crypto";

export const fsFeature = new Hono();

fsFeature.use("*", async (c, next) => {
  const expected = process.env.FS_XML_GATEWAY_SECRET;
  if (!expected) return c.json({ ok: false, error: "not configured" }, 500);

  const direct = c.req.header("X-Gateway-Secret");
  if (direct && safeEqual(direct, expected)) return next();

  const header = c.req.header("Authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded)
    return c.json({ ok: false, error: "unauthorized" }, 401);

  const [, password] = Buffer.from(encoded, "base64")
    .toString("utf8")
    .split(":");
  if (!password || !safeEqual(password, expected)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  await next();
});

const WRITABLE = [
  "dnd",
  "forwardAllTo",
  "forwardBusyTo",
  "forwardNoAnswerTo",
] as const;
type Writable = (typeof WRITABLE)[number];

const DIALLABLE = /^[0-9*#+]{1,32}$/;

fsFeature.post("/", async (c) => {
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  const domain = typeof body.domain === "string" ? body.domain : "";
  const number = typeof body.number === "string" ? body.number : "";
  if (!domain || !number)
    return c.json({ ok: false, error: "domain and number required" }, 400);

  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.sipDomain, domain),
  });
  if (!tenant) return c.json({ ok: false, error: "unknown domain" }, 404);

  const before = await db.query.extension.findFirst({
    where: and(
      eq(extension.organizationId, tenant.organizationId),
      eq(extension.number, number),
    ),
  });
  if (!before) return c.json({ ok: false, error: "unknown extension" }, 404);

  const patch: Partial<typeof extension.$inferInsert> = {};
  for (const field of WRITABLE) {
    if (!(field in body)) continue;
    const value = body[field as Writable];

    if (field === "dnd") {
      if (typeof value !== "boolean")
        return c.json({ ok: false, error: "dnd must be boolean" }, 400);
      patch.dnd = value;
      continue;
    }

    if (value === null) {
      patch[field] = null;
    } else if (typeof value === "string" && DIALLABLE.test(value)) {
      patch[field] = value;
    } else {
      return c.json(
        { ok: false, error: `${field} must be diallable digits or null` },
        400,
      );
    }
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ ok: false, error: "nothing to change" }, 400);
  }

  const [row] = await db
    .update(extension)
    .set(patch)
    .where(eq(extension.id, before.id))
    .returning();
  if (!row) return c.json({ ok: false, error: "update failed" }, 500);

  await cacheExtension(row.id);

  await recordAudit(c, {
    action: "update",
    entityType: "extension",
    entityId: row.id,
    before,
    after: row,
    actor: `feature-code:${number}@${domain}`,
    organizationId: tenant.organizationId,
  });

  return c.json({ ok: true, applied: patch });
});
