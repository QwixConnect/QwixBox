import { eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { extension, tenantSettings, trunk } from "../db/schema";
import { decrypt } from "../lib/crypto";
import {
  cacheExtension,
  cacheInboundRoutes,
  cacheCallFlows,
  cacheRouteTable,
  invalidateExtension,
  rebuildTenant,
} from "./cache";
import {
  reloadKamailio,
  removeSubscriber,
  removeTrunkAddress,
  syncDomain,
  syncEmergencyPatterns,
  syncSubscriber,
  syncTrunkAddress,
} from "./kamailio-sync";
import { emergencyPatterns } from "./outbound-routes";

/**
 * The durable outbox for everything a database write has to publish to Redis and Kamailio (R06).
 *
 * Before this, routes committed and then called the projection directly. If Redis or Kamailio's
 * database was unreachable at that moment the effect was lost: a disabled extension kept its
 * subscriber row and could still register, and the caller got a 500 for a change that had in fact
 * been saved. Now a write records its follow-up work in `projection_job` inside the same
 * transaction, tries it once immediately (so the normal case is as fast as before), and leaves it
 * queued on failure. The worker in src/index.ts retries with backoff and drains on startup, so
 * pending work survives an API restart.
 *
 * Jobs name *what* to republish, never the data: each run re-reads current state. That makes a
 * job safe to repeat, and lets several changes to one extension collapse into one row.
 */

export type CacheSection = "all" | "routes" | "inbound" | "callflows";

export type Projection =
  | {
      kind: "extension";
      target: string;
      // Needed when the extension row is gone by the time the job runs.
      payload: { number: string; sipDomain: string };
    }
  | { kind: "trunk"; target: string }
  | { kind: "domain" }
  // Kamailio's copy of the emergency route patterns (I02). Trunk and domain jobs refresh it
  // too, because a trunk decides whether its routes are eligible and the domain keys them.
  | { kind: "emergency" }
  | { kind: "cache"; target: CacheSection };

type Executor = Pick<typeof db, "execute">;

type JobRow = {
  key: string;
  kind: string;
  organization_id: string;
  target: string;
  payload: { number?: string; sipDomain?: string } | null;
  requested: number;
  attempts: number;
};

const LEASE_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 300;
// A job that has failed this many times in a row is reported as failing, not merely pending.
export const FAILING_AFTER_ATTEMPTS = 3;

function jobKey(organizationId: string, job: Projection): string {
  const target = "target" in job ? job.target : organizationId;
  return `${job.kind}:${organizationId}:${target}`;
}

/**
 * Record follow-up work. Pass the transaction that makes the change, so both commit or neither
 * does. Returns the keys to hand to runNow() after the commit.
 */
export async function enqueue(
  executor: Executor,
  organizationId: string,
  jobs: readonly Projection[],
): Promise<string[]> {
  const enqueued: string[] = [];
  for (const job of jobs) {
    const key = jobKey(organizationId, job);
    const target = "target" in job ? job.target : organizationId;
    const payload = "payload" in job ? JSON.stringify(job.payload) : null;
    await executor.execute(sql`
      INSERT INTO projection_job (key, kind, organization_id, target, payload)
      VALUES (${key}, ${job.kind}, ${organizationId}, ${target}, ${payload}::jsonb)
      ON CONFLICT (key) DO UPDATE SET
        requested = projection_job.requested + 1,
        payload = EXCLUDED.payload,
        run_after = now()`);
    enqueued.push(key);
  }
  return enqueued;
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The shape every hand-written route uses: make the change and record its projections in one
 * transaction, then try to publish. `jobs` may depend on what the write returned; returning []
 * (for example, nothing changed) records nothing.
 */
export async function writeAndPublish<T>(
  organizationId: string,
  write: (tx: Tx) => Promise<T>,
  jobs: (result: T) => readonly Projection[],
): Promise<T> {
  const { result, keys } = await db.transaction(async (tx) => {
    const result = await write(tx);
    return { result, keys: await enqueue(tx, organizationId, jobs(result)) };
  });
  await runNow(keys);
  return result;
}

/**
 * Serialise everything that publishes one tenant's cache (R13). publishGeneration() scans for
 * stale keys before its atomic swap, so two publishers interleaving could delete a key the other
 * had just written. A session advisory lock covers every API instance. Take it only at the outer
 * level - a job run or the warm watchdog - never inside cache.ts: the same lock requested from a
 * second connection while the first holds it would wait forever.
 */
export async function withTenantLock<T>(
  organizationId: string,
  work: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [
      `qwixbox:projection:${organizationId}`,
    ]);
    try {
      return await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [
        `qwixbox:projection:${organizationId}`,
      ]);
    }
  } finally {
    client.release();
  }
}

async function requireReload(
  only?: Parameters<typeof reloadKamailio>[0],
): Promise<void> {
  if (!(await reloadKamailio(only)))
    throw new Error("Kamailio reload failed; the change is not live yet");
}

async function projectEmergency(
  organizationId: string,
  sipDomain: string | undefined,
): Promise<void> {
  await syncEmergencyPatterns(
    organizationId,
    sipDomain ?? null,
    sipDomain ? await emergencyPatterns(organizationId) : [],
  );
}

async function apply(job: JobRow): Promise<void> {
  const organizationId = job.organization_id;
  const tenant = await db.query.tenantSettings.findFirst({
    where: eq(tenantSettings.organizationId, organizationId),
  });

  switch (job.kind) {
    case "extension": {
      const ext = await db.query.extension.findFirst({
        where: eq(extension.id, job.target),
      });
      const sipDomain = tenant?.sipDomain ?? job.payload?.sipDomain;
      const number = ext?.number ?? job.payload?.number;
      if (!sipDomain || !number)
        throw new Error("extension job has no number or domain to act on");
      if (ext && ext.enabled && tenant) {
        await syncSubscriber(ext, sipDomain, decrypt(ext.sipPasswordEnc));
        await cacheExtension(ext.id);
      } else {
        // Revocation: deleted or disabled. Remove the credential first - it is what lets a
        // device register - then the cached directory entry.
        await removeSubscriber(number, sipDomain);
        await invalidateExtension(organizationId, number, sipDomain);
      }
      // Ring groups list members by number, so a membership's extension changes them too.
      if (tenant) await cacheCallFlows(organizationId);
      return;
    }
    case "trunk": {
      const row = await db.query.trunk.findFirst({
        where: eq(trunk.id, job.target),
      });
      if (row) await syncTrunkAddress(row);
      else await removeTrunkAddress(job.target);
      await projectEmergency(organizationId, tenant?.sipDomain);
      await requireReload();
      if (tenant) await cacheRouteTable(organizationId);
      return;
    }
    case "domain": {
      if (!tenant) return;
      await syncDomain(tenant.sipDomain);
      await projectEmergency(organizationId, tenant.sipDomain);
      await requireReload();
      return;
    }
    case "emergency": {
      await projectEmergency(organizationId, tenant?.sipDomain);
      await requireReload(["emergency"]);
      return;
    }
    case "cache": {
      if (!tenant) return;
      const section = job.target as CacheSection;
      if (section === "routes") await cacheRouteTable(organizationId);
      else if (section === "inbound") await cacheInboundRoutes(organizationId);
      else if (section === "callflows") await cacheCallFlows(organizationId);
      else await rebuildTenant(organizationId);
      return;
    }
    default:
      throw new Error(`unknown projection kind ${job.kind}`);
  }
}

async function claim(key?: string): Promise<JobRow | null> {
  const only = key ? sql`AND key = ${key}` : sql``;
  const result = await db.execute(sql`
    UPDATE projection_job SET
      locked_until = now() + make_interval(secs => ${LEASE_SECONDS}),
      attempts = attempts + 1
    WHERE key = (
      SELECT key FROM projection_job
      WHERE run_after <= now()
        AND (locked_until IS NULL OR locked_until < now())
        ${only}
      ORDER BY run_after
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING key, kind, organization_id, target, payload, requested, attempts`);
  return (result.rows[0] as JobRow | undefined) ?? null;
}

async function runClaimed(job: JobRow): Promise<boolean> {
  try {
    await withTenantLock(job.organization_id, () => apply(job));
  } catch (error) {
    const message = (error as Error).message;
    const delay = Math.min(2 ** job.attempts, MAX_BACKOFF_SECONDS);
    await db.execute(sql`
      UPDATE projection_job SET
        locked_until = NULL,
        last_error = ${message},
        run_after = now() + make_interval(secs => ${delay})
      WHERE key = ${job.key}`);
    console.warn(
      `[projection] ${job.key} failed (attempt ${job.attempts}), retrying in ${delay}s: ${message}`,
    );
    return false;
  }
  // Finished. Delete only if nothing was enqueued meanwhile; otherwise the newer change still
  // has to be published, so release the row for another run.
  const removed = await db.execute(sql`
    DELETE FROM projection_job WHERE key = ${job.key} AND requested = ${job.requested}`);
  if (!removed.rowCount)
    await db.execute(sql`
      UPDATE projection_job SET locked_until = NULL, attempts = 0, last_error = NULL
      WHERE key = ${job.key}`);
  return true;
}

/**
 * Publish just-committed work now, so the caller sees its change live as before. Never throws:
 * a failure leaves the job queued for the worker. Returns whether everything was published.
 */
export async function runNow(keys: readonly string[]): Promise<boolean> {
  let ok = true;
  for (const key of keys) {
    try {
      const job = await claim(key);
      // Not claimable means another runner has it, or a backoff is pending; the worker owns it.
      if (!job) {
        ok = false;
        continue;
      }
      if (!(await runClaimed(job))) ok = false;
    } catch (error) {
      ok = false;
      console.warn(
        `[projection] ${key} could not run:`,
        (error as Error).message,
      );
    }
  }
  return ok;
}

/** Run every due job once. The worker calls this on startup and on each tick. */
export async function drainProjections(
  limit = 100,
): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const job = await claim();
    if (!job) break;
    if (await runClaimed(job)) done++;
    else failed++;
  }
  return { done, failed };
}

/** Started from src/index.ts only - src/app.ts must stay free of timers (tests import it). */
export function startProjectionWorker(intervalMs = 2_000): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await drainProjections();
    } catch (error) {
      console.warn("[projection] drain failed:", (error as Error).message);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, intervalMs).unref();
}

export type ProjectionStatus = {
  pending: number;
  failing: number;
  oldestPendingSeconds: number | null;
};

export async function projectionStatus(
  organizationId?: string,
): Promise<ProjectionStatus> {
  const scope = organizationId
    ? sql`WHERE organization_id = ${organizationId}`
    : sql``;
  const result = await db.execute(sql`
    SELECT count(*)::int AS pending,
           count(*) FILTER (WHERE attempts >= ${FAILING_AFTER_ATTEMPTS})::int AS failing,
           extract(epoch FROM now() - min(created_at))::int AS oldest
    FROM projection_job ${scope}`);
  const row = result.rows[0] as {
    pending: number;
    failing: number;
    oldest: number | null;
  };
  return {
    pending: row.pending,
    failing: row.failing,
    oldestPendingSeconds: row.oldest,
  };
}

export async function listProjections(organizationId: string) {
  const result = await db.execute(sql`
    SELECT kind, target, attempts, last_error AS "lastError",
           created_at AS "createdAt", run_after AS "nextAttemptAt"
    FROM projection_job WHERE organization_id = ${organizationId}
    ORDER BY created_at`);
  return result.rows;
}
