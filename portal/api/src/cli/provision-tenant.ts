#!/usr/bin/env bun
import { pool } from "../db";
import { unenforcedWrite } from "../lib/capabilities";
import { provisionTenant } from "../services/provisioning";
import { runNow } from "../services/projections";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const name = arg("name");
const slug = arg("slug");
const domain = arg("domain");
const ownerEmail = arg("owner");
const tier = (arg("tier") ?? "shared") as "shared" | "dedicated";
const maxCalls = Number(arg("max-calls") ?? "10");

if (!name || !slug || !domain || !ownerEmail) {
  console.error(
    "Usage: provision-tenant.ts --name <name> --slug <slug> --domain <sip-domain> " +
      "--owner <email> [--tier shared|dedicated] [--max-calls N]",
  );
  process.exit(2);
}

// The API refuses the same setting; an operator flag must not be a way around that.
const unenforced = unenforcedWrite(
  "tenant_settings",
  { maxConcurrentCalls: maxCalls },
  undefined,
  false,
);
if (unenforced) {
  console.error(`--max-calls: ${unenforced}`);
  process.exit(2);
}

try {
  const result = await provisionTenant({
    name,
    slug,
    domain,
    ownerEmail,
    tier,
    maxCalls,
  });
  if (!(await runNow(result.projectionKeys)))
    throw new Error(
      "Saved, but publishing to Kamailio/Redis failed. The API retries queued work; " +
        "check GET /api/tenant/projections or rerun provisioning.",
    );
  console.log(
    `${result.existing ? "Reconciled" : "Provisioned"} ${name} <${result.domain}>`,
  );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
