/**
 * Client-side role awareness for the portal UI.
 *
 * This gate is convenience, not security. The server re-reads the `member` row on every
 * request (`portal/api/src/middleware/tenant.ts`) and enforces via `requirePermission`. Hiding
 * a button here only stops a 403 from teaching the operator what they cannot do.
 *
 * The permission table below mirrors `ROLES` in `portal/api/src/auth.ts:48-78`. Mirror rather
 * than import: the API is a separate package and the client cannot reach
 * `better-auth/plugins/access` server roles. Edit both when the statement changes.
 */
import { useQuery } from "@tanstack/react-query";
import { authClient } from "./auth-client";

export type RoleName = "owner" | "admin" | "member" | "viewer";

export type PermissionAction = "create" | "read" | "update" | "delete" | "export";

export type PermissionResource =
  | "extension"
  | "trunk"
  | "route"
  | "callflow"
  | "cdr"
  | "recording"
  | "tenant"
  | "audit";

type Action = PermissionAction;
type Resource = PermissionResource;

/** Mirrors portal/api/src/auth.ts ROLES. Keep in sync. */
const PERMISSIONS: Record<RoleName, Partial<Record<Resource, readonly Action[]>>> = {
  viewer: {
    extension: ["read"],
    trunk: ["read"],
    route: ["read"],
    callflow: ["read"],
    cdr: ["read"],
    tenant: ["read"],
  },
  member: {
    extension: ["create", "read", "update", "delete"],
    trunk: ["read"],
    route: ["read"],
    callflow: ["create", "read", "update", "delete"],
    cdr: ["read"],
    recording: ["read"],
    tenant: ["read"],
  },
  admin: {
    extension: ["create", "read", "update", "delete"],
    trunk: ["create", "read", "update", "delete"],
    route: ["create", "read", "update", "delete"],
    callflow: ["create", "read", "update", "delete"],
    cdr: ["read", "export"],
    recording: ["read", "delete"],
    tenant: ["read", "update"],
    audit: ["read"],
  },
  owner: {
    extension: ["create", "read", "update", "delete"],
    trunk: ["create", "read", "update", "delete"],
    route: ["create", "read", "update", "delete"],
    callflow: ["create", "read", "update", "delete"],
    cdr: ["read", "export"],
    recording: ["read", "delete"],
    tenant: ["read", "update"],
    audit: ["read"],
  },
};

export const ROLE_NAMES = Object.keys(PERMISSIONS) as RoleName[];

/**
 * Fetched once per session in `_app.tsx` (staleTime: Infinity). Do not call this query from
 * individual pages — nginx rate-limits `/api/auth/*` to 5 r/m, and every navigation already
 * hits getSession.
 */
export function useActiveMemberRoleQuery(userId: string | undefined) {
  return useQuery({
    queryKey: ["active-member-role", userId],
    queryFn: async (): Promise<RoleName> => {
      const res = await authClient.organization.getActiveMemberRole();
      if (res.error || !res.data?.role) {
        throw new Error(res.error?.message ?? "Could not resolve member role");
      }
      const role = res.data.role as string;
      if (!(role in PERMISSIONS)) {
        throw new Error(`Unrecognised role "${role}"`);
      }
      return role as RoleName;
    },
    enabled: Boolean(userId),
    staleTime: Infinity,
    retry: false,
  });
}

export function useRole() {
  const { data: session } = authClient.useSession();
  const roleQuery = useActiveMemberRoleQuery(session?.user.id);

  function can(resource: Resource, action: Action): boolean {
    const role = roleQuery.data;
    if (!role) return false;
    return PERMISSIONS[role][resource]?.includes(action) ?? false;
  }

  return {
    role: roleQuery.data ?? null,
    isLoading: roleQuery.isPending,
    can,
  };
}
