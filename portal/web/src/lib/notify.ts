import { notifications } from "@mantine/notifications";

export function notifySaved(what: string) {
  notifications.show({
    color: "green",
    title: "Saved",
    message: what,
  });
}

export function notifyRemoved(what: string) {
  notifications.show({
    color: "green",
    title: "Removed",
    message: what,
  });
}

// Row actions (delete, toggle) have no form to hold an inline ErrorAlert, so a refusal - a
// destination still in use (409) - would otherwise do nothing visible.
export function notifyFailed(what: string, error: unknown) {
  notifications.show({
    color: "red",
    title: what,
    message: error instanceof Error ? error.message : String(error),
  });
}
