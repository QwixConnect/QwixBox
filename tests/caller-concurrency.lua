-- Run with lua from the repository root: lua tests/caller-concurrency.lua [root]. I06: the warm
-- tier counts an authenticated caller against its own limit slot, which call waiting reads.
local root = arg[1] or "."
package.path = root .. "/resources/lua/?.lua;" .. package.path

local objects, cache = {}, {}
local function put(key, value)
  objects[#objects + 1] = value
  cache[key] = "obj:" .. #objects
end
put("qwixbox:tenant:a.test", { organizationId = "org1", enabled = true })
put("qwixbox:routes:a.test", {
  { patternSyntax = "pcre", pattern = "^9[0-9]+$", isEmergency = false,
    trunk = { id = "t1", host = "carrier.test", port = 5060 } },
})
put("qwixbox:call:a.test:101", { callerIdNumber = "15550101" })
cache["qwixbox:dir:a.test:102"] = "<user/>"

freeswitch = {
  consoleLog = function() end,
  JSON = function() return { decode = function(_, s) return objects[tonumber(s:match("^obj:(%d+)$"))] end } end,
  API = function()
    return { execute = function(_, cmd, args)
      if cmd == "hiredis_raw" then return cache[args:match("^%S+ GET (%S+)$")] or "" end
      if cmd == "regex" then
        local value, pattern = args:match("^m:~(.-)~(.*)$")
        return tostring(pattern == "^9[0-9]+$" and value:match("^9%d+$") ~= nil)
      end
    end }
  end,
}

local function dialplan(destination, caller)
  local headers = {
    ["Caller-Destination-Number"] = destination,
    ["variable_sip_h_X-Tenant-Domain"] = "a.test",
    ["variable_sip_h_X-Auth-User"] = caller,
    ["Hunt-Context"] = "tenant_org1",
  }
  XML_REQUEST = { section = "dialplan" }
  params = { getHeader = function(_, name) return headers[name] end }
  XML_STRING = nil
  dofile(root .. "/resources/lua/xml_handler.lua")
  return assert(XML_STRING, "no answer for " .. destination)
end

local slot = '<action application="limit" data="hash a.test 101"/>'
for _, case in ipairs({ { "102", "internal" }, { "95551234", "outbound" }, { "*78", "feature code" } }) do
  local xml = dialplan(case[1], "101")
  local at = assert(xml:find(slot, 1, true), case[2] .. " call does not count the caller")
  assert(at == xml:find("<action", 1, true), case[2] .. ": the caller is counted after routing")
end
assert(not dialplan("102", nil):find('application="limit"', 1, true),
  "a call with no authenticated caller counted a slot")
print("PASS the warm tier counts an authenticated caller's own slot (I06)")
