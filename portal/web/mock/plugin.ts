import type { Plugin } from "vite";
import { createMockApi } from "./api.ts";

export function localMockPlugin(): Plugin {
  return {
    name: "qwixbox-local-mock",
    apply: "serve",
    configureServer(server) {
      const handle = createMockApi();
      server.middlewares.use(async (req, res, next) => {
        if (!/^\/(api(?:\/|$)|health(?:\?|$)|__mock\/)/.test(req.url ?? ""))
          return next();
        try {
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 1_000_000) {
              res.statusCode = 413;
              res.end("Mock request too large");
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
          const method = req.method ?? "GET";
          const response = await handle(
            new Request(new URL(req.url ?? "/", "http://localhost"), {
              method,
              headers,
              ...(method !== "GET" && method !== "HEAD"
                ? { body: Buffer.concat(chunks) }
                : {}),
            }),
          );
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          server.config.logger.error(`Mock request failed: ${String(error)}`);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Local mock request failed" }));
        }
      });
    },
  };
}
