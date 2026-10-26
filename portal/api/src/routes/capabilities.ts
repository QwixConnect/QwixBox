import { Hono } from "hono";
import { env } from "../env";
import { unenforcedFields } from "../lib/capabilities";
import { requireTenant, type AppEnv } from "../middleware/tenant";

/**
 * What this server actually enforces, so the portal can disable inputs the API would refuse.
 * Any tenant member may read it: it describes the server, not tenant data, and every role's UI
 * needs it to render honestly.
 */
export const capabilities = new Hono<AppEnv>();
capabilities.use("*", requireTenant);

capabilities.get("/", (c) =>
  c.json({
    unenforced: unenforcedFields(env.stirSigning),
    stirSigning: env.stirSigning,
  }),
);
