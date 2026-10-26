function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `The installer writes these to ${process.env.API_DIR ?? "/opt/qwixbox-api"}/.env; ` +
        `for local work create portal/api/.env.`,
    );
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  isProduction: optional("NODE_ENV", "development") === "production",

  host: optional("HOST", "127.0.0.1"),
  port: Number(optional("PORT", "3000")),

  databaseUrl: required("DATABASE_URL"),
  redisUrl: optional("REDIS_URL", "redis://127.0.0.1:6379"),

  fsEslHost: optional("FS_ESL_HOST", "127.0.0.1"),
  fsEslPort: Number(optional("FS_ESL_PORT", "8021")),
  fsEslPassword: optional("FS_ESL_PASSWORD", ""),

  pbxFqdn: optional("PBX_FQDN", "localhost"),
  pbxSipDomain: optional("PBX_SIP_DOMAIN", "localhost"),

  kamEgress: optional("KAM_EGRESS", "127.0.0.1:5070"),

  // Set by 41-api-deploy.sh only when Kamailio has the stirshaken module and a signing key.
  // Without it the per-tenant signing toggle would set a header nothing reads.
  stirSigning: optional("STIR_SIGNING", "0") === "1",

  encryptionKey: required("ENCRYPTION_KEY"),
  authSecret: required("AUTH_SECRET"),

  kamailioDatabaseUrl: optional("KAMAILIO_DATABASE_URL", ""),

  mailFrom: optional("SMTP_FROM", `pbx@${optional("PBX_FQDN", "localhost")}`),
  mailFromName: optional("MAIL_FROM_NAME", "Phone System"),
  mailReplyTo: optional("MAIL_REPLY_TO", ""),
} as const;

export type Env = typeof env;
