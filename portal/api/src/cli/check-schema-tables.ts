#!/usr/bin/env bun
// Run BEFORE schema push. `drizzle-kit push --force` treats a table that exists in the database
// but not in the schema in one of two ways, both bad on an unattended upgrade: if the same push
// also adds a table it stops to ask whether that is a rename, which fails without a TTY and
// aborts step 41; otherwise it drops the table, data and all. Upgrading an install that still had
// `apikey` (removed in I16) to a schema that adds `projection_job` (R06) hit the first case.
//
// So removing a table is an explicit act: list it in RETIRED_TABLES and it is dropped here,
// logged, before the push. Anything else unknown stops the upgrade with its name.
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { pool } from "../db";
import * as schema from "../db/schema";

// Tables a release has deliberately removed. Keep entries: an install may skip versions.
const RETIRED_TABLES = [
  // @better-auth/api-key, disabled in 71a809e and removed in I16. Rows are hashes of keys that
  // nothing can verify any more.
  "apikey",
];

const known = new Set(
  Object.values(schema)
    .filter((value) => is(value, PgTable))
    .map((table) => getTableName(table as PgTable)),
);

try {
  for (const table of RETIRED_TABLES) {
    if (known.has(table))
      throw new Error(`${table} is both retired and in the schema`);
    const { rows } = await pool.query(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [`public.${table}`],
    );
    if (!rows[0].present) continue;
    const count = await pool.query(`SELECT count(*)::int AS n FROM "${table}"`);
    await pool.query(`DROP TABLE "${table}" CASCADE`);
    console.log(`Dropped retired table ${table} (${count.rows[0].n} rows).`);
  }

  const { rows } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const unknown = rows
    .map((row) => row.tablename as string)
    .filter((name) => !known.has(name));
  for (const name of unknown)
    console.error(
      `Table ${name} is in the database but not in the schema. Add it to RETIRED_TABLES in ` +
        `src/cli/check-schema-tables.ts if it was removed on purpose, or restore it to the schema.`,
    );
  process.exitCode = unknown.length ? 1 : 0;
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
