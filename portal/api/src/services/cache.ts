import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  extension,
  inboundRoute,
  ivrMenu,
  ivrOption,
  outboundRoute,
  ringGroup,
  ringGroupMember,
  tenantSettings,
  timeCondition,
  trunk,
} from "../db/schema";
import { decrypt } from "../lib/crypto";
import { esl } from "./esl";
import { keys, safeDel, safeDelPattern, safeSet } from "./redis";

function renderDirectoryUser(
  ext: typeof extension.$inferSelect,
  tenant: typeof tenantSettings.$inferSelect,
  password: string,
  voicemailPin: string | null,
): string {
  const cacheMs = ext.directoryCacheMs ?? tenant.directoryCacheMs;
  const codecs = ext.codecPrefs ?? "OPUS,G722,PCMU,PCMA";
  const callerName =
    ext.callerIdName ?? tenant.defaultCallerIdName ?? ext.displayName;
  const callerNumber =
    ext.callerIdNumber ?? tenant.defaultCallerIdNumber ?? ext.number;

  const vmPin = voicemailPin
    ? `<param name="vm-password" value="${escapeXml(voicemailPin)}"/>`
    : "";
  const vmEmail = ext.voicemailEmail
    ? `<param name="vm-email-all-messages" value="true"/>
    <param name="vm-attach-file" value="true"/>
    <param name="vm-keep-local-after-email" value="true"/>
    <param name="vm-mailto" value="${escapeXml(ext.voicemailEmail)}"/>`
    : "";

  return `<user id="${ext.number}" cacheable="${cacheMs}">
  <params>
    <param name="password" value="${escapeXml(password)}"/>
    <param name="vm-enabled" value="${ext.voicemailEnabled ? "true" : "false"}"/>
    ${vmPin}
    ${vmEmail}
  </params>
  <variables>
    <variable name="organization_id" value="${ext.organizationId}"/>
    <variable name="user_context" value="tenant_${tenant.organizationId}"/>
    <variable name="effective_caller_id_name" value="${escapeXml(callerName)}"/>
    <variable name="effective_caller_id_number" value="${escapeXml(callerNumber)}"/>
    <variable name="outbound_caller_id_name" value="${escapeXml(callerName)}"/>
    <variable name="outbound_caller_id_number" value="${escapeXml(callerNumber)}"/>
    <variable name="absolute_codec_string" value="${escapeXml(codecs)}"/>
    <variable name="max_concurrent" value="${ext.maxConcurrentCalls ?? tenant.maxConcurrentCalls}"/>
    <variable name="sip_h_X-Tenant-ID" value="${ext.organizationId}"/>
    <variable name="sip_h_X-Auth-User" value="${ext.number}"/>
  </variables>
</user>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function cacheExtension(extensionId: string): Promise<void> {
  const ext = await db.query.extension.findFirst({
    where: eq(extension.id, extensionId),
  });
  if (!ext) return;

  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, ext.organizationId),
  });
  if (!tenant) return;

  if (!ext.enabled) {
    await invalidateExtension(ext.organizationId, ext.number, tenant.sipDomain);
    return;
  }

  const password = decrypt(ext.sipPasswordEnc);
  const pin = ext.voicemailPinEnc ? decrypt(ext.voicemailPinEnc) : null;
  const xml = renderDirectoryUser(ext, tenant, password, pin);

  await safeSet(keys.directory(tenant.sipDomain, ext.number), xml);
  await safeSet(
    keys.extensionCall(tenant.sipDomain, ext.number),
    JSON.stringify({
      number: ext.number,
      displayName: ext.displayName,
      dnd: ext.dnd,
      forwardAllTo: ext.forwardAllTo,
      forwardBusyTo: ext.forwardBusyTo,
      forwardNoAnswerTo: ext.forwardNoAnswerTo,
      ringTimeoutSec: ext.ringTimeoutSec ?? tenant.defaultRingTimeoutSec,
      callWaitingEnabled: ext.callWaitingEnabled,
      voicemailEnabled: ext.voicemailEnabled,
    }),
  );
  await esl.flushXmlCache(ext.number, tenant.sipDomain);
}

export async function invalidateExtension(
  _organizationId: string,
  number: string,
  sipDomain: string,
): Promise<void> {
  await safeDel(
    keys.directory(sipDomain, number),
    keys.extensionCall(sipDomain, number),
  );
  await esl.flushXmlCache(number, sipDomain);
}

export type CachedRoute = {
  id: string;
  pattern: string;
  priority: number;
  isEmergency: boolean;
  stripDigits: number;
  prependDigits: string | null;
  callerIdOverride: string | null;
  trunk: {
    id: string;
    name: string;
    host: string;
    port: number;
    transport: string;
  } | null;
};

export async function cacheRouteTable(organizationId: string): Promise<void> {
  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
  if (!tenant) return;

  const rows = await db
    .select({
      route: outboundRoute,
      trunkRow: trunk,
    })
    .from(outboundRoute)
    .leftJoin(trunk, eq(outboundRoute.trunkId, trunk.id))
    .where(
      and(
        eq(outboundRoute.organizationId, organizationId),
        eq(outboundRoute.enabled, true),
      ),
    );

  const routes: CachedRoute[] = rows
    .map(({ route, trunkRow }) => ({
      id: route.id,
      pattern: route.pattern,
      priority: route.priority,
      isEmergency: route.isEmergency,
      stripDigits: route.stripDigits,
      prependDigits: route.prependDigits,
      callerIdOverride: route.callerIdOverride,
      trunk: trunkRow
        ? {
            id: trunkRow.id,
            name: trunkRow.name,
            host: trunkRow.host,
            port: trunkRow.port,
            transport: trunkRow.transport,
          }
        : null,
    }))
    .sort((a, b) => {
      if (a.isEmergency !== b.isEmergency) return a.isEmergency ? -1 : 1;
      return a.priority - b.priority;
    });

  await safeSet(keys.routes(tenant.sipDomain), JSON.stringify(routes));
}

export async function cacheInboundRoutes(
  organizationId: string,
): Promise<void> {
  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
  if (!tenant) return;

  const rows = await db.query.inboundRoute.findMany({
    where: and(
      eq(inboundRoute.organizationId, organizationId),
      eq(inboundRoute.enabled, true),
    ),
  });

  await Promise.all(
    rows.map(async (r) =>
      safeSet(
        keys.did(tenant.sipDomain, r.didPattern),
        JSON.stringify({
          destinationType: r.destinationType,
          destinationId: await resolveDestinationId(
            r.destinationType,
            r.destinationId,
          ),
        }),
      ),
    ),
  );
}

export async function cacheTenantSettings(
  organizationId: string,
): Promise<void> {
  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
  if (!tenant) return;

  await safeSet(
    keys.tenant(tenant.sipDomain),
    JSON.stringify({
      organizationId: tenant.organizationId,
      sipDomain: tenant.sipDomain,
      tier: tenant.tier,
      dispatcherSetId: tenant.dispatcherSetId,
      egressMode: tenant.egressMode,
      maxConcurrentCalls: tenant.maxConcurrentCalls,
      recordingPolicy: tenant.recordingPolicy,
      timezone: tenant.timezone,
      enabled: tenant.enabled,
    }),
  );
}

async function resolveDestinationId(
  type: string | null,
  id: string | null,
): Promise<string | null> {
  if (type !== "extension" || !id) return id;

  const target = await db.query.extension.findFirst({
    where: eq(extension.id, id),
  });
  if (target) return target.number;

  return id;
}

export async function cacheRingGroups(organizationId: string): Promise<void> {
  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
  if (!tenant) return;

  const groups = await db.query.ringGroup.findMany({
    where: and(
      eq(ringGroup.organizationId, organizationId),
      eq(ringGroup.enabled, true),
    ),
  });

  for (const group of groups) {
    const members = await db
      .select({
        number: extension.number,
        position: ringGroupMember.position,
        delaySec: ringGroupMember.delaySec,
        enabled: extension.enabled,
      })
      .from(ringGroupMember)
      .innerJoin(extension, eq(ringGroupMember.extensionId, extension.id))
      .where(eq(ringGroupMember.ringGroupId, group.id));

    await safeSet(
      keys.ringGroup(tenant.sipDomain, group.id),
      JSON.stringify({
        id: group.id,
        number: group.number,
        name: group.name,
        strategy: group.strategy,
        ringTimeoutSec: group.ringTimeoutSec,
        failoverType: group.failoverType,
        failoverId: await resolveDestinationId(
          group.failoverType,
          group.failoverId,
        ),
        members: members
          .filter((m) => m.enabled)
          .sort((a, b) => a.position - b.position)
          .map((m) => ({ number: m.number, delaySec: m.delaySec })),
      }),
    );

    await cacheFeatureNumber(
      tenant.sipDomain,
      group.number,
      "ring_group",
      group.id,
    );
  }
}

async function cacheFeatureNumber(
  domain: string,
  number: string | null,
  type: string,
  id: string,
): Promise<void> {
  if (!number) return;
  await safeSet(
    keys.featureNumber(domain, number),
    JSON.stringify({ type, id }),
  );
}

export async function cacheIvrMenus(organizationId: string): Promise<void> {
  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
  if (!tenant) return;

  const menus = await db.query.ivrMenu.findMany({
    where: and(
      eq(ivrMenu.organizationId, organizationId),
      eq(ivrMenu.enabled, true),
    ),
  });

  for (const menu of menus) {
    const options = await db.query.ivrOption.findMany({
      where: eq(ivrOption.ivrMenuId, menu.id),
    });
    await safeSet(
      keys.ivr(tenant.sipDomain, menu.id),
      JSON.stringify({
        id: menu.id,
        number: menu.number,
        name: menu.name,
        greetingSound: menu.greetingSound,
        invalidSound: menu.invalidSound,
        timeoutSec: menu.timeoutSec,
        maxRetries: menu.maxRetries,
        timeoutType: menu.timeoutType,
        timeoutId: await resolveDestinationId(menu.timeoutType, menu.timeoutId),
        options: Object.fromEntries(
          await Promise.all(
            options.map(async (o) => [
              o.digit,
              {
                type: o.destinationType,
                id: await resolveDestinationId(
                  o.destinationType,
                  o.destinationId,
                ),
              },
            ]),
          ),
        ),
      }),
    );

    await cacheFeatureNumber(tenant.sipDomain, menu.number, "ivr", menu.id);
  }
}

export async function cacheTimeConditions(
  organizationId: string,
): Promise<void> {
  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
  if (!tenant) return;

  const conditions = await db.query.timeCondition.findMany({
    where: and(
      eq(timeCondition.organizationId, organizationId),
      eq(timeCondition.enabled, true),
    ),
  });

  for (const cond of conditions) {
    await safeSet(
      keys.timeCondition(tenant.sipDomain, cond.id),
      JSON.stringify({
        id: cond.id,
        name: cond.name,
        timezone: cond.timezone,
        rules: cond.rules,
        matchType: cond.matchType,
        matchId: await resolveDestinationId(cond.matchType, cond.matchId),
        noMatchType: cond.noMatchType,
        noMatchId: await resolveDestinationId(cond.noMatchType, cond.noMatchId),
      }),
    );
  }
}

export async function rebuildTenant(organizationId: string): Promise<void> {
  const existing = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
  if (existing) {
    for (const pattern of keys.tenantPatterns(existing.sipDomain)) {
      await safeDelPattern(pattern);
    }
  }

  await cacheTenantSettings(organizationId);
  await cacheRouteTable(organizationId);
  await cacheInboundRoutes(organizationId);
  await cacheRingGroups(organizationId);
  await cacheIvrMenus(organizationId);
  await cacheTimeConditions(organizationId);

  const extensions = await db.query.extension.findMany({
    where: eq(extension.organizationId, organizationId),
  });
  for (const ext of extensions) {
    await cacheExtension(ext.id);
  }
}
