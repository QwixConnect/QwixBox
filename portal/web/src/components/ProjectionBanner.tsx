import { Alert, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { endpoints } from "../lib/api";

// A change younger than this is still being applied normally, not stuck.
const SETTLE_SECONDS = 30;

/**
 * Saved changes that are not yet live on the phone system (R06). The API queues every Redis and
 * Kamailio update in the same transaction as the change and retries until it applies; this is
 * where an owner or admin learns that a revocation or routing change is still waiting. Only those
 * roles can read the queue, so nothing renders for anyone else.
 */
export function ProjectionBanner({ enabled }: { enabled: boolean }) {
	const { data, isSuccess } = useQuery({
		queryKey: ["projections"],
		queryFn: endpoints.projections,
		enabled,
		refetchInterval: 30_000,
		retry: false,
	});
	if (!enabled || !isSuccess || data.pending === 0) return null;
	const stuck =
		data.failing > 0 || (data.oldestPendingSeconds ?? 0) > SETTLE_SECONDS;
	if (!stuck) return null;

	const lastError = data.jobs.find((job) => job.lastError)?.lastError;
	const changes = data.pending === 1 ? "1 saved change is" : `${data.pending} saved changes are`;
	return (
		<Alert
			color={data.failing > 0 ? "red" : "yellow"}
			title={`${changes} not live on the phone system yet`}
			mb="md"
		>
			<Text size="sm">
				They are stored and will be applied automatically when the phone system
				accepts them. Until then calls, registrations and disabled extensions
				follow the previous settings.
			</Text>
			{lastError && (
				<Text size="sm" mt={4} c="dimmed">
					Last error: {lastError}
				</Text>
			)}
		</Alert>
	);
}
