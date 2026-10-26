import { afterAll, beforeEach, expect, test } from "bun:test";

// Real Redis, because atomicity cannot be shown against a mock. Use a disposable instance:
// this test deletes keys under the qwixbox:*:pub*.test namespaces it creates.
if (!process.env.TEST_REDIS_URL) throw new Error("TEST_REDIS_URL required");
process.env.REDIS_URL = process.env.TEST_REDIS_URL;
process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/unused";
process.env.ENCRYPTION_KEY ??= "review-fixture-key";
process.env.AUTH_SECRET ??= "review-fixture-auth-secret-at-least-32-characters";
const { redis, keys, publishGeneration } =
  await import("../src/services/redis");

const domain = "pub.test";
// A neighbour whose name starts with this one: a trailing-wildcard purge would hit it.
const neighbour = "pub.testing";

function generation(version: number, extensions: number): Map<string, string> {
  const gen = new Map<string, string>();
  gen.set(keys.tenant(domain), JSON.stringify({ version }));
  gen.set(keys.routes(domain), JSON.stringify({ version }));
  for (let i = 0; i < extensions; i++)
    gen.set(keys.directory(domain, String(100 + i)), `<user v="${version}"/>`);
  return gen;
}

async function purge(): Promise<void> {
  for (const d of [domain, neighbour])
    for (const pattern of keys.tenantPatterns(d)) {
      const found = (await redis.send("KEYS", [pattern])) as string[];
      if (found.length) await redis.del(...found);
    }
}

beforeEach(purge);
afterAll(purge);

// Reads like xml_handler.lua does during call setup: the tenant key, then a directory entry.
async function watch(
  stop: () => boolean,
): Promise<{ reads: number; misses: number; mixed: number }> {
  let reads = 0;
  let misses = 0;
  let mixed = 0;
  while (!stop()) {
    const [tenant, user] = (await redis.send("MGET", [
      keys.tenant(domain),
      keys.directory(domain, "100"),
    ])) as [string | null, string | null];
    reads++;
    if (!tenant || !user) misses++;
    else if (!user.includes(`v="${JSON.parse(tenant).version}"`)) mixed++;
  }
  return { reads, misses, mixed };
}

test("baseline: delete-then-repopulate exposes a missing tenant to readers", async () => {
  await publishGeneration([], [], generation(0, 200));
  let done = false;
  const reader = watch(() => done);
  for (let version = 1; version <= 20; version++) {
    for (const pattern of keys.tenantPatterns(domain)) {
      const found = (await redis.send("KEYS", [pattern])) as string[];
      if (found.length) await redis.del(...found);
    }
    for (const [key, value] of generation(version, 200))
      await redis.set(key, value);
  }
  done = true;
  const seen = await reader;
  // The hazard this test file exists to rule out is real in this harness.
  expect(seen.misses).toBeGreaterThan(0);
});

test("publishGeneration never exposes a missing or mixed tenant", async () => {
  await publishGeneration(keys.tenantPatterns(domain), [], generation(0, 200));
  let done = false;
  const reader = watch(() => done);
  for (let version = 1; version <= 200; version++)
    await publishGeneration(
      keys.tenantPatterns(domain),
      [],
      generation(version, 200),
    );
  done = true;
  const seen = await reader;
  expect(seen.reads).toBeGreaterThan(100);
  expect(seen.misses).toBe(0);
  expect(seen.mixed).toBe(0);
});

test("stale keys go in the same step; a neighbouring domain is untouched", async () => {
  await redis.set(keys.directory(neighbour, "100"), "neighbour");
  await publishGeneration(keys.tenantPatterns(domain), [], generation(1, 3));
  expect(await redis.get(keys.directory(domain, "102"))).toBe('<user v="1"/>');
  await publishGeneration(keys.tenantPatterns(domain), [], generation(2, 1));
  expect(await redis.get(keys.directory(domain, "102"))).toBeNull();
  expect(await redis.get(keys.directory(domain, "100"))).toBe('<user v="2"/>');
  expect(await redis.get(keys.directory(neighbour, "100"))).toBe("neighbour");
  // An exact-key publication with no entries removes exactly those keys.
  await publishGeneration([], [keys.directory(domain, "100")], new Map());
  expect(await redis.get(keys.directory(domain, "100"))).toBeNull();
  expect(await redis.get(keys.tenant(domain))).not.toBeNull();
});
