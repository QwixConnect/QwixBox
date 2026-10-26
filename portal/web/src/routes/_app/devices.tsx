import {
	Badge,
	Box,
	Button,
	Group,
	Modal,
	Select,
	SimpleGrid,
	Stack,
	Table,
	Text,
	TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { IconDevices, IconPlus } from "../../components/Icons";
import {
	DeleteButton,
	MockFeatureBanner,
	PageHeader,
	QueryState,
	SegmentedTabs,
	SurfaceCard,
} from "../../components/Resource";
import { endpoints, isUnavailable } from "../../lib/api";

export const Route = createFileRoute("/_app/devices")({
	component: DevicesPage,
});

function DevicesPage() {
	const qc = useQueryClient();
	const [filter, setFilter] = useState<"all" | "online" | "offline">("all");
	const [modalOpen, setModalOpen] = useState(false);

	const [deviceLabel, setDeviceLabel] = useState("");
	const [deviceType, setDeviceType] = useState("Yealink SIP-T54W");
	const [macAddress, setMacAddress] = useState("");
	const [extensionNumber, setExtensionNumber] = useState("1001");
	const [transport, setTransport] = useState("TLS / SRTP");

	const devicesQuery = useQuery({
		queryKey: ["devices"],
		queryFn: endpoints.devices,
	});

	const createMut = useMutation({
		mutationFn: () =>
			endpoints.createDevice({
				deviceLabel,
				deviceType,
				macAddress: macAddress || "80:5E:0C:99:11:22",
				extensionNumber,
				sipUsername: extensionNumber,
				status: "Registered",
				ipAddress: "198.51.100.88:5061",
				transport,
				lastSeenAt: new Date().toISOString(),
				enabled: true,
			}),
		onSuccess: () => {
			setModalOpen(false);
			setDeviceLabel("");
			setMacAddress("");
			void qc.invalidateQueries({ queryKey: ["devices"] });
		},
	});

	const devices = (devicesQuery.data ?? []).filter((d) => {
		if (filter === "online") return d.status === "Registered";
		if (filter === "offline") return d.status !== "Registered";
		return true;
	});

	const onlineCount = (devicesQuery.data ?? []).filter(
		(d) => d.status === "Registered",
	).length;

	return (
		<Stack gap={24}>
			<PageHeader
				title="Devices & Provisioning"
				subtitle="SIP desk phones, iQFone mobile clients, WebRTC browsers, and zero-touch MAC provisioning."
				actions={
					isUnavailable(devicesQuery.error) ? null : (
						<Button
							leftSection={<IconPlus size={17} />}
							onClick={() => setModalOpen(true)}
						>
							Provision Device
						</Button>
					)
				}
			/>

			<Group justify="space-between" align="center" wrap="wrap">
				<SegmentedTabs
					value={filter}
					onChange={setFilter}
					items={[
						{
							value: "all",
							label: "All Endpoints",
							badge: devicesQuery.data?.length,
						},
						{ value: "online", label: "Registered", badge: onlineCount },
						{
							value: "offline",
							label: "Unregistered",
							badge: (devicesQuery.data?.length ?? 0) - onlineCount,
						},
					]}
				/>
			</Group>

			<MockFeatureBanner
				title="Multi-Device SIP Registration & Auto-Provisioning (Mock-Backed UI)"
				description="Hardware desk phones, iQFone mobile push registrations, and WebRTC softphones are served from the portal mock store. See docs/roadmap.md for FreeSWITCH sofia_contact and RPS MAC provisioning integration."
			/>

			<SimpleGrid cols={{ base: 1, md: 3 }} spacing={20}>
				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Registered Endpoints
						</Text>
						<div className="qb-display">
							{onlineCount} / {devicesQuery.data?.length ?? 0}
						</div>
						<Text className="qb-caption">
							Multi-registration enabled per extension
						</Text>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							TLS / WSS Encryption
						</Text>
						<div className="qb-display">100%</div>
						<Text className="qb-caption">
							SRTP media & SIP over TLS/WSS enforced
						</Text>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Provisioning URL
						</Text>
						<Text className="qb-mono" fw={700} size="sm" mt={8}>
							https://prov.qwixbox.io/cfg/
						</Text>
						<Text className="qb-caption">
							Yealink RPS, Poly ZTP & Fanvil DHCP Option 66 ready
						</Text>
					</Stack>
				</SurfaceCard>
			</SimpleGrid>

			<QueryState
				isLoading={devicesQuery.isLoading}
				isError={devicesQuery.isError}
				error={devicesQuery.error}
				isEmpty={devices.length === 0}
			>
				<div className="qb-table-wrap">
					<Table highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Endpoint</Table.Th>
								<Table.Th>Extension</Table.Th>
								<Table.Th>MAC / Client ID</Table.Th>
								<Table.Th>Transport & IP</Table.Th>
								<Table.Th>Status</Table.Th>
								<Table.Th />
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{devices.map((dev) => (
								<Table.Tr key={dev.id}>
									<Table.Td>
										<Group gap={10}>
											<span style={{ color: "var(--qb-text-secondary)" }}>
												<IconDevices size={18} />
											</span>
											<Box>
												<Text fw={700} size="sm">
													{dev.deviceLabel}
												</Text>
												<Text className="qb-caption">{dev.deviceType}</Text>
											</Box>
										</Group>
									</Table.Td>
									<Table.Td>
										<Badge radius="xl" variant="light" color="brand">
											Ext {dev.extensionNumber}
										</Badge>
									</Table.Td>
									<Table.Td className="qb-mono" fw={500}>
										{dev.macAddress ?? dev.sipUsername}
									</Table.Td>
									<Table.Td>
										<Group gap={6}>
											<Badge radius="xl" variant="outline" color="gray">
												{dev.transport}
											</Badge>
											<Text className="qb-caption qb-mono">
												{dev.ipAddress}
											</Text>
										</Group>
									</Table.Td>
									<Table.Td>
										<Box
											className="qb-online-pill"
											style={{
												background: "var(--qb-bg)",
												color:
													dev.status === "Registered"
														? "var(--qb-text-primary)"
														: "var(--qb-danger)",
											}}
										>
											<span
												className="qb-online-dot"
												style={{
													background:
														dev.status === "Registered"
															? "var(--qb-accent)"
															: "var(--qb-danger)",
												}}
											/>
											<span>{dev.status}</span>
										</Box>
									</Table.Td>
									<Table.Td>
										<DeleteButton
											what={dev.deviceLabel}
											onConfirm={() =>
												void endpoints
													.deleteDevice(dev.id)
													.then(() =>
														qc.invalidateQueries({ queryKey: ["devices"] }),
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

			<Modal
				opened={modalOpen}
				onClose={() => setModalOpen(false)}
				title="Provision SIP Endpoint"
				centered
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						createMut.mutate();
					}}
				>
					<Stack gap={14}>
						<TextInput
							label="Device Label"
							placeholder="Alex Morgan — Desk Phone"
							required
							value={deviceLabel}
							onChange={(e) => setDeviceLabel(e.currentTarget.value)}
						/>
						<Select
							label="Vendor & Model"
							value={deviceType}
							onChange={(v) => v && setDeviceType(v)}
							data={[
								{ value: "Yealink SIP-T54W", label: "Yealink SIP-T54W" },
								{
									value: "Yealink SIP-T58W + EXP50",
									label: "Yealink SIP-T58W + EXP50",
								},
								{ value: "Poly VVX 450", label: "Poly VVX 450" },
								{ value: "Fanvil X6U", label: "Fanvil X6U" },
								{
									value: "iQFone iOS Softphone (WebRTC/WSS)",
									label: "iQFone Mobile Softphone (WebRTC/WSS)",
								},
							]}
						/>
						<Group grow>
							<TextInput
								label="MAC Address"
								placeholder="00:15:65:8A:4C:09"
								value={macAddress}
								onChange={(e) => setMacAddress(e.currentTarget.value)}
							/>
							<TextInput
								label="Assign Extension"
								placeholder="1001"
								required
								value={extensionNumber}
								onChange={(e) => setExtensionNumber(e.currentTarget.value)}
							/>
						</Group>
						<Select
							label="SIP Transport"
							value={transport}
							onChange={(v) => v && setTransport(v)}
							data={[
								{ value: "TLS / SRTP", label: "TLS 1.3 + SRTP (Recommended)" },
								{ value: "WSS", label: "WebRTC WSS" },
								{ value: "TCP", label: "TCP" },
								{ value: "UDP", label: "UDP" },
							]}
						/>
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setModalOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={createMut.isPending}>
								Provision Endpoint
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</Stack>
	);
}
