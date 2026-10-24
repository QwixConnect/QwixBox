import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Group,
	Modal,
	Pagination,
	SimpleGrid,
	Stack,
	Text,
	TextInput,
	UnstyledButton,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
	IconArrowDownLeft,
	IconArrowUpRight,
	IconInfo,
	IconKeypad,
	IconPhone,
	IconSearch,
} from "../../components/Icons";
import {
	InitialsAvatar,
	PageHeader,
	QueryState,
	RoleGate,
	SegmentedTabs,
	SurfaceCard,
} from "../../components/Resource";
import { useWebphone } from "../../components/WebphoneDrawer";
import { type Cdr, type CdrFilters, endpoints } from "../../lib/api";

export const Route = createFileRoute("/_app/calls")({
	component: CallsPage,
});

function formatDurationMinSec(sec: number): string {
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	if (m === 0) return `${s}s`;
	return `${m}m ${String(s).padStart(2, "0")}s`;
}

function CallsPage() {
	const { startCall, openKeypad } = useWebphone();
	const [page, setPage] = useState(1);
	const [tab, setTab] = useState<"all" | "missed" | "inbound" | "outbound">(
		"all",
	);
	const [search, setSearch] = useState("");
	const [selectedCall, setSelectedCall] = useState<Cdr | null>(null);
	const pageSize = 25;

	const filters: CdrFilters = {
		limit: pageSize,
		offset: (page - 1) * pageSize,
		direction:
			tab === "inbound"
				? "inbound"
				: tab === "outbound"
					? "outbound"
					: undefined,
		answered: tab === "missed" ? "false" : undefined,
		number: search || undefined,
	};

	const cdr = useQuery({
		queryKey: ["cdr", filters],
		queryFn: () => endpoints.cdr(filters),
	});

	const allRows = cdr.data?.rows ?? [];
	const rows =
		tab === "missed" ? allRows.filter((r) => !r.answeredAt) : allRows;

	const totalPages = cdr.data
		? Math.max(1, Math.ceil(cdr.data.total / pageSize))
		: 1;

	const answeredCount = allRows.filter((r) => Boolean(r.answeredAt)).length;
	const missedCount = allRows.filter((r) => !r.answeredAt).length;

	return (
		<Stack gap={24}>
			<PageHeader
				title="Recents"
				subtitle="Complete call detail records (CDR), STIR/SHAKEN attestation, and one-click callback."
				actions={
					<Group gap={10}>
						<RoleGate resource="cdr" action="export">
							<Button
								component="a"
								href={endpoints.cdrExportUrl(filters)}
								variant="default"
								radius="xl"
								styles={{
									root: {
										background: "var(--qb-surface)",
										border: "none",
										color: "var(--qb-text-primary)",
									},
								}}
							>
								Export CSV
							</Button>
						</RoleGate>
						<Button
							radius="xl"
							leftSection={<IconKeypad size={17} />}
							onClick={() => openKeypad()}
						>
							Open Keypad
						</Button>
					</Group>
				}
			/>

			{/* 3 Display Summary Cards */}
			<SimpleGrid cols={{ base: 1, sm: 3 }} spacing={20}>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Total Records
						</Text>
						<div className="qb-display">{cdr.data?.total ?? 0}</div>
						<Text className="qb-caption">
							Page {page} of {totalPages}
						</Text>
					</Stack>
				</SurfaceCard>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Answered (Current Page)
						</Text>
						<div className="qb-display">{answeredCount}</div>
						<Text className="qb-caption">Connected with RTP audio</Text>
					</Stack>
				</SurfaceCard>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Missed / No Answer
						</Text>
						<div
							className="qb-display"
							style={{
								color:
									missedCount > 0
										? "var(--qb-danger)"
										: "var(--qb-text-primary)",
							}}
						>
							{missedCount}
						</div>
						<Text className="qb-caption">Routed to voicemail or busy</Text>
					</Stack>
				</SurfaceCard>
			</SimpleGrid>

			{/* Segmented Pill Control + Search matching Recents@2x.png */}
			<Group justify="space-between" align="center" wrap="wrap" gap={12}>
				<SegmentedTabs
					value={tab}
					onChange={(v) => {
						setTab(v);
						setPage(1);
					}}
					items={[
						{ value: "all", label: "All" },
						{
							value: "missed",
							label: "Missed",
							badge: missedCount || undefined,
						},
						{ value: "inbound", label: "Inbound" },
						{ value: "outbound", label: "Outbound" },
					]}
				/>

				<TextInput
					placeholder="Search caller or number..."
					leftSection={<IconSearch size={17} />}
					value={search}
					onChange={(e) => {
						setSearch(e.currentTarget.value);
						setPage(1);
					}}
					w={{ base: "100%", sm: 300 }}
				/>
			</Group>

			<QueryState
				isLoading={cdr.isLoading}
				isError={cdr.isError}
				error={cdr.error}
				isEmpty={rows.length === 0}
				emptyMessage="No calls match your filter."
			>
				<SurfaceCard p={0} style={{ overflow: "hidden" }}>
					{rows.map((r, idx) => {
						const isMissed = !r.answeredAt;
						const peerNumber =
							r.direction === "inbound"
								? (r.callerNumber ?? r.destinationNumber)
								: r.destinationNumber;
						const peerName = r.callerName || peerNumber;
						const timeStr = new Date(r.startedAt).toLocaleTimeString([], {
							hour: "2-digit",
							minute: "2-digit",
						});
						const dateStr = new Date(r.startedAt).toLocaleDateString([], {
							month: "short",
							day: "numeric",
						});

						return (
							<Group
								key={r.id}
								justify="space-between"
								wrap="nowrap"
								px={22}
								py={15}
								style={{
									borderTop:
										idx === 0 ? "none" : "1px solid var(--qb-separator)",
								}}
							>
								<UnstyledButton
									onClick={() => startCall(peerNumber, peerName)}
									style={{ flex: 1, minWidth: 0 }}
								>
									<Group gap={14} wrap="nowrap">
										<InitialsAvatar name={peerName} size={46} />
										<Box style={{ minWidth: 0 }}>
											<Group gap={8} wrap="nowrap">
												<Text
													fw={700}
													size="md"
													truncate
													style={{
														color: isMissed
															? "var(--qb-danger)"
															: "var(--qb-text-primary)",
													}}
												>
													{peerName}
												</Text>
												{r.attestation && (
													<Badge
														size="xs"
														radius="xl"
														variant="outline"
														color="gray"
													>
														Attestation {r.attestation}
													</Badge>
												)}
											</Group>
											<Group gap={6} mt={2} wrap="nowrap">
												<span
													style={{
														color: isMissed
															? "var(--qb-danger)"
															: "var(--qb-text-secondary)",
														display: "inline-flex",
													}}
												>
													{r.direction === "inbound" ? (
														<IconArrowDownLeft size={14} />
													) : (
														<IconArrowUpRight size={14} />
													)}
												</span>
												<Text className="qb-caption" truncate>
													{isMissed
														? `Missed · ${peerNumber}`
														: `${r.direction === "inbound" ? "Inbound" : r.direction === "outbound" ? "Outbound" : "Internal"} · ${formatDurationMinSec(r.billsecSec)} · ${r.callerNumber ?? "—"} → ${r.destinationNumber}`}
												</Text>
											</Group>
										</Box>
									</Group>
								</UnstyledButton>

								<Group gap={12} wrap="nowrap">
									<Stack align="flex-end" gap={0}>
										<Text className="qb-caption" fw={600}>
											{timeStr}
										</Text>
										<Text
											style={{
												fontSize: 11,
												color: "var(--qb-text-secondary)",
											}}
										>
											{dateStr}
										</Text>
									</Stack>
									<ActionIcon
										variant="subtle"
										radius="xl"
										size={38}
										onClick={() => startCall(peerNumber, peerName)}
										aria-label={`Call ${peerName}`}
										style={{ color: "var(--qb-accent-text)" }}
									>
										<IconPhone size={17} />
									</ActionIcon>
									<ActionIcon
										variant="subtle"
										radius="xl"
										size={38}
										onClick={() => setSelectedCall(r)}
										aria-label="Call details"
										style={{ color: "var(--qb-text-secondary)" }}
									>
										<IconInfo size={18} />
									</ActionIcon>
								</Group>
							</Group>
						);
					})}
				</SurfaceCard>

				<Group justify="space-between" align="center" mt="md">
					<Text className="qb-caption">
						Showing {rows.length} of {cdr.data?.total ?? 0} total call records
					</Text>
					<Pagination
						total={totalPages}
						value={page}
						onChange={setPage}
						radius="xl"
					/>
				</Group>
			</QueryState>

			{/* Call Detail Modal (ⓘ icon) */}
			<Modal
				opened={!!selectedCall}
				onClose={() => setSelectedCall(null)}
				title="Call Detail Record (CDR)"
				centered
			>
				{selectedCall && (
					<Stack gap={14}>
						<SurfaceCard p={18}>
							<Stack gap={10}>
								<Group justify="space-between">
									<Text className="qb-caption">Call UUID</Text>
									<Text className="qb-mono" size="xs" fw={600}>
										{selectedCall.callUuid}
									</Text>
								</Group>
								<Group justify="space-between">
									<Text className="qb-caption">Direction</Text>
									<Badge radius="xl" variant="light" color="brand">
										{selectedCall.direction}
									</Badge>
								</Group>
								<Group justify="space-between">
									<Text className="qb-caption">Caller</Text>
									<Text className="qb-mono" size="sm" fw={700}>
										{selectedCall.callerName
											? `${selectedCall.callerName} (${selectedCall.callerNumber ?? ""})`
											: (selectedCall.callerNumber ?? "—")}
									</Text>
								</Group>
								<Group justify="space-between">
									<Text className="qb-caption">Destination Number</Text>
									<Text className="qb-mono" size="sm" fw={700}>
										{selectedCall.destinationNumber}
									</Text>
								</Group>
								<Group justify="space-between">
									<Text className="qb-caption">Start Timestamp</Text>
									<Text size="sm">
										{new Date(selectedCall.startedAt).toLocaleString()}
									</Text>
								</Group>
								<Group justify="space-between">
									<Text className="qb-caption">Duration / Billsec</Text>
									<Text className="qb-mono" size="sm">
										{selectedCall.durationSec}s total / {selectedCall.billsecSec}s
										billed
									</Text>
								</Group>
								<Group justify="space-between">
									<Text className="qb-caption">Disposition / Hangup Cause</Text>
									<Badge
										radius="xl"
										color={selectedCall.answeredAt ? "brand" : "red"}
									>
										{selectedCall.answeredAt ? "ANSWERED" : "MISSED"} (
										{selectedCall.hangupCause ?? "NORMAL_CLEARING"})
									</Badge>
								</Group>
								<Group justify="space-between">
									<Text className="qb-caption">Trunk & Extension</Text>
									<Text className="qb-mono" size="xs">
										{selectedCall.trunkName ?? "Internal"} · Ext{" "}
										{selectedCall.extensionNumber ?? "—"}
									</Text>
								</Group>
							</Stack>
						</SurfaceCard>

						<Group justify="flex-end">
							<Button
								variant="default"
								onClick={() => setSelectedCall(null)}
							>
								Close
							</Button>
							<Button
								leftSection={<IconPhone size={16} />}
								onClick={() => {
									const num =
										selectedCall.direction === "inbound"
											? (selectedCall.callerNumber ??
												selectedCall.destinationNumber)
											: selectedCall.destinationNumber;
									const name = selectedCall.callerName || num;
									setSelectedCall(null);
									startCall(num, name);
								}}
							>
								Call Back
							</Button>
						</Group>
					</Stack>
				)}
			</Modal>
		</Stack>
	);
}
