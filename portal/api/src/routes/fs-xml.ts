import { renderDirectoryUser } from "../services/cache";
import { eligibleOutboundRoutes } from "../services/outbound-routes";
import { destinationNumber, outboundCallerId } from "../services/call-state";
import { diallable, validatePcre } from "../lib/dialplan-safe";
import { safeEqual } from "../lib/crypto";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  extension,
  inboundRoute,
  tenantSettings,
  ringGroup,
  ivrMenu,
} from "../db/schema";
import { decrypt } from "../lib/crypto";
import { env } from "../env";

export const fsXml = new Hono();

const NOT_FOUND = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
  <section name="result">
    <result status="not found"/>
  </section>
</document>`;

function wrap(sectionName: string, inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
  <section name="${sectionName}">
${inner}
  </section>
</document>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

fsXml.use("*", async (c, next) => {
  const expected = process.env.FS_XML_GATEWAY_SECRET;
  if (!expected) {
    return c.text("FS_XML_GATEWAY_SECRET is not configured", 500);
  }
  const header = c.req.header("Authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return c.text("Unauthorized", 401);

  const [, password] = Buffer.from(encoded, "base64")
    .toString("utf8")
    .split(":");
  if (!password || !safeEqual(password, expected))
    return c.text("Unauthorized", 401);

  await next();
});

fsXml.post("/", async (c) => {
  const form = await c.req.parseBody();
  const section = String(form["section"] ?? "");

  try {
    switch (section) {
      case "directory":
        return c.text(await handleDirectory(form), 200, {
          "Content-Type": "text/xml",
        });
      case "dialplan":
        return c.text(await handleDialplan(form), 200, {
          "Content-Type": "text/xml",
        });
      case "configuration":
        return c.text(NOT_FOUND, 200, { "Content-Type": "text/xml" });
      default:
        return c.text(NOT_FOUND, 200, { "Content-Type": "text/xml" });
    }
  } catch (err) {
    console.error(`[fs-xml] ${section} lookup failed:`, (err as Error).message);
    return c.text(NOT_FOUND, 200, { "Content-Type": "text/xml" });
  }
});

async function handleDirectory(form: Record<string, unknown>): Promise<string> {
  const domain = String(form["domain"] ?? form["sip_auth_realm"] ?? "");
  const user = String(form["user"] ?? form["sip_auth_username"] ?? "");
  if (!domain || !user) return NOT_FOUND;

  const tenant = await db.query.tenantSettings.findFirst({
    where: and(
      eq(tenantSettings.sipDomain, domain),
      eq(tenantSettings.enabled, true),
    ),
  });
  if (!tenant) return NOT_FOUND;

  const ext = await db.query.extension.findFirst({
    where: and(
      eq(extension.organizationId, tenant.organizationId),
      eq(extension.number, user),
      eq(extension.enabled, true),
    ),
  });
  if (!ext) return NOT_FOUND;

  const password = decrypt(ext.sipPasswordEnc);
  return wrap(
    "directory",
    `    <domain name="${escapeXml(domain)}">
      <params>
        <param name="dial-string" value="{^^|sip_invite_domain=\${dialed_domain}|presence_id=\${dialed_user}@\${dialed_domain}|sip_route_uri=sip:${escapeXml(env.kamEgress)}}sofia/external/\${dialed_user}@\${dialed_domain}"/>
      </params>
      ${renderDirectoryUser(ext, tenant, password, ext.voicemailPinEnc ? decrypt(ext.voicemailPinEnc) : null)}
    </domain>`,
  );
}

export async function handleDialplan(
  form: Record<string, unknown>,
): Promise<string> {
  let domain = String(form["variable_sip_h_X-Tenant-Domain"] ?? "");
  const peer = form["variable_sip_h_X-Trusted-Peer"] === "1";
  const caller = String(form["variable_sip_h_X-Auth-User"] ?? "");
  const authenticated = /^[0-9A-Za-z_.-]+$/.test(caller) && !peer;
  const destination = String(
    form["Caller-Destination-Number"] ?? form.destination_number ?? "",
  );
  if (!diallable(destination)) return NOT_FOUND;
  // A forward set by qwixbox.go (R11): an extension's forwarding setting or a tenant-configured
  // external destination. It authorizes exactly this number, in the tenant it names; channel
  // variables cannot be set from SIP, so a peer cannot forge one. The forwarding extension, not
  // the caller, places the outbound leg - same rule as xml_handler.lua.
  const forwarded =
    destination === String(form.variable_qwixbox_forward_to ?? "");
  const forwardFrom = String(form.variable_qwixbox_forward_from ?? "");
  if (forwarded) {
    const forwardDomain = String(form.variable_qwixbox_forward_domain ?? "");
    if (!peer && forwardDomain !== domain) return NOT_FOUND;
    domain = forwardDomain;
  }
  let did: typeof inboundRoute.$inferSelect | undefined;
  if (peer && !forwarded) {
    const matches = await db
      .select({ route: inboundRoute, domain: tenantSettings.sipDomain })
      .from(inboundRoute)
      .innerJoin(
        tenantSettings,
        eq(inboundRoute.organizationId, tenantSettings.organizationId),
      )
      .where(
        and(
          eq(inboundRoute.didPattern, destination),
          eq(inboundRoute.enabled, true),
          eq(tenantSettings.enabled, true),
        ),
      );
    if (matches.length !== 1) return NOT_FOUND;
    domain = matches[0]!.domain;
    did = matches[0]!.route;
  }
  if (!/^[a-zA-Z0-9.-]+$/.test(domain)) return NOT_FOUND;
  const tenant = await db.query.tenantSettings.findFirst({
    where: and(
      eq(tenantSettings.sipDomain, domain),
      eq(tenantSettings.enabled, true),
    ),
  });
  if (!tenant) return NOT_FOUND;
  const org = tenant.organizationId;
  const action = (app: string, data = "") =>
    `<action application="${escapeXml(app)}" data="${escapeXml(data)}"/>`;
  const answer = (context: string, actions: string[]) =>
    wrap(
      "dialplan",
      `<context name="${escapeXml(context)}"><extension name="resolved"><condition field="destination_number" expression="^${escapeXml(destination.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&"))}$">${actions.join("\n")}</condition></extension></context>`,
    );
  const context = `tenant_${org}`;
  // The caller is on a call too (I06); a transfer back in does not count it twice. Same as xml_handler.lua.
  const result = (actions: string[]) =>
    answer(
      context,
      authenticated
        ? [action("limit", `hash ${domain} ${caller}`), ...actions]
        : actions,
    );
  // Kamailio-forwarded calls arrive in the SIP profile's context ("default"): user_context is only
  // applied when FreeSWITCH authenticates the caller, which auth-calls=false means it never does,
  // and mod_dialplan_xml ignores an answer in any other context. Move the call into its tenant's
  // context first - the CDR attributes it by that name. Same rule as xml_handler.lua.
  const hunt = form["Hunt-Context"];
  if (typeof hunt === "string" && hunt !== context)
    return answer(hunt, [action("transfer", `${destination} XML ${context}`)]);
  const dispatch = async (type: string, id: string | null) => {
    const number = await destinationNumber(org, type, id);
    if (type === "voicemail") {
      const target = await db.query.extension.findFirst({
        where: and(
          eq(extension.organizationId, org),
          eq(extension.number, number ?? ""),
          eq(extension.enabled, true),
        ),
      });
      if (!target) return result([action("hangup", "UNALLOCATED_NUMBER")]);
    }
    if (number && !/^[a-zA-Z0-9_.*#+-]+$/.test(number)) return NOT_FOUND;
    return result([
      action("set", `qwixbox_did=${destination}`),
      action("lua", `destination.lua ${domain} ${type} ${number ?? "-"}`),
    ]);
  };
  if (peer && !forwarded)
    return did ? dispatch(did.destinationType, did.destinationId) : NOT_FOUND;

  // Shared with the Redis tier and Kamailio's emergency exemption (I02).
  const routes = await eligibleOutboundRoutes(org);
  const outbound = async (emergency: boolean): Promise<string | null> => {
    if (!authenticated && !forwarded) return null;
    const placedBy = forwarded ? forwardFrom : caller;
    // Same resolution as the cached call state xml_handler.lua reads (I03).
    const callerExt = /^[0-9A-Za-z_.-]+$/.test(placedBy)
      ? await db.query.extension.findFirst({
          where: and(
            eq(extension.organizationId, org),
            eq(extension.number, placedBy),
            eq(extension.enabled, true),
          ),
        })
      : undefined;
    const identity =
      callerExt || forwarded
        ? outboundCallerId(callerExt, tenant)
        : { callerIdName: null, callerIdNumber: null };
    for (const { route, carrier } of routes) {
      if (
        route.isEmergency !== emergency ||
        route.patternSyntax !== "pcre" ||
        (await validatePcre(route.pattern))
      )
        continue;
      const proc = Bun.spawn(["pcre2grep", "-q", "-e", route.pattern], {
        stdin: new Blob([destination + "\n"]),
        stdout: "ignore",
        stderr: "ignore",
      });
      if ((await proc.exited) !== 0) continue;
      const number =
        (route.prependDigits ?? "") + destination.slice(route.stripDigits);
      if (!diallable(number)) continue;
      const host = carrier.host.includes(":")
        ? `[${carrier.host}]`
        : carrier.host;
      return result([
        action("set", `sip_h_X-Tenant-ID=${org}`),
        action("set", `sip_h_X-Tenant-Domain=${domain}`),
        action(
          "set",
          `sip_h_X-Auth-User=${callerExt ? placedBy : forwarded ? "" : caller}`,
        ),
        action("unset", "sip_h_X-Emergency"),
        action("unset", "sip_h_X-Stir-Sign"),
        ...(tenant.stirShakenEnabled
          ? [action("set", "sip_h_X-Stir-Sign=true")]
          : []),
        ...(emergency
          ? [
              action("set", "sip_h_X-Emergency=true"),
              action("set", "emergency_call=true"),
              action("set", "ignore_early_media=true"),
            ]
          : []),
        action("set", `sip_h_X-Trunk-ID=${carrier.id}`),
        action(
          "set",
          `sip_h_X-Trunk-Target=${host}:${carrier.port};transport=${carrier.transport}`,
        ),
        ...callerIdActions(
          identity.callerIdName,
          route.callerIdOverride || identity.callerIdNumber,
        ),
        action("set", "hangup_after_bridge=true"),
        action("bridge", `sofia/external/${number}@${env.kamEgress}`),
      ]);
    }
    return null;
  };
  // Route override, else the extension's, else the tenant default; unset leaves the call's own.
  const callerIdActions = (name: string | null, number: string | null) => [
    ...(name ? [action("set", `effective_caller_id_name=${name}`)] : []),
    ...(number ? [action("set", `effective_caller_id_number=${number}`)] : []),
  ];
  const emergency = await outbound(true);
  if (emergency) return emergency;
  if (destination === "*97" || destination === "*98")
    return result([
      action("answer"),
      action("sleep", "500"),
      action(
        "voicemail",
        destination === "*97" && authenticated
          ? `check auth default ${domain} ${caller}`
          : `check default ${domain}`,
      ),
    ]);
  const codes: Record<string, string> = {
    "*78": "dnd_on",
    "*79": "dnd_off",
    "*73": "fwd_all_clear",
    "*91": "fwd_busy_clear",
    "*93": "fwd_na_clear",
  };
  const prefixes: Record<string, string> = {
    "*72": "fwd_all_set",
    "*90": "fwd_busy_set",
    "*92": "fwd_na_set",
  };
  const feature =
    codes[destination] ??
    (destination.length > 3 ? prefixes[destination.slice(0, 3)] : undefined);
  if (feature)
    return result([
      authenticated
        ? action(
            "lua",
            `feature_code.lua ${domain} ${caller} ${feature} ${codes[destination] ? "" : destination.slice(3)}`,
          )
        : action("hangup", "CALL_REJECTED"),
    ]);
  const ext = await db.query.extension.findFirst({
    where: and(
      eq(extension.organizationId, org),
      eq(extension.number, destination),
      eq(extension.enabled, true),
    ),
  });
  if (ext)
    return result([action("lua", `extension.lua ${domain} ${destination}`)]);
  did = await db.query.inboundRoute.findFirst({
    where: and(
      eq(inboundRoute.organizationId, org),
      eq(inboundRoute.didPattern, destination),
      eq(inboundRoute.enabled, true),
    ),
  });
  if (did) return dispatch(did.destinationType, did.destinationId);
  const group = await db.query.ringGroup.findFirst({
    where: and(
      eq(ringGroup.organizationId, org),
      eq(ringGroup.number, destination),
      eq(ringGroup.enabled, true),
    ),
  });
  if (group) return dispatch("ring_group", group.id);
  const menu = await db.query.ivrMenu.findFirst({
    where: and(
      eq(ivrMenu.organizationId, org),
      eq(ivrMenu.number, destination),
      eq(ivrMenu.enabled, true),
    ),
  });
  if (menu) return dispatch("ivr", menu.id);
  return (
    (await outbound(false)) ?? result([action("hangup", "UNALLOCATED_NUMBER")])
  );
}

export { env };
