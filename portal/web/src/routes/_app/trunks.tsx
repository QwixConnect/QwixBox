import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { endpoints, type Trunk } from "../../lib/api";
import { notifyRemoved, notifySaved } from "../../lib/notify";
import { DeleteButton, ErrorAlert, PageHeader, QueryState, RoleGate } from "../../components/Resource";

type TrunkFormValues = {
  name: string;
  host: string;
  authMode: "ip" | "register";
  username: string;
  password: string;
  port: number | string;
  priority: number | string;
};

function TrunkModal({
  trunk,
  opened,
  onClose,
}: {
  trunk: Trunk | null;
  opened: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<TrunkFormValues>({
    mode: "controlled",
    initialValues: {
      name: trunk?.name ?? "",
      host: trunk?.host ?? "",
      authMode: trunk?.authMode ?? "ip",
      username: trunk?.username ?? "",
      password: "",
      port: trunk?.port ?? 5060,
      priority: trunk?.priority ?? 10,
    },
    validate: {
      name: (v) => (v.trim() ? null : "Name is required"),
      host: (v) => (v.trim() ? null : "Host is required"),
    },
  });

  const save = useMutation({
    mutationFn: async (values: TrunkFormValues) => {
      if (trunk) {
        const body: Partial<Trunk> = {};
        if (form.isDirty("name")) body.name = values.name;
        if (form.isDirty("host")) body.host = values.host;
        if (form.isDirty("authMode")) body.authMode = values.authMode;
        if (form.isDirty("username")) body.username = values.username || null;
        if (form.isDirty("port")) body.port = Number(values.port) || 5060;
        if (form.isDirty("priority")) body.priority = Number(values.priority) || 10;

        const saved =
          Object.keys(body).length > 0
            ? await endpoints.updateTrunk(trunk.id, body)
            : trunk;
        if (values.password) await endpoints.setTrunkPassword(saved.id, values.password);
        return saved;
      }

      const body = {
        name: values.name,
        host: values.host,
        authMode: values.authMode,
        username: values.username || null,
        port: Number(values.port) || 5060,
        priority: Number(values.priority) || 10,
      };
      const saved = await endpoints.createTrunk(body);
      if (values.password) await endpoints.setTrunkPassword(saved.id, values.password);
      return saved;
    },
    onSuccess: () => {
      notifySaved(trunk ? "Trunk saved" : "Trunk created");
      void qc.invalidateQueries({ queryKey: ["trunks"] });
      onClose();
    },
  });

  const authMode = form.values.authMode;

  return (
    <Modal opened={opened} onClose={onClose} title={trunk ? `Edit ${trunk.name}` : "New trunk"}>
      <form
        onSubmit={form.onSubmit((values) => {
          if (trunk && !form.isDirty() && !values.password) {
            onClose();
            return;
          }
          save.mutate(values);
        })}
      >
        <Stack>
          <ErrorAlert error={save.error} />
          <TextInput
            label="Name"
            description="Also the FreeSWITCH gateway name, which is how CDRs attribute a call to this carrier"
            required
            {...form.getInputProps("name")}
          />
          <TextInput
            label="Host"
            placeholder="sip.carrier.example"
            required
            {...form.getInputProps("host")}
          />
          <Group grow>
            <NumberInput label="Port" min={1} max={65535} {...form.getInputProps("port")} />
            <NumberInput
              label="Priority"
              description="Lower wins"
              min={0}
              {...form.getInputProps("priority")}
            />
          </Group>
          <Select
            label="Authentication"
            data={[
              { value: "ip", label: "IP address" },
              { value: "register", label: "Register with credentials" },
            ]}
            allowDeselect={false}
            {...form.getInputProps("authMode")}
          />
          {authMode === "register" && (
            <>
              <TextInput label="Username" required {...form.getInputProps("username")} />
              <PasswordInput
                label="Password"
                description={trunk ? "Leave blank to keep the current one" : undefined}
                {...form.getInputProps("password")}
              />
            </>
          )}
          {authMode === "ip" && (
            <Text size="xs" c="dimmed">
              The carrier's address is written into Kamailio's permissions table, which is also
              what stops the responsive firewall rate-limiting them.
            </Text>
          )}
          <Button type="submit" loading={save.isPending} disabled={trunk ? !form.isDirty() && !form.values.password : false}>
            {trunk ? "Save" : "Create"}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

function TrunksPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Trunk | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, error, isPending, isSuccess, isPaused } = useQuery({
    queryKey: ["trunks"],
    queryFn: endpoints.trunks,
  });

  const remove = useMutation({
    mutationFn: (id: string) => endpoints.deleteTrunk(id),
    onSuccess: () => {
      notifyRemoved("Trunk removed");
      void qc.invalidateQueries({ queryKey: ["trunks"] });
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      endpoints.updateTrunk(id, { enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["trunks"] }),
  });

  return (
    <>
      <PageHeader
        title="Trunks"
        description="Carrier connections. Kamailio reaches these, not FreeSWITCH — the media core never talks to a carrier directly."
        action={
          <RoleGate resource="trunk" action="create">
            <Button onClick={() => setCreating(true)}>New trunk</Button>
          </RoleGate>
        }
      />

      <ErrorAlert error={remove.error ?? toggle.error} />

      <QueryState
        data={data}
        error={error}
        isPending={isPending}
        isSuccess={isSuccess}
        isPaused={isPaused}
        emptyMessage="No trunks yet. Outbound calls need one."
        emptyAction={
          <RoleGate resource="trunk" action="create">
            <Button onClick={() => setCreating(true)}>Add a trunk</Button>
          </RoleGate>
        }
      >
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Host</Table.Th>
              <Table.Th>Auth</Table.Th>
              <Table.Th>Priority</Table.Th>
              <Table.Th>Enabled</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data ?? []).map((t) => (
              <Table.Tr key={t.id}>
                <Table.Td>
                  <Text fw={500}>{t.name}</Text>
                </Table.Td>
                <Table.Td>
                  {t.host}
                  {t.port && t.port !== 5060 ? `:${t.port}` : ""}
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={t.authMode === "ip" ? "blue" : "grape"}>
                    {t.authMode === "ip" ? "IP" : `register${t.username ? ` (${t.username})` : ""}`}
                  </Badge>
                </Table.Td>
                <Table.Td>{t.priority}</Table.Td>
                <Table.Td>
                  <RoleGate resource="trunk" action="update" mode="disable">
                    <Switch
                      checked={t.enabled}
                      onChange={(e) => toggle.mutate({ id: t.id, enabled: e.currentTarget.checked })}
                    />
                  </RoleGate>
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <RoleGate resource="trunk" action="update" mode="disable">
                      <Button size="xs" variant="subtle" onClick={() => setEditing(t)}>
                        Edit
                      </Button>
                    </RoleGate>
                    <RoleGate resource="trunk" action="delete" mode="disable">
                      <DeleteButton
                        what={`trunk ${t.name}`}
                        onConfirm={() => remove.mutate(t.id)}
                        loading={remove.isPending}
                      />
                    </RoleGate>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </QueryState>

      {creating && <TrunkModal trunk={null} opened onClose={() => setCreating(false)} />}
      {editing && (
        // Keyed so the form state resets when a different trunk is picked - without it the
        // fields keep the previous row's values.
        <TrunkModal key={editing.id} trunk={editing} opened onClose={() => setEditing(null)} />
      )}
    </>
  );
}

export const Route = createFileRoute("/_app/trunks")({ component: TrunksPage });
