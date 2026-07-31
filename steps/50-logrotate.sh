#!/usr/bin/env bash
### Log rotation. FreeSWITCH in particular will fill a disk given the chance, and a full disk
### on a PBX means dropped calls, not just missing logs.
###
# step-inputs: resources/conf/logrotate
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/common.sh"

require_root
load_config

TPL="$REPO_DIR/resources/conf/logrotate"

apt_install logrotate

### FreeSWITCH keeps its log file open, so the file must be rotated in place (copytruncate)
### or the daemon told to reopen it. mod_logfile reopens on SIGHUP, which is cleaner because
### copytruncate can lose the lines written during the copy.
deploy_template "$TPL/freeswitch" /etc/logrotate.d/freeswitch || true

deploy_template "$TPL/qwixbox-nginx" /etc/logrotate.d/qwixbox-nginx || true

### Postfix writes its own file rather than the journal: main.cf sets maillog_file, so postlogd
### owns the output. It is the only record of a voicemail or fax that failed to deliver, and of
### whether outbound mail was signed.
deploy_template "$TPL/qwixbox-postfix" /etc/logrotate.d/qwixbox-postfix || true

### Remove the file the msmtp-era config left behind, so an upgraded host is not rotating a log
### nothing writes to any more.
rm -f /etc/logrotate.d/qwixbox-msmtp

### Kamailio, rtpengine and the API all log to the journal, so their retention is a journald
### setting rather than a logrotate one.
deploy_template "$TPL/journald-90-qwixbox.conf" /etc/systemd/journald.conf.d/90-qwixbox.conf || true

systemctl restart systemd-journald

logrotate -d /etc/logrotate.d/freeswitch >/dev/null 2>&1 \
  || warn "logrotate reported a problem with the FreeSWITCH rule - check it manually."

ok "Log rotation configured (FreeSWITCH 30d, CDR 90d, journal 30d/2G)"
