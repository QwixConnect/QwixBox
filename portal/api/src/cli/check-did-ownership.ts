#!/usr/bin/env bun
// Run BEFORE schema push. Never silently choose a winner or delete a tenant's routes.
import { pool } from "../db";

if (
  (await pool.query("SELECT to_regclass('public.inbound_route') AS table_name"))
    .rows[0].table_name
) {
  const result = await pool.query(
    "SELECT did_pattern, count(*) AS owners FROM inbound_route GROUP BY did_pattern HAVING count(*) > 1",
  );
  for (const row of result.rows)
    console.error(
      `DID ${row.did_pattern}: ${row.owners} routes. Resolve ownership before upgrading.`,
    );
  await pool.end();
  process.exit(result.rowCount ? 1 : 0);
}
await pool.end();
