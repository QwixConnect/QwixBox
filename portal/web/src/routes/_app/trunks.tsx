import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Group,
	Modal,
	NumberInput,
	PasswordInput,
	Select,
	SimpleGrid,
	Stack,
	Switch,
	Table,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { IconEdit, IconPlus } from "../../components/Icons";
import {
	DeleteButton,
	ErrorAlert,
	PageHeader,
	QueryState,
	RoleGate,
	SurfaceCard,
} from "../../components/Resource";
import { endpoints, type Trunk } from "../../lib/api";

export const Route = createFileRoute("/_app/trunks")({
	component: TrunksPage,
});

function TrunksPage() {
	const qc = useQueryClient();
	const list = useQuery({
		queryKey: ["trunks"],
		queryFn: endpoints.trunks,
	});
	const [open, setOpen] = useState(false);
	const [editingTrunk, setEditingTrunk] = useState<Trunk | null>(null);

	const [name, setName] = useState("");
	const [host, setHost] = useState("");
	const [port, setPort] = useState<number>(5060);
	const [transport, setTransport] = useState("udp");
	const [authMode, setAuthMode] = useState<"ip" | "register">("ip");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [fromDomain, setFromDomain] = useState("");
	const [codecPrefs, setCodecPrefs] = useState("OPUS,G722,PCMU,PCMA");
	const [priority, setPriority] = useState<number>(10);
	const [carrierSigns, setCarrierSigns] = useState(true);
	const [enabled, setEnabled] = useState(true);

	const openCreate = () => {
		setEditingTrunk(null);
		setName("");
		setHost("");
		setPort(5060);
		setTransport("udp");
		setAuthMode("ip");
		setUsername("");
		setPassword("");
		setFromDomain("");
		setCodecPrefs("OPUS,G722,PCMU,PCMA");
		setPriority(10);
		setCarrierSigns(true);
		setEnabled(true);
		setOpen(true);
	};

	const openEdit = (t: Trunk) => {
		setEditingTrunk(t);
		setName(t.name);
		setHost(t.host);
		setPort(t.port ?? 5060);
		setTransport(t.transport ?? "udp");
		setAuthMode(t.authMode);
		setUsername(t.username ?? "");
		setPassword("");
		setFromDomain(t.fromDomain ?? "");
		setCodecPrefs(t.codecPrefs ?? "OPUS,G722,PCMU,PCMA");
		setPriority(t.priority);
		setCarrierSigns(t.carrierSigns);
		setEnabled(t.enabled);
		setOpen(true);
	};

	const saveMut = useMutation({
		mutationFn: async () => {
			const payload: Partial<Trunk> = {
				name,
				host,
				port,
				transport,
				authMode,
				username: username || null,
				fromDomain: fromDomain || null,
				codecPrefs: codecPrefs || null,
				priority,
				carrierSigns,
				enabled,
			};
			let saved: Trunk;
			if (editingTrunk) {
				saved = await endpoints.updateTrunk(editingTrunk.id, payload);
			} else {
				saved = await endpoints.createTrunk(payload);
			}
			if (password.trim()) {
				await endpoints.setTrunkPassword(saved.id, password.trim());
			}
			return saved;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["trunks"] });
			setOpen(false);
		},
	});

	const remove = useMutation({
		mutationFn: (id: string) => endpoints.deleteTrunk(id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["trunks"] }),
	});

	const trunks = list.data ?? [];

	return (
		<Stack gap={24}>
			<PageHeader
				title="SIP Trunks"
				subtitle="External carrier gateways, Sofia SIP registrations, and STIR/SHAKEN signing policies."
				actions={
					<RoleGate resource="trunk" action="create">
						<Button leftSection={<IconPlus size={17} />} onClick={openCreate}>
							New SIP Trunk
						</Button>
					</RoleGate>
				}
			/>

			<SimpleGrid cols={{ base: 1, sm: 3 }} spacing={20}>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Configured Trunks
						</Text>
						<div className="qb-display">{trunks.length}</div>
						<Text className="qb-caption">
							{trunks.filter((t) => t.enabled).length} active carrier peers
						</Text>
					</Stack>
				</SurfaceCard>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							STIR/SHAKEN Signing
						</Text>
						<div className="qb-display">
							{trunks.filter((t) => t.carrierSigns).length} / {trunks.length}
						</div>
						<Text className="qb-caption">
							Carrier-signed outbound attestation
						</Text>
					</Stack>
				</SurfaceCard>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Failover Mode
						</Text>
						<div className="qb-display" style={{ fontSize: 28 }}>
							Priority LCR
						</div>
						<Text className="qb-caption">
							Automatic hunting on 5xx carrier response
						</Text>
					</Stack>
				</SurfaceCard>
			</SimpleGrid>

			<QueryState
				isLoading={list.isLoading}
				isError={list.isError}
				error={list.error}
				isEmpty={trunks.length === 0}
			>
				<div className="qb-table-wrap">
					<Table highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Carrier Gateway</Table.Th>
								<Table.Th>SIP Endpoint</Table.Th>
								<Table.Th>Transport</Table.Th>
								<Table.Th>Auth & Signing</Table.Th>
								<Table.Th>Priority</Table.Th>
								<Table.Th>Status</Table.Th>
								<Table.Th />
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{trunks.map((t) => (
								<Table.Tr key={t.id}>
									<Table.Td>
										<Text fw={700} size="sm">
											{t.name}
										</Text>
										{t.fromDomain && (
											<Text className="qb-caption qb-mono">
												From: {t.fromDomain}
											</Text>
										)}
									</Table.Td>
									<Table.Td className="qb-mono" fw={600}>
										{t.host}:{t.port ?? 5060}
									</Table.Td>
									<Table.Td>
										<Badge radius="xl" variant="light" color="brand">
											{(t.transport ?? "udp").toUpperCase()}
										</Badge>
									</Table.Td>
									<Table.Td>
										<Text size="sm">
											{t.authMode === "register"
												? `SIP Register (${t.username ?? ""})`
												: "IP Peer ACL"}
										</Text>
										<Text className="qb-caption">
											{t.carrierSigns
												? "Carrier signs STIR/SHAKEN"
												: "Local STI-AS signing"}
										</Text>
									</Table.Td>
									<Table.Td fw={700}>#{t.priority}</Table.Td>
									<Table.Td>
										<Box
											className="qb-online-pill"
											style={{
												background: "var(--qb-bg)",
												color: t.enabled
													? "var(--qb-text-primary)"
													: "var(--qb-text-secondary)",
											}}
										>
											<span
												className="qb-online-dot"
												style={{
													background: t.enabled
														? "var(--qb-accent)"
														: "var(--qb-text-secondary)",
												}}
											/>
											<span>{t.enabled ? "Enabled" : "Disabled"}</span>
										</Box>
									</Table.Td>
									<Table.Td>
										<Group gap={6} wrap="nowrap">
											<RoleGate resource="trunk" action="update">
												<Tooltip label="Edit Trunk">
													<ActionIcon
														variant="subtle"
														radius="xl"
														size={36}
														onClick={() => openEdit(t)}
														style={{ color: "var(--qb-text-secondary)" }}
													>
														<IconEdit size={16} />
													</ActionIcon>
												</Tooltip>
											</RoleGate>
											<RoleGate resource="trunk" action="delete">
												<DeleteButton
													what={`trunk ${t.name}`}
													onConfirm={() => remove.mutate(t.id)}
												/>
											</RoleGate>
										</Group>
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
				title={
					editingTrunk ? `Edit Trunk: ${editingTrunk.name}` : "New SIP Trunk"
				}
				size="lg"
				centered
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						saveMut.mutate();
					}}
				>
					<Stack gap={14}>
						<ErrorAlert error={saveMut.error} />
						<TextInput
							label="Trunk Name"
							placeholder="Primary Carrier — US East"
							required
							value={name}
							onChange={(e) => setName(e.currentTarget.value)}
						/>
						<Group grow>
							<TextInput
								label="SIP Host / Proxy"
								placeholder="192.0.2.10"
								required
								value={host}
								onChange={(e) => setHost(e.currentTarget.value)}
							/>
							<NumberInput
								label="Port"
								value={port}
								onChange={(v) => setPort(Number(v) || 5060)}
								min={1}
								max={65535}
							/>
							<Select
								label="Transport"
								value={transport}
								onChange={(v) => v && setTransport(v)}
								data={[
									{ value: "udp", label: "UDP" },
									{ value: "tcp", label: "TCP" },
									{ value: "tls", label: "TLS 1.3" },
								]}
							/>
						</Group>
						<Group grow>
							<Select
								label="Authentication Mode"
								value={authMode}
								onChange={(v) =>
									v && setAuthMode(v as "ip" | "register")
								}
								data={[
									{ value: "ip", label: "IP ACL Peer" },
									{ value: "register", label: "SIP REGISTER Digest" },
								]}
							/>
							<NumberInput
								label="Failover Priority"
								value={priority}
								onChange={(v) => setPriority(Number(v) || 10)}
								min={1}
								max={1000}
							/>
						</Group>
						{authMode === "register" && (
							<Group grow>
								<TextInput
									label="Auth Username"
									value={username}
									onChange={(e) => setUsername(e.currentTarget.value)}
								/>
								<PasswordInput
									label="Auth Password"
									placeholder={
										editingTrunk ? "Leave blank to keep existing" : ""
									}
									value={password}
									onChange={(e) => setPassword(e.currentTarget.value)}
								/>
							</Group>
						)}
						<Group grow>
							<TextInput
								label="From Domain (optional)"
								value={fromDomain}
								onChange={(e) => setFromDomain(e.currentTarget.value)}
							/>
							<TextInput
								label="Codec Preferences"
								value={codecPrefs}
								onChange={(e) => setCodecPrefs(e.currentTarget.value)}
							/>
						</Group>
						<Switch
							label="Carrier signs outbound calls with STIR/SHAKEN PASSporT"
							checked={carrierSigns}
							onChange={(e) => setCarrierSigns(e.currentTarget.checked)}
						/>
						<Switch
							label="Trunk Enabled"
							checked={enabled}
							onChange={(e) => setEnabled(e.currentTarget.checked)}
						/>
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={saveMut.isPending}>
								{editingTrunk ? "Save Changes" : "Create Trunk"}
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</Stack>
	);
}
