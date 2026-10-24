local qwixbox = require "qwixbox"
if not session or not session:ready() then return end
qwixbox.go(session, argv[1], argv[2], argv[3], tonumber(session:getVariable("qwixbox_depth")) or 0)
