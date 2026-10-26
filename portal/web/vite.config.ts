import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";
import { localMockPlugin } from "./mock/plugin.ts";

/**
 * Fixture records must never reach a real bundle. The client once imported `mock/data.ts` to
 * paper over 404s, and production displayed invented E911 addresses as if the server held them.
 * This makes that structural: outside mock mode, any module graph that loads a file under
 * `mock/` fails the build instead of shipping it. (`src/mock/` is the dev-only controls panel,
 * which holds no fixtures, and is a different directory.)
 */
const FIXTURE_DIR = fileURLToPath(new URL("./mock/", import.meta.url));
// The simulated browser phone (no SIP client, I23) is held to the same rule: _app.tsx loads it
// only in mock mode, and nothing else may pull it into a real build.
const SIMULATED_PHONE = fileURLToPath(
  new URL("./src/components/WebphoneDrawer.tsx", import.meta.url),
);
function refuseFixtures(): Plugin {
  return {
    name: "qwixbox-refuse-fixtures",
    load(id) {
      if (id.startsWith(FIXTURE_DIR) || id === SIMULATED_PHONE) {
        throw new Error(
          `${id} is mock-only code and must not be bundled outside mock mode ` +
            `(imported into the app graph). Serve the data from the mock middleware instead.`,
        );
      }
      return null;
    },
  };
}

/**
 * In production nginx serves this bundle and proxies /api to the Hono API on loopback, so the
 * client uses a relative base and needs no host configuration. The dev server has no nginx in
 * front of it, so it proxies the same paths itself - otherwise `bun run dev` hits Vite for
 * /api/* and gets index.html back with a 200, which surfaces as a JSON parse error rather than
 * as "there is no API here".
 *
 * VITE_API_PROXY points it at an API on a different host or port.
 */
const API_TARGET = process.env.VITE_API_PROXY ?? "http://127.0.0.1:3000";

export default defineConfig(({ mode, command, isPreview }) => {
  if (mode === "mock" && (command === "build" || isPreview)) {
    throw new Error("Mock mode is development-only. Run bun run dev:mock.");
  }
  return {
    define:
      mode === "mock"
        ? { "import.meta.env.VITE_API_BASE": JSON.stringify("/api") }
        : {},
    plugins: [
      ...(mode === "mock" ? [localMockPlugin()] : [refuseFixtures()]),
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
      }),
      react(),
    ],
    server: {
      proxy:
        mode === "mock"
          ? undefined
          : {
              "/api": { target: API_TARGET, changeOrigin: true },
              "/health": { target: API_TARGET, changeOrigin: true },
            },
    },
    preview: {
      proxy: {
        "/api": { target: API_TARGET, changeOrigin: true },
        "/health": { target: API_TARGET, changeOrigin: true },
      },
    },
  };
});
