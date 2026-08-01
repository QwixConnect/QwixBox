/**
 * Set a new password from an emailed link.
 *
 * The second of two routes an anonymous visitor can reach, and it only works because
 * 42-nginx.sh serves it without the session gate — everything else under `/` returns 404 until
 * you sign in, which is exactly what would happen to this link otherwise.
 *
 * The token does not come from the email directly. better-auth's link points at
 * `/api/auth/reset-password/{token}?callbackURL=/reset-password`; that endpoint validates the
 * token and redirects here with `?token=`, or with `?error=INVALID_TOKEN` when it has expired
 * or been used. Both land on this page, so both are handled here rather than at the API.
 */
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

  /* A dead link is its own screen. Rendering the form and failing on submit would waste the
     one thing the person has - they need to request a new link, not type a password twice. */
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

    // Checked here as well as by the server so the second field is not a silent no-op.
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    // Matches minPasswordLength in portal/api/src/auth.ts.
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
    /* Not signed in automatically. Proving you can receive mail at the address is not the same
       as proving you know the new password, and this console can place billable calls. */
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
