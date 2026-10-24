import { useEffect, useState } from "react";
import { Badge, Button, Group, NativeSelect, Paper, Text } from "@mantine/core";

export default function MockControls() {
  const [role, setRole] = useState("owner");
  const [scenario, setScenario] = useState("normal");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetch("/__mock/state")
      .then((res) => res.json())
      .then((state) => {
        setRole(state.role);
        setScenario(state.scenario);
      })
      .catch(() => setError("Mock server is unavailable"));
  }, []);
  async function change(path: string, body: object) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Could not update mock mode");
      window.location.assign("/");
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <Paper
      withBorder
      shadow="sm"
      p="xs"
      style={{
        position: "fixed",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 250,
        maxWidth: "calc(100vw - 24px)",
        width: "max-content",
      }}
    >
      <Group gap="xs" wrap="wrap">
        <Badge color="orange" variant="light">
          Mock data
        </Badge>
        <Text size="xs" c="dimmed">
          Memory only · no live calls
        </Text>
        <NativeSelect
          aria-label="Demo role"
          value={role}
          disabled={busy}
          onChange={(event) =>
            void change("/__mock/settings", { role: event.currentTarget.value })
          }
          data={["owner", "admin", "member", "viewer"]}
          size="xs"
        />
        <NativeSelect
          aria-label="Demo scenario"
          value={scenario}
          disabled={busy}
          onChange={(event) =>
            void change("/__mock/settings", {
              scenario: event.currentTarget.value,
            })
          }
          data={[
            { value: "normal", label: "Normal" },
            { value: "empty", label: "Empty data" },
            { value: "error", label: "API errors" },
            { value: "slow", label: "Slow requests" },
          ]}
          size="xs"
        />
        <Button
          size="xs"
          variant="light"
          disabled={busy}
          onClick={() => void change("/__mock/reset", {})}
        >
          Reset demo
        </Button>
        {error && (
          <Text size="xs" c="red">
            {error}
          </Text>
        )}
      </Group>
    </Paper>
  );
}
