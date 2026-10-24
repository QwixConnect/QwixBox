import { afterAll, expect, spyOn, test } from "bun:test";
import { endpoints } from "../portal/web/src/lib/api";

const urls: string[] = [];
const mock = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
  urls.push(String(input));
  return new Response("{}", { headers: { "Content-Type": "application/json" } });
});
afterAll(() => mock.mockRestore());

test("IVR # is sent as an encoded path segment for save and delete", async () => {
  await endpoints.setIvrOption("menu", "#", { destinationType: "hangup" });
  await endpoints.deleteIvrOption("menu", "#");
  for (const url of urls) {
    expect(url).toEndWith("/options/%23");
    expect(new URL(url, "https://example.test").hash).toBe("");
  }
});
