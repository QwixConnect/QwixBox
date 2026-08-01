-- Ring group: simultaneous or sequential, with failover.

local qwixbox = require "qwixbox"

local domain, id, depth = argv[1], argv[2], tonumber(argv[3] or "0")

if not session or not session:ready() then return end
if not domain or not id then
  qwixbox.log("ring_group", "err", "usage: ring_group.lua <domain> <id>")
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end

local group = qwixbox.fetch("rg", domain, id)
if not group then
  qwixbox.log("ring_group", "err", "no ring group %s@%s in cache", id, domain)
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end

local members = group.members or {}
if #members == 0 then
  qwixbox.log("ring_group", "warning", "ring group %s has no enabled members", group.name)
  if group.failoverType then
    qwixbox.go(session, domain, group.failoverType, group.failoverId, depth)
  else
    session:hangup("NO_ROUTE_DESTINATION")
  end
  return
end

local separator = (group.strategy == "sequential") and "|" or ","

local dials = {}
for _, m in ipairs(members) do
  local leg = string.format("user/%s@%s", m.number, domain)
  if m.delaySec and m.delaySec > 0 and separator == "," then
    leg = string.format("[leg_delay_start=%d]%s", m.delaySec, leg)
  end
  table.insert(dials, leg)
end

local dial_string = table.concat(dials, separator)

qwixbox.log("ring_group", "info", "%s: ringing %d member(s) %s for %ds",
  group.name, #members, (separator == "|") and "sequentially" or "simultaneously",
  group.ringTimeoutSec or 30)

session:execute("set", "call_timeout=" .. tostring(group.ringTimeoutSec or 30))
session:execute("set", "hangup_after_bridge=true")
session:execute("set", "continue_on_fail=true")
session:execute("set", "ignore_early_media=true")

session:execute("bridge", dial_string)

if not session:ready() then return end

local cause = session:getVariable("originate_disposition") or "NO_ANSWER"
qwixbox.log("ring_group", "info", "%s: nobody answered (%s)", group.name, cause)

if group.failoverType then
  qwixbox.go(session, domain, group.failoverType, group.failoverId, depth)
else
  session:execute("answer", "")
  session:execute("voicemail", string.format("default %s %s", domain, group.number))
end
