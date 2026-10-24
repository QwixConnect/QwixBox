import {
	ActionIcon,
	Alert,
	Anchor,
	Box,
	Button,
	Group,
	PasswordInput,
	Stack,
	Text,
	useMantineColorScheme,
} from "@mantine/core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { IconBrandMark, IconMoon, IconSun } from "../components/Icons";
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
	const { colorScheme, toggleColorScheme } = useMantineColorScheme();

	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState(false);

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
		if (!token) return;

		setBusy(true);
		const res = await authClient.resetPassword({
			newPassword: password,
			token,
		});
		setBusy(false);

		if (res.error) {
			setError(res.error.message ?? "Could not reset the password.");
			return;
		}

		setDone(true);
		setTimeout(() => void navigate({ to: "/login" }), 2500);
	}

	return (
		<Box
			style={{
				minHeight: "100dvh",
				background: "var(--qb-bg)",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				padding: "32px 24px 40px",
			}}
		>
			<Group justify="flex-end" maw={440} w="100%" mx="auto">
				<ActionIcon
					variant="default"
					radius="xl"
					size={42}
					onClick={() => toggleColorScheme()}
					aria-label="Toggle color scheme"
					style={{
						background: "var(--qb-surface)",
						border: "none",
						color: "var(--qb-text-primary)",
					}}
				>
					{colorScheme === "dark" ? (
						<IconSun size={18} />
					) : (
						<IconMoon size={18} />
					)}
				</ActionIcon>
			</Group>

			<Box maw={420} w="100%" mx="auto">
				<Stack gap={28}>
					<Group gap={12} align="center">
						<Box
							style={{
								width: 44,
								height: 44,
								borderRadius: 12,
								background: "var(--qb-accent)",
								color: "#FFFFFF",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<IconBrandMark size={24} />
						</Box>
						<Text
							style={{
								fontSize: 22,
								fontWeight: 800,
								letterSpacing: "-0.025em",
								color: "var(--qb-text-primary)",
							}}
						>
							QwixBox
						</Text>
					</Group>

					<Stack gap={10}>
						<h1
							className="qb-large-title"
							style={{
								fontSize: 34,
								lineHeight: 1.1,
								letterSpacing: "-0.03em",
							}}
						>
							Reset your password.
						</h1>
						<Text
							style={{
								fontSize: 16,
								fontWeight: 500,
								lineHeight: 1.45,
								color: "var(--qb-text-secondary)",
							}}
						>
							Choose a new password with at least 12 characters.
						</Text>
					</Stack>

					{!token || linkError ? (
						<Stack gap={16}>
							<Alert
								color="red"
								radius={16}
								title="That link is no longer valid"
							>
								Reset links expire after an hour and can only be used once. Ask
								for a new one from the sign-in page.
							</Alert>
							<Anchor component={Link} to="/login" size="sm" fw={600}>
								← Back to sign in
							</Anchor>
						</Stack>
					) : done ? (
						<Stack gap={16}>
							<Alert color="green" radius={16} title="Password changed">
								You can sign in with the new password now.
							</Alert>
							<Button component={Link} to="/login" fullWidth size="lg">
								Sign in
							</Button>
						</Stack>
					) : (
						<Stack gap={18}>
							{error && (
								<Alert color="red" radius={12}>
									{error}
								</Alert>
							)}
							<PasswordInput
								label="New password"
								value={password}
								onChange={(e) => setPassword(e.currentTarget.value)}
								autoFocus
								size="md"
							/>
							<PasswordInput
								label="Confirm new password"
								value={confirm}
								onChange={(e) => setConfirm(e.currentTarget.value)}
								onKeyDown={(e) => e.key === "Enter" && void submit()}
								size="md"
							/>
							<Button
								onClick={() => void submit()}
								loading={busy}
								fullWidth
								size="lg"
								styles={{
									root: {
										minHeight: 50,
										height: 50,
										borderRadius: 12,
										background: "var(--qb-accent)",
										fontSize: 16,
										fontWeight: 700,
									},
								}}
							>
								Set password
							</Button>
						</Stack>
					)}
				</Stack>
			</Box>

			<Box maw={420} w="100%" mx="auto" style={{ textAlign: "center" }}>
				<Text
					style={{
						fontSize: 13,
						fontWeight: 500,
						color: "var(--qb-text-secondary)",
					}}
				>
					Provisioned by your organization administrator.
				</Text>
			</Box>
		</Box>
	);
}
