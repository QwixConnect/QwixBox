#!/usr/bin/env bun
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { outboundRoute } from "../db/schema";
import { validatePcre } from "../lib/dialplan-safe";
import { enqueue } from "../services/projections";

// Upgrades must stop for operator review. No automatic Lua -> PCRE translation.
const accept = process.argv.indexOf("--accept-pcre");
const id = accept < 0 ? undefined : process.argv[accept + 1];
let blocked = false;
for (const route of await db.query.outboundRoute.findMany()) {
  const problem = await validatePcre(route.pattern);
  if (route.id === id && !problem) {
    await db
      .update(outboundRoute)
      .set({ patternSyntax: "pcre" })
      .where(eq(outboundRoute.id, route.id));
    // Now eligible, so it must reach the route cache and, if an emergency route, Kamailio.
    if (route.organizationId)
      await enqueue(db, route.organizationId, [
        { kind: "cache", target: "routes" },
        { kind: "emergency" },
      ]);
    continue;
  }
  if (problem || route.patternSyntax !== "pcre") {
    console.error(
      `${route.id}: ${problem ?? "legacy syntax not reviewed; confirm with --accept-pcre <id> after checking intended matches"}`,
    );
    blocked = true;
  }
}
await pool.end();
process.exit(blocked ? 1 : 0);
