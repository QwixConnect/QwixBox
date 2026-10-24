-- Feature codes (*72, *78, ...). Subject is the authenticated user, never From:.

local qwixbox = require "qwixbox"

local domain, user, what, value = argv[1], argv[2], argv[3], argv[4]

if not session or not session:ready() then return end
if not domain or not user or not what then
  qwixbox.log("feature", "err", "usage: feature_code.lua <domain> <user> <action> [value]")
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end

session:answer()
session:execute("playback", "silence_stream://300")

if value and value ~= "" and not value:match("^[0-9*#+]+$") then
  qwixbox.log("feature", "warning", "%s@%s: refusing forward target %q", user, domain, value)
  session:streamFile("ivr/ivr-that_was_an_invalid_entry.wav")
  session:hangup("NORMAL_CLEARING")
  return
end

local FIELDS = {
  dnd_on          = { field = "dnd", value = "true" },
  dnd_off         = { field = "dnd", value = "false" },
  fwd_all_set     = { field = "forwardAllTo", value = value },
  fwd_all_clear   = { field = "forwardAllTo", value = nil },
  fwd_busy_set    = { field = "forwardBusyTo", value = value },
  fwd_busy_clear  = { field = "forwardBusyTo", value = nil },
  fwd_na_set      = { field = "forwardNoAnswerTo", value = value },
  fwd_na_clear    = { field = "forwardNoAnswerTo", value = nil },
}

local change = FIELDS[what]
if not change then
  qwixbox.log("feature", "err", "unknown feature action %q", tostring(what))
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end

if what:match("_set$") and (not value or value == "") then
  session:streamFile("ivr/ivr-that_was_an_invalid_entry.wav")
  session:hangup("NORMAL_CLEARING")
  return
end

local encoded
if change.value == nil then
  encoded = "null"
elseif change.value == "true" or change.value == "false" then
  encoded = change.value
else
  encoded = qwixbox.json_encode(change.value)
end

local payload = string.format('{"domain":%s,"number":%s,"%s":%s}',
  qwixbox.json_encode(domain), qwixbox.json_encode(user), change.field, encoded)

local applied, reply = qwixbox.api_post("/fs/feature", payload)

if applied then
  qwixbox.log("feature", "info", "%s@%s: %s -> %s", user, domain, change.field, tostring(change.value))
  session:streamFile("tone_stream://%(200,100,600);%(200,100,800)")
else
  qwixbox.log("feature", "err", "%s@%s: %s NOT applied (%s)",
    user, domain, change.field, tostring(reply))
  session:streamFile("ivr/ivr-call_cannot_be_completed_at_this_time.wav")
end

session:hangup("NORMAL_CLEARING")
