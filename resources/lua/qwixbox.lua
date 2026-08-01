-- Shared helpers. qwixbox.go() is the one place a polymorphic destination resolves, and it
-- enforces depth against routing loops - every call-time script forwards argv[3].

local M = {}

M.REDIS_PROFILE = "default"

function M.log(tag, level, fmt, ...)
  freeswitch.consoleLog(level, "[" .. tag .. "] " .. string.format(fmt, ...) .. "\n")
end

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

local MAX_DEPTH = 10

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
