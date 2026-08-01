import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  extension,
  queue,
  inboundRoute,
  ivrMenu,
  ivrOption,
  outboundRoute,
  ringGroup,
  ringGroupMember,
  timeCondition,
  trunk,
} from "../db/schema";
import { crudRoutes, tenantOwns } from "../lib/crud";
import { recordAudit } from "../lib/audit";
import { encrypt } from "../lib/crypto";
import {
  cacheInboundRoutes,
  cacheRouteTable,
  rebuildTenant,
} from "../services/cache";
import {
  reloadKamailio,
  removeTrunkAddress,
  syncTrunkAddress,
} from "../services/kamailio-sync";
import {
  requirePermission,
  requireTenant,
  type AppEnv,
} from "../middleware/tenant";

async function badDestination(
  type: unknown,
  id: unknown,
  organizationId: string,
  prevType?: unknown,
  prevId?: unknown,
): Promise<string | null> {
  const effectiveType = type !== undefined ? type : prevType;
  const effectiveId = id !== undefined ? id : prevId;

  if (effectiveType === undefined || effectiveType === null) {
    if (
      effectiveId !== undefined &&
      effectiveId !== null &&
      effectiveId !== ""
    ) {
      return "destinationType is required when destinationId is set";
    }
    return null;
  }

  if (
    effectiveType === "external" ||
    effectiveType === "hangup" ||
    effectiveType === "voicemail" ||
    effectiveType === "fax"
  ) {
    return null;
  }
  if (effectiveId === undefined || effectiveId === null || effectiveId === "") {
    return `destinationId is required when destinationType is ${String(effectiveType)}`;
  }

  const type_ = effectiveType;
  const id_ = effectiveId;

  const owned = await (async () => {
    switch (type_) {
      case "extension":
        return tenantOwns(
          extension,
          extension.organizationId,
          extension.id,
          id_,
          organizationId,
        );
      case "ring_group":
        return tenantOwns(
          ringGroup,
          ringGroup.organizationId,
          ringGroup.id,
          id_,
          organizationId,
        );
      case "ivr":
        return tenantOwns(
          ivrMenu,
          ivrMenu.organizationId,
          ivrMenu.id,
          id_,
          organizationId,
        );
      case "time_condition":
        return tenantOwns(
          timeCondition,
          timeCondition.organizationId,
          timeCondition.id,
          id_,
          organizationId,
        );
      case "queue":
        return tenantOwns(
          queue,
          queue.organizationId,
          queue.id,
          id_,
          organizationId,
        );
      default:
        return false;
    }
  })();

  return owned
    ? null
    : `destination ${String(type_)}/${String(id_)} does not belong to this tenant`;
}

export const trunks = crudRoutes({
  table: trunk,
  orgColumn: trunk.organizationId,
  idColumn: trunk.id,
  entityType: "trunk",
  permission: "trunk",
  required: ["name", "host"],
  writable: [
    "name",
    "authMode",
    "host",
    "port",
    "transport",
    "username",
    "fromDomain",
    "codecPrefs",
    "priority",
    "carrierSigns",
    "enabled",
  ],
  present: ({ passwordEnc: _p, ...rest }) => rest,
  validate: async (body) => {
    if (body.authMode === "register" && !body.username) {
      return "username is required when authMode is register";
    }
    return null;
  },
  afterChange: async (organizationId, row, action) => {
    if (action === "delete") {
      await removeTrunkAddress(row.id as string);
    } else if (row.authMode === "ip") {
      await syncTrunkAddress(row as never);
    }
    await reloadKamailio();
    await cacheRouteTable(organizationId);
  },
});

const trunkSecrets = new Hono<AppEnv>();
trunkSecrets.use("*", requireTenant);
trunkSecrets.use("*", requirePermission("trunk", "update"));
trunkSecrets.put("/:id/password", async (c) => {
  const { password } = await c.req.json<{ password?: string }>();
  if (!password) return c.json({ error: "password is required" }, 400);

  const [row] = await db
    .update(trunk)
    .set({ passwordEnc: encrypt(password) })
    .where(
      and(
        eq(trunk.id, c.req.param("id")),
        eq(trunk.organizationId, c.get("organizationId")),
      ),
    )
    .returning();
  if (!row) return c.json({ error: "Not found" }, 404);

  await recordAudit(c, {
    action: "rotate-password",
    entityType: "trunk",
    entityId: row.id,
    after: { name: row.name, host: row.host, passwordRotated: true },
  });

  return c.json({ status: "updated" });
});
trunks.route("/", trunkSecrets);

export const inboundRoutes = crudRoutes({
  table: inboundRoute,
  orgColumn: inboundRoute.organizationId,
  idColumn: inboundRoute.id,
  entityType: "inbound_route",
  permission: "route",
  required: ["didPattern", "destinationType"],
  writable: [
    "didPattern",
    "description",
    "destinationType",
    "destinationId",
    "priority",
    "enabled",
  ],
  validate: async (body, organizationId, existing) =>
    badDestination(
      body.destinationType,
      body.destinationId,
      organizationId,
      existing?.destinationType,
      existing?.destinationId,
    ),
  afterChange: async (organizationId) => {
    await cacheInboundRoutes(organizationId);
  },
});

export const outboundRoutes = crudRoutes({
  table: outboundRoute,
  orgColumn: outboundRoute.organizationId,
  idColumn: outboundRoute.id,
  entityType: "outbound_route",
  permission: "route",
  required: ["name", "pattern"],
  writable: [
    "name",
    "pattern",
    "trunkId",
    "stripDigits",
    "prependDigits",
    "callerIdOverride",
    "priority",
    "isEmergency",
    "enabled",
  ],
  validate: async (body, organizationId, existing) => {
    if (body.trunkId !== undefined && body.trunkId !== null) {
      const owned = await tenantOwns(
        trunk,
        trunk.organizationId,
        trunk.id,
        body.trunkId,
        organizationId,
      );
      if (!owned) return "trunkId does not belong to this tenant";
    }
    if (typeof body.pattern === "string") {
      try {
        new RegExp(body.pattern);
      } catch {
        return `pattern is not a valid regular expression: ${body.pattern}`;
      }
    }
    const effectiveTrunk =
      body.trunkId !== undefined ? body.trunkId : existing?.trunkId;
    const effectiveEmergency =
      body.isEmergency !== undefined ? body.isEmergency : existing?.isEmergency;
    if (effectiveEmergency === true && !effectiveTrunk) {
      return "an emergency route must have a trunk - it is the one route that must always work";
    }
    return null;
  },
  afterChange: async (organizationId) => {
    await cacheRouteTable(organizationId);
  },
});

export const ringGroups = crudRoutes({
  table: ringGroup,
  orgColumn: ringGroup.organizationId,
  idColumn: ringGroup.id,
  entityType: "ring_group",
  permission: "callflow",
  required: ["number", "name"],
  writable: [
    "number",
    "name",
    "strategy",
    "ringTimeoutSec",
    "failoverType",
    "failoverId",
    "enabled",
  ],
  validate: async (body, organizationId, existing) =>
    badDestination(
      body.failoverType,
      body.failoverId,
      organizationId,
      existing?.failoverType,
      existing?.failoverId,
    ),
  afterChange: async (organizationId) => {
    await rebuildTenant(organizationId);
  },
});

const ringGroupMembers = new Hono<AppEnv>();
ringGroupMembers.use("*", requireTenant);
ringGroupMembers.use("*", async (c, next) =>
  requirePermission("callflow", c.req.method === "GET" ? "read" : "update")(
    c,
    next,
  ),
);

ringGroupMembers.get("/:id/members", async (c) => {
  const rows = await db
    .select({
      id: ringGroupMember.id,
      extensionId: ringGroupMember.extensionId,
      number: extension.number,
      displayName: extension.displayName,
      position: ringGroupMember.position,
      delaySec: ringGroupMember.delaySec,
    })
    .from(ringGroupMember)
    .innerJoin(extension, eq(ringGroupMember.extensionId, extension.id))
    .innerJoin(ringGroup, eq(ringGroupMember.ringGroupId, ringGroup.id))
    .where(
      and(
        eq(ringGroupMember.ringGroupId, c.req.param("id")),
        eq(ringGroup.organizationId, c.get("organizationId")),
      ),
    );
  return c.json(rows);
});

ringGroupMembers.post("/:id/members", async (c) => {
  const organizationId = c.get("organizationId");
  const groupId = c.req.param("id");
  const body = await c.req.json<{
    extensionId?: string;
    position?: number;
    delaySec?: number;
  }>();
  if (!body.extensionId)
    return c.json({ error: "extensionId is required" }, 400);

  const [group] = await db
    .select()
    .from(ringGroup)
    .where(
      and(
        eq(ringGroup.id, groupId),
        eq(ringGroup.organizationId, organizationId),
      ),
    );
  if (!group) return c.json({ error: "Ring group not found" }, 404);

  const [ext] = await db
    .select()
    .from(extension)
    .where(
      and(
        eq(extension.id, body.extensionId),
        eq(extension.organizationId, organizationId),
      ),
    );
  if (!ext) return c.json({ error: "Extension not found" }, 404);

  const [row] = await db
    .insert(ringGroupMember)
    .values({
      id: crypto.randomUUID(),
      ringGroupId: groupId,
      extensionId: body.extensionId,
      position: body.position ?? 0,
      delaySec: body.delaySec ?? 0,
    })
    .onConflictDoNothing()
    .returning();

  await rebuildTenant(organizationId);
  return c.json(row ?? { status: "already a member" }, row ? 201 : 200);
});

ringGroupMembers.delete("/:id/members/:memberId", async (c) => {
  const [group] = await db
    .select()
    .from(ringGroup)
    .where(
      and(
        eq(ringGroup.id, c.req.param("id")),
        eq(ringGroup.organizationId, c.get("organizationId")),
      ),
    );
  if (!group) return c.json({ error: "Ring group not found" }, 404);

  const removed = await db
    .delete(ringGroupMember)
    .where(
      and(
        eq(ringGroupMember.id, c.req.param("memberId")),
        eq(ringGroupMember.ringGroupId, group.id),
      ),
    )
    .returning();
  if (removed.length === 0)
    return c.json({ error: "Member not found in this group" }, 404);

  await rebuildTenant(c.get("organizationId"));
  return c.body(null, 204);
});
ringGroups.route("/", ringGroupMembers);

export const ivrMenus = crudRoutes({
  table: ivrMenu,
  orgColumn: ivrMenu.organizationId,
  idColumn: ivrMenu.id,
  entityType: "ivr_menu",
  permission: "callflow",
  required: ["number", "name"],
  writable: [
    "number",
    "name",
    "greetingSound",
    "invalidSound",
    "timeoutSec",
    "maxRetries",
    "timeoutType",
    "timeoutId",
    "enabled",
  ],
  validate: async (body, organizationId, existing) =>
    badDestination(
      body.timeoutType,
      body.timeoutId,
      organizationId,
      existing?.timeoutType,
      existing?.timeoutId,
    ),
  afterChange: async (organizationId) => {
    await rebuildTenant(organizationId);
  },
});

const ivrOptions = new Hono<AppEnv>();
ivrOptions.use("*", requireTenant);
ivrOptions.use("*", async (c, next) =>
  requirePermission("callflow", c.req.method === "GET" ? "read" : "update")(
    c,
    next,
  ),
);

ivrOptions.get("/:id/options", async (c) => {
  const [menu] = await db
    .select()
    .from(ivrMenu)
    .where(
      and(
        eq(ivrMenu.id, c.req.param("id")),
        eq(ivrMenu.organizationId, c.get("organizationId")),
      ),
    );
  if (!menu) return c.json({ error: "Not found" }, 404);
  const rows = await db
    .select()
    .from(ivrOption)
    .where(eq(ivrOption.ivrMenuId, menu.id));
  return c.json(rows);
});

ivrOptions.put("/:id/options/:digit", async (c) => {
  const [menu] = await db
    .select()
    .from(ivrMenu)
    .where(
      and(
        eq(ivrMenu.id, c.req.param("id")),
        eq(ivrMenu.organizationId, c.get("organizationId")),
      ),
    );
  if (!menu) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{
    destinationType?: string;
    destinationId?: string;
    description?: string;
  }>();
  if (!body.destinationType)
    return c.json({ error: "destinationType is required" }, 400);

  const problem = await badDestination(
    body.destinationType,
    body.destinationId,
    c.get("organizationId"),
  );
  if (problem) return c.json({ error: problem }, 400);

  const [row] = await db
    .insert(ivrOption)
    .values({
      id: crypto.randomUUID(),
      ivrMenuId: menu.id,
      digit: c.req.param("digit"),
      destinationType: body.destinationType as never,
      destinationId: body.destinationId ?? null,
      description: body.description ?? null,
    })
    .onConflictDoUpdate({
      target: [ivrOption.ivrMenuId, ivrOption.digit],
      set: {
        destinationType: body.destinationType as never,
        destinationId: body.destinationId ?? null,
        description: body.description ?? null,
      },
    })
    .returning();

  await rebuildTenant(c.get("organizationId"));
  return c.json(row);
});

ivrOptions.delete("/:id/options/:digit", async (c) => {
  const [menu] = await db
    .select()
    .from(ivrMenu)
    .where(
      and(
        eq(ivrMenu.id, c.req.param("id")),
        eq(ivrMenu.organizationId, c.get("organizationId")),
      ),
    );
  if (!menu) return c.json({ error: "Not found" }, 404);

  await db
    .delete(ivrOption)
    .where(
      and(
        eq(ivrOption.ivrMenuId, menu.id),
        eq(ivrOption.digit, c.req.param("digit")),
      ),
    );
  await rebuildTenant(c.get("organizationId"));
  return c.body(null, 204);
});
ivrMenus.route("/", ivrOptions);

export const timeConditions = crudRoutes({
  table: timeCondition,
  orgColumn: timeCondition.organizationId,
  idColumn: timeCondition.id,
  entityType: "time_condition",
  permission: "callflow",
  required: ["name", "rules"],
  writable: [
    "name",
    "timezone",
    "rules",
    "matchType",
    "matchId",
    "noMatchType",
    "noMatchId",
    "enabled",
  ],
  validate: async (body, organizationId, existing) => {
    const matchProblem = await badDestination(
      body.matchType,
      body.matchId,
      organizationId,
      existing?.matchType,
      existing?.matchId,
    );
    if (matchProblem) return matchProblem;
    const noMatchProblem = await badDestination(
      body.noMatchType,
      body.noMatchId,
      organizationId,
      existing?.noMatchType,
      existing?.noMatchId,
    );
    if (noMatchProblem) return noMatchProblem;

    if (body.rules !== undefined) {
      if (!Array.isArray(body.rules)) return "rules must be an array";
      for (const rule of body.rules as Record<string, unknown>[]) {
        if (rule.days !== undefined && !Array.isArray(rule.days)) {
          return "rule.days must be an array of weekday numbers";
        }
        for (const field of ["start", "end"]) {
          const v = rule[field];
          if (v !== undefined && !/^\d{2}:\d{2}$/.test(String(v))) {
            return `rule.${field} must be HH:MM`;
          }
        }
      }
    }
    return null;
  },
  afterChange: async (organizationId) => {
    await rebuildTenant(organizationId);
  },
});
