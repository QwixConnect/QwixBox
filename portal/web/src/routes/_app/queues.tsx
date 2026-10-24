import {
	Badge,
	Box,
	Button,
	Group,
	Modal,
	NumberInput,
	Select,
	SimpleGrid,
	Stack,
	Switch,
	Table,
	Text,
	TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { IconPlus } from "../../components/Icons";
import {
	DeleteButton,
	InitialsAvatar,
	MockFeatureBanner,
	PageHeader,
	QueryState,
	SegmentedTabs,
	SurfaceCard,
} from "../../components/Resource";
import { endpoints, type QueueAgentItem } from "../../lib/api";

export const Route = createFileRoute("/_app/queues")({
	component: QueuesPage,
});

function QueuesPage() {
	const qc = useQueryClient();
	const [tab, setTab] = useState<"wallboard" | "queues" | "agents">(
		"wallboard",
	);
	const [modalOpen, setModalOpen] = useState(false);

	const [name, setName] = useState("");
	const [number, setNumber] = useState("");
	const [strategy, setStrategy] = useState("longest-idle-agent");
	const [maxWaitSec, setMaxWaitSec] = useState<number>(300);

	const queuesQuery = useQuery({
		queryKey: ["queues"],
		queryFn: endpoints.queues,
	});
	const agentsQuery = useQuery({
		queryKey: ["queue-agents"],
		queryFn: endpoints.queueAgents,
	});

	const createQueueMut = useMutation({
		mutationFn: () =>
			endpoints.createQueue({
				name,
				number,
				strategy,
				mohSound: "local_stream://default",
				maxWaitSec,
				timeoutType: "voicemail",
				timeoutId: "1001",
				waitingCount: 0,
				activeCalls: 0,
				slaPercent: 95,
				avgWaitSec: 12,
				abandonedToday: 0,
				answeredToday: 0,
				enabled: true,
			}),
		onSuccess: () => {
			setModalOpen(false);
			setName("");
			setNumber("");
			void qc.invalidateQueries({ queryKey: ["queues"] });
		},
	});

	const updateAgentStatusMut = useMutation({
		mutationFn: ({
			agent,
			state,
		}: {
			agent: QueueAgentItem;
			state: QueueAgentItem["state"];
		}) => endpoints.updateQueueAgent(agent.id, { state }),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["queue-agents"] }),
	});

	const queues = queuesQuery.data ?? [];
	const agents = agentsQuery.data ?? [];

	const totalWaiting = queues.reduce((s, q) => s + q.waitingCount, 0);
	const totalActive = queues.reduce((s, q) => s + q.activeCalls, 0);
	const totalAnswered = queues.reduce((s, q) => s + q.answeredToday, 0);
	const avgSla =
		queues.length > 0
			? (
					queues.reduce((s, q) => s + q.slaPercent, 0) / queues.length
				).toFixed(1)
			: "95.0";

	return (
		<Stack gap={24}>
			<PageHeader
				title="Call Queues & Wallboard"
				subtitle="Real-time ACD queue telemetry, SLA compliance, and agent presence management."
				actions={
					<Button
						leftSection={<IconPlus size={17} />}
						onClick={() => setModalOpen(true)}
					>
						New Queue
					</Button>
				}
			/>

			<Group justify="space-between" align="center" wrap="wrap">
				<SegmentedTabs
					value={tab}
					onChange={setTab}
					items={[
						{ value: "wallboard", label: "Live Wallboard" },
						{ value: "queues", label: "ACD Queues", badge: queues.length },
						{
							value: "agents",
							label: "Agents & Tiers",
							badge: agents.length,
						},
					]}
				/>
			</Group>

			<MockFeatureBanner
				title="ACD Queue & Wallboard Telemetry (Mock-Backed Data)"
				description="Queue metrics and agent state transitions are backed by the interactive portal mock store. See docs/roadmap.md for FreeSWITCH mod_callcenter ESL event stream integration."
			/>

			{/* 4 Display KPIs */}
			<SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing={20}>
				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Calls Waiting
						</Text>
						<div
							className="qb-display"
							style={{
								color:
									totalWaiting > 2
										? "var(--qb-danger)"
										: "var(--qb-text-primary)",
							}}
						>
							{totalWaiting}
						</div>
						<Text className="qb-caption">
							Avg wait:{" "}
							{Math.max(0, ...queues.map((q) => q.avgWaitSec))}s
						</Text>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Active Queue Calls
						</Text>
						<div className="qb-display">{totalActive}</div>
						<Text className="qb-caption">
							Connected with tier-1 & tier-2 agents
						</Text>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							SLA Within 20s
						</Text>
						<div className="qb-display">{avgSla}%</div>
						<Text className="qb-caption">Target: 90.0% across all queues</Text>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Answered Today
						</Text>
						<div className="qb-display">{totalAnswered}</div>
						<Text className="qb-caption">
							{queues.reduce((s, q) => s + q.abandonedToday, 0)} abandoned today
						</Text>
					</Stack>
				</SurfaceCard>
			</SimpleGrid>

			{tab === "wallboard" && (
				<SimpleGrid cols={{ base: 1, lg: 3 }} spacing={20}>
					{queues.map((q) => {
						const readyAgents = agents.filter(
							(a) => a.state === "Available",
						).length;
						return (
							<SurfaceCard key={q.id} p={24}>
								<Stack gap={16}>
									<Group justify="space-between" align="flex-start">
										<Box>
											<Group gap={8}>
												<Text className="qb-headline">{q.name}</Text>
												<Badge radius="xl" variant="light" color="brand">
													Ext {q.number}
												</Badge>
											</Group>
											<Text className="qb-caption" mt={2}>
												Strategy: {q.strategy}
											</Text>
										</Box>
										<Badge
											radius="xl"
											style={{
												background:
													q.waitingCount > 1
														? "var(--qb-danger)"
														: "var(--qb-accent)",
												color: "#FFFFFF",
											}}
										>
											{q.slaPercent}% SLA
										</Badge>
									</Group>

									<SimpleGrid cols={3} spacing={12}>
										<Box
											style={{
												background: "var(--qb-bg)",
												padding: 12,
												borderRadius: 14,
												textAlign: "center",
											}}
										>
											<Text
												style={{
													fontSize: 24,
													fontWeight: 800,
													color:
														q.waitingCount > 0
															? "var(--qb-danger)"
															: "var(--qb-text-primary)",
												}}
											>
												{q.waitingCount}
											</Text>
											<Text className="qb-caption">Waiting</Text>
										</Box>
										<Box
											style={{
												background: "var(--qb-bg)",
												padding: 12,
												borderRadius: 14,
												textAlign: "center",
											}}
										>
											<Text style={{ fontSize: 24, fontWeight: 800 }}>
												{q.activeCalls}
											</Text>
											<Text className="qb-caption">Active</Text>
										</Box>
										<Box
											style={{
												background: "var(--qb-bg)",
												padding: 12,
												borderRadius: 14,
												textAlign: "center",
											}}
										>
											<Text
												style={{
													fontSize: 24,
													fontWeight: 800,
													color: "var(--qb-accent-text)",
												}}
											>
												{readyAgents}
											</Text>
											<Text className="qb-caption">Ready</Text>
										</Box>
									</SimpleGrid>

									<Group
										justify="space-between"
										pt={10}
										style={{ borderTop: "1px solid var(--qb-separator)" }}
									>
										<Text className="qb-caption">
											Answered: <strong>{q.answeredToday}</strong> · Abandoned:{" "}
											<strong>{q.abandonedToday}</strong>
										</Text>
										<Text className="qb-caption qb-mono">
											Max wait {q.maxWaitSec}s
										</Text>
									</Group>
								</Stack>
							</SurfaceCard>
						);
					})}
				</SimpleGrid>
			)}

			{tab === "queues" && (
				<QueryState
					isLoading={queuesQuery.isLoading}
					isError={queuesQuery.isError}
					error={queuesQuery.error}
					isEmpty={queues.length === 0}
				>
					<div className="qb-table-wrap">
						<Table highlightOnHover>
							<Table.Thead>
								<Table.Tr>
									<Table.Th>Queue</Table.Th>
									<Table.Th>Extension</Table.Th>
									<Table.Th>Ring Strategy</Table.Th>
									<Table.Th>Max Wait</Table.Th>
									<Table.Th>SLA</Table.Th>
									<Table.Th>Enabled</Table.Th>
									<Table.Th />
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{queues.map((q) => (
									<Table.Tr key={q.id}>
										<Table.Td fw={700}>{q.name}</Table.Td>
										<Table.Td className="qb-mono">{q.number}</Table.Td>
										<Table.Td>{q.strategy}</Table.Td>
										<Table.Td>{q.maxWaitSec}s</Table.Td>
										<Table.Td>{q.slaPercent}%</Table.Td>
										<Table.Td>
											<Switch
												checked={q.enabled}
												onChange={(e) =>
													void endpoints
														.updateQueue(q.id, {
															enabled: e.currentTarget.checked,
														})
														.then(() =>
															qc.invalidateQueries({ queryKey: ["queues"] }),
														)
												}
											/>
										</Table.Td>
										<Table.Td>
											<DeleteButton
												what={`queue ${q.name}`}
												onConfirm={() =>
													void endpoints
														.deleteQueue(q.id)
														.then(() =>
															qc.invalidateQueries({ queryKey: ["queues"] }),
														)
												}
											/>
										</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
						</Table>
					</div>
				</QueryState>
			)}

			{tab === "agents" && (
				<SimpleGrid cols={{ base: 1, md: 2 }} spacing={16}>
					{agents.map((agent) => (
						<SurfaceCard key={agent.id} p={20}>
							<Group justify="space-between" wrap="nowrap">
								<Group gap={14} wrap="nowrap">
									<InitialsAvatar name={agent.name} size={46} />
									<Box>
										<Group gap={8}>
											<Text fw={700} size="md">
												{agent.name}
											</Text>
											<Text className="qb-caption qb-mono">
												ext. {agent.extensionNumber}
											</Text>
										</Group>
										<Text className="qb-caption" mt={2}>
											{agent.queueName} · {agent.callsHandled} calls · Avg talk{" "}
											{agent.avgTalkSec}s
										</Text>
									</Box>
								</Group>

								<Select
									size="xs"
									w={140}
									value={agent.state}
									data={[
										{ value: "Available", label: "● Available" },
										{ value: "On Call", label: "● On Call" },
										{ value: "Wrap-up", label: "◐ Wrap-up" },
										{ value: "Break", label: "○ On Break" },
									]}
									onChange={(val) =>
										val &&
										updateAgentStatusMut.mutate({
											agent,
											state: val as QueueAgentItem["state"],
										})
									}
								/>
							</Group>
						</SurfaceCard>
					))}
				</SimpleGrid>
			)}

			<Modal
				opened={modalOpen}
				onClose={() => setModalOpen(false)}
				title="New Call Queue"
				centered
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						createQueueMut.mutate();
					}}
				>
					<Stack gap={14}>
						<TextInput
							label="Queue Name"
							placeholder="Tier-2 Escalations"
							required
							value={name}
							onChange={(e) => setName(e.currentTarget.value)}
						/>
						<TextInput
							label="Queue Extension"
							placeholder="803"
							required
							value={number}
							onChange={(e) => setNumber(e.currentTarget.value)}
						/>
						<Select
							label="Distribution Strategy"
							value={strategy}
							onChange={(v) => v && setStrategy(v)}
							data={[
								{
									value: "longest-idle-agent",
									label: "Longest Idle Agent",
								},
								{ value: "round-robin", label: "Round Robin" },
								{ value: "ring-all", label: "Ring All" },
								{ value: "top-down", label: "Top Down Tiered" },
							]}
						/>
						<NumberInput
							label="Max Caller Wait (seconds)"
							value={maxWaitSec}
							onChange={(v) => setMaxWaitSec(Number(v) || 300)}
							min={30}
							max={3600}
						/>
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setModalOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={createQueueMut.isPending}>
								Create Queue
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</Stack>
	);
}
