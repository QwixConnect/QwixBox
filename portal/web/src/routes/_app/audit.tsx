import {
	Badge,
	Button,
	Code,
	Group,
	Pagination,
	Stack,
	Table,
	Text,
	TextInput,
} from "@mantine/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { PageHeader, QueryState } from "../../components/Resource";
import {
	endpoints,
	type AuditEntry,
	type AuditFilters,
} from "../../lib/api";

export const Route = createFileRoute("/_app/audit")({
	component: AuditPage,
});

const PAGE_SIZE = 50;

function formatVal(v: unknown): string {
	if (v === undefined) return "—";
	if (v === null) return "null";
	if (typeof v === "object") return JSON.stringify(v, null, 2);
	return String(v);
}

function who(row: AuditEntry): string {
	if (row.userEmail) return row.userEmail;
	const m = row.action.match(/\((feature-code:[^)]+)\)/);
	if (m?.[1]) return m[1];
	if (row.userId) return row.userId;
	return "system";
}

function DiffView({ before, after }: { before: unknown; after: unknown }) {
	const b = (before ?? {}) as Record<string, unknown>;
	const a = (after ?? {}) as Record<string, unknown>;
	const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();

	if (keys.length === 0) {
		return <Text className="qb-caption">No field changes recorded.</Text>;
	}

	return (
		<Table>
			<Table.Thead>
				<Table.Tr>
					<Table.Th>Field</Table.Th>
					<Table.Th>Before</Table.Th>
					<Table.Th>After</Table.Th>
				</Table.Tr>
			</Table.Thead>
			<Table.Tbody>
				{keys.map((k) => (
					<Table.Tr key={k}>
						<Table.Td className="qb-mono" fw={600}>
							{k}
						</Table.Td>
						<Table.Td>
							<Code block style={{ whiteSpace: "pre-wrap" }}>
								{formatVal(b[k])}
							</Code>
						</Table.Td>
						<Table.Td>
							<Code block style={{ whiteSpace: "pre-wrap" }}>
								{formatVal(a[k])}
							</Code>
						</Table.Td>
					</Table.Tr>
				))}
			</Table.Tbody>
		</Table>
	);
}

function AuditPage() {
	const [entityType, setEntityType] = useState("");
	const [action, setAction] = useState("");
	const [from, setFrom] = useState("");
	const [to, setTo] = useState("");
	const [page, setPage] = useState(1);
	const [expanded, setExpanded] = useState<string | null>(null);

	const filters: AuditFilters = {
		entityType: entityType || undefined,
		action: action || undefined,
		from: from || undefined,
		to: to || undefined,
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE,
	};

	const { data, error, isPending, isSuccess, isPaused } = useQuery({
		queryKey: ["audit", filters],
		queryFn: () => endpoints.audit(filters),
		placeholderData: keepPreviousData,
	});

	const rows = data?.rows ?? [];
	const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

	return (
		<Stack gap={24}>
			<PageHeader
				title="Security & Audit Log"
				subtitle="Immutable administrative event ledger for compliance, configuration changes, and handset feature codes."
			/>

			<Group align="flex-end" wrap="wrap" gap={12}>
				<TextInput
					label="Entity Type"
					placeholder="trunk, extension, …"
					value={entityType}
					onChange={(e) => {
						setEntityType(e.currentTarget.value);
						setPage(1);
					}}
				/>
				<TextInput
					label="Action"
					placeholder="create, update, …"
					value={action}
					onChange={(e) => {
						setAction(e.currentTarget.value);
						setPage(1);
					}}
				/>
				<TextInput
					label="From"
					type="datetime-local"
					value={from}
					onChange={(e) => {
						setFrom(e.currentTarget.value);
						setPage(1);
					}}
				/>
				<TextInput
					label="To"
					type="datetime-local"
					value={to}
					onChange={(e) => {
						setTo(e.currentTarget.value);
						setPage(1);
					}}
				/>
			</Group>

			<QueryState
				data={rows}
				error={error}
				isPending={isPending}
				isSuccess={isSuccess}
				isPaused={isPaused}
				emptyMessage="No audit entries match."
			>
				<div className="qb-table-wrap">
					<Table highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Timestamp</Table.Th>
								<Table.Th>Actor</Table.Th>
								<Table.Th>Event Action</Table.Th>
								<Table.Th>Entity</Table.Th>
								<Table.Th />
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{rows.map((r) => (
								<Fragment key={r.id}>
									<Table.Tr>
										<Table.Td>
											{new Date(r.createdAt).toLocaleString()}
										</Table.Td>
										<Table.Td fw={600}>{who(r)}</Table.Td>
										<Table.Td>
											<Badge radius="xl" variant="light" color="brand">
												{r.action}
											</Badge>
										</Table.Td>
										<Table.Td className="qb-mono">
											{r.entityType}
											{r.entityId ? ` (${r.entityId.slice(0, 8)})` : ""}
										</Table.Td>
										<Table.Td>
											<Button
												size="compact-sm"
												variant="light"
												onClick={() =>
													setExpanded(expanded === r.id ? null : r.id)
												}
											>
												{expanded === r.id ? "Hide Diff" : "View Diff"}
											</Button>
										</Table.Td>
									</Table.Tr>
									{expanded === r.id && (
										<Table.Tr>
											<Table.Td colSpan={5}>
												<Stack gap="xs" p="sm">
													<DiffView before={r.before} after={r.after} />
												</Stack>
											</Table.Td>
										</Table.Tr>
									)}
								</Fragment>
							))}
						</Table.Tbody>
					</Table>
				</div>

				{totalPages > 1 && (
					<Group justify="center" mt="md">
						<Pagination value={page} onChange={setPage} total={totalPages} />
					</Group>
				)}
			</QueryState>
		</Stack>
	);
}
