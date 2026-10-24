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

