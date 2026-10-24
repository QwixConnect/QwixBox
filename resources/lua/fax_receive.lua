-- Inbound fax receive to TIFF, then notify the API.

local domain = argv[1]
local did = session and session:getVariable("qwixbox_did") or argv[2]

local function log(level, fmt, ...)
  freeswitch.consoleLog(level, "[fax_receive] " .. string.format(fmt, ...) .. "\n")
end

if not session or not session:ready() then
  log("err", "no session")
  return
end

if not domain or not domain:match("^[%w.-]+$") or not did then
  log("err", "usage: fax_receive.lua <domain> <did>")
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end

local uuid = session:getVariable("uuid")
local caller = session:getVariable("caller_id_number") or "unknown"
local caller_name = session:getVariable("caller_id_name") or ""

local spool = os.getenv("QWIXBOX_FAX_SPOOL") or "/var/spool/qwixbox-fax"
local day = os.date("%Y-%m-%d")
local dir = string.format("%s/%s/%s", spool, domain, day)
os.execute(string.format("mkdir -p '%s' && chmod -R 2770 '%s' 2>/dev/null", dir, spool))
local tiff = string.format("%s/%s.tif", dir, uuid)

log("notice", "inbound fax on %s@%s from %s -> %s", did, domain, caller, tiff)

session:execute("set", "fax_enable_t38=true")
session:execute("set", "fax_enable_t38_request=true")
session:execute("set", "t38_passthru=false")
session:execute("set", "fax_ident=" .. did)
session:execute("set", "fax_header=" .. domain)

session:answer()
session:execute("playback", "silence_stream://2000")

session:execute("rxfax", tiff)

local success = session:getVariable("fax_success")
local result_code = session:getVariable("fax_result_code")
local result_text = session:getVariable("fax_result_text")
local pages = session:getVariable("fax_document_transferred_pages") or "0"
local remote_id = session:getVariable("fax_remote_station_id") or ""

local ok = (success == "1")
log(ok and "notice" or "warning",
  "fax %s: pages=%s code=%s text=%s remote=%s",
  ok and "received" or "FAILED", pages, tostring(result_code), tostring(result_text), remote_id)

local qwixbox = require "qwixbox"

local payload = qwixbox.json_encode({ callUuid = uuid, domain = domain, did = did,
  callerNumber = caller, callerName = caller_name, filePath = tiff, pages = tonumber(pages) or 0,
  status = ok and "received" or "failed", failureReason = tostring(result_text), remoteStationId = remote_id })
local sent, reply = qwixbox.api_post("/fs/fax", payload)

if not sent then
  log("err", "could not report fax to the API (%s) - TIFF is on disk at %s", tostring(reply), tiff)
end

session:hangup("NORMAL_CLEARING")
