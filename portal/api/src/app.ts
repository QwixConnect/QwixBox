import { fsState } from "./routes/fs-state";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
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
import { capabilities } from "./routes/capabilities";
import {
  inboundRoutes,
  ivrMenus,
  outboundRoutes,
  ringGroups,
  timeConditions,
  trunks,
} from "./routes/telephony";
import { ping as redisPing } from "./services/redis";
import { esl } from "./services/esl";
import { pool } from "./db";
import { projectionStatus } from "./services/projections";

export const app = new Hono();

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

  // Counts only: this endpoint is public. A failing job is a change that is committed but not
  // live - possibly a revocation - so it degrades health rather than hiding in a log.
  const projections = dbOk ? await projectionStatus().catch(() => null) : null;
  const healthy = dbOk && redisOk && (projections?.failing ?? 0) === 0;
  return c.json(
    {
      status: healthy ? "ok" : "degraded",
      database: dbOk,
      redis: redisOk,
      freeswitch: eslOk,
      projections: projections && {
        pending: projections.pending,
        failing: projections.failing,
      },
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
app.route("/fs/state", fsState);
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
app.route("/api/capabilities", capabilities);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException)
    return c.json({ error: err.message }, err.status);
  const code =
    (err as { code?: string; cause?: { code?: string } }).code ??
    (err as { cause?: { code?: string } }).cause?.code;
  if (code === "23505")
    return c.json(
      { error: "A resource with this unique value already exists" },
      409,
    );
  console.error("[api] unhandled:", err);
  return c.json({ error: "Internal error" }, 500);
});
