import { expect, test } from "bun:test";
import { dateBound } from "../src/lib/date-range";
import { unsafeDialplanFields, validatePcre } from "../src/lib/dialplan-safe";

test("date-only upper bound includes the entire UTC day; timestamps keep inclusive semantics", () => {
  expect(dateBound("2026-10-24", true)).toEqual({
    date: new Date("2026-10-25T00:00:00Z"),
    exclusive: true,
  });
  expect(dateBound("2026-10-24T15:30:00Z", true)).toEqual({
    date: new Date("2026-10-24T15:30:00Z"),
    exclusive: false,
  });
  expect(() => dateBound("2026-02-30")).toThrow();
});
test("dialplan interpolation, wrong booleans and unsupported paths are rejected", () => {
  for (const body of [
    { callerIdOverride: "${system(foo)}" },
    { enabled: "false" },
    { greetingSound: "../../etc/passwd" },
    { stripDigits: -1 },
    { number: "101\nreloadxml" },
  ])
    expect(unsafeDialplanFields(body)).not.toBeNull();
});
test("PCRE syntax accepts alternation and rejects legacy Lua and reserved delimiters", async () => {
  expect(await validatePcre("^(911|1[0-9]{10})$")).toBeNull();
  for (const pattern of ["[", "^1%d%d$", "~", "a\nb"])
    expect(await validatePcre(pattern)).not.toBeNull();
});
