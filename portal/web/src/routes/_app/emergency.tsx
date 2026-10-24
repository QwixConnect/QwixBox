import {
	Badge,
	Box,
	Button,
	Group,
	Modal,
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
import { IconEmergency, IconPlus } from "../../components/Icons";
import {
	DeleteButton,
	MockFeatureBanner,
	PageHeader,
	QueryState,
	SurfaceCard,
} from "../../components/Resource";
import { endpoints } from "../../lib/api";

export const Route = createFileRoute("/_app/emergency")({
	component: EmergencyPage,
});

function EmergencyPage() {
	const qc = useQueryClient();
	const [modalOpen, setModalOpen] = useState(false);

	const [label, setLabel] = useState("");
	const [callbackNumber, setCallbackNumber] = useState("");
	const [street, setStreet] = useState("");
	const [unit, setUnit] = useState("");
	const [city, setCity] = useState("");
	const [region, setRegion] = useState("");
	const [postalCode, setPostalCode] = useState("");
	const [country, setCountry] = useState("CA");

	const locationsQuery = useQuery({
		queryKey: ["emergency-locations"],
		queryFn: endpoints.emergencyLocations,
	});
	const extensionsQuery = useQuery({
		queryKey: ["extensions"],
		queryFn: endpoints.extensions,
	});

	const createMut = useMutation({
		mutationFn: () =>
			endpoints.createEmergencyLocation({
				label,
				callbackNumber: callbackNumber || null,
				street,
				unit: unit || null,
				city,
				region,
				postalCode,
				country,
				validatedAt: new Date().toISOString(),
				assignedExtensions: [],
			}),
		onSuccess: () => {
			setModalOpen(false);
			setLabel("");
			setCallbackNumber("");
			setStreet("");
			setUnit("");
			setCity("");
			setRegion("");
			setPostalCode("");
			void qc.invalidateQueries({ queryKey: ["emergency-locations"] });
		},
	});

	const locations = locationsQuery.data ?? [];

	return (
		<Stack gap={24}>
			<PageHeader
				title="Emergency Calling (E911)"
				subtitle="Kari’s Law & RAY BAUM’S Act dispatchable civic addresses, ELIN callback DIDs, and safety alerts."
				actions={
					<Button
						leftSection={<IconPlus size={17} />}
						onClick={() => setModalOpen(true)}
					>
						Add Civic Location
					</Button>
				}
			/>

			<MockFeatureBanner
				title="E911 Civic Location Registry (Mock-Backed UI)"
				description="The database schema already includes emergency_location in packages/db/src/schema/system.ts. See docs/roadmap.md to expose CRUD routes in apps/api and enforce per-extension E911 PIDF-LO headers."
			/>

			<SimpleGrid cols={{ base: 1, md: 3 }} spacing={20}>
				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Validated Locations
						</Text>
						<div className="qb-display">{locations.length}</div>
						<Text className="qb-caption">
							PSAP-verified US & Canadian civic addresses
						</Text>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Direct 911 Dialing
						</Text>
						<div className="qb-display">Enabled</div>
						<Text className="qb-caption">
							No prefix required (911 and 933 test active)
						</Text>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Safety Notification
						</Text>
						<div className="qb-display" style={{ fontSize: 24 }}>
							Real-time
						</div>
						<Text className="qb-caption">
							Instant email & SMS dispatch alert on any 911 call
						</Text>
					</Stack>
				</SurfaceCard>
			</SimpleGrid>

			<QueryState
				isLoading={locationsQuery.isLoading}
				isError={locationsQuery.isError}
				error={locationsQuery.error}
				isEmpty={locations.length === 0}
			>
				<div className="qb-table-wrap">
					<Table highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Location Label</Table.Th>
								<Table.Th>Dispatchable Civic Address</Table.Th>
								<Table.Th>ELIN Callback DID</Table.Th>
								<Table.Th>Assigned Extensions</Table.Th>
								<Table.Th>PSAP Status</Table.Th>
								<Table.Th />
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{locations.map((loc) => (
								<Table.Tr key={loc.id}>
									<Table.Td>
										<Group gap={8}>
											<span style={{ color: "var(--qb-danger)" }}>
												<IconEmergency size={17} />
											</span>
											<Box>
												<Text fw={700} size="sm">
													{loc.label}
												</Text>
												<Text className="qb-caption">
													{loc.validatedAt
														? `Verified ${new Date(loc.validatedAt).toLocaleDateString()}`
														: "Pending validation"}
												</Text>
											</Box>
										</Group>
									</Table.Td>
									<Table.Td>
										<Text size="sm" fw={500}>
											{loc.street}
											{loc.unit ? `, ${loc.unit}` : ""}
										</Text>
										<Text className="qb-caption">
											{loc.city}, {loc.region} {loc.postalCode} · {loc.country}
										</Text>
									</Table.Td>
									<Table.Td className="qb-mono" fw={600}>
										{loc.callbackNumber ?? "—"}
									</Table.Td>
									<Table.Td>
										<Group gap={6}>
											{(loc.assignedExtensions ?? []).map((ext) => (
												<Badge
													key={ext}
													radius="xl"
													variant="light"
													color="brand"
												>
													Ext {ext}
												</Badge>
											))}
										</Group>
									</Table.Td>
									<Table.Td>
										<Badge
											radius="xl"
											style={{
												background: loc.validatedAt
													? "var(--qb-accent)"
													: "var(--qb-danger)",
												color: "#FFFFFF",
											}}
										>
											{loc.validatedAt ? "Verified" : "Pending"}
										</Badge>
									</Table.Td>
									<Table.Td>
										<DeleteButton
											what={`location ${loc.label}`}
											onConfirm={() =>
												void endpoints
													.deleteEmergencyLocation(loc.id)
													.then(() =>
														qc.invalidateQueries({
															queryKey: ["emergency-locations"],
														}),
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

			{/* Extension-to-Location Mapping */}
			<SurfaceCard p={24}>
				<Stack gap={16}>
					<Box>
						<Text className="qb-headline">Extension E911 Assignment</Text>
						<Text className="qb-caption">
							Ensure every physical or remote SIP endpoint transmits an accurate
							emergency callback location
						</Text>
					</Box>
					<SimpleGrid cols={{ base: 1, md: 3 }} spacing={14}>
						{(extensionsQuery.data ?? []).map((ext, i) => (
							<Box
								key={ext.id}
								style={{
									background: "var(--qb-bg)",
									padding: 16,
									borderRadius: 14,
									border: "1px solid var(--qb-separator)",
								}}
							>
								<Group justify="space-between" mb={10}>
									<Box>
										<Text fw={700} size="sm">
											Ext {ext.number} · {ext.displayName}
										</Text>
										<Text className="qb-caption">
											{ext.deviceMac
												? `MAC ${ext.deviceMac}`
												: "WebRTC / Softphone"}
										</Text>
									</Box>
								</Group>
								<Select
									size="xs"
									defaultValue={
										locations[i % Math.max(1, locations.length)]?.id
									}
									data={locations.map((l) => ({
										value: l.id,
										label: `${l.label} (${l.callbackNumber ?? "Default"})`,
									}))}
								/>
							</Box>
						))}
					</SimpleGrid>
				</Stack>
			</SurfaceCard>

			<Modal
				opened={modalOpen}
				onClose={() => setModalOpen(false)}
				title="Add Dispatchable E911 Location"
				centered
				size="lg"
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						createMut.mutate();
					}}
				>
					<Stack gap={14}>
						<Group grow>
							<TextInput
								label="Location Label"
								placeholder="Toronto HQ — 3rd Floor"
								required
								value={label}
								onChange={(e) => setLabel(e.currentTarget.value)}
							/>
							<TextInput
								label="Emergency Callback ELIN (E.164)"
								placeholder="+14165550100"
								required
								value={callbackNumber}
								onChange={(e) => setCallbackNumber(e.currentTarget.value)}
							/>
						</Group>
						<Group grow>
							<TextInput
								label="Street Address"
								placeholder="200 Bay Street"
								required
								value={street}
								onChange={(e) => setStreet(e.currentTarget.value)}
							/>
							<TextInput
								label="Floor / Suite / Room"
								placeholder="Suite 300"
								value={unit}
								onChange={(e) => setUnit(e.currentTarget.value)}
							/>
						</Group>
						<Group grow>
							<TextInput
								label="City"
								placeholder="Toronto"
								required
								value={city}
								onChange={(e) => setCity(e.currentTarget.value)}
							/>
							<TextInput
								label="State / Province"
								placeholder="ON"
								required
								value={region}
								onChange={(e) => setRegion(e.currentTarget.value)}
							/>
							<TextInput
								label="Postal / ZIP Code"
								placeholder="M5J 2J2"
								required
								value={postalCode}
								onChange={(e) => setPostalCode(e.currentTarget.value)}
							/>
						</Group>
						<Select
							label="Country"
							value={country}
							onChange={(v) => v && setCountry(v)}
							data={[
								{ value: "CA", label: "Canada (CRTC E911)" },
								{ value: "US", label: "United States (FCC E911)" },
							]}
						/>
						<Switch
							defaultChecked
							label="Validate civic address with carrier MSAG / PSAP database immediately"
						/>
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setModalOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={createMut.isPending}>
								Verify & Save Location
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</Stack>
	);
}
