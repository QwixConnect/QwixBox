import { callState, destinationNumber, extensionCallState } from "./call-state";
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
import { keys, publishGeneration } from "./redis";

export function renderDirectoryUser(
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

  return `<user id="${escapeXml(ext.number)}" cacheable="${cacheMs}">
  <params>
    <param name="password" value="${escapeXml(password)}"/>
    <param name="vm-enabled" value="${ext.voicemailEnabled ? "true" : "false"}"/>
    ${vmPin}
    ${vmEmail}
  </params>
  <variables>
    <variable name="organization_id" value="${escapeXml(ext.organizationId)}"/>
    <variable name="user_context" value="tenant_${escapeXml(tenant.organizationId)}"/>
    <variable name="effective_caller_id_name" value="${escapeXml(callerName)}"/>
    <variable name="effective_caller_id_number" value="${escapeXml(callerNumber)}"/>
    <variable name="outbound_caller_id_name" value="${escapeXml(callerName)}"/>
    <variable name="outbound_caller_id_number" value="${escapeXml(callerNumber)}"/>
    <variable name="absolute_codec_string" value="${escapeXml(codecs)}"/>
    <variable name="max_concurrent" value="${ext.maxConcurrentCalls ?? tenant.maxConcurrentCalls}"/>
    <variable name="sip_h_X-Tenant-ID" value="${escapeXml(ext.organizationId)}"/>
    <variable name="sip_h_X-Auth-User" value="${escapeXml(ext.number)}"/>
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

type Tenant = typeof tenantSettings.$inferSelect;
type Extension = typeof extension.$inferSelect;

/**
 * One publication's keys and values, built completely in memory before anything is written
 * (R13). A section is published with publishGeneration(), which swaps it in atomically and
 * deletes keys of that section the new generation no longer has. If building fails part way,
 * nothing has been written and the previous generation stays live.
 *
 * Publishers must hold the tenant's projection lock; see withTenantLock() in projections.ts.
 */
type Generation = Map<string, string>;

async function tenantFor(organizationId: string): Promise<Tenant | undefined> {
  return db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
}

function extensionKeys(sipDomain: string, number: string): string[] {
  return [
    keys.directory(sipDomain, number),
    keys.extensionCall(sipDomain, number),
  ];
}

function buildExtension(gen: Generation, tenant: Tenant, ext: Extension): void {
  // A disabled extension contributes nothing, so publishing removes its keys.
  if (!ext.enabled) return;
  const password = decrypt(ext.sipPasswordEnc);
  const pin = ext.voicemailPinEnc ? decrypt(ext.voicemailPinEnc) : null;
  gen.set(
    keys.directory(tenant.sipDomain, ext.number),
    renderDirectoryUser(ext, tenant, password, pin),
  );
  gen.set(
    keys.extensionCall(tenant.sipDomain, ext.number),
    JSON.stringify(extensionCallState(ext, tenant)),
  );
}

export async function cacheExtension(extensionId: string): Promise<void> {
  const ext = await db.query.extension.findFirst({
    where: eq(extension.id, extensionId),
  });
  if (!ext) return;
  const tenant = await tenantFor(ext.organizationId);
  if (!tenant) return;

  const gen: Generation = new Map();
  buildExtension(gen, tenant, ext);
  await publishGeneration([], extensionKeys(tenant.sipDomain, ext.number), gen);
  await esl.flushXmlCache(ext.number, tenant.sipDomain);
}

export async function invalidateExtension(
  _organizationId: string,
  number: string,
  sipDomain: string,
): Promise<void> {
  await publishGeneration([], extensionKeys(sipDomain, number), new Map());
  await esl.flushXmlCache(number, sipDomain);
}

export type CachedRoute = {
  id: string;
  pattern: string;
  patternSyntax: string;
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

async function buildRouteTable(gen: Generation, tenant: Tenant): Promise<void> {
  const rows = await db
    .select({
      route: outboundRoute,
      trunkRow: trunk,
    })
    .from(outboundRoute)
    .leftJoin(trunk, eq(outboundRoute.trunkId, trunk.id))
    .where(
      and(
        eq(outboundRoute.organizationId, tenant.organizationId),
        eq(outboundRoute.enabled, true),
      ),
    );

  const legacy = rows.filter(({ route }) => route.patternSyntax !== "pcre");
  if (legacy.length)
    console.warn(
      `[cache] quarantined ${legacy.length} legacy outbound route(s) for tenant ${tenant.organizationId}; explicit PCRE review required`,
    );
  const routes: CachedRoute[] = rows
    .filter(({ route }) => route.patternSyntax === "pcre")
    .filter(
      ({ trunkRow }) =>
        trunkRow?.enabled &&
        trunkRow.authMode === "ip" &&
        trunkRow.organizationId === tenant.organizationId,
    )
    .map(({ route, trunkRow }) => ({
      id: route.id,
      pattern: route.pattern,
      patternSyntax: route.patternSyntax,
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

  gen.set(keys.routes(tenant.sipDomain), JSON.stringify(routes));
}

export async function cacheRouteTable(organizationId: string): Promise<void> {
  const tenant = await tenantFor(organizationId);
  if (!tenant) return;
  const gen: Generation = new Map();
  await buildRouteTable(gen, tenant);
  await publishGeneration([], [keys.routes(tenant.sipDomain)], gen);
}

async function buildInboundRoutes(
  gen: Generation,
  tenant: Tenant,
): Promise<void> {
  const rows = await db.query.inboundRoute.findMany({
    where: and(
      eq(inboundRoute.organizationId, tenant.organizationId),
      eq(inboundRoute.enabled, true),
    ),
  });
  for (const r of rows)
    gen.set(
      keys.did(tenant.sipDomain, r.didPattern),
      JSON.stringify({
        destinationType: r.destinationType,
        destinationId: await destinationNumber(
          tenant.organizationId,
          r.destinationType,
          r.destinationId,
        ),
      }),
    );
}

export async function cacheInboundRoutes(
  organizationId: string,
): Promise<void> {
  const tenant = await tenantFor(organizationId);
  if (!tenant) return;
  const gen: Generation = new Map();
  await buildInboundRoutes(gen, tenant);
  // Previously deleted every DID key and then re-set them, so a lookup in between found none.
  await publishGeneration([keys.didPattern(tenant.sipDomain)], [], gen);
}

function buildTenantSettings(gen: Generation, tenant: Tenant): void {
  gen.set(
    keys.tenant(tenant.sipDomain),
    JSON.stringify({
      organizationId: tenant.organizationId,
      sipDomain: tenant.sipDomain,
      tier: tenant.tier,
      dispatcherSetId: tenant.dispatcherSetId,
      egressMode: tenant.egressMode,
      maxConcurrentCalls: tenant.maxConcurrentCalls,
      recordingPolicy: tenant.recordingPolicy,
      stirShakenEnabled: tenant.stirShakenEnabled,
      timezone: tenant.timezone,
      enabled: tenant.enabled,
    }),
  );
}

export async function cacheTenantSettings(
  organizationId: string,
): Promise<void> {
  const tenant = await tenantFor(organizationId);
  if (!tenant) return;
  const gen: Generation = new Map();
  buildTenantSettings(gen, tenant);
  await publishGeneration([], [keys.tenant(tenant.sipDomain)], gen);
}

/**
 * Ring groups, IVR menus and time conditions, published together because ring groups and IVRs
 * share the `qwixbox:num:` feature-number index: publishing either alone would delete the other's
 * numbers as stale. A disabled or deleted call flow now loses its keys; before, they lingered
 * until a full rebuild.
 */
async function buildCallFlows(gen: Generation, tenant: Tenant): Promise<void> {
  const domain = tenant.sipDomain;
  const organizationId = tenant.organizationId;
  const groups = await db.query.ringGroup.findMany({
    where: and(
      eq(ringGroup.organizationId, organizationId),
      eq(ringGroup.enabled, true),
    ),
  });
  for (const group of groups) {
    gen.set(
      keys.ringGroup(domain, group.id),
      JSON.stringify(await callState(domain, "rg", group.id)),
    );
    if (group.number)
      gen.set(
        keys.featureNumber(domain, group.number),
        JSON.stringify({ type: "ring_group", id: group.id }),
      );
  }

  const menus = await db.query.ivrMenu.findMany({
    where: and(
      eq(ivrMenu.organizationId, organizationId),
      eq(ivrMenu.enabled, true),
    ),
  });
  for (const menu of menus) {
    gen.set(
      keys.ivr(domain, menu.id),
      JSON.stringify(await callState(domain, "ivr", menu.id)),
    );
    // A legacy duplicate (from before numbers were claimed, I19) keeps the ring group, which
    // is what routes/fs-xml.ts asks for first; the IVR stays reachable through its own key.
    if (menu.number && !gen.has(keys.featureNumber(domain, menu.number)))
      gen.set(
        keys.featureNumber(domain, menu.number),
        JSON.stringify({ type: "ivr", id: menu.id }),
      );
  }

  const conditions = await db.query.timeCondition.findMany({
    where: and(
      eq(timeCondition.organizationId, organizationId),
      eq(timeCondition.enabled, true),
    ),
  });
  for (const cond of conditions)
    gen.set(
      keys.timeCondition(domain, cond.id),
      JSON.stringify(await callState(domain, "tc", cond.id)),
    );
}

export async function cacheCallFlows(organizationId: string): Promise<void> {
  const tenant = await tenantFor(organizationId);
  if (!tenant) return;
  const gen: Generation = new Map();
  await buildCallFlows(gen, tenant);
  await publishGeneration(keys.callFlowPatterns(tenant.sipDomain), [], gen);
}

/**
 * The whole tenant as one generation. This used to delete every tenant key and then repopulate,
 * so each rebuild - now every queued "all" job - left calls finding no tenant for a moment, and a
 * failure part way left it half-populated.
 */
export async function rebuildTenant(organizationId: string): Promise<void> {
  const tenant = await tenantFor(organizationId);
  if (!tenant) return;
  const gen: Generation = new Map();
  buildTenantSettings(gen, tenant);
  await buildRouteTable(gen, tenant);
  await buildInboundRoutes(gen, tenant);
  await buildCallFlows(gen, tenant);
  const extensions = await db.query.extension.findMany({
    where: eq(extension.organizationId, organizationId),
  });
  for (const ext of extensions) buildExtension(gen, tenant, ext);

  await publishGeneration(keys.tenantPatterns(tenant.sipDomain), [], gen);
  for (const ext of extensions)
    await esl.flushXmlCache(ext.number, tenant.sipDomain);
}
