import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import { ApiError, endpoints, FeatureUnavailableError } from "../portal/web/src/lib/api";

const urls: string[] = [];
let respond = () =>
  new Response("{}", { headers: { "Content-Type": "application/json" } });
const mock = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
  urls.push(String(input));
  return respond();
});
afterAll(() => mock.mockRestore());
beforeEach(() => {
  urls.length = 0;
  respond = () => new Response("{}", { headers: { "Content-Type": "application/json" } });
});

test("IVR # is sent as an encoded path segment for save and delete", async () => {
  await endpoints.setIvrOption("menu", "#", { destinationType: "hangup" });
  await endpoints.deleteIvrOption("menu", "#");
  for (const url of urls) {
    expect(url).toEndWith("/options/%23");
    expect(new URL(url, "https://example.test").hash).toBe("");
  }
});

// Each of these has a preview screen but no live API route. A live 404 used to be answered with
// seed fixtures, which displayed invented E911 addresses as if the server held them.
const previews = [
  "voicemails",
  "recordings",
  "smsThreads",
  "smsOptOuts",
  "contacts",
  "queues",
  "queueAgents",
  "emergencyLocations",
  "conferences",
  "parkingLots",
  "musicOnHold",
  "devices",
] as const;

test.each(previews)("a live 404 on %s is unavailable, never fixture data", async (name) => {
  respond = () =>
    new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  const result = endpoints[name]().then(
    (data) => ({ data }),
    (error: unknown) => ({ error }),
  );
  const outcome = await result;
  expect(outcome).not.toHaveProperty("data");
  expect((outcome as { error: unknown }).error).toBeInstanceOf(FeatureUnavailableError);
});

test("other failures on a preview endpoint are not reported as unavailable", async () => {
  respond = () =>
    new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  const error = await endpoints.emergencyLocations().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).not.toBeInstanceOf(FeatureUnavailableError);
});
