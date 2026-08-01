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

// Mirrors ROLES in portal/api/src/auth.ts. Convenience only - the server is the boundary.
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
