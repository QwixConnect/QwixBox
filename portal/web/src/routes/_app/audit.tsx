/**
 * Audit log viewer.
 *
 * before/after blobs are already Enc-stripped by the API. A null userId means a feature-code
 * actor — the action string carries `feature-code:<number>@<domain>`.
 */
import { Fragment, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { endpoints, type AuditEntry, type AuditFilters } from "../../lib/api";
import { PageHeader, QueryState } from "../../components/Resource";

const PAGE_SIZE = 50;

function DiffView({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();

  if (keys.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No field changes recorded.
      </Text>
    );
  }

  return (
    <Table withTableBorder withColumnBorders>
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
            <Table.Td>
              <Text size="sm" ff="monospace">
                {k}
              </Text>
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

function formatVal(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

function who(row: AuditEntry): string {
  if (row.userEmail) return row.userEmail;
  // Feature-code rows: action is "update (feature-code:1001@domain)" with null userId.
  const m = row.action.match(/\((feature-code:[^)]+)\)/);
  if (m) return m[1]!;
  if (row.userId) return row.userId;
  return "system";
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
    <>
      <PageHeader
        title="Audit"
        description="Who changed what. Feature-code changes from a handset show as feature-code:number@domain."
      />

      <Group mb="md" align="flex-end">
        <TextInput
          label="Entity type"
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
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>When</Table.Th>
              <Table.Th>Who</Table.Th>
              <Table.Th>Action</Table.Th>
              <Table.Th>Entity</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <Table.Tr>
                  <Table.Td>
                    <Text size="sm">{new Date(r.createdAt).toLocaleString()}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{who(r)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" size="sm">
                      {r.action}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {r.entityType}
                      {r.entityId ? (
                        <Text span c="dimmed" ff="monospace" size="xs">
                          {" "}
                          {r.entityId.slice(0, 8)}
                        </Text>
                      ) : null}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    >
                      {expanded === r.id ? "Hide" : "Diff"}
                    </Button>
                  </Table.Td>
                </Table.Tr>
                {expanded === r.id ? (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Stack gap="xs" p="sm">
                        <DiffView before={r.before} after={r.after} />
                      </Stack>
                    </Table.Td>
                  </Table.Tr>
                ) : null}
              </Fragment>
            ))}
          </Table.Tbody>
        </Table>

        {totalPages > 1 ? (
          <Group justify="center" mt="md">
            <Pagination value={page} onChange={setPage} total={totalPages} />
          </Group>
        ) : null}
      </QueryState>
    </>
  );
}

export const Route = createFileRoute("/_app/audit")({ component: AuditPage });
