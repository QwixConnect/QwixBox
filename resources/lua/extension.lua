-- Per-extension call handling: DND, forwarding, call waiting, voicemail treatment.

local qwixbox = require "qwixbox"

local domain, number = argv[1], argv[2]
local depth = tonumber(argv[3] or "") or tonumber(session:getVariable("qwixbox_depth") or "") or 0

if not session or not session:ready() then return end
if not domain or not number then
  qwixbox.log("extension", "err", "usage: extension.lua <domain> <number>")
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end

local ext = qwixbox.fetch("call", domain, number) or {}
local ring_timeout = ext.ringTimeoutSec or 25

if ext.forwardAllTo and ext.forwardAllTo ~= "" then
  qwixbox.log("extension", "info", "%s@%s: forwarded to %s", number, domain, ext.forwardAllTo)
  session:execute("set", "sip_h_X-Forwarded-From=" .. number)
  qwixbox.go(session, domain, "external", ext.forwardAllTo, depth, number)
  return
end

local function no_answer_treatment(reason, forward_to)
  if not session:ready() then return end

  if forward_to and forward_to ~= "" then
    qwixbox.log("extension", "info", "%s@%s: %s, forwarding to %s", number, domain, reason, forward_to)
    session:execute("set", "sip_h_X-Forwarded-From=" .. number)
    qwixbox.go(session, domain, "external", forward_to, depth, number)
    return
  end

  if ext.voicemailEnabled == false then
    qwixbox.log("extension", "info", "%s@%s: %s, no voicemail - hanging up", number, domain, reason)
    session:hangup(reason == "busy" and "USER_BUSY" or "NO_ANSWER")
    return
  end

  qwixbox.log("extension", "info", "%s@%s: %s, taking a message", number, domain, reason)
  session:execute("answer", "")
  session:execute("voicemail", string.format("default %s %s", domain, number))
end

if ext.dnd then
  qwixbox.log("extension", "info", "%s@%s: DND", number, domain)
  no_answer_treatment("dnd", ext.forwardNoAnswerTo)
  return
end

local LIMIT_BACKEND = "hash"

if ext.callWaitingEnabled == false then
  local usage = tonumber(
    freeswitch.API():execute("limit_usage",
      string.format("%s %s %s", LIMIT_BACKEND, domain, number)) or "0") or 0
  if usage >= 1 then
    qwixbox.log("extension", "info", "%s@%s: on a call and call waiting is off", number, domain)
    no_answer_treatment("busy", ext.forwardBusyTo)
    return
  end
end

session:execute("limit", string.format("%s %s %s", LIMIT_BACKEND, domain, number))

session:execute("set", "call_timeout=" .. tostring(ring_timeout))
session:execute("set", "hangup_after_bridge=true")
session:execute("set", "continue_on_fail=true")
session:execute("set", "ignore_early_media=false")

session:execute("bridge", string.format("user/%s@%s", number, domain))

if not session:ready() then return end

local cause = session:getVariable("originate_disposition") or "NO_ANSWER"
if cause == "USER_BUSY" or cause == "CALL_REJECTED" then
  no_answer_treatment("busy", ext.forwardBusyTo)
else
  no_answer_treatment("no answer", ext.forwardNoAnswerTo)
end
