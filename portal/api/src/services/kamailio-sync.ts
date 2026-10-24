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

export async function reloadKamailio(): Promise<boolean> {
  const commands = [
    "permissions.addressReload",
    "dispatcher.reload",
    "domain.reload",
  ];
  let ok = true;

  for (const command of commands) {
    try {
      const proc = Bun.spawn(["kamcmd", command], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      if (proc.exitCode !== 0 || /ERROR|Permission denied/i.test(stderr)) {
        console.warn(
          `[kamailio-sync] ${command} failed: ${stderr.trim() || `exit ${proc.exitCode}`}`,
        );
        ok = false;
      }
    } catch (err) {
      console.warn(
        `[kamailio-sync] ${command} failed:`,
        (err as Error).message,
      );
      ok = false;
    }
  }

  return ok;
}
