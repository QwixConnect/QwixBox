import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { db } from "../db";
import { auditLog } from "../db/schema";
import type { AppEnv } from "../middleware/tenant";

type AuditInput = {
  action: "create" | "update" | "delete" | string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  actor?: string;
  organizationId?: string;
};

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {
    ...(value as Record<string, unknown>),
  };
  for (const key of Object.keys(out)) {
    if (/passwordEnc|PinEnc|password|secret|ha1/i.test(key)) {
      out[key] = "[redacted]";
    }
  }
  return out;
}

export async function recordAudit(
  c: Context<AppEnv> | Context,
  input: AuditInput,
): Promise<void> {
  try {
    const vars = c as Context<AppEnv>;
    const organizationId = input.organizationId ?? vars.get("organizationId");
    const userId = input.actor ? null : (vars.get("userId") ?? null);

    await db.insert(auditLog).values({
      id: randomUUID(),
      organizationId: organizationId ?? null,
      userId,
      action: input.actor ? `${input.action} (${input.actor})` : input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: redact(input.before) ?? null,
      after: redact(input.after) ?? null,
      ipAddress: c.req.header("x-real-ip") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
  } catch (err) {
    console.error("[audit] failed to record:", (err as Error).message);
  }
}
