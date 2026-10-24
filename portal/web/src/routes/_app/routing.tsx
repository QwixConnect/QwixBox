import {
	Alert,
	Badge,
	Button,
	Group,
	Modal,
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
} from "../../components/Resource";
import { endpoints } from "../../lib/api";

export const Route = createFileRoute("/_app/routing")({
	component: RoutingPage,
});

function RoutingPage() {
	const [tab, setTab] = useState<"inbound" | "outbound">("inbound");
	const inbound = useQuery({
		queryKey: ["inbound-routes"],
		queryFn: endpoints.inboundRoutes,
	});
	const outbound = useQuery({
		queryKey: ["outbound-routes"],
		queryFn: endpoints.outboundRoutes,
	});

	return (
		<Stack gap={24}>
			<PageHeader
				title="Inbound & Outbound Routing"
				subtitle="DID number mapping, inbound call destinations, and outbound least-cost carrier dialplan."
			/>

			<SegmentedTabs
				value={tab}
				onChange={setTab}
				items={[
					{
						value: "inbound",
						label: "Inbound Routes (DIDs)",
						badge: inbound.data?.length,
					},
					{
						value: "outbound",
						label: "Outbound Dialplan",
						badge: outbound.data?.length,
					},
				]}
			/>

			{tab === "inbound" ? <InboundSection /> : <OutboundSection />}
		</Stack>
	);
}

function InboundSection() {
	const qc = useQueryClient();
	const list = useQuery({
		queryKey: ["inbound-routes"],
		queryFn: endpoints.inboundRoutes,
	});
	const [open, setOpen] = useState(false);
	const [description, setDescription] = useState("");
	const [didPattern, setDidPattern] = useState("");
	const [priority, setPriority] = useState<number>(100);
	const [destination, setDestination] = useState<DestinationValue>({
		type: "extension",
		id: null,
	});

	const create = useMutation({
		mutationFn: () => {
			if (!destination.type) throw new Error("Choose a destination type");
			return endpoints.createInboundRoute({
				didPattern,
				description: description || null,
				priority,
				destinationType: destination.type,
				destinationId: destination.id,
				enabled: true,
			});
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["inbound-routes"] });
			setOpen(false);
			setDescription("");
			setDidPattern("");
		},
	});
	const remove = useMutation({
		mutationFn: (id: string) => endpoints.deleteInboundRoute(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["inbound-routes"] }),
	});
	const toggleEnabled = useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
			endpoints.updateInboundRoute(id, { enabled }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["inbound-routes"] }),
	});

	return (
		<Stack gap={16}>
			<Group justify="space-between">
				<Text className="qb-caption">
					Inbound routes match dialed DIDs (E.164 or regex) in ascending
					priority order.
				</Text>
				<RoleGate resource="route" action="create">
					<Button
						leftSection={<IconPlus size={16} />}
						onClick={() => setOpen(true)}
					>
						New Inbound Route
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
								<Table.Th>Priority</Table.Th>
								<Table.Th>DID Pattern</Table.Th>
								<Table.Th>Description</Table.Th>
								<Table.Th>Target Destination</Table.Th>
								<Table.Th>Enabled</Table.Th>
								<Table.Th />
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{list.data?.map((r) => (
								<Table.Tr key={r.id}>
									<Table.Td>
										<Badge radius="xl" variant="light" color="gray">
											#{r.priority}
										</Badge>
									</Table.Td>
									<Table.Td className="qb-mono" fw={700}>
										{r.didPattern}
									</Table.Td>
									<Table.Td fw={600}>{r.description ?? "—"}</Table.Td>
									<Table.Td className="qb-mono">
										<Badge radius="xl" variant="light" color="brand">
											{r.destinationType}
											{r.destinationId ? ` → ${r.destinationId}` : ""}
										</Badge>
									</Table.Td>
									<Table.Td>
										<Switch
											checked={r.enabled}
											onChange={(e) =>
												toggleEnabled.mutate({
													id: r.id,
													enabled: e.currentTarget.checked,
												})
											}
										/>
									</Table.Td>
									<Table.Td>
										<RoleGate resource="route" action="delete" mode="disable">
											<DeleteButton onConfirm={() => remove.mutate(r.id)} />
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
				title="New Inbound Route"
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
								label="DID Pattern (E.164 or regex)"
								placeholder="^14165550100$"
								required
								value={didPattern}
								onChange={(e) => setDidPattern(e.currentTarget.value)}
							/>
							<NumberInput
								label="Evaluation Priority"
								value={priority}
								onChange={(v) => setPriority(Number(v) || 100)}
							/>
						</Group>
						<TextInput
							label="Description"
							placeholder="Main Reception DID"
							value={description}
							onChange={(e) => setDescription(e.currentTarget.value)}
						/>
						<DestinationPicker
							label="Destination"
							allowNone={false}
							value={destination}
							onChange={setDestination}
						/>
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={create.isPending}>
								Create Inbound Route
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</Stack>
	);
}

function OutboundSection() {
	const qc = useQueryClient();
	const list = useQuery({
		queryKey: ["outbound-routes"],
		queryFn: endpoints.outboundRoutes,
	});
	const trunks = useQuery({
		queryKey: ["trunks"],
		queryFn: endpoints.trunks,
	});
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [pattern, setPattern] = useState("^1[0-9]{10}$");
	const [priority, setPriority] = useState<number>(10);
	const [stripDigits, setStripDigits] = useState<number>(0);
	const [prependDigits, setPrependDigits] = useState("");
	const [trunkId, setTrunkId] = useState<string | null>(null);
	const [isEmergency, setIsEmergency] = useState(false);

	const trunkMap = new Map((trunks.data ?? []).map((t) => [t.id, t.name]));

	const create = useMutation({
		mutationFn: () =>
			endpoints.createOutboundRoute({
				name,
				pattern,
				priority,
				stripDigits,
				prependDigits: prependDigits || null,
				trunkId,
				isEmergency,
				enabled: true,
			}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["outbound-routes"] });
			setOpen(false);
			setName("");
		},
	});
	const remove = useMutation({
		mutationFn: (id: string) => endpoints.deleteOutboundRoute(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["outbound-routes"] }),
	});
	const toggleEnabled = useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
			endpoints.updateOutboundRoute(id, { enabled }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["outbound-routes"] }),
	});

	return (
		<Stack gap={16}>
			<Group justify="space-between">
				<Text className="qb-caption">
					Outbound dialplan rules match dialed digits and route calls out the
					selected carrier trunk.
				</Text>
				<RoleGate resource="route" action="create">
					<Button
						leftSection={<IconPlus size={16} />}
						onClick={() => setOpen(true)}
					>
						New Outbound Route
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
								<Table.Th>Priority</Table.Th>
								<Table.Th>Rule Name</Table.Th>
								<Table.Th>Dial Pattern</Table.Th>
								<Table.Th>Digit Transform</Table.Th>
								<Table.Th>Carrier Trunk</Table.Th>
								<Table.Th>Enabled</Table.Th>
								<Table.Th />
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{list.data?.map((r) => (
								<Table.Tr key={r.id}>
									<Table.Td>
										<Badge radius="xl" variant="light" color="gray">
											#{r.priority}
										</Badge>
									</Table.Td>
									<Table.Td fw={700}>
										<Group gap={8}>
											<Text fw={700} size="sm">
												{r.name}
											</Text>
											{r.isEmergency && (
												<Badge
													radius="xl"
													style={{
														background: "var(--qb-danger)",
														color: "#FFFFFF",
													}}
												>
													EMERGENCY
												</Badge>
											)}
										</Group>
									</Table.Td>
									<Table.Td className="qb-mono">{r.pattern}</Table.Td>
									<Table.Td className="qb-mono">
										-{r.stripDigits} / +{r.prependDigits ?? "∅"}
									</Table.Td>
									<Table.Td>
										{r.trunkId ? (
											<Badge radius="xl" variant="light" color="brand">
												{trunkMap.get(r.trunkId) ?? r.trunkId}
											</Badge>
										) : (
											"—"
										)}
									</Table.Td>
									<Table.Td>
										<Switch
											checked={r.enabled}
											onChange={(e) =>
												toggleEnabled.mutate({
													id: r.id,
													enabled: e.currentTarget.checked,
												})
											}
										/>
									</Table.Td>
									<Table.Td>
										<RoleGate resource="route" action="delete" mode="disable">
											<DeleteButton onConfirm={() => remove.mutate(r.id)} />
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
				title="New Outbound Route"
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
						<TextInput
							label="Route Name"
							placeholder="NANP 10/11-digit"
							required
							value={name}
							onChange={(e) => setName(e.currentTarget.value)}
						/>
						<Group grow>
							<TextInput
								label="Dial Pattern (regex)"
								required
								value={pattern}
								onChange={(e) => setPattern(e.currentTarget.value)}
							/>
							<NumberInput
								label="Priority"
								value={priority}
								onChange={(v) => setPriority(Number(v) || 10)}
							/>
						</Group>
						<Group grow>
							<NumberInput
								label="Strip Leading Digits"
								min={0}
								max={15}
								value={stripDigits}
								onChange={(v) => setStripDigits(Number(v) || 0)}
							/>
							<TextInput
								label="Prepend Digits"
								placeholder="1"
								value={prependDigits}
								onChange={(e) => setPrependDigits(e.currentTarget.value)}
							/>
						</Group>
						<Select
							label="Carrier Trunk"
							searchable
							data={(trunks.data ?? []).map((t) => ({
								value: t.id,
								label: t.name,
							}))}
							value={trunkId}
							onChange={setTrunkId}
						/>
						<Switch
							label="Emergency Route (911 / 933 — bypasses fraud caps)"
							checked={isEmergency}
							onChange={(e) => setIsEmergency(e.currentTarget.checked)}
						/>
						{isEmergency && (
							<Alert color="red" radius={12} title="Emergency routes bypass caps">
								Matched before fraud limits, time conditions, and route
								permissions by design.
							</Alert>
						)}
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={create.isPending}>
								Create Outbound Route
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</Stack>
	);
}
