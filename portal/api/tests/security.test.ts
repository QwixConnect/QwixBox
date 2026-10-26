import { beforeEach, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";

// Run only against a disposable database: TEST_DATABASE_URL is deliberately required.
if (!process.env.TEST_DATABASE_URL)
  throw new Error("TEST_DATABASE_URL required");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.KAMAILIO_DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.ENCRYPTION_KEY = "review-fixture-key";
process.env.AUTH_SECRET = "review-fixture-auth-secret-at-least-32-characters";
const { db, pool } = await import("../src/db");
const schema = await import("../src/db/schema");
const { auth } = await import("../src/auth");
const { Hono } = await import("hono");
const cache = await import("../src/services/cache");
const redis = await import("../src/services/redis");
const { esl } = await import("../src/services/esl");
const memory = new Map<string, string>();
spyOn(redis, "safeSet").mockImplementation(async (key, value) => {
  memory.set(key, value);
  return true;
});
spyOn(redis, "safeDel").mockImplementation(async (...keys) => {
  keys.forEach((k) => memory.delete(k));
  return true;
});
spyOn(redis, "safeDelPattern").mockImplementation(async (pattern) => {
  let n = 0;
  for (const key of memory.keys())
    if (
      pattern.endsWith("*")
        ? key.startsWith(pattern.slice(0, -1))
        : key === pattern
    ) {
      memory.delete(key);
      n++;
    }
  return n;
});
// Same contract as the real script (tests/cache-publish.test.ts proves atomicity on Redis):
// set the entries, delete matching keys the generation does not contain.
spyOn(redis, "publishGeneration").mockImplementation(
  async (patterns, exact, entries) => {
    const matches = (key: string) =>
      patterns.some((pattern) =>
        pattern.endsWith("*")
          ? key.startsWith(pattern.slice(0, -1))
          : key === pattern,
      );
    for (const key of [...memory.keys(), ...exact])
      if ((matches(key) || exact.includes(key)) && !entries.has(key))
        memory.delete(key);
    for (const [key, value] of entries) memory.set(key, value);
  },
);
spyOn(esl, "flushXmlCache").mockResolvedValue(true);
spyOn(auth.api, "getSession").mockImplementation(
  async ({ headers }: any) =>
    ({
      user: { id: headers.get("test-user") ?? "owner" },
      session: { activeOrganizationId: headers.get("test-org") ?? "a" },
    }) as any,
);
const { tenants } = await import("../src/routes/tenants");
const { extensions } = await import("../src/routes/extensions");
const { app } = await import("../src/app");

async function request(
  path: string,
  body: unknown,
  user = "owner",
  method = "POST",
  org = "a",
) {
  return app.request(`/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "test-user": user,
      "test-org": org,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await pool.query('TRUNCATE "organization", "user" CASCADE');
  await pool.query(
    "CREATE TABLE IF NOT EXISTS subscriber (username text, domain text, password text, ha1 text, ha1b text, UNIQUE(username,domain)); CREATE TABLE IF NOT EXISTS location (username text, domain text); CREATE TABLE IF NOT EXISTS emergency_pattern (id serial PRIMARY KEY, key_name text, key_type int, value_type int, key_value text, expires int DEFAULT 0, organization_id text); TRUNCATE subscriber, location, emergency_pattern",
  );
  memory.clear();
  for (const id of ["a", "b"])
    await db
      .insert(schema.organization)
      .values({ id, name: id, slug: id, createdAt: new Date() });
  for (const id of ["owner", "admin", "viewer", "other"])
    await db
      .insert(schema.user)
      .values({ id, name: id, email: `${id}@test.invalid` });
  for (const role of ["owner", "admin", "viewer"])
    await db.insert(schema.member).values({
      id: role,
      userId: role,
      organizationId: "a",
      role,
      createdAt: new Date(),
    });
  await db
    .insert(schema.tenantSettings)
    .values({ organizationId: "a", sipDomain: "a.test" });
  await db
    .insert(schema.tenantSettings)
    .values({ organizationId: "b", sipDomain: "b.test" });
});

test("POST cannot rename a provisioned SIP domain", async () => {
  const res = await request("/tenant", { sipDomain: "changed.test" });
  expect(res.status).toBe(409);
  expect(
    (await db.query.tenantSettings.findMany()).map((t) => t.sipDomain),
  ).toContain("a.test");
});
test("tenant creation and PATCH reject unsafe settings before persistence", async () => {
  await pool.query("DELETE FROM tenant_settings WHERE organization_id='a'");
  for (const value of ["${system(example)}", "123\n456"]) {
    expect(
      (
        await request("/tenant", {
          sipDomain: "a.test",
          defaultCallerIdNumber: value,
        })
      ).status,
    ).toBe(400);
  }
  for (const body of [
    { maxConcurrentCalls: -1 },
    { maxConcurrentCalls: 1.5 },
    { timezone: "Not/AZone" },
    { defaultCallerIdName: {} },
  ]) {
    expect(
      (await request("/tenant", { sipDomain: "a.test", ...body })).status,
    ).toBe(400);
    expect((await request("/tenant", body, "owner", "PATCH")).status).toBe(400);
  }
  expect(
    await db.query.tenantSettings.findFirst({
      where: (t, { eq }) => eq(t.organizationId, "a"),
    }),
  ).toBeUndefined();
});
test("tenant signing setting reaches the warm cache", async () => {
  await pool.query(
    "UPDATE tenant_settings SET stir_shaken_enabled=true WHERE organization_id='a'",
  );
  await cache.cacheTenantSettings("a");
  expect(
    JSON.parse(memory.get("qwixbox:tenant:a.test")!).stirShakenEnabled,
  ).toBe(true);
});
test("provisioning repeats preserve settings and refuse a domain rename", async () => {
  const { provisionTenant } = await import("../src/services/provisioning");
  const input = {
    name: "A",
    slug: "a",
    domain: "a.test",
    ownerEmail: "owner@test.invalid",
    tier: "shared" as const,
    maxCalls: 99,
  };
  expect((await provisionTenant(input)).existing).toBe(true);
  expect(
    (
      await db.query.tenantSettings.findFirst({
        where: (t, { eq }) => eq(t.organizationId, "a"),
      })
    )?.maxConcurrentCalls,
  ).toBe(10);
  await expect(
    provisionTenant({ ...input, domain: "renamed.test" }),
  ).rejects.toThrow();
  await expect(
    provisionTenant({ ...input, slug: "different" }),
  ).rejects.toThrow();
  expect(await db.query.organization.findMany()).toHaveLength(2);
});
test("admin cannot promote itself to owner", async () => {
  expect(
    (
      await request(
        "/tenant/members",
        { email: "admin@test.invalid", role: "owner" },
        "admin",
      )
    ).status,
  ).toBe(403);
});
test("last owner cannot be demoted through add/update", async () => {
  expect(
    (
      await request("/tenant/members", {
        email: "owner@test.invalid",
        role: "viewer",
      })
    ).status,
  ).toBe(409);
});
test("viewer cannot write another tenant's telephony or memberships", async () => {
  expect(
    (
      await request(
        "/tenant/members",
        { email: "other@test.invalid" },
        "viewer",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/extensions",
        { number: "101", displayName: "X" },
        "viewer",
      )
    ).status,
  ).toBe(403);
});
test("disable removes subscriber and location; enable restores subscriber and ring groups", async () => {
  const created = await request("/extensions", {
    number: "101",
    displayName: "X",
  });
  const ext = (await created.json()) as any;
  expect(created.status).toBe(201);
  await pool.query("INSERT INTO location VALUES ('101','a.test')");
  await db
    .insert(schema.ringGroup)
    .values({ id: "rg", organizationId: "a", number: "600", name: "Sales" });
  await db
    .insert(schema.ringGroupMember)
    .values({ id: "rgm", ringGroupId: "rg", extensionId: ext.id });
  await cache.cacheCallFlows("a");
  expect(
    (
      await request(
        `/extensions/${ext.id}`,
        { enabled: false },
        "owner",
        "PATCH",
      )
    ).status,
  ).toBe(200);
  expect((await pool.query("SELECT * FROM subscriber")).rowCount).toBe(0);
  expect((await pool.query("SELECT * FROM location")).rowCount).toBe(0);
  expect(JSON.parse(memory.get("qwixbox:rg:a.test:rg")!).members).toEqual([]);
  expect(
    (
      await request(
        `/extensions/${ext.id}`,
        { enabled: true },
        "owner",
        "PATCH",
      )
    ).status,
  ).toBe(200);
  expect((await pool.query("SELECT * FROM subscriber")).rowCount).toBe(1);
  expect(JSON.parse(memory.get("qwixbox:rg:a.test:rg")!).members).toHaveLength(
    1,
  );
});
test("invalid extension numbers and weak passwords are rejected", async () => {
  expect(
    (
      await request("/extensions", {
        number: "101\nreloadxml",
        displayName: "X",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await request("/extensions", {
        number: "101",
        displayName: "X",
        sipPassword: "short",
      })
    ).status,
  ).toBe(400);
});
test("removing a DID removes its cached mapping without a manual flush", async () => {
  await db.insert(schema.inboundRoute).values({
    id: "did",
    organizationId: "a",
    didPattern: "+14165551234",
    destinationType: "hangup",
  });
  await cache.cacheInboundRoutes("a");
  expect(memory.has("qwixbox:did:a.test:+14165551234")).toBe(true);
  await pool.query("DELETE FROM inbound_route WHERE id='did'");
  await cache.cacheInboundRoutes("a");
  expect(memory.has("qwixbox:did:a.test:+14165551234")).toBe(false);
});

test("concurrent owner demotions leave an owner", async () => {
  await db.insert(schema.member).values({
    id: "other",
    userId: "other",
    organizationId: "a",
    role: "owner",
    createdAt: new Date(),
  });
  const replies = await Promise.all([
    request("/tenant/members/owner", { role: "viewer" }, "owner", "PATCH"),
    request("/tenant/members/other", { role: "viewer" }, "other", "PATCH"),
  ]);
  expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (
      await pool.query(
        "SELECT * FROM member WHERE organization_id='a' AND role='owner'",
      )
    ).rowCount,
  ).toBe(1);
});

test("membership plugin mutation paths cannot bypass the serialized service", async () => {
  for (const path of [
    "update-member-role",
    "remove-member",
    "leave",
    "accept-invitation",
    "invite-member",
  ]) {
    const res = await auth.handler(
      new Request(`https://localhost/api/auth/organization/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: "owner",
          role: "viewer",
          organizationId: "a",
        }),
      }),
    );
    expect(res.status).toBe(403);
  }
});

test("trunk trust replacement is atomic and disables remove old trust", async () => {
  const { syncTrunkAddress, removeTrunkAddress } =
    await import("../src/services/kamailio-sync");
  await pool.query(
    "CREATE TABLE IF NOT EXISTS address (grp int, ip_addr text, mask int, port int, tag text); TRUNCATE address",
  );
  const row = {
    id: "trunk",
    host: "192.0.2.1",
    port: 5060,
    authMode: "ip",
    enabled: true,
  } as any;
  await syncTrunkAddress(row);
  await syncTrunkAddress({ ...row, host: "2001:db8::1" });
  expect((await pool.query("SELECT ip_addr, mask FROM address")).rows).toEqual([
    { ip_addr: "2001:db8::1", mask: 128 },
  ]);
  await expect(syncTrunkAddress({ ...row, host: "invalid" })).rejects.toThrow();
  expect(
    (await pool.query("SELECT ip_addr FROM address")).rows[0].ip_addr,
  ).toBe("2001:db8::1");
  await syncTrunkAddress({ ...row, enabled: false });
  expect((await pool.query("SELECT * FROM address")).rowCount).toBe(0);
  await syncTrunkAddress(row);
  await syncTrunkAddress({ ...row, authMode: "register" });
  expect((await pool.query("SELECT * FROM address")).rowCount).toBe(0);
  await syncTrunkAddress(row);
  await removeTrunkAddress(row.id);
  expect((await pool.query("SELECT * FROM address")).rowCount).toBe(0);
});

test("fallback peers are DID-only and duplicate ownership is prevented by the database", async () => {
  const { handleDialplan } = await import("../src/routes/fs-xml");
  const form = {
    "variable_sip_h_X-Trusted-Peer": "1",
    "variable_sip_h_X-Tenant-Domain": "a.test",
    "variable_sip_h_X-Auth-User": "101",
    "Caller-Destination-Number": "*78",
  };
  expect(await handleDialplan(form)).not.toContain("feature_code.lua");
  await db.insert(schema.inboundRoute).values({
    id: "did",
    organizationId: "b",
    didPattern: "+14165551234",
    destinationType: "hangup",
  });
  const xml = await handleDialplan({
    ...form,
    "Caller-Destination-Number": "+14165551234",
  });
  expect(xml).toContain("tenant_b");
  expect(xml).toContain("destination.lua b.test hangup");
  await expect(
    Promise.resolve(
      db.insert(schema.inboundRoute).values({
        id: "other-did",
        organizationId: "a",
        didPattern: "+14165551234",
        destinationType: "hangup",
      }),
    ),
  ).rejects.toThrow();
  expect(
    await handleDialplan({
      ...form,
      "Caller-Destination-Number": "+14165551234",
    }),
  ).toContain("tenant_b");
});

test("a call outside its tenant's context is moved into it before routing (I27)", async () => {
  const { handleDialplan } = await import("../src/routes/fs-xml");
  const form = {
    "variable_sip_h_X-Tenant-Domain": "a.test",
    "variable_sip_h_X-Auth-User": "101",
    "Caller-Destination-Number": "14165551234",
  };
  // The SIP profile's context, and another tenant's: both are answered in the requested context
  // (or FreeSWITCH ignores the answer) with a transfer into this tenant's own.
  for (const hunt of ["default", "tenant_b"]) {
    const xml = await handleDialplan({ ...form, "Hunt-Context": hunt });
    expect(xml).toContain(`<context name="${hunt}">`);
    expect(xml).toContain(
      'application="transfer" data="14165551234 XML tenant_a"',
    );
  }
  const inside = await handleDialplan({ ...form, "Hunt-Context": "tenant_a" });
  expect(inside).toContain('<context name="tenant_a">');
  expect(inside).not.toContain('application="transfer"');
});

test("concurrent DID claims from two tenants yield one success and a conflict", async () => {
  await db.insert(schema.member).values({
    id: "b-owner",
    userId: "other",
    organizationId: "b",
    role: "owner",
    createdAt: new Date(),
  });
  const body = { didPattern: "+14165551234", destinationType: "hangup" };
  const replies = await Promise.all([
    request("/inbound-routes", body),
    request("/inbound-routes", body, "other", "POST", "b"),
  ]);
  expect(replies.map((r) => r.status).sort()).toEqual([201, 409]);
});

test("register-mode trunks cannot be enabled through the API", async () => {
  expect(
    (
      await request("/trunks", {
        name: "Unsupported",
        host: "carrier.example",
        authMode: "register",
        username: "account",
      })
    ).status,
  ).toBe(400);
  expect(await db.query.trunk.findMany()).toHaveLength(0);
});

test("outbound CDR attributes trusted trunk IDs within the tenant", async () => {
  const { ingestCdr } = await import("../src/services/cdr");
  await db.insert(schema.trunk).values({
    id: "carrier-a",
    organizationId: "a",
    name: "A",
    host: "192.0.2.1",
  });
  await db.insert(schema.trunk).values({
    id: "carrier-b",
    organizationId: "b",
    name: "B",
    host: "192.0.2.2",
  });
  for (const [uuid, carrier, expected] of [
    ["cdr-a", "carrier-a", "carrier-a"],
    ["cdr-cross", "carrier-b", null],
  ]) {
    await ingestCdr(
      `<cdr><variables><uuid>${uuid}</uuid><sip_h_X-Tenant-ID>a</sip_h_X-Tenant-ID><sip_h_X-Trunk-ID>${carrier}</sip_h_X-Trunk-ID><destination_number>14165551234</destination_number></variables></cdr>`,
    );
    const row = await db.query.cdr.findFirst({
      where: (t, { eq }) => eq(t.callUuid, uuid!),
    });
    expect(row?.trunkId).toBe(expected);
    expect(row?.direction).toBe("outbound");
  }
});

test("cache and API exclude disabled trunks, PCRE fallback routes only enabled trunks", async () => {
  const { handleDialplan } = await import("../src/routes/fs-xml");
  await db.insert(schema.trunk).values({
    id: "trunk",
    organizationId: "a",
    name: "Carrier",
    host: "192.0.2.1",
    enabled: false,
  });
  await db.insert(schema.outboundRoute).values({
    id: "route",
    organizationId: "a",
    name: "NANP",
    pattern: "^1[0-9]{10}$",
    patternSyntax: "pcre",
    trunkId: "trunk",
  });
  await cache.cacheRouteTable("a");
  expect(JSON.parse(memory.get("qwixbox:routes:a.test")!)).toEqual([]);
  const form = {
    "variable_sip_h_X-Tenant-Domain": "a.test",
    "variable_sip_h_X-Auth-User": "101",
    "Caller-Destination-Number": "14165551234",
  };
  expect(await handleDialplan(form)).not.toContain('application="bridge"');
  await pool.query("UPDATE trunk SET enabled=true WHERE id='trunk'");
  expect(await handleDialplan(form)).toContain('application="bridge"');
  expect(
    await handleDialplan({ ...form, "Caller-Destination-Number": "999" }),
  ).not.toContain('application="bridge"');
});

test("legacy outbound quarantine preserves unrelated tenant cache rebuilds", async () => {
  const created = await request("/extensions", {
    number: "101",
    displayName: "Test",
  });
  expect(created.status).toBe(201);
  await db.insert(schema.trunk).values({
    id: "carrier",
    organizationId: "a",
    name: "Carrier",
    host: "192.0.2.1",
  });
  await db.insert(schema.outboundRoute).values({
    id: "legacy",
    organizationId: "a",
    name: "Legacy",
    pattern: "^1%d%d$",
    trunkId: "carrier",
  });
  await cache.rebuildTenant("a");
  expect(memory.has("qwixbox:dir:a.test:101")).toBe(true);
  expect(JSON.parse(memory.get("qwixbox:routes:a.test")!)).toEqual([]);
});

// Settings the call path never reads must be refused, not stored and ignored (gate 8, I07/I22).
test("unenforced settings are refused, inert and unchanged values still save", async () => {
  for (const body of [
    { recordingPolicy: "all" },
    { maxConcurrentCalls: 50 },
    { stirShakenEnabled: true },
  ]) {
    const res = await request("/tenant", body, "owner", "PATCH");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not enforced");
  }
  expect(
    (
      await request(
        "/tenant",
        { recordingPolicy: "none", timezone: "America/Toronto" },
        "owner",
        "PATCH",
      )
    ).status,
  ).toBe(200);
  const tenant = await db.query.tenantSettings.findFirst({
    where: (t, { eq }) => eq(t.organizationId, "a"),
  });
  expect(tenant?.recordingPolicy).toBe("none");
  expect(tenant?.maxConcurrentCalls).toBe(10);

  expect(
    (
      await request("/extensions", {
        number: "201",
        displayName: "X",
        maxConcurrentCalls: 4,
      })
    ).status,
  ).toBe(400);
  const created = await request("/extensions", {
    number: "201",
    displayName: "X",
  });
  expect(created.status).toBe(201);
  const ext = await created.json();
  expect(
    (
      await request(
        `/extensions/${ext.id}`,
        { maxConcurrentCalls: 4 },
        "owner",
        "PATCH",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await request(
        `/extensions/${ext.id}`,
        { displayName: "Y", maxConcurrentCalls: null },
        "owner",
        "PATCH",
      )
    ).status,
  ).toBe(200);

  for (const extra of [
    { codecPrefs: "PCMU" },
    { priority: 1 },
    { fromDomain: "carrier.example" },
  ]) {
    expect(
      (await request("/trunks", { name: "T", host: "192.0.2.10", ...extra }))
        .status,
    ).toBe(400);
  }
  expect(await db.query.trunk.findMany()).toHaveLength(0);
  const sync = await import("../src/services/kamailio-sync");
  const reload = spyOn(sync, "reloadKamailio").mockResolvedValue(true);
  await pool.query(
    "CREATE TABLE IF NOT EXISTS address (grp int, ip_addr text, mask int, port int, tag text); TRUNCATE address",
  );
  expect(
    (await request("/trunks", { name: "T", host: "192.0.2.10", priority: 10 }))
      .status,
  ).toBe(201);
  reload.mockRestore();
});

test("capabilities report every unenforced field to any tenant member", async () => {
  const res = await app.request("/api/capabilities", {
    headers: { "test-user": "viewer", "test-org": "a" },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Object.keys(body.unenforced.tenant_settings)).toContain(
    "recordingPolicy",
  );
  expect(Object.keys(body.unenforced.extension)).toContain(
    "maxConcurrentCalls",
  );
  expect(Object.keys(body.unenforced.trunk)).toContain("codecPrefs");
  expect(body.stirSigning).toBe(false);
});

test("password-reset requests are limited by the configured rule, not the library default", async () => {
  // The rule once named /forget-password, which the portal never calls, so the library's
  // default (3 per minute) applied instead and the configured 5 per 5 minutes was dead.
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await auth.handler(
      new Request("https://localhost/api/auth/request-password-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-real-ip": "203.0.113.21",
        },
        body: JSON.stringify({
          email: "nobody@example.test",
          redirectTo: "/reset-password",
        }),
      }),
    );
    statuses.push(res.status);
  }
  expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
  expect(statuses[5]).toBe(429);
});

test("revocation converges after Kamailio and Redis fail post-commit (R06)", async () => {
  const kam = await import("../src/services/kamailio-sync");
  const projections = await import("../src/services/projections");
  const jobs = () =>
    pool.query("SELECT attempts, last_error FROM projection_job");
  const created = await request("/extensions", {
    number: "101",
    displayName: "X",
  });
  const ext = (await created.json()) as any;
  await pool.query("INSERT INTO location VALUES ('101','a.test')");
  expect((await jobs()).rowCount).toBe(0);

  // Kamailio's database is unreachable at the moment the disable commits.
  const down = spyOn(kam, "removeSubscriber").mockRejectedValue(
    new Error("connect ECONNREFUSED"),
  );
  const res = await request(
    `/extensions/${ext.id}`,
    { enabled: false },
    "owner",
    "PATCH",
  );
  down.mockRestore();
  expect(res.status).toBe(200);
  expect((await pool.query("SELECT * FROM subscriber")).rowCount).toBe(1);
  const queued = (await jobs()).rows;
  expect(queued).toHaveLength(1);
  expect(queued[0].last_error).toContain("ECONNREFUSED");

  const status = (await (
    await request("/tenant/projections", undefined, "owner", "GET")
  ).json()) as any;
  expect(status.pending).toBe(1);
  expect(status.jobs[0].lastError).toContain("ECONNREFUSED");
  expect(
    (await request("/tenant/projections", undefined, "viewer", "GET")).status,
  ).toBe(403);
  expect(
    ((await (await app.request("/health")).json()) as any).projections.pending,
  ).toBe(1);

  // Dependencies are back; after the backoff a restarted API drains on startup.
  await Bun.sleep(2_100);
  expect(await projections.drainProjections()).toEqual({ done: 1, failed: 0 });
  expect((await pool.query("SELECT * FROM subscriber")).rowCount).toBe(0);
  expect((await pool.query("SELECT * FROM location")).rowCount).toBe(0);
  expect(memory.has("qwixbox:dir:a.test:101")).toBe(false);
  expect((await jobs()).rowCount).toBe(0);

  // Redis down instead: Kamailio is revoked, the cached directory entry is not, and the job
  // stays until it is.
  await request(`/extensions/${ext.id}`, { enabled: true }, "owner", "PATCH");
  expect(memory.has("qwixbox:dir:a.test:101")).toBe(true);
  (redis.publishGeneration as any).mockImplementationOnce(async () => {
    throw new Error("Redis connection lost");
  });
  await request(`/extensions/${ext.id}`, { enabled: false }, "owner", "PATCH");
  expect((await pool.query("SELECT * FROM subscriber")).rowCount).toBe(0);
  expect(memory.has("qwixbox:dir:a.test:101")).toBe(true);
  expect((await jobs()).rows[0].last_error).toContain("Redis");
  await Bun.sleep(2_100);
  await projections.drainProjections();
  expect(memory.has("qwixbox:dir:a.test:101")).toBe(false);
  expect((await jobs()).rowCount).toBe(0);
  // Two real backoff waits, so longer than the default 5s.
}, 20_000);

test("a change committed while its projection runs is not lost (R06)", async () => {
  const kam = await import("../src/services/kamailio-sync");
  const projections = await import("../src/services/projections");
  const created = await request("/extensions", {
    number: "102",
    displayName: "Y",
  });
  const ext = (await created.json()) as any;
  const key = `extension:a:${ext.id}`;
  await projections.enqueue(db, "a", [
    {
      kind: "extension",
      target: ext.id,
      payload: { number: "102", sipDomain: "a.test" },
    },
  ]);
  // Another request commits a change to the same extension mid-run.
  const real = kam.syncSubscriber;
  const mid = spyOn(kam, "syncSubscriber").mockImplementation(
    async (...args) => {
      await projections.enqueue(db, "a", [
        {
          kind: "extension",
          target: ext.id,
          payload: { number: "102", sipDomain: "a.test" },
        },
      ]);
      return real(...args);
    },
  );
  expect(await projections.runNow([key])).toBe(true);
  mid.mockRestore();
  const left = await pool.query(
    "SELECT attempts FROM projection_job WHERE key = $1",
    [key],
  );
  expect(left.rowCount).toBe(1);
  expect(left.rows[0].attempts).toBe(0);
  expect(await projections.drainProjections()).toEqual({ done: 1, failed: 0 });
  expect(
    (await pool.query("SELECT 1 FROM projection_job WHERE key = $1", [key]))
      .rowCount,
  ).toBe(0);
});

test("a failed cache build leaves the previous generation live (R13)", async () => {
  const callState = await import("../src/services/call-state");
  await db
    .insert(schema.ringGroup)
    .values({ id: "rg", organizationId: "a", number: "600", name: "Sales" });
  await cache.rebuildTenant("a");
  const before = new Map(memory);
  expect(before.has("qwixbox:tenant:a.test")).toBe(true);
  expect(before.has("qwixbox:rg:a.test:rg")).toBe(true);

  await db
    .update(schema.tenantSettings)
    .set({ timezone: "Europe/London" })
    .where(eq(schema.tenantSettings.organizationId, "a"));
  const broken = spyOn(callState, "callState").mockRejectedValue(
    new Error("database went away mid-build"),
  );
  await expect(cache.rebuildTenant("a")).rejects.toThrow("mid-build");
  broken.mockRestore();
  // Nothing was written: not the new tenant settings, and nothing was purged.
  expect(new Map(memory)).toEqual(before);

  await cache.rebuildTenant("a");
  expect(JSON.parse(memory.get("qwixbox:tenant:a.test")!).timezone).toBe(
    "Europe/London",
  );
});

test("a deleted call flow loses its keys; other feature numbers stay (R13)", async () => {
  await db
    .insert(schema.ringGroup)
    .values({ id: "rg", organizationId: "a", number: "600", name: "Sales" });
  await db
    .insert(schema.ivrMenu)
    .values({ id: "ivr", organizationId: "a", number: "700", name: "Main" });
  await cache.cacheCallFlows("a");
  expect(memory.has("qwixbox:num:a.test:600")).toBe(true);
  expect(memory.has("qwixbox:num:a.test:700")).toBe(true);

  await db.delete(schema.ringGroup).where(eq(schema.ringGroup.id, "rg"));
  await cache.cacheCallFlows("a");
  expect(memory.has("qwixbox:rg:a.test:rg")).toBe(false);
  expect(memory.has("qwixbox:num:a.test:600")).toBe(false);
  expect(memory.has("qwixbox:num:a.test:700")).toBe(true);
});

test("a referenced extension cannot be deleted; its number cannot inherit the calls (I04)", async () => {
  const created = await request("/extensions", {
    number: "101",
    displayName: "Alice",
  });
  const alice = (await created.json()) as any;
  const pointers = [
    () =>
      db.insert(schema.inboundRoute).values({
        id: "did",
        organizationId: "a",
        didPattern: "+14165551234",
        destinationType: "extension",
        destinationId: alice.id,
      }),
    () =>
      db.insert(schema.ringGroup).values({
        id: "rg",
        organizationId: "a",
        number: "600",
        name: "Sales",
        failoverType: "extension",
        failoverId: alice.id,
      }),
    () =>
      db.insert(schema.ivrMenu).values({
        id: "ivr",
        organizationId: "a",
        number: "700",
        name: "Main",
        timeoutType: "voicemail",
        timeoutId: "101",
      }),
    () =>
      db.insert(schema.ivrOption).values({
        id: "opt",
        ivrMenuId: "ivr",
        digit: "1",
        destinationType: "extension",
        destinationId: alice.id,
      }),
    () =>
      db.insert(schema.timeCondition).values({
        id: "tc",
        organizationId: "a",
        name: "Hours",
        rules: [],
        noMatchType: "voicemail",
        noMatchId: "101",
      }),
    () =>
      db.insert(schema.queue).values({
        id: "q",
        organizationId: "a",
        number: "800",
        name: "Support",
        timeoutType: "extension",
        timeoutId: alice.id,
      }),
  ];
  // Each pointer alone keeps the extension alive.
  for (const add of pointers) {
    await add();
    const refused = await request(
      `/extensions/${alice.id}`,
      {},
      "owner",
      "DELETE",
    );
    expect(refused.status).toBe(409);
  }
  const body = (await (
    await request(`/extensions/${alice.id}`, {}, "owner", "DELETE")
  ).json()) as any;
  for (const named of [
    "inbound route +14165551234",
    "ring group Sales (failover)",
    "IVR Main (timeout)",
    "IVR Main option 1",
    "time condition Hours (no match)",
    "queue Support (timeout)",
  ])
    expect(body.error).toContain(named);

  // Repoint everything, and the delete goes through.
  await pool.query(
    "UPDATE inbound_route SET destination_type='hangup', destination_id=NULL; UPDATE ring_group SET failover_type=NULL, failover_id=NULL; UPDATE ivr_menu SET timeout_type=NULL, timeout_id=NULL; UPDATE ivr_option SET destination_type='hangup', destination_id=NULL; UPDATE time_condition SET no_match_type=NULL, no_match_id=NULL; UPDATE queue SET timeout_type=NULL, timeout_id=NULL",
  );
  expect(
    (await request(`/extensions/${alice.id}`, {}, "owner", "DELETE")).status,
  ).toBe(204);

  // The number is reused; the DID does not follow it, in either tier.
  const bob = (await (
    await request("/extensions", { number: "101", displayName: "Bob" })
  ).json()) as any;
  await cache.rebuildTenant("a");
  expect(JSON.parse(memory.get("qwixbox:did:a.test:+14165551234")!)).toEqual(
    expect.objectContaining({ destinationType: "hangup" }),
  );
  const { destinationNumber } = await import("../src/services/call-state");
  expect(await destinationNumber("a", "extension", bob.id)).toBe("101");
});

test("referenced call flows cannot be deleted; their own pointers do not count (I04)", async () => {
  await db.insert(schema.ringGroup).values({
    id: "rg",
    organizationId: "a",
    number: "600",
    name: "Sales",
  });
  await db.insert(schema.ivrMenu).values({
    id: "ivr",
    organizationId: "a",
    number: "700",
    name: "Main",
    timeoutType: "ivr",
    timeoutId: "ivr",
  });
  await db.insert(schema.ivrOption).values({
    id: "opt",
    ivrMenuId: "ivr",
    digit: "0",
    destinationType: "ivr",
    destinationId: "ivr",
  });
  await db.insert(schema.timeCondition).values({
    id: "tc",
    organizationId: "a",
    name: "Hours",
    rules: [],
    matchType: "ring_group",
    matchId: "rg",
    noMatchType: "ivr",
    noMatchId: "ivr",
  });
  await db.insert(schema.inboundRoute).values({
    id: "did",
    organizationId: "a",
    didPattern: "+14165551234",
    destinationType: "time_condition",
    destinationId: "tc",
  });

  for (const path of [
    "/ring-groups/rg",
    "/ivr-menus/ivr",
    "/time-conditions/tc",
  ])
    expect((await request(path, {}, "owner", "DELETE")).status).toBe(409);

  // Another tenant's identically-named pointer is not this tenant's reference.
  await db.insert(schema.ringGroup).values({
    id: "rg-b",
    organizationId: "b",
    number: "600",
    name: "Other",
    failoverType: "ring_group",
    failoverId: "rg",
  });
  await pool.query(
    "UPDATE inbound_route SET destination_type='hangup' WHERE id='did'",
  );
  expect(
    (await request("/time-conditions/tc", {}, "owner", "DELETE")).status,
  ).toBe(204);
  expect((await request("/ring-groups/rg", {}, "owner", "DELETE")).status).toBe(
    204,
  );
  // The menu's own timeout and option point at itself, and go with it.
  expect((await request("/ivr-menus/ivr", {}, "owner", "DELETE")).status).toBe(
    204,
  );
});

// What each tier would run for `number` dialled by an authenticated 101 in tenant a.
async function bothTiers(number: string) {
  const { handleDialplan } = await import("../src/routes/fs-xml");
  await cache.rebuildTenant("a");
  const warm = memory.get(`qwixbox:num:a.test:${number}`);
  const cold = await handleDialplan({
    "variable_sip_h_X-Tenant-Domain": "a.test",
    "variable_sip_h_X-Auth-User": "101",
    "Caller-Destination-Number": number,
  });
  const match = /destination\.lua a\.test (\w+) (\S+)"/.exec(cold);
  return {
    warm: warm ? JSON.parse(warm) : null,
    cold: match ? { type: match[1], id: match[2] } : null,
  };
}

test("a number belongs to one dialable resource across types (I19)", async () => {
  const group = await request("/ring-groups", { number: "600", name: "Sales" });
  expect(group.status).toBe(201);
  const clash = await request("/ivr-menus", { number: "600", name: "Main" });
  expect(clash.status).toBe(409);
  expect(((await clash.json()) as any).error).toContain("ring group Sales");
  expect(
    (await request("/extensions", { number: "600", displayName: "X" })).status,
  ).toBe(409);

  // A number change is a claim too.
  const ext = await request("/extensions", { number: "101", displayName: "A" });
  expect(ext.status).toBe(201);
  const menu = (await (
    await request("/ivr-menus", { number: "700", name: "Main" })
  ).json()) as any;
  expect(
    (
      await request(
        `/ivr-menus/${menu.id}`,
        { number: "101" },
        "owner",
        "PATCH",
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await request(
        `/ivr-menus/${menu.id}`,
        { number: "700" },
        "owner",
        "PATCH",
      )
    ).status,
  ).toBe(200);

  // The other tenant's 600 is its own.
  expect(
    (
      await request(
        "/ring-groups",
        { number: "600", name: "B" },
        "owner",
        "POST",
        "b",
      )
    ).status,
  ).not.toBe(409);
});

test("concurrent creates of one number across types yield one success (I19)", async () => {
  const results = await Promise.all([
    request("/ring-groups", { number: "650", name: "Sales" }),
    request("/ivr-menus", { number: "650", name: "Main" }),
    request("/extensions", { number: "650", displayName: "X" }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
});

test("a legacy duplicate resolves to the same destination warm and cold (I19)", async () => {
  // Written past the API, as an install from before I19 could hold.
  await db.insert(schema.ivrMenu).values({
    id: "ivr",
    organizationId: "a",
    number: "600",
    name: "Main",
  });
  await db.insert(schema.ringGroup).values({
    id: "rg",
    organizationId: "a",
    number: "600",
    name: "Sales",
  });
  const tiers = await bothTiers("600");
  expect(tiers.cold).toEqual({ type: "ring_group", id: "rg" });
  expect(tiers.warm).toEqual(tiers.cold);
});

test("outbound caller ID resolves route, then extension, then tenant, identically in both tiers (I03)", async () => {
  const { handleDialplan } = await import("../src/routes/fs-xml");
  await db.insert(schema.trunk).values({
    id: "trunk",
    organizationId: "a",
    name: "Carrier",
    host: "192.0.2.1",
  });
  await db.insert(schema.outboundRoute).values({
    id: "route",
    organizationId: "a",
    name: "NANP",
    pattern: "^1[0-9]{10}$",
    patternSyntax: "pcre",
    trunkId: "trunk",
  });
  const ext = (await (
    await request("/extensions", { number: "101", displayName: "Alice" })
  ).json()) as any;
  const form = {
    "variable_sip_h_X-Tenant-Domain": "a.test",
    "variable_sip_h_X-Auth-User": "101",
    "Caller-Destination-Number": "14165551234",
  };
  // Cold: what fs-xml.ts sets. Warm: what xml_handler.lua reads from the call state.
  const tiers = async () => {
    await cache.rebuildTenant("a");
    const xml = await handleDialplan(form);
    const cold = {
      name: /effective_caller_id_name=([^"]*)"/.exec(xml)?.[1] ?? null,
      number: /effective_caller_id_number=([^"]*)"/.exec(xml)?.[1] ?? null,
    };
    const state = JSON.parse(memory.get("qwixbox:call:a.test:101")!);
    const routes = JSON.parse(memory.get("qwixbox:routes:a.test")!);
    const warm = {
      name: state.callerIdName || null,
      number: routes[0].callerIdOverride || state.callerIdNumber || null,
    };
    expect(warm).toEqual(cold);
    return cold;
  };

  // Nothing configured: nothing set, the call keeps its own identity.
  expect(await tiers()).toEqual({ name: null, number: null });

  const patch = (path: string, body: unknown) =>
    request(path, body, "owner", "PATCH");
  expect(
    (
      await patch("/tenant", {
        defaultCallerIdName: "Acme",
        defaultCallerIdNumber: "+14165550100",
      })
    ).status,
  ).toBe(200);
  expect(await tiers()).toEqual({ name: "Acme", number: "+14165550100" });

  expect(
    (
      await patch(`/extensions/${ext.id}`, {
        callerIdName: "Alice Smith",
        callerIdNumber: "+14165550101",
      })
    ).status,
  ).toBe(200);
  expect(await tiers()).toEqual({
    name: "Alice Smith",
    number: "+14165550101",
  });

  expect(
    (
      await patch("/outbound-routes/route", {
        callerIdOverride: "+14165550199",
      })
    ).status,
  ).toBe(200);
  expect(await tiers()).toEqual({
    name: "Alice Smith",
    number: "+14165550199",
  });

  // A name is set by a dialplan action, so `$` is refused.
  expect(
    (await patch(`/extensions/${ext.id}`, { callerIdName: "A $1 B" })).status,
  ).toBe(400);
});

test("a carrier call reaches outbound routing only through a forward the tenant configured (R11)", async () => {
  const { handleDialplan } = await import("../src/routes/fs-xml");
  await db.insert(schema.trunk).values({
    id: "trunk",
    organizationId: "a",
    name: "Carrier",
    host: "192.0.2.1",
  });
  await db.insert(schema.outboundRoute).values({
    id: "route",
    organizationId: "a",
    name: "NANP",
    pattern: "^1[0-9]{10}$",
    patternSyntax: "pcre",
    trunkId: "trunk",
  });
  await request("/extensions", { number: "101", displayName: "Alice" });
  await request("/extensions", { number: "102", displayName: "Bob" });
  expect(
    (
      await request(
        "/tenant",
        { defaultCallerIdNumber: "+14165550100" },
        "owner",
        "PATCH",
      )
    ).status,
  ).toBe(200);
  const peer = {
    "variable_sip_h_X-Trusted-Peer": "1",
    "Hunt-Context": "tenant_a",
    "Caller-Destination-Number": "14165551234",
  };
  const forward = {
    variable_qwixbox_forward_to: "14165551234",
    variable_qwixbox_forward_domain: "a.test",
  };
  const bridged = (xml: string) => xml.includes('application="bridge"');

  // The peer itself is never an outbound caller: direct dial, and a forward of another number.
  // Nor may it dial an extension: without a forward, a peer reaches DIDs only.
  expect(bridged(await handleDialplan(peer))).toBe(false);
  expect(
    await handleDialplan({ ...peer, "Caller-Destination-Number": "102" }),
  ).not.toContain("extension.lua");
  expect(
    bridged(
      await handleDialplan({
        ...peer,
        ...forward,
        variable_qwixbox_forward_to: "14165559999",
      }),
    ),
  ).toBe(false);

  // An extension's forward: placed and counted as that extension.
  const viaExt = await handleDialplan({
    ...peer,
    ...forward,
    variable_qwixbox_forward_from: "101",
  });
  expect(bridged(viaExt)).toBe(true);
  expect(viaExt).toContain("sip_h_X-Auth-User=101");
  expect(viaExt).toContain("effective_caller_id_number=+14165550100");

  // A tenant-configured external destination (DID, IVR option): the tenant's identity.
  const viaTenant = await handleDialplan({ ...peer, ...forward });
  expect(bridged(viaTenant)).toBe(true);
  expect(viaTenant).toContain('data="sip_h_X-Auth-User="');
  expect(viaTenant).toContain("effective_caller_id_number=+14165550100");

  // A forward to another extension resolves internally, still in the forward's tenant.
  const internal = await handleDialplan({
    ...peer,
    "Caller-Destination-Number": "102",
    variable_qwixbox_forward_to: "102",
    variable_qwixbox_forward_domain: "a.test",
    variable_qwixbox_forward_from: "101",
  });
  expect(internal).toContain("extension.lua a.test 102");

  // An endpoint's forward must name its own tenant.
  expect(
    bridged(
      await handleDialplan({
        "variable_sip_h_X-Tenant-Domain": "b.test",
        "variable_sip_h_X-Auth-User": "101",
        "Hunt-Context": "tenant_b",
        "Caller-Destination-Number": "14165551234",
        ...forward,
      }),
    ),
  ).toBe(false);
});

test("a kamcmd RPC error on stdout is a failed reload, so the projection retries", async () => {
  const { kamcmdFailed } = await import("../src/services/kamailio-sync");
  expect(kamcmdFailed(0, "Reload OK\n", "")).toBe(false);
  expect(kamcmdFailed(0, "", "")).toBe(false);
  // permissions/dispatcher within reload_delta of the previous reload: exit 0, error on stdout.
  expect(kamcmdFailed(0, "error: 500 - ongoing reload\n", "")).toBe(true);
  expect(
    kamcmdFailed(
      0,
      "",
      "ERROR: connect_unix_sock: connect(...): Permission denied",
    ),
  ).toBe(true);
  expect(kamcmdFailed(1, "", "")).toBe(true);
});

test("Kamailio's emergency exemption is projected from exactly the routes FreeSWITCH treats as emergency (I02)", async () => {
  const { handleDialplan } = await import("../src/routes/fs-xml");
  const sync = await import("../src/services/kamailio-sync");
  const reload = spyOn(sync, "reloadKamailio").mockResolvedValue(true);
  await pool.query(
    "CREATE TABLE IF NOT EXISTS address (grp int, ip_addr text, mask int, port int, tag text); TRUNCATE address",
  );
  // Another tenant's row: a projection for "a" must leave it alone.
  await pool.query(
    "INSERT INTO emergency_pattern (key_name, key_type, value_type, key_value, organization_id) VALUES ('b.test', 1, 0, '^999$', 'b')",
  );
  const patterns = async () =>
    (
      await pool.query(
        "SELECT key_name, key_type, value_type, key_value, organization_id FROM emergency_pattern ORDER BY organization_id, key_value",
      )
    ).rows;
  await db.insert(schema.trunk).values([
    { id: "live", organizationId: "a", name: "Live", host: "192.0.2.1" },
    {
      id: "off",
      organizationId: "a",
      name: "Off",
      host: "192.0.2.2",
      enabled: false,
    },
  ]);
  const route = (body: object) =>
    request("/outbound-routes", { patternSyntax: "pcre", ...body });
  expect(
    (
      await route({
        name: "911",
        pattern: "^(911|933)$",
        trunkId: "live",
        isEmergency: true,
      })
    ).status,
  ).toBe(201);
  // Not emergency, or not routable: FreeSWITCH would not route these as an emergency.
  expect(
    (await route({ name: "NANP", pattern: "^1[0-9]{10}$", trunkId: "live" }))
      .status,
  ).toBe(201);
  expect(
    (
      await route({
        name: "112",
        pattern: "^112$",
        trunkId: "off",
        isEmergency: true,
      })
    ).status,
  ).toBe(201);
  expect(await patterns()).toEqual([
    {
      key_name: "a.test",
      key_type: 1,
      value_type: 0,
      key_value: "^(911|933)$",
      organization_id: "a",
    },
    {
      key_name: "b.test",
      key_type: 1,
      value_type: 0,
      key_value: "^999$",
      organization_id: "b",
    },
  ]);
  // The cold tier agrees: 933 is an emergency call, 112 (disabled trunk) is not.
  const dial = (number: string) =>
    handleDialplan({
      "Hunt-Context": "tenant_a",
      "variable_sip_h_X-Tenant-Domain": "a.test",
      "variable_sip_h_X-Auth-User": "101",
      "Caller-Destination-Number": number,
    });
  expect(await dial("933")).toContain("sip_h_X-Emergency=true");
  expect(await dial("112")).not.toContain("sip_h_X-Emergency=true");

  // A trunk decides eligibility, so changing it refreshes the patterns.
  expect(
    (await request("/trunks/off", { enabled: true }, "owner", "PATCH")).status,
  ).toBe(200);
  expect((await patterns()).map((row) => row.key_value)).toEqual([
    "^(911|933)$",
    "^112$",
    "^999$",
  ]);
  expect(
    (await request("/trunks/live", { enabled: false }, "owner", "PATCH"))
      .status,
  ).toBe(200);
  expect((await patterns()).map((row) => row.key_value)).toEqual([
    "^112$",
    "^999$",
  ]);
  // A viewer cannot add an emergency route, so cannot widen the exemption either.
  expect(
    (
      await request(
        "/outbound-routes",
        {
          name: "all",
          pattern: ".*",
          patternSyntax: "pcre",
          trunkId: "off",
          isEmergency: true,
        },
        "viewer",
      )
    ).status,
  ).toBe(403);
  // A route change reloads only the emergency htable: permissions and dispatcher refuse a reload
  // within five seconds of the last, so reloading them here delayed a change after a trunk edit.
  expect(reload).toHaveBeenCalledWith(["emergency"]);
  reload.mockRestore();
});

test("/health is degraded when FreeSWITCH or Kamailio is down, not only the database (I17)", async () => {
  const sync = await import("../src/services/kamailio-sync");
  const redisModule = await import("../src/services/redis");
  const ping = spyOn(redisModule, "ping").mockResolvedValue(true);
  const fs = spyOn(esl, "status").mockResolvedValue({ ok: true } as any);
  const kam = spyOn(sync, "kamailioResponds").mockResolvedValue(true);
  const health = async () => {
    const res = await app.request("/health");
    return { code: res.status, body: (await res.json()) as any };
  };
  try {
    expect((await health()).code).toBe(200);
    kam.mockResolvedValue(false);
    expect(await health()).toMatchObject({
      code: 503,
      body: { status: "degraded", kamailio: false, database: true },
    });
    kam.mockResolvedValue(true);
    fs.mockResolvedValue({ ok: false } as any);
    expect(await health()).toMatchObject({
      code: 503,
      body: { status: "degraded", freeswitch: false, database: true },
    });
  } finally {
    ping.mockRestore();
    fs.mockRestore();
    kam.mockRestore();
  }
});

test("after a restore, Kamailio keeps only what the database knows (I14)", async () => {
  const { pruneKamailio } = await import("../src/services/kamailio-sync");
  await pool.query(
    "CREATE TABLE IF NOT EXISTS address (grp int, ip_addr text, mask int, port int, tag text); CREATE TABLE IF NOT EXISTS domain (domain text UNIQUE, did text); TRUNCATE address, domain",
  );
  await pool.query(`
    INSERT INTO subscriber (username, domain, ha1) VALUES ('101', 'a.test', 'x'), ('102', 'a.test', 'x'), ('101', 'gone.test', 'x');
    INSERT INTO location (username, domain) VALUES ('101', 'a.test'), ('102', 'a.test'), ('101', 'gone.test');
    INSERT INTO address (grp, ip_addr, mask, port, tag) VALUES (1, '192.0.2.1', 32, 5060, 'kept'), (1, '192.0.2.2', 32, 5060, 'deleted'), (1, '192.0.2.3', 32, 5060, NULL);
    INSERT INTO domain (domain, did) VALUES ('a.test', 'a.test'), ('gone.test', 'gone.test');
    INSERT INTO emergency_pattern (key_name, key_type, value_type, key_value, organization_id) VALUES ('a.test', 1, 0, '^911$', 'a'), ('gone.test', 1, 0, '^911$', 'gone');`);
  const removed = await pruneKamailio({
    subscribers: [{ username: "101", domain: "a.test" }],
    trunkIds: ["kept"],
    domains: ["a.test"],
    organizationIds: ["a"],
  });
  expect(removed).toEqual({
    subscriber: 2,
    location: 2,
    address: 1,
    domain: 1,
    emergency_pattern: 1,
  });
  const rows = async (query: string) =>
    (await pool.query(query)).rows.map((r) => Object.values(r).join("@"));
  expect(await rows("SELECT username, domain FROM subscriber")).toEqual([
    "101@a.test",
  ]);
  expect(await rows("SELECT username, domain FROM location")).toEqual([
    "101@a.test",
  ]);
  // An untagged address was not written by the projection, so it is not ours to remove.
  expect(
    await rows("SELECT coalesce(tag, 'untagged') FROM address ORDER BY 1"),
  ).toEqual(["kept", "untagged"]);
  expect(await rows("SELECT domain FROM domain")).toEqual(["a.test"]);
  expect(await rows("SELECT organization_id FROM emergency_pattern")).toEqual([
    "a",
  ]);
});
