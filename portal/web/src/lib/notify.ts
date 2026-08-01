/**
 * Shared success toasts so every page words a save or delete the same way.
 *
 * Failures stay on `ErrorAlert` — it surfaces the API's own message and `detail`, which must
 * not be collapsed into a toast (`components/Resource.tsx`).
 */
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
