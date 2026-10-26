import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { outboundRoute, trunk } from "../db/schema";
import { validatePcre } from "../lib/dialplan-safe";

export type EligibleRoute = {
  route: typeof outboundRoute.$inferSelect;
  carrier: typeof trunk.$inferSelect;
};

/**
 * The outbound routes a call can actually take, in the order they are tried: emergency first,
 * then by priority. The one definition of eligibility, shared by the Redis tier, the API tier
 * (`fs-xml.ts`) and Kamailio's emergency patterns, so that what Kamailio exempts from its
 * capacity check on ingress is exactly what FreeSWITCH will route as an emergency (I02).
 *
 * A route needs PCRE syntax (legacy patterns are quarantined until reviewed), and an enabled
 * IP-authenticated trunk of the same tenant. Pattern validity is not checked here: the call
 * tiers skip a pattern that does not compile, so the Kamailio projection filters it the same way.
 */
export async function eligibleOutboundRoutes(
  organizationId: string,
): Promise<EligibleRoute[]> {
  const rows = await db
    .select({ route: outboundRoute, carrier: trunk })
    .from(outboundRoute)
    .innerJoin(trunk, eq(outboundRoute.trunkId, trunk.id))
    .where(
      and(
        eq(outboundRoute.organizationId, organizationId),
        eq(outboundRoute.enabled, true),
        eq(outboundRoute.patternSyntax, "pcre"),
        eq(trunk.organizationId, organizationId),
        eq(trunk.enabled, true),
        eq(trunk.authMode, "ip"),
      ),
    );
  return rows.sort(
    (a, b) =>
      Number(b.route.isEmergency) - Number(a.route.isEmergency) ||
      a.route.priority - b.route.priority,
  );
}

/** The patterns of a tenant's emergency routes that the call tiers would match. */
export async function emergencyPatterns(
  organizationId: string,
): Promise<string[]> {
  const patterns: string[] = [];
  for (const { route } of await eligibleOutboundRoutes(organizationId)) {
    if (!route.isEmergency) continue;
    const invalid = await validatePcre(route.pattern);
    if (invalid) {
      console.warn(
        `[routes] emergency route ${route.id} has an invalid pattern, not exempted: ${invalid}`,
      );
      continue;
    }
    patterns.push(route.pattern);
  }
  return patterns;
}
