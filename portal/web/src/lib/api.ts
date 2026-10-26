const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiError extends Error {
  status: number;
  detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401 && !window.location.pathname.startsWith("/login")) {
    const back = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?redirect=${back}`;
    return new Promise<never>(() => {});
  }

  if (!res.ok) {
    let message = res.statusText;
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      message = body.error ?? message;
      detail = body.detail;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message, detail);
  }

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("Content-Type") ?? "";
  if (!contentType.includes("json")) {
    throw new ApiError(
      res.status,
      "The API did not answer",
      `${path} returned ${contentType || "an unknown content type"} instead of JSON. ` +
        `Check that nginx is proxying /api to the API service.`,
    );
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, "The API returned malformed JSON", path);
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/**
 * A preview screen's collection route returned 404: the server has no backend for the feature.
 * This used to be answered with seed fixtures, which presented invented records - E911 addresses
 * among them - as if the server held them. The local mock serves these routes itself, so mock
 * mode needs no client-side fallback either.
 */
export class FeatureUnavailableError extends ApiError {
  constructor(path: string) {
    super(
      404,
      "Not available on this server",
      `${path} is not implemented by this API. The screen is a preview of planned work.`,
    );
    this.name = "FeatureUnavailableError";
  }
}

/** True when a query failed because the server has no backend for the feature. */
export function isUnavailable(error: unknown): boolean {
  return error instanceof FeatureUnavailableError;
}

async function getPreview<T>(path: string): Promise<T> {
  try {
    return await api.get<T>(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw new FeatureUnavailableError(path);
    throw err;
  }
}

export type Extension = {
  id: string;
  organizationId: string;
  number: string;
  displayName: string;
  voicemailEnabled: boolean;
  voicemailEmail: string | null;
  callerIdName: string | null;
  callerIdNumber: string | null;
  codecPrefs: string | null;
  maxConcurrentCalls: number | null;
  deviceMac: string | null;
  dnd: boolean;
  forwardAllTo: string | null;
  forwardBusyTo: string | null;
  forwardNoAnswerTo: string | null;
  ringTimeoutSec: number | null;
  callWaitingEnabled: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  sipPassword?: string;
  voicemailPin?: string;
};

export type DestinationType =
  | "extension"
  | "ring_group"
  | "ivr"
  | "time_condition"
  | "queue"
  | "voicemail"
  | "fax"
  | "external"
  | "hangup";

export const DESTINATION_NEEDS_ROW: DestinationType[] = [
  "extension",
  "ring_group",
  "ivr",
  "time_condition",
  "queue",
];

export type Trunk = {
  id: string;
  organizationId: string | null;
  name: string;
  authMode: "ip" | "register";
  host: string;
  port: number | null;
  transport: string | null;
  username: string | null;
  fromDomain: string | null;
  codecPrefs: string | null;
  priority: number;
  carrierSigns: boolean;
  enabled: boolean;
};

export type InboundRoute = {
  id: string;
  didPattern: string;
  description: string | null;
  destinationType: DestinationType | null;
  destinationId: string | null;
  priority: number;
  enabled: boolean;
};

export type OutboundRoute = {
  id: string;
  name: string;
  pattern: string;
  trunkId: string | null;
  stripDigits: number | null;
  prependDigits: string | null;
  callerIdOverride: string | null;
  priority: number;
  isEmergency: boolean;
  enabled: boolean;
};

export type RingGroup = {
  id: string;
  number: string;
  name: string;
  strategy: "simultaneous" | "sequential";
  ringTimeoutSec: number;
  failoverType: DestinationType | null;
  failoverId: string | null;
  enabled: boolean;
};

export type RingGroupMember = {
  id: string;
  extensionId: string;
  number: string;
  displayName: string;
  position: number;
  delaySec: number;
};

export type IvrMenu = {
  id: string;
  number: string;
  name: string;
  greetingSound: string | null;
  invalidSound: string | null;
  timeoutSec: number;
  maxRetries: number;
  timeoutType: DestinationType | null;
  timeoutId: string | null;
  enabled: boolean;
};

export type IvrOption = {
  id: string;
  ivrMenuId: string;
  digit: string;
  destinationType: DestinationType;
  destinationId: string | null;
  description: string | null;
};

export type TimeConditionRule = {
  days?: number[];
  start?: string;
  end?: string;
  date?: string;
  invert?: boolean;
};

export type TimeCondition = {
  id: string;
  name: string;
  timezone: string;
  rules: TimeConditionRule[];
  matchType: DestinationType | null;
  matchId: string | null;
  noMatchType: DestinationType | null;
  noMatchId: string | null;
  enabled: boolean;
};

export type Cdr = {
  id: string;
  callUuid: string;
  direction: "inbound" | "outbound" | "internal";
  callerNumber: string | null;
  callerName: string | null;
  destinationNumber: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number;
  billsecSec: number;
  hangupCause: string | null;
  attestation: string | null;
  extensionNumber: string | null;
  extensionName: string | null;
  trunkName: string | null;
};

export type CdrPage = { rows: Cdr[]; total: number; limit: number; offset: number };

export type CdrSummary = {
  calls: number;
  answered: number;
  answerRate: number | null;
  inbound: number;
  outbound: number;
  internal: number;
  billableSec: number;
};

export type CdrFilters = {
  direction?: string;
  number?: string;
  extensionId?: string;
  answered?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type TenantSettings = {
  organizationId: string;
  sipDomain: string;
  tier: "shared" | "dedicated";
  dispatcherSetId: number;
  egressMode: "direct" | "proxied";
  stirShakenEnabled: boolean;
  maxConcurrentCalls: number;
  recordingPolicy: "none" | "inbound" | "outbound" | "all";
  timezone: string;
  defaultCallerIdName: string | null;
  defaultCallerIdNumber: string | null;
  faxNotifyEmail?: string | null;
  emergencyNotifyEmail?: string | null;
  emergencyNotifySms?: string | null;
  enabled: boolean;
};

export type TenantUpdate = {
  maxConcurrentCalls?: number;
  timezone?: string;
  defaultCallerIdName?: string | null;
  defaultCallerIdNumber?: string | null;
  faxNotifyEmail?: string | null;
  recordingPolicy?: TenantSettings["recordingPolicy"];
  stirShakenEnabled?: boolean;
  enabled?: boolean;
  dispatcherSetId?: number;
};

export type TenantProvision = {
  sipDomain: string;
  tier?: "shared" | "dedicated";
  timezone?: string;
  maxConcurrentCalls?: number;
  defaultCallerIdName?: string;
  defaultCallerIdNumber?: string;
};

export type Fax = {
  id: string;
  organizationId: string;
  didNumber: string;
  callerNumber: string | null;
  callerName: string | null;
  deliverToEmail: string | null;
  pages: number;
  status: "received" | "failed" | "delivered";
  failureReason: string | null;
  callUuid: string | null;
  receivedAt: string;
  deliveredAt: string | null;
  onDisk: boolean;
};

export type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  userId: string | null;
  userEmail: string | null;
  ipAddress: string | null;
  createdAt: string;
};

export type AuditPage = { rows: AuditEntry[]; total: number; limit: number; offset: number };

export type AuditFilters = {
  entityType?: string;
  action?: string;
  userId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type Health = {
  status: "ok" | "degraded";
  database: boolean;
  redis: boolean;
  freeswitch: boolean;
  projections?: { pending: number; failing: number } | null;
};

/** Saved changes not yet live in Redis/Kamailio; see portal/api/src/services/projections.ts. */
export type ProjectionStatus = {
  pending: number;
  failing: number;
  oldestPendingSeconds: number | null;
  jobs: {
    kind: string;
    target: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
    nextAttemptAt: string;
  }[];
};

// Roadmap / Mock-backed Feature Types
export type VoicemailItem = {
  id: string;
  callerName: string;
  callerNumber: string;
  extensionNumber: string;
  location?: string;
  receivedAt: string;
  timeLabel: string;
  durationSec: number;
  durationLabel: string;
  unread: boolean;
  transcript: string;
};

export type CallRecordingItem = {
  id: string;
  callUuid: string;
  callerName: string;
  callerNumber: string;
  destinationNumber: string;
  direction: "inbound" | "outbound" | "internal";
  extensionNumber: string;
  durationSec: number;
  recordedAt: string;
  policy: string;
  sizeKb: number;
  encrypted: boolean;
  retentionDaysLeft: number;
};

export type SmsChatBubble = {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  time: string;
  status?: string;
};

export type SmsThread = {
  id: string;
  contactName: string;
  initials: string;
  phoneNumber: string;
  localDid: string;
  unread: boolean;
  updatedAtLabel: string;
  preview: string;
  messages: SmsChatBubble[];
};

export type SmsOptOut = {
  id: string;
  phoneNumber: string;
  reason: string;
  createdAt: string;
};

export type ContactItem = {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  phone: string;
  extension: string | null;
  email: string | null;
  notes: string | null;
};

export type CallQueueItem = {
  id: string;
  number: string;
  name: string;
  strategy: string;
  mohSound: string | null;
  maxWaitSec: number;
  timeoutType: DestinationType | null;
  timeoutId: string | null;
  waitingCount: number;
  activeCalls: number;
  slaPercent: number;
  avgWaitSec: number;
  abandonedToday: number;
  answeredToday: number;
  enabled: boolean;
};

export type QueueAgentItem = {
  id: string;
  name: string;
  extensionNumber: string;
  queueName: string;
  state: "Available" | "On Call" | "Wrap-up" | "Break";
  skillLevel: number;
  tierPosition: number;
  callsHandled: number;
  avgTalkSec: number;
};

export type EmergencyLocationItem = {
  id: string;
  label: string;
  street: string;
  unit: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  callbackNumber: string | null;
  validatedAt: string | null;
  assignedExtensions?: string[];
};

export type ConferenceRoomItem = {
  id: string;
  number: string;
  name: string;
  description: string | null;
  moderatorPin: string | null;
  participantPin: string | null;
  recordConference: boolean;
  activeParticipants: number;
  enabled: boolean;
};

export type ParkingLotItem = {
  id: string;
  name: string;
  lotExtension: string;
  slotStart: string;
  slotEnd: string;
  timeoutSeconds: number;
  timeoutDestinationType: string;
  timeoutDestinationData: string;
  musicOnHoldClass: string;
  parkedCalls: number;
  enabled: boolean;
};

export type MusicOnHoldItem = {
  id: string;
  name: string;
  path: string;
  rate: number;
  shuffle: boolean;
  channels: number;
};

export type DeviceItem = {
  id: string;
  deviceLabel: string;
  deviceType: string;
  extensionNumber: string;
  sipUsername: string;
  macAddress: string | null;
  transport: string;
  ipAddress: string;
  status: "Registered" | "Offline" | "Provisioning";
  lastSeenAt: string;
  enabled: boolean;
};

/** Settings the server stores but does not enforce; see portal/api/src/lib/capabilities.ts. */
export type Capabilities = {
  unenforced: Record<string, Record<string, { inert: unknown; issue: string; reason: string }>>;
  stirSigning: boolean;
};

export const endpoints = {
  capabilities: () => api.get<Capabilities>("/capabilities"),
  health: () => api.get<Health>("/../health"),
  tenant: () => api.get<TenantSettings>("/tenant"),
  updateTenant: (body: TenantUpdate) => api.patch<TenantSettings>("/tenant", body),
  provisionTenant: (body: TenantProvision) =>
    api.post<TenantSettings & { error?: string; detail?: string; tenant?: TenantSettings }>(
      "/tenant",
      body,
    ),
  rebuildCache: () => api.post<{ status: string }>("/tenant/rebuild-cache"),
  projections: () => api.get<ProjectionStatus>("/tenant/projections"),
  addMember: (body: { email: string; role?: string }) =>
    api.post<{ id: string; userId: string; email: string; role: string; status: string }>(
      "/tenant/members",
      body,
    ),

  extensions: () => api.get<Extension[]>("/extensions"),
  extension: (id: string) => api.get<Extension>(`/extensions/${id}`),
  createExtension: (body: Partial<Extension> & { number: string; displayName: string }) =>
    api.post<Extension>("/extensions", body),
  updateExtension: (
    id: string,
    body: Partial<Extension> & { sipPassword?: string; voicemailPin?: string },
  ) => api.patch<Extension>(`/extensions/${id}`, body),
  deleteExtension: (id: string) => api.delete<void>(`/extensions/${id}`),

  trunks: () => api.get<Trunk[]>("/trunks"),
  createTrunk: (body: Partial<Trunk>) => api.post<Trunk>("/trunks", body),
  updateTrunk: (id: string, body: Partial<Trunk>) => api.patch<Trunk>(`/trunks/${id}`, body),
  deleteTrunk: (id: string) => api.delete<void>(`/trunks/${id}`),
  setTrunkPassword: (id: string, password: string) =>
    api.put<void>(`/trunks/${id}/password`, { password }),

  inboundRoutes: () => api.get<InboundRoute[]>("/inbound-routes"),
  createInboundRoute: (body: Partial<InboundRoute>) =>
    api.post<InboundRoute>("/inbound-routes", body),
  updateInboundRoute: (id: string, body: Partial<InboundRoute>) =>
    api.patch<InboundRoute>(`/inbound-routes/${id}`, body),
  deleteInboundRoute: (id: string) => api.delete<void>(`/inbound-routes/${id}`),

  outboundRoutes: () => api.get<OutboundRoute[]>("/outbound-routes"),
  createOutboundRoute: (body: Partial<OutboundRoute>) =>
    api.post<OutboundRoute>("/outbound-routes", body),
  updateOutboundRoute: (id: string, body: Partial<OutboundRoute>) =>
    api.patch<OutboundRoute>(`/outbound-routes/${id}`, body),
  deleteOutboundRoute: (id: string) => api.delete<void>(`/outbound-routes/${id}`),

  ringGroups: () => api.get<RingGroup[]>("/ring-groups"),
  createRingGroup: (body: Partial<RingGroup>) => api.post<RingGroup>("/ring-groups", body),
  updateRingGroup: (id: string, body: Partial<RingGroup>) =>
    api.patch<RingGroup>(`/ring-groups/${id}`, body),
  deleteRingGroup: (id: string) => api.delete<void>(`/ring-groups/${id}`),
  ringGroupMembers: (id: string) => api.get<RingGroupMember[]>(`/ring-groups/${id}/members`),
  addRingGroupMember: (id: string, body: { extensionId: string; delaySec?: number }) =>
    api.post<RingGroupMember>(`/ring-groups/${id}/members`, body),
  removeRingGroupMember: (groupId: string, memberId: string) =>
    api.delete<void>(`/ring-groups/${groupId}/members/${memberId}`),

  ivrMenus: () => api.get<IvrMenu[]>("/ivr-menus"),
  createIvrMenu: (body: Partial<IvrMenu>) => api.post<IvrMenu>("/ivr-menus", body),
  updateIvrMenu: (id: string, body: Partial<IvrMenu>) =>
    api.patch<IvrMenu>(`/ivr-menus/${id}`, body),
  deleteIvrMenu: (id: string) => api.delete<void>(`/ivr-menus/${id}`),
  ivrOptions: (id: string) => api.get<IvrOption[]>(`/ivr-menus/${id}/options`),
  setIvrOption: (
    id: string,
    digit: string,
    body: { destinationType: DestinationType; destinationId?: string | null; description?: string },
  ) => api.put<IvrOption>(`/ivr-menus/${id}/options/${encodeURIComponent(digit)}`, body),
  deleteIvrOption: (id: string, digit: string) =>
    api.delete<void>(`/ivr-menus/${id}/options/${encodeURIComponent(digit)}`),

  timeConditions: () => api.get<TimeCondition[]>("/time-conditions"),
  createTimeCondition: (body: Partial<TimeCondition>) =>
    api.post<TimeCondition>("/time-conditions", body),
  updateTimeCondition: (id: string, body: Partial<TimeCondition>) =>
    api.patch<TimeCondition>(`/time-conditions/${id}`, body),
  deleteTimeCondition: (id: string) => api.delete<void>(`/time-conditions/${id}`),

  faxes: () => api.get<Fax[]>("/faxes"),

  audit: (filters: AuditFilters = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    }
    const qs = q.toString();
    return api.get<AuditPage>(`/audit${qs ? `?${qs}` : ""}`);
  },

  cdr: (filters: CdrFilters = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    }
    const qs = q.toString();
    return api.get<CdrPage>(`/cdr${qs ? `?${qs}` : ""}`);
  },
  cdrSummary: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const qs = q.toString();
    return api.get<CdrSummary>(`/cdr/summary${qs ? `?${qs}` : ""}`);
  },
  cdrExportUrl: (filters: CdrFilters = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== "" && k !== "limit" && k !== "offset") {
        q.set(k, String(v));
      }
    }
    const qs = q.toString();
    return `${BASE}/cdr/export${qs ? `?${qs}` : ""}`;
  },

  // Preview screens: no live API route yet, so production reports FeatureUnavailableError.
  voicemails: () => getPreview<VoicemailItem[]>("/voicemails"),
  deleteVoicemail: (id: string) => api.delete<void>(`/voicemails/${id}`),
  markVoicemailRead: (id: string) => api.patch<VoicemailItem>(`/voicemails/${id}`, { unread: false }),

  recordings: () => getPreview<CallRecordingItem[]>("/recordings"),
  deleteRecording: (id: string) => api.delete<void>(`/recordings/${id}`),

  smsThreads: () => getPreview<SmsThread[]>("/sms-threads"),
  sendSmsMessage: (threadId: string, text: string) =>
    api.post<SmsThread>(`/sms-threads/${threadId}/messages`, { text }),
  createSmsThread: (body: Partial<SmsThread>) => api.post<SmsThread>("/sms-threads", body),

  smsOptOuts: () => getPreview<SmsOptOut[]>("/sms-opt-outs"),
  createSmsOptOut: (body: { phoneNumber: string; reason: string }) =>
    api.post<SmsOptOut>("/sms-opt-outs", body),
  deleteSmsOptOut: (id: string) => api.delete<void>(`/sms-opt-outs/${id}`),

  contacts: () => getPreview<ContactItem[]>("/contacts"),
  createContact: (body: Partial<ContactItem>) => api.post<ContactItem>("/contacts", body),
  updateContact: (id: string, body: Partial<ContactItem>) =>
    api.patch<ContactItem>(`/contacts/${id}`, body),
  deleteContact: (id: string) => api.delete<void>(`/contacts/${id}`),

  queues: () => getPreview<CallQueueItem[]>("/queues"),
  createQueue: (body: Partial<CallQueueItem>) => api.post<CallQueueItem>("/queues", body),
  updateQueue: (id: string, body: Partial<CallQueueItem>) =>
    api.patch<CallQueueItem>(`/queues/${id}`, body),
  deleteQueue: (id: string) => api.delete<void>(`/queues/${id}`),

  queueAgents: () => getPreview<QueueAgentItem[]>("/queue-agents"),
  updateQueueAgent: (id: string, body: Partial<QueueAgentItem>) =>
    api.patch<QueueAgentItem>(`/queue-agents/${id}`, body),

  emergencyLocations: () =>
    getPreview<EmergencyLocationItem[]>("/emergency-locations"),
  createEmergencyLocation: (body: Partial<EmergencyLocationItem>) =>
    api.post<EmergencyLocationItem>("/emergency-locations", body),
  updateEmergencyLocation: (id: string, body: Partial<EmergencyLocationItem>) =>
    api.patch<EmergencyLocationItem>(`/emergency-locations/${id}`, body),
  deleteEmergencyLocation: (id: string) => api.delete<void>(`/emergency-locations/${id}`),

  conferences: () => getPreview<ConferenceRoomItem[]>("/conferences"),
  createConference: (body: Partial<ConferenceRoomItem>) =>
    api.post<ConferenceRoomItem>("/conferences", body),
  updateConference: (id: string, body: Partial<ConferenceRoomItem>) =>
    api.patch<ConferenceRoomItem>(`/conferences/${id}`, body),
  deleteConference: (id: string) => api.delete<void>(`/conferences/${id}`),

  parkingLots: () => getPreview<ParkingLotItem[]>("/parking-lots"),
  createParkingLot: (body: Partial<ParkingLotItem>) =>
    api.post<ParkingLotItem>("/parking-lots", body),
  updateParkingLot: (id: string, body: Partial<ParkingLotItem>) =>
    api.patch<ParkingLotItem>(`/parking-lots/${id}`, body),

  musicOnHold: () => getPreview<MusicOnHoldItem[]>("/music-on-hold"),
  createMusicOnHold: (body: Partial<MusicOnHoldItem>) =>
    api.post<MusicOnHoldItem>("/music-on-hold", body),
  deleteMusicOnHold: (id: string) => api.delete<void>(`/music-on-hold/${id}`),

  devices: () => getPreview<DeviceItem[]>("/devices"),
  createDevice: (body: Partial<DeviceItem>) => api.post<DeviceItem>("/devices", body),
  updateDevice: (id: string, body: Partial<DeviceItem>) =>
    api.patch<DeviceItem>(`/devices/${id}`, body),
  deleteDevice: (id: string) => api.delete<void>(`/devices/${id}`),
};
