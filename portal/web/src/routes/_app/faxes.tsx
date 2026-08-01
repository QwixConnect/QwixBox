/**
 * Received faxes.
 *
 * Download uses a same-origin Anchor — `api.get` throws on non-JSON 2xx, and this endpoint
 * returns application/pdf or image/tiff. Permission is `recording` (viewer has none).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Anchor, Badge, Table, Text } from "@mantine/core";
import { endpoints, type Fax } from "../../lib/api";
import { PageHeader, QueryState } from "../../components/Resource";

function statusColour(s: Fax["status"]): string {
  return s === "delivered" ? "green" : s === "failed" ? "red" : "blue";
}

function FaxesPage() {
  const { data, error, isPending, isSuccess, isPaused } = useQuery({
    queryKey: ["faxes"],
    queryFn: () => endpoints.faxes(),
  });

  return (
    <>
      <PageHeader
        title="Faxes"
        description="Inbound faxes received on a DID. Documents past retention show as no longer on disk."
      />

      <QueryState
        data={data}
        error={error}
        isPending={isPending}
        isSuccess={isSuccess}
        isPaused={isPaused}
        emptyMessage="No faxes received yet."
      >
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Received</Table.Th>
              <Table.Th>DID</Table.Th>
              <Table.Th>Caller</Table.Th>
              <Table.Th>Pages</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Delivered to</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data ?? []).map((f) => (
              <Table.Tr key={f.id}>
                <Table.Td>
                  <Text size="sm">{new Date(f.receivedAt).toLocaleString()}</Text>
                </Table.Td>
                <Table.Td>
                  <Text ff="monospace" size="sm">
                    {f.didNumber}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{f.callerNumber ?? "—"}</Text>
                  {f.callerName ? (
                    <Text size="xs" c="dimmed">
                      {f.callerName}
                    </Text>
                  ) : null}
                </Table.Td>
                <Table.Td>{f.pages}</Table.Td>
                <Table.Td>
                  <Badge variant="light" color={statusColour(f.status)}>
                    {f.status}
                  </Badge>
                  {f.failureReason ? (
                    <Text size="xs" c="dimmed">
                      {f.failureReason}
                    </Text>
                  ) : null}
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{f.deliverToEmail ?? "—"}</Text>
                </Table.Td>
                <Table.Td>
                  {f.onDisk ? (
                    <Anchor href={`/api/faxes/${f.id}/download`} download size="sm">
                      Download
                    </Anchor>
                  ) : (
                    <Text size="xs" c="dimmed">
                      no longer on disk
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </QueryState>
    </>
  );
}

export const Route = createFileRoute("/_app/faxes")({ component: FaxesPage });
