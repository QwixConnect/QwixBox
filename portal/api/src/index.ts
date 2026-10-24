import { app } from "./app";
import { env } from "./env";
import { db } from "./db";
import {
  claimWarm,
  renewWarm,
  finishWarm,
  safeDel,
  keys,
} from "./services/redis";
import { rebuildTenant } from "./services/cache";

async function warmCache(): Promise<void> {
  const tenants = await db.query.tenantSettings.findMany();
  let failures = 0;
  for (const tenant of tenants) {
    try {
      await rebuildTenant(tenant.organizationId);
    } catch (error) {
      failures++;
      console.warn(
        `[cache] tenant ${tenant.organizationId} warm failed:`,
        (error as Error).message,
      );
    }
  }
  if (failures)
    throw new Error(
      `${failures} tenant cache rebuild(s) failed; watchdog will retry`,
    );
  console.log(`[cache] warmed ${tenants.length} tenant(s)`);
}

const WARM_CHECK_INTERVAL_MS = 60_000;

async function warmIfCacheLost(): Promise<void> {
  let token: string | null = null;
  let renewal: ReturnType<typeof setInterval> | undefined;
  let owned = true;
  try {
    token = await claimWarm();
    if (!token) return;
    const owner = token;
    renewal = setInterval(() => {
      void renewWarm(owner)
        .then((ok) => {
          if (!ok) owned = false;
        })
        .catch(() => {
          owned = false;
        });
    }, 10_000);
    await warmCache();
    if (!owned || !(await finishWarm(token, true)))
      throw new Error("Cache warming lock lost");
  } catch (err) {
    if (token) await finishWarm(token, false).catch(() => {});
    console.warn("[cache] re-warm check failed:", (err as Error).message);
  } finally {
    if (renewal) clearInterval(renewal);
  }
}

// Refresh cache contracts after an upgrade even when Redis still holds the previous sentinel.
void safeDel(keys.warmSentinel())
  .then(warmIfCacheLost)
  .catch((error) => {
    console.warn("[cache] startup refresh failed:", (error as Error).message);
  });
setInterval(warmIfCacheLost, WARM_CHECK_INTERVAL_MS).unref();

export default {
  port: env.port,
  hostname: env.host,
  fetch: app.fetch,
};
