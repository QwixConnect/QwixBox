import {
	Badge,
	Button,
	Group,
	Modal,
	MultiSelect,
	NumberInput,
	Select,
	Stack,
	Switch,
	Table,
	Text,
	TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
	DestinationPicker,
	type DestinationValue,
} from "../../components/DestinationPicker";
import { IconPlus } from "../../components/Icons";
import {
	DeleteButton,
	ErrorAlert,
	PageHeader,
	QueryState,
	RoleGate,
	SegmentedTabs,
	SurfaceCard,
} from "../../components/Resource";
import { endpoints, type IvrMenu, type RingGroup } from "../../lib/api";
import { notifyFailed } from "../../lib/notify";

export const Route = createFileRoute("/_app/call-flows")({
	component: CallFlowsPage,
});

function CallFlowsPage() {
	const [tab, setTab] = useState<"rg" | "ivr" | "tc">("rg");
	const rg = useQuery({
		queryKey: ["ring-groups"],
		queryFn: endpoints.ringGroups,
	});
	const ivr = useQuery({
		queryKey: ["ivr-menus"],
		queryFn: endpoints.ivrMenus,
	});
	const tc = useQuery({
		queryKey: ["time-conditions"],
		queryFn: endpoints.timeConditions,
	});

	return (
		<Stack gap={24}>
			<PageHeader
				title="Call Flows"
				subtitle="Multi-member ring groups, multi-level IVR auto-attendants, and business-hours time conditions."
			/>

			<SegmentedTabs
				value={tab}
				onChange={setTab}
				items={[
					{
						value: "rg",
						label: "Ring Groups",
						badge: rg.data?.length,
					},
					{
						value: "ivr",
						label: "IVR Auto-Attendants",
						badge: ivr.data?.length,
					},
					{
						value: "tc",
						label: "Time Conditions",
						badge: tc.data?.length,
					},
				]}
			/>

			{tab === "rg" && <RingGroupsSection />}
			{tab === "ivr" && <IvrSection />}
			{tab === "tc" && <TimeConditionsSection />}
		</Stack>
	);
}

function RingGroupsSection() {
	const qc = useQueryClient();
	const list = useQuery({
		queryKey: ["ring-groups"],
		queryFn: endpoints.ringGroups,
	});
	const exts = useQuery({
		queryKey: ["extensions"],
		queryFn: endpoints.extensions,
	});
	const [open, setOpen] = useState(false);
	const [managingGroup, setManagingGroup] = useState<RingGroup | null>(null);
	const [name, setName] = useState("");
	const [number, setNumber] = useState("");
	const [strategy, setStrategy] = useState<RingGroup["strategy"]>("simultaneous");
	const [ringTimeoutSec, setRingTimeoutSec] = useState<number>(20);
	const [failover, setFailover] = useState<DestinationValue>({
		type: null,
		id: null,
	});

	const create = useMutation({
		mutationFn: () =>
			endpoints.createRingGroup({
				name,
				number,
				strategy,
				ringTimeoutSec,
				failoverType: failover.type,
				failoverId: failover.id,
				enabled: true,
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["ring-groups"] });
			setOpen(false);
			setName("");
			setNumber("");
		},
	});
	const remove = useMutation({
		mutationFn: (id: string) => endpoints.deleteRingGroup(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["ring-groups"] }),
		onError: (error) => notifyFailed("Could not delete ring group", error),
	});
	const toggleEnabled = useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
			endpoints.updateRingGroup(id, { enabled }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["ring-groups"] }),
	});

	return (
		<Stack gap={16}>
			<Group justify="space-between">
				<Text className="qb-caption">
					Ring multiple extensions simultaneously or sequentially before
					overflowing to a fallback destination.
				</Text>
				<RoleGate resource="callflow" action="create">
					<Button
						leftSection={<IconPlus size={16} />}
						onClick={() => setOpen(true)}
					>
						New Ring Group
					</Button>
				</RoleGate>
			</Group>

			<QueryState
				isLoading={list.isLoading}
				isError={list.isError}
				error={list.error}
				isEmpty={(list.data ?? []).length === 0}
			>
				<div className="qb-table-wrap">
					<Table highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Extension</Table.Th>
								<Table.Th>Group Name</Table.Th>
								<Table.Th>Strategy</Table.Th>
								<Table.Th>Timeout</Table.Th>
								<Table.Th>Failover Destination</Table.Th>
								<Table.Th>Enabled</Table.Th>
								<Table.Th />
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{list.data?.map((rg) => (
								<Table.Tr key={rg.id}>
									<Table.Td className="qb-mono" fw={700}>
										{rg.number}
									</Table.Td>
									<Table.Td fw={700}>{rg.name}</Table.Td>
									<Table.Td>
										<Badge radius="xl" variant="light" color="brand">
											{rg.strategy}
										</Badge>
									</Table.Td>
									<Table.Td>{rg.ringTimeoutSec}s</Table.Td>
									<Table.Td className="qb-mono">
										{rg.failoverType
											? `${rg.failoverType}${rg.failoverId ? ` → ${rg.failoverId}` : ""}`
											: "—"}
									</Table.Td>
									<Table.Td>
										<Switch
											checked={rg.enabled}
											onChange={(e) =>
												toggleEnabled.mutate({
													id: rg.id,
													enabled: e.currentTarget.checked,
												})
											}
										/>
									</Table.Td>
									<Table.Td>
										<Group gap={8} justify="flex-end">
											<Button
												size="compact-sm"
												variant="light"
												onClick={() => setManagingGroup(rg)}
											>
												Members
											</Button>
											<RoleGate
												resource="callflow"
												action="delete"
												mode="disable"
											>
												<DeleteButton onConfirm={() => remove.mutate(rg.id)} />
											</RoleGate>
										</Group>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</div>
			</QueryState>

			{managingGroup && (
				<RingGroupMembersModal
					group={managingGroup}
					extensions={exts.data ?? []}
					onClose={() => setManagingGroup(null)}
				/>
			)}

			<Modal
				opened={open}
				onClose={() => setOpen(false)}
				title="New Ring Group"
				size="lg"
				centered
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						create.mutate();
					}}
				>
					<Stack gap={14}>
						<ErrorAlert error={create.error} />
						<Group grow>
							<TextInput
								label="Group Name"
								placeholder="Sales Team"
								required
								value={name}
								onChange={(e) => setName(e.currentTarget.value)}
							/>
							<TextInput
								label="Extension Number"
								placeholder="600"
								required
								value={number}
								onChange={(e) => setNumber(e.currentTarget.value)}
							/>
						</Group>
						<Group grow>
							<Select
								label="Ring Strategy"
								value={strategy}
								onChange={(v) => v && setStrategy(v as RingGroup["strategy"])}
								data={[
									{
										value: "simultaneous",
										label: "Simultaneous (ring all)",
									},
									{
										value: "sequential",
										label: "Sequential (hunt in order)",
									},
									{
										value: "enterprise",
										label: "Enterprise (staggered)",
									},
								]}
							/>
							<NumberInput
								label="Ring Timeout (s)"
								min={5}
								max={120}
								value={ringTimeoutSec}
								onChange={(v) => setRingTimeoutSec(Number(v) || 20)}
							/>
						</Group>
						<DestinationPicker
							label="Failover / No-Answer Destination"
							value={failover}
							onChange={setFailover}
						/>
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={create.isPending}>
								Create Ring Group
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</Stack>
	);
}

function RingGroupMembersModal({
	group,
	extensions,
	onClose,
}: {
	group: RingGroup;
	extensions: Array<{ id: string; number: string; displayName: string }>;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const members = useQuery({
		queryKey: ["ring-group-members", group.id],
		queryFn: () => endpoints.ringGroupMembers(group.id),
	});
	const [extId, setExtId] = useState<string | null>(null);

	const add = useMutation({
		mutationFn: () => {
			if (!extId) throw new Error("Choose an extension");
			return endpoints.addRingGroupMember(group.id, {
				extensionId: extId,
				delaySec: 0,
			});
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["ring-group-members", group.id] });
			setExtId(null);
		},
	});

	const remove = useMutation({
		mutationFn: (memberId: string) =>
			endpoints.removeRingGroupMember(group.id, memberId),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: ["ring-group-members", group.id] }),
	});

	return (
		<Modal
			opened
			onClose={onClose}
			title={`Members — ${group.name} (${group.number})`}
			size="lg"
			centered
		>
			<Stack gap={16}>
				<Group align="flex-end">
					<Select
						label="Add Extension"
						placeholder="Select extension"
						style={{ flex: 1 }}
						data={extensions.map((e) => ({
							value: e.id,
							label: `${e.number} — ${e.displayName}`,
						}))}
						value={extId}
						onChange={setExtId}
						searchable
					/>
					<Button
						onClick={() => add.mutate()}
						loading={add.isPending}
						disabled={!extId}
					>
						Add Member
					</Button>
				</Group>
				<Stack gap={8}>
					{(members.data ?? []).map((m) => (
						<SurfaceCard key={m.id} p={12}>
							<Group justify="space-between">
								<Text fw={700} size="sm">
									{m.number} — {m.displayName}
								</Text>
								<DeleteButton onConfirm={() => remove.mutate(m.id)} />
							</Group>
						</SurfaceCard>
					))}
				</Stack>
			</Stack>
		</Modal>
	);
}

const IVR_DIGITS = [
	"0",
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"*",
	"#",
];

function IvrSection() {
	const qc = useQueryClient();
	const list = useQuery({
		queryKey: ["ivr-menus"],
		queryFn: endpoints.ivrMenus,
	});
	const [open, setOpen] = useState(false);
	const [managingIvr, setManagingIvr] = useState<IvrMenu | null>(null);
	const [name, setName] = useState("");
	const [number, setNumber] = useState("");
	const [greetingSound, setGreetingSound] = useState("ivr/ivr-welcome.wav");
	const [timeoutSec, setTimeoutSec] = useState<number>(5);
	const [maxRetries, setMaxRetries] = useState<number>(3);
	const [timeoutDest, setTimeoutDest] = useState<DestinationValue>({
		type: null,
		id: null,
	});

	const create = useMutation({
		mutationFn: () =>
			endpoints.createIvrMenu({
				name,
				number,
				greetingSound,
				timeoutSec,
				maxRetries,
				timeoutType: timeoutDest.type,
				timeoutId: timeoutDest.id,
				enabled: true,
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["ivr-menus"] });
			setOpen(false);
			setName("");
			setNumber("");
		},
	});
	const remove = useMutation({
		mutationFn: (id: string) => endpoints.deleteIvrMenu(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["ivr-menus"] }),
		onError: (error) => notifyFailed("Could not delete IVR", error),
	});
	const toggleEnabled = useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
			endpoints.updateIvrMenu(id, { enabled }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["ivr-menus"] }),
	});

	return (
		<Stack gap={16}>
			<Group justify="space-between">
				<Text className="qb-caption">
					Interactive Voice Response (IVR) menus play spoken prompts and route
					callers based on DTMF digits.
				</Text>
				<RoleGate resource="callflow" action="create">
					<Button
						leftSection={<IconPlus size={16} />}
						onClick={() => setOpen(true)}
					>
						New IVR Menu
					</Button>
				</RoleGate>
			</Group>

			<QueryState
				isLoading={list.isLoading}
				isError={list.isError}
				error={list.error}
				isEmpty={(list.data ?? []).length === 0}
			>
				<div className="qb-table-wrap">
					<Table highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Extension</Table.Th>
								<Table.Th>Menu Name</Table.Th>
								<Table.Th>Greeting Audio</Table.Th>
								<Table.Th>Timeout / Retries</Table.Th>
								<Table.Th>Timeout Fallback</Table.Th>
								<Table.Th>Enabled</Table.Th>
								<Table.Th />
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{list.data?.map((m) => (
								<Table.Tr key={m.id}>
									<Table.Td className="qb-mono" fw={700}>
										{m.number}
									</Table.Td>
									<Table.Td fw={700}>{m.name}</Table.Td>
									<Table.Td className="qb-mono" maw={260}>
										{m.greetingSound ?? "—"}
									</Table.Td>
									<Table.Td>
										{m.timeoutSec}s · {m.maxRetries} retries
									</Table.Td>
									<Table.Td className="qb-mono">
										{m.timeoutType
											? `${m.timeoutType}${m.timeoutId ? ` → ${m.timeoutId}` : ""}`
											: "—"}
									</Table.Td>
									<Table.Td>
										<Switch
											checked={m.enabled}
											onChange={(e) =>
												toggleEnabled.mutate({
													id: m.id,
													enabled: e.currentTarget.checked,
												})
											}
										/>
									</Table.Td>
									<Table.Td>
										<Group gap={8} justify="flex-end">
											<Button
												size="compact-sm"
												variant="light"
												onClick={() => setManagingIvr(m)}
											>
												DTMF Keys
											</Button>
											<RoleGate
												resource="callflow"
												action="delete"
												mode="disable"
											>
												<DeleteButton onConfirm={() => remove.mutate(m.id)} />
											</RoleGate>
										</Group>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</div>
			</QueryState>

			{managingIvr && (
				<IvrOptionsModal
					menu={managingIvr}
					onClose={() => setManagingIvr(null)}
				/>
			)}

			<Modal
				opened={open}
				onClose={() => setOpen(false)}
				title="New IVR Auto-Attendant"
				size="lg"
				centered
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						create.mutate();
					}}
				>
					<Stack gap={14}>
						<ErrorAlert error={create.error} />
						<Group grow>
							<TextInput
								label="Menu Name"
								placeholder="Main Reception"
								required
								value={name}
								onChange={(e) => setName(e.currentTarget.value)}
							/>
							<TextInput
								label="Extension Number"
								placeholder="500"
								required
								value={number}
								onChange={(e) => setNumber(e.currentTarget.value)}
							/>
						</Group>
						<TextInput
							label="Greeting Audio Path"
							value={greetingSound}
							onChange={(e) => setGreetingSound(e.currentTarget.value)}
						/>
						<Group grow>
							<NumberInput
								label="Input Timeout (s)"
								min={1}
								max={30}
								value={timeoutSec}
								onChange={(v) => setTimeoutSec(Number(v) || 5)}
							/>
							<NumberInput
								label="Max Invalid Retries"
								min={1}
								max={10}
								value={maxRetries}
								onChange={(v) => setMaxRetries(Number(v) || 3)}
							/>
						</Group>
						<DestinationPicker
							label="Timeout Destination"
							value={timeoutDest}
							onChange={setTimeoutDest}
						/>
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={create.isPending}>
								Create IVR Menu
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</Stack>
	);
}

function IvrOptionsModal({
	menu,
	onClose,
}: {
	menu: IvrMenu;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const options = useQuery({
		queryKey: ["ivr-options", menu.id],
		queryFn: () => endpoints.ivrOptions(menu.id),
	});
	const [digit, setDigit] = useState("1");
	const [description, setDescription] = useState("");
	const [dest, setDest] = useState<DestinationValue>({
		type: "extension",
		id: null,
	});

	const save = useMutation({
		mutationFn: () => {
			if (!dest.type) throw new Error("Choose a destination");
			return endpoints.setIvrOption(menu.id, digit, {
				destinationType: dest.type,
				destinationId: dest.id,
				description: description || undefined,
			});
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["ivr-options", menu.id] });
			setDescription("");
		},
	});

	const remove = useMutation({
		mutationFn: (d: string) => endpoints.deleteIvrOption(menu.id, d),
		onSuccess: () =>
			qc.invalidateQueries({ queryKey: ["ivr-options", menu.id] }),
	});

	return (
		<Modal
			opened
			onClose={onClose}
			title={`DTMF Options — ${menu.name} (${menu.number})`}
			size="lg"
			centered
		>
			<Stack gap={14}>
				<ErrorAlert error={save.error} />
				<Group grow>
					<Select
						label="DTMF Key"
						data={IVR_DIGITS}
						value={digit}
						onChange={(v) => v && setDigit(v)}
					/>
					<TextInput
						label="Description"
						placeholder="Sales"
						value={description}
						onChange={(e) => setDescription(e.currentTarget.value)}
					/>
				</Group>
				<DestinationPicker
					label="Destination"
					allowNone={false}
					value={dest}
					onChange={setDest}
				/>
				<Group justify="flex-end">
					<Button onClick={() => save.mutate()} loading={save.isPending}>
						Save Key Option
					</Button>
				</Group>
				<Stack gap={8}>
					{(options.data ?? []).map((o) => (
						<SurfaceCard key={o.digit} p={12}>
							<Group justify="space-between">
								<Group gap={10}>
									<Badge radius="xl" variant="light" color="brand">
										Key {o.digit}
									</Badge>
									<Text fw={700} size="sm">
										{o.description ?? "—"}
									</Text>
									<Text className="qb-caption qb-mono">
										→ {o.destinationType}
										{o.destinationId ? ` (${o.destinationId})` : ""}
									</Text>
								</Group>
								<DeleteButton onConfirm={() => remove.mutate(o.digit)} />
							</Group>
						</SurfaceCard>
					))}
				</Stack>
			</Stack>
		</Modal>
	);
}

const DOW = [
	{ value: "0", label: "Sun" },
	{ value: "1", label: "Mon" },
	{ value: "2", label: "Tue" },
	{ value: "3", label: "Wed" },
	{ value: "4", label: "Thu" },
	{ value: "5", label: "Fri" },
	{ value: "6", label: "Sat" },
];

function TimeConditionsSection() {
	const qc = useQueryClient();
	const list = useQuery({
		queryKey: ["time-conditions"],
		queryFn: endpoints.timeConditions,
	});
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [timezone, setTimezone] = useState("America/Toronto");
	const [days, setDays] = useState<string[]>(["1", "2", "3", "4", "5"]);
	const [start, setStart] = useState("09:00");
	const [end, setEnd] = useState("17:00");
	const [matchDest, setMatchDest] = useState<DestinationValue>({
		type: "ivr",
		id: null,
	});
	const [noMatchDest, setNoMatchDest] = useState<DestinationValue>({
		type: "voicemail",
		id: null,
	});

	const create = useMutation({
		mutationFn: () => {
			if (!matchDest.type || !noMatchDest.type)
				throw new Error("Choose open and closed destinations");
			return endpoints.createTimeCondition({
				name,
				timezone,
				rules: [
					{
						days: days.map(Number),
						start,
						end,
					},
				],
				matchType: matchDest.type,
				matchId: matchDest.id,
				noMatchType: noMatchDest.type,
				noMatchId: noMatchDest.id,
				enabled: true,
			});
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["time-conditions"] });
			setOpen(false);
			setName("");
		},
	});
	const remove = useMutation({
		mutationFn: (id: string) => endpoints.deleteTimeCondition(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["time-conditions"] }),
		onError: (error) => notifyFailed("Could not delete time condition", error),
	});
	const toggleEnabled = useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
			endpoints.updateTimeCondition(id, { enabled }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["time-conditions"] }),
	});

	return (
		<Stack gap={16}>
			<Group justify="space-between">
				<Text className="qb-caption">
					Evaluate caller timestamp against IANA timezone business hours and
					holiday schedules.
				</Text>
				<RoleGate resource="callflow" action="create">
					<Button
						leftSection={<IconPlus size={16} />}
						onClick={() => setOpen(true)}
					>
						New Time Condition
					</Button>
				</RoleGate>
			</Group>

			<QueryState
				isLoading={list.isLoading}
				isError={list.isError}
				error={list.error}
				isEmpty={(list.data ?? []).length === 0}
			>
				<div className="qb-table-wrap">
					<Table highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Schedule Name</Table.Th>
								<Table.Th>Timezone</Table.Th>
								<Table.Th>Open Hours</Table.Th>
								<Table.Th>Open Destination</Table.Th>
								<Table.Th>Closed Destination</Table.Th>
								<Table.Th>Enabled</Table.Th>
								<Table.Th />
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{list.data?.map((tc) => (
								<Table.Tr key={tc.id}>
									<Table.Td fw={700}>{tc.name}</Table.Td>
									<Table.Td className="qb-mono">{tc.timezone}</Table.Td>
									<Table.Td className="qb-mono">
										{tc.rules
											.map((r) =>
												r.date
													? `${r.invert ? "!" : ""}${r.date}`
													: `${(r.days ?? []).map((d) => DOW[d]?.label).join(",")} ${r.start ?? ""}–${r.end ?? ""}`,
											)
											.join("; ")}
									</Table.Td>
									<Table.Td className="qb-mono">
										{tc.matchType}
										{tc.matchId ? ` → ${tc.matchId}` : ""}
									</Table.Td>
									<Table.Td className="qb-mono">
										{tc.noMatchType}
										{tc.noMatchId ? ` → ${tc.noMatchId}` : ""}
									</Table.Td>
									<Table.Td>
										<Switch
											checked={tc.enabled}
											onChange={(e) =>
												toggleEnabled.mutate({
													id: tc.id,
													enabled: e.currentTarget.checked,
												})
											}
										/>
									</Table.Td>
									<Table.Td>
										<RoleGate
											resource="callflow"
											action="delete"
											mode="disable"
										>
											<DeleteButton onConfirm={() => remove.mutate(tc.id)} />
										</RoleGate>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</div>
			</QueryState>

			<Modal
				opened={open}
				onClose={() => setOpen(false)}
				title="New Time Condition"
				size="lg"
				centered
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						create.mutate();
					}}
				>
					<Stack gap={14}>
						<ErrorAlert error={create.error} />
						<Group grow>
							<TextInput
								label="Schedule Name"
								placeholder="Business Hours"
								required
								value={name}
								onChange={(e) => setName(e.currentTarget.value)}
							/>
							<TextInput
								label="IANA Timezone"
								placeholder="America/Toronto"
								required
								value={timezone}
								onChange={(e) => setTimezone(e.currentTarget.value)}
							/>
						</Group>
						<MultiSelect
							label="Active Days of Week"
							data={DOW}
							value={days}
							onChange={setDays}
						/>
						<Group grow>
							<TextInput
								label="Open Time (HH:MM)"
								value={start}
								onChange={(e) => setStart(e.currentTarget.value)}
							/>
							<TextInput
								label="Close Time (HH:MM)"
								value={end}
								onChange={(e) => setEnd(e.currentTarget.value)}
							/>
						</Group>
						<DestinationPicker
							label="Open (Match) Destination"
							allowNone={false}
							value={matchDest}
							onChange={setMatchDest}
						/>
						<DestinationPicker
							label="Closed (No-Match) Destination"
							allowNone={false}
							value={noMatchDest}
							onChange={setNoMatchDest}
						/>
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={create.isPending}>
								Create Time Condition
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</Stack>
	);
}
