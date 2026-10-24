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
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { IconPlus } from "../../components/Icons";
import {
	ErrorAlert,
	InitialsAvatar,
	PageHeader,
	QueryState,
	RoleGate,
	SurfaceCard,
} from "../../components/Resource";
import { api, endpoints } from "../../lib/api";
import { authClient } from "../../lib/auth-client";
import { notifyRemoved, notifySaved } from "../../lib/notify";
import { ROLE_NAMES, type RoleName, useRole } from "../../lib/use-role";

export const Route = createFileRoute("/_app/users")({
	component: UsersPage,
});

type MemberRow = {
	id: string;
	userId: string;
	role: string;
	createdAt: string | Date;
	user?: { email?: string; name?: string };
};

function AddMemberModal({
	opened,
	onClose,
}: {
	opened: boolean;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const form = useForm({
		initialValues: { email: "", role: "member" as RoleName },
		validate: {
			email: (v) =>
				/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Valid email required",
		},
	});

	const mutation = useMutation({
		mutationFn: (values: { email: string; role: RoleName }) =>
			endpoints.addMember(values),
		onSuccess: (res) => {
			notifySaved(`${res.email} — ${res.status}`);
			void qc.invalidateQueries({ queryKey: ["members"] });
			form.reset();
			onClose();
		},
	});

	return (
		<Modal opened={opened} onClose={onClose} title="Add Tenant Member" centered>
			<form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
				<Stack gap={14}>
					<TextInput
						label="Work Email"
						description="Must already have a portal account. Contact the operator to create an account."
						required
						{...form.getInputProps("email")}
					/>
					<Select
						label="RBAC Role"
						data={ROLE_NAMES.map((r) => ({ value: r, label: r }))}
						{...form.getInputProps("role")}
					/>
					<ErrorAlert error={mutation.error} />
					<Group justify="flex-end" mt="sm">
						<Button variant="default" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" loading={mutation.isPending}>
							Add Member
						</Button>
					</Group>
				</Stack>
			</form>
		</Modal>
	);
}

function UsersPage() {
	const qc = useQueryClient();
	const { role: myRole } = useRole();
	const [adding, setAdding] = useState(false);
	const canManage = myRole === "owner" || myRole === "admin";

	const { data, error, isPending, isSuccess, isPaused } = useQuery({
		queryKey: ["members"],
		queryFn: async () => {
			const res = await authClient.organization.listMembers();
			if (res.error)
				throw new Error(res.error.message ?? "Could not list members");
			return (res.data?.members ?? []) as MemberRow[];
		},
	});

	const updateRole = useMutation({
		mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
			api.patch(`/tenant/members/${memberId}`, { role }),
		onSuccess: () => {
			notifySaved("Role updated");
			void qc.invalidateQueries({ queryKey: ["members"] });
			void qc.invalidateQueries({ queryKey: ["active-member-role"] });
		},
	});

	const remove = useMutation({
		mutationFn: (memberIdOrEmail: string) =>
			api.delete(`/tenant/members/${memberIdOrEmail}`),
		onSuccess: () => {
			notifyRemoved("Member removed");
			void qc.invalidateQueries({ queryKey: ["members"] });
		},
	});

	const members = data ?? [];
	const owners = members.filter((m) => m.role === "owner");

	return (
		<Stack gap={24}>
			<PageHeader
				title="Portal Users & RBAC"
				subtitle="People with portal access to this tenant and role-based access control permissions."
				actions={
					canManage ? (
						<Button
							leftSection={<IconPlus size={16} />}
							onClick={() => setAdding(true)}
						>
							Add Member
						</Button>
					) : undefined
				}
			/>

			<SimpleGrid cols={{ base: 1, sm: 3 }} spacing={20}>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Total Portal Members
						</Text>
						<div className="qb-display">{members.length}</div>
						<Text className="qb-caption">Active organization accounts</Text>
					</Stack>
				</SurfaceCard>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Owners & Admins
						</Text>
						<div className="qb-display">
							{
								members.filter((m) => m.role === "owner" || m.role === "admin")
									.length
							}
						</div>
						<Text className="qb-caption">Full switch & trunk privileges</Text>
					</Stack>
				</SurfaceCard>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Session Security
						</Text>
						<div className="qb-display" style={{ fontSize: 28 }}>
							Better-Auth
						</div>
						<Text className="qb-caption">
							Organization-scoped RBAC policies
						</Text>
					</Stack>
				</SurfaceCard>
			</SimpleGrid>

			<ErrorAlert error={updateRole.error ?? remove.error} />

			<QueryState
				data={data}
				error={error}
				isPending={isPending}
				isSuccess={isSuccess}
				isPaused={isPaused}
				emptyMessage="No members yet."
			>
				<div className="qb-table-wrap">
					<Table highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Member Account</Table.Th>
								<Table.Th>RBAC Role</Table.Th>
								<Table.Th>Joined</Table.Th>
								<Table.Th />
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{members.map((m) => {
								const isLastOwner = m.role === "owner" && owners.length === 1;
								const joined =
									typeof m.createdAt === "string"
										? m.createdAt
										: m.createdAt instanceof Date
											? m.createdAt.toISOString()
											: "";
								const emailOrId = m.user?.email ?? m.userId;
								return (
									<Table.Tr key={m.id}>
										<Table.Td>
											<Group gap={12}>
												<InitialsAvatar
													name={m.user?.name ?? emailOrId}
													size={40}
												/>
												<Box>
													<Text fw={700} size="sm">
														{emailOrId}
													</Text>
													{m.user?.name && (
														<Text className="qb-caption">{m.user.name}</Text>
													)}
												</Box>
											</Group>
										</Table.Td>
										<Table.Td>
											{canManage ? (
												<Select
													size="xs"
													w={140}
													data={ROLE_NAMES.map((r) => ({ value: r, label: r }))}
													value={m.role}
													disabled={isLastOwner}
													onChange={(value) => {
														if (!value || value === m.role) return;
														updateRole.mutate({ memberId: m.id, role: value });
													}}
												/>
											) : (
												<Badge radius="xl" variant="light" color="brand">
													{m.role}
												</Badge>
											)}
										</Table.Td>
										<Table.Td className="qb-caption">
											{joined ? new Date(joined).toLocaleDateString() : "—"}
										</Table.Td>
										<Table.Td>
											{canManage ? (
												<RoleGate
													resource="tenant"
													action="update"
													mode="disable"
												>
													<Button
														size="compact-sm"
														variant="subtle"
														color="red"
														disabled={isLastOwner}
														onClick={() => {
															if (
																window.confirm(
																	`Remove ${emailOrId} from the tenant?`,
																)
															) {
																remove.mutate(m.id);
															}
														}}
													>
														Remove
													</Button>
												</RoleGate>
											) : null}
										</Table.Td>
									</Table.Tr>
								);
							})}
						</Table.Tbody>
					</Table>
				</div>
			</QueryState>

			{adding && <AddMemberModal opened onClose={() => setAdding(false)} />}
		</Stack>
	);
}
