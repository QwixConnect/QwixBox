import {
	Anchor,
	Badge,
	SimpleGrid,
	Stack,
	Table,
	Text,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
	PageHeader,
	QueryState,
	SegmentedTabs,
	SurfaceCard,
} from "../../components/Resource";
import { endpoints, type Fax } from "../../lib/api";

export const Route = createFileRoute("/_app/faxes")({
	component: FaxesPage,
});

function FaxesPage() {
	const list = useQuery({ queryKey: ["faxes"], queryFn: endpoints.faxes });
	const [filter, setFilter] = useState<
		"all" | "delivered" | "received" | "failed"
	>("all");

	const allFaxes = list.data ?? [];
	const rows = allFaxes.filter((f) => filter === "all" || f.status === filter);

	return (
		<Stack gap={24}>
			<PageHeader
				title="T.38 Virtual Faxes"
				subtitle="Inbound PDF fax reception on DIDs, SpanDSP T.38 decoding, and email delivery logs."
			/>

			<SimpleGrid cols={{ base: 1, sm: 3 }} spacing={20}>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Total Faxes
						</Text>
						<div className="qb-display">{allFaxes.length}</div>
						<Text className="qb-caption">
							{allFaxes.reduce((s, f) => s + (f.pages ?? 0), 0)} total pages
							received
						</Text>
					</Stack>
				</SurfaceCard>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Delivered via Email
						</Text>
						<div className="qb-display">
							{allFaxes.filter((f) => f.status === "delivered").length}
						</div>
						<Text className="qb-caption">Converted to PDF & dispatched</Text>
					</Stack>
				</SurfaceCard>
				<SurfaceCard p={22}>
					<Stack gap={4}>
						<Text className="qb-caption" tt="uppercase" fw={700}>
							Protocol Engine
						</Text>
						<div className="qb-display" style={{ fontSize: 28 }}>
							T.38 / G.711
						</div>
						<Text className="qb-caption">
							SpanDSP ECM error correction active
						</Text>
					</Stack>
				</SurfaceCard>
			</SimpleGrid>

			<SegmentedTabs
				value={filter}
				onChange={setFilter}
				items={[
					{ value: "all", label: "All Faxes", badge: allFaxes.length },
					{
						value: "delivered",
						label: "Delivered",
						badge: allFaxes.filter((f) => f.status === "delivered").length,
					},
					{
						value: "received",
						label: "Received",
						badge: allFaxes.filter((f) => f.status === "received").length,
					},
					{
						value: "failed",
						label: "Failed",
						badge: allFaxes.filter((f) => f.status === "failed").length,
					},
				]}
			/>

			<QueryState
				isLoading={list.isLoading}
				isError={list.isError}
				error={list.error}
				isEmpty={rows.length === 0}
			>
				<div className="qb-table-wrap">
					<Table highlightOnHover>
						<Table.Thead>
							<Table.Tr>
								<Table.Th>Received</Table.Th>
								<Table.Th>DID Number</Table.Th>
								<Table.Th>Caller</Table.Th>
								<Table.Th>Pages</Table.Th>
								<Table.Th>Status</Table.Th>
								<Table.Th>Delivered To</Table.Th>
								<Table.Th>Document</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{rows.map((f: Fax) => (
								<Table.Tr key={f.id}>
									<Table.Td>
										{new Date(f.receivedAt).toLocaleString()}
									</Table.Td>
									<Table.Td className="qb-mono" fw={600}>
										{f.didNumber}
									</Table.Td>
									<Table.Td>
										<Text size="sm" className="qb-mono">
											{f.callerNumber ?? "—"}
										</Text>
										{f.callerName && (
											<Text className="qb-caption">{f.callerName}</Text>
										)}
									</Table.Td>
									<Table.Td fw={600}>{f.pages}</Table.Td>
									<Table.Td>
										<Badge
											radius="xl"
											style={{
												background:
													f.status === "delivered" || f.status === "received"
														? "var(--qb-accent)"
														: "var(--qb-danger)",
												color: "#FFFFFF",
											}}
										>
											{f.status}
										</Badge>
										{f.failureReason && (
											<Text size="xs" c="red" mt={2}>
												{f.failureReason}
											</Text>
										)}
									</Table.Td>
									<Table.Td className="qb-mono">
										{f.deliverToEmail ?? "—"}
									</Table.Td>
									<Table.Td>
										{f.onDisk ? (
											<Anchor
												href={`/api/faxes/${f.id}/download`}
												download
												size="sm"
												fw={600}
											>
												Download PDF
											</Anchor>
										) : (
											<Text className="qb-caption">No longer on disk</Text>
										)}
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</div>
			</QueryState>
		</Stack>
	);
}
