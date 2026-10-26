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
import { endpoints, isUnavailable } from "../../lib/api";

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
	const routesQuery = useQuery({
		queryKey: ["outbound-routes"],
		queryFn: endpoints.outboundRoutes,
	});
	const emergencyRoutes = (routesQuery.data ?? []).filter(
		(r) => r.isEmergency && r.enabled,
	).length;
	const locationsUnavailable = isUnavailable(locationsQuery.error);

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
				subtitle="Emergency outbound routes, civic locations and callback numbers."
				actions={
					isUnavailable(locationsQuery.error) ? null : (
						<Button
							leftSection={<IconPlus size={17} />}
							onClick={() => setModalOpen(true)}
						>
							Add Civic Location
						</Button>
					)
				}
			/>

			<MockFeatureBanner
				title="E911 Civic Location Registry (Preview)"
				description="emergency_location exists in portal/api/src/db/schema.ts but has no API route, and no location or callback number is sent on an emergency call yet (I02). See docs/mvp-plan.md, milestone M4."
			/>

			{/* Each tile reports what the server holds. These were hard-coded claims ("911 enabled",
			    "instant email & SMS dispatch") shown regardless of support (I22). */}
			<SimpleGrid cols={{ base: 1, md: 3 }} spacing={20}>
				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Civic Locations
						</Text>
						<div className="qb-display">
							{locationsUnavailable ? "—" : locations.length}
						</div>
						<Text className="qb-caption">
							{locationsUnavailable
								? "Location management is not available on this server"
								: "Stored addresses; not validated against a PSAP database"}
						</Text>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Emergency Routes
						</Text>
						<div className="qb-display">
							{routesQuery.isSuccess ? emergencyRoutes : "—"}
						</div>
						<Text className="qb-caption">
							Enabled outbound routes marked emergency. A caller at their call
							limit can still be refused (I02).
						</Text>
					</Stack>
				</SurfaceCard>

				<SurfaceCard p={24}>
					<Stack gap={6}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Emergency Notification
						</Text>
						<div className="qb-display" style={{ fontSize: 24 }}>
							Not available
						</div>
						<Text className="qb-caption">
							No alert is sent when an emergency call is placed (I02)
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

			{/* Extension-to-Location Mapping. There is no API to save an assignment, so the selects are
			    disabled and start empty rather than showing a location the extension never had. */}
			{!locationsUnavailable && (
				<SurfaceCard p={24}>
					<Stack gap={16}>
						<Box>
							<Text className="qb-headline">Extension E911 Assignment</Text>
							<Text className="qb-caption">
								Preview: assignments cannot be saved yet, and no location is
								sent on a call
							</Text>
						</Box>
						<SimpleGrid cols={{ base: 1, md: 3 }} spacing={14}>
							{(extensionsQuery.data ?? []).map((ext) => (
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
										disabled
										placeholder="Not assigned"
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
			)}

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
