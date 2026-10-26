import { isIP } from "node:net";

export const diallable = (v: unknown): v is string =>
  typeof v === "string" && /^\+?[0-9*#]{1,32}$/.test(v);
export const dialNumber = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9]{1,15}$/.test(v);
export const safeHost = (v: unknown): v is string =>
  typeof v === "string" &&
  (isIP(v) !== 0 || /^(?=.{1,253}$)[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*$/.test(v));
export const safeSound = (v: unknown): boolean =>
  typeof v === "string" &&
  /^[a-z0-9_][a-z0-9_/.-]*$/.test(v) &&
  !v.includes("..");

export function unsafeTenantSettings(
  body: Record<string, unknown>,
): string | null {
  const unsafe = unsafeDialplanFields(body);
  if (unsafe) return unsafe;
  if ("tier" in body && body.tier !== "shared" && body.tier !== "dedicated")
    return "Invalid tier";
  if (
    "maxConcurrentCalls" in body &&
    (!Number.isInteger(body.maxConcurrentCalls) ||
      Number(body.maxConcurrentCalls) < 1 ||
      Number(body.maxConcurrentCalls) > 10000)
  )
    return "maxConcurrentCalls must be an integer from 1 to 10000";
  for (const field of ["defaultCallerIdName", "defaultCallerIdNumber"]) {
    if (
      field in body &&
      body[field] !== null &&
      typeof body[field] !== "string"
    )
      return `${field} must be a string or null`;
  }
  if ("timezone" in body) {
    if (typeof body.timezone !== "string" || !body.timezone)
      return "Invalid timezone";
    try {
      new Intl.DateTimeFormat("en", { timeZone: body.timezone });
    } catch {
      return "Invalid timezone";
    }
  }
  if (
    "recordingPolicy" in body &&
    !["none", "inbound", "outbound", "all"].includes(
      String(body.recordingPolicy),
    )
  )
    return "Invalid recording policy";
  return null;
}

// This is also applied by generic CRUD so new call-flow writers cannot bypass it.
export function unsafeDialplanFields(
  body: Record<string, unknown>,
): string | null {
  for (const field of [
    "enabled",
    "isEmergency",
    "carrierSigns",
    "voicemailEnabled",
    "dnd",
    "callWaitingEnabled",
    "stirShakenEnabled",
  ]) {
    if (field in body && typeof body[field] !== "boolean")
      return `${field} must be boolean`;
  }
  for (const field of [
    "callerIdOverride",
    "callerIdNumber",
    "defaultCallerIdNumber",
    "prependDigits",
  ]) {
    if (body[field] != null && body[field] !== "" && !diallable(body[field]))
      return `${field} must be diallable digits`;
  }
  // Names reach a dialplan `set` (I03); `$` would be read as a back-reference or variable there.
  for (const field of ["callerIdName", "defaultCallerIdName"]) {
    const value = body[field];
    if (
      value != null &&
      value !== "" &&
      (typeof value !== "string" || value.length > 64 || value.includes("$"))
    )
      return `${field} must be at most 64 characters without $`;
  }
  for (const field of ["greetingSound", "invalidSound"]) {
    if (body[field] != null && body[field] !== "" && !safeSound(body[field]))
      return `${field} must be a relative sound path without ..`;
  }
  if ("host" in body && !safeHost(body.host))
    return "host must be a hostname or IP literal";
  if ("number" in body && !dialNumber(body.number))
    return "number must be 1 to 15 digits";
  if (
    "didPattern" in body &&
    (typeof body.didPattern !== "string" ||
      !/^\+?[0-9]{1,15}$/.test(body.didPattern))
  )
    return "DID must be an exact number (optional leading +)";
  if (
    "stripDigits" in body &&
    (!Number.isInteger(body.stripDigits) || Number(body.stripDigits) < 0)
  )
    return "stripDigits must be a non-negative integer";
  for (const [field, value] of Object.entries(body)) {
    if (
      typeof value === "string" &&
      (value.includes("${") ||
        value.includes("$${") ||
        /[\x00-\x1f\x7f]/.test(value))
    )
      return `${field} contains unsafe dialplan data`;
  }
  return null;
}

export async function validatePcre(pattern: unknown): Promise<string | null> {
  if (
    typeof pattern !== "string" ||
    !pattern ||
    pattern.length > 512 ||
    /[\s~\x00-\x1f\x7f]/.test(pattern)
  )
    return "PCRE must be 1–512 characters without whitespace or the reserved ~ delimiter";
  if (/%[aAbBcCdDfFgGlLpPsSuUwWxXzZ1-9]/.test(pattern))
    return "Legacy Lua pattern requires explicit conversion to PCRE";
  // Same PCRE2 family used by FreeSWITCH 1.11. Never use JavaScript RegExp here.
  const proc = Bun.spawn(["pcre2grep", "-q", "-e", pattern], {
    stdin: new Blob(["\n"]),
    stdout: "ignore",
    stderr: "pipe",
  });
  const diagnostic = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return code === 0 || code === 1 ? null : `Invalid PCRE: ${diagnostic.trim()}`;
}
