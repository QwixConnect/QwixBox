import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  extension,
  ringGroup,
  ringGroupMember,
  ivrMenu,
  ivrOption,
  timeCondition,
  tenantSettings,
} from "../db/schema";

export async function destinationNumber(
  org: string,
  type: string | null,
  id: string | null,
) {
  if (type !== "extension" || !id) return id;
  const ext = await db.query.extension.findFirst({
    where: and(
      eq(extension.id, id),
      eq(extension.organizationId, org),
      eq(extension.enabled, true),
    ),
  });
  return ext?.number ?? null;
}

// Used when Redis is unavailable. Never accept an organization id supplied by a caller.
export async function callState(
  domain: string,
  kind: string,
  id: string,
): Promise<unknown> {
  const tenant = await db.query.tenantSettings.findFirst({
    where: and(
      eq(tenantSettings.sipDomain, domain),
      eq(tenantSettings.enabled, true),
    ),
  });
  if (!tenant) return null;
  const org = tenant.organizationId;
  if (kind === "call") {
    const ext = await db.query.extension.findFirst({
      where: and(
        eq(extension.organizationId, org),
        eq(extension.number, id),
        eq(extension.enabled, true),
      ),
    });
    if (!ext) return null;
    return {
      number: ext.number,
      displayName: ext.displayName,
      dnd: ext.dnd,
      forwardAllTo: ext.forwardAllTo,
      forwardBusyTo: ext.forwardBusyTo,
      forwardNoAnswerTo: ext.forwardNoAnswerTo,
      ringTimeoutSec: ext.ringTimeoutSec ?? tenant.defaultRingTimeoutSec,
      callWaitingEnabled: ext.callWaitingEnabled,
      voicemailEnabled: ext.voicemailEnabled,
    };
  }
  if (kind === "rg") {
    const group = await db.query.ringGroup.findFirst({
      where: and(
        eq(ringGroup.id, id),
        eq(ringGroup.organizationId, org),
        eq(ringGroup.enabled, true),
      ),
    });
    if (!group) return null;
    const members = await db
      .select({
        number: extension.number,
        position: ringGroupMember.position,
        delaySec: ringGroupMember.delaySec,
      })
      .from(ringGroupMember)
      .innerJoin(extension, eq(ringGroupMember.extensionId, extension.id))
      .where(
        and(
          eq(ringGroupMember.ringGroupId, id),
          eq(extension.organizationId, org),
          eq(extension.enabled, true),
        ),
      );
    return {
      ...group,
      failoverId: await destinationNumber(
        org,
        group.failoverType,
        group.failoverId,
      ),
      members: members.sort((a, b) => a.position - b.position),
    };
  }
  if (kind === "ivr") {
    const menu = await db.query.ivrMenu.findFirst({
      where: and(
        eq(ivrMenu.id, id),
        eq(ivrMenu.organizationId, org),
        eq(ivrMenu.enabled, true),
      ),
    });
    if (!menu) return null;
    const options = await db.query.ivrOption.findMany({
      where: eq(ivrOption.ivrMenuId, id),
    });
    return {
      ...menu,
      timeoutId: await destinationNumber(org, menu.timeoutType, menu.timeoutId),
      options: Object.fromEntries(
        await Promise.all(
          options.map(async (o) => [
            o.digit,
            {
              type: o.destinationType,
              id: await destinationNumber(
                org,
                o.destinationType,
                o.destinationId,
              ),
            },
          ]),
        ),
      ),
    };
  }
  if (kind === "tc") {
    const cond = await db.query.timeCondition.findFirst({
      where: and(
        eq(timeCondition.id, id),
        eq(timeCondition.organizationId, org),
        eq(timeCondition.enabled, true),
      ),
    });
    if (!cond) return null;
    return {
      ...cond,
      matchId: await destinationNumber(org, cond.matchType, cond.matchId),
      noMatchId: await destinationNumber(org, cond.noMatchType, cond.noMatchId),
    };
  }
  return null;
}
