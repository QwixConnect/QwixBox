-- Ring group: simultaneous or sequential, with failover.

local qwixbox = require "qwixbox"

local domain, id, depth = argv[1], argv[2], tonumber(argv[3] or (session and session:getVariable("qwixbox_depth")) or "0")

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

-- Member policy (I05). A group bridges user/ legs itself, so extension.lua - where a direct call
-- applies DND and call waiting - never runs for a member: a member on DND was rung anyway, and so
-- was one already on a call with call waiting off. Apply the same two rules here, from the same
-- call profile and the same limit counter. A member with no profile rings, as extension.lua would.
local LIMIT_BACKEND = "hash"
local function available(m)
  local profile = qwixbox.fetch("call", domain, m.number)
  if not profile then return true end
  if profile.dnd then
    qwixbox.log("ring_group", "info", "%s: skipping %s (DND)", group.name, m.number)
    return false
  end
  if profile.callWaitingEnabled == false then
    local usage = tonumber(freeswitch.API():execute("limit_usage",
      string.format("%s %s %s", LIMIT_BACKEND, domain, m.number)) or "0") or 0
    if usage >= 1 then
      qwixbox.log("ring_group", "info", "%s: skipping %s (on a call, call waiting off)", group.name, m.number)
      return false
    end
  end
  return true
end

local members = {}
for _, m in ipairs(group.members or {}) do
  if available(m) then table.insert(members, m) end
end
if #members == 0 then
  qwixbox.log("ring_group", "warning", "ring group %s has no available members", group.name)
  if group.failoverType then
    qwixbox.go(session, domain, group.failoverType, group.failoverId, depth)
  else
    session:hangup("NO_ROUTE_DESTINATION")
  end
  return
end

if group.strategy == "random" then
  for i = #members, 2, -1 do
    local j = math.random(i)
    members[i], members[j] = members[j], members[i]
  end
end
local separator = (group.strategy == "sequential" or group.strategy == "random") and "|" or ","
local ring_timeout = group.ringTimeoutSec or 30

local dials = {}
for _, m in ipairs(members) do
  -- A member who answers is on a call: count it against the member's slot, on the member's leg,
  -- so a later call finds them busy and the count drops when that leg hangs up.
  local vars = { string.format("execute_on_answer=limit %s %s %s", LIMIT_BACKEND, domain, m.number) }
  if m.delaySec and m.delaySec > 0 and separator == "," then
    table.insert(vars, string.format("leg_delay_start=%d", m.delaySec))
  end
  -- Sequential: each member rings for the ring timeout in turn. call_timeout bounds the whole
  -- bridge, not a leg, so with only that set the first member used up all of it and the rest
  -- never rang (I05, observed live).
  if separator == "|" then table.insert(vars, string.format("leg_timeout=%d", ring_timeout)) end
  local leg = string.format("[%s]user/%s@%s", table.concat(vars, ","), m.number, domain)
  table.insert(dials, leg)
end

local dial_string = table.concat(dials, separator)

qwixbox.log("ring_group", "info", "%s: ringing %d member(s) %s for %ds%s",
  group.name, #members, (separator == "|") and "sequentially" or "simultaneously",
  ring_timeout, (separator == "|") and " each" or "")

session:execute("set", "call_timeout=" .. tostring(separator == "|" and ring_timeout * #members or ring_timeout))
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
  session:hangup("NO_ANSWER")
end
