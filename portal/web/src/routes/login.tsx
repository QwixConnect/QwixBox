import { useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { authClient, ensureActiveOrganization } from "../lib/auth-client";

type LoginSearch = { redirect?: string };

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (session.data?.user) throw redirect({ to: "/" });
  },
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect:
      typeof search.redirect === "string" && search.redirect.startsWith("/")
        ? search.redirect
        : undefined,
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function requestReset() {
    setError(null);
    setNotice(null);

    if (!email) {
      setError("Enter your email address first, then choose this again.");
      return;
    }

    setBusy(true);
    const res = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setBusy(false);

    if (res.error) {
      setError(
        res.error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "Could not send a reset link.",
      );
      return;
    }
    setNotice(
      `If ${email} has an account, a reset link is on its way. It expires in an hour.`,
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const result = await authClient.signIn.email({ email, password });

    if (result.error) {
      setError(
        result.error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "Those credentials were not accepted.",
      );
      setBusy(false);
      return;
    }

    await ensureActiveOrganization();
    await navigate({ to: redirect ?? "/" });
  }

  return (
    <Center h="100vh" px="md">
      <Card withBorder shadow="sm" p="xl" w={400} component="form" onSubmit={submit}>
        <Stack>
          <div>
            <Title order={3}>QwixBox</Title>
            <Text size="sm" c="dimmed">
              Sign in to the admin portal.
            </Text>
          </div>

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          {notice && (
            <Alert color="blue" variant="light">
              {notice}
            </Alert>
          )}

          <TextInput
            label="Email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
            autoFocus
          />
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            required
          />

          <Button type="submit" loading={busy} disabled={!email || !password} fullWidth>
            Sign in
          </Button>

          <Anchor
            component="button"
            type="button"
            size="xs"
            ta="center"
            disabled={busy}
            onClick={() => void requestReset()}
          >
            Forgot your password?
          </Anchor>

          <Text size="xs" c="dimmed" ta="center">
            Accounts are created by your administrator.
          </Text>
        </Stack>
      </Card>
    </Center>
  );
}
