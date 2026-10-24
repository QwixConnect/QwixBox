-- IVR menu: greeting, digit collection, per-digit destinations.

local qwixbox = require "qwixbox"

local domain, id, depth = argv[1], argv[2], tonumber(argv[3] or (session and session:getVariable("qwixbox_depth")) or "0")

if not session or not session:ready() then return end
if not domain or not id then
  qwixbox.log("ivr", "err", "usage: ivr.lua <domain> <id>")
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end

local menu = qwixbox.fetch("ivr", domain, id)
if not menu then
  qwixbox.log("ivr", "err", "no IVR menu %s@%s in cache", id, domain)
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end

session:answer()
session:execute("playback", "silence_stream://500")

local function safe_sound(sound)
  return sound and sound:match("^[a-z0-9_][a-z0-9_/.-]*$") and not sound:find("..", 1, true)
end
if (menu.greetingSound and not safe_sound(menu.greetingSound)) or (menu.invalidSound and not safe_sound(menu.invalidSound)) then
  session:hangup("CALL_REJECTED")
  return
end
local greeting = menu.greetingSound or "silence_stream://1000"
local invalid = menu.invalidSound or "silence_stream://500"
local timeout_ms = (menu.timeoutSec or 5) * 1000
local max_retries = menu.maxRetries or 3

local options = menu.options or {}

for attempt = 1, max_retries do
  if not session:ready() then return end

  -- All twelve keys are choices. A terminator would consume # before option lookup.
  local digit = session:playAndGetDigits(1, 1, 1, timeout_ms, "", greeting, invalid, "[0-9*#]")

  if digit and digit ~= "" then
    local choice = options[digit]
    if choice then
      qwixbox.log("ivr", "info", "%s: caller pressed %s -> %s", menu.name, digit, tostring(choice.type))
      qwixbox.go(session, domain, choice.type, choice.id, depth)
      return
    end
    qwixbox.log("ivr", "info", "%s: invalid digit %s (attempt %d/%d)",
      menu.name, digit, attempt, max_retries)
    session:execute("playback", invalid)
  else
    qwixbox.log("ivr", "info", "%s: no digit (attempt %d/%d)", menu.name, attempt, max_retries)
  end
end

qwixbox.log("ivr", "info", "%s: exhausted %d attempts -> %s",
  menu.name, max_retries, tostring(menu.timeoutType))

if menu.timeoutType then
  qwixbox.go(session, domain, menu.timeoutType, menu.timeoutId, depth)
else
  session:hangup("NO_ROUTE_DESTINATION")
end
