import { Hono } from "hono";
import { ingestCdr } from "../services/cdr";

export const fsCdr = new Hono();

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

fsCdr.use("*", async (c, next) => {
  const expected = process.env.FS_XML_GATEWAY_SECRET;
  if (!expected) return c.text("FS_XML_GATEWAY_SECRET is not configured", 500);

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

fsCdr.post("/", async (c) => {
  const contentType = c.req.header("Content-Type") ?? "";
  let xml: string;
  if (contentType.includes("xml")) {
    xml = await c.req.text();
  } else {
    const form = await c.req.parseBody();
    xml = String(form["cdr"] ?? "");
  }

  if (!xml) return c.text("empty CDR", 400);

  try {
    const result = await ingestCdr(xml);
    if (!result.stored) {
      console.warn(`[cdr] not stored: ${result.reason}`);
      return c.text(`ignored: ${result.reason}`, 200);
    }
    return c.text("OK", 200);
  } catch (err) {
    console.error(`[cdr] ingest failed: ${(err as Error).message}`);
    return c.text("ingest failed", 500);
  }
});
