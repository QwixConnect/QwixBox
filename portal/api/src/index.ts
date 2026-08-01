import { Hono } from "hono";
import { logger } from "hono/logger";
import { auth } from "./auth";
import { env } from "./env";
import { cdrs } from "./routes/cdr";
import { extensions } from "./routes/extensions";
import { fsCdr } from "./routes/fs-cdr";
import { fsFeature } from "./routes/fs-feature";
import { fsXml } from "./routes/fs-xml";
import { tenants } from "./routes/tenants";
import { faxHook, faxes } from "./routes/fax";
import { audit } from "./routes/audit";
import {
  inboundRoutes,
  ivrMenus,
  outboundRoutes,
  ringGroups,
  timeConditions,
  trunks,
} from "./routes/telephony";
import { claimWarm, ping as redisPing } from "./services/redis";
import { esl } from "./services/esl";
import { pool, db } from "./db";
import { tenantSettings } from "./db/schema";
import { rebuildTenant } from "./services/cache";

const app = new Hono();

app.use("*", logger());

function probe(p: Promise<boolean>, ms = 750): Promise<boolean> {
  return Promise.race([
    p.catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

app.get("/health", async (c) => {
  const [dbOk, redisOk, eslOk] = await Promise.all([
    probe(pool.query("SELECT 1").then(() => true)),
    probe(redisPing()),
    probe(esl.status(750).then((r) => r.ok)),
  ]);

  const healthy = dbOk && redisOk;
  return c.json(
    {
      status: healthy ? "ok" : "degraded",
      database: dbOk,
      redis: redisOk,
      freeswitch: eslOk,
    },
    healthy ? 200 : 503,
  );
});

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.get("/internal/session", async (c) => {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    return session?.user ? c.body(null, 200) : c.body(null, 401);
  } catch (err) {
    console.error("[auth] session probe failed:", (err as Error).message);
    return c.body(null, 401);
  }
});

app.route("/fs/xml", fsXml);
app.route("/fs/fax", faxHook);
app.route("/fs/cdr", fsCdr);
app.route("/fs/feature", fsFeature);

app.route("/api/tenant", tenants);
app.route("/api/extensions", extensions);
app.route("/api/faxes", faxes);
app.route("/api/trunks", trunks);
app.route("/api/inbound-routes", inboundRoutes);
app.route("/api/outbound-routes", outboundRoutes);
app.route("/api/ring-groups", ringGroups);
app.route("/api/ivr-menus", ivrMenus);
app.route("/api/time-conditions", timeConditions);
app.route("/api/cdr", cdrs);
app.route("/api/audit", audit);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error("[api] unhandled:", err);
  return c.json({ error: "Internal error" }, 500);
});

async function warmCache(): Promise<void> {
  try {
    const tenants = await db.query.tenantSettings.findMany();
    for (const tenant of tenants) {
      await rebuildTenant(tenant.organizationId);
    }
    console.log(`[cache] warmed ${tenants.length} tenant(s)`);
  } catch (err) {
    console.warn(
      "[cache] warm failed (serving from the fallback path):",
      (err as Error).message,
    );
  }
}

const WARM_CHECK_INTERVAL_MS = 60_000;

async function warmIfCacheLost(): Promise<void> {
  try {
    if (!(await claimWarm())) return; // sentinel present: cache is warm, or a peer is warming it
    console.warn(
      "[cache] warm sentinel absent - Redis was restarted or flushed, rebuilding",
    );
    await warmCache();
  } catch (err) {
    console.warn("[cache] re-warm check failed:", (err as Error).message);
  }
}

void warmCache().then(() => claimWarm());
setInterval(warmIfCacheLost, WARM_CHECK_INTERVAL_MS).unref();

export default {
  port: env.port,
  hostname: env.host,
  fetch: app.fetch,
};
