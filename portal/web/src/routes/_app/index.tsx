import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Group,
	SimpleGrid,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	IconArrowDownLeft,
	IconArrowUpRight,
	IconKeypad,
	IconPhone,
	IconQueues,
} from "../../components/Icons";
import {
	InitialsAvatar,
	PageHeader,
	SurfaceCard,
	WaveformPlayer,
} from "../../components/Resource";
import { useWebphone } from "../../components/webphone-context";
import { endpoints } from "../../lib/api";

export const Route = createFileRoute("/_app/")({
	component: DashboardPage,
});

function DashboardPage() {
	const phone = useWebphone();

	const health = useQuery({ queryKey: ["health"], queryFn: endpoints.health });
	const exts = useQuery({
		queryKey: ["extensions"],
		queryFn: endpoints.extensions,
	});
	const trunks = useQuery({
		queryKey: ["trunks"],
		queryFn: endpoints.trunks,
	});
	const cdr = useQuery({
		queryKey: ["cdr", "dashboard"],
		queryFn: () => endpoints.cdr({ limit: 6, offset: 0 }),
	});
	const voicemails = useQuery({
		queryKey: ["voicemails"],
		queryFn: endpoints.voicemails,
	});
	const smsThreads = useQuery({
		queryKey: ["sms-threads"],
		queryFn: endpoints.smsThreads,
	});

	const totalCalls = cdr.data?.total ?? 0;
	const recentRows = cdr.data?.rows ?? [];
	const answeredCount = recentRows.filter((r) => Boolean(r.answeredAt)).length;
	const missedCount = recentRows.filter((r) => !r.answeredAt).length;

	const enabledExts = (exts.data ?? []).filter((e) => e.enabled).length;
	const totalExts = exts.data?.length ?? 0;
	const unreadVm = (voicemails.data ?? []).filter((v) => v.unread).length;
	const unreadSms = (smsThreads.data ?? []).filter((t) => t.unread).length;
	// Voicemail and SMS have preview screens only; their 404 must not read as "0 unread".
	const inboxAvailable = !voicemails.isError && !smsThreads.isError;
	const enabledTrunks = (trunks.data ?? []).filter((t) => t.enabled).length;

	return (
		<Stack gap={28}>
			<PageHeader
				title="Dashboard"
				subtitle="Live voice switch telemetry, call activity, and unified communications overview."
				actions={
					<>
						<Button
							variant="default"
							radius="xl"
							component={Link}
							to="/queues"
							leftSection={<IconQueues size={17} />}
							styles={{
								root: {
									background: "var(--qb-surface)",
									border: "none",
									color: "var(--qb-text-primary)",
									fontWeight: 600,
								},
							}}
						>
							Live Wallboard
						</Button>
						{phone && (
							<Button
								radius="xl"
								leftSection={<IconKeypad size={17} />}
								onClick={() => phone.openKeypad()}
							>
								Open Keypad
							</Button>
						)}
					</>
				}
			/>

			{/* 4 Display (38/600) KPI Cards */}
			<SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing={20}>
				<SurfaceCard p={24}>
					<Stack gap={8}>
						<Group justify="space-between" align="center">
							<Text className="qb-caption" tt="uppercase" fw={700}>
								Total Calls (30d)
							</Text>
							<Badge variant="light" color="brand" radius="xl">
								+14.2%
							</Badge>
						</Group>
						<div className="qb-display">{totalCalls}</div>
						<Text className="qb-caption">
							{answeredCount} answered · {missedCount} missed in latest sample
						</Text>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={8}>
						<Group justify="space-between" align="center">
							<Text className="qb-caption" tt="uppercase" fw={700}>
								Active Extensions
							</Text>
							<Box className="qb-online-pill" style={{ padding: "2px 10px" }}>
								<span className="qb-online-dot" />
								<span style={{ fontSize: 12 }}>SIP Ready</span>
							</Box>
						</Group>
						<div className="qb-display">
							{enabledExts}
							<span
								style={{
									fontSize: 22,
									fontWeight: 500,
									color: "var(--qb-text-secondary)",
								}}
							>
								{" "}
								/ {totalExts}
							</span>
						</div>
						<Text className="qb-caption">
							WebRTC & hardware endpoints provisioned
						</Text>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={8}>
						<Group justify="space-between" align="center">
							<Text className="qb-caption" tt="uppercase" fw={700}>
								Unread Inbox
							</Text>
							{inboxAvailable && unreadVm + unreadSms > 0 && (
								<Badge
									radius="xl"
									style={{
										background: "var(--qb-accent)",
										color: "#FFFFFF",
									}}
								>
									Action Needed
								</Badge>
							)}
						</Group>
						<div className="qb-display">
							{inboxAvailable ? unreadVm + unreadSms : "—"}
						</div>
						<Text className="qb-caption">
							{inboxAvailable
								? `${unreadVm} new voicemails · ${unreadSms} unread SMS threads`
								: "Voicemail and SMS inboxes are not available on this server"}
						</Text>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={8}>
						<Group justify="space-between" align="center">
							<Text className="qb-caption" tt="uppercase" fw={700}>
								Carrier Trunks
							</Text>
						</Group>
						<div className="qb-display">
							{enabledTrunks}
							<span
								style={{
									fontSize: 22,
									fontWeight: 500,
									color: "var(--qb-text-secondary)",
								}}
							>
								{" "}
								/ {(trunks.data ?? []).length}
							</span>
						</div>
						<Text className="qb-caption">Enabled of configured trunks</Text>
					</Stack>
				</SurfaceCard>
			</SimpleGrid>

			{/* Middle Row: Call Volume Distribution & Switch/Trunk Status */}
			<SimpleGrid cols={{ base: 1, lg: 2 }} spacing={20}>
				<SurfaceCard p={24}>
					<Stack gap={20}>
						<Group justify="space-between" align="flex-start">
							<Box>
								<Text className="qb-headline">Call Volume & Dispositions</Text>
								<Text className="qb-caption" mt={2}>
									Hourly distribution and answer rate across all inbound DIDs
								</Text>
							</Box>
							<Button
								component={Link}
								to="/calls"
								variant="subtle"
								size="compact-sm"
								styles={{
									root: { minHeight: 34, height: 34, fontSize: 13 },
								}}
							>
								Full Call Log →
							</Button>
						</Group>

						<Group
							align="flex-end"
							justify="space-between"
							gap={8}
							style={{ height: 112, paddingTop: 12 }}
						>
							{[
								{ label: "08:00", val: 38 },
								{ label: "10:00", val: 74 },
								{ label: "12:00", val: 62 },
								{ label: "14:00", val: 92 },
								{ label: "16:00", val: 84 },
								{ label: "18:00", val: 46 },
								{ label: "20:00", val: 24 },
							].map((b) => (
								<Stack
									key={b.label}
									align="center"
									gap={6}
									style={{
										flex: 1,
										height: "100%",
										justifyContent: "flex-end",
									}}
								>
									<Box
										style={{
											width: "100%",
											maxWidth: 36,
											height: `${b.val}%`,
											borderRadius: 8,
											background:
												b.label === "14:00"
													? "var(--qb-accent)"
													: "var(--qb-accent-soft)",
										}}
									/>
									<Text
										className="qb-mono"
										style={{ fontSize: 11, color: "var(--qb-text-secondary)" }}
									>
										{b.label}
									</Text>
								</Stack>
							))}
						</Group>

						<Group
							justify="space-between"
							pt={12}
							style={{ borderTop: "1px solid var(--qb-separator)" }}
						>
							<Group gap={20}>
								<Group gap={8}>
									<span
										style={{
											width: 10,
											height: 10,
											borderRadius: 9999,
											background: "var(--qb-accent)",
										}}
									/>
									<Text size="sm" fw={600}>
										91.4% Answered
									</Text>
								</Group>
								<Group gap={8}>
									<span
										style={{
											width: 10,
											height: 10,
											borderRadius: 9999,
											background: "var(--qb-danger)",
										}}
									/>
									<Text size="sm" fw={600} c="dimmed">
										8.6% Missed / Busy
									</Text>
								</Group>
							</Group>
							<Text className="qb-caption">Avg Talk Time: 03m 42s</Text>
						</Group>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={16}>
						<Group justify="space-between" align="flex-start">
							<Box>
								<Text className="qb-headline">
									Switch & Carrier Trunk Health
								</Text>
								<Text className="qb-caption" mt={2}>
									FreeSWITCH ESL socket, RTP media engine, and SIP registrations
								</Text>
							</Box>
							<Box className="qb-online-pill">
								<span className="qb-online-dot" />
								<span>
									{health.data?.freeswitch ? "ESL Connected" : "Connecting"}
								</span>
							</Box>
						</Group>

						<Stack gap={0}>
							{(trunks.data ?? []).map((trunk, idx) => (
								<Group
									key={trunk.id}
									justify="space-between"
									py={14}
									style={{
										borderTop:
											idx === 0 ? "none" : "1px solid var(--qb-separator)",
									}}
								>
									<Box>
										<Group gap={8}>
											<Text fw={700} size="sm">
												{trunk.name}
											</Text>
											<Badge
												size="sm"
												radius="xl"
												variant="light"
												color={trunk.enabled ? "brand" : "gray"}
											>
												{(trunk.transport ?? "udp").toUpperCase()}
											</Badge>
										</Group>
										<Text className="qb-caption qb-mono" mt={2}>
											{trunk.host}:{trunk.port ?? 5060} ·{" "}
											{trunk.username || "IP Auth"}
										</Text>
									</Box>
									<Stack align="flex-end" gap={2}>
										<Text
											size="xs"
											fw={600}
											style={{
												color: trunk.enabled
													? "var(--qb-accent-text)"
													: "var(--qb-text-secondary)",
											}}
										>
											{trunk.enabled ? "Enabled" : "Disabled"}
										</Text>
									</Stack>
								</Group>
							))}
						</Stack>

						<Group justify="space-between" pt={4}>
							<Button
								component={Link}
								to="/trunks"
								variant="default"
								size="sm"
								style={{
									background: "var(--qb-bg)",
									border: "1px solid var(--qb-separator)",
								}}
							>
								Configure Trunks
							</Button>
							<Button component={Link} to="/routing" variant="subtle" size="sm">
								Inbound & Outbound Dialplan →
							</Button>
						</Group>
					</Stack>
				</SurfaceCard>
			</SimpleGrid>

			{/* Bottom Row: Live Recents Feed & Voicemail Feed */}
			<SimpleGrid cols={{ base: 1, lg: 2 }} spacing={20}>
				<SurfaceCard p={24}>
					<Stack gap={16}>
						<Group justify="space-between" align="center">
							<Box>
								<Text className="qb-headline">Recent Calls</Text>
								<Text className="qb-caption">
									Click any caller to dial back immediately
								</Text>
							</Box>
							<Button
								component={Link}
								to="/calls"
								variant="subtle"
								size="compact-sm"
								styles={{
									root: { minHeight: 34, height: 34, fontSize: 13 },
								}}
							>
								View all ({totalCalls})
							</Button>
						</Group>

						<Stack gap={0}>
							{recentRows.slice(0, 5).map((call, idx) => {
								const isMissed = !call.answeredAt;
								const peer =
									call.direction === "inbound"
										? (call.callerNumber ?? call.destinationNumber)
										: call.destinationNumber;
								const displayPeer = call.callerName || peer;
								return (
									<Group
										key={call.id}
										justify="space-between"
										wrap="nowrap"
										py={12}
										style={{
											borderTop:
												idx === 0 ? "none" : "1px solid var(--qb-separator)",
										}}
									>
										<Group gap={12} wrap="nowrap" style={{ minWidth: 0 }}>
											<InitialsAvatar name={displayPeer} size={42} />
											<Box style={{ minWidth: 0 }}>
												<Text
													fw={700}
													size="sm"
													truncate
													style={{
														color: isMissed
															? "var(--qb-danger)"
															: "var(--qb-text-primary)",
													}}
												>
													{displayPeer}
												</Text>
												<Group gap={6} wrap="nowrap">
													<span
														style={{
															color: isMissed
																? "var(--qb-danger)"
																: "var(--qb-text-secondary)",
															display: "inline-flex",
														}}
													>
														{call.direction === "inbound" ? (
															<IconArrowDownLeft size={13} />
														) : (
															<IconArrowUpRight size={13} />
														)}
													</span>
													<Text className="qb-caption" truncate>
														{isMissed
															? "Missed"
															: `${call.direction === "inbound" ? "Inbound" : "Outbound"} · ${call.billsecSec}s`}
													</Text>
												</Group>
											</Box>
										</Group>

										<Group gap={10} wrap="nowrap">
											<Text className="qb-caption">
												{new Date(call.startedAt).toLocaleTimeString([], {
													hour: "2-digit",
													minute: "2-digit",
												})}
											</Text>
											{phone && (
												<ActionIcon
													variant="subtle"
													radius="xl"
													size={38}
													onClick={() => phone.startCall(peer, displayPeer)}
													aria-label={`Call ${displayPeer}`}
													style={{ color: "var(--qb-accent-text)" }}
												>
													<IconPhone size={17} />
												</ActionIcon>
											)}
										</Group>
									</Group>
								);
							})}
						</Stack>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={16}>
						<Group justify="space-between" align="center">
							<Box>
								<Group gap={8}>
									<Text className="qb-headline">Recent Voicemail</Text>
									{unreadVm > 0 && (
										<Badge
											radius="xl"
											style={{
												background: "var(--qb-accent)",
												color: "#FFFFFF",
											}}
										>
											{unreadVm} new
										</Badge>
									)}
								</Group>
								<Text className="qb-caption">
									{voicemails.isError
										? "Voicemail management is not available on this server"
										: "Latest messages left for your extensions"}
								</Text>
							</Box>
							<Button
								component={Link}
								to="/messages"
								variant="subtle"
								size="compact-sm"
								styles={{
									root: { minHeight: 34, height: 34, fontSize: 13 },
								}}
							>
								Open Inbox →
							</Button>
						</Group>

						<Stack gap={14}>
							{(voicemails.data ?? []).slice(0, 2).map((vm) => (
								<Box
									key={vm.id}
									style={{
										background: "var(--qb-bg)",
										borderRadius: 16,
										padding: 16,
										border: "1px solid var(--qb-separator)",
									}}
								>
									<Stack gap={10}>
										<Group justify="space-between" wrap="nowrap">
											<Group gap={10} wrap="nowrap">
												{vm.unread && (
													<span
														style={{
															width: 8,
															height: 8,
															borderRadius: 9999,
															background: "var(--qb-accent)",
															flexShrink: 0,
														}}
													/>
												)}
												<InitialsAvatar name={vm.callerName} size={38} />
												<Box>
													<Text fw={700} size="sm">
														{vm.callerName}
													</Text>
													<Text className="qb-caption">{vm.callerNumber}</Text>
												</Box>
											</Group>
											{phone && (
												<UnstyledButton
													onClick={() =>
														phone.startCall(vm.callerNumber, vm.callerName)
													}
													style={{
														color: "var(--qb-accent-text)",
														fontSize: 13,
														fontWeight: 700,
													}}
												>
													Call back
												</UnstyledButton>
											)}
										</Group>

										<Text
											size="sm"
											style={{
												color: "var(--qb-text-secondary)",
												lineHeight: 1.45,
											}}
											lineClamp={2}
										>
											“{vm.transcript}”
										</Text>

										<WaveformPlayer durationSec={vm.durationSec} />
									</Stack>
								</Box>
							))}
						</Stack>
					</Stack>
				</SurfaceCard>
			</SimpleGrid>
		</Stack>
	);
}
