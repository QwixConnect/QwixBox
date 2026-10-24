import {
	Badge,
	Button,
	Group,
	NativeSelect,
	Popover,
	Stack,
	Text,
} from "@mantine/core";
import { useEffect, useState } from "react";

export function MockControls() {
	const [role, setRole] = useState("owner");
	const [scenario, setScenario] = useState("normal");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [available, setAvailable] = useState(false);

	useEffect(() => {
		void fetch("/__mock/state")
			.then((res) => {
				if (!res.ok) throw new Error("Not in mock mode");
				return res.json();
			})
			.then((state) => {
				setRole(state.role);
				setScenario(state.scenario);
				setAvailable(true);
			})
			.catch(() => setAvailable(false));
	}, []);

	if (!available) return null;

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
		} catch (err) {
			setError((err as Error).message);
			setBusy(false);
		}
	}

	return (
		<Popover position="top-end" withArrow shadow="md" radius={16}>
			<Popover.Target>
				<Button
					size="compact-sm"
					variant="default"
					radius="xl"
					visibleFrom="md"
					style={{
						position: "fixed",
						bottom: 18,
						right: 18,
						zIndex: 250,
						background: "var(--qb-surface)",
						border: "1px solid var(--qb-separator)",
						color: "var(--qb-text-primary)",
						minHeight: 38,
						height: 38,
						paddingInline: 16,
						fontWeight: 600,
						fontSize: 13,
					}}
				>
					Mock: {scenario} · {role}
				</Button>
			</Popover.Target>
			<Popover.Dropdown
				style={{
					background: "var(--qb-bg)",
					border: "1px solid var(--qb-separator)",
					padding: 18,
				}}
			>
				<Stack gap="sm" w={250}>
					<Group justify="space-between">
						<Badge color="brand" variant="light">
							Mock data
						</Badge>
						<Text size="xs" c="dimmed">
							Memory only
						</Text>
					</Group>
					<NativeSelect
						label="Demo role"
						aria-label="Demo role"
						value={role}
						disabled={busy}
						onChange={(event) =>
							void change("/__mock/settings", {
								role: event.currentTarget.value,
							})
						}
						data={["owner", "admin", "member", "viewer"]}
						size="xs"
					/>
					<NativeSelect
						label="Demo scenario"
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
				</Stack>
			</Popover.Dropdown>
		</Popover>
	);
}

export default MockControls;
