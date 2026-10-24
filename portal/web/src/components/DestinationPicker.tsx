import { Group, Select, Stack, TextInput } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { ErrorAlert } from "./Resource";
import {
  DESTINATION_NEEDS_ROW,
  endpoints,
  type DestinationType,
} from "../lib/api";

const TYPE_OPTIONS: { value: DestinationType; label: string }[] = [
  { value: "extension", label: "Extension" },
  { value: "ring_group", label: "Ring group" },
  { value: "ivr", label: "IVR menu" },
  { value: "time_condition", label: "Time condition" },
  { value: "voicemail", label: "Voicemail" },
  { value: "fax", label: "Fax" },
  { value: "external", label: "External number" },
  { value: "hangup", label: "Hang up" },
];

export type DestinationValue = {
  type: DestinationType | null;
  id: string | null;
};

export function DestinationPicker({
  label,
  value,
  onChange,
  allowNone = true,
  description,
}: {
  label: string;
  value: DestinationValue;
  onChange: (next: DestinationValue) => void;
  allowNone?: boolean;
  description?: string;
}) {
  const needsRow = value.type ? DESTINATION_NEEDS_ROW.includes(value.type) : false;

  const extensions = useQuery({
    queryKey: ["extensions"],
    queryFn: endpoints.extensions,
    enabled: value.type === "extension" || value.type === "voicemail",
  });
  const ringGroups = useQuery({
    queryKey: ["ring-groups"],
    queryFn: endpoints.ringGroups,
    enabled: needsRow && value.type === "ring_group",
  });
  const ivrMenus = useQuery({
    queryKey: ["ivr-menus"],
    queryFn: endpoints.ivrMenus,
    enabled: needsRow && value.type === "ivr",
  });
  const timeConditions = useQuery({
    queryKey: ["time-conditions"],
    queryFn: endpoints.timeConditions,
    enabled: needsRow && value.type === "time_condition",
  });

  let rowOptions: { value: string; label: string }[] = [];
  let loading = false;
  switch (value.type) {
    case "extension":
      loading = extensions.isLoading;
      rowOptions = (extensions.data ?? []).map((e) => ({
        value: e.id,
        label: `${e.number} — ${e.displayName}`,
      }));
      break;
    case "ring_group":
      loading = ringGroups.isLoading;
      rowOptions = (ringGroups.data ?? []).map((g) => ({
        value: g.id,
        label: `${g.number} — ${g.name}`,
      }));
      break;
    case "ivr":
      loading = ivrMenus.isLoading;
      rowOptions = (ivrMenus.data ?? []).map((m) => ({
        value: m.id,
        label: `${m.number} — ${m.name}`,
      }));
      break;
    case "time_condition":
      loading = timeConditions.isLoading;
      rowOptions = (timeConditions.data ?? []).map((t) => ({ value: t.id, label: t.name }));
      break;
    default:
      break;
  }

  const typeData = allowNone
    ? [{ value: "", label: "— none —" }, ...TYPE_OPTIONS]
    : TYPE_OPTIONS;

  const activeQuery = value.type === "extension" || value.type === "voicemail" ? extensions
    : value.type === "ring_group" ? ringGroups : value.type === "ivr" ? ivrMenus
    : value.type === "time_condition" ? timeConditions : null;

  return (
    <Stack gap="xs">
      <ErrorAlert error={activeQuery?.error} title="Could not load destinations" />
      <Group grow align="flex-start">
        <Select
          label={label}
          description={description}
          data={typeData}
          value={value.type ?? ""}
          onChange={(next) =>
            onChange({ type: (next || null) as DestinationType | null, id: null })
          }
          allowDeselect={false}
        />

        {needsRow && (
          <Select
            label="Destination"
            placeholder={loading ? "Loading…" : "Select"}
            data={rowOptions}
            value={value.id ?? ""}
            onChange={(next) => onChange({ ...value, id: next || null })}
            searchable
            nothingFoundMessage={activeQuery?.isSuccess ? "None configured yet" : "Loading destinations"}
            disabled={loading || !!activeQuery?.error}
          />
        )}

        {/* A literal number rather than a row reference, so free text - not a picker. */}
        {value.type === "external" && (
          <TextInput
            label="Number"
            description="Dialled back out through Kamailio"
            placeholder="14165551234"
            value={value.id ?? ""}
            onChange={(e) => onChange({ ...value, id: e.currentTarget.value || null })}
          />
        )}

        {value.type === "voicemail" && (
          <Select
            label="Mailbox"
            disabled={extensions.isPending || !!extensions.error}
            data={(extensions.data ?? []).map((e) => ({
              value: e.number,
              label: `${e.number} — ${e.displayName}`,
            }))}
            value={value.id ?? ""}
            onChange={(next) => onChange({ ...value, id: next || null })}
            searchable
          />
        )}
      </Group>
    </Stack>
  );
}
