import { dateBound } from "../lib/date-range";
import { Hono } from "hono";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  lte,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "../db";
import { cdr, extension, trunk } from "../db/schema";
import {
  requirePermission,
  requireTenant,
  type AppEnv,
} from "../middleware/tenant";

export const cdrs = new Hono<AppEnv>();
cdrs.use("*", requireTenant);
cdrs.use("*", requirePermission("cdr", "read"));

const MAX_LIMIT = 200;
const MAX_EXPORT = 10_000;

function buildFilters(
  q: Record<string, string>,
  organizationId: string,
):
  | { filters: SQL[]; error?: undefined }
  | { filters?: undefined; error: Response } {
  let from, to;
  try {
    from = dateBound(q.from);
    to = dateBound(q.to, true);
  } catch {
    return {
      error: Response.json(
        { error: "from and to must be valid dates" },
        { status: 400 },
      ),
    };
  }

  const filters: SQL[] = [eq(cdr.organizationId, organizationId)];

  if (q.direction) {
    if (!["inbound", "outbound", "internal"].includes(q.direction)) {
      return {
        error: Response.json(
          { error: "direction must be inbound, outbound or internal" },
          { status: 400 },
        ),
      };
    }
    filters.push(
      eq(cdr.direction, q.direction as "inbound" | "outbound" | "internal"),
    );
  }
  if (q.extensionId) filters.push(eq(cdr.extensionId, q.extensionId));
  if (from) filters.push(gte(cdr.startedAt, from.date));
  if (to)
    filters.push(
      to.exclusive ? lt(cdr.startedAt, to.date) : lte(cdr.startedAt, to.date),
    );
  if (q.answered === "true") filters.push(sql`${cdr.answeredAt} is not null`);
  if (q.answered === "false") filters.push(sql`${cdr.answeredAt} is null`);

  if (q.number) {
    const term = `%${q.number.replace(/[\\%_]/g, "\\$&")}%`;
    const numberMatch = or(
      ilike(cdr.callerNumber, term),
      ilike(cdr.destinationNumber, term),
    );
    if (numberMatch) filters.push(numberMatch);
  }

  return { filters };
}

cdrs.get("/", async (c) => {
  const organizationId = c.get("organizationId");
  const q = c.req.query();

  const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), MAX_LIMIT);
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0);

  const built = buildFilters(q, organizationId);
  if (built.error) return built.error;

  const where = and(...built.filters);

  const rows = await db
    .select({
      id: cdr.id,
      callUuid: cdr.callUuid,
      direction: cdr.direction,
      callerNumber: cdr.callerNumber,
      callerName: cdr.callerName,
      destinationNumber: cdr.destinationNumber,
      startedAt: cdr.startedAt,
      answeredAt: cdr.answeredAt,
      endedAt: cdr.endedAt,
      durationSec: cdr.durationSec,
      billsecSec: cdr.billsecSec,
      hangupCause: cdr.hangupCause,
      attestation: cdr.attestation,
      extensionNumber: extension.number,
      extensionName: extension.displayName,
      trunkName: trunk.name,
    })
    .from(cdr)
    .leftJoin(extension, eq(cdr.extensionId, extension.id))
    .leftJoin(trunk, eq(cdr.trunkId, trunk.id))
    .where(where)
    .orderBy(desc(cdr.startedAt))
    .limit(limit)
    .offset(offset);

  const [totals] = await db.select({ total: count() }).from(cdr).where(where);

  return c.json({ rows, total: totals?.total ?? 0, limit, offset });
});

cdrs.get("/summary", async (c) => {
  const organizationId = c.get("organizationId");
  const built = buildFilters(c.req.query(), organizationId);
  if (built.error) return built.error;
  const filters = built.filters;

  const [row] = await db
    .select({
      calls: count(),
      answered:
        sql<number>`count(*) filter (where ${cdr.answeredAt} is not null)`.mapWith(
          Number,
        ),
      inbound:
        sql<number>`count(*) filter (where ${cdr.direction} = 'inbound')`.mapWith(
          Number,
        ),
      outbound:
        sql<number>`count(*) filter (where ${cdr.direction} = 'outbound')`.mapWith(
          Number,
        ),
      internal:
        sql<number>`count(*) filter (where ${cdr.direction} = 'internal')`.mapWith(
          Number,
        ),
      billableSec: sql<number>`coalesce(sum(${cdr.billsecSec}), 0)`.mapWith(
        Number,
      ),
    })
    .from(cdr)
    .where(and(...filters));

  const calls = row?.calls ?? 0;
  const answered = row?.answered ?? 0;
  return c.json({
    calls,
    answered,
    answerRate: calls > 0 ? answered / calls : null,
    inbound: row?.inbound ?? 0,
    outbound: row?.outbound ?? 0,
    internal: row?.internal ?? 0,
    billableSec: row?.billableSec ?? 0,
  });
});

// Above /:id or the path is swallowed.
cdrs.get("/export", requirePermission("cdr", "export"), async (c) => {
  const organizationId = c.get("organizationId");
  const q = c.req.query();

  const built = buildFilters(q, organizationId);
  if (built.error) return built.error;

  const where = and(...built.filters);

  const [totals] = await db.select({ total: count() }).from(cdr).where(where);
  const total = totals?.total ?? 0;
  if (total > MAX_EXPORT) {
    return c.json(
      {
        error: `Export exceeds ${MAX_EXPORT} rows (${total} match)`,
        detail: "Narrow the date range or other filters and try again.",
      },
      400,
    );
  }

  const rows = await db
    .select({
      callUuid: cdr.callUuid,
      direction: cdr.direction,
      callerNumber: cdr.callerNumber,
      callerName: cdr.callerName,
      destinationNumber: cdr.destinationNumber,
      startedAt: cdr.startedAt,
      answeredAt: cdr.answeredAt,
      endedAt: cdr.endedAt,
      durationSec: cdr.durationSec,
      billsecSec: cdr.billsecSec,
      hangupCause: cdr.hangupCause,
      attestation: cdr.attestation,
      extensionNumber: extension.number,
      extensionName: extension.displayName,
      trunkName: trunk.name,
    })
    .from(cdr)
    .leftJoin(extension, eq(cdr.extensionId, extension.id))
    .leftJoin(trunk, eq(cdr.trunkId, trunk.id))
    .where(where)
    .orderBy(desc(cdr.startedAt))
    .limit(MAX_EXPORT);

  const header = [
    "callUuid",
    "direction",
    "callerNumber",
    "callerName",
    "destinationNumber",
    "startedAt",
    "answeredAt",
    "endedAt",
    "durationSec",
    "billsecSec",
    "hangupCause",
    "attestation",
    "extensionNumber",
    "extensionName",
    "trunkName",
  ];

  function csvCell(v: unknown): string {
    if (v == null) return "";
    let s = v instanceof Date ? v.toISOString() : String(v);
    const phoneLike = /^[+-][\d\s().-]*$/.test(s);
    if (!phoneLike && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.callUuid,
        r.direction,
        r.callerNumber,
        r.callerName,
        r.destinationNumber,
        r.startedAt,
        r.answeredAt,
        r.endedAt,
        r.durationSec,
        r.billsecSec,
        r.hangupCause,
        r.attestation,
        r.extensionNumber,
        r.extensionName,
        r.trunkName,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const body = lines.join("\n") + "\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cdr-export.csv"`,
    },
  });
});

cdrs.get("/:id", async (c) => {
  const row = await db.query.cdr.findFirst({
    where: and(
      eq(cdr.id, c.req.param("id")),
      eq(cdr.organizationId, c.get("organizationId")),
    ),
  });
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});
