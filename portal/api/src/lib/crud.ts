import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, type SQL } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import { db } from "../db";
import { recordAudit } from "./audit";
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

  afterChange?: (
    organizationId: string,
    row: Row,
    action: string,
  ) => Promise<void>;

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
  app.use("*", requireTenant);

  app.use("*", async (c, next) => {
    const action = actionForMethod(c.req.method);
    return requirePermission(opts.permission, action)(c, next);
  });

  const present = opts.present ?? ((r: Row) => r);

  const after = async (orgId: string, row: Row, action: string) => {
    if (!opts.afterChange) return;
    try {
      await opts.afterChange(orgId, row, action);
    } catch (err) {
      console.error(
        `[${opts.entityType}] afterChange failed:`,
        (err as Error).message,
      );
    }
  };

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
    if (opts.validate) {
      const problem = await opts.validate(body, organizationId);
      if (problem) return c.json({ error: problem }, 400);
    }

    const values = {
      ...pick(body, opts.writable),
      id: randomUUID(),
      organizationId,
    };
    const inserted = (await db
      .insert(opts.table)
      .values(values as never)
      .returning()) as Row[];
    const row = inserted[0];
    if (!row) return c.json({ error: "Insert failed" }, 500);

    await after(organizationId, row, "create");
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
    if (opts.validate) {
      const problem = await opts.validate(body, organizationId, before as Row);
      if (problem) return c.json({ error: problem }, 400);
    }

    const patch = pick(body, opts.writable);
    if (Object.keys(patch).length === 0) return c.json(present(before as Row));

    const updated = (await db
      .update(opts.table)
      .set(patch as never)
      .where(scoped(organizationId, eq(opts.idColumn, id)))
      .returning()) as Row[];
    const row = updated[0];
    if (!row) return c.json({ error: "Update failed" }, 500);

    await after(organizationId, row, "update");
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

    await db
      .delete(opts.table)
      .where(scoped(organizationId, eq(opts.idColumn, id)));

    await after(organizationId, before as Row, "delete");
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
