#!/usr/bin/env bun
// Bring Kamailio and the Redis cache back in line with this database after a restore or a
// rollback (I14, docs/rollback.md). Both are projections of it, but projection jobs act only on
// rows they can name: anything created after the dump that was restored is gone from here and
// still live there. So, in this order:
//
//   1. delete the Kamailio rows and cached tenants that this database does not know;
//   2. queue a projection of everything it does know: each tenant's domain, emergency patterns
//      and whole cache, every extension and every trunk.
//
// The API drains the queue (and reloads Kamailio) when it is running; run this with it running,
// and check `GET /api/health` reports no pending projections afterwards.
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import { extension, tenantSettings, trunk } from "../db/schema";
import { enqueue, type Projection } from "../services/projections";
import { pruneKamailio, reloadKamailio } from "../services/kamailio-sync";
import { keys, redis, safeDelPattern } from "../services/redis";

const tenants = await db
  .select({
    organizationId: tenantSettings.organizationId,
    sipDomain: tenantSettings.sipDomain,
  })
  .from(tenantSettings);
const extensions = await db
  .select({
    id: extension.id,
    organizationId: extension.organizationId,
    number: extension.number,
    enabled: extension.enabled,
    sipDomain: tenantSettings.sipDomain,
  })
  .from(extension)
  .innerJoin(
    tenantSettings,
    eq(extension.organizationId, tenantSettings.organizationId),
  );
const trunks = await db
  .select({ id: trunk.id, organizationId: trunk.organizationId })
  .from(trunk);

const pruned = await pruneKamailio({
  subscribers: extensions
    .filter((e) => e.enabled)
    .map((e) => ({ username: e.number, domain: e.sipDomain })),
  trunkIds: trunks.map((t) => t.id),
  domains: tenants.map((t) => t.sipDomain),
  organizationIds: tenants.map((t) => t.organizationId),
});
console.log(
  `Removed from Kamailio: ${Object.entries(pruned)
    .map(([table, n]) => `${n} ${table}`)
    .join(", ")}`,
);
if (!(await reloadKamailio()))
  console.warn(
    "Kamailio reload failed; the queued domain and trunk jobs reload it again.",
  );

// A tenant's cache is published from its own rows, so a tenant that no longer exists here is
// never republished and its keys would answer calls from the warm tier.
const known = new Set(tenants.map((t) => t.sipDomain));
let staleTenants = 0;
let cursor = "0";
do {
  const [next, batch] = (await redis.send("SCAN", [
    cursor,
    "MATCH",
    keys.tenant("*"),
    "COUNT",
    "200",
  ])) as [string, string[]];
  cursor = next;
  for (const key of batch) {
    const domain = key.slice(keys.tenant("").length);
    if (known.has(domain)) continue;
    for (const stale of keys.tenantPatterns(domain))
      await safeDelPattern(stale);
    staleTenants++;
  }
} while (cursor !== "0");
console.log(`Removed ${staleTenants} cached tenant(s) not in this database`);

let queued = 0;
for (const t of tenants) {
  const jobs: Projection[] = [
    { kind: "domain" },
    { kind: "emergency" },
    { kind: "cache", target: "all" },
  ];
  for (const e of extensions.filter(
    (e) => e.organizationId === t.organizationId,
  ))
    jobs.push({
      kind: "extension",
      target: e.id,
      payload: { number: e.number, sipDomain: e.sipDomain },
    });
  for (const tr of trunks.filter(
    (tr) => tr.organizationId === t.organizationId,
  ))
    jobs.push({ kind: "trunk", target: tr.id });
  queued += (await enqueue(db, t.organizationId, jobs)).length;
}
console.log(
  `Queued ${queued} projection job(s) for ${tenants.length} tenant(s); the API drains them`,
);

redis.close();
await pool.end();
process.exit(0);
