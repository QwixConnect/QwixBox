import { Hono } from "hono";
import { safeEqual } from "../lib/crypto";
import { callState } from "../services/call-state";

export const fsState = new Hono();
fsState.post("/", async (c) => {
  const secret = process.env.FS_XML_GATEWAY_SECRET;
  if (!secret || !safeEqual(c.req.header("X-Gateway-Secret") ?? "", secret))
    return c.json({ ok: false }, 401);
  const body = await c.req.json();
  if (
    typeof body.domain !== "string" ||
    typeof body.kind !== "string" ||
    typeof body.id !== "string"
  )
    return c.json({ ok: false }, 400);
  const data = await callState(body.domain, body.kind, body.id);
  return c.json({ ok: data !== null, data });
});
