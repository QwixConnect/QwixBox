import {
	Alert,
	Badge,
	Button,
	Center,
	Group,
	Loader,
	Stack,
	Text,
	Tooltip,
} from "@mantine/core";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement, useEffect, useState } from "react";
import { ApiError, FeatureUnavailableError } from "../lib/api";
import {
	type PermissionAction,
	type PermissionResource,
	useRole,
} from "../lib/use-role";
import { IconChevronRight, IconPause, IconPlay, IconTrash } from "./Icons";

export function PageHeader({
	title,
	description,
	subtitle,
	action,
	actions,
	badge,
}: {
	title: string;
	description?: string;
	subtitle?: string;
	action?: ReactNode;
	actions?: ReactNode;
	badge?: ReactNode;
}) {
	const desc = subtitle ?? description;
	const act = actions ?? action;
	return (
		<Group
			justify="space-between"
			align="flex-start"
			mb="xs"
			gap="md"
			wrap="wrap"
		>
			<div style={{ maxWidth: 680 }}>
				<Group gap="sm" align="center">
					<h1 className="qb-large-title" style={{ margin: 0 }}>
						{title}
					</h1>
					{badge}
				</Group>
				{desc && (
					<Text c="dimmed" size="sm" mt={6} style={{ lineHeight: 1.5 }}>
						{desc}
					</Text>
				)}
			</div>
			{act && <Group gap="sm">{act}</Group>}
		</Group>
	);
}

export function SurfaceCard({
	children,
	padding,
	p,
	style,
	className = "",
}: {
	children: ReactNode;
	padding?: number | string;
	p?: number | string;
	style?: CSSProperties;
	className?: string;
}) {
	const resolvedPadding = p !== undefined ? p : (padding ?? 20);
	return (
		<div
			className={`qb-surface-card ${className}`.trim()}
			style={{ padding: resolvedPadding, ...style }}
		>
			{children}
		</div>
	);
}

export function SegmentedTabs<T extends string>({
	value,
	onChange,
	items,
	maxWidth = 640,
}: {
	value: T;
	onChange: (next: T) => void;
	items: {
		value: T;
		label: string;
		count?: number;
		badge?: number | string;
	}[];
	maxWidth?: number | string;
}) {
	return (
		<div className="qb-segmented" style={{ maxWidth }} role="tablist">
			{items.map((item) => {
				const active = item.value === value;
				const badgeVal = item.badge !== undefined ? item.badge : item.count;
				return (
					<button
						key={item.value}
						type="button"
						role="tab"
						aria-selected={active}
						className={`qb-segmented-btn ${active ? "active" : ""}`.trim()}
						data-active={active}
						onClick={() => onChange(item.value)}
					>
						<span>{item.label}</span>
						{badgeVal !== undefined && badgeVal !== 0 && badgeVal !== "" && (
							<span className="qb-segmented-badge">{badgeVal}</span>
						)}
					</button>
				);
			})}
		</div>
	);
}

export function InitialsAvatar({
	name,
	initials,
	size = 42,
	accent = false,
}: {
	name?: string;
	initials?: string;
	size?: number;
	accent?: boolean;
}) {
	const text =
		initials ??
		(name
			? name
					.trim()
					.split(/\s+/)
					.slice(0, 2)
					.map((part) => part[0]?.toUpperCase() ?? "")
					.join("") || "#"
			: "#");

	return (
		<div
			style={{
				width: size,
				height: size,
				minWidth: size,
				borderRadius: "9999px",
				backgroundColor: accent
					? "var(--qb-accent)"
					: "var(--qb-surface-hover)",
				color: accent ? "#ffffff" : "var(--qb-text-primary)",
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				fontWeight: 700,
				fontSize: Math.round(size * 0.36),
				letterSpacing: "-0.02em",
				userSelect: "none",
			}}
		>
			{text}
		</div>
	);
}

export function SettingRow({
	icon,
	label,
	title,
	description,
	subtitle,
	right,
	rightSection,
	onClick,
	danger = false,
	chevron = false,
	withSeparator = false,
}: {
	icon?: ReactNode;
	label?: ReactNode;
	title?: ReactNode;
	description?: ReactNode;
	subtitle?: ReactNode;
	right?: ReactNode;
	rightSection?: ReactNode;
	onClick?: () => void;
	danger?: boolean;
	chevron?: boolean;
	withSeparator?: boolean;
}) {
	const primaryLabel = title ?? label;
	const secondaryDesc = subtitle ?? description;
	const rightContent = rightSection !== undefined ? rightSection : right;
	const showChevron = chevron || (Boolean(onClick) && rightContent === undefined);

	return (
		<div
			className="qb-list-row"
			data-interactive={Boolean(onClick)}
			onClick={onClick}
			role={onClick ? "button" : undefined}
			tabIndex={onClick ? 0 : undefined}
			onKeyDown={
				onClick
					? (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onClick();
							}
						}
					: undefined
			}
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				padding: "16px 20px",
				borderTop: withSeparator ? "1px solid var(--qb-separator)" : undefined,
				cursor: onClick ? "pointer" : undefined,
				color: danger ? "var(--qb-danger)" : "var(--qb-text-primary)",
			}}
		>
			<Group gap="md" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
				{icon && (
					<span
						style={{
							width: 36,
							height: 36,
							borderRadius: 10,
							background: "var(--qb-bg)",
							color: danger ? "var(--qb-danger)" : "var(--qb-text-secondary)",
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							flexShrink: 0,
						}}
					>
						{icon}
					</span>
				)}
				<div style={{ minWidth: 0 }}>
					<div
						className="qb-headline"
						style={{
							color: danger ? "var(--qb-danger)" : "var(--qb-text-primary)",
						}}
					>
						{primaryLabel}
					</div>
					{secondaryDesc && <div className="qb-caption">{secondaryDesc}</div>}
				</div>
			</Group>
			<Group gap="xs" wrap="nowrap">
				{rightContent && (
					<div
						className="qb-body"
						style={{ color: "var(--qb-text-secondary)" }}
					>
						{rightContent}
					</div>
				)}
				{showChevron && (
					<span
						style={{
							color: "var(--qb-text-secondary)",
							display: "inline-flex",
						}}
					>
						<IconChevronRight size={18} />
					</span>
				)}
			</Group>
		</div>
	);
}

const WAVEFORM_BARS = [
	0.32, 0.55, 0.85, 0.45, 0.92, 0.68, 0.35, 0.78, 0.95, 0.5, 0.88, 0.62, 0.4,
	0.74, 0.52, 0.9, 0.66, 0.38, 0.82, 0.58, 0.44, 0.72, 0.94, 0.6, 0.36, 0.76,
	0.5, 0.84, 0.48, 0.65, 0.35, 0.54,
];

export function WaveformPlayer({
	durationSec,
	durationSeconds,
	initialProgressSeconds,
}: {
	durationSec?: number;
	durationSeconds?: number;
	initialProgressSeconds?: number;
}) {
	const totalSec = durationSeconds ?? durationSec ?? 30;
	const [playing, setPlaying] = useState(false);
	const [progress, setProgress] = useState(
		initialProgressSeconds !== undefined && totalSec > 0
			? Math.min(1, initialProgressSeconds / totalSec)
			: 0.35,
	);

	useEffect(() => {
		if (!playing) return;
		const id = window.setInterval(() => {
			setProgress((prev) => {
				if (prev >= 1) {
					setPlaying(false);
					return 0;
				}
				return Math.min(1, prev + 1 / Math.max(10, totalSec * 4));
			});
		}, 250);
		return () => window.clearInterval(id);
	}, [playing, totalSec]);

	const currentSec = Math.round(progress * totalSec);
	const fmt = (sec: number) => {
		const m = Math.floor(sec / 60);
		const s = sec % 60;
		return `${m}:${String(s).padStart(2, "0")}`;
	};

	return (
		<Group gap="md" wrap="nowrap" align="center" my="xs">
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setPlaying((p) => !p);
				}}
				aria-label={playing ? "Pause" : "Play"}
				style={{
					width: 44,
					height: 44,
					minWidth: 44,
					borderRadius: "9999px",
					backgroundColor: "var(--qb-accent)",
					color: "#ffffff",
					border: "none",
					cursor: "pointer",
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				{playing ? <IconPause size={20} /> : <IconPlay size={18} />}
			</button>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 4,
					flex: 1,
					height: 36,
					cursor: "pointer",
				}}
				onClick={(e) => {
					e.stopPropagation();
					const rect = e.currentTarget.getBoundingClientRect();
					const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
					setProgress(Math.max(0, Math.min(1, ratio)));
				}}
			>
				{WAVEFORM_BARS.map((heightRatio, idx) => {
					const active = idx / WAVEFORM_BARS.length <= progress;
					return (
						<span
							key={idx}
							style={{
								flex: 1,
								height: `${Math.round(heightRatio * 30)}px`,
								minHeight: 6,
								borderRadius: 999,
								backgroundColor: active
									? "var(--qb-accent)"
									: "var(--qb-waveform-idle)",
								transition: "background-color 120ms ease",
							}}
						/>
					);
				})}
			</div>

			<span
				className="qb-caption"
				style={{ fontVariantNumeric: "tabular-nums", minWidth: 34 }}
			>
				{fmt(currentSec)}
			</span>
		</Group>
	);
}

export function MockFeatureBanner({
	feature,
	title,
	description,
}: {
	feature?: string;
	title?: string;
	description?: string;
}) {
	if (title || description) {
		return (
			<div
				style={{
					background: "var(--qb-surface)",
					borderRadius: 16,
					padding: "14px 18px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 16,
					flexWrap: "wrap",
				}}
			>
				<div>
					<Group gap={8} align="center">
						<Badge
							size="sm"
							radius="xl"
							style={{
								backgroundColor: "var(--qb-accent-soft)",
								color: "var(--qb-accent-text)",
								textTransform: "none",
								fontWeight: 700,
							}}
						>
							Roadmap UI · Mock Data
						</Badge>
						{title && (
							<Text fw={700} size="sm">
								{title}
							</Text>
						)}
					</Group>
					{description && (
						<Text className="qb-caption" mt={4}>
							{description}
						</Text>
					)}
				</div>
			</div>
		);
	}
	return (
		<Badge
			variant="light"
			color="brand"
			size="md"
			style={{
				backgroundColor: "var(--qb-accent-soft)",
				color: "var(--qb-accent-text)",
				textTransform: "none",
				fontWeight: 600,
			}}
		>
			Preview · {feature} (Mock Data)
		</Badge>
	);
}

export function ErrorAlert({
	error,
	title,
}: {
	error: unknown;
	title?: string;
}) {
	if (!error) return null;
	if (error instanceof FeatureUnavailableError) {
		return (
			<Alert color="gray" title={error.message} mb="md">
				<Text size="sm">{error.detail}</Text>
			</Alert>
		);
	}
	const api = error instanceof ApiError ? error : null;
	return (
		<Alert
			color="red"
			title={title ?? (api ? `Rejected (${api.status})` : "Error")}
			mb="md"
		>
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

export function QueryState<T = unknown>({
	data,
	error,
	isPending,
	isLoading,
	isError,
	isSuccess,
	isPaused,
	isEmpty,
	emptyMessage = "No records found.",
	emptyAction,
	children,
}: {
	data?: T[] | undefined;
	error?: unknown;
	isPending?: boolean;
	isLoading?: boolean;
	isError?: boolean;
	isSuccess?: boolean;
	isPaused?: boolean;
	isEmpty?: boolean;
	emptyMessage?: string;
	emptyAction?: ReactNode;
	children: ReactNode;
}) {
	if (error || isError) {
		return <ErrorAlert error={error ?? new Error("Failed to load data")} />;
	}

	if (isPaused) {
		return (
			<Alert color="yellow" title="Waiting for a connection" mb="md">
				The browser reports no network, so the request has not been sent. It
				will run as soon as connectivity returns.
			</Alert>
		);
	}

	if (isPending || isLoading) {
		return (
			<SurfaceCard padding={48}>
				<Center>
					<Loader color="brand" />
				</Center>
			</SurfaceCard>
		);
	}

	const emptyResolved =
		isEmpty !== undefined
			? isEmpty
			: Boolean(isSuccess && (data ?? []).length === 0);

	if (emptyResolved) {
		return (
			<SurfaceCard padding={48}>
				<Center>
					<Stack align="center" gap="md">
						<Text c="dimmed" size="md" fw={500}>
							{emptyMessage}
						</Text>
						{emptyAction}
					</Stack>
				</Center>
			</SurfaceCard>
		);
	}

	return <>{children}</>;
}

export function DeleteButton({
	what = "this item",
	onConfirm,
	loading,
	disabled,
	disabledReason,
}: {
	what?: string;
	onConfirm: () => void;
	loading?: boolean;
	disabled?: boolean;
	disabledReason?: string;
}) {
	const button = (
		<Button
			size="sm"
			variant="subtle"
			color="red"
			leftSection={<IconTrash size={15} />}
			loading={loading}
			disabled={disabled}
			styles={{
				root: {
					minHeight: 36,
					paddingInline: 12,
					color: "var(--qb-danger)",
				},
			}}
			onClick={() => {
				if (
					window.confirm(
						`Delete ${what}? Anything routing to it will stop working.`,
					)
				) {
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
	allow,
	mode = "hide",
	children,
	reason,
}: {
	resource?: PermissionResource;
	action?: PermissionAction;
	allow?: string[];
	mode?: "hide" | "disable";
	children: ReactNode;
	reason?: string;
}) {
	const { can, role } = useRole();
	let allowed = true;
	if (resource && action) {
		allowed = can(resource, action);
	} else if (allow) {
		const effectiveRole = role ?? "owner";
		const normalizedAllow = allow.map((r) =>
			r === "operator" ? "member" : r,
		);
		allowed =
			normalizedAllow.includes(effectiveRole) ||
			(allow.includes("operator") && effectiveRole === "member");
	}

	const label =
		reason ??
		`Your role (${role ?? "unknown"}) cannot ${action ?? "modify"} ${resource ?? "this resource"}`;

	if (allowed) return <>{children}</>;

	if (mode === "hide") return null;

	return (
		<Tooltip label={label}>
			<span>
				{isValidElement(children)
					? cloneDisabled(children as ReactElement<{ disabled?: boolean }>)
					: children}
			</span>
		</Tooltip>
	);
}

function cloneDisabled(
	child: ReactElement<{ disabled?: boolean }>,
): ReactElement {
	return cloneElement(child, { disabled: true });
}
