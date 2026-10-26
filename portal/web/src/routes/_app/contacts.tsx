import {
	ActionIcon,
	Box,
	Button,
	Group,
	Modal,
	Stack,
	Text,
	TextInput,
	UnstyledButton,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
	IconChevronRight,
	IconEdit,
	IconMessages,
	IconPhone,
	IconPlus,
	IconSearch,
} from "../../components/Icons";
import {
	DeleteButton,
	InitialsAvatar,
	MockFeatureBanner,
	PageHeader,
	QueryState,
	SegmentedTabs,
	SurfaceCard,
} from "../../components/Resource";
import { useWebphone } from "../../components/webphone-context";
import { type ContactItem, endpoints, isUnavailable } from "../../lib/api";

export const Route = createFileRoute("/_app/contacts")({
	component: ContactsPage,
});

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

function ContactsPage() {
	const webphone = useWebphone();
	const navigate = useNavigate();
	const qc = useQueryClient();

	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState<"all" | "internal" | "external">("all");
	const [modalOpen, setModalOpen] = useState(false);
	const [editing, setEditing] = useState<ContactItem | null>(null);

	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [company, setCompany] = useState("");
	const [notes, setNotes] = useState("");
	const [phone, setPhone] = useState("");
	const [extension, setExtension] = useState("");
	const [email, setEmail] = useState("");

	const contactsQuery = useQuery({
		queryKey: ["contacts"],
		queryFn: endpoints.contacts,
	});

	const openCreate = () => {
		setEditing(null);
		setFirstName("");
		setLastName("");
		setCompany("");
		setNotes("");
		setPhone("");
		setExtension("");
		setEmail("");
		setModalOpen(true);
	};

	const openEdit = (c: ContactItem) => {
		setEditing(c);
		setFirstName(c.firstName);
		setLastName(c.lastName);
		setCompany(c.company ?? "");
		setNotes(c.notes ?? "");
		setPhone(c.phone);
		setExtension(c.extension ?? "");
		setEmail(c.email ?? "");
		setModalOpen(true);
	};

	const saveMut = useMutation({
		mutationFn: async () => {
			const payload = {
				firstName,
				lastName,
				company: company || null,
				notes: notes || null,
				phone,
				extension: extension || null,
				email: email || null,
			};
			if (editing) {
				return endpoints.updateContact(editing.id, payload);
			}
			return endpoints.createContact(payload);
		},
		onSuccess: () => {
			setModalOpen(false);
			void qc.invalidateQueries({ queryKey: ["contacts"] });
		},
	});

	const deleteMut = useMutation({
		mutationFn: (id: string) => endpoints.deleteContact(id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["contacts"] }),
	});

	const filteredContacts = useMemo(() => {
		const list = contactsQuery.data ?? [];
		return list
			.filter((c) => {
				if (filter === "internal" && !c.extension) return false;
				if (filter === "external" && c.extension) return false;
				if (!search.trim()) return true;
				const q = search.toLowerCase();
				return (
					c.firstName.toLowerCase().includes(q) ||
					c.lastName.toLowerCase().includes(q) ||
					(c.company ?? "").toLowerCase().includes(q) ||
					c.phone.toLowerCase().includes(q) ||
					(c.extension ?? "").toLowerCase().includes(q)
				);
			})
			.sort((a, b) =>
				(a.lastName || a.firstName).localeCompare(b.lastName || b.firstName),
			);
	}, [contactsQuery.data, filter, search]);

	const grouped = useMemo(() => {
		const map = new Map<string, ContactItem[]>();
		for (const c of filteredContacts) {
			const sortKey =
				(c.lastName || c.firstName || "#")[0]?.toUpperCase() ?? "#";
			const letter = /[A-Z]/.test(sortKey) ? sortKey : "#";
			const arr = map.get(letter) ?? [];
			arr.push(c);
			map.set(letter, arr);
		}
		return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
	}, [filteredContacts]);

	return (
		<Stack gap={24}>
			<PageHeader
				title="Contacts"
				subtitle="Corporate directory, speed dials, and external client address book."
				actions={
					isUnavailable(contactsQuery.error) ? null : (
						<ActionIcon
							variant="default"
							radius="xl"
							size={44}
							onClick={openCreate}
							aria-label="Add contact"
							style={{
								background: "var(--qb-surface)",
								border: "none",
								color: "var(--qb-text-primary)",
							}}
						>
							<IconPlus size={20} />
						</ActionIcon>
					)
				}
			/>

			<Group justify="space-between" align="center" wrap="wrap" gap={12}>
				<SegmentedTabs
					value={filter}
					onChange={setFilter}
					items={[
						{
							value: "all",
							label: "All Contacts",
							badge: contactsQuery.data?.length,
						},
						{ value: "internal", label: "Internal Extensions" },
						{ value: "external", label: "External Clients" },
					]}
				/>

				<TextInput
					placeholder="Search"
					leftSection={<IconSearch size={17} />}
					value={search}
					onChange={(e) => setSearch(e.currentTarget.value)}
					w={{ base: "100%", sm: 320 }}
				/>
			</Group>

			<MockFeatureBanner
				title="Shared Corporate Contacts (Mock-Backed Data)"
				description="Directory entries are seeded in the portal mock store and support full CRUD. See docs/roadmap.md for CardDAV/LDAP and PostgreSQL table integration."
			/>

			{/* My Number Card matching Contacts@2x.png */}
			<SurfaceCard p={20}>
				<UnstyledButton
					onClick={() => void navigate({ to: "/settings" })}
					style={{ width: "100%" }}
				>
					<Group justify="space-between" wrap="nowrap">
						<Group gap={16} wrap="nowrap">
							<InitialsAvatar name="Demo User" initials="DU" size={52} accent />
							<Box>
								<Text fw={800} size="lg">
									Demo User
								</Text>
								<Text className="qb-caption">
									My number · +1 416 555 0100 · ext. 1001
								</Text>
							</Box>
						</Group>
						<span style={{ color: "var(--qb-text-secondary)" }}>
							<IconChevronRight size={18} />
						</span>
					</Group>
				</UnstyledButton>
			</SurfaceCard>

			<QueryState
				isLoading={contactsQuery.isLoading}
				isError={contactsQuery.isError}
				error={contactsQuery.error}
				isEmpty={grouped.length === 0}
				emptyMessage="No contacts match your filter."
			>
				<Group align="flex-start" gap={16} wrap="nowrap">
					{/* Main Alphabetical Directory List */}
					<Stack gap={24} style={{ flex: 1, minWidth: 0 }}>
						{grouped.map(([letter, items]) => (
							<Box key={letter} id={`contact-section-${letter}`}>
								<Text
									px={6}
									mb={8}
									style={{
										fontSize: 13,
										fontWeight: 700,
										color: "var(--qb-text-secondary)",
										letterSpacing: "0.04em",
									}}
								>
									{letter}
								</Text>
								<SurfaceCard p={0} style={{ overflow: "hidden" }}>
									{items.map((contact, idx) => {
										const fullName =
											`${contact.firstName} ${contact.lastName}`.trim();
										return (
											<Group
												key={contact.id}
												justify="space-between"
												wrap="nowrap"
												px={20}
												py={14}
												style={{
													borderTop:
														idx === 0
															? "none"
															: "1px solid var(--qb-separator)",
												}}
											>
												<Group
													gap={14}
													wrap="nowrap"
													style={{ minWidth: 0, flex: 1 }}
												>
													<InitialsAvatar name={fullName} size={44} />
													<Box style={{ minWidth: 0 }}>
														<Text
															size="md"
															truncate
															style={{ color: "var(--qb-text-primary)" }}
														>
															<span style={{ fontWeight: 500 }}>
																{contact.firstName}{" "}
															</span>
															<span style={{ fontWeight: 800 }}>
																{contact.lastName}
															</span>
														</Text>
														<Text className="qb-caption" truncate>
															{contact.company ? `${contact.company} · ` : ""}
															{contact.extension
																? `ext. ${contact.extension} · `
																: ""}
															{contact.phone}
														</Text>
													</Box>
												</Group>

												<Group gap={8} wrap="nowrap">
													{webphone && (
														<ActionIcon
															variant="subtle"
															radius="xl"
															size={38}
															onClick={() =>
																webphone.startCall(contact.phone, fullName)
															}
															aria-label={`Call ${fullName}`}
															style={{ color: "var(--qb-accent-text)" }}
														>
															<IconPhone size={17} />
														</ActionIcon>
													)}
													<ActionIcon
														variant="subtle"
														radius="xl"
														size={38}
														onClick={() => void navigate({ to: "/messages" })}
														aria-label={`Message ${fullName}`}
														style={{ color: "var(--qb-text-secondary)" }}
													>
														<IconMessages size={17} />
													</ActionIcon>
													<ActionIcon
														variant="subtle"
														radius="xl"
														size={38}
														onClick={() => openEdit(contact)}
														aria-label={`Edit ${fullName}`}
														style={{ color: "var(--qb-text-secondary)" }}
													>
														<IconEdit size={16} />
													</ActionIcon>
													<DeleteButton
														what={fullName}
														onConfirm={() => deleteMut.mutate(contact.id)}
													/>
												</Group>
											</Group>
										);
									})}
								</SurfaceCard>
							</Box>
						))}
					</Stack>

					{/* Right-hand vertical A-Z index matching Contacts@2x.png */}
					<Stack
						gap={2}
						align="center"
						visibleFrom="sm"
						py={8}
						px={4}
						style={{
							position: "sticky",
							top: 88,
							userSelect: "none",
						}}
					>
						{ALPHABET.map((letter) => (
							<a
								key={letter}
								href={`#contact-section-${letter}`}
								style={{
									fontSize: 11,
									fontWeight: 700,
									color: "var(--qb-accent-text)",
									textDecoration: "none",
									lineHeight: 1.35,
									padding: "1px 4px",
								}}
							>
								{letter}
							</a>
						))}
					</Stack>
				</Group>
			</QueryState>

			{/* Add / Edit Contact Modal */}
			<Modal
				opened={modalOpen}
				onClose={() => setModalOpen(false)}
				title={editing ? "Edit Contact" : "New Contact"}
				centered
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						saveMut.mutate();
					}}
				>
					<Stack gap={14}>
						<Group grow>
							<TextInput
								label="First Name"
								placeholder="Taylor"
								required
								value={firstName}
								onChange={(e) => setFirstName(e.currentTarget.value)}
							/>
							<TextInput
								label="Last Name"
								placeholder="Brooks"
								value={lastName}
								onChange={(e) => setLastName(e.currentTarget.value)}
							/>
						</Group>
						<Group grow>
							<TextInput
								label="Company"
								placeholder="Brooks Architecture"
								value={company}
								onChange={(e) => setCompany(e.currentTarget.value)}
							/>
							<TextInput
								label="Role / Notes"
								placeholder="Primary facilities partner"
								value={notes}
								onChange={(e) => setNotes(e.currentTarget.value)}
							/>
						</Group>
						<Group grow>
							<TextInput
								label="Phone Number"
								placeholder="+1 415 555 0132"
								required
								value={phone}
								onChange={(e) => setPhone(e.currentTarget.value)}
							/>
							<TextInput
								label="Internal Extension"
								placeholder="1004"
								value={extension}
								onChange={(e) => setExtension(e.currentTarget.value)}
							/>
						</Group>
						<TextInput
							label="Email"
							placeholder="taylor@company.com"
							value={email}
							onChange={(e) => setEmail(e.currentTarget.value)}
						/>
						<Group justify="flex-end" mt="sm">
							<Button variant="default" onClick={() => setModalOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={saveMut.isPending}>
								{editing ? "Save Changes" : "Create Contact"}
							</Button>
						</Group>
					</Stack>
				</form>
			</Modal>
		</Stack>
	);
}
