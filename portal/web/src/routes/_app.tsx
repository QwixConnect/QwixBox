import {
	ActionIcon,
	Alert,
	AppShell,
	Box,
	Burger,
	Button,
	Code,
	Group,
	ScrollArea,
	Stack,
	Text,
	Tooltip,
	UnstyledButton,
	useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
	IconBrandMark,
	IconCallFlows,
	IconConferences,
	IconContacts,
	IconDashboard,
	IconDevices,
	IconEmergency,
	IconExtensions,
	IconFaxes,
	IconKeypad,
	IconLogout,
	IconMessages,
	IconMoon,
	IconPhone,
	IconQueues,
	IconRecents,
	IconRouting,
	IconSettings,
	IconShield,
	IconSun,
	IconTrunks,
	IconUsers,
} from "../components/Icons";
import { InitialsAvatar } from "../components/Resource";
import { useWebphone, WebphoneProvider } from "../components/WebphoneDrawer";
import { endpoints, type Health } from "../lib/api";
import { authClient, ensureActiveOrganization } from "../lib/auth-client";
import {
	type PermissionAction,
	type PermissionResource,
	useActiveMemberRoleQuery,
	useRole,
} from "../lib/use-role";
import { MockControls } from "../mock/Controls";

export const Route = createFileRoute("/_app")({
	component: AppLayoutWrapper,
});

interface NavItem {
	to: string;
	label: string;
	icon: ReactNode;
	badge?: string | number;
	require?: { resource: PermissionResource; action: PermissionAction };
}

const navGroups: Array<{ group: string; items: NavItem[] }> = [
	{
		group: "Workspace",
		items: [
			{ to: "/", label: "Dashboard", icon: <IconDashboard size={19} /> },
			{
				to: "/calls",
				label: "Recents & Calls",
				icon: <IconRecents size={19} />,
				require: { resource: "cdr", action: "read" },
			},
			{
				to: "/messages",
				label: "Messages & Voicemail",
				icon: <IconMessages size={19} />,
				badge: 4,
			},
			{ to: "/contacts", label: "Contacts", icon: <IconContacts size={19} /> },
		],
	},
	{
		group: "Voice & Routing",
		items: [
			{
				to: "/extensions",
				label: "Extensions",
				icon: <IconExtensions size={19} />,
			},
			{
				to: "/call-flows",
				label: "Call Flows",
				icon: <IconCallFlows size={19} />,
			},
			{
				to: "/queues",
				label: "Call Queues",
				icon: <IconQueues size={19} />,
			},
			{ to: "/routing", label: "Routing", icon: <IconRouting size={19} /> },
			{ to: "/trunks", label: "SIP Trunks", icon: <IconTrunks size={19} /> },
			{
				to: "/conferences",
				label: "Conferences & Park",
				icon: <IconConferences size={19} />,
			},
			{
				to: "/faxes",
				label: "Faxes",
				icon: <IconFaxes size={19} />,
				require: { resource: "recording", action: "read" },
			},
		],
	},
	{
		group: "Administration",
		items: [
			{
				to: "/emergency",
				label: "Emergency (E911)",
				icon: <IconEmergency size={19} />,
			},
			{
				to: "/devices",
				label: "Devices & Phones",
				icon: <IconDevices size={19} />,
			},
			{ to: "/users", label: "Portal Users", icon: <IconUsers size={19} /> },
			{
				to: "/audit",
				label: "Audit Log",
				icon: <IconShield size={19} />,
				require: { resource: "audit", action: "read" },
			},
			{ to: "/settings", label: "Settings", icon: <IconSettings size={19} /> },
		],
	},
];

function NoTenant({ email }: { email: string }) {
	return (
		<Alert color="yellow" title="No tenant assigned to this account" radius={16}>
			<Stack gap="sm">
				<Text size="sm">
					<Code>{email}</Code> can sign in but is not a member of any
					organization, so there is no telephony configuration to show. Tenants
					are provisioned by an operator, not self-served.
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

function AppLayoutWrapper() {
	return (
		<WebphoneProvider>
			<AppLayout />
		</WebphoneProvider>
	);
}

function AppLayout() {
	const [opened, { toggle, close }] = useDisclosure();
	const navigate = useNavigate();
	const location = useLocation();
	const { colorScheme, toggleColorScheme } = useMantineColorScheme();
	const { openKeypad, inCall } = useWebphone();

	const { data: session } = authClient.useSession();
	const { can, role } = useRole();

	const org = useQuery({
		queryKey: ["active-organization", session?.user.id],
		queryFn: ensureActiveOrganization,
		enabled: Boolean(session?.user),
		staleTime: Infinity,
		retry: false,
	});

	useActiveMemberRoleQuery(session?.user.id);

	const health = useQuery({
		queryKey: ["health"],
		queryFn: endpoints.health,
		refetchInterval: 15_000,
	});

	const logout = async () => {
		await authClient.signOut();
		window.location.href = "/login";
	};

	const isRouteActive = (to: string) => {
		if (to === "/") return location.pathname === "/";
		return location.pathname.startsWith(to);
	};

	const displayName =
		session?.user.name ||
		(session?.user.email === "owner@example.test"
			? "Demo User"
			: (session?.user.email?.split("@")[0] ?? "Demo User"));

	return (
		<AppShell
			header={{ height: 68 }}
			navbar={{
				width: 272,
				breakpoint: "md",
				collapsed: { mobile: !opened },
			}}
			padding={0}
			styles={{
				root: {
					background: "var(--qb-bg)",
				},
				header: {
					background: "var(--qb-bg)",
					borderBottom: "1px solid var(--qb-separator)",
				},
				navbar: {
					background: "var(--qb-bg)",
					borderRight: "1px solid var(--qb-separator)",
				},
				main: {
					background: "var(--qb-bg)",
					minHeight: "100dvh",
				},
			}}
		>
			<AppShell.Header>
				<Group h="100%" px={24} justify="space-between" wrap="nowrap">
					<Group gap={14} wrap="nowrap">
						<Burger
							opened={opened}
							onClick={toggle}
							hiddenFrom="md"
							size="sm"
							aria-label="Toggle navigation"
						/>
						<Link
							to="/"
							style={{
								textDecoration: "none",
								color: "inherit",
								display: "flex",
								alignItems: "center",
								gap: 12,
							}}
						>
							<Box
								style={{
									width: 36,
									height: 36,
									borderRadius: 10,
									background: "var(--qb-accent)",
									color: "#FFFFFF",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									flexShrink: 0,
								}}
							>
								<IconBrandMark size={20} />
							</Box>
							<Box>
								<Text
									fw={800}
									style={{
										fontSize: 19,
										letterSpacing: "-0.025em",
										lineHeight: 1.1,
									}}
								>
									QwixBox
								</Text>
								<Text
									size="xs"
									c="dimmed"
									fw={500}
									visibleFrom="xs"
									style={{ fontSize: 12 }}
								>
									Enterprise Voice Platform
								</Text>
							</Box>
						</Link>
					</Group>

					<Group gap={10} wrap="nowrap">
						<HealthBadge data={health.data} isError={health.isError} />

						<Button
							variant={inCall ? "filled" : "default"}
							color={inCall ? "brand" : undefined}
							radius="xl"
							leftSection={
								inCall ? <IconPhone size={16} /> : <IconKeypad size={16} />
							}
							onClick={() => openKeypad()}
							styles={{
								root: {
									minHeight: 40,
									height: 40,
									paddingInline: 16,
									background: inCall ? "var(--qb-accent)" : "var(--qb-surface)",
									border: "none",
									color: inCall ? "#FFFFFF" : "var(--qb-text-primary)",
									fontWeight: 600,
									fontSize: 14,
								},
							}}
						>
							{inCall ? "Active Call · 04:27" : "Keypad"}
						</Button>

						<Tooltip
							label={
								colorScheme === "dark"
									? "Switch to Light Mode"
									: "Switch to Dark Mode"
							}
						>
							<ActionIcon
								variant="default"
								radius="xl"
								size={40}
								onClick={() => toggleColorScheme()}
								aria-label="Toggle color scheme"
								style={{
									background: "var(--qb-surface)",
									border: "none",
									color: "var(--qb-text-primary)",
								}}
							>
								{colorScheme === "dark" ? (
									<IconSun size={18} />
								) : (
									<IconMoon size={18} />
								)}
							</ActionIcon>
						</Tooltip>

						{session?.user && (
							<Group gap={8} visibleFrom="lg" ml={4}>
								<Box
									style={{
										background: "var(--qb-surface)",
										padding: "6px 12px",
										borderRadius: 9999,
										fontSize: 13,
										fontWeight: 600,
										color: "var(--qb-text-secondary)",
									}}
								>
									{session.user.email} ·{" "}
									<span style={{ color: "var(--qb-accent-text)" }}>
										{role ?? "owner"}
									</span>
								</Box>
								<Tooltip label="Sign out">
									<ActionIcon
										variant="default"
										radius="xl"
										size={40}
										onClick={() => void logout()}
										aria-label="Sign out"
										style={{
											background: "var(--qb-surface)",
											border: "none",
											color: "var(--qb-text-secondary)",
										}}
									>
										<IconLogout size={17} />
									</ActionIcon>
								</Tooltip>
							</Group>
						)}
					</Group>
				</Group>
			</AppShell.Header>

			<AppShell.Navbar p={16}>
				<AppShell.Section>
					<UnstyledButton
						onClick={() => {
							close();
							navigate({ to: "/settings" });
						}}
						style={{
							width: "100%",
							background: "var(--qb-surface)",
							borderRadius: 20,
							padding: "14px 16px",
							marginBottom: 16,
							display: "block",
						}}
					>
						<Group justify="space-between" wrap="nowrap">
							<Group gap={12} wrap="nowrap" style={{ minWidth: 0 }}>
								<InitialsAvatar
									name={displayName}
									initials="DU"
									size={44}
									accent
								/>
								<Box style={{ minWidth: 0 }}>
									<Text
										fw={700}
										size="sm"
										truncate
										style={{ color: "var(--qb-text-primary)" }}
									>
										{displayName}
									</Text>
									<Text size="xs" c="dimmed" truncate fw={500}>
										+1 416 555 0100 · ext. 1001
									</Text>
									<Group gap={6} mt={4}>
										<span
											style={{
												width: 7,
												height: 7,
												borderRadius: 9999,
												background: "var(--qb-accent)",
												display: "inline-block",
											}}
										/>
										<Text
											size="xs"
											fw={600}
											style={{
												fontSize: 12,
												color: "var(--qb-accent-text)",
											}}
										>
											Online
										</Text>
									</Group>
								</Box>
							</Group>
						</Group>
					</UnstyledButton>
				</AppShell.Section>

				<AppShell.Section grow component={ScrollArea} scrollbarSize={4}>
					<Stack gap={20} pb="md">
						{navGroups.map((group) => {
							const visibleItems = group.items.filter(
								(item) =>
									!item.require ||
									!role ||
									can(item.require.resource, item.require.action),
							);
							if (visibleItems.length === 0) return null;
							return (
								<Box key={group.group}>
									<Text
										px={12}
										mb={6}
										style={{
											fontSize: 11,
											fontWeight: 700,
											textTransform: "uppercase",
											letterSpacing: "0.06em",
											color: "var(--qb-text-secondary)",
										}}
									>
										{group.group}
									</Text>
									<Stack gap={2}>
										{visibleItems.map((item) => {
											const active = isRouteActive(item.to);
											return (
												<Link
													key={item.to}
													to={item.to}
													onClick={close}
													className={`qb-sidebar-link ${active ? "active" : ""}`}
												>
													<Group
														justify="space-between"
														w="100%"
														wrap="nowrap"
														gap={10}
													>
														<Group gap={12} wrap="nowrap">
															<span
																style={{
																	display: "flex",
																	alignItems: "center",
																	color: active
																		? "var(--qb-accent-text)"
																		: "var(--qb-text-secondary)",
																}}
															>
																{item.icon}
															</span>
															<span>{item.label}</span>
														</Group>
														{item.badge !== undefined && (
															<span
																style={{
																	background: "var(--qb-accent)",
																	color: "#FFFFFF",
																	fontSize: 11,
																	fontWeight: 700,
																	borderRadius: 9999,
																	padding: "1px 8px",
																	lineHeight: "18px",
																}}
															>
																{item.badge}
															</span>
														)}
													</Group>
												</Link>
											);
										})}
									</Stack>
								</Box>
							);
						})}
					</Stack>
				</AppShell.Section>
			</AppShell.Navbar>

			<AppShell.Main>
				<Box className="qb-page-container">
					{org.isError ? (
						<Alert color="red" title="Could not select an organization">
							<Stack>
								<Text>{org.error.message}</Text>
								<Button onClick={() => void org.refetch()}>Retry</Button>
							</Stack>
						</Alert>
					) : org.isSuccess && org.data === false ? (
						<NoTenant email={session?.user.email ?? ""} />
					) : org.isSuccess || !session?.user ? (
						<Outlet />
					) : (
						<Text c="dimmed" size="sm">
							Loading organization…
						</Text>
					)}
				</Box>
				<MobileBottomBar currentPath={location.pathname} />
				<MockControls />
			</AppShell.Main>
		</AppShell>
	);
}

function MobileBottomBar({ currentPath }: { currentPath: string }) {
	const { openKeypad } = useWebphone();
	const tabs = [
		{
			to: "/calls",
			label: "Recents",
			icon: <IconRecents size={22} />,
			active: currentPath.startsWith("/calls"),
		},
		{
			to: "/contacts",
			label: "Contacts",
			icon: <IconContacts size={22} />,
			active: currentPath.startsWith("/contacts"),
		},
		{
			to: "#keypad",
			label: "Keypad",
			icon: <IconKeypad size={22} />,
			active: false,
			onClick: () => openKeypad(),
		},
		{
			to: "/messages",
			label: "Messages",
			icon: <IconMessages size={22} />,
			active: currentPath.startsWith("/messages"),
			dot: true,
		},
		{
			to: "/settings",
			label: "Settings",
			icon: <IconSettings size={22} />,
			active: currentPath.startsWith("/settings"),
		},
	];

	return (
		<Box className="qb-mobile-bottom-bar" hiddenFrom="md">
			{tabs.map((tab) =>
				tab.onClick ? (
					<UnstyledButton
						key={tab.label}
						onClick={tab.onClick}
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							gap: 3,
							minWidth: 56,
							minHeight: 48,
							color: "var(--qb-text-secondary)",
						}}
					>
						{tab.icon}
						<span style={{ fontSize: 11, fontWeight: 600 }}>{tab.label}</span>
					</UnstyledButton>
				) : (
					<Link
						key={tab.to}
						to={tab.to}
						style={{
							textDecoration: "none",
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							gap: 3,
							minWidth: 56,
							minHeight: 48,
							position: "relative",
							color: tab.active
								? "var(--qb-accent-text)"
								: "var(--qb-text-secondary)",
						}}
					>
						<Box style={{ position: "relative", display: "flex" }}>
							{tab.icon}
							{tab.dot && (
								<span
									style={{
										position: "absolute",
										top: -2,
										right: -4,
										width: 7,
										height: 7,
										borderRadius: 9999,
										background: "var(--qb-accent)",
									}}
								/>
							)}
						</Box>
						<span style={{ fontSize: 11, fontWeight: tab.active ? 700 : 500 }}>
							{tab.label}
						</span>
					</Link>
				),
			)}
		</Box>
	);
}

function HealthBadge({
	data,
	isError,
}: {
	data?: Health;
	isError: boolean;
}) {
	if (isError || !data) {
		return (
			<Box
				visibleFrom="sm"
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 8,
					background: "var(--qb-surface)",
					borderRadius: 9999,
					padding: "6px 14px",
					fontSize: 13,
					fontWeight: 600,
					color: "var(--qb-danger)",
				}}
			>
				<span
					style={{
						width: 8,
						height: 8,
						borderRadius: 9999,
						background: "var(--qb-danger)",
					}}
				/>
				<span>API Unreachable</span>
			</Box>
		);
	}
	const ok =
		data.status === "ok" && data.database && data.redis && data.freeswitch;
	return (
		<Box
			visibleFrom="sm"
			className="qb-online-pill"
			style={{
				color: ok ? "var(--qb-text-primary)" : "var(--qb-danger)",
			}}
		>
			<span
				className="qb-online-dot"
				style={{
					background: ok ? "var(--qb-accent)" : "var(--qb-danger)",
				}}
			/>
			<span>{ok ? "Switch Online" : "Switch Degraded"}</span>
		</Box>
	);
}
