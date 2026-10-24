#!/usr/bin/env bun
import { pool } from "../db";
import { provisionTenant } from "../services/provisioning";
import { rebuildTenant } from "../services/cache";
import { reloadKamailio, syncDomain } from "../services/kamailio-sync";

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

try {
  const result = await provisionTenant({
    name,
    slug,
    domain,
    ownerEmail,
    tier,
    maxCalls,
  });
  await syncDomain(result.domain);
  if (!(await reloadKamailio()))
    throw new Error("Kamailio reload failed; rerun provisioning to reconcile.");
  await rebuildTenant(result.organizationId);
  console.log(
    `${result.existing ? "Reconciled" : "Provisioned"} ${name} <${result.domain}>`,
  );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
