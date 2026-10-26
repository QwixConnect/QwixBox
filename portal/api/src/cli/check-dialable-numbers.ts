#!/usr/bin/env bun
// Report numbers held by more than one dialable resource in a tenant, which only an install from
// before I19 can have. Warns rather than fails: both XML tiers now pick the same winner (extension,
// then ring group, then IVR), so nothing diverges, but the shadowed resource is unreachable by
// number until it is renumbered. Never renumbers anything itself.
import { getTableName } from "drizzle-orm";
import { pool } from "../db";
import { DIALABLE } from "../lib/numbers";

const union = DIALABLE.map(
  (entry) =>
    `SELECT organization_id, number, '${entry.label}' AS label FROM ${getTableName(entry.table)}`,
).join(" UNION ALL ");
const result = await pool.query(
  `SELECT organization_id, number, string_agg(label, ', ' ORDER BY label) AS holders
   FROM (${union}) n GROUP BY organization_id, number HAVING count(*) > 1`,
);
for (const row of result.rows)
  console.warn(
    `Tenant ${row.organization_id}: number ${row.number} is held by ${row.holders}. Renumber all but one.`,
  );
await pool.end();
