import { expect, test } from "bun:test";
import { dateBound } from "../src/lib/date-range";
import { unsafeDialplanFields, validatePcre } from "../src/lib/dialplan-safe";
import { unenforcedFields, unenforcedWrite } from "../src/lib/capabilities";

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

test("unenforced settings: inert and unchanged values pass, signing lifts only the STIR entry", () => {
  expect(
    unenforcedWrite(
      "tenant_settings",
      { recordingPolicy: "none" },
      undefined,
      false,
    ),
  ).toBeNull();
  expect(
    unenforcedWrite(
      "tenant_settings",
      { recordingPolicy: "all" },
      undefined,
      false,
    ),
  ).toContain("I07");
  expect(
    unenforcedWrite(
      "tenant_settings",
      { recordingPolicy: "all" },
      { recordingPolicy: "all" },
      false,
    ),
  ).toBeNull();
  expect(
    unenforcedWrite(
      "tenant_settings",
      { stirShakenEnabled: true },
      undefined,
      false,
    ),
  ).not.toBeNull();
  expect(
    unenforcedWrite(
      "tenant_settings",
      { stirShakenEnabled: true },
      undefined,
      true,
    ),
  ).toBeNull();
  expect(
    Object.keys(unenforcedFields(true).tenant_settings ?? {}),
  ).not.toContain("stirShakenEnabled");
  expect(Object.keys(unenforcedFields(true).tenant_settings ?? {})).toContain(
    "recordingPolicy",
  );
  expect(
    unenforcedWrite("ring_group", { strategy: "random" }, undefined, false),
  ).toBeNull();
});

test("every schema table with a dialable number is in the claim registry (I19)", async () => {
  const { is, getTableColumns, getTableName } = await import("drizzle-orm");
  const { PgTable } = await import("drizzle-orm/pg-core");
  const schema = await import("../src/db/schema");
  const { DIALABLE } = await import("../src/lib/numbers");
  const numbered = Object.values(schema)
    .filter((t): t is InstanceType<typeof PgTable> => is(t, PgTable))
    .filter((t) => "number" in getTableColumns(t))
    .map((t) => getTableName(t))
    .sort();
  expect(numbered.length).toBeGreaterThan(0);
  expect(DIALABLE.map((d) => getTableName(d.table)).sort()).toEqual(numbered);
});
