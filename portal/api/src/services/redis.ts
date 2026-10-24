import { randomUUID } from "node:crypto";
import { RedisClient } from "bun";
import { env } from "../env";

export const redis = new RedisClient(env.redisUrl);

// Key shapes are contractual with resources/lua/xml_handler.lua. Changing one changes both.
export const keys = {
  warmSentinel: () => "qwixbox:warm",
  directory: (domain: string, user: string) => `qwixbox:dir:${domain}:${user}`,
  routes: (domain: string) => `qwixbox:routes:${domain}`,
  did: (domain: string, number: string) => `qwixbox:did:${domain}:${number}`,
  tenant: (domain: string) => `qwixbox:tenant:${domain}`,
  featureNumber: (domain: string, number: string) =>
    `qwixbox:num:${domain}:${number}`,
  extensionCall: (domain: string, number: string) =>
    `qwixbox:call:${domain}:${number}`,
  ringGroup: (domain: string, id: string) => `qwixbox:rg:${domain}:${id}`,
  ivr: (domain: string, id: string) => `qwixbox:ivr:${domain}:${id}`,
  timeCondition: (domain: string, id: string) => `qwixbox:tc:${domain}:${id}`,
  tenantPatterns: (domain: string) => [
    `qwixbox:dir:${domain}:*`,
    `qwixbox:did:${domain}:*`,
    `qwixbox:num:${domain}:*`,
    `qwixbox:call:${domain}:*`,
    `qwixbox:rg:${domain}:*`,
    `qwixbox:ivr:${domain}:*`,
    `qwixbox:tc:${domain}:*`,
    `qwixbox:routes:${domain}`,
    `qwixbox:tenant:${domain}`,
  ],
} as const;

export async function safeDelPattern(pattern: string): Promise<number> {
  let cursor = "0";
  let deleted = 0;
  try {
    do {
      const reply = (await redis.send("SCAN", [
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        "200",
      ])) as [string, string[]];
      cursor = reply[0];
      const batch = reply[1];
      if (batch.length > 0) {
        await redis.del(...batch);
        deleted += batch.length;
      }
    } while (cursor !== "0");
  } catch (err) {
    console.error(
      `[redis] scan-delete ${pattern} failed:`,
      (err as Error).message,
    );
    throw err;
  }
  return deleted;
}

export async function safeSet(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<boolean> {
  try {
    if (ttlSeconds) {
      await redis.set(key, value, "EX", ttlSeconds);
    } else {
      await redis.set(key, value);
    }
    return true;
  } catch (err) {
    console.error(`[redis] set ${key} failed:`, (err as Error).message);
    throw err;
  }
}

export async function safeDel(...keysToDelete: string[]): Promise<boolean> {
  if (keysToDelete.length === 0) return true;
  try {
    await redis.del(...keysToDelete);
    return true;
  } catch (err) {
    console.error(`[redis] del failed:`, (err as Error).message);
    throw err;
  }
}

const WARM_LOCK = "qwixbox:warm-lock";
const LOCK_TTL_MS = 30_000;

export async function claimWarm(): Promise<string | null> {
  if (await redis.get(keys.warmSentinel())) return null;
  const token = randomUUID();
  const result = await redis.send("SET", [
    WARM_LOCK,
    token,
    "NX",
    "PX",
    String(LOCK_TTL_MS),
  ]);
  return result === "OK" ? token : null;
}

export async function renewWarm(token: string): Promise<boolean> {
  return (
    Number(
      await redis.send("EVAL", [
        "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end",
        "1",
        WARM_LOCK,
        token,
        String(LOCK_TTL_MS),
      ]),
    ) === 1
  );
}

export async function finishWarm(
  token: string,
  success: boolean,
): Promise<boolean> {
  return (
    Number(
      await redis.send("EVAL", [
        "if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end; " +
          "if ARGV[2] == '1' then redis.call('SET',KEYS[2],ARGV[3]) end; redis.call('DEL',KEYS[1]); return 1",
        "2",
        WARM_LOCK,
        keys.warmSentinel(),
        token,
        success ? "1" : "0",
        new Date().toISOString(),
      ]),
    ) === 1
  );
}

export async function ping(): Promise<boolean> {
  try {
    return (await redis.send("PING", [])) === "PONG";
  } catch {
    return false;
  }
}
