import {
	Alert,
	Badge,
	Box,
	Button,
	Group,
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
	IconEmergency,
	IconFaxes,
	IconLogout,
	IconPhoneForwarded,
	IconRefresh,
	IconSettings,
	IconShield,
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
import { useUnenforced } from "../../lib/use-unenforced";

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

	const unenforced = useUnenforced("tenant_settings");

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
			overrides.stirShakenEnabled ?? tenant.data?.stirShakenEnabled ?? false,
	};

	const save = useMutation({
		mutationFn: () => endpoints.updateTenant(unenforced.omit(form)),
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
								{session?.user?.email}
								{tenant.data?.sipDomain ? ` · ${tenant.data.sipDomain}` : ""}
							</Text>
						</Box>
					</Group>
				</Group>
			</SurfaceCard>

			{/* Personal call handling needs a portal account linked to an extension, which does not
			    exist yet (I09). These rows used to be local state and invented summaries. */}
			<SurfaceCard p={0} style={{ overflow: "hidden" }}>
				<SettingRow
					icon={<IconPhoneForwarded size={18} />}
					title="Call handling"
					subtitle="Do Not Disturb, forwarding and voicemail are set per extension. Portal accounts are not linked to an extension yet."
					onClick={() => navigate({ to: "/extensions" })}
				/>
			</SurfaceCard>

			{/* Enterprise Switch & Security Group */}
			<SurfaceCard p={0} style={{ overflow: "hidden" }}>
				<SettingRow
					icon={<IconShield size={18} />}
					title="STIR/SHAKEN signing"
					subtitle={
						!unenforced.stirSigning
							? "Not available: this server was not installed with STIR/SHAKEN signing"
							: form.stirShakenEnabled
								? "Outbound calls from this tenant are signed by this server"
								: "Outbound calls from this tenant are not signed by this server"
					}
					rightSection={
						<Switch
							aria-label="Sign outbound calls"
							disabled={unenforced.isUnenforced("stirShakenEnabled")}
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
					subtitle="Preview: emergency location management is not built yet"
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
									{...unenforced.props("maxConcurrentCalls")}
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
									{...unenforced.props("defaultCallerIdName")}
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
									{...unenforced.props("defaultCallerIdNumber")}
								/>
							</Group>

							<Select
								label="Call Recording Policy"
								data={[
									{ value: "none", label: "None (on-demand only)" },
									{ value: "inbound", label: "Record all inbound calls" },
									{ value: "outbound", label: "Record all outbound calls" },
									{
										value: "all",
										label: "Record all inbound & outbound calls",
									},
								]}
								value={form.recordingPolicy ?? "none"}
								onChange={(v) =>
									v &&
									setForm({
										...form,
										recordingPolicy: v as TenantUpdate["recordingPolicy"],
									})
								}
								{...unenforced.props("recordingPolicy")}
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
		</Stack>
	);
}
