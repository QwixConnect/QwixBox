import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  endpoints,
  type IvrMenu,
  type RingGroup,
  type TimeCondition,
  type TimeConditionRule,
} from "../../lib/api";
import { notifyRemoved, notifySaved } from "../../lib/notify";
import { DeleteButton, ErrorAlert, PageHeader, QueryState, RoleGate } from "../../components/Resource";
import { DestinationPicker, type DestinationValue } from "../../components/DestinationPicker";

type RingGroupFormValues = {
  number: string;
  name: string;
  strategy: string;
  ringTimeoutSec: number | string;
  failover: DestinationValue;
};

function RingGroupModal({
  group,
  opened,
  onClose,
}: {
  group: RingGroup | null;
  opened: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<RingGroupFormValues>({
    mode: "controlled",
    initialValues: {
      number: group?.number ?? "",
      name: group?.name ?? "",
      strategy: group?.strategy ?? "simultaneous",
      ringTimeoutSec: group?.ringTimeoutSec ?? 30,
      failover: {
        type: group?.failoverType ?? null,
        id: group?.failoverId ?? null,
      },
    },
    validate: {
      number: (v) => (v.trim() ? null : "Number is required"),
      name: (v) => (v.trim() ? null : "Name is required"),
    },
  });

  const save = useMutation({
    mutationFn: (body: Partial<RingGroup>) =>
      group ? endpoints.updateRingGroup(group.id, body) : endpoints.createRingGroup(body),
    onSuccess: () => {
      notifySaved(group ? "Ring group saved" : "Ring group created");
      void qc.invalidateQueries({ queryKey: ["ring-groups"] });
      onClose();
    },
  });

  return (
    <Modal opened={opened} onClose={onClose} title={group ? `Edit ${group.name}` : "New ring group"} size="lg">
      <form
        onSubmit={form.onSubmit((values) => {
          if (group) {
            const body: Partial<RingGroup> = {};
            if (form.isDirty("number")) body.number = values.number;
            if (form.isDirty("name")) body.name = values.name;
            if (form.isDirty("strategy")) body.strategy = values.strategy as "simultaneous" | "sequential";
            if (form.isDirty("ringTimeoutSec")) body.ringTimeoutSec = Number(values.ringTimeoutSec) || 30;
            if (form.isDirty("failover")) {
              body.failoverType = values.failover.type;
              body.failoverId = values.failover.id;
            }
            if (Object.keys(body).length === 0) {
              onClose();
              return;
            }
            save.mutate(body);
            return;
          }
          save.mutate({
            number: values.number,
            name: values.name,
            strategy: values.strategy as "simultaneous" | "sequential",
            ringTimeoutSec: Number(values.ringTimeoutSec) || 30,
            failoverType: values.failover.type,
            failoverId: values.failover.id,
          });
        })}
      >
        <Stack>
          <ErrorAlert error={save.error} />
          <Group grow>
            <TextInput
              label="Number"
              description="Dial this from any phone in the tenant"
              placeholder="600"
              required
              {...form.getInputProps("number")}
            />
            <TextInput label="Name" placeholder="Sales" required {...form.getInputProps("name")} />
          </Group>
          <Group grow>
            <Select
              label="Strategy"
              data={[
                { value: "simultaneous", label: "Ring everyone at once" },
                { value: "sequential", label: "Ring one at a time" },
              ]}
              allowDeselect={false}
              {...form.getInputProps("strategy")}
            />
            <NumberInput label="Ring for (seconds)" min={5} {...form.getInputProps("ringTimeoutSec")} />
          </Group>
          <DestinationPicker
            label="If nobody answers"
            description="Falls back to the group's own voicemail when left empty"
            value={form.values.failover}
            onChange={(next) => form.setFieldValue("failover", next)}
          />
          <Button type="submit" loading={save.isPending} disabled={group ? !form.isDirty() : false}>
            {group ? "Save" : "Create"}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

function MembersModal({ group, onClose }: { group: RingGroup; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm({
    mode: "controlled",
    initialValues: {
      extensionId: "",
      delaySec: 0 as number | string,
    },
  });

  const members = useQuery({
    queryKey: ["ring-group-members", group.id],
    queryFn: () => endpoints.ringGroupMembers(group.id),
  });
  const extensions = useQuery({ queryKey: ["extensions"], queryFn: endpoints.extensions });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["ring-group-members", group.id] });
  };
  const add = useMutation({
    mutationFn: (values: typeof form.values) =>
      endpoints.addRingGroupMember(group.id, {
        extensionId: values.extensionId,
        delaySec: Number(values.delaySec) || 0,
      }),
    onSuccess: () => {
      notifySaved("Member added");
      form.reset();
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (memberId: string) => endpoints.removeRingGroupMember(group.id, memberId),
    onSuccess: () => {
      notifyRemoved("Member removed");
      invalidate();
    },
  });

  const inGroup = new Set((members.data ?? []).map((m) => m.extensionId));
  const available = (extensions.data ?? []).filter((e) => !inGroup.has(e.id));

  return (
    <Modal opened onClose={onClose} title={`Members of ${group.name}`} size="lg">
      <Stack>
        <ErrorAlert error={add.error ?? remove.error} />
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Extension</Table.Th>
              <Table.Th>Delay</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(members.data ?? []).map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>
                  {m.number} — {m.displayName}
                </Table.Td>
                <Table.Td>{m.delaySec ? `${m.delaySec}s` : "—"}</Table.Td>
                <Table.Td>
                  <Group justify="flex-end">
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => remove.mutate(m.id)}
                      aria-label="Remove"
                    >
                      ×
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {(members.data ?? []).length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={3}>
                  <Text c="dimmed" size="sm">
                    Empty. Calls go straight to the failover.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>

        <form onSubmit={form.onSubmit((values) => add.mutate(values))}>
          <Group align="flex-end">
            <Select
              label="Add extension"
              data={available.map((e) => ({ value: e.id, label: `${e.number} — ${e.displayName}` }))}
              searchable
              nothingFoundMessage="Everyone is already a member"
              style={{ flex: 1 }}
              {...form.getInputProps("extensionId")}
            />
            {/* Only meaningful on a simultaneous group - a sequential group already rings in
                order, and the Lua ignores the delay there. */}
            {group.strategy === "simultaneous" && (
              <NumberInput
                label="Delay"
                description="Seconds"
                min={0}
                w={110}
                {...form.getInputProps("delaySec")}
              />
            )}
            <Button type="submit" disabled={!form.values.extensionId} loading={add.isPending}>
              Add
            </Button>
          </Group>
        </form>
      </Stack>
    </Modal>
  );
}

function RingGroupsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<RingGroup | null>(null);
  const [members, setMembers] = useState<RingGroup | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, error, isPending, isSuccess, isPaused } = useQuery({
    queryKey: ["ring-groups"],
    queryFn: endpoints.ringGroups,
  });
  const remove = useMutation({
    mutationFn: (id: string) => endpoints.deleteRingGroup(id),
    onSuccess: () => {
      notifyRemoved("Ring group removed");
      void qc.invalidateQueries({ queryKey: ["ring-groups"] });
    },
  });

  return (
    <>
      <Group justify="flex-end" mb="sm">
        <RoleGate resource="callflow" action="create">
          <Button size="sm" onClick={() => setCreating(true)}>
            New ring group
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
        emptyMessage="No ring groups yet."
      >
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Number</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Strategy</Table.Th>
              <Table.Th>Ring</Table.Th>
              <Table.Th>Failover</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data ?? []).map((g) => (
              <Table.Tr key={g.id}>
                <Table.Td>{g.number}</Table.Td>
                <Table.Td>
                  <Text fw={500}>{g.name}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light">{g.strategy}</Badge>
                </Table.Td>
                <Table.Td>{g.ringTimeoutSec}s</Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {g.failoverType ?? "voicemail"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <RoleGate resource="callflow" action="update" mode="disable">
                      <Button size="xs" variant="subtle" onClick={() => setMembers(g)}>
                        Members
                      </Button>
                    </RoleGate>
                    <RoleGate resource="callflow" action="update" mode="disable">
                      <Button size="xs" variant="subtle" onClick={() => setEditing(g)}>
                        Edit
                      </Button>
                    </RoleGate>
                    <RoleGate resource="callflow" action="delete" mode="disable">
                      <DeleteButton
                        what={`ring group ${g.name}`}
                        onConfirm={() => remove.mutate(g.id)}
                      />
                    </RoleGate>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </QueryState>
      {creating && <RingGroupModal group={null} opened onClose={() => setCreating(false)} />}
      {editing && (
        <RingGroupModal key={editing.id} group={editing} opened onClose={() => setEditing(null)} />
      )}
      {members && <MembersModal key={members.id} group={members} onClose={() => setMembers(null)} />}
    </>
  );
}

type IvrFormValues = {
  number: string;
  name: string;
  greetingSound: string;
  timeoutSec: number | string;
  maxRetries: number | string;
  onTimeout: DestinationValue;
};

function IvrModal({
  menu,
  opened,
  onClose,
}: {
  menu: IvrMenu | null;
  opened: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<IvrFormValues>({
    mode: "controlled",
    initialValues: {
      number: menu?.number ?? "",
      name: menu?.name ?? "",
      greetingSound: menu?.greetingSound ?? "",
      timeoutSec: menu?.timeoutSec ?? 5,
      maxRetries: menu?.maxRetries ?? 3,
      onTimeout: {
        type: menu?.timeoutType ?? null,
        id: menu?.timeoutId ?? null,
      },
    },
    validate: {
      number: (v) => (v.trim() ? null : "Number is required"),
      name: (v) => (v.trim() ? null : "Name is required"),
    },
  });

  const save = useMutation({
    mutationFn: (body: Partial<IvrMenu>) =>
      menu ? endpoints.updateIvrMenu(menu.id, body) : endpoints.createIvrMenu(body),
    onSuccess: () => {
      notifySaved(menu ? "IVR menu saved" : "IVR menu created");
      void qc.invalidateQueries({ queryKey: ["ivr-menus"] });
      onClose();
    },
  });

  return (
    <Modal opened={opened} onClose={onClose} title={menu ? `Edit ${menu.name}` : "New IVR menu"} size="lg">
      <form
        onSubmit={form.onSubmit((values) => {
          if (menu) {
            const body: Partial<IvrMenu> = {};
            if (form.isDirty("number")) body.number = values.number;
            if (form.isDirty("name")) body.name = values.name;
            if (form.isDirty("greetingSound")) body.greetingSound = values.greetingSound || null;
            if (form.isDirty("timeoutSec")) body.timeoutSec = Number(values.timeoutSec) || 5;
            if (form.isDirty("maxRetries")) body.maxRetries = Number(values.maxRetries) || 3;
            if (form.isDirty("onTimeout")) {
              body.timeoutType = values.onTimeout.type;
              body.timeoutId = values.onTimeout.id;
            }
            if (Object.keys(body).length === 0) {
              onClose();
              return;
            }
            save.mutate(body);
            return;
          }
          save.mutate({
            number: values.number,
            name: values.name,
            greetingSound: values.greetingSound || null,
            timeoutSec: Number(values.timeoutSec) || 5,
            maxRetries: Number(values.maxRetries) || 3,
            timeoutType: values.onTimeout.type,
            timeoutId: values.onTimeout.id,
          });
        })}
      >
        <Stack>
          <ErrorAlert error={save.error} />
          <Group grow>
            <TextInput label="Number" placeholder="700" required {...form.getInputProps("number")} />
            <TextInput label="Name" placeholder="Main menu" required {...form.getInputProps("name")} />
          </Group>
          <TextInput
            label="Greeting"
            description="A sound file path FreeSWITCH can play"
            placeholder="/usr/local/freeswitch/sounds/custom/greeting.wav"
            {...form.getInputProps("greetingSound")}
          />
          <Group grow>
            <NumberInput
              label="Wait for a digit (seconds)"
              min={1}
              {...form.getInputProps("timeoutSec")}
            />
            <NumberInput label="Attempts" min={1} {...form.getInputProps("maxRetries")} />
          </Group>
          <DestinationPicker
            label="If they press nothing"
            description="The most common path in practice — rotary phones, handsets put down, speech that never registers"
            value={form.values.onTimeout}
            onChange={(next) => form.setFieldValue("onTimeout", next)}
          />
          <Button type="submit" loading={save.isPending} disabled={menu ? !form.isDirty() : false}>
            {menu ? "Save" : "Create"}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

const IVR_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "#"];

function IvrOptionsModal({ menu, onClose }: { menu: IvrMenu; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm({
    mode: "controlled",
    initialValues: {
      digit: "1",
      dest: { type: null, id: null } as DestinationValue,
    },
  });

  const options = useQuery({
    queryKey: ["ivr-options", menu.id],
    queryFn: () => endpoints.ivrOptions(menu.id),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["ivr-options", menu.id] });

  const setOption = useMutation({
    mutationFn: (values: typeof form.values) =>
      endpoints.setIvrOption(menu.id, values.digit, {
        destinationType: values.dest.type!,
        destinationId: values.dest.id,
      }),
    onSuccess: () => {
      notifySaved("Option saved");
      form.setFieldValue("dest", { type: null, id: null });
      invalidate();
    },
  });
  const removeOption = useMutation({
    mutationFn: (d: string) => endpoints.deleteIvrOption(menu.id, d),
    onSuccess: () => {
      notifyRemoved("Option removed");
      invalidate();
    },
  });

  return (
    <Modal opened onClose={onClose} title={`Options for ${menu.name}`} size="lg">
      <Stack>
        <ErrorAlert error={setOption.error ?? removeOption.error} />
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={80}>Digit</Table.Th>
              <Table.Th>Goes to</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(options.data ?? []).map((o) => (
              <Table.Tr key={o.id}>
                <Table.Td>
                  <Badge size="lg" variant="light">
                    {o.digit}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {o.destinationType}
                  {o.description ? ` — ${o.description}` : ""}
                </Table.Td>
                <Table.Td>
                  <Group justify="flex-end">
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => removeOption.mutate(o.digit)}
                      aria-label="Remove"
                    >
                      ×
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {(options.data ?? []).length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={3}>
                  <Text c="dimmed" size="sm">
                    No options. Every caller falls through to the timeout destination.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>

        <form onSubmit={form.onSubmit((values) => setOption.mutate(values))}>
          <Group align="flex-end">
            <Select
              label="Digit"
              data={IVR_DIGITS}
              w={90}
              allowDeselect={false}
              {...form.getInputProps("digit")}
            />
            <div style={{ flex: 1 }}>
              <DestinationPicker
                label="Goes to"
                value={form.values.dest}
                onChange={(next) => form.setFieldValue("dest", next)}
                allowNone={false}
              />
            </div>
            <Button type="submit" disabled={!form.values.dest.type} loading={setOption.isPending}>
              Set
            </Button>
          </Group>
        </form>
      </Stack>
    </Modal>
  );
}

function IvrTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<IvrMenu | null>(null);
  const [options, setOptions] = useState<IvrMenu | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, error, isPending, isSuccess, isPaused } = useQuery({
    queryKey: ["ivr-menus"],
    queryFn: endpoints.ivrMenus,
  });
  const remove = useMutation({
    mutationFn: (id: string) => endpoints.deleteIvrMenu(id),
    onSuccess: () => {
      notifyRemoved("IVR menu removed");
      void qc.invalidateQueries({ queryKey: ["ivr-menus"] });
    },
  });

  return (
    <>
      <Group justify="flex-end" mb="sm">
        <RoleGate resource="callflow" action="create">
          <Button size="sm" onClick={() => setCreating(true)}>
            New IVR menu
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
        emptyMessage="No IVR menus yet."
      >
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Number</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Wait</Table.Th>
              <Table.Th>Attempts</Table.Th>
              <Table.Th>On timeout</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data ?? []).map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>{m.number}</Table.Td>
                <Table.Td>
                  <Text fw={500}>{m.name}</Text>
                </Table.Td>
                <Table.Td>{m.timeoutSec}s</Table.Td>
                <Table.Td>{m.maxRetries}</Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {m.timeoutType ?? "hang up"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <RoleGate resource="callflow" action="update" mode="disable">
                      <Button size="xs" variant="subtle" onClick={() => setOptions(m)}>
                        Options
                      </Button>
                    </RoleGate>
                    <RoleGate resource="callflow" action="update" mode="disable">
                      <Button size="xs" variant="subtle" onClick={() => setEditing(m)}>
                        Edit
                      </Button>
                    </RoleGate>
                    <RoleGate resource="callflow" action="delete" mode="disable">
                      <DeleteButton what={`IVR ${m.name}`} onConfirm={() => remove.mutate(m.id)} />
                    </RoleGate>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </QueryState>
      {creating && <IvrModal menu={null} opened onClose={() => setCreating(false)} />}
      {editing && <IvrModal key={editing.id} menu={editing} opened onClose={() => setEditing(null)} />}
      {options && (
        <IvrOptionsModal key={options.id} menu={options} onClose={() => setOptions(null)} />
      )}
    </>
  );
}

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

function RuleEditor({
  rule,
  onChange,
  onRemove,
}: {
  rule: TimeConditionRule;
  onChange: (r: TimeConditionRule) => void;
  onRemove: () => void;
}) {
  const days = rule.days ?? [];
  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    onChange({ ...rule, days: next.length ? next : undefined });
  };

  return (
    <Stack gap="xs" p="sm" style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 6 }}>
      <Group justify="space-between">
        <Checkbox
          label="Exclusion (a holiday)"
          checked={rule.invert ?? false}
          onChange={(e) => onChange({ ...rule, invert: e.currentTarget.checked || undefined })}
        />
        <ActionIcon variant="subtle" color="red" onClick={onRemove} aria-label="Remove rule">
          ×
        </ActionIcon>
      </Group>
      {rule.invert && (
        <Text size="xs" c="dimmed">
          An exclusion that matches wins over every other rule, wherever it sits in the list.
          That is what makes Christmas Day beat "Mon–Fri 09:00–17:00".
        </Text>
      )}
      <Group gap={4}>
        {WEEKDAYS.map((d) => (
          <Button
            key={d.value}
            size="compact-xs"
            variant={days.includes(d.value) ? "filled" : "default"}
            onClick={() => toggleDay(d.value)}
          >
            {d.label}
          </Button>
        ))}
      </Group>
      <Group grow>
        <TextInput
          label="From"
          placeholder="09:00"
          value={rule.start ?? ""}
          onChange={(e) => onChange({ ...rule, start: e.currentTarget.value || undefined })}
        />
        <TextInput
          label="To"
          placeholder="17:00"
          value={rule.end ?? ""}
          onChange={(e) => onChange({ ...rule, end: e.currentTarget.value || undefined })}
        />
        <TextInput
          label="Specific date"
          placeholder="2026-12-25"
          value={rule.date ?? ""}
          onChange={(e) => onChange({ ...rule, date: e.currentTarget.value || undefined })}
        />
      </Group>
    </Stack>
  );
}

type TimeConditionFormValues = {
  name: string;
  timezone: string;
  rules: TimeConditionRule[];
  onMatch: DestinationValue;
  onNoMatch: DestinationValue;
};

function TimeConditionModal({
  condition,
  opened,
  onClose,
}: {
  condition: TimeCondition | null;
  opened: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const tenant = useQuery({ queryKey: ["tenant"], queryFn: endpoints.tenant });

  const form = useForm<TimeConditionFormValues>({
    mode: "controlled",
    initialValues: {
      name: condition?.name ?? "",
      timezone: condition?.timezone ?? "",
      rules: condition?.rules ?? [{ days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" }],
      onMatch: {
        type: condition?.matchType ?? null,
        id: condition?.matchId ?? null,
      },
      onNoMatch: {
        type: condition?.noMatchType ?? null,
        id: condition?.noMatchId ?? null,
      },
    },
    validate: {
      name: (v) => (v.trim() ? null : "Name is required"),
    },
  });

  const save = useMutation({
    mutationFn: (body: Partial<TimeCondition>) =>
      condition
        ? endpoints.updateTimeCondition(condition.id, body)
        : endpoints.createTimeCondition(body),
    onSuccess: () => {
      notifySaved(condition ? "Time condition saved" : "Time condition created");
      void qc.invalidateQueries({ queryKey: ["time-conditions"] });
      onClose();
    },
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={condition ? `Edit ${condition.name}` : "New time condition"}
      size="lg"
    >
      <form
        onSubmit={form.onSubmit((values) => {
          if (condition) {
            const body: Partial<TimeCondition> = {};
            if (form.isDirty("name")) body.name = values.name;
            if (form.isDirty("timezone")) {
              body.timezone = values.timezone || tenant.data?.timezone || "Etc/UTC";
            }
            if (form.isDirty("rules")) body.rules = values.rules;
            if (form.isDirty("onMatch")) {
              body.matchType = values.onMatch.type;
              body.matchId = values.onMatch.id;
            }
            if (form.isDirty("onNoMatch")) {
              body.noMatchType = values.onNoMatch.type;
              body.noMatchId = values.onNoMatch.id;
            }
            if (Object.keys(body).length === 0) {
              onClose();
              return;
            }
            save.mutate(body);
            return;
          }
          save.mutate({
            name: values.name,
            timezone: values.timezone || tenant.data?.timezone || "Etc/UTC",
            rules: values.rules,
            matchType: values.onMatch.type,
            matchId: values.onMatch.id,
            noMatchType: values.onNoMatch.type,
            noMatchId: values.onNoMatch.id,
          });
        })}
      >
        <Stack>
          <ErrorAlert error={save.error} />
          <Group grow>
            <TextInput label="Name" placeholder="Business hours" required {...form.getInputProps("name")} />
            <TextInput
              label="Timezone"
              description="Evaluated here, not on the server clock"
              placeholder={tenant.data?.timezone ?? "America/Toronto"}
              {...form.getInputProps("timezone")}
            />
          </Group>

          <Text size="sm" fw={500}>
            Rules
          </Text>
          {form.values.rules.map((r, i) => (
            <RuleEditor
              key={i}
              rule={r}
              onChange={(next) => form.setFieldValue(`rules.${i}`, next)}
              onRemove={() => form.removeListItem("rules", i)}
            />
          ))}
          <Button variant="default" size="xs" onClick={() => form.insertListItem("rules", {})}>
            Add rule
          </Button>

          <DestinationPicker
            label="Inside these hours"
            value={form.values.onMatch}
            onChange={(next) => form.setFieldValue("onMatch", next)}
          />
          <DestinationPicker
            label="Outside them"
            value={form.values.onNoMatch}
            onChange={(next) => form.setFieldValue("onNoMatch", next)}
          />

          <Button type="submit" loading={save.isPending} disabled={condition ? !form.isDirty() : false}>
            {condition ? "Save" : "Create"}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

function describeRule(r: TimeConditionRule): string {
  const parts: string[] = [];
  if (r.date) parts.push(r.date);
  if (r.days?.length) {
    parts.push(r.days.map((d) => WEEKDAYS.find((w) => w.value === d)?.label ?? d).join(" "));
  }
  if (r.start || r.end) parts.push(`${r.start ?? "00:00"}–${r.end ?? "24:00"}`);
  const body = parts.join(" ") || "always";
  return r.invert ? `except ${body}` : body;
}

function TimeConditionsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<TimeCondition | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, error, isPending, isSuccess, isPaused } = useQuery({
    queryKey: ["time-conditions"],
    queryFn: endpoints.timeConditions,
  });
  const remove = useMutation({
    mutationFn: (id: string) => endpoints.deleteTimeCondition(id),
    onSuccess: () => {
      notifyRemoved("Time condition removed");
      void qc.invalidateQueries({ queryKey: ["time-conditions"] });
    },
  });

  return (
    <>
      <Group justify="flex-end" mb="sm">
        <RoleGate resource="callflow" action="create">
          <Button size="sm" onClick={() => setCreating(true)}>
            New time condition
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
        emptyMessage="No time conditions. Every call is treated as in-hours."
      >
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Timezone</Table.Th>
              <Table.Th>Rules</Table.Th>
              <Table.Th>In / out</Table.Th>
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
                  <Text size="sm">{t.timezone}</Text>
                </Table.Td>
                <Table.Td>
                  <Stack gap={2}>
                    {(t.rules ?? []).map((r, i) => (
                      <Text key={i} size="xs" c={r.invert ? "orange" : undefined}>
                        {describeRule(r)}
                      </Text>
                    ))}
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {t.matchType ?? "—"} / {t.noMatchType ?? "—"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <RoleGate resource="callflow" action="update" mode="disable">
                      <Button size="xs" variant="subtle" onClick={() => setEditing(t)}>
                        Edit
                      </Button>
                    </RoleGate>
                    <RoleGate resource="callflow" action="delete" mode="disable">
                      <DeleteButton
                        what={`time condition ${t.name}`}
                        onConfirm={() => remove.mutate(t.id)}
                      />
                    </RoleGate>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </QueryState>
      {creating && <TimeConditionModal condition={null} opened onClose={() => setCreating(false)} />}
      {editing && (
        <TimeConditionModal
          key={editing.id}
          condition={editing}
          opened
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function CallFlowsPage() {
  return (
    <>
      <PageHeader
        title="Call flows"
        description="Ring groups, auto-attendants and business hours. These chain into each other — an IVR option can point at a time condition, which points at a ring group."
      />
      <Tabs defaultValue="ring-groups">
        <Tabs.List mb="md">
          <Tabs.Tab value="ring-groups">Ring groups</Tabs.Tab>
          <Tabs.Tab value="ivr">IVR menus</Tabs.Tab>
          <Tabs.Tab value="time-conditions">Time conditions</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="ring-groups">
          <RingGroupsTab />
        </Tabs.Panel>
        <Tabs.Panel value="ivr">
          <IvrTab />
        </Tabs.Panel>
        <Tabs.Panel value="time-conditions">
          <TimeConditionsTab />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

export const Route = createFileRoute("/_app/call-flows")({ component: CallFlowsPage });
