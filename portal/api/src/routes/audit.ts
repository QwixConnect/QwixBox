/**
 * Audit log, read-only.
 *
 * Answers "who changed what" for a tenant. Feature-code changes land here with a null userId
 * and an actor string in the action field (see fs-feature.ts) — render that, not a blank who.
 */
import { Hono } from "hono";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, user } from "../db/schema";
import {
  requirePermission,
  requireTenant,
  type AppEnv,
} from "../middleware/tenant";

export const audit = new Hono<AppEnv>();
audit.use("*", requireTenant);
audit.use("*", requirePermission("audit", "read"));

const MAX_LIMIT = 200;

function parseDate(value: string | undefined): Date | null | "invalid" {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/**
 * Strip every key ending in `Enc` from before/after blobs.
 *
 * `recordAudit` already redacts on write, but older rows (or a missed pattern) could still
 * carry ciphertext. There is no reason to ship it to a browser.
 */
function redactEnc(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k.endsWith("Enc")) continue;
    out[k] = v;
  }
  return out;
}

audit.get("/", async (c) => {
  const organizationId = c.get("organizationId");
  const q = c.req.query();

  const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), MAX_LIMIT);
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0);

  const from = parseDate(q.from);
  const to = parseDate(q.to);
  if (from === "invalid" || to === "invalid") {
    return c.json({ error: "from and to must be parseable dates" }, 400);
  }

  // organizationId first and unconditionally — same isolation shape as cdr.ts.
  const filters = [eq(auditLog.organizationId, organizationId)];
  if (q.entityType) filters.push(eq(auditLog.entityType, q.entityType));
  if (q.action) filters.push(eq(auditLog.action, q.action));
  if (q.userId) filters.push(eq(auditLog.userId, q.userId));
  if (from) filters.push(gte(auditLog.createdAt, from));
  if (to) filters.push(lte(auditLog.createdAt, to));

  const where = and(...filters);

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
      userId: auditLog.userId,
      userEmail: user.email,
      ipAddress: auditLog.ipAddress,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.userId, user.id))
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  const [totals] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(auditLog)
    .where(where);

  return c.json({
    rows: rows.map((r) => ({
      ...r,
      before: redactEnc(r.before),
      after: redactEnc(r.after),
    })),
    total: totals?.total ?? 0,
    limit,
    offset,
  });
});
