#!/usr/bin/env bun
// Queue a refresh of Kamailio's emergency patterns for every tenant (I02). Step 41 runs this on
// each deploy: an install that predates the projection has emergency routes and no Kamailio rows,
// so its emergency calls would still meet the capacity check on ingress. The API drains the jobs
// when it starts; queuing an existing job only bumps it, so repeats are harmless.
import { db, pool } from "../db";
import { tenantSettings } from "../db/schema";
import { enqueue } from "../services/projections";

const tenants = await db
  .select({ organizationId: tenantSettings.organizationId })
  .from(tenantSettings);
for (const { organizationId } of tenants)
  await enqueue(db, organizationId, [{ kind: "emergency" }]);
console.log(
  `Queued emergency pattern projection for ${tenants.length} tenant(s)`,
);
await pool.end();
process.exit(0);
