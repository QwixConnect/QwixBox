import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Grid,
	Group,
	Modal,
	Stack,
	Table,
	Text,
	TextInput,
	UnstyledButton,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
	IconCompose,
	IconPaperclip,
	IconPhone,
	IconPlus,
	IconSearch,
	IconSend,
	IconSpeaker,
	IconTrash,
} from "../../components/Icons";
import {
	DeleteButton,
	ErrorAlert,
	InitialsAvatar,
	MockFeatureBanner,
	PageHeader,
	QueryState,
	SegmentedTabs,
	SurfaceCard,
	WaveformPlayer,
} from "../../components/Resource";
import { useWebphone } from "../../components/webphone-context";
import { endpoints, isUnavailable, type VoicemailItem } from "../../lib/api";

export const Route = createFileRoute("/_app/messages")({
	component: MessagesPage,
});

function MessagesPage() {
	const phone = useWebphone();
	const qc = useQueryClient();
	const [activeTab, setActiveTab] = useState<
		"messages" | "voicemail" | "recordings" | "optouts"
	>("messages");
	const [search, setSearch] = useState("");
	const [selectedThreadId, setSelectedThreadId] = useState<string>("thread-1");
	const [draftMessage, setDraftMessage] = useState("");
	const [composeOpen, setComposeOpen] = useState(false);
	const [newPeerName, setNewPeerName] = useState("");
	const [newPeerNumber, setNewPeerNumber] = useState("");
	const [newMessageBody, setNewMessageBody] = useState("");
	const [expandedVmId, setExpandedVmId] = useState<string>("vm-1");
	const [newOptOutNumber, setNewOptOutNumber] = useState("");

	const threadsQuery = useQuery({
		queryKey: ["sms-threads"],
		queryFn: endpoints.smsThreads,
	});
	const voicemailsQuery = useQuery({
		queryKey: ["voicemails"],
		queryFn: endpoints.voicemails,
	});
	const recordingsQuery = useQuery({
		queryKey: ["recordings"],
		queryFn: endpoints.recordings,
	});
	const optOutsQuery = useQuery({
		queryKey: ["sms-opt-outs"],
		queryFn: endpoints.smsOptOuts,
	});

	const sendMessageMut = useMutation({
		mutationFn: ({ id, text }: { id: string; text: string }) =>
			endpoints.sendSmsMessage(id, text),
		onSuccess: () => {
			setDraftMessage("");
			void qc.invalidateQueries({ queryKey: ["sms-threads"] });
		},
	});

	const createThreadMut = useMutation({
		mutationFn: async () => {
			const name = newPeerName || newPeerNumber;
			return endpoints.createSmsThread({
				contactName: name,
				initials: name
					.split(/\s+/)
					.slice(0, 2)
					.map((p) => p[0]?.toUpperCase() ?? "")
					.join(""),
				phoneNumber: newPeerNumber,
				localDid: "+1 416 555 0101",
				unread: false,
				updatedAtLabel: "Just now",
				preview: `You: ${newMessageBody}`,
				messages: [
					{
						id: `m-${Date.now()}`,
						direction: "outbound",
						text: newMessageBody,
						time: "Just now",
						status: "Delivered",
					},
				],
			});
		},
		onSuccess: (created) => {
			setComposeOpen(false);
			setNewPeerName("");
			setNewPeerNumber("");
			setNewMessageBody("");
			setSelectedThreadId(created.id);
			void qc.invalidateQueries({ queryKey: ["sms-threads"] });
		},
	});

	const toggleVmReadMut = useMutation({
		mutationFn: (vm: VoicemailItem) => endpoints.markVoicemailRead(vm.id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["voicemails"] }),
	});

	const deleteVmMut = useMutation({
		mutationFn: (id: string) => endpoints.deleteVoicemail(id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["voicemails"] }),
	});

	const addOptOutMut = useMutation({
		mutationFn: () =>
			endpoints.createSmsOptOut({
				phoneNumber: newOptOutNumber,
				reason: "Manual admin opt-out",
			}),
		onSuccess: () => {
			setNewOptOutNumber("");
			void qc.invalidateQueries({ queryKey: ["sms-opt-outs"] });
		},
	});

	const unreadVmCount = (voicemailsQuery.data ?? []).filter(
		(v) => v.unread,
	).length;
	const threads = (threadsQuery.data ?? []).filter(
		(t) =>
			!search.trim() ||
			t.contactName.toLowerCase().includes(search.toLowerCase()) ||
			t.phoneNumber.toLowerCase().includes(search.toLowerCase()) ||
			t.preview.toLowerCase().includes(search.toLowerCase()),
	);
	const activeThread =
		threads.find((t) => t.id === selectedThreadId) ?? threads[0];

	return (
		<Stack gap={24}>
			<PageHeader
				title={activeTab === "voicemail" ? "Voicemail" : "Messages"}
				subtitle="SMS/MMS business messaging, transcribed voicemail inbox, and call recordings."
				actions={
					isUnavailable(threadsQuery.error) ? null : (
						<ActionIcon
							variant="default"
							radius="xl"
							size={44}
							onClick={() => setComposeOpen(true)}
							aria-label="New message"
							style={{
								background: "var(--qb-surface)",
								border: "none",
								color: "var(--qb-text-primary)",
							}}
						>
							<IconCompose size={20} />
						</ActionIcon>
					)
				}
			/>

			<Group justify="space-between" align="center" wrap="wrap" gap={12}>
				<SegmentedTabs
					value={activeTab}
					onChange={setActiveTab}
					items={[
						{ value: "messages", label: "Messages" },
						{
							value: "voicemail",
							label: "Voicemail",
							badge: unreadVmCount > 0 ? unreadVmCount : undefined,
						},
						{
							value: "recordings",
							label: "Recordings",
							badge: recordingsQuery.data?.length,
						},
						{ value: "optouts", label: "SMS Opt-Outs" },
					]}
				/>

				<TextInput
					placeholder="Search messages or callers..."
					leftSection={<IconSearch size={17} />}
					value={search}
					onChange={(e) => setSearch(e.currentTarget.value)}
					w={{ base: "100%", sm: 300 }}
				/>
			</Group>

			<MockFeatureBanner
				title="Unified Inbox Preview (Mock-Backed Data)"
				description="SMS threads, voicemail audio waveforms, and call recordings are currently served from the rich portal mock store. See docs/roadmap.md for backend wiring instructions."
			/>

			{activeTab === "messages" && (
				<QueryState
					isLoading={threadsQuery.isLoading}
					isError={threadsQuery.isError}
					error={threadsQuery.error}
					isEmpty={threads.length === 0}
					emptyMessage="No SMS threads found."
				>
					<Grid gap={20}>
						{/* Left pane: Thread list matching Messages@2x.png */}
						<Grid.Col span={{ base: 12, md: 5 }}>
							<SurfaceCard p={8}>
								<Stack gap={0}>
									{threads.map((thread, idx) => {
										const selected = activeThread?.id === thread.id;
										return (
											<UnstyledButton
												key={thread.id}
												onClick={() => setSelectedThreadId(thread.id)}
												style={{
													padding: "16px 16px",
													borderRadius: 14,
													background: selected ? "var(--qb-bg)" : "transparent",
													borderTop:
														idx === 0 || selected
															? "none"
															: "1px solid var(--qb-separator)",
													width: "100%",
												}}
											>
												<Group
													justify="space-between"
													align="flex-start"
													wrap="nowrap"
													gap={12}
												>
													<Group
														gap={12}
														wrap="nowrap"
														align="flex-start"
														style={{ minWidth: 0, flex: 1 }}
													>
														<Box
															style={{
																width: 10,
																paddingTop: 18,
																display: "flex",
																justifyContent: "center",
																flexShrink: 0,
															}}
														>
															{thread.unread && (
																<span
																	style={{
																		width: 8,
																		height: 8,
																		borderRadius: 9999,
																		background: "var(--qb-accent)",
																	}}
																/>
															)}
														</Box>
														<InitialsAvatar
															name={thread.contactName}
															initials={thread.initials}
															size={46}
														/>
														<Box style={{ minWidth: 0, flex: 1 }}>
															<Group justify="space-between" wrap="nowrap">
																<Text
																	fw={700}
																	size="md"
																	truncate
																	style={{ color: "var(--qb-text-primary)" }}
																>
																	{thread.contactName}
																</Text>
																<Text
																	className="qb-caption"
																	style={{ flexShrink: 0 }}
																>
																	{thread.updatedAtLabel}
																</Text>
															</Group>
															<Text
																size="sm"
																mt={3}
																lineClamp={2}
																style={{
																	color: thread.unread
																		? "var(--qb-text-primary)"
																		: "var(--qb-text-secondary)",
																	fontWeight: thread.unread ? 600 : 500,
																	lineHeight: 1.4,
																}}
															>
																{thread.preview}
															</Text>
														</Box>
													</Group>
												</Group>
											</UnstyledButton>
										);
									})}
								</Stack>
							</SurfaceCard>
						</Grid.Col>

						{/* Right pane: Conversation detail matching Conversation@2x.png */}
						<Grid.Col span={{ base: 12, md: 7 }}>
							{activeThread && (
								<SurfaceCard
									p={0}
									style={{
										display: "flex",
										flexDirection: "column",
										minHeight: 540,
										overflow: "hidden",
									}}
								>
									{/* Conversation Top Header */}
									<Group
										justify="space-between"
										px={24}
										py={16}
										style={{ borderBottom: "1px solid var(--qb-separator)" }}
									>
										<Group gap={12}>
											<InitialsAvatar
												name={activeThread.contactName}
												initials={activeThread.initials}
												size={42}
											/>
											<Box>
												<Text fw={700} size="md">
													{activeThread.contactName}
												</Text>
												<Text className="qb-caption">
													{activeThread.phoneNumber}
												</Text>
											</Box>
										</Group>
										{phone && (
											<ActionIcon
												variant="default"
												radius="xl"
												size={42}
												onClick={() =>
													phone.startCall(
														activeThread.phoneNumber,
														activeThread.contactName,
													)
												}
												aria-label={`Call ${activeThread.contactName}`}
												style={{
													background: "var(--qb-bg)",
													border: "1px solid var(--qb-separator)",
													color: "var(--qb-text-primary)",
												}}
											>
												<IconPhone size={18} />
											</ActionIcon>
										)}
									</Group>

									{/* Message List */}
									<Stack
										gap={14}
										p={24}
										style={{ flex: 1, background: "var(--qb-bg)" }}
									>
										<Text
											ta="center"
											className="qb-caption"
											style={{ marginBottom: 4 }}
										>
											Today · Sent from {activeThread.localDid}
										</Text>

										{activeThread.messages.map((msg) => {
											const isOut = msg.direction === "outbound";
											return (
												<Stack
													key={msg.id}
													align={isOut ? "flex-end" : "flex-start"}
													gap={4}
												>
													<Box
														className={isOut ? "qb-bubble-out" : "qb-bubble-in"}
													>
														{msg.text}
													</Box>
													<Text
														style={{
															fontSize: 11,
															fontWeight: 500,
															color: "var(--qb-text-secondary)",
															paddingInline: 4,
														}}
													>
														{msg.time}
														{isOut && msg.status ? ` · ${msg.status}` : ""}
													</Text>
												</Stack>
											);
										})}
									</Stack>

									{/* Bottom Composer matching Conversation@2x.png */}
									<form
										onSubmit={(e) => {
											e.preventDefault();
											if (!draftMessage.trim()) return;
											sendMessageMut.mutate({
												id: activeThread.id,
												text: draftMessage.trim(),
											});
										}}
									>
										<Group
											px={20}
											py={14}
											gap={10}
											wrap="nowrap"
											style={{
												borderTop: "1px solid var(--qb-separator)",
												background: "var(--qb-bg)",
											}}
										>
											<ActionIcon
												variant="default"
												radius="xl"
												size={42}
												aria-label="Attach media"
												style={{
													background: "var(--qb-surface)",
													border: "none",
													color: "var(--qb-text-secondary)",
												}}
											>
												<IconPaperclip size={18} />
											</ActionIcon>
											<TextInput
												placeholder="Message"
												value={draftMessage}
												onChange={(e) => setDraftMessage(e.currentTarget.value)}
												style={{ flex: 1 }}
												radius="xl"
											/>
											<ActionIcon
												type="submit"
												radius="xl"
												size={42}
												loading={sendMessageMut.isPending}
												aria-label="Send message"
												style={{
													background: "var(--qb-accent)",
													color: "#FFFFFF",
												}}
											>
												<IconSend size={17} />
											</ActionIcon>
										</Group>
									</form>
								</SurfaceCard>
							)}
						</Grid.Col>
					</Grid>
				</QueryState>
			)}

			{/* Voicemail View matching Voicemail@2x.png */}
			{activeTab === "voicemail" && (
				<QueryState
					isLoading={voicemailsQuery.isLoading}
					isError={voicemailsQuery.isError}
					error={voicemailsQuery.error}
					isEmpty={(voicemailsQuery.data ?? []).length === 0}
					emptyMessage="Your voicemail inbox is empty."
				>
					<Stack gap={16}>
						{(voicemailsQuery.data ?? []).map((vm) => {
							const isExpanded = expandedVmId === vm.id;
							return (
								<SurfaceCard key={vm.id} p={24}>
									<Stack gap={16}>
										<UnstyledButton
											onClick={() => {
												setExpandedVmId(isExpanded ? "" : vm.id);
												if (vm.unread) toggleVmReadMut.mutate(vm);
											}}
											style={{ width: "100%" }}
										>
											<Group justify="space-between" wrap="nowrap">
												<Group gap={14} wrap="nowrap">
													{vm.unread && (
														<span
															style={{
																width: 8,
																height: 8,
																borderRadius: 9999,
																background: "var(--qb-accent)",
																flexShrink: 0,
															}}
														/>
													)}
													<InitialsAvatar name={vm.callerName} size={46} />
													<Box>
														<Text fw={700} size="md">
															{vm.callerName}
														</Text>
														<Text className="qb-caption">
															{vm.callerNumber} · Ext {vm.extensionNumber}
														</Text>
													</Box>
												</Group>
												<Stack align="flex-end" gap={2}>
													<Text className="qb-caption">{vm.timeLabel}</Text>
													<Text className="qb-caption qb-mono" fw={600}>
														{vm.durationLabel}
													</Text>
												</Stack>
											</Group>
										</UnstyledButton>

										{isExpanded && (
											<Stack gap={16} pt={4}>
												<WaveformPlayer durationSec={vm.durationSec} />

												<Box>
													<Text
														style={{
															fontSize: 11,
															fontWeight: 700,
															letterSpacing: "0.06em",
															textTransform: "uppercase",
															color: "var(--qb-text-secondary)",
															marginBottom: 6,
														}}
													>
														Transcript
													</Text>
													<Text
														style={{
															fontSize: 15,
															fontWeight: 500,
															lineHeight: 1.5,
															color: "var(--qb-text-primary)",
														}}
													>
														“{vm.transcript}”
													</Text>
												</Box>

												{/* 3 Pill Action Buttons matching Voicemail@2x.png */}
												<Group grow gap={12}>
													<Button
														variant="default"
														radius="xl"
														leftSection={<IconSpeaker size={16} />}
														styles={{
															root: {
																background: "var(--qb-bg)",
																border: "none",
																color: "var(--qb-text-primary)",
															},
														}}
													>
														Speaker
													</Button>
													{phone && (
														<Button
															variant="default"
															radius="xl"
															leftSection={<IconPhone size={16} />}
															onClick={() =>
																phone.startCall(vm.callerNumber, vm.callerName)
															}
															styles={{
																root: {
																	background: "var(--qb-bg)",
																	border: "none",
																	color: "var(--qb-text-primary)",
																},
															}}
														>
															Call back
														</Button>
													)}
													<Button
														variant="default"
														radius="xl"
														leftSection={<IconTrash size={16} />}
														onClick={() => deleteVmMut.mutate(vm.id)}
														styles={{
															root: {
																background: "var(--qb-bg)",
																border: "none",
																color: "var(--qb-danger)",
															},
														}}
													>
														Delete
													</Button>
												</Group>
											</Stack>
										)}
									</Stack>
								</SurfaceCard>
							);
						})}
					</Stack>
				</QueryState>
			)}

			{/* Recordings View */}
			{activeTab === "recordings" && (
				<QueryState
					isLoading={recordingsQuery.isLoading}
					isError={recordingsQuery.isError}
					error={recordingsQuery.error}
					isEmpty={(recordingsQuery.data ?? []).length === 0}
					emptyMessage="No call recordings stored."
				>
					<Stack gap={16}>
						{(recordingsQuery.data ?? []).map((rec) => (
							<SurfaceCard key={rec.id} p={24}>
								<Stack gap={16}>
									<Group justify="space-between" wrap="wrap">
										<Box>
											<Group gap={10}>
												<Text fw={700} size="md">
													{rec.callerName} ({rec.callerNumber}) →{" "}
													{rec.destinationNumber}
												</Text>
												<Badge
													radius="xl"
													variant="light"
													color={rec.policy === "all" ? "brand" : "gray"}
												>
													Policy: {rec.policy}
												</Badge>
												<Badge radius="xl" variant="outline" color="gray">
													{(rec.sizeKb / 1000).toFixed(1)} MB
												</Badge>
											</Group>
											<Text className="qb-caption" mt={4}>
												Recorded {new Date(rec.recordedAt).toLocaleString()} ·
												Call UUID:{" "}
												<span className="qb-mono">{rec.callUuid}</span>
											</Text>
										</Box>
										<DeleteButton
											what={`recording ${rec.callUuid}`}
											onConfirm={() =>
												void endpoints
													.deleteRecording(rec.id)
													.then(() =>
														qc.invalidateQueries({ queryKey: ["recordings"] }),
													)
											}
										/>
									</Group>
									<WaveformPlayer durationSec={rec.durationSec} />
								</Stack>
							</SurfaceCard>
						))}
					</Stack>
				</QueryState>
			)}

			{/* SMS Opt-Out Registry */}
			{activeTab === "optouts" && (
				<Stack gap={16}>
					<ErrorAlert error={optOutsQuery.error} />
					{!isUnavailable(optOutsQuery.error) && (
						<SurfaceCard p={24}>
							<form
								onSubmit={(e) => {
									e.preventDefault();
									if (!newOptOutNumber.trim()) return;
									addOptOutMut.mutate();
								}}
							>
								<Group align="flex-end" gap={12}>
									<TextInput
										label="Add E.164 Number to STOP / Opt-Out Suppression List"
										placeholder="+14155550199"
										value={newOptOutNumber}
										onChange={(e) => setNewOptOutNumber(e.currentTarget.value)}
										style={{ flex: 1 }}
									/>
									<Button type="submit" leftSection={<IconPlus size={16} />}>
										Add Opt-Out
									</Button>
								</Group>
							</form>
						</SurfaceCard>
					)}

					<div className="qb-table-wrap">
						<Table highlightOnHover>
							<Table.Thead>
								<Table.Tr>
									<Table.Th>Phone Number</Table.Th>
									<Table.Th>Reason</Table.Th>
									<Table.Th>Opted Out At</Table.Th>
									<Table.Th />
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{(optOutsQuery.data ?? []).map((o) => (
									<Table.Tr key={o.id}>
										<Table.Td className="qb-mono" fw={600}>
											{o.phoneNumber}
										</Table.Td>
										<Table.Td>{o.reason}</Table.Td>
										<Table.Td>
											{new Date(o.createdAt).toLocaleString()}
										</Table.Td>
										<Table.Td>
											<DeleteButton
												what={`opt-out ${o.phoneNumber}`}
												onConfirm={() =>
													void endpoints.deleteSmsOptOut(o.id).then(() =>
														qc.invalidateQueries({
															queryKey: ["sms-opt-outs"],
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
				</Stack>
			)}

			{/* Compose New Message Modal */}
			<Modal
				opened={composeOpen}
				onClose={() => setComposeOpen(false)}
				title="New SMS Message"
				centered
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						createThreadMut.mutate();
					}}
				>
					<Stack gap={16}>
						<TextInput
							label="Recipient Name"
							placeholder="Priya Shah"
							value={newPeerName}
							onChange={(e) => setNewPeerName(e.currentTarget.value)}
						/>
						<TextInput
							label="Recipient Number (E.164)"
							placeholder="+1 415 555 0132"
							required
							value={newPeerNumber}
							onChange={(e) => setNewPeerNumber(e.currentTarget.value)}
						/>
						<TextInput
							label="Message"
							placeholder="Type your message..."
							required
							value={newMessageBody}
							onChange={(e) => setNewMessageBody(e.currentTarget.value)}
						/>
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setComposeOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={createThreadMut.isPending}>
								Send Message
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</Stack>
	);
}
