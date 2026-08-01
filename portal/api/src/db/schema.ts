import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";

export * from "./auth-schema";

export const tenantTierEnum = pgEnum("tenant_tier", ["shared", "dedicated"]);

export const egressModeEnum = pgEnum("egress_mode", ["direct", "proxied"]);

export const attestationEnum = pgEnum("attestation", ["A", "B", "C"]);

export const trunkAuthModeEnum = pgEnum("trunk_auth_mode", ["ip", "register"]);

export const transportEnum = pgEnum("sip_transport", ["udp", "tcp", "tls"]);

export const destinationTypeEnum = pgEnum("destination_type", [
  "extension",
  "ring_group",
  "ivr",
  "voicemail",
  "time_condition",
  "queue",
  "fax",
  "external",
  "hangup",
]);

export const ringStrategyEnum = pgEnum("ring_strategy", [
  "simultaneous",
  "sequential",
  "random",
]);

export const recordingPolicyEnum = pgEnum("recording_policy", [
  "none",
  "inbound",
  "outbound",
  "all",
]);

export const callDirectionEnum = pgEnum("call_direction", [
  "inbound",
  "outbound",
  "internal",
]);

export const tenantSettings = pgTable(
  "tenant_settings",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),

    sipDomain: text("sip_domain").notNull(),

    tier: tenantTierEnum("tier").default("shared").notNull(),

    dispatcherSetId: integer("dispatcher_set_id").default(1).notNull(),

    egressMode: egressModeEnum("egress_mode").default("proxied").notNull(),

    stirShakenEnabled: boolean("stir_shaken_enabled").default(false).notNull(),
    stirShakenAttest: attestationEnum("stir_shaken_attest")
      .default("B")
      .notNull(),

    maxConcurrentCalls: integer("max_concurrent_calls").default(10).notNull(),

    recordingPolicy: recordingPolicyEnum("recording_policy")
      .default("none")
      .notNull(),
    timezone: text("timezone").default("Etc/UTC").notNull(),

    defaultCallerIdName: text("default_caller_id_name"),
    defaultCallerIdNumber: text("default_caller_id_number"),

    defaultRingTimeoutSec: integer("default_ring_timeout_sec")
      .default(25)
      .notNull(),

    emergencyNotifyEmail: text("emergency_notify_email"),
    emergencyNotifySms: text("emergency_notify_sms"),

    directoryCacheMs: integer("directory_cache_ms").default(300000).notNull(),

    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("tenant_settings_sip_domain_idx").on(table.sipDomain),
  ],
);

export const emergencyLocation = pgTable(
  "emergency_location",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    label: text("label").notNull(),
    street: text("street").notNull(),
    unit: text("unit"),
    city: text("city").notNull(),
    region: text("region").notNull(),
    postalCode: text("postal_code").notNull(),
    country: text("country").default("US").notNull(),

    callbackNumber: text("callback_number"),

    validatedAt: timestamp("validated_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("emergency_location_org_idx").on(table.organizationId)],
);

export const extension = pgTable(
  "extension",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    number: text("number").notNull(),
    displayName: text("display_name").notNull(),

    sipPasswordEnc: text("sip_password_enc").notNull(),

    voicemailEnabled: boolean("voicemail_enabled").default(true).notNull(),
    voicemailPinEnc: text("voicemail_pin_enc"),
    voicemailEmail: text("voicemail_email"),

    codecPrefs: text("codec_prefs"),

    callerIdName: text("caller_id_name"),
    callerIdNumber: text("caller_id_number"),

    maxConcurrentCalls: integer("max_concurrent_calls"),

    directoryCacheMs: integer("directory_cache_ms"),

    emergencyLocationId: text("emergency_location_id").references(
      () => emergencyLocation.id,
      { onDelete: "set null" },
    ),

    dnd: boolean("dnd").default(false).notNull(),

    forwardAllTo: text("forward_all_to"),
    forwardBusyTo: text("forward_busy_to"),
    forwardNoAnswerTo: text("forward_no_answer_to"),

    ringTimeoutSec: integer("ring_timeout_sec"),

    callWaitingEnabled: boolean("call_waiting_enabled").default(true).notNull(),

    deviceMac: text("device_mac"),

    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("extension_org_number_idx").on(
      table.organizationId,
      table.number,
    ),
    index("extension_org_idx").on(table.organizationId),
    index("extension_device_mac_idx").on(table.deviceMac),
  ],
);

export const trunk = pgTable(
  "trunk",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),

    name: text("name").notNull(),
    authMode: trunkAuthModeEnum("auth_mode").default("ip").notNull(),

    host: text("host").notNull(),
    port: integer("port").default(5060).notNull(),
    transport: transportEnum("transport").default("udp").notNull(),

    username: text("username"),
    passwordEnc: text("password_enc"),
    fromDomain: text("from_domain"),

    codecPrefs: text("codec_prefs"),

    priority: integer("priority").default(10).notNull(),

    carrierSigns: boolean("carrier_signs").default(false).notNull(),

    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("trunk_org_idx").on(table.organizationId)],
);

export const inboundRoute = pgTable(
  "inbound_route",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    didPattern: text("did_pattern").notNull(),
    description: text("description"),

    destinationType: destinationTypeEnum("destination_type").notNull(),
    destinationId: text("destination_id"),

    priority: integer("priority").default(10).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("inbound_route_org_idx").on(table.organizationId),
    index("inbound_route_did_idx").on(table.didPattern),
  ],
);

export const outboundRoute = pgTable(
  "outbound_route",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),

    name: text("name").notNull(),
    pattern: text("pattern").notNull(),

    trunkId: text("trunk_id").references(() => trunk.id, {
      onDelete: "cascade",
    }),

    stripDigits: integer("strip_digits").default(0).notNull(),
    prependDigits: text("prepend_digits"),

    callerIdOverride: text("caller_id_override"),

    priority: integer("priority").default(10).notNull(),

    isEmergency: boolean("is_emergency").default(false).notNull(),

    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("outbound_route_org_idx").on(table.organizationId),
    index("outbound_route_priority_idx").on(table.priority),
  ],
);

export const ringGroup = pgTable(
  "ring_group",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    number: text("number").notNull(),
    name: text("name").notNull(),
    strategy: ringStrategyEnum("strategy").default("simultaneous").notNull(),
    ringTimeoutSec: integer("ring_timeout_sec").default(30).notNull(),

    failoverType: destinationTypeEnum("failover_type"),
    failoverId: text("failover_id"),

    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("ring_group_org_number_idx").on(
      table.organizationId,
      table.number,
    ),
  ],
);

export const ringGroupMember = pgTable(
  "ring_group_member",
  {
    id: text("id").primaryKey(),
    ringGroupId: text("ring_group_id")
      .notNull()
      .references(() => ringGroup.id, { onDelete: "cascade" }),
    extensionId: text("extension_id")
      .notNull()
      .references(() => extension.id, { onDelete: "cascade" }),
    position: integer("position").default(0).notNull(),
    delaySec: integer("delay_sec").default(0).notNull(),
  },
  (table) => [
    uniqueIndex("ring_group_member_idx").on(
      table.ringGroupId,
      table.extensionId,
    ),
  ],
);

export const ivrMenu = pgTable(
  "ivr_menu",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    number: text("number").notNull(),
    name: text("name").notNull(),

    greetingSound: text("greeting_sound"),
    invalidSound: text("invalid_sound"),
    timeoutSec: integer("timeout_sec").default(5).notNull(),
    maxRetries: integer("max_retries").default(3).notNull(),

    timeoutType: destinationTypeEnum("timeout_type"),
    timeoutId: text("timeout_id"),

    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("ivr_menu_org_number_idx").on(
      table.organizationId,
      table.number,
    ),
  ],
);

export const ivrOption = pgTable(
  "ivr_option",
  {
    id: text("id").primaryKey(),
    ivrMenuId: text("ivr_menu_id")
      .notNull()
      .references(() => ivrMenu.id, { onDelete: "cascade" }),
    digit: text("digit").notNull(),
    destinationType: destinationTypeEnum("destination_type").notNull(),
    destinationId: text("destination_id"),
    description: text("description"),
  },
  (table) => [
    uniqueIndex("ivr_option_menu_digit_idx").on(table.ivrMenuId, table.digit),
  ],
);

export const timeCondition = pgTable(
  "time_condition",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    timezone: text("timezone").default("Etc/UTC").notNull(),

    rules: jsonb("rules").notNull(),

    matchType: destinationTypeEnum("match_type"),
    matchId: text("match_id"),
    noMatchType: destinationTypeEnum("no_match_type"),
    noMatchId: text("no_match_id"),

    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("time_condition_org_idx").on(table.organizationId)],
);

export const queue = pgTable(
  "queue",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    number: text("number").notNull(),
    name: text("name").notNull(),
    strategy: text("strategy").default("longest-idle-agent").notNull(),
    mohSound: text("moh_sound"),
    maxWaitSec: integer("max_wait_sec").default(300).notNull(),

    timeoutType: destinationTypeEnum("timeout_type"),
    timeoutId: text("timeout_id"),

    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("queue_org_number_idx").on(table.organizationId, table.number),
  ],
);

export const cdr = pgTable(
  "cdr",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    callUuid: text("call_uuid").notNull(),
    correlationId: text("correlation_id"),
    sipCallId: text("sip_call_id"),

    direction: callDirectionEnum("direction").notNull(),

    callerNumber: text("caller_number"),
    callerName: text("caller_name"),
    destinationNumber: text("destination_number").notNull(),

    extensionId: text("extension_id").references(() => extension.id, {
      onDelete: "set null",
    }),
    trunkId: text("trunk_id").references(() => trunk.id, {
      onDelete: "set null",
    }),

    startedAt: timestamp("started_at").notNull(),
    answeredAt: timestamp("answered_at"),
    endedAt: timestamp("ended_at"),
    durationSec: integer("duration_sec").default(0).notNull(),
    billsecSec: integer("billsec_sec").default(0).notNull(),

    hangupCause: text("hangup_cause"),
    recordingPath: text("recording_path"),

    attestation: text("attestation"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("cdr_org_started_idx").on(table.organizationId, table.startedAt),
    uniqueIndex("cdr_call_uuid_idx").on(table.callUuid),
    index("cdr_extension_idx").on(table.extensionId),
  ],
);

export const faxStatusEnum = pgEnum("fax_status", [
  "received",
  "failed",
  "delivered",
]);

export const fax = pgTable(
  "fax",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    didNumber: text("did_number").notNull(),
    callerNumber: text("caller_number"),
    callerName: text("caller_name"),

    deliverToEmail: text("deliver_to_email"),

    filePath: text("file_path"),
    pages: integer("pages").default(0).notNull(),
    status: faxStatusEnum("status").default("received").notNull(),
    failureReason: text("failure_reason"),

    callUuid: text("call_uuid"),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    deliveredAt: timestamp("delivered_at"),
  },
  (table) => [
    index("fax_org_received_idx").on(table.organizationId, table.receivedAt),
    index("fax_did_idx").on(table.didNumber),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),

    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),

    before: jsonb("before"),
    after: jsonb("after"),

    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
  ],
);

export const tenantSettingsRelations = relations(tenantSettings, ({ one }) => ({
  organization: one(organization, {
    fields: [tenantSettings.organizationId],
    references: [organization.id],
  }),
}));

export const extensionRelations = relations(extension, ({ one, many }) => ({
  organization: one(organization, {
    fields: [extension.organizationId],
    references: [organization.id],
  }),
  emergencyLocation: one(emergencyLocation, {
    fields: [extension.emergencyLocationId],
    references: [emergencyLocation.id],
  }),
  ringGroupMemberships: many(ringGroupMember),
}));

export const emergencyLocationRelations = relations(
  emergencyLocation,
  ({ many }) => ({
    extensions: many(extension),
  }),
);

export const trunkRelations = relations(trunk, ({ many }) => ({
  outboundRoutes: many(outboundRoute),
}));

export const outboundRouteRelations = relations(outboundRoute, ({ one }) => ({
  trunk: one(trunk, {
    fields: [outboundRoute.trunkId],
    references: [trunk.id],
  }),
}));

export const ringGroupRelations = relations(ringGroup, ({ many }) => ({
  members: many(ringGroupMember),
}));

export const ringGroupMemberRelations = relations(
  ringGroupMember,
  ({ one }) => ({
    ringGroup: one(ringGroup, {
      fields: [ringGroupMember.ringGroupId],
      references: [ringGroup.id],
    }),
    extension: one(extension, {
      fields: [ringGroupMember.extensionId],
      references: [extension.id],
    }),
  }),
);

export const ivrMenuRelations = relations(ivrMenu, ({ many }) => ({
  options: many(ivrOption),
}));

export const ivrOptionRelations = relations(ivrOption, ({ one }) => ({
  menu: one(ivrMenu, {
    fields: [ivrOption.ivrMenuId],
    references: [ivrMenu.id],
  }),
}));

export const cdrRelations = relations(cdr, ({ one }) => ({
  extension: one(extension, {
    fields: [cdr.extensionId],
    references: [extension.id],
  }),
  trunk: one(trunk, { fields: [cdr.trunkId], references: [trunk.id] }),
}));
