-- Run with lua in the disposable Debian container. Exercise the actual IVR script.
local root = arg[1] or "/work"
package.path = root .. "/resources/lua/?.lua;" .. package.path
freeswitch = { consoleLog = function() end }
session = {
  ready = function() return true end,
  getVariable = function() return nil end,
  answer = function() end,
  execute = function() end,
  playAndGetDigits = function(_, _, _, _, _, terminator)
    assert(terminator == "", "# must not be consumed as a terminator")
    return "#"
  end,
}
local qwixbox = require "qwixbox"
qwixbox.fetch = function() return { name = "Test", options = { ["#"] = { type = "extension", id = "101" } } } end
local dispatched = false
qwixbox.go = function(_, domain, kind, id)
  assert(domain == "a.test" and kind == "extension" and id == "101")
  dispatched = true
end
argv = { "a.test", "menu", "0" }
dofile(root .. "/resources/lua/ivr.lua")
assert(dispatched, "# option was never dispatched")
print("PASS IVR # reaches its configured destination")
