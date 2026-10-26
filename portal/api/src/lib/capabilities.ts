/**
 * Settings that are stored but that nothing on the call path enforces yet.
 *
 * Every one of these was writable through the API and presented as a control in the portal,
 * and changing it did nothing: a recording policy with no `record_session`, a concurrency limit
 * Kamailio never reads (it hard-codes 10 per account), and caller ID that directory variables
 * could not apply under `auth-calls=false` (since wired into outbound routing, I03 - its entries
 * were deleted here in the same change). That is the "configuration wired to nothing" failure from
 * CLAUDE.md. Rather than remember to keep the UI honest, writes are refused here and the portal
 * disables its inputs from `GET /api/capabilities`, which serves this table - so wiring a field
 * means deleting its entry, and both sides follow.
 *
 * Keyed by the audit `entityType`; `crudRoutes` checks it for every resource automatically.
 * `inert` is the value that matches what actually happens, which is always accepted. A value equal
 * to the row's current one is accepted too, so saving an unrelated field on a row that predates
 * this check still works.
 *
 * Imported by the dev mock as well, so it must not import `env` or anything with side effects.
 */
export type Unenforced = {
  inert: string | number | boolean | null;
  issue: string;
  reason: string;
};

export const UNENFORCED: Record<string, Record<string, Unenforced>> = {
  tenant_settings: {
    recordingPolicy: {
      inert: "none",
      issue: "I07",
      reason: "call recording is not implemented, so no call would be recorded",
    },
    maxConcurrentCalls: {
      inert: 10,
      issue: "R08",
      reason:
        "there is no tenant-wide limit; Kamailio allows 10 calls per extension",
    },
    stirShakenEnabled: {
      inert: false,
      issue: "D4",
      reason: "this server was not installed with STIR/SHAKEN signing",
    },
  },
  extension: {
    maxConcurrentCalls: {
      inert: null,
      issue: "R08",
      reason: "Kamailio allows 10 calls per extension regardless of this value",
    },
  },
  trunk: {
    codecPrefs: {
      inert: null,
      issue: "I08",
      reason:
        "carrier legs use FreeSWITCH's profile codecs, not a per-trunk list",
    },
    priority: {
      inert: 10,
      issue: "I08",
      reason: "an outbound route uses one trunk; there is no failover order",
    },
    fromDomain: {
      inert: null,
      issue: "I08",
      reason:
        "only registration trunks would use it, and those are unavailable",
    },
  },
};

/** The table as this server applies it: platform signing lifts the STIR entry. */
export function unenforcedFields(stirSigning: boolean) {
  if (!stirSigning) return UNENFORCED;
  const { stirShakenEnabled: _signing, ...tenant } =
    UNENFORCED.tenant_settings ?? {};
  return { ...UNENFORCED, tenant_settings: tenant };
}

/** An error message for the first unenforced field `body` would change, or null. */
export function unenforcedWrite(
  entity: string,
  body: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  stirSigning: boolean,
): string | null {
  const fields = unenforcedFields(stirSigning)[entity];
  if (!fields) return null;
  for (const [field, rule] of Object.entries(fields)) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value === rule.inert) continue;
    if (existing && value === existing[field]) continue;
    return `${field} is not enforced by this server yet (${rule.issue}): ${rule.reason}`;
  }
  return null;
}
