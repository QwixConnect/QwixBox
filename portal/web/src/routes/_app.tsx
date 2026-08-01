import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Code,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { authClient, ensureActiveOrganization } from "../lib/auth-client";
import { endpoints, type Health } from "../lib/api";
import { useActiveMemberRoleQuery, useRole, type PermissionAction, type PermissionResource } from "../lib/use-role";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    const session = await authClient.getSession();
    if (!session.data?.user) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
  },
  component: AppLayout,
});

function HealthBadge() {
  const { data, isError } = useQuery<Health>({
    queryKey: ["health"],
    queryFn: () => endpoints.health(),
    refetchInterval: 30_000,
    retry: false,
  });

  if (isError || !data) {
    return (
      <Badge color="red" variant="light">
        API unreachable
      </Badge>
    );
  }

  const down = [
    !data.database && "database",
    !data.redis && "Redis",
    !data.freeswitch && "FreeSWITCH",
  ].filter(Boolean) as string[];

  if (down.length === 0) {
    return (
      <Badge color="green" variant="light">
        Healthy
      </Badge>
    );
  }

  return (
    <Tooltip label={`Unreachable: ${down.join(", ")}`}>
      <Badge color={data.database ? "yellow" : "red"} variant="light">
        Degraded — {down.join(", ")}
      </Badge>
    </Tooltip>
  );
}

function AccountMenu() {
  const { data: session } = authClient.useSession();
  const email = session?.user.email ?? "";

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button variant="subtle" size="compact-sm">
          {email}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          onClick={async () => {
            await authClient.signOut();
            window.location.href = "/login";
          }}
        >
          Sign out
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

const NAV: {
  to: string;
  label: string;
  require?: { resource: PermissionResource; action: PermissionAction };
}[] = [
  { to: "/", label: "Dashboard" },
  { to: "/extensions", label: "Extensions" },
  { to: "/trunks", label: "Trunks" },
  { to: "/routing", label: "Routing" },
  { to: "/call-flows", label: "Call flows" },
  { to: "/calls", label: "Calls", require: { resource: "cdr", action: "read" } },
  { to: "/faxes", label: "Faxes", require: { resource: "recording", action: "read" } },
  { to: "/users", label: "Users" },
  { to: "/audit", label: "Audit", require: { resource: "audit", action: "read" } },
  { to: "/settings", label: "Settings" },
];

function NoTenant({ email }: { email: string }) {
  return (
    <Alert color="yellow" title="No tenant assigned to this account">
      <Stack gap="sm">
        <Text size="sm">
          <Code>{email}</Code> can sign in but is not a member of any organization, so there is no
          telephony configuration to show. Tenants are provisioned by an operator, not
          self-served.
        </Text>
        <Text size="sm">On the server, run:</Text>
        <Code block>
          {`cd /opt/qwixbox-api\nsudo -u qwixbox bun run src/cli/provision-tenant.ts \\\n  --name "Acme Corp" --slug acme \\\n  --domain <sip-domain> --owner ${email}`}
        </Code>
        <Text size="xs" c="dimmed">
          Then sign out and back in.
        </Text>
      </Stack>
    </Alert>
  );
}

function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: session } = authClient.useSession();
  const { can } = useRole();

  const org = useQuery({
    queryKey: ["active-organization", session?.user.id],
    queryFn: ensureActiveOrganization,
    enabled: Boolean(session?.user),
    staleTime: Infinity,
    retry: false,
  });

  useActiveMemberRoleQuery(session?.user.id);

  const nav = NAV.filter((item) => !item.require || can(item.require.resource, item.require.action));

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 220, breakpoint: "sm" }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={4}>QwixBox</Title>
          <Group gap="sm">
            <HealthBadge />
            <AccountMenu />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <ScrollArea>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              component={Link}
              to={item.to}
              label={item.label}
              active={pathname === item.to}
            />
          ))}
        </ScrollArea>
        <Text size="xs" c="dimmed" mt="auto" p="xs">
          Kamailio · FreeSWITCH · rtpengine
        </Text>
      </AppShell.Navbar>

      <AppShell.Main>
        {/* Held until the organization question is settled, so pages do not mount and fire a
            wave of 403s against a session that is one request away from being scoped. */}
        {org.isSuccess && org.data === false ? (
          <NoTenant email={session?.user.email ?? ""} />
        ) : org.isSuccess ? (
          <Outlet />
        ) : null}
      </AppShell.Main>
    </AppShell>
  );
}
