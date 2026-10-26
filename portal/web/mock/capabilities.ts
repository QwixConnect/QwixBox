// A copy of UNENFORCED in portal/api/src/lib/capabilities.ts, served at /api/capabilities so the
// mock disables the same inputs a real server would refuse. The web build cannot import the API
// package directly (its files resolve as CommonJS under this tsconfig), so this is a copy - and
// tests/portal-mock.test.ts fails if it ever differs from the API's table.
export const UNENFORCED: Record<
  string,
  Record<string, { inert: string | number | boolean | null; issue: string; reason: string }>
> = {
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
