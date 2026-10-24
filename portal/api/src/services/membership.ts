import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db";
import { member, organization, user } from "../db/schema";

export async function changeMembership(input: {
  organizationId: string;
  actorId?: string; // Omitted only by the local operator CLI.
  email?: string;
  memberId?: string;
  role?: string;
  remove?: boolean;
}) {
  const { organizationId, actorId, remove } = input;
  const role = input.role ?? "member";
  if (!["owner", "admin", "member", "viewer"].includes(role))
    throw new HTTPException(400, { message: "Unknown role" });
  return db.transaction(async (tx) => {
    // Serialize all membership writes, including simultaneous demotions of two owners.
    const [org] = await tx
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .for("update");
    if (!org) throw new HTTPException(404, { message: "Tenant not found" });
    const members = await tx
      .select()
      .from(member)
      .where(eq(member.organizationId, organizationId));
    const actor = members.find((m) => m.userId === actorId);
    if (actorId && (!actor || !["owner", "admin"].includes(actor.role)))
      throw new HTTPException(403, { message: "Insufficient permissions" });
    const account = input.email
      ? await tx.query.user.findFirst({
          where: eq(user.email, input.email.trim().toLowerCase()),
        })
      : undefined;
    const existing = members.find((m) =>
      input.memberId ? m.id === input.memberId : m.userId === account?.id,
    );
    if (
      actorId &&
      actor?.role !== "owner" &&
      (role === "owner" || existing?.role === "owner")
    )
      throw new HTTPException(403, {
        message: "Only owners may alter ownership",
      });
    if (
      existing?.role === "owner" &&
      (remove || role !== "owner") &&
      members.filter((m) => m.role === "owner").length <= 1
    )
      throw new HTTPException(409, {
        message: "The last owner cannot be removed or demoted",
      });
    if (!existing && (!account || remove || input.memberId))
      throw new HTTPException(400, {
        message: "Member could not be changed; contact the operator",
      });
    if (remove) {
      await tx
        .delete(member)
        .where(
          and(
            eq(member.id, existing!.id),
            eq(member.organizationId, organizationId),
          ),
        );
      return { before: existing, after: null, status: "removed" };
    }
    if (existing) {
      const [after] = await tx
        .update(member)
        .set({ role })
        .where(eq(member.id, existing.id))
        .returning();
      return {
        before: existing,
        after,
        status: existing.role === role ? "unchanged" : "updated",
      };
    }
    const [after] = await tx
      .insert(member)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        userId: account!.id,
        role,
      })
      .returning();
    return { before: undefined, after, status: "created" };
  });
}
