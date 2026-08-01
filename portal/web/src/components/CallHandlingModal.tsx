/**
 * Per-user call handling: DND, the three forwards, ring time and call waiting.
 *
 * The same settings users change from their handset with *78 and *72, so the feature codes are
 * printed alongside each control. Someone reading this dialog is often on the phone to the user
 * who set something by accident and cannot remember how - having the code in front of them is
 * the difference between fixing it and guessing.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Code,
  Divider,
  Group,
  Modal,
  NumberInput,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { endpoints, type Extension } from "../lib/api";
import { notifySaved } from "../lib/notify";
import { ErrorAlert } from "./Resource";

type CallHandlingValues = {
  dnd: boolean;
  callWaitingEnabled: boolean;
  ringTimeoutSec: number | string;
  forwardAllTo: string;
  forwardBusyTo: string;
  forwardNoAnswerTo: string;
};

function ForwardField({
  label,
  code,
  clearCode,
  description,
  ...inputProps
}: {
  label: string;
  code: string;
  clearCode: string;
  description: string;
} & ReturnType<ReturnType<typeof useForm<CallHandlingValues>>["getInputProps"]>) {
  return (
    <TextInput
      label={
        <Group gap={6}>
          <span>{label}</span>
          <Code>{code}</Code>
          <Text size="xs" c="dimmed">
            clear with <Code>{clearCode}</Code>
          </Text>
        </Group>
      }
      description={description}
      placeholder="Leave blank for none"
      {...inputProps}
    />
  );
}

export function CallHandlingModal({
  extension,
  onClose,
}: {
  extension: Extension;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<CallHandlingValues>({
    mode: "controlled",
    initialValues: {
      dnd: extension.dnd,
      callWaitingEnabled: extension.callWaitingEnabled,
      ringTimeoutSec: extension.ringTimeoutSec ?? "",
      forwardAllTo: extension.forwardAllTo ?? "",
      forwardBusyTo: extension.forwardBusyTo ?? "",
      forwardNoAnswerTo: extension.forwardNoAnswerTo ?? "",
    },
  });

  const save = useMutation({
    mutationFn: (body: Partial<Extension>) => endpoints.updateExtension(extension.id, body),
    onSuccess: () => {
      notifySaved("Call handling saved");
      void qc.invalidateQueries({ queryKey: ["extensions"] });
      onClose();
    },
  });

  return (
    <Modal
      opened
      onClose={onClose}
      title={`Call handling — ${extension.number} ${extension.displayName}`}
      size="lg"
    >
      <form
        onSubmit={form.onSubmit((values) => {
          const body: Partial<Extension> = {};
          if (form.isDirty("dnd")) body.dnd = values.dnd;
          if (form.isDirty("callWaitingEnabled")) body.callWaitingEnabled = values.callWaitingEnabled;
          if (form.isDirty("ringTimeoutSec")) {
            body.ringTimeoutSec = values.ringTimeoutSec === "" ? null : Number(values.ringTimeoutSec);
          }
          if (form.isDirty("forwardAllTo")) body.forwardAllTo = values.forwardAllTo || null;
          if (form.isDirty("forwardBusyTo")) body.forwardBusyTo = values.forwardBusyTo || null;
          if (form.isDirty("forwardNoAnswerTo")) body.forwardNoAnswerTo = values.forwardNoAnswerTo || null;
          if (Object.keys(body).length === 0) {
            onClose();
            return;
          }
          save.mutate(body);
        })}
      >
        <Stack>
          <ErrorAlert error={save.error} />

          <Switch
            label={
              <Group gap={6}>
                <span>Do not disturb</span>
                <Code>*78</Code>
                <Text size="xs" c="dimmed">
                  off with <Code>*79</Code>
                </Text>
              </Group>
            }
            description="The phone does not ring. Callers still reach the no-answer treatment below."
            {...form.getInputProps("dnd", { type: "checkbox" })}
          />

          <Switch
            label="Call waiting"
            description="Off sends a second simultaneous call to the busy treatment instead of ringing again."
            {...form.getInputProps("callWaitingEnabled", { type: "checkbox" })}
          />

          <NumberInput
            label="Ring for (seconds)"
            description="Blank inherits the tenant default"
            min={5}
            max={120}
            {...form.getInputProps("ringTimeoutSec")}
          />

          <Divider label="Forwarding" labelPosition="left" />

          <ForwardField
            label="All calls"
            code="*72"
            clearCode="*73"
            description="Overrides everything else, including do not disturb — the phone never rings."
            {...form.getInputProps("forwardAllTo")}
          />
          <ForwardField
            label="When busy"
            code="*90"
            clearCode="*91"
            description="Also used when call waiting is off and a call is already up."
            {...form.getInputProps("forwardBusyTo")}
          />
          <ForwardField
            label="When there is no answer"
            code="*92"
            clearCode="*93"
            description="Takes precedence over voicemail. Also used when do not disturb is on."
            {...form.getInputProps("forwardNoAnswerTo")}
          />

          <Text size="xs" c="dimmed">
            Forward targets are dialled the way a user would dial them, and go out through the
            tenant's own outbound routes.
          </Text>

          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!form.isDirty()}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
