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
  NumberInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  ApiError,
  endpoints,
  type TenantProvision,
  type TenantSettings,
  type TenantUpdate,
} from "../../lib/api";
import { notifySaved } from "../../lib/notify";
import { useRole } from "../../lib/use-role";
import { ErrorAlert, PageHeader, RoleGate } from "../../components/Resource";

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Table.Tr>
      <Table.Td w={220}>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        {hint ? (
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        ) : null}
      </Table.Td>
      <Table.Td>{value}</Table.Td>
    </Table.Tr>
  );
}

function ProvisionForm() {
  const qc = useQueryClient();
  const form = useForm<TenantProvision>({
    initialValues: {
      sipDomain: "",
      tier: "shared",
      timezone: "Etc/UTC",
      maxConcurrentCalls: 10,
    },
    validate: {
      sipDomain: (v) => (v.trim() ? null : "SIP domain is required"),
    },
  });
  const [dedicatedWarning, setDedicatedWarning] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (values: TenantProvision) => endpoints.provisionTenant(values),
    onSuccess: (res) => {
      if (res.error) {
        setDedicatedWarning(res.detail ?? res.error);
        void qc.invalidateQueries({ queryKey: ["tenant"] });
        return;
      }
      notifySaved("Telephony provisioned");
      void qc.invalidateQueries({ queryKey: ["tenant"] });
    },
  });

  return (
    <Stack maw={480}>
      <Alert color="yellow" title="Telephony is not provisioned">
        The organization exists but has no SIP domain yet. Fill this in to attach telephony —
        Kamailio will learn the domain and the cache will be warmed.
      </Alert>
      {dedicatedWarning ? (
        <Alert color="orange" title="Dedicated tier needs a dispatcher set">
          {dedicatedWarning}
          <Text size="sm" mt="xs">
            The tenant row was created. Ask the operator to assign <Code>dispatcherSetId</Code> before
            calls will route.
          </Text>
        </Alert>
      ) : null}
      <form onSubmit={form.onSubmit((v) => mutation.mutate(v))}>
        <Stack>
          <TextInput
            label="SIP domain"
            description="The tenancy boundary at the SIP layer — cannot be changed later"
            required
            {...form.getInputProps("sipDomain")}
          />
          <Select
            label="Tier"
            data={[
              { value: "shared", label: "shared" },
              { value: "dedicated", label: "dedicated" },
            ]}
            {...form.getInputProps("tier")}
          />
          <TextInput label="Timezone" {...form.getInputProps("timezone")} />
          <NumberInput
            label="Max concurrent calls"
            min={1}
            {...form.getInputProps("maxConcurrentCalls")}
          />
          <ErrorAlert error={mutation.error} />
          <Button type="submit" loading={mutation.isPending}>
            Provision telephony
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}

function EditSettingsModal({
  data,
  opened,
  onClose,
}: {
  data: TenantSettings;
  opened: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm({
    initialValues: {
      maxConcurrentCalls: data.maxConcurrentCalls,
      timezone: data.timezone,
      defaultCallerIdName: data.defaultCallerIdName ?? "",
      defaultCallerIdNumber: data.defaultCallerIdNumber ?? "",
      recordingPolicy: data.recordingPolicy,
      stirShakenEnabled: data.stirShakenEnabled,
    },
  });

  const mutation = useMutation({
    mutationFn: (body: TenantUpdate) => endpoints.updateTenant(body),
    onSuccess: () => {
      notifySaved("Settings saved");
      void qc.invalidateQueries({ queryKey: ["tenant"] });
      onClose();
    },
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Edit settings" size="lg">
      <form
        onSubmit={form.onSubmit((values) => {
          const body: TenantUpdate = {};
          if (form.isDirty("maxConcurrentCalls")) body.maxConcurrentCalls = values.maxConcurrentCalls;
          if (form.isDirty("timezone")) body.timezone = values.timezone;
          if (form.isDirty("defaultCallerIdName")) {
            body.defaultCallerIdName = values.defaultCallerIdName || null;
          }
          if (form.isDirty("defaultCallerIdNumber")) {
            body.defaultCallerIdNumber = values.defaultCallerIdNumber || null;
          }
          if (form.isDirty("recordingPolicy")) body.recordingPolicy = values.recordingPolicy;
          if (form.isDirty("stirShakenEnabled")) body.stirShakenEnabled = values.stirShakenEnabled;
          if (Object.keys(body).length === 0) {
            onClose();
            return;
          }
          mutation.mutate(body);
        })}
      >
        <Stack>
          <NumberInput
            label="Max concurrent calls"
            description="Toll-fraud ceiling"
            min={1}
            {...form.getInputProps("maxConcurrentCalls")}
          />
          <TextInput label="Timezone" {...form.getInputProps("timezone")} />
          <TextInput label="Default caller ID name" {...form.getInputProps("defaultCallerIdName")} />
          <TextInput
            label="Default caller ID number"
            {...form.getInputProps("defaultCallerIdNumber")}
          />
          <Select
            label="Recording policy"
            data={["none", "inbound", "outbound", "all"]}
            {...form.getInputProps("recordingPolicy")}
          />
          <Switch
            label="STIR/SHAKEN"
            {...form.getInputProps("stirShakenEnabled", { type: "checkbox" })}
          />
          <ErrorAlert error={mutation.error} />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={!form.isDirty()}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function Settings() {
  const qc = useQueryClient();
  const { can } = useRole();
  const [editing, setEditing] = useState(false);

  const { data, isLoading, error, isSuccess } = useQuery<TenantSettings>({
    queryKey: ["tenant"],
    queryFn: () => endpoints.tenant(),
    retry: false,
  });

  const rebuild = useMutation({
    mutationFn: () => endpoints.rebuildCache(),
    onSuccess: () => {
      notifySaved("Cache rebuilt");
      void qc.invalidateQueries({ queryKey: ["tenant"] });
    },
  });

  if (isLoading) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    );
  }

  if (error instanceof ApiError && error.status === 404) {
    return can("tenant", "update") ? (
      <ProvisionForm />
    ) : (
      <Alert color="yellow">Telephony is not provisioned for this organization.</Alert>
    );
  }
  if (error) {
    return <ErrorAlert error={error} />;
  }
  if (!isSuccess || !data) return null;

  return (
    <Stack>
      <PageHeader
        title="Settings"
        description="Tenant telephony configuration. The SIP domain cannot be changed after provisioning."
        action={
          <Group>
            <RoleGate resource="tenant" action="update">
              <Button
                variant="light"
                color="orange"
                loading={rebuild.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Rebuild the Redis cache for this tenant? This purges and repopulates every key — use after a Redis flush or a restore.",
                    )
                  ) {
                    rebuild.mutate();
                  }
                }}
              >
                Rebuild cache
              </Button>
            </RoleGate>
            <RoleGate resource="tenant" action="update">
              <Button onClick={() => setEditing(true)}>Edit</Button>
            </RoleGate>
          </Group>
        }
      />

      <ErrorAlert error={rebuild.error} />

      {data.dispatcherSetId === 0 ? (
        <Alert color="orange" title="Dispatcher set not assigned">
          This dedicated tenant cannot route calls until <Code>dispatcherSetId</Code> is set.
          Use Edit to assign one.
        </Alert>
      ) : null}

      <Table>
        <Table.Tbody>
          <Row
            label="SIP domain"
            hint="the tenancy boundary at the SIP layer"
            value={<Text ff="monospace">{data.sipDomain}</Text>}
          />
          <Row
            label="Tier"
            hint="shared pool, or pinned to dedicated nodes"
            value={<Badge variant="light">{data.tier}</Badge>}
          />
          <Row
            label="Dispatcher set"
            hint="which FreeSWITCH pool carries this tenant"
            value={<Text ff="monospace">{data.dispatcherSetId}</Text>}
          />
          <Row
            label="Egress mode"
            hint="proxied routes outbound calls through Kamailio"
            value={<Badge variant="light">{data.egressMode}</Badge>}
          />
          <Row
            label="Concurrent call limit"
            hint="the toll-fraud ceiling — a stolen credential cannot exceed this"
            value={<Text ff="monospace">{data.maxConcurrentCalls}</Text>}
          />
          <Row
            label="STIR/SHAKEN"
            value={
              <Badge color={data.stirShakenEnabled ? "green" : "gray"} variant="light">
                {data.stirShakenEnabled ? "enabled" : "disabled"}
              </Badge>
            }
          />
          <Row label="Recording" value={<Badge variant="light">{data.recordingPolicy}</Badge>} />
          <Row label="Timezone" value={<Text ff="monospace">{data.timezone}</Text>} />
          <Row
            label="Default caller ID"
            value={
              <Text ff="monospace">
                {data.defaultCallerIdName ?? "—"} &lt;{data.defaultCallerIdNumber ?? "—"}&gt;
              </Text>
            }
          />
          <Row
            label="Enabled"
            value={
              <Badge color={data.enabled ? "green" : "gray"} variant="light">
                {data.enabled ? "yes" : "no"}
              </Badge>
            }
          />
        </Table.Tbody>
      </Table>

      {editing ? (
        <EditSettingsModal data={data} opened onClose={() => setEditing(false)} />
      ) : null}
    </Stack>
  );
}

export const Route = createFileRoute("/_app/settings")({ component: Settings });
