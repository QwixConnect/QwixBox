-- Business-hours and holiday routing. An inverted rule must break the loop when it matches,
-- or a later rule silently re-opens the holiday.

local qwixbox = require "qwixbox"

local domain, id, depth = argv[1], argv[2], tonumber(argv[3] or "0")

if not session or not session:ready() then return end
if not domain or not id then
  qwixbox.log("time_condition", "err", "usage: time_condition.lua <domain> <id>")
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end

local cond = qwixbox.fetch("tc", domain, id)
if not cond then
  qwixbox.log("time_condition", "err", "no time condition %s@%s in cache", id, domain)
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end

local function now_in(tz)
  local zone = (tz and tz ~= "") and tz or "Etc/UTC"
  local stamp = freeswitch.API():execute("strftime_tz", zone .. " %w,%H:%M,%Y-%m-%d")
  if stamp then
    local wday, hhmm, date = stamp:match("^(%d),(%d%d:%d%d),(%d%d%d%d%-%d%d%-%d%d)")
    if wday then
      return tonumber(wday), hhmm, date
    end
  end
  qwixbox.log("time_condition", "warning",
    "timezone '%s' did not resolve (%s) - falling back to the server clock",
    zone, tostring(stamp))
  local t = os.date("*t")
  return t.wday - 1, string.format("%02d:%02d", t.hour, t.min), os.date("%Y-%m-%d")
end

local wday, hhmm, today = now_in(cond.timezone)

local function rule_matches(rule)
  if rule.date and rule.date ~= today then return false end
  if rule.days then
    local ok = false
    for _, d in ipairs(rule.days) do
      if tonumber(d) == wday then ok = true break end
    end
    if not ok then return false end
  end
  if rule.start and hhmm < rule.start then return false end
  if rule["end"] and hhmm >= rule["end"] then return false end
  return true
end

local matched = false
for _, rule in ipairs(cond.rules or {}) do
  if rule_matches(rule) then
    if rule.invert then
      matched = false
      break
    end
    matched = true
  end
end

qwixbox.log("time_condition", "info", "%s: %s (%s %s in %s) -> %s branch",
  cond.name, matched and "MATCH" or "no match", today, hhmm, cond.timezone,
  matched and tostring(cond.matchType) or tostring(cond.noMatchType))

local dtype = matched and cond.matchType or cond.noMatchType
local did = matched and cond.matchId or cond.noMatchId

if not dtype then
  qwixbox.log("time_condition", "warning", "%s has no %s destination configured",
    cond.name, matched and "match" or "no-match")
  session:hangup("UNALLOCATED_NUMBER")
  return
end

qwixbox.go(session, domain, dtype, did, depth)
