-- Shared helpers. qwixbox.go() is the one place a polymorphic destination resolves, and it
-- enforces depth against routing loops - every call-time script forwards argv[3].

local M = {}

M.REDIS_PROFILE = "default"

function M.log(tag, level, fmt, ...)
  freeswitch.consoleLog(level, "[" .. tag .. "] " .. string.format(fmt, ...) .. "\n")
end

function M.redis_get(key)
  if not key or key:find("[%% %c]") then return nil end
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
  local cached = M.json_decode(M.redis_get(string.format("qwixbox:%s:%s:%s", kind, domain, id)))
  if cached then return cached end
  local ok, reply = M.api_post("/fs/state", M.json_encode({ kind = kind, domain = domain, id = id }))
  local result = ok and M.json_decode(reply)
  return result and result.data or nil
end

-- FreeSWITCH regex returns the TEXT "true" or "false"; both strings are truthy in Lua.
-- m:~ selects an explicit delimiter, preserving PCRE alternation with |.
function M.regex_match(value, pattern)
  if not value or not pattern or pattern:find("[~%s%c]") or value:find("[~%s%c]") then return false end
  local ok, result = pcall(function() return freeswitch.API():execute("regex", "m:~" .. value .. "~" .. pattern) end)
  return ok and result and result:match("^%s*(.-)%s*$") == "true"
end

function M.json_encode(value)
  local function quote(s)
    return '"' .. s:gsub('[%z\1-\31\\"]', function(c)
      return string.format("\\u%04x", c:byte())
    end) .. '"'
  end
  if value == nil then return "null" end
  if type(value) == "string" then return quote(value) end
  if type(value) == "boolean" or type(value) == "number" then return tostring(value) end
  local fields = {}
  for k, v in pairs(value) do table.insert(fields, quote(k) .. ":" .. M.json_encode(v)) end
  return "{" .. table.concat(fields, ",") .. "}"
end

local MAX_DEPTH = 10

function M.api_post(path, payload)
  local base = os.getenv("QWIXBOX_API_BASE") or "http://127.0.0.1:3000"
  local secret = os.getenv("QWIXBOX_FS_GATEWAY_SECRET") or ""

  local cmd = string.format(
    "%s%s content-type application/json append_headers X-Gateway-Secret:%s timeout 5 post %s",
    base, path, secret, (payload:gsub(".", function(c) return string.format("%%%02X", c:byte()) end)))

  local ok, reply = pcall(function() return freeswitch.API():execute("curl", cmd) end)
  if not ok then
    return false, tostring(reply)
  end
  return (reply and reply:find('"ok"%s*:%s*true') ~= nil), reply
end

-- The forwarding decision below needs the API (D5): with it down, refuse rather than guess.
function M.api_healthy()
  local base = os.getenv("QWIXBOX_API_BASE") or "http://127.0.0.1:3000"
  local ok, reply = pcall(function() return freeswitch.API():execute("curl", base .. "/health timeout 2") end)
  return ok and reply ~= nil and reply:find('"database"%s*:%s*true') ~= nil
end

-- `via` is the extension whose forwarding setting this is, if any: it authorizes an external
-- destination and is the identity the forwarded leg presents and is counted against.
function M.go(session, domain, dtype, did, depth, via)
  depth = (tonumber(depth) or tonumber(session:getVariable("qwixbox_depth")) or 0) + 1
  session:setVariable("qwixbox_depth", tostring(depth))
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

  if not domain or not domain:match("^[%w.-]+$") or
      (dtype ~= "hangup" and dtype ~= "fax" and (not did or not tostring(did):match("^[%w_.*#+-]+$"))) then
    session:hangup("CALL_REJECTED")
    return
  end
  if dtype == "external" and not tostring(did):match("^%+?[0-9*#]+$") then
    session:hangup("CALL_REJECTED")
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
    -- A forward is the tenant's decision, never the caller's (R11). These variables authorize
    -- exactly this number on the next dialplan lookup, which is how a carrier-originated call
    -- reaches outbound routing at all. Only this script sets them: SIP headers arrive as sip_h_*.
    if session:getVariable("sip_h_X-Trusted-Peer") == "1" and not M.api_healthy() then
      M.log("qwixbox", "err", "API unavailable - refusing to forward a carrier call to %s", tostring(did))
      session:execute("pre_answer", "")
      session:execute("playback", "tone_stream://%(250,250,480,620);loops=4")
      -- Explicit: FreeSWITCH sends 480 for a SERVICE_UNAVAILABLE hangup, which tells a carrier
      -- the user is away. Kamailio forwards this 503 as 500 (RFC 3261 16.7); either 5xx lets
      -- the carrier try another route.
      session:execute("respond", "503 Service Unavailable")
      session:hangup("SERVICE_UNAVAILABLE")
      return
    end
    session:setVariable("qwixbox_forward_to", tostring(did))
    session:setVariable("qwixbox_forward_domain", domain)
    if via and tostring(via):match("^[%w_.-]+$") then
      session:setVariable("qwixbox_forward_from", tostring(via))
    else
      session:execute("unset", "qwixbox_forward_from")
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
