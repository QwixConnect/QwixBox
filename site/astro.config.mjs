import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://qwixbox.com",
  // Fully static: the Worker only needs to serve assets and branch on hostname, so there is no
  // adapter and no server runtime.
  output: "static",
});
