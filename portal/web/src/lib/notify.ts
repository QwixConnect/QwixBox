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
