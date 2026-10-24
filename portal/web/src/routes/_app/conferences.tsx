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
	MockFeatureBanner,
	PageHeader,
	SegmentedTabs,
	SurfaceCard,
	WaveformPlayer,
} from "../../components/Resource";
import { useWebphone } from "../../components/WebphoneDrawer";
import { endpoints } from "../../lib/api";

export const Route = createFileRoute("/_app/conferences")({
	component: ConferencesPage,
});

function ConferencesPage() {
	const { startCall } = useWebphone();
	const qc = useQueryClient();
	const [tab, setTab] = useState<"conferences" | "parking" | "moh">(
		"conferences",
	);
	const [confModal, setConfModal] = useState(false);
	const [parkModal, setParkModal] = useState(false);

	const [confName, setConfName] = useState("");
	const [confExt, setConfExt] = useState("");
	const [confDesc, setConfDesc] = useState("");
	const [confPin, setConfPin] = useState("");
	const [modPin, setModPin] = useState("");

	const [parkName, setParkName] = useState("");
	const [lotExtension, setLotExtension] = useState("750");
	const [slotStart, setSlotStart] = useState("751");
	const [slotEnd, setSlotEnd] = useState("760");
	const [parkTimeout, setParkTimeout] = useState<number>(90);
	const [timeoutExt, setTimeoutExt] = useState("1006");

	const confQuery = useQuery({
		queryKey: ["conferences"],
		queryFn: endpoints.conferences,
	});
	const parkQuery = useQuery({
		queryKey: ["parking-lots"],
		queryFn: endpoints.parkingLots,
	});
	const mohQuery = useQuery({
		queryKey: ["music-on-hold"],
		queryFn: endpoints.musicOnHold,
	});

	const createConfMut = useMutation({
		mutationFn: () =>
			endpoints.createConference({
				name: confName,
				number: confExt,
				description: confDesc || null,
				participantPin: confPin || null,
				moderatorPin: modPin || null,
				recordConference: false,
				activeParticipants: 0,
				enabled: true,
			}),
		onSuccess: () => {
			setConfModal(false);
			setConfName("");
			setConfExt("");
			setConfDesc("");
			setConfPin("");
			setModPin("");
			void qc.invalidateQueries({ queryKey: ["conferences"] });
		},
	});

	const createParkMut = useMutation({
		mutationFn: () =>
			endpoints.createParkingLot({
				name: parkName,
				lotExtension,
				slotStart,
				slotEnd,
				timeoutSeconds: parkTimeout,
				timeoutDestinationType: "extension",
				timeoutDestinationData: timeoutExt,
				musicOnHoldClass: "Default Acoustic (48kHz)",
				parkedCalls: 0,
				enabled: true,
			}),
		onSuccess: () => {
			setParkModal(false);
			setParkName("");
			void qc.invalidateQueries({ queryKey: ["parking-lots"] });
		},
	});

	return (
		<Stack gap={24}>
			<PageHeader
				title="Conferences, Park & MOH"
				subtitle="Audio bridge rooms, valet call parking lots, and hold music audio streams."
				actions={
					tab === "conferences" ? (
						<Button
							leftSection={<IconPlus size={17} />}
							onClick={() => setConfModal(true)}
						>
							New Conference Bridge
						</Button>
					) : tab === "parking" ? (
						<Button
							leftSection={<IconPlus size={17} />}
							onClick={() => setParkModal(true)}
						>
							New Parking Lot
						</Button>
					) : null
				}
			/>

			<SegmentedTabs
				value={tab}
				onChange={setTab}
				items={[
					{
						value: "conferences",
						label: "Conference Bridges",
						badge: confQuery.data?.length,
					},
					{
						value: "parking",
						label: "Call Parking Lots",
						badge: parkQuery.data?.length,
					},
					{
						value: "moh",
						label: "Music on Hold",
						badge: mohQuery.data?.length,
					},
				]}
			/>

			<MockFeatureBanner
				title="Conferencing, Valet Park & MOH (Mock-Backed UI)"
				description="Audio bridges (mod_conference), valet parking slots (mod_valet_parking), and hold playlists (mod_local_stream) are seeded in the portal mock store. See docs/roadmap.md for backend dialplan synthesis."
			/>

			{tab === "conferences" && (
				<SimpleGrid cols={{ base: 1, md: 3 }} spacing={20}>
					{(confQuery.data ?? []).map((room) => (
						<SurfaceCard key={room.id} p={24}>
							<Stack gap={16}>
								<Group justify="space-between" align="flex-start">
									<Box>
										<Text className="qb-headline">{room.name}</Text>
										<Text className="qb-caption qb-mono" mt={2}>
											Bridge Ext {room.number}
										</Text>
									</Box>
									<Badge
										radius="xl"
										style={{
											background:
												room.activeParticipants > 0
													? "var(--qb-accent)"
													: "var(--qb-bg)",
											color:
												room.activeParticipants > 0
													? "#FFFFFF"
													: "var(--qb-text-secondary)",
										}}
									>
										{room.activeParticipants} active
									</Badge>
								</Group>

								{room.description && (
									<Text className="qb-caption">{room.description}</Text>
								)}

								<Stack
									gap={8}
									p={14}
									style={{
										background: "var(--qb-bg)",
										borderRadius: 14,
									}}
								>
									<Group justify="space-between">
										<Text className="qb-caption">Participant PIN</Text>
										<Text className="qb-mono" size="sm" fw={600}>
											{room.participantPin || "Open (No PIN)"}
										</Text>
									</Group>
									<Group justify="space-between">
										<Text className="qb-caption">Moderator PIN</Text>
										<Text className="qb-mono" size="sm" fw={600}>
											{room.moderatorPin || "—"}
										</Text>
									</Group>
									<Group justify="space-between">
										<Text className="qb-caption">Auto-Record Bridge</Text>
										<Text size="sm" fw={600}>
											{room.recordConference ? "Enabled" : "Off"}
										</Text>
									</Group>
								</Stack>

								<Group justify="space-between">
									<Button
										variant="default"
										size="sm"
										onClick={() => startCall(room.number, room.name)}
										style={{
											background: "var(--qb-bg)",
											border: "1px solid var(--qb-separator)",
										}}
									>
										Join Room
									</Button>
									<DeleteButton
										what={`conference ${room.name}`}
										onConfirm={() =>
											void endpoints
												.deleteConference(room.id)
												.then(() =>
													qc.invalidateQueries({ queryKey: ["conferences"] }),
												)
										}
									/>
								</Group>
							</Stack>
						</SurfaceCard>
					))}
				</SimpleGrid>
			)}

			{tab === "parking" && (
				<div className="qb-table-wrap">
					<Table highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Parking Lot Name</Table.Th>
								<Table.Th>Orbit Ext & Slot Range</Table.Th>
								<Table.Th>Recall Timeout</Table.Th>
								<Table.Th>Fallback Destination</Table.Th>
								<Table.Th>Currently Parked</Table.Th>
								<Table.Th>Enabled</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{(parkQuery.data ?? []).map((lot) => (
								<Table.Tr key={lot.id}>
									<Table.Td fw={700}>{lot.name}</Table.Td>
									<Table.Td className="qb-mono">
										{lot.lotExtension} ({lot.slotStart}–{lot.slotEnd})
									</Table.Td>
									<Table.Td>{lot.timeoutSeconds}s</Table.Td>
									<Table.Td className="qb-mono">
										{lot.timeoutDestinationType}:{lot.timeoutDestinationData}
									</Table.Td>
									<Table.Td>
										<Badge
											radius="xl"
											variant="light"
											color={lot.parkedCalls > 0 ? "brand" : "gray"}
										>
											{lot.parkedCalls} parked
										</Badge>
									</Table.Td>
									<Table.Td>
										<Switch
											checked={lot.enabled}
											onChange={(e) =>
												void endpoints
													.updateParkingLot(lot.id, {
														enabled: e.currentTarget.checked,
													})
													.then(() =>
														qc.invalidateQueries({
															queryKey: ["parking-lots"],
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
			)}

			{tab === "moh" && (
				<Stack gap={16}>
					{(mohQuery.data ?? []).map((moh, idx) => (
						<SurfaceCard key={moh.id} p={24}>
							<Stack gap={14}>
								<Group justify="space-between">
									<Box>
										<Group gap={10}>
											<Text fw={700} size="md">
												{moh.name}
											</Text>
											{idx === 0 && (
												<Badge
													radius="xl"
													style={{
														background: "var(--qb-accent)",
														color: "#FFFFFF",
													}}
												>
													Default Hold Stream
												</Badge>
											)}
										</Group>
										<Text className="qb-caption qb-mono" mt={2}>
											{moh.path} · {moh.rate}Hz · Shuffle:{" "}
											{moh.shuffle ? "On" : "Sequential"}
										</Text>
									</Box>
									<DeleteButton
										what={`MOH stream ${moh.name}`}
										onConfirm={() =>
											void endpoints
												.deleteMusicOnHold(moh.id)
												.then(() =>
													qc.invalidateQueries({ queryKey: ["music-on-hold"] }),
												)
										}
									/>
								</Group>
								<WaveformPlayer durationSec={95} />
							</Stack>
						</SurfaceCard>
					))}
				</Stack>
			)}

			<Modal
				opened={confModal}
				onClose={() => setConfModal(false)}
				title="New Conference Bridge"
				centered
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						createConfMut.mutate();
					}}
				>
					<Stack gap={14}>
						<TextInput
							label="Room Name"
							placeholder="Engineering Standup"
							required
							value={confName}
							onChange={(e) => setConfName(e.currentTarget.value)}
						/>
						<TextInput
							label="Extension Number"
							placeholder="903"
							required
							value={confExt}
							onChange={(e) => setConfExt(e.currentTarget.value)}
						/>
						<TextInput
							label="Description"
							placeholder="Daily infrastructure & SIP core standup"
							value={confDesc}
							onChange={(e) => setConfDesc(e.currentTarget.value)}
						/>
						<Group grow>
							<TextInput
								label="Participant PIN (optional)"
								placeholder="4410"
								value={confPin}
								onChange={(e) => setConfPin(e.currentTarget.value)}
							/>
							<TextInput
								label="Moderator PIN (optional)"
								placeholder="8899"
								value={modPin}
								onChange={(e) => setModPin(e.currentTarget.value)}
							/>
						</Group>
						<Switch label="Automatically record all bridge sessions" />
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setConfModal(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={createConfMut.isPending}>
								Create Bridge
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>

			<Modal
				opened={parkModal}
				onClose={() => setParkModal(false)}
				title="New Call Parking Lot"
				centered
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						createParkMut.mutate();
					}}
				>
					<Stack gap={14}>
						<TextInput
							label="Parking Lot Name"
							placeholder="Warehouse Floor Orbit"
							required
							value={parkName}
							onChange={(e) => setParkName(e.currentTarget.value)}
						/>
						<Group grow>
							<TextInput
								label="Park Extension"
								placeholder="770"
								required
								value={lotExtension}
								onChange={(e) => setLotExtension(e.currentTarget.value)}
							/>
							<TextInput
								label="Slot Start"
								placeholder="771"
								required
								value={slotStart}
								onChange={(e) => setSlotStart(e.currentTarget.value)}
							/>
							<TextInput
								label="Slot End"
								placeholder="780"
								required
								value={slotEnd}
								onChange={(e) => setSlotEnd(e.currentTarget.value)}
							/>
						</Group>
						<NumberInput
							label="Ringback Timeout (seconds)"
							value={parkTimeout}
							onChange={(v) => setParkTimeout(Number(v) || 60)}
							min={15}
							max={600}
						/>
						<Select
							label="Fallback Extension"
							value={timeoutExt}
							onChange={(v) => v && setTimeoutExt(v)}
							data={[
								{ value: "1001", label: "Ext 1001 · Alex Morgan" },
								{ value: "1006", label: "Ext 1006 · Reception" },
							]}
						/>
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setParkModal(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={createParkMut.isPending}>
								Create Parking Lot
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</Stack>
	);
}
