import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
  plugins: [organizationClient()],
});

export const { signIn, signOut, useSession } = authClient;

export async function ensureActiveOrganization(): Promise<boolean> {
  const session = await authClient.getSession();
  if (session.data?.session.activeOrganizationId) return true;

  const orgs = await authClient.organization.list();
  const first = orgs.data?.[0];
  if (!first) return false;

  await authClient.organization.setActive({ organizationId: first.id });
  return true;
}
