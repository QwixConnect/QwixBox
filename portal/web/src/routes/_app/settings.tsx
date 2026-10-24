import {
	Alert,
	Badge,
	Box,
	Button,
	Group,
	Modal,
	NumberInput,
	Select,
	Stack,
	Switch,
	Text,
	TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
	IconBellOff,
	IconChevronRight,
	IconDevices,
	IconEmergency,
	IconFaxes,
	IconLogout,
	IconPhoneForwarded,
	IconRefresh,
	IconSettings,
	IconShield,
	IconVoicemail,
} from "../../components/Icons";
import {
	ErrorAlert,
	InitialsAvatar,
	PageHeader,
	QueryState,
	RoleGate,
	SettingRow,
	SurfaceCard,
} from "../../components/Resource";
import { endpoints, type TenantUpdate } from "../../lib/api";
import { authClient } from "../../lib/auth-client";
import { notifySaved } from "../../lib/notify";

export const Route = createFileRoute("/_app/settings")({
	component: SettingsPage,
});

function SettingsPage() {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const tenant = useQuery({
		queryKey: ["tenant"],
		queryFn: endpoints.tenant,
	});

	const [dnd, setDnd] = useState(false);
	const [vmGreetingMode, setVmGreetingMode] = useState(
		"Custom · 0:18 · Transcription on",
	);
	const [forwardingSummary, setForwardingSummary] = useState(
		"After 20s → +1 416 555 0199",
	);
	const [ringDevicesSummary, setRingDevicesSummary] = useState(
		"Mobile app + Desk phone",
	);
	const [greetingModalOpen, setGreetingModalOpen] = useState(false);

	const [overrides, setForm] = useState<TenantUpdate>({});
	const [saved, setSaved] = useState(false);

	const form: TenantUpdate = {
		maxConcurrentCalls:
			overrides.maxConcurrentCalls ?? tenant.data?.maxConcurrentCalls ?? 10,
		timezone: overrides.timezone ?? tenant.data?.timezone ?? "America/Toronto",
		defaultCallerIdName:
			overrides.defaultCallerIdName !== undefined
				? overrides.defaultCallerIdName
				: (tenant.data?.defaultCallerIdName ?? ""),
		defaultCallerIdNumber:
			overrides.defaultCallerIdNumber !== undefined
				? overrides.defaultCallerIdNumber
				: (tenant.data?.defaultCallerIdNumber ?? ""),
		recordingPolicy:
			overrides.recordingPolicy ?? tenant.data?.recordingPolicy ?? "none",
		stirShakenEnabled:
			overrides.stirShakenEnabled ?? tenant.data?.stirShakenEnabled ?? true,
	};

	const save = useMutation({
		mutationFn: () => endpoints.updateTenant(form),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["tenant"] });
			setSaved(true);
			setTimeout(() => setSaved(false), 3000);
		},
	});

	const rebuild = useMutation({
		mutationFn: () => endpoints.rebuildCache(),
		onSuccess: () => {
			notifySaved("Redis switch cache rebuilt");
			qc.invalidateQueries({ queryKey: ["tenant"] });
		},
	});

	const logout = async () => {
		await authClient.signOut().catch(() => undefined);
		qc.clear();
		navigate({ to: "/login" });
	};

	const displayName =
		session?.user?.name ||
		(session?.user?.email === "owner@example.test"
			? "Demo User"
			: (session?.user?.email?.split("@")[0] ?? "Demo User"));

	return (
		<Stack gap={24} maw={860}>
			<PageHeader
				title="Settings"
				subtitle="Personal call preferences, tenant-wide caller ID defaults, and voice switch policies."
				actions={
					<RoleGate resource="tenant" action="update">
						<Button
							variant="default"
							leftSection={<IconRefresh size={16} />}
							loading={rebuild.isPending}
							onClick={() => rebuild.mutate()}
						>
							Rebuild Redis Cache
						</Button>
					</RoleGate>
				}
			/>

			{/* Top Profile Card matching Settings@2x.png */}
			<SurfaceCard p={22}>
				<Group justify="space-between" wrap="nowrap">
					<Group gap={16} wrap="nowrap">
						<InitialsAvatar name={displayName} size={56} accent />
						<Box>
							<Text fw={800} size="lg">
								{displayName}
							</Text>
							<Text className="qb-caption">
								{tenant.data?.defaultCallerIdNumber || "+1 416 555 0100"} · ext.
								101 · {tenant.data?.sipDomain ?? "acme.pbx.example.test"}
							</Text>
							<Group gap={6} mt={4}>
								<span
									style={{
										width: 8,
										height: 8,
										borderRadius: 9999,
										background: dnd
											? "var(--qb-danger)"
											: "var(--qb-accent)",
										display: "inline-block",
									}}
								/>
								<Text
									size="xs"
									fw={700}
									style={{
										color: dnd
											? "var(--qb-danger)"
											: "var(--qb-accent-text)",
									}}
								>
									{dnd ? "Do Not Disturb" : "Online"}
								</Text>
							</Group>
						</Box>
					</Group>
					<span style={{ color: "var(--qb-text-secondary)" }}>
						<IconChevronRight size={18} />
					</span>
				</Group>
			</SurfaceCard>

			{/* Personal Call Handling Group matching Settings@2x.png */}
			<SurfaceCard p={0} style={{ overflow: "hidden" }}>
				<SettingRow
					icon={<IconBellOff size={18} />}
					title="Do Not Disturb"
					subtitle="Send calls straight to voicemail"
					rightSection={
						<Switch
							checked={dnd}
							onChange={(e) => setDnd(e.currentTarget.checked)}
							aria-label="Toggle Do Not Disturb"
						/>
					}
				/>
				<SettingRow
					icon={<IconVoicemail size={18} />}
					title="Voicemail greeting"
					subtitle={vmGreetingMode}
					onClick={() => setGreetingModalOpen(true)}
					withSeparator
				/>
				<SettingRow
					icon={<IconPhoneForwarded size={18} />}
					title="Call forwarding"
					subtitle={forwardingSummary}
					onClick={() => navigate({ to: "/extensions" })}
					withSeparator
				/>
				<SettingRow
					icon={<IconDevices size={18} />}
					title="Ring devices"
					subtitle={ringDevicesSummary}
					onClick={() => navigate({ to: "/devices" })}
					withSeparator
				/>
			</SurfaceCard>

			{/* Enterprise Switch & Security Group */}
			<SurfaceCard p={0} style={{ overflow: "hidden" }}>
				<SettingRow
					icon={<IconShield size={18} />}
					title="STIR/SHAKEN & RTP Encryption"
					subtitle={`${form.stirShakenEnabled ? "Attestation A (Full)" : "Disabled"} · TLS 1.3 + SRTP enforced`}
					rightSection={
						<Switch
							checked={Boolean(form.stirShakenEnabled)}
							onChange={(e) =>
								setForm({
									...form,
									stirShakenEnabled: e.currentTarget.checked,
								})
							}
						/>
					}
				/>
				<SettingRow
					icon={<IconEmergency size={18} />}
					title="E911 Emergency Dispatch Locations"
					subtitle="Kari’s Law & RAY BAUM’S Act PIDF-LO civic locations"
					onClick={() => navigate({ to: "/emergency" })}
					withSeparator
				/>
				<SettingRow
					icon={<IconFaxes size={18} />}
					title="T.38 Virtual Fax Gateway"
					subtitle="Inbound SpanDSP PDF reception & email dispatch"
					onClick={() => navigate({ to: "/faxes" })}
					withSeparator
				/>
			</SurfaceCard>

			{/* Tenant System Defaults Form (Backend API /api/tenant) */}
			<QueryState
				isLoading={tenant.isLoading}
				isError={tenant.isError}
				error={tenant.error}
			>
				<SurfaceCard p={24}>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							save.mutate();
						}}
					>
						<Stack gap={18}>
							<Group justify="space-between" wrap="wrap">
								<Group gap={10}>
									<span style={{ color: "var(--qb-accent-text)" }}>
										<IconSettings size={20} />
									</span>
									<Box>
										<Text className="qb-headline">
											Tenant Defaults & Switch Parameters
										</Text>
										<Text className="qb-caption">
											SIP Domain: {tenant.data?.sipDomain} · Tier:{" "}
											{tenant.data?.tier} · Egress: {tenant.data?.egressMode}
										</Text>
									</Box>
								</Group>
								<Badge radius="xl" variant="light" color="brand">
									Dispatcher Set #{tenant.data?.dispatcherSetId ?? 1}
								</Badge>
							</Group>

							<ErrorAlert error={save.error ?? rebuild.error} />
							{saved && (
								<Alert
									color="blue"
									radius={12}
									styles={{
										root: {
											background: "var(--qb-bg)",
											border: "1px solid var(--qb-separator)",
										},
									}}
								>
									Tenant telephony settings saved and synchronized with switch.
								</Alert>
							)}

							<Group grow>
								<NumberInput
									label="Max Concurrent Calls"
									description="Toll-fraud ceiling across all trunks"
									min={1}
									value={form.maxConcurrentCalls ?? 10}
									onChange={(v) =>
										setForm({
											...form,
											maxConcurrentCalls: Number(v) || 10,
										})
									}
								/>
								<TextInput
									label="Default IANA Timezone"
									placeholder="America/Toronto"
									description="Used by time conditions and business hours"
									value={form.timezone ?? ""}
									onChange={(e) =>
										setForm({
											...form,
											timezone: e.currentTarget.value,
										})
									}
								/>
							</Group>

							<Group grow>
								<TextInput
									label="Default Outbound Caller ID Name"
									value={form.defaultCallerIdName ?? ""}
									onChange={(e) =>
										setForm({
											...form,
											defaultCallerIdName: e.currentTarget.value || null,
										})
									}
								/>
								<TextInput
									label="Default Outbound Caller ID Number (E.164)"
									placeholder="14165550100"
									value={form.defaultCallerIdNumber ?? ""}
									onChange={(e) =>
										setForm({
											...form,
											defaultCallerIdNumber: e.currentTarget.value || null,
										})
									}
								/>
							</Group>

							<Select
								label="Call Recording Policy"
								data={[
									{ value: "none", label: "None (on-demand only)" },
									{ value: "inbound", label: "Record all inbound calls" },
									{ value: "outbound", label: "Record all outbound calls" },
									{ value: "all", label: "Record all inbound & outbound calls" },
								]}
								value={form.recordingPolicy ?? "none"}
								onChange={(v) =>
									v &&
									setForm({
										...form,
										recordingPolicy: v as TenantUpdate["recordingPolicy"],
									})
								}
							/>

							<RoleGate resource="tenant" action="update">
								<Group justify="flex-end" pt={4}>
									<Button type="submit" loading={save.isPending}>
										Save System Settings
									</Button>
								</Group>
							</RoleGate>
						</Stack>
					</form>
				</SurfaceCard>
			</QueryState>

			{/* Sign out card matching Settings@2x.png */}
			<SurfaceCard p={0} style={{ overflow: "hidden" }}>
				<SettingRow
					icon={<IconLogout size={18} />}
					title="Sign out"
					danger
					onClick={logout}
					rightSection={<span />}
				/>
			</SurfaceCard>

			<Modal
				opened={greetingModalOpen}
				onClose={() => setGreetingModalOpen(false)}
				title="Voicemail & Ring Preferences"
				centered
			>
				<Stack gap={14}>
					<Select
						label="Active Voicemail Greeting"
						value={vmGreetingMode}
						onChange={(v) => v && setVmGreetingMode(v)}
						data={[
							{
								value: "Custom · 0:18 · Transcription on",
								label: "Custom Greeting (0:18) · AI Transcription On",
							},
							{
								value: "Out of Office · 0:24 · Transcription on",
								label: "Out of Office Greeting (0:24)",
							},
							{
								value: "Standard System Name · Transcription on",
								label: "System Default Spoken Extension",
							},
						]}
					/>
					<TextInput
						label="Unanswered Call Forwarding Summary"
						value={forwardingSummary}
						onChange={(e) => setForwardingSummary(e.currentTarget.value)}
					/>
					<Select
						label="Simultaneous Ring Endpoints"
						value={ringDevicesSummary}
						onChange={(v) => v && setRingDevicesSummary(v)}
						data={[
							{
								value: "Mobile app + Desk phone",
								label: "Mobile app + Desk phone",
							},
							{
								value: "WebRTC Browser + Mobile + Desk phone",
								label: "All Registered Devices (WebRTC + Mobile + Desk)",
							},
							{ value: "Desk phone only", label: "Desk phone only" },
						]}
					/>
					<Group justify="flex-end" mt="sm">
						<Button onClick={() => setGreetingModalOpen(false)}>Done</Button>
					</Group>
				</Stack>
			</Modal>
		</Stack>
	);
}
