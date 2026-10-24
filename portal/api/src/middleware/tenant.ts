import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { and, eq } from "drizzle-orm";
import { auth, ROLES, type RoleName } from "../auth";
import { db } from "../db";
import { member } from "../db/schema";

export type TenantVars = {
  userId: string;
  organizationId: string;
  role: string;
};

export type AppEnv = { Variables: TenantVars };

export const requireTenant = createMiddleware<AppEnv>(
  async (c: Context, next: Next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session?.user) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    const organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return c.json(
        {
          error: "No active organization",
          detail:
            "Select an organization with POST /api/auth/organization/set-active",
        },
        403,
      );
    }

    // Role comes from the member row, not the session: session.activeOrganizationRole does not
    // exist, and activeOrganizationId survives a revoked membership until the session expires.
    const [membership] = await db
      .select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.userId, session.user.id),
          eq(member.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!membership) {
      return c.json({ error: "Not a member of the active organization" }, 403);
    }

    c.set("userId", session.user.id);
    c.set("organizationId", organizationId);
    c.set("role", membership.role);

    await next();
  },
);

export function requireRole(...allowed: string[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const role = c.get("role");
    if (!allowed.includes(role)) {
      return c.json(
        { error: "Insufficient permissions", required: allowed, actual: role },
        403,
      );
    }
    await next();
  });
}

export function requirePermission(resource: string, ...actions: string[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const role = c.get("role");
    const definition = ROLES[role as RoleName];

    if (!definition) {
      return c.json({ error: "Unrecognised role", actual: role }, 403);
    }

    const decision = definition.authorize({ [resource]: actions });
    if (!decision.success) {
      return c.json(
        {
          error: "Insufficient permissions",
          required: `${resource}:${actions.join(",")}`,
          actual: role,
        },
        403,
      );
    }
    await next();
  });
}

export function actionForMethod(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD":
      return "read";
    case "POST":
      return "create";
    case "PUT":
    case "PATCH":
      return "update";
    case "DELETE":
      return "delete";
    default:
      return "unknown";
  }
}
