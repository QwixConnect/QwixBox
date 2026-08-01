-- Primary XML handler, answering from Redis. Declining is how a request falls through to
-- mod_xml_curl. The directory dial-string here must match routes/fs-xml.ts.

local M = {}

local REDIS_PROFILE = "default"
local DEBUG = false

local function log(level, fmt, ...)
  freeswitch.consoleLog(level, "[xml_handler] " .. string.format(fmt, ...) .. "\n")
end

local function debug(fmt, ...)
  if DEBUG then log("debug", fmt, ...) end
end

local api = freeswitch.API()

local function redis_get(key)
  local ok, result = pcall(function()
    return api:execute("hiredis_raw", REDIS_PROFILE .. " GET " .. key)
  end)
  if not ok or not result then
    log("warning", "redis GET %s failed", key)
    return nil
  end
  if result == "" or result:sub(1, 4) == "-ERR" then
    return nil
  end
  return result
end

local NOT_FOUND = [[<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
  <section name="result">
    <result status="not found"/>
  </section>
</document>]]

local function xml_escape(s)
  s = tostring(s or "")
  s = s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;")
  s = s:gsub('"', "&quot;"):gsub("'", "&apos;")
  return s
end

local function document(section, inner)
  return string.format(
    [[<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<document type="freeswitch/xml">
  <section name="%s">
%s
  </section>
</document>]],
    section,
    inner
  )
end

local function json_decode(str)
  if not str then return nil end
  local ok, obj = pcall(function()
    return freeswitch.JSON():decode(str)
  end)
  if ok then return obj end
  return nil
end

function M.directory(req, p)
  local domain = p:getHeader("domain") or p:getHeader("sip_auth_realm") or req.key_value
  local user = p:getHeader("user") or p:getHeader("sip_auth_username")

  if not domain or not user then
    debug("directory request without user/domain - declining")
    return nil
  end

  local cached = redis_get("qwixbox:dir:" .. domain .. ":" .. user)
  if cached then
    debug("directory hit %s@%s", user, domain)

    local egress = os.getenv("QWIXBOX_KAM_EGRESS") or "127.0.0.1:5070"
    local dial_string = string.format(
      "{^^|sip_invite_domain=${dialed_domain}|presence_id=${dialed_user}@${dialed_domain}" ..
      "|sip_route_uri=sip:%s}sofia/external/${dialed_user}@${dialed_domain}",
      egress)

    return document(
      "directory",
      string.format(
        [[    <domain name="%s">
      <params>
        <param name="dial-string" value="%s"/>
      </params>
%s
    </domain>]],
        xml_escape(domain),
        xml_escape(dial_string),
        cached
      )
    )
  end

  log("warning", "directory MISS %s@%s - falling through", user, domain)
  return nil
end

local function action(app, data)
  return string.format(
    '          <action application="%s" data="%s"/>',
    xml_escape(app),
    xml_escape(data)
  )
end

local function regex_escape(s)
  return (s:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?{}|\\]", "\\%0"))
end

local function extension_xml(name, destination, actions)
  return string.format(
    [[      <extension name="%s">
        <condition field="destination_number" expression="^%s$">
%s
        </condition>
      </extension>]],
    xml_escape(name),
    xml_escape(regex_escape(destination)),
    table.concat(actions, "\n")
  )
end

local function context_xml(context, body)
  return string.format('    <context name="%s">\n%s\n    </context>', xml_escape(context), body)
end

local function build_outbound(route, destination, tenant)
  local number = destination
  if route.stripDigits and route.stripDigits > 0 then
    number = number:sub(route.stripDigits + 1)
  end
  if route.prependDigits and route.prependDigits ~= "" then
    number = route.prependDigits .. number
  end

  local actions = {}

  table.insert(actions, action("set", "sip_h_X-Tenant-ID=" .. (tenant.organizationId or "")))
  table.insert(actions, action("set", "sip_h_X-Auth-User=${sip_auth_username}"))
  table.insert(actions, action("set", "sip_h_X-Correlation-ID=${uuid}"))

  local transport = route.trunk.transport or "udp"
  table.insert(actions, action("set", "sip_h_X-Trunk-ID=" .. route.trunk.id))
  table.insert(actions, action("set", string.format(
    "sip_h_X-Trunk-Target=%s:%d;transport=%s",
    route.trunk.host, route.trunk.port or 5060, transport)))

  if route.isEmergency then
    table.insert(actions, action("set", "sip_h_X-Emergency=true"))
    table.insert(actions, action("set", "emergency_call=true"))
    table.insert(actions, action("set", "ignore_early_media=true"))
  end

  if route.callerIdOverride and route.callerIdOverride ~= "" then
    table.insert(actions, action("set", "effective_caller_id_number=" .. route.callerIdOverride))
  end

  table.insert(actions, action("set", "hangup_after_bridge=true"))

  local egress = os.getenv("QWIXBOX_KAM_EGRESS") or "127.0.0.1:5070"
  table.insert(actions, action("bridge", string.format("sofia/external/%s@%s", number, egress)))

  return actions
end

function M.dialplan(req, p)
  local destination = p:getHeader("Caller-Destination-Number")
    or p:getHeader("destination_number")
  local domain = p:getHeader("variable_sip_auth_realm")
    or p:getHeader("variable_domain_name")
    or p:getHeader("Caller-Context")

  if not destination or not domain then
    debug("dialplan request missing destination or domain - declining")
    return nil
  end

  local tenant = json_decode(redis_get("qwixbox:tenant:" .. domain))
  if not tenant then
    log("warning", "dialplan MISS: no tenant for %s - falling through", domain)
    return nil
  end
  if tenant.enabled == false then
    log("warning", "tenant %s is disabled - rejecting", domain)
    return document(
      "dialplan",
      context_xml(
        "tenant_" .. tenant.organizationId,
        extension_xml("disabled", destination, { action("hangup", "SERVICE_UNAVAILABLE") })
      )
    )
  end

  local context = "tenant_" .. tenant.organizationId
  local routes = json_decode(redis_get("qwixbox:routes:" .. domain)) or {}

  for _, route in ipairs(routes) do
    if route.isEmergency and destination:match(route.pattern) then
      log("notice", "EMERGENCY call to %s from %s", destination, domain)
      return document(
        "dialplan",
        context_xml(context, extension_xml("emergency", destination, build_outbound(route, destination, tenant)))
      )
    end
  end

  if destination == "*97" or destination == "*98" then
    local caller = p:getHeader("variable_sip_h_X-Auth-User") or p:getHeader("Caller-Username")
    local vm_args
    if destination == "*97" and caller then
      vm_args = string.format("check auth default %s %s", domain, caller)
    else
      if destination == "*97" then
        log("warning", "*97 from %s with no authenticated user - prompting for a mailbox", domain)
      end
      vm_args = string.format("check default %s", domain)
    end
    return document("dialplan", context_xml(context, extension_xml("voicemail_check", destination, {
      action("answer", ""),
      action("sleep", "500"),
      action("voicemail", vm_args),
    })))
  end

  local FEATURE_CODES = {
    ["*78"] = "dnd_on",
    ["*79"] = "dnd_off",
    ["*73"] = "fwd_all_clear",
    ["*91"] = "fwd_busy_clear",
    ["*93"] = "fwd_na_clear",
  }
  local FEATURE_PREFIXES = {
    ["*72"] = "fwd_all_set",
    ["*90"] = "fwd_busy_set",
    ["*92"] = "fwd_na_set",
  }

  local feature_action, feature_value = FEATURE_CODES[destination], nil
  if not feature_action and #destination > 3 then
    local prefix = destination:sub(1, 3)
    if FEATURE_PREFIXES[prefix] then
      feature_action = FEATURE_PREFIXES[prefix]
      feature_value = destination:sub(4)
    end
  end

  if feature_action then
    local caller = p:getHeader("variable_sip_h_X-Auth-User") or p:getHeader("Caller-Username")
    if not caller then
      log("warning", "feature code %s from %s with no authenticated user - refusing",
        destination, domain)
      return document("dialplan", context_xml(context,
        extension_xml("feature_denied", destination, { action("hangup", "CALL_REJECTED") })))
    end
    return document("dialplan", context_xml(context,
      extension_xml("feature_code", destination, {
        action("lua", string.format("feature_code.lua %s %s %s %s",
          domain, caller, feature_action, feature_value or "")),
      })))
  end

  local ext = redis_get("qwixbox:dir:" .. domain .. ":" .. destination)
  if ext then
    return document(
      "dialplan",
      context_xml(
        context,
        extension_xml("internal", destination, {
          action("lua", string.format("extension.lua %s %s", domain, destination)),
        })
      )
    )
  end

  local function destination_actions(dtype, did_id)
    local actions = {}
    if dtype == "extension" then
      table.insert(actions, action("lua", string.format("extension.lua %s %s", domain, did_id)))
    elseif dtype == "ivr" then
      table.insert(actions, action("answer", ""))
      table.insert(actions, action("lua", string.format("ivr.lua %s %s", domain, did_id)))
    elseif dtype == "ring_group" then
      table.insert(actions, action("lua", string.format("ring_group.lua %s %s", domain, did_id)))
    elseif dtype == "time_condition" then
      table.insert(actions, action("lua", string.format("time_condition.lua %s %s", domain, did_id)))
    elseif dtype == "fax" then
      table.insert(actions, action("answer", ""))
      table.insert(actions, action("playback", "silence_stream://2000"))
      table.insert(actions, action("lua", string.format("fax_receive.lua %s %s", domain, destination)))
    elseif dtype == "voicemail" then
      table.insert(actions, action("answer", ""))
      table.insert(actions, action("voicemail", string.format("default %s %s", domain, did_id)))
    else
      table.insert(actions, action("hangup", "UNALLOCATED_NUMBER"))
    end
    return actions
  end

  local did = json_decode(redis_get("qwixbox:did:" .. domain .. ":" .. destination))
  if did then
    return document("dialplan", context_xml(context,
      extension_xml("did", destination, destination_actions(did.destinationType, did.destinationId))))
  end

  local feature = json_decode(redis_get("qwixbox:num:" .. domain .. ":" .. destination))
  if feature then
    return document("dialplan", context_xml(context,
      extension_xml("feature", destination, destination_actions(feature.type, feature.id))))
  end

  for _, route in ipairs(routes) do
    if not route.isEmergency and destination:match(route.pattern) then
      if not route.trunk then
        log("warning", "route %s matched but has no trunk", route.id)
      else
        return document(
          "dialplan",
          context_xml(context, extension_xml("outbound", destination, build_outbound(route, destination, tenant)))
        )
      end
    end
  end

  debug("no route for %s@%s", destination, domain)
  return document(
    "dialplan",
    context_xml(context, extension_xml("no_route", destination, { action("hangup", "UNALLOCATED_NUMBER") }))
  )
end

local section = XML_REQUEST["section"]
local result = nil

local ok, err = pcall(function()
  if section == "directory" then
    result = M.directory(XML_REQUEST, params)
  elseif section == "dialplan" then
    result = M.dialplan(XML_REQUEST, params)
  end
end)

if not ok then
  log("err", "handler error: %s", tostring(err))
  result = nil
end

XML_STRING = result
