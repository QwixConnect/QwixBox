import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { endpoints, type InboundRoute, type OutboundRoute } from "../../lib/api";
import { notifyRemoved, notifySaved } from "../../lib/notify";
import { DeleteButton, ErrorAlert, PageHeader, QueryState, RoleGate } from "../../components/Resource";
import { DestinationPicker, type DestinationValue } from "../../components/DestinationPicker";

type InboundFormValues = {
  didPattern: string;
  description: string;
  priority: number | string;
  destination: DestinationValue;
};

function InboundModal({
  route,
  opened,
  onClose,
}: {
  route: InboundRoute | null;
  opened: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<InboundFormValues>({
    mode: "controlled",
    initialValues: {
      didPattern: route?.didPattern ?? "",
      description: route?.description ?? "",
      priority: route?.priority ?? 10,
      destination: {
        type: route?.destinationType ?? null,
        id: route?.destinationId ?? null,
      },
    },
    validate: {
      didPattern: (v) => (v.trim() ? null : "DID pattern is required"),
    },
  });

  const save = useMutation({
    mutationFn: (body: Partial<InboundRoute>) =>
      route
        ? endpoints.updateInboundRoute(route.id, body)
        : endpoints.createInboundRoute(body as Omit<InboundRoute, "id" | "enabled">),
    onSuccess: () => {
      notifySaved(route ? "Inbound route saved" : "Inbound route created");
      void qc.invalidateQueries({ queryKey: ["inbound-routes"] });
      onClose();
    },
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={route ? "Edit inbound route" : "New inbound route"}
      size="lg"
    >
      <form
        onSubmit={form.onSubmit((values) => {
          if (route) {
            const body: Partial<InboundRoute> = {};
            if (form.isDirty("didPattern")) body.didPattern = values.didPattern;
            if (form.isDirty("description")) body.description = values.description || null;
            if (form.isDirty("priority")) body.priority = Number(values.priority) || 10;
            if (form.isDirty("destination")) {
              body.destinationType = values.destination.type;
              body.destinationId = values.destination.id;
            }
            if (Object.keys(body).length === 0) {
              onClose();
              return;
            }
            save.mutate(body);
            return;
          }
          save.mutate({
            didPattern: values.didPattern,
            description: values.description || null,
            priority: Number(values.priority) || 10,
            destinationType: values.destination.type,
            destinationId: values.destination.id,
          });
        })}
      >
        <Stack>
          <ErrorAlert error={save.error} />
          <TextInput
            label="DID pattern"
            description="A regular expression matched against the dialled number"
            placeholder="^14165551234$"
            required
            {...form.getInputProps("didPattern")}
          />
          <TextInput label="Description" {...form.getInputProps("description")} />
          <NumberInput
            label="Priority"
            description="Lower is matched first"
            min={0}
            {...form.getInputProps("priority")}
          />
          <DestinationPicker
            label="Send calls to"
            value={form.values.destination}
            onChange={(next) => form.setFieldValue("destination", next)}
          />
          <Button type="submit" loading={save.isPending} disabled={route ? !form.isDirty() : false}>
            {route ? "Save" : "Create"}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

function InboundTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<InboundRoute | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, error, isPending, isSuccess, isPaused } = useQuery({
    queryKey: ["inbound-routes"],
    queryFn: endpoints.inboundRoutes,
  });
  const remove = useMutation({
    mutationFn: (id: string) => endpoints.deleteInboundRoute(id),
    onSuccess: () => {
      notifyRemoved("Inbound route removed");
      void qc.invalidateQueries({ queryKey: ["inbound-routes"] });
    },
  });

  return (
    <>
      <Group justify="flex-end" mb="sm">
        <RoleGate resource="route" action="create">
          <Button size="sm" onClick={() => setCreating(true)}>
            New inbound route
          </Button>
        </RoleGate>
      </Group>
      <ErrorAlert error={remove.error} />
      <QueryState
        data={data}
        error={error}
        isPending={isPending}
        isSuccess={isSuccess}
        isPaused={isPaused}
        emptyMessage="No inbound routes. Calls to your DIDs have nowhere to go."
      >
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Pattern</Table.Th>
              <Table.Th>Destination</Table.Th>
              <Table.Th>Priority</Table.Th>
              <Table.Th>Enabled</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data ?? []).map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>
                  <Code>{r.didPattern}</Code>
                  {r.description && (
                    <Text size="xs" c="dimmed">
                      {r.description}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge variant="light">{r.destinationType ?? "none"}</Badge>
                </Table.Td>
                <Table.Td>{r.priority}</Table.Td>
                <Table.Td>{r.enabled ? "Yes" : "No"}</Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <RoleGate resource="route" action="update" mode="disable">
                      <Button size="xs" variant="subtle" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                    </RoleGate>
                    <RoleGate resource="route" action="delete" mode="disable">
                      <DeleteButton
                        what={`inbound route ${r.didPattern}`}
                        onConfirm={() => remove.mutate(r.id)}
                      />
                    </RoleGate>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </QueryState>
      {creating && <InboundModal route={null} opened onClose={() => setCreating(false)} />}
      {editing && (
        <InboundModal key={editing.id} route={editing} opened onClose={() => setEditing(null)} />
      )}
    </>
  );
}

type OutboundFormValues = {
  name: string;
  pattern: string;
  trunkId: string;
  priority: number | string;
  stripDigits: number | string;
  prependDigits: string;
  isEmergency: boolean;
};

function OutboundModal({
  route,
  opened,
  onClose,
}: {
  route: OutboundRoute | null;
  opened: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<OutboundFormValues>({
    mode: "controlled",
    initialValues: {
      name: route?.name ?? "",
      pattern: route?.pattern ?? "",
      trunkId: route?.trunkId ?? "",
      priority: route?.priority ?? 10,
      stripDigits: route?.stripDigits ?? 0,
      prependDigits: route?.prependDigits ?? "",
      isEmergency: route?.isEmergency ?? false,
    },
    validate: {
      name: (v) => (v.trim() ? null : "Name is required"),
      pattern: (v) => (v.trim() ? null : "Pattern is required"),
    },
  });

  const trunks = useQuery({ queryKey: ["trunks"], queryFn: endpoints.trunks });

  const save = useMutation({
    mutationFn: (body: Partial<OutboundRoute>) =>
      route
        ? endpoints.updateOutboundRoute(route.id, body)
        : endpoints.createOutboundRoute(body as Omit<OutboundRoute, "id" | "enabled">),
    onSuccess: () => {
      notifySaved(route ? "Outbound route saved" : "Outbound route created");
      void qc.invalidateQueries({ queryKey: ["outbound-routes"] });
      onClose();
    },
  });

  const isEmergency = form.values.isEmergency;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={route ? "Edit outbound route" : "New outbound route"}
      size="lg"
    >
      <form
        onSubmit={form.onSubmit((values) => {
          if (route) {
            const body: Partial<OutboundRoute> = {};
            if (form.isDirty("name")) body.name = values.name;
            if (form.isDirty("pattern")) body.pattern = values.pattern;
            if (form.isDirty("trunkId")) body.trunkId = values.trunkId || null;
            if (form.isDirty("priority")) body.priority = Number(values.priority) || 10;
            if (form.isDirty("stripDigits")) body.stripDigits = Number(values.stripDigits) || 0;
            if (form.isDirty("prependDigits")) body.prependDigits = values.prependDigits || null;
            if (form.isDirty("isEmergency")) body.isEmergency = values.isEmergency;
            if (Object.keys(body).length === 0) {
              onClose();
              return;
            }
            save.mutate(body);
            return;
          }
          save.mutate({
            name: values.name,
            pattern: values.pattern,
            trunkId: values.trunkId || null,
            priority: Number(values.priority) || 10,
            stripDigits: Number(values.stripDigits) || 0,
            prependDigits: values.prependDigits || null,
            isEmergency: values.isEmergency,
          });
        })}
      >
        <Stack>
          <ErrorAlert error={save.error} />
          <TextInput label="Name" required {...form.getInputProps("name")} />
          <TextInput
            label="Pattern"
            description="A regular expression. The API rejects one that will not compile — better than discovering it when a call fails."
            placeholder="^1[0-9]{10}$"
            required
            {...form.getInputProps("pattern")}
          />
          <Select
            label="Trunk"
            data={(trunks.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
            searchable
            {...form.getInputProps("trunkId")}
          />
          <Group grow>
            <NumberInput
              label="Strip digits"
              description="From the front"
              min={0}
              {...form.getInputProps("stripDigits")}
            />
            <TextInput label="Prepend" {...form.getInputProps("prependDigits")} />
            <NumberInput label="Priority" min={0} {...form.getInputProps("priority")} />
          </Group>
          <Switch
            label="Emergency route"
            {...form.getInputProps("isEmergency", { type: "checkbox" })}
          />
          {isEmergency && (
            <Alert color="orange" title="Emergency routes bypass everything">
              Matched before fraud limits, time conditions and route permissions, by design. It
              must have a trunk — a 911 call blocked by your own toll-fraud cap is the worst
              failure this system can have.
            </Alert>
          )}
          <Button type="submit" loading={save.isPending} disabled={route ? !form.isDirty() : false}>
            {route ? "Save" : "Create"}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

function OutboundTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<OutboundRoute | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, error, isPending, isSuccess, isPaused } = useQuery({
    queryKey: ["outbound-routes"],
    queryFn: endpoints.outboundRoutes,
  });
  const trunks = useQuery({ queryKey: ["trunks"], queryFn: endpoints.trunks });
  const remove = useMutation({
    mutationFn: (id: string) => endpoints.deleteOutboundRoute(id),
    onSuccess: () => {
      notifyRemoved("Outbound route removed");
      void qc.invalidateQueries({ queryKey: ["outbound-routes"] });
    },
  });

  const trunkName = (id: string | null) =>
    id ? ((trunks.data ?? []).find((t) => t.id === id)?.name ?? "unknown") : "—";

  return (
    <>
      <Group justify="flex-end" mb="sm">
        <RoleGate resource="route" action="create">
          <Button size="sm" onClick={() => setCreating(true)}>
            New outbound route
          </Button>
        </RoleGate>
      </Group>
      <ErrorAlert error={remove.error} />
      <QueryState
        data={data}
        error={error}
        isPending={isPending}
        isSuccess={isSuccess}
        isPaused={isPaused}
        emptyMessage="No outbound routes. Nobody can dial out."
      >
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Pattern</Table.Th>
              <Table.Th>Trunk</Table.Th>
              <Table.Th>Manipulation</Table.Th>
              <Table.Th>Priority</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data ?? [])
              .slice()
              .sort((a, b) =>
                a.isEmergency === b.isEmergency
                  ? a.priority - b.priority
                  : a.isEmergency
                    ? -1
                    : 1,
              )
              .map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <Group gap={6}>
                      <Text fw={500}>{r.name}</Text>
                      {r.isEmergency && (
                        <Badge color="orange" variant="light" size="sm">
                          emergency
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Code>{r.pattern}</Code>
                  </Table.Td>
                  <Table.Td>{trunkName(r.trunkId)}</Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {r.stripDigits ? `strip ${r.stripDigits}` : ""}
                      {r.stripDigits && r.prependDigits ? ", " : ""}
                      {r.prependDigits ? `prepend ${r.prependDigits}` : ""}
                      {!r.stripDigits && !r.prependDigits ? "none" : ""}
                    </Text>
                  </Table.Td>
                  <Table.Td>{r.priority}</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end">
                      <RoleGate resource="route" action="update" mode="disable">
                        <Button size="xs" variant="subtle" onClick={() => setEditing(r)}>
                          Edit
                        </Button>
                      </RoleGate>
                      <RoleGate resource="route" action="delete" mode="disable">
                        <DeleteButton
                          what={`outbound route ${r.name}`}
                          onConfirm={() => remove.mutate(r.id)}
                        />
                      </RoleGate>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
          </Table.Tbody>
        </Table>
      </QueryState>
      {creating && <OutboundModal route={null} opened onClose={() => setCreating(false)} />}
      {editing && (
        <OutboundModal key={editing.id} route={editing} opened onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function RoutingPage() {
  return (
    <>
      <PageHeader
        title="Routing"
        description="Where inbound calls land, and which trunk outbound calls leave through."
      />
      <Tabs defaultValue="inbound">
        <Tabs.List mb="md">
          <Tabs.Tab value="inbound">Inbound</Tabs.Tab>
          <Tabs.Tab value="outbound">Outbound</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="inbound">
          <InboundTab />
        </Tabs.Panel>
        <Tabs.Panel value="outbound">
          <OutboundTab />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

export const Route = createFileRoute("/_app/routing")({ component: RoutingPage });
