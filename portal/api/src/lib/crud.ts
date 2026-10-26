import { unsafeDialplanFields } from "./dialplan-safe";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, type SQL } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import { db } from "../db";
import { recordAudit } from "./audit";
import { enqueue, runNow, type Projection } from "../services/projections";
import { unenforcedWrite } from "./capabilities";
import { claimNumber, dialableTable } from "./numbers";
import { env } from "../env";
import {
  actionForMethod,
  requirePermission,
  requireTenant,
  type AppEnv,
} from "../middleware/tenant";

type Row = Record<string, unknown>;

export type CrudOptions<T extends PgTable> = {
  table: T;
  orgColumn: PgColumn;
  idColumn: PgColumn;
  entityType: string;

  // Required, not optional: optional would let a resource be wired up with no permission check.
  permission: string;

  writable: readonly string[];
  required?: readonly string[];

  present?: (row: Row) => Row;

  beforeDelete?: (organizationId: string, row: Row) => Promise<string | null>;

  // Required, for the same reason as `permission`: what a change must publish to Redis and
  // Kamailio. The jobs commit in the write's own transaction (R06), so a resource cannot be added
  // that silently skips the outbox. A resource with nothing to publish returns [] explicitly.
  project: (
    organizationId: string,
    row: Row,
    action: "create" | "update" | "delete",
  ) => readonly Projection[];

  validate?: (
    body: Row,
    organizationId: string,
    existing?: Row,
  ) => Promise<string | null>;
};

export async function tenantOwns(
  table: PgTable,
  orgColumn: PgColumn,
  idColumn: PgColumn,
  id: unknown,
  organizationId: string,
): Promise<boolean> {
  if (typeof id !== "string" || id === "") return false;
  const rows = await db
    .select({ id: idColumn })
    .from(table)
    .where(and(eq(idColumn, id), eq(orgColumn, organizationId)))
    .limit(1);
  return rows.length > 0;
}

function pick(body: Row, writable: readonly string[]): Row {
  const out: Row = {};
  for (const key of writable) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

export function crudRoutes<T extends PgTable>(opts: CrudOptions<T>) {
  const app = new Hono<AppEnv>();
  const dialable = dialableTable(opts.table);
  app.use("*", requireTenant);

  app.use("*", async (c, next) => {
    const action = actionForMethod(c.req.method);
    return requirePermission(opts.permission, action)(c, next);
  });

  const present = opts.present ?? ((r: Row) => r);

  const scoped = (orgId: string, extra?: SQL) =>
    extra ? and(eq(opts.orgColumn, orgId), extra) : eq(opts.orgColumn, orgId);

  app.get("/", async (c) => {
    const rows = await db
      .select()
      .from(opts.table as PgTable)
      .where(scoped(c.get("organizationId")));
    return c.json(rows.map((r) => present(r as Row)));
  });

  app.get("/:id", async (c) => {
    const [row] = await db
      .select()
      .from(opts.table as PgTable)
      .where(
        scoped(c.get("organizationId"), eq(opts.idColumn, c.req.param("id"))),
      );
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(present(row as Row));
  });

  app.post("/", async (c) => {
    const organizationId = c.get("organizationId");
    const body = await c.req.json<Row>().catch(() => ({}) as Row);

    for (const field of opts.required ?? []) {
      if (
        body[field] === undefined ||
        body[field] === null ||
        body[field] === ""
      ) {
        return c.json({ error: `${field} is required` }, 400);
      }
    }
    const unsafe = unsafeDialplanFields(body);
    if (unsafe) return c.json({ error: unsafe }, 400);
    const unenforced = unenforcedWrite(
      opts.entityType,
      body,
      undefined,
      env.stirSigning,
    );
    if (unenforced) return c.json({ error: unenforced }, 400);
    if (opts.validate) {
      const problem = await opts.validate(body, organizationId);
      if (problem) return c.json({ error: problem }, 400);
    }

    const values = {
      ...pick(body, opts.writable),
      id: randomUUID(),
      organizationId,
    };
    const { row, jobs } = await db.transaction(async (tx) => {
      // Any table in the dialable registry, without an opt-in that could be forgotten (I19).
      const number = (values as Row).number;
      if (dialable && typeof number === "string")
        await claimNumber(tx, organizationId, number);
      const [row] = (await tx
        .insert(opts.table)
        .values(values as never)
        .returning()) as Row[];
      if (!row) return { row, jobs: [] };
      const jobs = await enqueue(
        tx,
        organizationId,
        opts.project(organizationId, row, "create"),
      );
      return { row, jobs };
    });
    if (!row) return c.json({ error: "Insert failed" }, 500);

    await runNow(jobs);
    await recordAudit(c, {
      action: "create",
      entityType: opts.entityType,
      entityId: row.id as string,
      after: row,
    });
    return c.json(present(row), 201);
  });

  app.patch("/:id", async (c) => {
    const organizationId = c.get("organizationId");
    const id = c.req.param("id");

    const [before] = await db
      .select()
      .from(opts.table as PgTable)
      .where(scoped(organizationId, eq(opts.idColumn, id)));
    if (!before) return c.json({ error: "Not found" }, 404);

    const body = await c.req.json<Row>().catch(() => ({}) as Row);
    const unsafe = unsafeDialplanFields(body);
    if (unsafe) return c.json({ error: unsafe }, 400);
    const unenforced = unenforcedWrite(
      opts.entityType,
      body,
      before as Row,
      env.stirSigning,
    );
    if (unenforced) return c.json({ error: unenforced }, 400);
    if (opts.validate) {
      const problem = await opts.validate(body, organizationId, before as Row);
      if (problem) return c.json({ error: problem }, 400);
    }

    const patch = pick(body, opts.writable);
    if (Object.keys(patch).length === 0) return c.json(present(before as Row));

    const { row, jobs } = await db.transaction(async (tx) => {
      if (dialable && typeof patch.number === "string")
        await claimNumber(tx, organizationId, patch.number, {
          table: opts.table,
          id,
        });
      const [row] = (await tx
        .update(opts.table)
        .set(patch as never)
        .where(scoped(organizationId, eq(opts.idColumn, id)))
        .returning()) as Row[];
      if (!row) return { row, jobs: [] };
      const jobs = await enqueue(
        tx,
        organizationId,
        opts.project(organizationId, row, "update"),
      );
      return { row, jobs };
    });
    if (!row) return c.json({ error: "Update failed" }, 500);

    await runNow(jobs);
    await recordAudit(c, {
      action: "update",
      entityType: opts.entityType,
      entityId: id,
      before: before as Row,
      after: row,
    });
    return c.json(present(row));
  });

  app.delete("/:id", async (c) => {
    const organizationId = c.get("organizationId");
    const id = c.req.param("id");

    const [before] = await db
      .select()
      .from(opts.table as PgTable)
      .where(scoped(organizationId, eq(opts.idColumn, id)));
    if (!before) return c.json({ error: "Not found" }, 404);

    const conflict = await opts.beforeDelete?.(organizationId, before as Row);
    if (conflict) return c.json({ error: conflict }, 409);
    const jobs = await db.transaction(async (tx) => {
      await tx
        .delete(opts.table)
        .where(scoped(organizationId, eq(opts.idColumn, id)));
      return enqueue(
        tx,
        organizationId,
        opts.project(organizationId, before as Row, "delete"),
      );
    });

    await runNow(jobs);
    await recordAudit(c, {
      action: "delete",
      entityType: opts.entityType,
      entityId: id,
      before: before as Row,
    });
    return c.body(null, 204);
  });

  return app;
}
