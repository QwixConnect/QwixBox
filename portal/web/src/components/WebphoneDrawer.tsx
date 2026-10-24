import {
	ActionIcon,
	Box,
	Button,
	Drawer,
	Group,
	SimpleGrid,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import {
	IconBackspace,
	IconLock,
	IconMicOff,
	IconPause,
	IconPhone,
	IconPhoneHangup,
	IconPlus,
	IconShare,
	IconSpeaker,
	IconVolume,
	IconX,
	IconKeypad,
} from "./Icons";
import { InitialsAvatar } from "./Resource";

interface WebphoneContextValue {
	opened: boolean;
	openKeypad: (prefillNumber?: string, prefillName?: string) => void;
	startCall: (number: string, name?: string) => void;
	close: () => void;
	inCall: boolean;
}

const WebphoneContext = createContext<WebphoneContextValue>({
	opened: false,
	openKeypad: () => {},
	startCall: () => {},
	close: () => {},
	inCall: false,
});

// eslint-disable-next-line react-refresh/only-export-components
export function useWebphone() {
	return useContext(WebphoneContext);
}

const KEYPAD_KEYS: Array<{ digit: string; sub: string }> = [
	{ digit: "1", sub: "OO" },
	{ digit: "2", sub: "ABC" },
	{ digit: "3", sub: "DEF" },
	{ digit: "4", sub: "GHI" },
	{ digit: "5", sub: "JKL" },
	{ digit: "6", sub: "MNO" },
	{ digit: "7", sub: "PQRS" },
	{ digit: "8", sub: "TUV" },
	{ digit: "9", sub: "WXYZ" },
	{ digit: "*", sub: "" },
	{ digit: "0", sub: "+" },
	{ digit: "#", sub: "" },
];

function formatDuration(sec: number): string {
	const mins = Math.floor(sec / 60);
	const rem = sec % 60;
	return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

export function WebphoneProvider({ children }: { children: ReactNode }) {
	const [opened, setOpened] = useState(false);
	const [number, setNumber] = useState("+1 (415) 555-0132");
	const [contactName, setContactName] = useState("Priya Shah");
	const [inCall, setInCall] = useState(false);
	const [seconds, setSeconds] = useState(267); // 04:27 matching mockup
	const [muted, setMuted] = useState(false);
	const [speaker, setSpeaker] = useState(true);
	const [onHold, setOnHold] = useState(false);
	const [showInCallKeypad, setShowInCallKeypad] = useState(false);

	useEffect(() => {
		if (!inCall || onHold) return;
		const timer = window.setInterval(() => {
			setSeconds((s) => s + 1);
		}, 1000);
		return () => window.clearInterval(timer);
	}, [inCall, onHold]);

	const openKeypad = useCallback((prefillNumber?: string, prefillName?: string) => {
		if (prefillNumber !== undefined) {
			setNumber(prefillNumber);
		}
		if (prefillName !== undefined) {
			setContactName(prefillName);
		}
		setInCall(false);
		setOpened(true);
	}, []);

	const startCall = useCallback((dialNumber: string, dialName?: string) => {
		setNumber(dialNumber || "+1 (415) 555-0132");
		setContactName(dialName || "Priya Shah");
		setSeconds(267);
		setMuted(false);
		setOnHold(false);
		setShowInCallKeypad(false);
		setInCall(true);
		setOpened(true);
	}, []);

	const close = useCallback(() => {
		setOpened(false);
	}, []);

	const appendDigit = (digit: string) => {
		setNumber((prev) => `${prev}${digit}`);
	};

	const backspace = () => {
		setNumber((prev) => prev.slice(0, -1));
	};

	const handleDial = () => {
		if (!number.trim()) return;
		if (number.includes("0132")) {
			setContactName("Priya Shah");
		} else if (number.includes("0198")) {
			setContactName("Marcus Vance");
		} else if (number.includes("0144")) {
			setContactName("Apex Logistics");
		} else if (!contactName) {
			setContactName("External Caller");
		}
		setSeconds(267);
		setInCall(true);
	};

	const handleHangup = () => {
		setInCall(false);
		setShowInCallKeypad(false);
	};

	return (
		<WebphoneContext.Provider
			value={{ opened, openKeypad, startCall, close, inCall }}
		>
			{children}
			<Drawer
				opened={opened}
				onClose={close}
				position="right"
				size={400}
				withCloseButton={false}
				padding={0}
				styles={{
					content: {
						background: "var(--qb-bg)",
						borderLeft: "1px solid var(--qb-separator)",
						display: "flex",
						flexDirection: "column",
					},
					body: {
						padding: 0,
						height: "100%",
						display: "flex",
						flexDirection: "column",
					},
				}}
			>
				{!inCall ? (
					<Stack
						justify="space-between"
						style={{ height: "100%", padding: "24px 28px 32px" }}
					>
						{/* Top bar: status pill + close */}
						<Group justify="space-between" align="center">
							<Box className="qb-online-pill">
								<span className="qb-online-dot" />
								<span>Online · 1001</span>
							</Box>
							<Group gap={8}>
								<Button
									variant="subtle"
									size="compact-sm"
									color="gray"
									onClick={() => startCall("+1 415 555 0132", "Priya Shah")}
									styles={{
										root: {
											minHeight: 32,
											height: 32,
											fontSize: 12,
											fontWeight: 600,
										},
									}}
								>
									Preview In-Call
								</Button>
								<ActionIcon
									variant="subtle"
									color="gray"
									radius="xl"
									size={40}
									onClick={close}
									aria-label="Close keypad"
								>
									<IconX size={18} />
								</ActionIcon>
							</Group>
						</Group>

						{/* Display number & Add to contacts */}
						<Stack align="center" gap={6} my="xs">
							<Text
								style={{
									fontSize: number.length > 15 ? 28 : 34,
									fontWeight: 600,
									letterSpacing: "-0.025em",
									color: "var(--qb-text-primary)",
									textAlign: "center",
									minHeight: 44,
									wordBreak: "break-all",
								}}
							>
								{number || "Enter number"}
							</Text>
							<UnstyledButton
								style={{
									color: "var(--qb-accent-text)",
									fontSize: 15,
									fontWeight: 600,
									minHeight: 32,
								}}
								onClick={() => {
									setContactName("Saved Contact");
								}}
							>
								Add to contacts
							</UnstyledButton>
						</Stack>

						{/* 3x4 Keypad Grid */}
						<SimpleGrid
							cols={3}
							spacing={16}
							verticalSpacing={16}
							style={{ maxWidth: 296, margin: "0 auto", width: "100%" }}
						>
							{KEYPAD_KEYS.map((k) => (
								<Box
									key={k.digit}
									style={{ display: "flex", justifyContent: "center" }}
								>
									<button
										type="button"
										className="qb-keypad-btn"
										onClick={() => appendDigit(k.digit)}
									>
										<span className="qb-keypad-digit">{k.digit}</span>
										{k.sub ? (
											<span className="qb-keypad-sub">{k.sub}</span>
										) : (
											<span style={{ height: 10 }} />
										)}
									</button>
								</Box>
							))}
						</SimpleGrid>

						{/* Bottom Call Action & Backspace */}
						<Group
							justify="center"
							align="center"
							gap={32}
							mt="md"
							style={{ position: "relative" }}
						>
							<Box style={{ width: 48 }} />
							<UnstyledButton
								onClick={handleDial}
								aria-label="Place call"
								style={{
									width: 68,
									height: 68,
									borderRadius: 9999,
									background: "var(--qb-accent)",
									color: "#FFFFFF",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
								}}
							>
								<IconPhone size={28} />
							</UnstyledButton>
							<ActionIcon
								variant="subtle"
								color="gray"
								radius="xl"
								size={48}
								onClick={backspace}
								aria-label="Backspace"
								style={{ color: "var(--qb-text-secondary)" }}
							>
								<IconBackspace size={22} />
							</ActionIcon>
						</Group>
					</Stack>
				) : (
					/* Active Call View matching In call@2x.png */
					<Stack
						justify="space-between"
						style={{ height: "100%", padding: "24px 28px 36px" }}
					>
						<Group justify="space-between" align="center">
							<UnstyledButton
								onClick={() => setInCall(false)}
								style={{
									fontSize: 14,
									fontWeight: 600,
									color: "var(--qb-text-secondary)",
									minHeight: 36,
								}}
							>
								← Keypad
							</UnstyledButton>
							<ActionIcon
								variant="subtle"
								color="gray"
								radius="xl"
								size={40}
								onClick={close}
								aria-label="Minimize call drawer"
							>
								<IconX size={18} />
							</ActionIcon>
						</Group>

						{/* Caller Identity */}
						<Stack align="center" gap={8}>
							<InitialsAvatar
								name={contactName || "Priya Shah"}
								size={88}
								accent={false}
							/>
							<Text
								style={{
									fontSize: 30,
									fontWeight: 800,
									letterSpacing: "-0.025em",
									color: "var(--qb-text-primary)",
									marginTop: 8,
								}}
							>
								{contactName || "Priya Shah"}
							</Text>
							<Text
								style={{
									fontSize: 15,
									fontWeight: 500,
									color: "var(--qb-text-secondary)",
								}}
							>
								{number}
							</Text>
							<Text
								className="qb-mono"
								style={{
									fontSize: 15,
									fontWeight: 600,
									color: "var(--qb-accent-text)",
									marginTop: 2,
								}}
							>
								{onHold ? "ON HOLD" : formatDuration(seconds)}
							</Text>
							<Group
								gap={6}
								mt={6}
								style={{
									background: "var(--qb-surface)",
									padding: "6px 14px",
									borderRadius: 9999,
									color: "var(--qb-text-secondary)",
									fontSize: 13,
									fontWeight: 500,
								}}
							>
								<IconLock size={13} />
								<span>Encrypted call</span>
							</Group>
						</Stack>

						{/* 2x3 Call Controls Grid matching In call@2x.png */}
						<SimpleGrid
							cols={3}
							spacing={20}
							verticalSpacing={22}
							style={{ maxWidth: 296, margin: "0 auto", width: "100%" }}
						>
							<Stack align="center" gap={8}>
								<button
									type="button"
									className={`qb-call-action-circle ${muted ? "active" : ""}`}
									onClick={() => setMuted((m) => !m)}
								>
									<IconMicOff size={22} />
								</button>
								<Text size="xs" c="dimmed" fw={500}>
									Mute
								</Text>
							</Stack>

							<Stack align="center" gap={8}>
								<button
									type="button"
									className={`qb-call-action-circle ${showInCallKeypad ? "active" : ""}`}
									onClick={() => setShowInCallKeypad((v) => !v)}
								>
									<IconKeypad size={22} />
								</button>
								<Text size="xs" c="dimmed" fw={500}>
									Keypad
								</Text>
							</Stack>

							<Stack align="center" gap={8}>
								<button
									type="button"
									className={`qb-call-action-circle ${speaker ? "active" : ""}`}
									onClick={() => setSpeaker((s) => !s)}
								>
									{speaker ? <IconSpeaker size={22} /> : <IconVolume size={22} />}
								</button>
								<Text
									size="xs"
									fw={600}
									style={{
										color: speaker
											? "var(--qb-accent-text)"
											: "var(--qb-text-secondary)",
									}}
								>
									Speaker
								</Text>
							</Stack>

							<Stack align="center" gap={8}>
								<button
									type="button"
									className={`qb-call-action-circle ${onHold ? "active" : ""}`}
									onClick={() => setOnHold((h) => !h)}
								>
									<IconPause size={22} />
								</button>
								<Text size="xs" c="dimmed" fw={500}>
									Hold
								</Text>
							</Stack>

							<Stack align="center" gap={8}>
								<button
									type="button"
									className="qb-call-action-circle"
									onClick={() => setInCall(false)}
								>
									<IconPlus size={22} />
								</button>
								<Text size="xs" c="dimmed" fw={500}>
									Add call
								</Text>
							</Stack>

							<Stack align="center" gap={8}>
								<button
									type="button"
									className="qb-call-action-circle"
									onClick={() => {
										setContactName("Transferred · Ext 1002");
									}}
								>
									<IconShare size={22} />
								</button>
								<Text size="xs" c="dimmed" fw={500}>
									Transfer
								</Text>
							</Stack>
						</SimpleGrid>

						{/* Red End Call Circle */}
						<Group justify="center" mt="md">
							<UnstyledButton
								onClick={handleHangup}
								aria-label="End call"
								style={{
									width: 68,
									height: 68,
									borderRadius: 9999,
									background: "var(--qb-danger)",
									color: "#FFFFFF",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
								}}
							>
								<IconPhoneHangup size={28} />
							</UnstyledButton>
						</Group>
					</Stack>
				)}
			</Drawer>
		</WebphoneContext.Provider>
	);
}
