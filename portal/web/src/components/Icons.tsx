import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...props }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.85}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...props}
		>
			{children}
		</svg>
	);
}

export function IconBrandMark(props: IconProps) {
	return <IconPhone {...props} />;
}

export function IconPhone(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
		</Svg>
	);
}

export function IconPhoneFilled({ size = 20, ...props }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
			{...props}
		>
			<path d="M21 16.42v3.536a1 1 0 0 1-.93.998c-.437.03-.794.046-1.07.046-8.837 0-16-7.163-16-16 0-.276.015-.633.046-1.07A1 1 0 0 1 4.044 3H7.58a.5.5 0 0 1 .498.45c.023.23.044.413.064.552A13.9 13.9 0 0 0 9.35 8.003c.095.2.033.439-.147.567l-2.158 1.542a13.05 13.05 0 0 0 6.844 6.844l1.54-2.154a.46.46 0 0 1 .568-.149 13.9 13.9 0 0 0 4 1.205c.139.02.322.042.55.064a.5.5 0 0 1 .453.498z" />
		</svg>
	);
}

export function IconPhoneHangup({ size = 22, ...props }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
			{...props}
		>
			<path d="M12 7c-4.63 0-8.84 1.78-11.95 4.68a.99.99 0 0 0-.04 1.42l2.48 2.48c.37.37.96.4 1.38.08 1.21-.94 2.61-1.64 4.13-2.02.46-.12.78-.53.78-1.01v-2.1c1.03-.34 2.11-.53 3.22-.53s2.19.19 3.22.53v2.1c0 .48.32.89.78 1.01 1.52.38 2.92 1.08 4.13 2.02.42.32 1.01.29 1.38-.08l2.48-2.48a.99.99 0 0 0-.04-1.42C20.84 8.78 16.63 7 12 7z" />
		</svg>
	);
}

export function IconClock(props: IconProps) {
	return (
		<Svg {...props}>
			<circle cx="12" cy="12" r="9" />
			<polyline points="12 7 12 12 15.5 14" />
		</Svg>
	);
}

export const IconRecents = IconClock;

export function IconUser(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
			<circle cx="12" cy="7" r="4" />
		</Svg>
	);
}

export const IconContacts = IconUser;

export function IconUsers(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
			<circle cx="9" cy="7" r="4" />
			<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
			<path d="M16 3.13a4 4 0 0 1 0 7.75" />
		</Svg>
	);
}

export const IconConferences = IconUsers;

export function IconKeypad({ size = 20, ...props }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
			{...props}
		>
			<circle cx="6" cy="5" r="1.75" />
			<circle cx="12" cy="5" r="1.75" />
			<circle cx="18" cy="5" r="1.75" />
			<circle cx="6" cy="11" r="1.75" />
			<circle cx="12" cy="11" r="1.75" />
			<circle cx="18" cy="11" r="1.75" />
			<circle cx="6" cy="17" r="1.75" />
			<circle cx="12" cy="17" r="1.75" />
			<circle cx="18" cy="17" r="1.75" />
			<circle cx="12" cy="21.5" r="1.45" />
		</svg>
	);
}

export function IconMessage(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</Svg>
	);
}

export const IconMessages = IconMessage;

export function IconSliders(props: IconProps) {
	return (
		<Svg {...props}>
			<line x1="4" y1="8" x2="20" y2="8" />
			<line x1="4" y1="16" x2="20" y2="16" />
			<circle cx="9" cy="8" r="2.2" fill="var(--qb-bg)" />
			<circle cx="15" cy="16" r="2.2" fill="var(--qb-bg)" />
		</Svg>
	);
}

export const IconSettings = IconSliders;

export function IconDashboard(props: IconProps) {
	return (
		<Svg {...props}>
			<rect x="3" y="3" width="7" height="7" rx="2" />
			<rect x="14" y="3" width="7" height="7" rx="2" />
			<rect x="14" y="14" width="7" height="7" rx="2" />
			<rect x="3" y="14" width="7" height="7" rx="2" />
		</Svg>
	);
}

export function IconArrowOut(props: IconProps) {
	return (
		<Svg size={15} {...props}>
			<line x1="7" y1="17" x2="17" y2="7" />
			<polyline points="9 7 17 7 17 15" />
		</Svg>
	);
}

export const IconArrowUpRight = IconArrowOut;

export function IconArrowIn(props: IconProps) {
	return (
		<Svg size={15} {...props}>
			<line x1="17" y1="7" x2="7" y2="17" />
			<polyline points="15 17 7 17 7 9" />
		</Svg>
	);
}

export const IconArrowDownLeft = IconArrowIn;

export function IconInfo(props: IconProps) {
	return (
		<Svg {...props}>
			<circle cx="12" cy="12" r="9" />
			<line x1="12" y1="16" x2="12" y2="12" />
			<line x1="12" y1="8" x2="12.01" y2="8" />
		</Svg>
	);
}

export function IconSearch(props: IconProps) {
	return (
		<Svg {...props}>
			<circle cx="11" cy="11" r="7" />
			<line x1="20" y1="20" x2="16.2" y2="16.2" />
		</Svg>
	);
}

export function IconPlus(props: IconProps) {
	return (
		<Svg {...props}>
			<line x1="12" y1="5" x2="12" y2="19" />
			<line x1="5" y1="12" x2="19" y2="12" />
		</Svg>
	);
}

export function IconCompose(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
			<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
		</Svg>
	);
}

export const IconEdit = IconCompose;

export function IconVoicemail(props: IconProps) {
	return (
		<Svg {...props}>
			<circle cx="6" cy="12" r="4" />
			<circle cx="18" cy="12" r="4" />
			<line x1="6" y1="16" x2="18" y2="16" />
		</Svg>
	);
}

export function IconMoon(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
		</Svg>
	);
}

export function IconSun(props: IconProps) {
	return (
		<Svg {...props}>
			<circle cx="12" cy="12" r="5" />
			<line x1="12" y1="1" x2="12" y2="3" />
			<line x1="12" y1="21" x2="12" y2="23" />
			<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
			<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
			<line x1="1" y1="12" x2="3" y2="12" />
			<line x1="21" y1="12" x2="23" y2="12" />
			<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
			<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
		</Svg>
	);
}

export function IconSpeaker(props: IconProps) {
	return (
		<Svg {...props}>
			<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
			<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
			<path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
		</Svg>
	);
}

export const IconVolume = IconSpeaker;

export function IconMicOff(props: IconProps) {
	return (
		<Svg {...props}>
			<line x1="1" y1="1" x2="23" y2="23" />
			<path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
			<path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
			<line x1="12" y1="19" x2="12" y2="23" />
			<line x1="8" y1="23" x2="16" y2="23" />
		</Svg>
	);
}

export function IconPause(props: IconProps) {
	return (
		<Svg {...props}>
			<line x1="9" y1="6" x2="9" y2="18" />
			<line x1="15" y1="6" x2="15" y2="18" />
		</Svg>
	);
}

export function IconPlay({ size = 18, ...props }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
			{...props}
		>
			<polygon points="7 5 19 12 7 19 7 5" />
		</svg>
	);
}

export function IconTransfer(props: IconProps) {
	return (
		<Svg {...props}>
			<polyline points="17 2 21 6 17 10" />
			<line x1="3" y1="6" x2="21" y2="6" />
			<polyline points="7 22 3 18 7 14" />
			<line x1="21" y1="18" x2="3" y2="18" />
		</Svg>
	);
}

export const IconShare = IconTransfer;
export const IconRouting = IconTransfer;

export function IconTrash(props: IconProps) {
	return (
		<Svg {...props}>
			<polyline points="3 6 5 6 21 6" />
			<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
		</Svg>
	);
}

export function IconShield(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
		</Svg>
	);
}

export function IconBell(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
			<path d="M13.73 21a2 2 0 0 1-3.46 0" />
		</Svg>
	);
}

export function IconBellOff(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M13.73 21a2 2 0 0 1-3.46 0" />
			<path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
			<path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
			<path d="M18 8a6 6 0 0 0-9.33-5" />
			<line x1="1" y1="1" x2="23" y2="23" />
		</Svg>
	);
}

export function IconMusic(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M9 18V5l12-2v13" />
			<circle cx="6" cy="18" r="3" />
			<circle cx="18" cy="16" r="3" />
		</Svg>
	);
}

export function IconPulse(props: IconProps) {
	return (
		<Svg {...props}>
			<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
		</Svg>
	);
}

export const IconQueues = IconPulse;

export function IconSignOut(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
			<polyline points="16 17 21 12 16 7" />
			<line x1="21" y1="12" x2="9" y2="12" />
		</Svg>
	);
}

export const IconLogout = IconSignOut;

export function IconChevronRight(props: IconProps) {
	return (
		<Svg size={18} {...props}>
			<polyline points="9 18 15 12 9 6" />
		</Svg>
	);
}

export function IconChevronLeft(props: IconProps) {
	return (
		<Svg size={20} {...props}>
			<polyline points="15 18 9 12 15 6" />
		</Svg>
	);
}

export function IconArrowUp(props: IconProps) {
	return (
		<Svg size={18} {...props}>
			<line x1="12" y1="19" x2="12" y2="5" />
			<polyline points="5 12 12 5 19 12" />
		</Svg>
	);
}

export function IconLock(props: IconProps) {
	return (
		<Svg size={14} {...props}>
			<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
			<path d="M7 11V7a5 5 0 0 1 10 0v4" />
		</Svg>
	);
}

export function IconServer(props: IconProps) {
	return (
		<Svg {...props}>
			<rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
			<rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
			<line x1="6" y1="6" x2="6.01" y2="6" />
			<line x1="6" y1="18" x2="6.01" y2="18" />
		</Svg>
	);
}

export const IconTrunks = IconServer;

export function IconRoute(props: IconProps) {
	return (
		<Svg {...props}>
			<circle cx="6" cy="19" r="3" />
			<path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
			<circle cx="18" cy="5" r="3" />
		</Svg>
	);
}

export const IconCallFlows = IconRoute;

export function IconFax(props: IconProps) {
	return (
		<Svg {...props}>
			<polyline points="6 9 6 2 18 2 18 9" />
			<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
			<rect x="6" y="14" width="12" height="8" />
		</Svg>
	);
}

export const IconFaxes = IconFax;

export function IconMapPin(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
			<circle cx="12" cy="10" r="3" />
		</Svg>
	);
}

export const IconEmergency = IconMapPin;

export function IconDevice(props: IconProps) {
	return (
		<Svg {...props}>
			<rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
			<line x1="12" y1="18" x2="12.01" y2="18" />
		</Svg>
	);
}

export const IconDevices = IconDevice;
export const IconExtensions = IconDevice;

export function IconBackspace(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
			<line x1="18" y1="9" x2="12" y2="15" />
			<line x1="12" y1="9" x2="18" y2="15" />
		</Svg>
	);
}

export function IconX(props: IconProps) {
	return (
		<Svg {...props}>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</Svg>
	);
}

export function IconPaperclip(props: IconProps) {
	return (
		<Svg {...props}>
			<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
		</Svg>
	);
}

export function IconSend(props: IconProps) {
	return (
		<Svg {...props}>
			<line x1="22" y1="2" x2="11" y2="13" />
			<polygon points="22 2 15 22 11 13 2 9 22 2" />
		</Svg>
	);
}

export function IconRefresh(props: IconProps) {
	return (
		<Svg {...props}>
			<polyline points="23 4 23 10 17 10" />
			<polyline points="1 20 1 14 7 14" />
			<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
		</Svg>
	);
}

export function IconPhoneForwarded(props: IconProps) {
	return (
		<Svg {...props}>
			<polyline points="19 1 23 5 19 9" />
			<line x1="15" y1="5" x2="23" y2="5" />
			<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
		</Svg>
	);
}
