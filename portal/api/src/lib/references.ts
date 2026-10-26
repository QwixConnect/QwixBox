import { and, eq, ne, or, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  inboundRoute,
  ivrMenu,
  ivrOption,
  queue,
  ringGroup,
  timeCondition,
} from "../db/schema";

/**
 * Everything that can point at a call destination, in one place (I04).
 *
 * Destinations are polymorphic (type, id) pairs with no foreign key, so deleting an extension,
 * ring group, IVR or time condition used to leave every pointer at it dangling. Worse, an
 * extension is cached by NUMBER: re-create 101 for someone else and an inbound DID that pointed
 * at the old 101 rang the new one from the warm tier, while the cold tier resolved nothing. A
 * destination is therefore refused deletion while anything still references it.
 *
 * A new pointer column must be added here, or its target can be deleted out from under it.
 */
export type DestinationTarget =
  | { type: "extension"; id: string; number: string }
  | { type: "ring_group" | "ivr" | "time_condition"; id: string };

type Executor = Pick<typeof db, "select">;

/** A (type, id) column pair matches the target. Voicemail points at an extension by number. */
function pointsAt(
  typeColumn: Parameters<typeof eq>[0],
  idColumn: Parameters<typeof eq>[0],
  target: DestinationTarget,
): SQL {
  const byId = and(eq(typeColumn, target.type), eq(idColumn, target.id))!;
  if (target.type !== "extension") return byId;
  return or(
    byId,
    and(eq(typeColumn, "voicemail"), eq(idColumn, target.number)),
  )!;
}

/**
 * Human-readable descriptions of every tenant-scoped reference to `target`, excluding the
 * target's own pointers (a ring group failing over to itself does not keep it alive).
 */
export async function destinationReferences(
  organizationId: string,
  target: DestinationTarget,
  executor: Executor = db,
): Promise<string[]> {
  const found: string[] = [];
  const self = (column: Parameters<typeof ne>[0], type: string) =>
    target.type === type ? ne(column, target.id) : undefined;

  const routes = await executor
    .select({ did: inboundRoute.didPattern })
    .from(inboundRoute)
    .where(
      and(
        eq(inboundRoute.organizationId, organizationId),
        pointsAt(
          inboundRoute.destinationType,
          inboundRoute.destinationId,
          target,
        ),
      ),
    );
  for (const r of routes) found.push(`inbound route ${r.did}`);

  const groups = await executor
    .select({ name: ringGroup.name })
    .from(ringGroup)
    .where(
      and(
        eq(ringGroup.organizationId, organizationId),
        pointsAt(ringGroup.failoverType, ringGroup.failoverId, target),
        self(ringGroup.id, "ring_group"),
      ),
    );
  for (const g of groups) found.push(`ring group ${g.name} (failover)`);

  const menus = await executor
    .select({ name: ivrMenu.name })
    .from(ivrMenu)
    .where(
      and(
        eq(ivrMenu.organizationId, organizationId),
        pointsAt(ivrMenu.timeoutType, ivrMenu.timeoutId, target),
        self(ivrMenu.id, "ivr"),
      ),
    );
  for (const m of menus) found.push(`IVR ${m.name} (timeout)`);

  // Options have no organization column of their own; they belong to their menu, and are
  // deleted with it, so a menu's own options do not count.
  const options = await executor
    .select({ name: ivrMenu.name, digit: ivrOption.digit })
    .from(ivrOption)
    .innerJoin(ivrMenu, eq(ivrOption.ivrMenuId, ivrMenu.id))
    .where(
      and(
        eq(ivrMenu.organizationId, organizationId),
        pointsAt(ivrOption.destinationType, ivrOption.destinationId, target),
        self(ivrMenu.id, "ivr"),
      ),
    );
  for (const o of options) found.push(`IVR ${o.name} option ${o.digit}`);

  for (const [branch, typeColumn, idColumn] of [
    ["match", timeCondition.matchType, timeCondition.matchId],
    ["no match", timeCondition.noMatchType, timeCondition.noMatchId],
  ] as const) {
    const conditions = await executor
      .select({ name: timeCondition.name })
      .from(timeCondition)
      .where(
        and(
          eq(timeCondition.organizationId, organizationId),
          pointsAt(typeColumn, idColumn, target),
          self(timeCondition.id, "time_condition"),
        ),
      );
    for (const t of conditions)
      found.push(`time condition ${t.name} (${branch})`);
  }

  const queues = await executor
    .select({ name: queue.name })
    .from(queue)
    .where(
      and(
        eq(queue.organizationId, organizationId),
        pointsAt(queue.timeoutType, queue.timeoutId, target),
      ),
    );
  for (const q of queues) found.push(`queue ${q.name} (timeout)`);

  return found;
}

/** The 409 message, or null when nothing references the target. */
export async function referencedBy(
  organizationId: string,
  target: DestinationTarget,
  executor?: Executor,
): Promise<string | null> {
  const refs = await destinationReferences(organizationId, target, executor);
  return refs.length
    ? `Still used by ${refs.join(", ")}. Point those somewhere else first.`
    : null;
}
