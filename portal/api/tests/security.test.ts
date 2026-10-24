import { beforeEach, expect, spyOn, test } from "bun:test";

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
    "CREATE TABLE IF NOT EXISTS subscriber (username text, domain text, password text, ha1 text, ha1b text, UNIQUE(username,domain)); CREATE TABLE IF NOT EXISTS location (username text, domain text); TRUNCATE subscriber, location",
  );
  memory.clear();
  for (const id of ["a", "b"])
    await db.insert(schema.organization).values({ id, name: id, slug: id });
  for (const id of ["owner", "admin", "viewer", "other"])
    await db
      .insert(schema.user)
      .values({ id, name: id, email: `${id}@test.invalid` });
  for (const role of ["owner", "admin", "viewer"])
    await db
      .insert(schema.member)
      .values({ id: role, userId: role, organizationId: "a", role });
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
  await cache.cacheRingGroups("a");
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

test("concurrent DID claims from two tenants yield one success and a conflict", async () => {
  await db.insert(schema.member).values({
    id: "b-owner",
    userId: "other",
    organizationId: "b",
    role: "owner",
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
