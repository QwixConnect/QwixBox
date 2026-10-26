import { and, eq, ne, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import type { Tx } from "../services/projections";
import { extension, ivrMenu, queue, ringGroup } from "../db/schema";

/**
 * Every table whose rows own a number a caller can dial, in one place (I19).
 *
 * Each table had its own (organization, number) unique index, so a ring group and an IVR could
 * both be 600. The two XML tiers then disagreed: the warm cache wrote both into one
 * `qwixbox:num:` key and the IVR, written last, won; the cold tier asked for ring groups first.
 * A number now belongs to one resource across all of these tables.
 *
 * crudRoutes claims automatically for any table listed here, and a test fails when a schema
 * table with a `number` column is missing - so a new dialable type cannot skip the check.
 * Feature codes start with `*` and numbers are digits only, so the two cannot collide.
 */
export const DIALABLE: readonly {
  kind: string;
  label: string;
  table: PgTable;
  org: PgColumn;
  number: PgColumn;
  id: PgColumn;
  name: PgColumn;
}[] = [
  {
    kind: "extension",
    label: "extension",
    table: extension,
    org: extension.organizationId,
    number: extension.number,
    id: extension.id,
    name: extension.displayName,
  },
  {
    kind: "ring_group",
    label: "ring group",
    table: ringGroup,
    org: ringGroup.organizationId,
    number: ringGroup.number,
    id: ringGroup.id,
    name: ringGroup.name,
  },
  {
    kind: "ivr",
    label: "IVR",
    table: ivrMenu,
    org: ivrMenu.organizationId,
    number: ivrMenu.number,
    id: ivrMenu.id,
    name: ivrMenu.name,
  },
  {
    kind: "queue",
    label: "queue",
    table: queue,
    org: queue.organizationId,
    number: queue.number,
    id: queue.id,
    name: queue.name,
  },
];

export function dialableTable(table: PgTable) {
  return DIALABLE.find((entry) => entry.table === table);
}

/**
 * Refuse `number` if any other dialable resource in the tenant holds it. Call inside the write's
 * transaction: the advisory lock is held until commit, so two creates of one number in different
 * tables serialise and the second sees the first. `self` is the row being changed, if any.
 */
export async function claimNumber(
  tx: Tx,
  organizationId: string,
  number: string,
  self?: { table: PgTable; id: string },
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`qwixbox:numbers:${organizationId}`}))`,
  );
  for (const entry of DIALABLE) {
    const [holder] = await tx
      .select({ name: entry.name })
      .from(entry.table)
      .where(
        and(
          eq(entry.org, organizationId),
          eq(entry.number, number),
          self?.table === entry.table ? ne(entry.id, self.id) : undefined,
        ),
      )
      .limit(1);
    if (holder)
      throw new HTTPException(409, {
        message: `Number ${number} is already used by ${entry.label} ${String(holder.name)}`,
      });
  }
}
