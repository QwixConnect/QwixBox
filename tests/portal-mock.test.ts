import { expect, test } from "bun:test";
import { createMockApi } from "../portal/web/mock/api";

function client() {
  const handle = createMockApi();
  return (path: string, method = "GET", body?: unknown, cookie?: string) =>
    handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
}

test("mock provides session, all portal collections and paginated call history", async () => {
  const request = client();
  expect(
    (await (await request("/api/auth/get-session")).json()).user.email,
  ).toBe("owner@example.test");
  for (const name of [
    "extensions",
    "trunks",
    "inbound-routes",
    "outbound-routes",
    "ring-groups",
    "ivr-menus",
    "time-conditions",
    "faxes",
  ]) {
    expect(
      (await (await request(`/api/${name}`)).json()).length,
    ).toBeGreaterThan(0);
  }
  const calls = await (await request("/api/cdr?limit=10&offset=10")).json();
  expect(calls.rows).toHaveLength(10);
  expect(calls.total).toBe(86);
});

test("mock edits persist, IVR # round trips, and reset restores fixtures", async () => {
  const request = client();
  const ext = await (
    await request("/api/extensions", "POST", {
      number: "2001",
      displayName: "Test",
    })
  ).json();
  expect(ext.sipPassword).toBe("demo-only-sip-password");
  await request(`/api/extensions/${ext.id}`, "PATCH", { dnd: true });
  expect((await (await request(`/api/extensions/${ext.id}`)).json()).dnd).toBe(
    true,
  );
  expect(
    (
      await request("/api/ivr-menus/ivr-main/options/%23", "PUT", {
        destinationType: "hangup",
      })
    ).status,
  ).toBe(200);
  const options = await (
    await request("/api/ivr-menus/ivr-main/options")
  ).json();
  expect(
    options.find((row: { digit: string }) => row.digit === "#").destinationType,
  ).toBe("hangup");
  await request("/__mock/reset", "POST", {});
  expect((await request(`/api/extensions/${ext.id}`)).status).toBe(404);
});

test("roles and failure scenarios stay local and unknown paths do not fall through", async () => {
  const request = client();
  await request("/__mock/settings", "POST", { role: "viewer" });
  expect(
    (await request("/api/extensions", "POST", { number: "2001" })).status,
  ).toBe(403);
  await request("/__mock/settings", "POST", { scenario: "error" });
  expect((await request("/api/extensions")).status).toBe(503);
  expect((await request("/api/auth/get-session")).status).toBe(200);
  await request("/__mock/settings", "POST", { scenario: "empty" });
  expect(await (await request("/api/extensions")).json()).toEqual([]);
  await request("/__mock/reset", "POST", {});
  expect((await request("/api/not-implemented")).status).toBe(404);
  const signout = await request("/api/auth/sign-out", "POST");
  expect(signout.status).toBe(200);
  expect(
    await (
      await request(
        "/api/auth/get-session",
        "GET",
        undefined,
        "qwixbox_mock_signed_out=1",
      )
    ).json(),
  ).toBeNull();
});

test("unavailable scenario answers preview collections with 404 like the real API", async () => {
  const request = client();
  await request("/__mock/settings", "POST", { scenario: "unavailable" });
  for (const name of ["emergency-locations", "voicemails", "devices"]) {
    expect((await request(`/api/${name}`)).status).toBe(404);
  }
  // Live resources keep working, so the rest of the portal stays usable in this scenario.
  const extensions = await request("/api/extensions");
  expect(extensions.status).toBe(200);
  expect((await extensions.json()).length).toBeGreaterThan(0);
});

test("mock provides unified inbox, contacts, queues, emergency, conferences, and devices collections", async () => {
  const request = client();
  for (const name of [
    "voicemails",
    "recordings",
    "sms-threads",
    "sms-opt-outs",
    "contacts",
    "queues",
    "queue-agents",
    "emergency-locations",
    "conferences",
    "parking-lots",
    "music-on-hold",
    "devices",
  ]) {
    const res = await request(`/api/${name}`);
    expect(res.status).toBe(200);
    expect((await res.json()).length).toBeGreaterThan(0);
  }

  const reply = await request("/api/sms-threads/thread-1/messages", "POST", {
    text: "Confirmed for 2 PM!",
  });
  expect(reply.status).toBe(201);
  const updatedThread = await reply.json();
  expect(updatedThread.preview).toBe("You: Confirmed for 2 PM!");
});

test("mock serves the API's own unenforced-settings table", async () => {
  const { UNENFORCED } = await import("../portal/api/src/lib/capabilities");
  const res = await client()("/api/capabilities");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    unenforced: UNENFORCED,
    stirSigning: false,
  });
});

test("projection status: empty normally, a failing job when changes are not live, owners/admins only", async () => {
  const request = client();
  const quiet = await (await request("/api/tenant/projections")).json();
  expect(quiet).toMatchObject({ pending: 0, failing: 0, jobs: [] });
  await request("/__mock/settings", "POST", { scenario: "unpublished" });
  const stuck = await (await request("/api/tenant/projections")).json();
  expect(stuck.failing).toBe(1);
  expect(stuck.jobs[0].lastError).toContain("ECONNREFUSED");
  await request("/__mock/settings", "POST", { role: "viewer" });
  expect((await request("/api/tenant/projections")).status).toBe(403);
});

test("a destination still pointed at cannot be deleted, as the API refuses it (I04)", async () => {
  const request = client();
  const used = await request("/api/extensions/ext-6", "DELETE");
  expect(used.status).toBe(409);
  const { error } = await used.json();
  expect(error).toContain("ring group Support team (failover)");
  expect(error).toContain("IVR Main welcome menu option #");
  expect((await request("/api/ring-groups/rg-sales", "DELETE")).status).toBe(
    409,
  );
  expect((await request("/api/ivr-menus/ivr-main", "DELETE")).status).toBe(409);
  // Ring-group membership is not a destination pointer; nothing else names ext-1.
  expect((await request("/api/extensions/ext-1", "DELETE")).status).toBe(204);
});

test("a number belongs to one dialable collection, as the API requires (I19)", async () => {
  const request = client();
  // Ring group 600 is a fixture.
  const clash = await request("/api/ivr-menus", "POST", {
    number: "600",
    name: "X",
  });
  expect(clash.status).toBe(409);
  expect(
    (
      await request("/api/extensions", "POST", {
        number: "600",
        displayName: "X",
      })
    ).status,
  ).toBe(409);
  expect(
    (await request("/api/ivr-menus", "POST", { number: "750", name: "X" }))
      .status,
  ).toBe(201);
});
