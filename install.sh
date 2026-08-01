#!/usr/bin/env bash
#
# QwixBox - master installer for the VoIP PBX stack.
#
# Runs the numbered step scripts in order. Safe to re-run: each step records a marker keyed
# on the script's own checksum, so a completed step is skipped until its script changes.
# Everything is logged to /var/log/qwixbox/.
#
# Usage:
#   sudo ./install.sh                 # run every pending step
#   sudo ./install.sh --list          # show the plan and each step's state
#   sudo ./install.sh --only 30-freeswitch.sh
#   sudo ./install.sh --from 40-bun.sh
#   sudo ./install.sh --force         # ignore markers, re-run everything
#   sudo ./install.sh --dry-run
#   sudo ./install.sh --configure     # interactive setup, then exit
#   sudo ./install.sh --menu          # interactive menu
#   sudo ./install.sh --quiet         # suppress the banner
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STEP_DIR="$SCRIPT_DIR/steps"
LOG_DIR="/var/log/qwixbox"
STATE_DIR="/var/lib/qwixbox"
BANNER_FILE="$SCRIPT_DIR/resources/banner.txt"
CONFIG_FILE="/etc/qwixbox/config.env"

### The install order. Dependencies flow downwards - do not reorder without checking that
### nothing later depends on something earlier (Kamailio needs its database; the API needs
### Bun and Postgres; TLS certs must exist before anything binds a TLS port).
###
### Format: "script|roles|description". A step runs when ROLES contains "all", when the
### step's role is "all", or when the step's role appears in ROLES. The all-in-one machine
### is simply ROLES="all" - the degenerate case where every role lands on one host.
###
### Roles:
###   all     - host-level work every machine needs regardless of what it runs
###   db      - PostgreSQL and Redis
###   sip     - Kamailio and rtpengine (the SIP edge)
###   media   - FreeSWITCH (the media/PBX core)
###   portal  - the API, the web portal and nginx
STEPS=(
  "00-preflight.sh|all|Host validation, hostname/FQDN, timezone, NTP, kernel and limit tuning"
  "01-base-packages.sh|all|Common tooling, CA certificates, unattended security upgrades"
  "02-dns.sh|all|Public DNS records via the configured provider (optional)"

  "10-ssh-hardening.sh|all|Key-only SSH, no root login, restricted auth"
  "11-firewall.sh|all|nftables: default deny, SIP/RTP/HTTPS allowlist, SIP rate limiting"
  "12-fail2ban.sh|all|Jails for sshd, FreeSWITCH (mod_fail2ban) and Kamailio"
  "13-tls-certs.sh|all|Let's Encrypt certificates + renewal hooks for SIP TLS, WSS and the API"
  "14-responsive-firewall.sh|sip|Reputation-tiered SIP rate limiting, learned from live registrations"
  "15-mail.sh|all|Outbound mail (Postfix + OpenDKIM) for voicemail-to-email and fax-to-email"

  "20-postgresql.sh|db|PostgreSQL 18 from PGDG, pg_hba, tuning, WAL/backup prep"
  "21-redis.sh|db|Redis for mod_hiredis and API caching"
  "22-provision-databases.sh|db|Roles and databases for Kamailio and the API, least privilege"

  "30-freeswitch.sh|media|FreeSWITCH from source (media server / PBX core)"
  "31-freeswitch-config.sh|media|SIP profiles, ACLs, xml_curl + Lua, Opus codec preference"
  "32-kamailio.sh|sip|Kamailio 6.1 from deb.kamailio.org with postgres/tls/lua modules"
  "33-stir-shaken.sh|sip|STIR/SHAKEN caller attestation (source build; off by default)"
  "34-kamailio-config.sh|sip|Registrar, multi-tenant routing, WebRTC/WSS, dispatcher, schema"
  "35-rtpengine.sh|sip|RTP relay and WebRTC media bridging (DTLS-SRTP <-> RTP)"

  "40-bun.sh|portal|Bun runtime"
  "41-api-deploy.sh|portal media|Hono API build, Drizzle migrations, systemd unit, secrets"
  "42-nginx.sh|portal|TLS reverse proxy for the API and WSS"
  "43-portal-web.sh|portal|Build the React admin portal and publish it for nginx"
  "44-admin-account.sh|portal|First portal account and its tenant (skipped without ADMIN_EMAIL)"

  "50-logrotate.sh|all|Rotation and retention for FreeSWITCH, Kamailio and API logs"
  "51-backups.sh|db|Scheduled pg_dump plus config snapshots, with retention"
  "52-monitoring.sh|all|Health checks, metrics exporter, alerting"
  "53-cron.sh|db|Scheduled maintenance (CDR rollup, cleanup)"

  "99-postflight.sh|all|Verify services, listening ports, TLS validity; print summary"
)

### ----------------------------------------------------------------------------------------
### Helpers
### ----------------------------------------------------------------------------------------

### Evaluated before the tee redirect below, so this reflects the real terminal rather than the
### pipe stdout becomes. Everything interactive - banner, live progress - is gated on it.
IS_TTY=0
[ -t 1 ] && [ -z "${NO_COLOR:-}" ] && IS_TTY=1

if [ "$IS_TTY" -eq 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=""; C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi

log()   { printf '%s %s\n'   "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
info()  { log "${C_BLUE}[INFO]${C_RESET}  $*"; }
ok()    { log "${C_GREEN}[OK]${C_RESET}    $*"; }
warn()  { log "${C_YELLOW}[WARN]${C_RESET}  $*"; }
fail()  { log "${C_RED}[ERROR]${C_RESET} $*" >&2; }

die() { fail "$*"; exit 1; }

### 2,17 is the header comment block above. Bounded to it deliberately - a looser range spills
### `set -euo pipefail` and the variable assignments into --help output.
usage() { sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

### ----------------------------------------------------------------------------------------
### Argument parsing
### ----------------------------------------------------------------------------------------

DO_LIST=0; DO_FORCE=0; DO_DRYRUN=0; DO_QUIET=0; DO_CONFIGURE=0; DO_MENU=0
ONLY_STEP=""; FROM_STEP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --list)      DO_LIST=1 ;;
    --force)     DO_FORCE=1 ;;
    --dry-run)   DO_DRYRUN=1 ;;
    --quiet)     DO_QUIET=1 ;;
    --configure) DO_CONFIGURE=1 ;;
    --menu)      DO_MENU=1 ;;
    --only)    ONLY_STEP="${2:-}"; [ -n "$ONLY_STEP" ] || die "--only needs a step name"; shift ;;
    --from)    FROM_STEP="${2:-}"; [ -n "$FROM_STEP" ] || die "--from needs a step name"; shift ;;
    -h|--help) usage ;;
    *)         die "Unknown argument: $1 (try --help)" ;;
  esac
  shift
done

### Printed before the log redirect further down, so the wordmark never reaches the log file -
### 50 columns of ASCII art in a file you grep for errors is noise. Missing banner is not an
### error: a partial checkout should still install.
if [ "$IS_TTY" -eq 1 ] && [ "$DO_QUIET" -eq 0 ] && [ -f "$BANNER_FILE" ]; then
  printf '\n%s' "$C_BLUE"; cat "$BANNER_FILE"; printf '%s\n' "$C_RESET"
fi

### Run the wizard and stop. In a subshell because lib/common.sh defines its own info/ok/warn
### with the steps' indented format, which would otherwise replace this script's timestamped one
### for the rest of the run.
if [ "$DO_CONFIGURE" -eq 1 ]; then
  ( # shellcheck source=lib/common.sh
    . "$SCRIPT_DIR/lib/common.sh"
    tui_available || die "--configure needs a terminal and whiptail (apt install whiptail)."
    run_wizard )
  rc=$?
  [ "$rc" -eq 0 ] && info "Configuration saved. Run 'sudo ./install.sh' to install."
  exit "$rc"
fi

### The menu is a front-end over the flags above and nothing more: each choice re-executes this
### same script with the flag it corresponds to. It deliberately has no execution path of its own
### - one that duplicated the step loop would drift out of step with the CLI the moment either
### changed, and the CLI is what every automated run uses.
if [ "$DO_MENU" -eq 1 ]; then
  # shellcheck source=lib/tui.sh
  . "$SCRIPT_DIR/lib/tui.sh"
  tui_available || die "--menu needs a terminal and whiptail (apt install whiptail)."

  ### "$DO_QUIET" is 0 or 1, and 0 is a non-empty string - so ${DO_QUIET:+--quiet} would pass
  ### --quiet in both cases. Build the argument from an explicit test instead.
  quiet_arg=()
  [ "$DO_QUIET" -eq 1 ] && quiet_arg=(--quiet)

  while true; do
    choice="$(tui_menu "QwixBox" \
      "install"   "Run all pending steps" \
      "status"    "Show each step and its state" \
      "step"      "Run one step again" \
      "configure" "Change the configuration" \
      "health"    "Run the health check" \
      "log"       "View the last install log" \
      "quit"      "Exit")" || exit 0

    case "$choice" in
      install)   exec "$0" "${quiet_arg[@]}" ;;
      status)    "$0" --list | ${PAGER:-less} -R ;;
      configure) "$0" --configure ;;
      health)    /usr/local/sbin/qwixbox-healthcheck 2>&1 | ${PAGER:-less} -R ;;
      log)       ls -t "$LOG_DIR"/install-*.log 2>/dev/null | head -1 | xargs -r ${PAGER:-less} -R ;;
      quit)      exit 0 ;;
      step)
        ### Built from the same STEPS array the runner uses, so a step added there appears here
        ### without a second list to keep in sync.
        args=()
        for entry in "${STEPS[@]}"; do
          args+=("${entry%%|*}" "${entry##*|}")
        done
        if picked="$(tui_menu "Which step? It will be re-run even if already complete." "${args[@]}")"; then
          "$0" --only "$picked" --force
          printf '\nPress Enter to return to the menu.'; read -r _
        fi
        ;;
    esac
  done
fi

### Reads one key from the deployed config without sourcing it. install.sh deliberately does not
### source lib/common.sh - that would replace its timestamped log format with the steps' own.
config_peek() {
  [ -r "$CONFIG_FILE" ] || return 0
  sed -n "s/^$1=[\"']\{0,1\}\([^\"']*\)[\"']\{0,1\}.*/\1/p" "$CONFIG_FILE" | tail -1
}

step_name()  { printf '%s' "${1%%|*}"; }
step_desc()  { printf '%s' "${1##*|}"; }
step_roles() { local r="${1#*|}"; printf '%s' "${r%%|*}"; }

### Which roles this machine plays. Read from the deployed config so --list works before the
### installer has ever run; "all" (the all-in-one case) is the default.
ROLES="$(config_peek ROLES)"
[ -n "$ROLES" ] || ROLES="all"

### A step runs when this host is all-in-one, when the step applies to every host regardless
### of role, or when any of the step's roles is one this host plays.
step_applies() {
  local roles="$1" r h
  case " $ROLES " in *" all "*) return 0 ;; esac
  case " $roles " in *" all "*) return 0 ;; esac
  for r in $roles; do
    for h in $ROLES; do
      [ "$r" = "$h" ] && return 0
    done
  done
  return 1
}

### Markers record the checksum of the script that satisfied the step. If the script is later
### edited, the checksum no longer matches and the step runs again - which is what makes
### re-running the installer after a change do the right thing.
###
### A step whose real content lives in resources/ declares those paths in a `# step-inputs:`
### line, and they are hashed alongside the script. Without that, editing a config template
### would leave the script byte-identical, the marker would still match, and the installer would
### skip the very step that deploys the file you just changed.
marker_for() { printf '%s/%s.done' "$STATE_DIR" "$1"; }
script_hash() {
  local path="$1" input
  {
    sha256sum "$path"
    # shellcheck disable=SC2013  # word splitting is the point: one line, several paths
    for input in $(sed -n 's/^#[[:space:]]*step-inputs:[[:space:]]*//p' "$path"); do
      [ -e "$SCRIPT_DIR/$input" ] || die "$(basename "$path"): step-inputs path not found: $input"
      ### Relative paths, so a rename still changes the hash but relocating the checkout
      ### does not re-run every step.
      ( cd "$SCRIPT_DIR" && find "$input" -type f -exec sha256sum {} + | sort -k2 )
    done
  } | sha256sum | cut -d' ' -f1
}

step_state() {
  local name="$1" path="$STEP_DIR/$1" marker
  marker="$(marker_for "$name")"
  [ -f "$path" ]   || { echo "missing"; return; }
  [ -f "$marker" ] || { echo "pending"; return; }
  if [ "$(cat "$marker")" = "$(script_hash "$path")" ]; then echo "done"; else echo "changed"; fi
}

### ----------------------------------------------------------------------------------------
### --list
### ----------------------------------------------------------------------------------------

if [ "$DO_LIST" -eq 1 ]; then
  printf '\n%sInstall plan%s  (steps in %s, roles: %s%s%s)\n\n' \
    "$C_BOLD" "$C_RESET" "$STEP_DIR" "$C_BOLD" "$ROLES" "$C_RESET"
  for entry in "${STEPS[@]}"; do
    name="$(step_name "$entry")"
    roles="$(step_roles "$entry")"

    if ! step_applies "$roles"; then
      printf '  %bskipped%b      %-26s %s\n' \
        "$C_YELLOW" "$C_RESET" "$name" "not a '$ROLES' role (needs: $roles)"
      continue
    fi

    case "$(step_state "$name")" in
      done)    tag="${C_GREEN}done${C_RESET}      " ;;
      changed) tag="${C_YELLOW}changed${C_RESET}   " ;;
      pending) tag="${C_BLUE}pending${C_RESET}   " ;;
      missing) tag="${C_RED}not written${C_RESET}" ;;
    esac
    printf '  %b  %-26s %s\n' "$tag" "$name" "$(step_desc "$entry")"
  done
  printf '\n'
  exit 0
fi

### ----------------------------------------------------------------------------------------
### Execution
### ----------------------------------------------------------------------------------------

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."

mkdir -p "$LOG_DIR" "$STATE_DIR" "$STEP_DIR"
LOG_FILE="$LOG_DIR/install-$(date '+%Y%m%d-%H%M%S').log"

### fd 3 keeps a handle on the real stdout before it becomes the tee pipe below. Live progress
### has to go here: written to stdout it would be teed, filling the log with thousands of \r
### frames and escape sequences in the file you grep when something breaks.
exec 3>&1

### Everything from here on is teed to the log, so a step's own output is captured too.
exec > >(tee -a "$LOG_FILE") 2>&1

CURRENT_STEP="startup"

### Best-effort completion notice. Both sinks are optional and a failure to notify must never
### change the install's own exit status - reporting "install failed" because the webhook was
### unreachable would be worse than saying nothing.
notify_result() {
  local status="$1" detail="$2" to hook subject
  to="$(config_peek INSTALL_NOTIFY_EMAIL)"
  hook="$(config_peek INSTALL_NOTIFY_WEBHOOK)"
  subject="QwixBox install $status on $(hostname -f 2>/dev/null || hostname)"

  if [ -n "$to" ] && [ -x /usr/sbin/sendmail ]; then
    printf 'To: %s\nSubject: %s\n\n%s\n\nLog: %s\n' \
      "$to" "$subject" "$detail" "$LOG_FILE" \
      | /usr/sbin/sendmail -t >/dev/null 2>&1 || true
  fi
  if [ -n "$hook" ]; then
    curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
      --data "$(printf '{"status":"%s","host":"%s","detail":"%s"}' \
                "$status" "$(hostname)" "$detail")" \
      "$hook" >/dev/null 2>&1 || true
  fi
}

### Any non-zero exit - including one from set -e inside a step - reports which step broke
### and where to read the log, rather than leaving a bare stack-free failure.
###
### EXIT_NEEDS_CONFIG is deliberately not treated as a failure. A first run that stops to let
### the operator fill in config.env is the designed path, and printing "XX Failed during:
### 00-preflight.sh" for it teaches people that a red ERROR from this installer is normal -
### which is precisely the habit that makes them scroll past the run where something did break.
# shellcheck disable=SC2329 # invoked indirectly by the EXIT trap below
on_exit() {
  local rc=$?
  if [ "$rc" -eq "${EXIT_NEEDS_CONFIG:-78}" ]; then
    ### Still non-zero on the way out, so a wrapper script or CI job does not mistake "not
    ### configured yet" for "installed successfully". Deliberately not notified: waiting for
    ### the operator to fill in the config is not an event worth paging anyone about.
    exit "$rc"
  fi
  if [ "$rc" -ne 0 ]; then
    fail "Failed during: $CURRENT_STEP (exit $rc)"
    fail "Log: $LOG_FILE"
    notify_result "FAILED" "Failed during $CURRENT_STEP (exit $rc)"
  else
    ### Defaulted: the trap is installed before these counters exist, and a success path that
    ### somehow exits early must not die on an unbound variable inside the exit handler.
    notify_result "OK" "Completed: ${ran:-0} run, ${skipped:-0} already complete."
  fi
  exit "$rc"
}
trap on_exit EXIT

info "QwixBox installer starting"
info "Logging to $LOG_FILE"
[ "$DO_DRYRUN" -eq 1 ] && warn "DRY RUN - no step will actually execute"

info "Roles on this machine: $ROLES"

### Count what this invocation will actually attempt, so the progress denominator matches the
### run rather than the size of the STEPS array. --only narrows it to one; --from drops
### everything before the named step; role filtering removes the rest.
total_steps=0
counting=0
for entry in "${STEPS[@]}"; do
  name="$(step_name "$entry")"
  if [ -n "$ONLY_STEP" ]; then
    [ "$name" = "$ONLY_STEP" ] && total_steps=1
    continue
  fi
  if [ -n "$FROM_STEP" ] && [ "$counting" -eq 0 ]; then
    if [ "$name" = "$FROM_STEP" ]; then counting=1; else continue; fi
  fi
  step_applies "$(step_roles "$entry")" && total_steps=$((total_steps + 1))
done
[ "$total_steps" -gt 0 ] || total_steps=1

started=0
step_no=0
ran=0; skipped=0; absent=0; notmyrole=0

for entry in "${STEPS[@]}"; do
  name="$(step_name "$entry")"
  desc="$(step_desc "$entry")"
  roles="$(step_roles "$entry")"
  path="$STEP_DIR/$name"

  ### --only runs exactly one step; --from starts the run at a given step.
  if [ -n "$ONLY_STEP" ] && [ "$name" != "$ONLY_STEP" ]; then continue; fi
  if [ -n "$FROM_STEP" ] && [ "$started" -eq 0 ]; then
    if [ "$name" = "$FROM_STEP" ]; then started=1; else continue; fi
  fi

  ### --only is an explicit instruction, so it overrides role filtering: an operator asking
  ### for one step by name should get it rather than a silent skip.
  if [ -z "$ONLY_STEP" ] && ! step_applies "$roles"; then
    notmyrole=$((notmyrole + 1))
    continue
  fi

  ### Counted here rather than at the top of the loop: everything above this point was
  ### filtered out and is not part of the run, so it must not consume a progress slot.
  step_no=$((step_no + 1))
  prog="$(printf '[%d/%d %d%%]' "$step_no" "$total_steps" "$((step_no * 100 / total_steps))")"

  state="$(step_state "$name")"

  if [ "$state" = "missing" ]; then
    warn "$prog SKIP  $name - not written yet ($desc)"
    absent=$((absent + 1))
    continue
  fi

  if [ "$DO_FORCE" -eq 0 ] && [ "$state" = "done" ]; then
    info "$prog SKIP  $name - already completed"
    skipped=$((skipped + 1))
    continue
  fi

  [ "$state" = "changed" ] && info "$name changed since last run - re-running"

  if [ "$DO_DRYRUN" -eq 1 ]; then
    info "$prog WOULD RUN  $name - $desc"
    continue
  fi

  CURRENT_STEP="$name"
  info "$prog RUN   $name - $desc"
  start_ts=$(date +%s)

  chmod +x "$path"
  ### A failing step aborts the run: set -e plus the EXIT trap report which one broke.
  "$path"

  printf '%s' "$(script_hash "$path")" > "$(marker_for "$name")"
  ok "$name completed in $(( $(date +%s) - start_ts ))s"
  ran=$((ran + 1))
done

if [ -n "$ONLY_STEP" ] && [ "$ran" -eq 0 ] && [ "$skipped" -eq 0 ] && [ "$absent" -eq 0 ]; then
  die "No such step: $ONLY_STEP (try --list)"
fi

CURRENT_STEP="finish"
printf '\n'
ok "Done. $ran run, $skipped already complete, $absent not yet written, $notmyrole not for this role."
info "Log: $LOG_FILE"
[ "$absent" -gt 0 ] && warn "The install is incomplete until the missing steps above exist."
exit 0
