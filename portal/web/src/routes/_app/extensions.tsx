import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { endpoints, type Extension } from "../../lib/api";
import { notifySaved } from "../../lib/notify";
import { CallHandlingModal } from "../../components/CallHandlingModal";
import { ErrorAlert, RoleGate } from "../../components/Resource";

function CreateExtensionModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [created, setCreated] = useState<Extension | null>(null);

  const form = useForm({
    mode: "controlled",
    initialValues: {
      number: "",
      displayName: "",
      voicemailEnabled: true,
    },
    validate: {
      number: (v) => (v.trim() ? null : "Number is required"),
      displayName: (v) => (v.trim() ? null : "Display name is required"),
    },
  });

  const mutation = useMutation({
    mutationFn: (values: typeof form.values) =>
      endpoints.createExtension({
        number: values.number,
        displayName: values.displayName,
        voicemailEnabled: values.voicemailEnabled,
      }),
    onSuccess: (ext) => {
      notifySaved(`Extension ${ext.number} created`);
      setCreated(ext);
      void qc.invalidateQueries({ queryKey: ["extensions"] });
    },
  });

  function reset() {
    form.reset();
    setCreated(null);
    mutation.reset();
    onClose();
  }

  if (created) {
    return (
      <Modal opened={opened} onClose={reset} title={`Extension ${created.number} created`}>
        <Stack>
          <Alert color="yellow" title="Save these now">
            Both are stored encrypted and cannot be shown again. The PIN can be reset later; the
            SIP password cannot be recovered, only replaced.
          </Alert>
          <div>
            <Text size="sm" fw={500}>
              SIP password — for the handset
            </Text>
            <Code block>{created.sipPassword}</Code>
          </div>
          <div>
            <Text size="sm" fw={500}>
              Voicemail PIN — for the user
            </Text>
            <Code block>{created.voicemailPin}</Code>
            <Text size="xs" c="dimmed" mt={4}>
              Dial *97 from the extension to listen, *98 from any other phone.
            </Text>
          </div>
          <Button onClick={reset}>Done</Button>
        </Stack>
      </Modal>
    );
  }

  return (
    <Modal opened={opened} onClose={reset} title="New extension">
      <form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
        <Stack>
          <TextInput label="Number" placeholder="1001" required {...form.getInputProps("number")} />
          <TextInput
            label="Display name"
            placeholder="Reception"
            required
            {...form.getInputProps("displayName")}
          />
          <Switch
            label="Voicemail"
            {...form.getInputProps("voicemailEnabled", { type: "checkbox" })}
          />
          <ErrorAlert error={mutation.error} />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={reset}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Create
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function Extensions() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [callHandling, setCallHandling] = useState<Extension | null>(null);

  const { data, isLoading, error } = useQuery<Extension[]>({
    queryKey: ["extensions"],
    queryFn: () => endpoints.extensions(),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      endpoints.updateExtension(id, { enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["extensions"] }),
  });

  if (isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }

  if (error) {
    return (
      <Alert color="red" title="Could not load extensions">
        {(error as Error).message}
      </Alert>
    );
  }

  const rows = data ?? [];

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Extensions</Title>
        <RoleGate resource="extension" action="create">
          <Button onClick={() => setModalOpen(true)}>New extension</Button>
        </RoleGate>
      </Group>

      {rows.length === 0 ? (
        <Alert color="blue" title="No extensions yet">
          Create one to give someone a phone. It becomes registrable as soon as Kamailio has
          the credential — the portal projects it automatically.
        </Alert>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Number</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Voicemail</Table.Th>
              <Table.Th>Call handling</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((ext) => (
              <Table.Tr key={ext.id}>
                <Table.Td>
                  <Text ff="monospace">{ext.number}</Text>
                </Table.Td>
                <Table.Td>{ext.displayName}</Table.Td>
                <Table.Td>
                  {ext.voicemailEnabled ? (
                    <Badge variant="light">on</Badge>
                  ) : (
                    <Text c="dimmed" size="sm">
                      off
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {/* Only the states that change what happens to a call are badged. A row
                        with nothing here behaves the ordinary way, which is most of them. */}
                    {ext.dnd && (
                      <Badge color="orange" variant="light" size="sm">
                        DND
                      </Badge>
                    )}
                    {ext.forwardAllTo && (
                      <Badge color="grape" variant="light" size="sm">
                        → {ext.forwardAllTo}
                      </Badge>
                    )}
                    {!ext.callWaitingEnabled && (
                      <Badge color="gray" variant="light" size="sm">
                        no waiting
                      </Badge>
                    )}
                    <RoleGate resource="extension" action="update" mode="disable">
                      <Button size="compact-xs" variant="subtle" onClick={() => setCallHandling(ext)}>
                        Edit
                      </Button>
                    </RoleGate>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Badge color={ext.enabled ? "green" : "gray"} variant="light">
                    {ext.enabled ? "enabled" : "disabled"}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <RoleGate resource="extension" action="update" mode="disable">
                    <Switch
                      checked={ext.enabled}
                      onChange={(e) =>
                        toggle.mutate({ id: ext.id, enabled: e.currentTarget.checked })
                      }
                      aria-label={`Toggle extension ${ext.number}`}
                    />
                  </RoleGate>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <CreateExtensionModal opened={modalOpen} onClose={() => setModalOpen(false)} />
      {callHandling && (
        <CallHandlingModal
          key={callHandling.id}
          extension={callHandling}
          onClose={() => setCallHandling(null)}
        />
      )}
    </Stack>
  );
}

export const Route = createFileRoute("/_app/extensions")({ component: Extensions });
