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
	TextInput,
	useMantineColorScheme,
} from "@mantine/core";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { IconBrandMark, IconMoon, IconSun } from "../components/Icons";
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
	const { redirect: redirectTo } = Route.useSearch();
	const { colorScheme, toggleColorScheme } = useMantineColorScheme();
	const [email, setEmail] = useState("owner@example.test");
	const [password, setPassword] = useState("demo-password");
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
		await navigate({ to: redirectTo ?? "/" });
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
				<form onSubmit={submit}>
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
									fontSize: 38,
									lineHeight: 1.08,
									letterSpacing: "-0.03em",
								}}
							>
								Your business line, in one place.
							</h1>
							<Text
								style={{
									fontSize: 16,
									fontWeight: 500,
									lineHeight: 1.45,
									color: "var(--qb-text-secondary)",
								}}
							>
								Make and receive calls, manage voicemail, and message from your
								team number.
							</Text>
						</Stack>

						{error && (
							<Alert color="red" variant="light" radius={12}>
								{error}
							</Alert>
						)}
						{notice && (
							<Alert color="blue" variant="light" radius={12}>
								{notice}
							</Alert>
						)}

						<Stack gap={18}>
							<TextInput
								label="Work email or extension"
								placeholder="you@company.com"
								required
								value={email}
								onChange={(e) => setEmail(e.currentTarget.value)}
								autoComplete="username"
								size="md"
							/>
							<Box>
								<PasswordInput
									label="Password"
									required
									value={password}
									onChange={(e) => setPassword(e.currentTarget.value)}
									autoComplete="current-password"
									size="md"
								/>
								<Group justify="flex-end" mt={8}>
									<Anchor
										component="button"
										type="button"
										disabled={busy}
										onClick={() => void requestReset()}
										style={{
											fontSize: 13,
											fontWeight: 600,
											color: "var(--qb-accent-text)",
										}}
									>
										Forgot password?
									</Anchor>
								</Group>
							</Box>
						</Stack>

						<Button
							type="submit"
							loading={busy}
							disabled={!email || !password}
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
							Sign in
						</Button>
					</Stack>
				</form>
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
