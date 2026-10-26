import { useQuery } from "@tanstack/react-query";
import { endpoints } from "./api";

/**
 * Settings this server stores but does not enforce, for one entity (`tenant_settings`,
 * `extension`, `trunk`). The API refuses changes to them; this only keeps the UI from offering
 * them. The list comes from the server, so wiring a field there re-enables its input here.
 *
 * While the list is loading (or if it fails) nothing is disabled or omitted - the API is the
 * boundary and answers with an explanation.
 */
export function useUnenforced(entity: string) {
  const { data } = useQuery({
    queryKey: ["capabilities"],
    queryFn: endpoints.capabilities,
    staleTime: Infinity,
  });
  const fields = data?.unenforced[entity] ?? {};

  return {
    stirSigning: data?.stirSigning ?? false,
    isUnenforced: (field: string) => field in fields,
    /** Spread onto an input after its own props: disables it and says why. */
    props: (field: string) => {
      const rule = fields[field];
      return rule
        ? { disabled: true, description: `Not enforced yet (${rule.issue}): ${rule.reason}.` }
        : {};
    },
    /** Drops unenforced fields from a payload so saving other fields is never refused. */
    omit: <T extends object>(payload: T): T =>
      Object.fromEntries(Object.entries(payload).filter(([key]) => !(key in fields))) as T,
  };
}
