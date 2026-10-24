import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { fax } from "../db/schema";
import { faxPath, recordInboundFax, type FaxReport } from "../services/fax";
import { safeEqual } from "../lib/crypto";
import {
  actionForMethod,
  requirePermission,
  requireTenant,
  type AppEnv,
} from "../middleware/tenant";

export const faxHook = new Hono();

faxHook.use("*", async (c, next) => {
  const expected = process.env.FS_XML_GATEWAY_SECRET;
  if (!expected) return c.text("FS_XML_GATEWAY_SECRET is not configured", 500);
  const direct = c.req.header("X-Gateway-Secret");
  if (direct && safeEqual(direct, expected)) return next();

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

faxHook.post("/", async (c) => {
  try {
    const report = await c.req.json<FaxReport>();
    if (!report.callUuid || !report.domain || !report.did || !report.filePath) {
      return c.json(
        { error: "callUuid, domain, did and filePath are required" },
        400,
      );
    }
    const id = await recordInboundFax(report);
    return c.json({ ok: !!id, id, status: "recorded" }, id ? 201 : 202);
  } catch (err) {
    console.error("[fax] hook failed:", (err as Error).message);
    return c.json({ error: "recorded to disk only" }, 202);
  }
});

export const faxes = new Hono<AppEnv>();
faxes.use("*", requireTenant);
faxes.use("*", async (c, next) =>
  requirePermission("recording", actionForMethod(c.req.method))(c, next),
);

faxes.get("/", async (c) => {
  const rows = await db.query.fax.findMany({
    where: eq(fax.organizationId, c.get("organizationId")),
    orderBy: [desc(fax.receivedAt)],
    limit: 200,
  });
  const out = await Promise.all(
    rows.map(async ({ filePath, ...rest }) => ({
      ...rest,
      onDisk: Boolean(filePath && (await Bun.file(filePath).exists())),
    })),
  );
  return c.json(out);
});

faxes.get("/:id/download", async (c) => {
  const row = await db.query.fax.findFirst({
    where: and(
      eq(fax.id, c.req.param("id")),
      eq(fax.organizationId, c.get("organizationId")),
    ),
  });
  if (!row?.filePath) return c.json({ error: "Not found" }, 404);

  const safePath = await faxPath(row.filePath).catch(() => null);
  if (!safePath) return c.json({ error: "Document unavailable" }, 410);
  const file = Bun.file(safePath);
  if (!(await file.exists())) {
    return c.json(
      {
        error: "The document is no longer on disk",
        receivedAt: row.receivedAt,
      },
      410,
    );
  }

  const isPdf = row.filePath.endsWith(".pdf");
  return new Response(file, {
    headers: {
      "Content-Type": isPdf ? "application/pdf" : "image/tiff",
      "Content-Disposition": `attachment; filename="fax-${row.didNumber}-${row.id.slice(0, 8)}${isPdf ? ".pdf" : ".tif"}"`,
    },
  });
});
