import type { ReactElement, ReactNode } from "react";
import { cloneElement } from "react";
import { Alert, Button, Center, Group, Loader, Stack, Text, Title, Tooltip } from "@mantine/core";
import { ApiError } from "../lib/api";
import { useRole, type PermissionAction, type PermissionResource } from "../lib/use-role";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="flex-start" mb="md">
      <div>
        <Title order={3}>{title}</Title>
        {description && (
          <Text size="sm" c="dimmed" mt={4}>
            {description}
          </Text>
        )}
      </div>
      {action}
    </Group>
  );
}

export function ErrorAlert({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null;
  const api = error instanceof ApiError ? error : null;
  return (
    <Alert color="red" title={title ?? (api ? `Rejected (${api.status})` : "Error")} mb="md">
      <Stack gap={4}>
        <Text size="sm">{(error as Error).message}</Text>
        {api?.detail && (
          <Text size="xs" c="dimmed">
            {api.detail}
          </Text>
        )}
      </Stack>
    </Alert>
  );
}

// Callers must destructure and pass these separately. Handing the whole useQuery result to a
// child breaks React Query v5's property tracking and the page freezes on the spinner.
export function QueryState<T>({
  data,
  error,
  isPending,
  isSuccess,
  isPaused,
  emptyMessage,
  emptyAction,
  children,
}: {
  data: T[] | undefined;
  error: unknown;
  isPending: boolean;
  isSuccess: boolean;
  isPaused?: boolean;
  emptyMessage: string;
  emptyAction?: ReactNode;
  children: ReactNode;
}) {
  if (error) return <ErrorAlert error={error} />;

  if (isPaused) {
    return (
      <Alert color="yellow" title="Waiting for a connection" mb="md">
        The browser reports no network, so the request has not been sent. It will run as soon as
        connectivity returns.
      </Alert>
    );
  }

  if (isPending) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  if (isSuccess && (data ?? []).length === 0) {
    return (
      <Center py="xl">
        <Stack align="center" gap="sm">
          <Text c="dimmed">{emptyMessage}</Text>
          {emptyAction}
        </Stack>
      </Center>
    );
  }

  return <>{children}</>;
}

export function DeleteButton({
  what,
  onConfirm,
  loading,
  disabled,
  disabledReason,
}: {
  what: string;
  onConfirm: () => void;
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const button = (
    <Button
      size="xs"
      variant="subtle"
      color="red"
      loading={loading}
      disabled={disabled}
      onClick={() => {
        if (window.confirm(`Delete ${what}? Anything routing to it will stop working.`)) {
          onConfirm();
        }
      }}
    >
      Delete
    </Button>
  );

  if (disabled && disabledReason) {
    return (
      <Tooltip label={disabledReason}>
        <span>{button}</span>
      </Tooltip>
    );
  }
  return button;
}

export function RoleGate({
  resource,
  action,
  mode = "hide",
  children,
  reason,
}: {
  resource: PermissionResource;
  action: PermissionAction;
  mode?: "hide" | "disable";
  children: ReactElement<{ disabled?: boolean }>;
  reason?: string;
}) {
  const { can, role } = useRole();
  const allowed = can(resource, action);
  const label = reason ?? `Your role (${role ?? "unknown"}) cannot ${action} ${resource}`;

  if (allowed) return children;

  if (mode === "hide") return null;

  return (
    <Tooltip label={label}>
      <span>{cloneDisabled(children)}</span>
    </Tooltip>
  );
}

function cloneDisabled(child: ReactElement<{ disabled?: boolean }>): ReactElement {
  return cloneElement(child, { disabled: true });
}
