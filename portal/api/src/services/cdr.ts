import { XMLParser } from "fast-xml-parser";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { cdr, extension, tenantSettings, trunk } from "../db/schema";

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
});

type Bag = Record<string, unknown>;

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s === "" ? null : s;
}

function decodeVar(v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

function epoch(v: unknown): Date | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

function int(v: unknown): number {
  const n = Number(str(v) ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export type ParsedCdr = {
  callUuid: string;
  sipCallId: string | null;
  correlationId: string | null;
  organizationId: string | null;
  direction: "inbound" | "outbound" | "internal";
  callerNumber: string | null;
  callerName: string | null;
  destinationNumber: string;
  authUser: string | null;
  gatewayName: string | null;
  trunkId: string | null;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSec: number;
  billsecSec: number;
  hangupCause: string | null;
  recordingPath: string | null;
  attestation: string | null;
  context: string | null;
};

export function parseCdrXml(xml: string): ParsedCdr | null {
  let doc: Bag;
  try {
    doc = parser.parse(xml) as Bag;
  } catch {
    return null;
  }

  const root = (doc.cdr ?? doc) as Bag;
  const vars = (root.variables ?? {}) as Bag;
  const callflow = root.callflow;
  const flow = (Array.isArray(callflow) ? callflow[0] : callflow) as
    Bag | undefined;
  const profile = (flow?.caller_profile ?? {}) as Bag;

  const callUuid = decodeVar(vars.uuid) ?? decodeVar(vars.call_uuid);
  if (!callUuid) return null;

  const destination =
    str(profile.destination_number) ?? decodeVar(vars.destination_number);
  if (!destination) return null;

  const started =
    epoch(vars.start_epoch) ?? epoch(vars.profile_start_epoch) ?? new Date();

  const gatewayName =
    decodeVar(vars.sip_gateway_name) ?? decodeVar(vars.gateway_name);
  const trunkId = decodeVar(vars["sip_h_X-Trunk-ID"]);
  const legDirection = decodeVar(vars.direction);
  let direction: ParsedCdr["direction"];
  if (gatewayName || trunkId) {
    direction = "outbound";
  } else if (legDirection === "outbound") {
    direction = "outbound";
  } else {
    direction = "inbound";
  }

  return {
    callUuid,
    sipCallId: decodeVar(vars.sip_call_id),
    correlationId:
      decodeVar(vars["sip_h_X-Correlation-ID"]) ??
      decodeVar(vars.correlation_id),
    organizationId: decodeVar(vars["sip_h_X-Tenant-ID"]),
    direction,
    callerNumber:
      str(profile.caller_id_number) ?? decodeVar(vars.caller_id_number),
    callerName: str(profile.caller_id_name) ?? decodeVar(vars.caller_id_name),
    destinationNumber: destination,
    authUser: decodeVar(vars["sip_h_X-Auth-User"]) ?? str(profile.username),
    gatewayName,
    trunkId,
    startedAt: started,
    answeredAt: epoch(vars.answer_epoch),
    endedAt: epoch(vars.end_epoch),
    durationSec: int(vars.duration),
    billsecSec: int(vars.billsec),
    hangupCause: decodeVar(vars.hangup_cause),
    recordingPath:
      decodeVar(vars.recording_file) ?? decodeVar(vars.last_recording),
    attestation:
      decodeVar(vars.sip_h_Attestation) ?? decodeVar(vars.stir_attestation),
    context: str(profile.context) ?? decodeVar(vars.context),
  };
}

function tenantFromContext(context: string | null): string | null {
  if (!context || !context.startsWith("tenant_")) return null;
  return context.slice("tenant_".length) || null;
}

export async function ingestCdr(
  xml: string,
): Promise<{ stored: boolean; reason?: string }> {
  const parsed = parseCdrXml(xml);
  if (!parsed) return { stored: false, reason: "unparseable" };

  const organizationId =
    parsed.organizationId ?? tenantFromContext(parsed.context);
  if (!organizationId) {
    return { stored: false, reason: "no tenant attribution" };
  }

  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });
  if (!tenant)
    return { stored: false, reason: `unknown tenant ${organizationId}` };

  let extensionId: string | null = null;
  if (parsed.authUser) {
    const ext = await db.query.extension.findFirst({
      where: and(
        eq(extension.organizationId, organizationId),
        eq(extension.number, parsed.authUser),
      ),
    });
    extensionId = ext?.id ?? null;
  }

  let trunkId: string | null = null;
  if (parsed.trunkId || parsed.gatewayName) {
    const t = await db.query.trunk.findFirst({
      where: and(
        eq(trunk.organizationId, organizationId),
        parsed.trunkId
          ? eq(trunk.id, parsed.trunkId)
          : eq(trunk.name, parsed.gatewayName!),
      ),
    });
    trunkId = t?.id ?? null;
  }

  let direction = parsed.direction;
  if (direction === "inbound" && extensionId) {
    const dialled = await db.query.extension.findFirst({
      where: and(
        eq(extension.organizationId, organizationId),
        eq(extension.number, parsed.destinationNumber),
      ),
    });
    if (dialled) direction = "internal";
  }

  await db
    .insert(cdr)
    .values({
      id: randomUUID(),
      organizationId,
      callUuid: parsed.callUuid,
      correlationId: parsed.correlationId,
      sipCallId: parsed.sipCallId,
      direction,
      callerNumber: parsed.callerNumber,
      callerName: parsed.callerName,
      destinationNumber: parsed.destinationNumber,
      extensionId,
      trunkId,
      startedAt: parsed.startedAt,
      answeredAt: parsed.answeredAt,
      endedAt: parsed.endedAt,
      durationSec: parsed.durationSec,
      billsecSec: parsed.billsecSec,
      hangupCause: parsed.hangupCause,
      recordingPath: parsed.recordingPath,
      attestation: parsed.attestation,
    })
    .onConflictDoNothing({ target: cdr.callUuid });

  return { stored: true };
}
