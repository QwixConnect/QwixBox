import pg from "pg";
import { isIP } from "node:net";
import { env } from "../env";
import { computeHa1, computeHa1b } from "../lib/crypto";
import type {
  extension as extensionTable,
  trunk as trunkTable,
} from "../db/schema";

type ExtensionRow = typeof extensionTable.$inferSelect;
type TrunkRow = typeof trunkTable.$inferSelect;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool | null {
  if (!env.kamailioDatabaseUrl) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env.kamailioDatabaseUrl,
      max: 5,
      connectionTimeoutMillis: 5_000,
    });
    pool.on("error", (err) =>
      console.error("[kamailio-sync] pool error:", err.message),
    );
  }
  return pool;
}

export async function syncSubscriber(
  ext: ExtensionRow,
  sipDomain: string,
  plaintextPassword: string,
): Promise<boolean> {
  const p = getPool();
  if (!p) {
    console.warn(
      "[kamailio-sync] KAMAILIO_DATABASE_URL not set — subscriber not projected",
    );
    throw new Error(
      "KAMAILIO_DATABASE_URL is required for subscriber projection",
    );
  }

  if (!ext.enabled) return removeSubscriber(ext.number, sipDomain);

  const ha1 = computeHa1(ext.number, sipDomain, plaintextPassword);
  const ha1b = computeHa1b(ext.number, sipDomain, plaintextPassword);

  try {
    await p.query(
      `INSERT INTO subscriber (username, domain, password, ha1, ha1b)
       VALUES ($1, $2, '', $3, $4)
       ON CONFLICT (username, domain)
       DO UPDATE SET ha1 = EXCLUDED.ha1, ha1b = EXCLUDED.ha1b, password = ''`,
      [ext.number, sipDomain, ha1, ha1b],
    );
    return true;
  } catch (err) {
    console.error(
      `[kamailio-sync] subscriber ${ext.number}@${sipDomain}:`,
      (err as Error).message,
    );
    throw err;
  }
}

export async function removeSubscriber(
  username: string,
  sipDomain: string,
): Promise<boolean> {
  const p = getPool();
  if (!p) throw new Error("KAMAILIO_DATABASE_URL is required for projection");
  try {
    await p.query(
      `DELETE FROM subscriber WHERE username = $1 AND domain = $2`,
      [username, sipDomain],
    );
    await p.query(`DELETE FROM location WHERE username = $1 AND domain = $2`, [
      username,
      sipDomain,
    ]);
    return true;
  } catch (err) {
    console.error(
      `[kamailio-sync] remove ${username}@${sipDomain}:`,
      (err as Error).message,
    );
    throw err;
  }
}

export async function syncDomain(sipDomain: string): Promise<boolean> {
  const p = getPool();
  if (!p) throw new Error("KAMAILIO_DATABASE_URL is required for projection");
  try {
    await p.query(
      `INSERT INTO domain (domain, did) VALUES ($1, $1) ON CONFLICT (domain) DO NOTHING`,
      [sipDomain],
    );
    return true;
  } catch (err) {
    console.error(
      `[kamailio-sync] domain ${sipDomain}:`,
      (err as Error).message,
    );
    throw err;
  }
}

export async function syncTrunkAddress(trunk: TrunkRow): Promise<boolean> {
  const p = getPool();
  if (!p)
    throw new Error("KAMAILIO_DATABASE_URL is required for trunk projection");
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      trunk.id,
    ]);
    await client.query("DELETE FROM address WHERE tag = $1", [trunk.id]);
    if (trunk.enabled && trunk.authMode === "ip") {
      const version = isIP(trunk.host);
      if (!version)
        throw new Error("IP-authenticated trunks require an IP literal");
      await client.query(
        "INSERT INTO address (grp, ip_addr, mask, port, tag) VALUES (1, $1, $2, $3, $4)",
        [trunk.host, version === 6 ? 128 : 32, trunk.port, trunk.id],
      );
    }
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function removeTrunkAddress(trunkId: string): Promise<boolean> {
  const p = getPool();
  if (!p) throw new Error("KAMAILIO_DATABASE_URL is required for projection");
  try {
    await p.query(`DELETE FROM address WHERE tag = $1`, [trunkId]);
    return true;
  } catch (err) {
    console.error(
      `[kamailio-sync] remove trunk address:`,
      (err as Error).message,
    );
    throw err;
  }
}

/**
 * Replace a tenant's emergency patterns in Kamailio, which loads `emergency_pattern` into the
 * htable array `emergency=><domain>[i]` and exempts a matching call from its capacity check on
 * ingress (I02). Rows are keyed by organization so a changed domain leaves nothing behind; the
 * caller reloads the htable, as for the other projected tables.
 */
export async function syncEmergencyPatterns(
  organizationId: string,
  sipDomain: string | null,
  patterns: readonly string[],
): Promise<boolean> {
  const p = getPool();
  if (!p) throw new Error("KAMAILIO_DATABASE_URL is required for projection");
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM emergency_pattern WHERE organization_id = $1",
      [organizationId],
    );
    if (sipDomain)
      for (const pattern of patterns)
        await client.query(
          `INSERT INTO emergency_pattern (key_name, key_type, value_type, key_value, organization_id)
           VALUES ($1, 1, 0, $2, $3)`,
          [sipDomain, pattern, organizationId],
        );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type KamailioExpected = {
  subscribers: readonly { username: string; domain: string }[];
  trunkIds: readonly string[];
  domains: readonly string[];
  organizationIds: readonly string[];
};

/**
 * Delete what Kamailio holds that our database does not (I14). Projection jobs only ever act on
 * a row they can name, so after a database restore the credentials, trusted addresses, domains and
 * emergency patterns of everything created since the dump would outlive it: a deleted extension
 * could still register. Location rows go with their subscriber, as in removeSubscriber(). An
 * address row without a tag was not written by us and is left alone.
 */
export async function pruneKamailio(
  expected: KamailioExpected,
): Promise<Record<string, number>> {
  const p = getPool();
  if (!p) throw new Error("KAMAILIO_DATABASE_URL is required for projection");
  const subscribers = expected.subscribers.map(
    (s) => `${s.username}@${s.domain}`,
  );
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const removed = await client.query(
      `DELETE FROM subscriber WHERE NOT (username || '@' || domain = ANY($1::text[]))
       RETURNING username, domain`,
      [subscribers],
    );
    const location = await client.query(
      `DELETE FROM location WHERE username || '@' || domain = ANY($1::text[])`,
      [removed.rows.map((r) => `${r.username}@${r.domain}`)],
    );
    const address = await client.query(
      "DELETE FROM address WHERE tag IS NOT NULL AND NOT (tag = ANY($1::text[]))",
      [expected.trunkIds],
    );
    const domain = await client.query(
      "DELETE FROM domain WHERE NOT (domain = ANY($1::text[]))",
      [expected.domains],
    );
    const emergency = await client.query(
      "DELETE FROM emergency_pattern WHERE NOT (organization_id = ANY($1::text[]))",
      [expected.organizationIds],
    );
    await client.query("COMMIT");
    return {
      subscriber: removed.rowCount ?? 0,
      location: location.rowCount ?? 0,
      address: address.rowCount ?? 0,
      domain: domain.rowCount ?? 0,
      emergency_pattern: emergency.rowCount ?? 0,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Whether a kamcmd run failed. kamcmd exits 0 even when the RPC fails, and reports two kinds of
 * failure on different streams: a socket it cannot open on stderr, and an RPC error on STDOUT
 * (`error: 500 - ongoing reload`, which permissions and dispatcher return for a reload within
 * five seconds of the last). Reading stderr alone reported that refusal as success, so the
 * projection job completed and a new trunk's address never became trusted.
 */
export function kamcmdFailed(
  exitCode: number | null,
  stdout: string,
  stderr: string,
): boolean {
  return (
    exitCode !== 0 ||
    /ERROR|Permission denied/i.test(stderr) ||
    /^error\b/im.test(stdout)
  );
}

/** Whether Kamailio answers on its control socket, for /health. */
export async function kamailioResponds(): Promise<boolean> {
  const proc = Bun.spawn(["kamcmd", "core.uptime"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return !kamcmdFailed(proc.exitCode, stdout, stderr) && /uptime/i.test(stdout);
}

/** Kamailio's in-memory copies of the tables this API writes, and the RPC that reloads each. */
export const RELOADS = {
  addresses: ["permissions.addressReload"],
  dispatcher: ["dispatcher.reload"],
  domains: ["domain.reload"],
  emergency: ["htable.reload", "emergency"],
} as const;

/**
 * Reload the named copies, all by default. Name only what changed: permissions and dispatcher
 * refuse a reload within five seconds of the last, so a route change that reloaded them too was
 * refused whenever it followed a trunk change, and waited out a retry.
 */
export async function reloadKamailio(
  only: readonly (keyof typeof RELOADS)[] = Object.keys(
    RELOADS,
  ) as (keyof typeof RELOADS)[],
): Promise<boolean> {
  const commands = only.map((name) => RELOADS[name]);
  let ok = true;

  for (const command of commands) {
    try {
      const proc = Bun.spawn(["kamcmd", ...command], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;

      if (kamcmdFailed(proc.exitCode, stdout, stderr)) {
        console.warn(
          `[kamailio-sync] ${command.join(" ")} failed: ${stderr.trim() || stdout.trim() || `exit ${proc.exitCode}`}`,
        );
        ok = false;
      }
    } catch (err) {
      console.warn(
        `[kamailio-sync] ${command.join(" ")} failed:`,
        (err as Error).message,
      );
      ok = false;
    }
  }

  return ok;
}
