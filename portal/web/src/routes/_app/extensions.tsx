import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Code,
	CopyButton,
	Group,
	Modal,
	NumberInput,
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
import { CallHandlingModal } from "../../components/CallHandlingModal";
import {
	IconEdit,
	IconPhone,
	IconPlus,
	IconRefresh,
} from "../../components/Icons";
import {
	DeleteButton,
	ErrorAlert,
	InitialsAvatar,
	PageHeader,
	QueryState,
	RoleGate,
	SurfaceCard,
} from "../../components/Resource";
import { useWebphone } from "../../components/WebphoneDrawer";
import { type Extension, endpoints } from "../../lib/api";

export const Route = createFileRoute("/_app/extensions")({
	component: ExtensionsPage,
});

function ExtensionsPage() {
	const { startCall } = useWebphone();
	const qc = useQueryClient();
	const list = useQuery({
		queryKey: ["extensions"],
		queryFn: endpoints.extensions,
	});
	const [open, setOpen] = useState(false);
	const [editingExt, setEditingExt] = useState<Extension | null>(null);
	const [createdSecret, setCreatedSecret] = useState<{
		title: string;
		ext: string;
		secretLabel: string;
		secretValue: string;
	} | null>(null);
	const [callHandlingExt, setCallHandlingExt] = useState<Extension | null>(
		null,
	);

	const [number, setNumber] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [voicemailEmail, setVoicemailEmail] = useState("");
	const [callerIdName, setCallerIdName] = useState("");
	const [callerIdNumber, setCallerIdNumber] = useState("");
	const [deviceMac, setDeviceMac] = useState("");
	const [codecPrefs, setCodecPrefs] = useState("OPUS,G722,PCMU,PCMA");
	const [maxConcurrentCalls, setMaxConcurrentCalls] = useState<number>(4);
	const [voicemailEnabled, setVoicemailEnabled] = useState(true);
	const [enabled, setEnabled] = useState(true);

	const resetForm = () => {
		setNumber("");
		setDisplayName("");
		setVoicemailEmail("");
		setCallerIdName("");
		setCallerIdNumber("");
		setDeviceMac("");
		setCodecPrefs("OPUS,G722,PCMU,PCMA");
		setMaxConcurrentCalls(4);
		setVoicemailEnabled(true);
		setEnabled(true);
	};

	const openCreate = () => {
		setEditingExt(null);
		resetForm();
		setOpen(true);
	};

	const openEdit = (ext: Extension) => {
		setEditingExt(ext);
		setNumber(ext.number);
		setDisplayName(ext.displayName);
		setVoicemailEmail(ext.voicemailEmail ?? "");
		setCallerIdName(ext.callerIdName ?? "");
		setCallerIdNumber(ext.callerIdNumber ?? "");
		setDeviceMac(ext.deviceMac ?? "");
		setCodecPrefs(ext.codecPrefs ?? "OPUS,G722,PCMU,PCMA");
		setMaxConcurrentCalls(ext.maxConcurrentCalls ?? 4);
		setVoicemailEnabled(ext.voicemailEnabled);
		setEnabled(ext.enabled);
		setOpen(true);
	};

	const saveMut = useMutation({
		mutationFn: async () => {
			const payload = {
				number,
				displayName,
				voicemailEmail: voicemailEmail || null,
				callerIdName: callerIdName || null,
				callerIdNumber: callerIdNumber || null,
				deviceMac: deviceMac || null,
				codecPrefs: codecPrefs || null,
				maxConcurrentCalls,
				voicemailEnabled,
				enabled,
			};
			if (editingExt) {
				return endpoints.updateExtension(editingExt.id, payload);
			}
			return endpoints.createExtension(payload);
		},
		onSuccess: (res) => {
			void qc.invalidateQueries({ queryKey: ["extensions"] });
			setOpen(false);
			if (!editingExt && res.sipPassword) {
				setCreatedSecret({
					title: "Save SIP Password",
					ext: res.number,
					secretLabel: "SIP Password",
					secretValue: res.sipPassword,
				});
			}
		},
	});

	const rotateSipMut = useMutation({
		mutationFn: async (ext: Extension) => {
			const newPass = `sip-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36).slice(-4)}`;
			await endpoints.updateExtension(ext.id, { sipPassword: newPass });
			return { ext: ext.number, sipPassword: newPass };
		},
		onSuccess: ({ ext, sipPassword }) => {
			setCreatedSecret({
				title: "Rotated SIP Password",
				ext,
				secretLabel: "New SIP Password",
				secretValue: sipPassword,
			});
		},
	});

	const rotatePinMut = useMutation({
		mutationFn: async (ext: Extension) => {
			const newPin = String(Math.floor(100000 + Math.random() * 900000));
			await endpoints.updateExtension(ext.id, { voicemailPin: newPin });
			return { ext: ext.number, voicemailPin: newPin };
		},
		onSuccess: ({ ext, voicemailPin }) => {
			setCreatedSecret({
				title: "Rotated Voicemail PIN",
				ext,
				secretLabel: "New Voicemail PIN",
				secretValue: voicemailPin,
			});
		},
	});

	const deleteMut = useMutation({
		mutationFn: (id: string) => endpoints.deleteExtension(id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["extensions"] }),
	});

	const extensions = list.data ?? [];

	return (
		<Stack gap={24}>
			<PageHeader
				title="Extensions"
				subtitle="Internal SIP seats, WebRTC softphones, caller ID overrides, and per-user call handling rules."
				actions={
					<RoleGate resource="extension" action="create">
						<Button leftSection={<IconPlus size={17} />} onClick={openCreate}>
							New Extension
						</Button>
					</RoleGate>
				}
			/>

			<SimpleGrid cols={{ base: 1, sm: 3 }} spacing={20}>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Provisioned Seats
						</Text>
						<div className="qb-display">{extensions.length}</div>
						<Text className="qb-caption">
							{extensions.filter((e) => e.enabled).length} active on switch
						</Text>
					</Stack>
				</SurfaceCard>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Hardware Provisioned
						</Text>
						<div className="qb-display">
							{extensions.filter((e) => Boolean(e.deviceMac)).length}
						</div>
						<Text className="qb-caption">Desk phones + WebRTC softphones</Text>
					</Stack>
				</SurfaceCard>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Do Not Disturb / Forwarded
						</Text>
						<div className="qb-display">
							{
								extensions.filter(
									(e) =>
										e.dnd ||
										e.forwardAllTo ||
										e.forwardBusyTo ||
										e.forwardNoAnswerTo,
								).length
							}
						</div>
						<Text className="qb-caption">Active custom call handling</Text>
					</Stack>
				</SurfaceCard>
			</SimpleGrid>

			<QueryState
				isLoading={list.isLoading}
				isError={list.isError}
				error={list.error}
				isEmpty={extensions.length === 0}
			>
				<div className="qb-table-wrap">
					<Table highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Extension & User</Table.Th>
								<Table.Th>Outbound Caller ID</Table.Th>
								<Table.Th>Call Handling & Capabilities</Table.Th>
								<Table.Th>Status</Table.Th>
								<Table.Th>Actions & Credentials</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{extensions.map((ext) => (
								<Table.Tr key={ext.id}>
									<Table.Td>
										<Group gap={12} wrap="nowrap">
											<InitialsAvatar name={ext.displayName} size={42} />
											<Box>
												<Group gap={8}>
													<Text fw={800} size="sm" className="qb-mono">
														{ext.number}
													</Text>
													<Text fw={700} size="sm">
														{ext.displayName}
													</Text>
												</Group>
												<Text className="qb-caption">
													{ext.voicemailEmail || "No email assigned"}
												</Text>
											</Box>
										</Group>
									</Table.Td>
									<Table.Td>
										{ext.callerIdNumber ? (
											<Box>
												<Text size="sm" fw={600}>
													{ext.callerIdName || ext.displayName}
												</Text>
												<Text className="qb-caption qb-mono">
													{ext.callerIdNumber}
												</Text>
											</Box>
										) : (
											<Text className="qb-caption">Tenant Default DID</Text>
										)}
									</Table.Td>
									<Table.Td>
										<Group gap={6}>
											{ext.dnd && (
												<Badge radius="xl" color="red">
													DND
												</Badge>
											)}
											{ext.forwardAllTo && (
												<Badge radius="xl" variant="light" color="brand">
													Fwd → {ext.forwardAllTo}
												</Badge>
											)}
											<Badge
												radius="xl"
												variant="light"
												color={ext.voicemailEnabled ? "brand" : "gray"}
											>
												{ext.voicemailEnabled ? "Voicemail" : "No VM"}
											</Badge>
											{ext.deviceMac && (
												<Badge radius="xl" variant="outline" color="gray">
													{ext.deviceMac}
												</Badge>
											)}
										</Group>
									</Table.Td>
									<Table.Td>
										<Box
											className="qb-online-pill"
											style={{
												background: "var(--qb-bg)",
												color: ext.enabled
													? "var(--qb-text-primary)"
													: "var(--qb-text-secondary)",
											}}
										>
											<span
												className="qb-online-dot"
												style={{
													background: ext.enabled
														? "var(--qb-accent)"
														: "var(--qb-text-secondary)",
												}}
											/>
											<span>{ext.enabled ? "Enabled" : "Disabled"}</span>
										</Box>
									</Table.Td>
									<Table.Td>
										<Group gap={8} wrap="nowrap">
											<Tooltip label={`Dial Ext ${ext.number}`}>
												<ActionIcon
													variant="subtle"
													radius="xl"
													size={36}
													onClick={() =>
														startCall(ext.number, ext.displayName)
													}
													style={{ color: "var(--qb-accent-text)" }}
												>
													<IconPhone size={16} />
												</ActionIcon>
											</Tooltip>
											<RoleGate resource="extension" action="update">
												<Group gap={6} wrap="nowrap">
													<Button
														size="compact-sm"
														variant="default"
														radius="xl"
														onClick={() => setCallHandlingExt(ext)}
														styles={{
															root: {
																minHeight: 34,
																height: 34,
																fontSize: 12,
																background: "var(--qb-bg)",
																border: "1px solid var(--qb-separator)",
															},
														}}
													>
														Call Handling
													</Button>
													<Tooltip label="Edit Extension">
														<ActionIcon
															variant="subtle"
															radius="xl"
															size={36}
															onClick={() => openEdit(ext)}
															style={{ color: "var(--qb-text-secondary)" }}
														>
															<IconEdit size={16} />
														</ActionIcon>
													</Tooltip>
													<Tooltip label="Rotate SIP Password">
														<ActionIcon
															variant="subtle"
															radius="xl"
															size={36}
															onClick={() => rotateSipMut.mutate(ext)}
															style={{ color: "var(--qb-text-secondary)" }}
														>
															<IconRefresh size={16} />
														</ActionIcon>
													</Tooltip>
													<Button
														size="compact-sm"
														variant="subtle"
														color="gray"
														onClick={() => rotatePinMut.mutate(ext)}
														styles={{
															root: {
																minHeight: 34,
																height: 34,
																fontSize: 12,
															},
														}}
													>
														Reset PIN
													</Button>
												</Group>
											</RoleGate>
											<RoleGate resource="extension" action="delete">
												<DeleteButton
													what={`extension ${ext.number}`}
													onConfirm={() => deleteMut.mutate(ext.id)}
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

			{callHandlingExt && (
				<CallHandlingModal
					extension={callHandlingExt}
					onClose={() => setCallHandlingExt(null)}
				/>
			)}

			<Modal
				opened={open}
				onClose={() => setOpen(false)}
				title={
					editingExt ? `Edit Extension ${editingExt.number}` : "New Extension"
				}
				centered
				size="lg"
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						saveMut.mutate();
					}}
				>
					<Stack gap={14}>
						<ErrorAlert error={saveMut.error} />
						<Group grow>
							<TextInput
								label="Extension Number"
								placeholder="1001"
								required
								value={number}
								onChange={(e) => setNumber(e.currentTarget.value)}
							/>
							<TextInput
								label="Display Name"
								placeholder="Alex Morgan"
								required
								value={displayName}
								onChange={(e) => setDisplayName(e.currentTarget.value)}
							/>
						</Group>
						<TextInput
							label="Voicemail Email (Voicemail-to-Email Notifications)"
							placeholder="alex@company.com"
							value={voicemailEmail}
							onChange={(e) => setVoicemailEmail(e.currentTarget.value)}
						/>
						<Group grow>
							<TextInput
								label="Outbound Caller ID Name"
								placeholder="Northstar Sales"
								value={callerIdName}
								onChange={(e) => setCallerIdName(e.currentTarget.value)}
							/>
							<TextInput
								label="Outbound Caller ID Number (E.164)"
								placeholder="+14165550101"
								value={callerIdNumber}
								onChange={(e) => setCallerIdNumber(e.currentTarget.value)}
							/>
						</Group>
						<Group grow>
							<TextInput
								label="Hardware Desk Phone MAC (optional)"
								placeholder="00:15:65:8A:4C:01"
								value={deviceMac}
								onChange={(e) => setDeviceMac(e.currentTarget.value)}
							/>
							<TextInput
								label="Codec Preferences"
								placeholder="OPUS,G722,PCMU,PCMA"
								value={codecPrefs}
								onChange={(e) => setCodecPrefs(e.currentTarget.value)}
							/>
							<NumberInput
								label="Max Concurrent Calls"
								value={maxConcurrentCalls}
								onChange={(v) => setMaxConcurrentCalls(Number(v) || 4)}
								min={1}
								max={32}
							/>
						</Group>
						<Switch
							label="Enable Voicemail Box"
							checked={voicemailEnabled}
							onChange={(e) => setVoicemailEnabled(e.currentTarget.checked)}
						/>
						<Switch
							label="Extension Enabled on Switch"
							checked={enabled}
							onChange={(e) => setEnabled(e.currentTarget.checked)}
						/>
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={saveMut.isPending}>
								{editingExt ? "Save Changes" : "Create Extension"}
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>

			<Modal
				opened={!!createdSecret}
				onClose={() => setCreatedSecret(null)}
				title={createdSecret?.title ?? "Credential Generated"}
				centered
			>
				{createdSecret && (
					<Stack gap={16}>
						<Text size="sm" c="dimmed">
							Copy this credential for extension{" "}
							<strong>{createdSecret.ext}</strong> now — for security, the raw
							secret is only displayed once:
						</Text>
						<SurfaceCard p={16}>
							<Group justify="space-between">
								<Box>
									<Text className="qb-caption">
										{createdSecret.secretLabel}
									</Text>
									<Code
										className="qb-mono"
										style={{ fontSize: 16, fontWeight: 700 }}
									>
										{createdSecret.secretValue}
									</Code>
								</Box>
								<CopyButton value={createdSecret.secretValue}>
									{({ copied, copy }) => (
										<Button size="sm" onClick={copy}>
											{copied ? "Copied" : "Copy"}
										</Button>
									)}
								</CopyButton>
							</Group>
						</SurfaceCard>
					</Stack>
				)}
			</Modal>
		</Stack>
	);
}
