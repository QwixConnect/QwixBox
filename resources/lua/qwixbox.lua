--[[
  Shared helpers for the call-time scripts.

  Loaded with `require "qwixbox"` - lua.conf.xml sets script-directory so this resolves.

  Destinations are polymorphic: an inbound route, an IVR option, a ring-group failover and
  both branches of a time condition all point at "an extension, or a ring group, or an IVR,
  or...". Dispatching that in one place means a new destination type is added once rather
  than in four scripts that then drift apart.
--]]

local M = {}

M.REDIS_PROFILE = "default"

function M.log(tag, level, fmt, ...)
  freeswitch.consoleLog(level, "[" .. tag .. "] " .. string.format(fmt, ...) .. "\n")
end

--[[ Redis via mod_hiredis. Synchronous, with a 200ms profile timeout - this runs mid-call, so
     a stall here is dead air the caller hears. ]]
function M.redis_get(key)
  local ok, result = pcall(function()
    return freeswitch.API():execute("hiredis_raw", M.REDIS_PROFILE .. " GET " .. key)
  end)
  if not ok or not result or result == "" or result:sub(1, 4) == "-ERR" then
    return nil
  end
  return result
end

function M.json_decode(str)
  if not str then return nil end
  local ok, obj = pcall(function() return freeswitch.JSON():decode(str) end)
  if ok then return obj end
  return nil
end

function M.fetch(kind, domain, id)
  return M.json_decode(M.redis_get(string.format("qwixbox:%s:%s:%s", kind, domain, id)))
end

--[[ ---------------------------------------------------------------------------------------
  Destination dispatch.

  `depth` guards against a loop: an IVR option pointing at a time condition whose no-match
  points back at the IVR is a configuration a customer can build by accident, and without a
  ceiling it recurses until FreeSWITCH runs out of stack mid-call.
------------------------------------------------------------------------------------------ ]]

local MAX_DEPTH = 10

--[[ POST JSON to the API, authenticated as the FreeSWITCH gateway.

     This exists because mod_curl's `curl` API is NOT the curl command line, and the difference
     is silent. Its grammar is:

       curl <url> (headers|json|content-type <type>|connect-timeout <s>|timeout <s>
                  |append_headers <name:value>|insecure|secure|proxy <url>) (get|post|put|delete <data>)

     Flags like -X, -H, -u and -d are simply not understood - they were parsed as part of the
     URL, no Authorization header was sent, and the request went out as a GET. Every feature code
     (*72, *90, DND) and every fax notification failed with "unauthorized", and only the log said
     so. Anything calling the API from Lua must go through here.

     The secret travels in X-Gateway-Secret rather than Basic because `append_headers` splits on
     whitespace, so "Authorization:Basic <b64>" cannot survive the parser - it returns
     "-ERR no reply". A header value with no space can.

     The payload must contain no spaces for the same reason. Callers build compact JSON. ]]
function M.api_post(path, payload)
  local base = os.getenv("QWIXBOX_API_BASE") or "http://127.0.0.1:3000"
  local secret = os.getenv("QWIXBOX_FS_GATEWAY_SECRET") or ""

  local cmd = string.format(
    "%s%s content-type application/json append_headers X-Gateway-Secret:%s timeout 5 post %s",
    base, path, secret, payload)

  local ok, reply = pcall(function() return freeswitch.API():execute("curl", cmd) end)
  if not ok then
    return false, tostring(reply)
  end
  return (reply and reply:find('"ok"%s*:%s*true') ~= nil), reply
end

function M.go(session, domain, dtype, did, depth)
  depth = (depth or 0) + 1
  if depth > MAX_DEPTH then
    M.log("qwixbox", "err", "destination chain exceeded %d hops at %s/%s - hanging up",
      MAX_DEPTH, tostring(dtype), tostring(did))
    session:hangup("EXCHANGE_ROUTING_ERROR")
    return
  end

  if not session:ready() then
    M.log("qwixbox", "info", "caller hung up before reaching %s", tostring(dtype))
    return
  end

  if dtype == "extension" then
    -- Delegated rather than bridged here, so the user's own DND and forwarding apply wherever
    -- the call came from - an inbound DID, an IVR option, a ring-group failover.
    session:execute("lua", string.format("extension.lua %s %s %d", domain, tostring(did), depth))

  elseif dtype == "ring_group" then
    session:execute("lua", string.format("ring_group.lua %s %s %d", domain, did, depth))

  elseif dtype == "ivr" then
    session:execute("lua", string.format("ivr.lua %s %s %d", domain, did, depth))

  elseif dtype == "time_condition" then
    session:execute("lua", string.format("time_condition.lua %s %s %d", domain, did, depth))

  elseif dtype == "voicemail" then
    session:execute("answer", "")
    session:execute("voicemail", string.format("default %s %s", domain, tostring(did)))

  elseif dtype == "fax" then
    session:execute("answer", "")
    session:execute("playback", "silence_stream://2000")
    session:execute("lua", string.format("fax_receive.lua %s %s", domain, tostring(did)))

  elseif dtype == "external" then
    --[[ An external number IS an outbound call, so it has to go through outbound route matching:
         the pattern, the strip/prepend translation, and the trunk that decision selects.

         This used to bridge straight to Kamailio's egress port. That skipped all of it - no
         route was matched, so no X-Trunk-Target header was set, so Kamailio had no carrier to
         relay to and answered 404. Every call forwarded to an external number was dropped, which
         is all three forwarding kinds and any IVR option pointing at an outside line.

         Transferring re-enters the dialplan, where xml_handler does the matching exactly as it
         does for a number dialled from a handset. One code path for outbound, not two.

         The hop count travels in a channel variable because a transfer starts the dialplan over
         and argv is not carried across it - without this, A forwarding to B forwarding back to A
         would loop until something else broke. ]]
    session:execute("set", "qwixbox_depth=" .. tostring(depth))
    local context = session:getVariable("context")
    if not context or context == "" then
      M.log("qwixbox", "err", "no context on the channel - cannot route %s externally", tostring(did))
      session:hangup("EXCHANGE_ROUTING_ERROR")
      return
    end
    session:execute("transfer", string.format("%s XML %s", tostring(did), context))

  elseif dtype == "hangup" then
    session:hangup("NORMAL_CLEARING")

  else
    M.log("qwixbox", "warning", "unknown destination type '%s' - hanging up", tostring(dtype))
    session:hangup("UNALLOCATED_NUMBER")
  end
end

return M
