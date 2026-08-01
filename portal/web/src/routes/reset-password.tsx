import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  PasswordInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { authClient } from "../lib/auth-client";

type ResetSearch = { token?: string; error?: string };

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>): ResetSearch => ({
    token: typeof search.token === "string" ? search.token : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const { token, error: linkError } = Route.useSearch();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!token || linkError) {
    return (
      <Shell>
        <Alert color="red" title="That link is no longer valid">
          Reset links expire after an hour and can only be used once. Ask for a new one from the
          sign-in page.
        </Alert>
        <Anchor component={Link} to="/login" size="sm">
          Back to sign in
        </Anchor>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <Alert color="green" title="Password changed">
          You can sign in with the new password now.
        </Alert>
        <Button component={Link} to="/login" fullWidth>
          Sign in
        </Button>
      </Shell>
    );
  }

  async function submit() {
    setError(null);

    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    if (password.length < 12) {
      setError("Use at least 12 characters.");
      return;
    }

    setBusy(true);
    const res = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);

    if (res.error) {
      setError(res.error.message ?? "Could not reset the password.");
      return;
    }

    setDone(true);
    setTimeout(() => void navigate({ to: "/login" }), 2500);
  }

  return (
    <Shell>
      <Text size="sm" c="dimmed">
        Choose a new password. At least 12 characters.
      </Text>
      {error && <Alert color="red">{error}</Alert>}
      <PasswordInput
        label="New password"
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        autoFocus
      />
      <PasswordInput
        label="Confirm new password"
        value={confirm}
        onChange={(e) => setConfirm(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
      />
      <Button onClick={() => void submit()} loading={busy} fullWidth>
        Set password
      </Button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Center h="100vh">
      <Card withBorder shadow="sm" p="xl" w={400}>
        <Stack>
          <Title order={3}>Reset your password</Title>
          {children}
        </Stack>
      </Card>
    </Center>
  );
}
