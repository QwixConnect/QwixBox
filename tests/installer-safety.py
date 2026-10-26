#!/usr/bin/env python3
"""Exercise installer scripts in a temporary filesystem, with host services stubbed."""
import os
import pathlib
import time
import subprocess
import tempfile

repo = pathlib.Path(__file__).resolve().parents[1]

def run(script, env=None):
    return subprocess.run(["bash", "-c", script], env=env, text=True, capture_output=True)

with tempfile.TemporaryDirectory(prefix="qwixbox-installer-") as folder:
    root = pathlib.Path(folder)
    fixture = root / "tree"
    (fixture / "lib").mkdir(parents=True)
    (fixture / "app/node_modules").mkdir(parents=True)
    (fixture / "app/dist").mkdir()
    (fixture / "step.sh").write_text("# step-inputs: app\n")
    (fixture / "app/source.ts").write_text("one")
    (fixture / "lib/helpers.sh").write_text("# helper")
    def digest():
        result = run(f'set -euo pipefail; SCRIPT_DIR="{fixture}"; . "{repo}/lib/step-state.sh"; die() {{ exit 1; }}; script_hash "{fixture}/step.sh"')
        assert result.returncode == 0, result.stderr
        return result.stdout
    before = digest()
    for name in [".env", ".env.staging", ".DS_Store", "node_modules/x", "dist/x"]:
        (fixture / "app" / name).write_text("ignored")
    assert digest() == before, "Generated/private files changed the deploy hash"
    (fixture / "app/source.ts").write_text("two")
    assert digest() != before, "Source changes were missed"
    print("PASS source hashing")

    state = root / "state"
    state.mkdir()
    marker = state / "31-freeswitch-config.sh.done"
    marker.touch()
    result = run(f'. "{repo}/lib/common.sh"; QWIXBOX_STATE_DIR="{state}"; invalidate_step 31-freeswitch-config.sh')
    assert result.returncode == 0 and not marker.exists(), result.stderr
    print("PASS dependent marker invalidation")

    result = run(f'. "{repo}/lib/common.sh"; bun_as root "{root}" printf "%s\\n" "O\x27Brien" \'$(echo must-not-run)\'')
    assert result.returncode == 0 and result.stdout == "O'Brien\n$(echo must-not-run)\n", result.stderr
    print("PASS Bun CLI argument boundaries")

    runtime = root / "runtime.env"
    result = run(f'''. "{repo}/lib/common.sh"
FS_HOST=127.0.0.1 KAM_EGRESS_PORT=5070 API_BASE_URL=http://127.0.0.1:3000 FS_XML_GATEWAY_SECRET=synthetic-fixture FAX_SPOOL=/var/spool/fixture
deploy_template "{repo}/resources/conf/freeswitch/runtime.env" "{runtime}" 0600 root:root || true
''')
    assert result.returncode == 0 and runtime.stat().st_mode & 0o777 == 0o600, result.stderr
    root.chmod(0o755)
    result = run(f'su -s /bin/sh nobody -c \'cat "{runtime}"\'')
    assert result.returncode != 0, "Unrelated local user read the gateway secret"
    print("PASS runtime secret permissions deny an unrelated local user")

    kam = root / "kamailio"
    kam.mkdir()
    def signing():
        result = run(f'. "{repo}/lib/common.sh"; KAMAILIO_ETC="{kam}" stir_signing_ready')
        assert result.returncode == 0, result.stderr
        return result.stdout
    assert signing() == "0", "No Kamailio config must not report signing"
    (kam / "kamailio.cfg").write_text("#!define WITH_STIRSHAKEN\n")
    (kam / "stirshaken.cfg").write_text('modparam("stirshaken", "vs_verify_x509_cert_path", 1)\n')
    assert signing() == "0", "Verification-only STIR must not report signing"
    (kam / "stirshaken.cfg").write_text('modparam("stirshaken", "as_default_key", "/k")\n')
    assert signing() == "1"
    (kam / "kamailio.cfg").write_text("\n")
    assert signing() == "0", "A key without the module define must not report signing"
    api_env = root / "api.env"
    result = run(f'''. "{repo}/lib/common.sh"
API_PORT=3000 API_USER=qwixbox API_DB_PASSWORD=x DB_HOST=h DB_PORT=5432 KAMAILIO_DB_PASSWORD=x REDIS_PASSWORD=x
REDIS_HOST=h REDIS_PORT=6379 FS_ESL_HOST=h FS_ESL_PORT=8021 FS_ESL_PASSWORD=x FS_XML_GATEWAY_SECRET=x
ENCRYPTION_KEY=x AUTH_SECRET=x PBX_FQDN=f PBX_SIP_DOMAIN=d FS_HOST=h KAM_EGRESS_PORT=5070
SMTP_FROM=a@b MAIL_FROM_NAME=n MAIL_REPLY_TO=r STIR_SIGNING="$(KAMAILIO_ETC="{kam}" stir_signing_ready)"
deploy_template "{repo}/resources/conf/api/env" "{api_env}" 0600 root:root || true
''')
    assert result.returncode == 0, result.stderr
    assert "STIR_SIGNING=0\n" in api_env.read_text()
    print("PASS STIR signing readiness reaches the API environment")

    etc = root / "etc"
    etc.mkdir()
    home = root / "root"
    (home / ".ssh").mkdir(parents=True)
    key = home / ".ssh/authorized_keys"
    key.write_text("ssh-ed25519 fixture\n")
    (etc / "passwd").write_text(f"root:x:0:0:root:{home}:/bin/bash\n")
    bin_dir = root / "bin"
    bin_dir.mkdir()
    for name in ["sshd", "systemctl"]:
        path = bin_dir / name
        path.write_text("#!/bin/sh\nexit 0\n")
        path.chmod(0o755)
    env = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}")
    source = (repo / "steps/10-ssh-hardening.sh").read_text()
    source = source.replace(next(line for line in source.splitlines() if line.startswith('. "')), f'. "{repo}/lib/common.sh"\nload_config() {{ :; }}\nrequire_root() {{ :; }}')
    source = source.replace("/etc/", f"{etc}/")
    result = run(source, env)
    assert result.returncode == 0, result.stderr
    config = etc / "ssh/sshd_config.d/00-qwixbox-hardening.conf"
    assert "PermitRootLogin prohibit-password" in config.read_text()
    assert "PasswordAuthentication no" in config.read_text()
    key.write_text("# no keys\n")
    result = run(source, env)
    assert result.returncode == 0, result.stderr
    assert "PasswordAuthentication yes" in config.read_text()
    assert "PermitRootLogin no" not in config.read_text()
    print("PASS root-key and no-key SSH policies")

    # Run the backup template itself. Real tar/retention, synthetic pg_dump outputs.
    su = bin_dir / "su"
    su.write_text('''#!/bin/sh
case "$*" in
  *"SELECT 1"*) echo 1 ;;
  *) echo "fixture dump" ;;
esac
''')
    su.chmod(0o755)
    backups = root / "backups"
    old = backups / "20200101-000000"
    old.mkdir(parents=True)
    os.utime(old, (1, 1))
    source = (repo / "resources/conf/backups/qwixbox-backup").read_text().replace("@BACKUP_DIR@", str(backups)).replace("@BACKUP_KEEP_DAYS@", "14")
    source = source.replace("/etc/", f"{etc}/").replace("/usr/local/", f"{root}/usr/local/")
    expected = str(etc / "qwixbox/config.env").lstrip("/")
    source = source.replace("'etc/qwixbox/config.env'", repr(expected))
    result = run(source, env)
    assert result.returncode != 0 and old.exists(), "Missing encryption config allowed backup/retention success"
    (etc / "qwixbox").mkdir()
    (etc / "qwixbox/config.env").write_text("ENCRYPTION_KEY=synthetic-fixture\n")
    result = run(source, env)
    assert result.returncode == 0 and not old.exists(), result.stderr
    print("PASS backup failure preserves history; verified backup permits retention")

    account = root / "account-created"
    provision_failure = root / "fail-provision"
    provision_failure.touch()
    config_dir = root / "account-config"
    config_dir.mkdir()
    deployed = root / "deployed"
    deployed.mkdir()
    source = (repo / "steps/44-admin-account.sh").read_text()
    setup = f'''. "{repo}/lib/common.sh"
require_root() {{ :; }}
load_config() {{ CONFIG_DIR="{config_dir}"; API_DIR="{deployed}"; API_USER=root; ADMIN_EMAIL=fixture@example.test; PBX_FQDN=a.test; PBX_SIP_DOMAIN=a.test; TENANT_NAME="O'Brien & Co"; }}
bun_as() {{
  case "$5" in
    src/cli/create-user.ts) if [ -f "{account}" ]; then echo "already exists"; return 1; fi; touch "{account}" ;;
    src/cli/provision-tenant.ts) [ ! -f "{provision_failure}" ] ;;
    *) return 1 ;;
  esac
}}
'''
    source = source.replace(next(line for line in source.splitlines() if line.startswith('. "')), setup)
    result = run(f'exec 3>"{root}/console"\n' + source)
    first_login = config_dir / "first-login"
    assert result.returncode != 0 and first_login.exists(), "Provisioning failure lost the generated credential"
    credential = first_login.read_text()
    assert first_login.stat().st_mode & 0o777 == 0o600
    provision_failure.unlink()
    result = run(f'exec 3>"{root}/console"\n' + source)
    assert result.returncode == 0 and first_login.read_text() == credential, result.stderr
    print("PASS first-login survives provisioning failure and resume")

# Every database URL a template renders must parse back to the configured host and password.
# Kamailio's two URLs once wrote `@PASSWORD@@DB_HOST@` - two placeholders with no literal `@`
# between them - so the password ran into the host and Kamailio could not start on a fresh install.
import re
import urllib.parse
templates = sorted(path for path in (repo / "resources/conf").rglob("*") if path.is_file())
env = dict(os.environ)
for path in templates:
    for name in re.findall(r"@([A-Za-z_][A-Za-z0-9_]*)@", path.read_text(errors="ignore")):
        env[name] = "h0st" if name.endswith("_HOST") else "5432" if name.endswith("_PORT") else f"v{name.lower()}"
checked = 0
for path in templates:
    result = run(f'. "{repo}/lib/common.sh"; render_template "{path}"', env)
    assert result.returncode == 0, f"{path}: {result.stderr}"
    for url in re.findall(r"postgres(?:ql)?://[^\s\"']+", result.stdout):
        parts = urllib.parse.urlsplit(url)
        assert parts.hostname == "h0st" and parts.port == 5432 and parts.password, f"{path.name}: malformed {url}"
        checked += 1
assert checked >= 3, f"only {checked} database URLs found"
print(f"PASS rendered database URLs parse ({checked} across {len(templates)} templates)")

# The health check is the alerter (I17). Run the rendered script against stubbed services: a unit
# that is down, a failing projection, Kamailio auth backend errors and a certificate near expiry
# must each alert once by mail and webhook; an unchanged problem must not re-alert (even when
# its count changes); recovery alerts; a failed delivery is retried on the next run.
import json
import subprocess as sp
with tempfile.TemporaryDirectory(prefix="qwixbox-health-") as folder:
    root = pathlib.Path(folder)
    bin_dir = root / "bin"
    bin_dir.mkdir()
    (root / "fs/bin").mkdir(parents=True)
    stubs = {
        "systemctl": 'case "$1" in cat) case " $UNITS " in *" ${2%.service} "*) exit 0;; esac; exit 1;;\n'
                     '  show) printf "%s\\n" "${BACKUP_RESULT:-success}";;\n'
                     '  is-active) for u in $DOWN; do [ "$u" = "${@: -1}" ] && exit 3; done; exit 0;; esac; exit 0',
        "ss": 'echo "udp UNCONN 0 0 0.0.0.0:5060 0.0.0.0:*"',
        "journalctl": 'printf "%s" "$JOURNAL"',
        "curl": 'for a in "$@"; do case "$a" in */health) printf "%s" "$HEALTH"; exit 0;; esac; done\n'
                '[ -n "$FAIL_DELIVERY" ] && exit 22; cat >> "$HOOKLOG"; echo >> "$HOOKLOG"',
        "sendmail": '[ -n "$FAIL_DELIVERY" ] && exit 75; cat >> "$MAILLOG"; echo "----" >> "$MAILLOG"',
    }
    for name, body in stubs.items():
        (bin_dir / name).write_text("#!/usr/bin/env bash\n" + body + "\n")
        (bin_dir / name).chmod(0o755)
    (root / "fs/bin/fs_cli").write_text('#!/usr/bin/env bash\ncase "$2" in status) echo "UP 0 years";; *) echo "0 total.";; esac\n')
    (root / "fs/bin/fs_cli").chmod(0o755)
    script = root / "qwixbox-healthcheck"
    rendered = run(f'. "{repo}/lib/common.sh"; render_template "{repo}/resources/conf/monitoring/qwixbox-healthcheck"',
                   dict(os.environ, SIP_PORT="5060", API_PORT="3000", BACKUP_DIR="/var/backups/qwixbox"))
    assert rendered.returncode == 0, rendered.stderr
    script.write_text(rendered.stdout)
    script.chmod(0o755)
    (root / "alerts.env").write_text("ALERT_EMAIL=ops@example.test\nALERT_WEBHOOK=https://hooks.example.test/x\n")
    healthy = {"status": "ok", "database": True, "redis": True, "freeswitch": True, "kamailio": True,
               "projections": {"pending": 0, "failing": 0}}
    base = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}", HEALTH_FS_PREFIX=str(root / "fs"),
                HEALTH_ALERTS_FILE=str(root / "alerts.env"), HEALTH_STATE_FILE=str(root / "state"),
                HEALTH_SENDMAIL=str(bin_dir / "sendmail"), HEALTH_CERT=str(root / "absent.pem"),
                MAILLOG=str(root / "mail"), HOOKLOG=str(root / "hooks"), UNITS="kamailio rtpengine qwixbox-api",
                DOWN="", JOURNAL="", FAIL_DELIVERY="", HEALTH=json.dumps(healthy))
    def check(**changes):
        result = sp.run([str(script)], env=dict(base, **changes), text=True, capture_output=True)
        mail = (root / "mail").read_text() if (root / "mail").exists() else ""
        hooks = [json.loads(line) for line in (root / "hooks").read_text().splitlines() if line] if (root / "hooks").exists() else []
        return result, mail, hooks
    result, mail, hooks = check()
    assert result.returncode == 0 and not mail and not hooks, result.stdout + result.stderr
    assert "rtpengine              active" in result.stdout, "installed units were not checked:\n" + result.stdout
    result, mail, hooks = check(DOWN="rtpengine")
    assert result.returncode == 1 and "rtpengine: DOWN" in mail and "DEGRADED" in mail, result.stdout
    assert len(hooks) == 1 and "rtpengine: DOWN" in hooks[0]["detail"], hooks
    result, mail, hooks = check(DOWN="rtpengine")
    assert len(hooks) == 1, "an unchanged problem alerted again"
    backend = "x authentication backend error for INVITE\n"
    result, mail, hooks = check(DOWN="rtpengine", JOURNAL=backend * 2)
    assert len(hooks) == 2 and "sip authentication: 2 DATABASE ERRORS" in hooks[1]["detail"], hooks
    result, mail, hooks = check(DOWN="rtpengine", JOURNAL=backend * 5)
    assert len(hooks) == 2, "a changed count re-alerted"
    stuck = dict(healthy, status="degraded", projections={"pending": 1, "failing": 1})
    result, mail, hooks = check(HEALTH=json.dumps(stuck))
    assert len(hooks) == 3 and "projections: 1 FAILING" in hooks[2]["detail"], hooks
    result, mail, hooks = check(HEALTH=json.dumps(dict(healthy, status="degraded", kamailio=False)))
    assert len(hooks) == 4 and "DOWN: kamailio" in hooks[3]["detail"], hooks
    cert = root / "cert.pem"
    sp.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "5", "-subj", "/CN=t",
            "-keyout", str(root / "key.pem"), "-out", str(cert)], check=True, capture_output=True)
    result, mail, hooks = check(HEALTH_CERT=str(cert))
    assert len(hooks) == 5 and "tls certificate: EXPIRES IN" in hooks[4]["detail"], hooks
    result, mail, hooks = check()
    assert result.returncode == 0 and len(hooks) == 6 and "RECOVERED" in hooks[5]["subject"], hooks
    result, mail, hooks = check(DOWN="kamailio", FAIL_DELIVERY="1")
    assert len(hooks) == 6 and "delivered to 0 of 2" in result.stdout, result.stdout
    result, mail, hooks = check(DOWN="kamailio")
    assert len(hooks) == 7 and "kamailio: DOWN" in hooks[6]["detail"], "a failed delivery was not retried"
    state = (root / "state").read_text().split("\n", 1)
    (root / "state").write_text(f"{int(state[0]) - 7 * 3600}\n{state[1]}")
    result, mail, hooks = check(DOWN="kamailio")
    assert len(hooks) == 8 and "STILL DEGRADED" in hooks[7]["subject"], hooks
    print("PASS health check alerts once per change, on recovery and as a reminder, and retries delivery")

    # Backups (YYZ-38): no snapshot, a stale one and a failed run (an offsite copy that failed
    # after the local snapshot completed) each alert; a fresh snapshot and a successful run recover.
    snaps = root / "snaps"
    snaps.mkdir()
    backup = dict(UNITS="qwixbox-backup", HEALTH_BACKUP_DIR=str(snaps), HEALTH_STATE_FILE=str(root / "backup-state"))
    (root / "hooks").unlink()
    result, mail, hooks = check(**backup)
    assert result.returncode == 1 and "backup: NO COMPLETE SNAPSHOT" in hooks[-1]["detail"], result.stdout
    old_snap = snaps / "20260101-032000"
    old_snap.mkdir()
    (old_snap / "COMPLETE").touch()
    os.utime(old_snap / "COMPLETE", (time.time() - 30 * 3600,) * 2)
    result, mail, hooks = check(**backup)
    assert result.returncode == 1 and "NEWEST COMPLETE IS 30h OLD" in result.stdout, result.stdout
    new_snap = snaps / "20260102-032000"
    new_snap.mkdir()
    (new_snap / "COMPLETE").touch()
    result, mail, hooks = check(**backup, BACKUP_RESULT="exit-code")
    assert result.returncode == 1 and "backup run: LAST RUN FAILED (exit-code)" in hooks[-1]["detail"], hooks
    assert "backup:" not in hooks[-1]["detail"], "a fresh complete snapshot still alerted"
    result, mail, hooks = check(**backup)
    assert result.returncode == 0 and "RECOVERED" in hooks[-1]["subject"], result.stdout
    print("PASS health check alerts on a missing, stale or failed backup and recovers")

    # I14: a role password reaches psql on stdin, behind statement logging turned off, never argv.
    stub = root / "pgstub"
    stub.mkdir()
    (stub / "su").write_text(f'#!/bin/sh\nprintf "%s\\n" "$*" >"{stub}/argv"\ncat >"{stub}/stdin"\n')
    (stub / "su").chmod(0o755)
    secret = "s3cr'et"
    result = run(f'''. "{repo}/lib/common.sh"; PATH="{stub}:$PATH"
printf 'ALTER ROLE x WITH PASSWORD %s;\\n' "$(sql_literal "$SECRET")" | psql_secret''', env=dict(os.environ, SECRET=secret))
    assert result.returncode == 0, result.stderr
    sent = (stub / "stdin").read_text().splitlines()
    assert secret not in (stub / "argv").read_text(), "a password reached psql's argv"
    assert sent[0] == "SET log_statement = 'none';" and "panic" in sent[1], sent
    assert sent[-1] == "ALTER ROLE x WITH PASSWORD 's3cr''et';", sent
    leaks = [f"{path.relative_to(repo)}:{n}" for path in sorted(repo.glob("steps/*.sh")) + [repo / "lib/common.sh"]
             for n, line in enumerate(path.read_text().splitlines(), 1)
             if not line.lstrip().startswith("#") and "PASSWORD" in line.upper() and "psql" in line and " -c" in line]
    assert not leaks, f"role password passed to psql -c: {leaks}"
    print("PASS role passwords stay out of argv and the Postgres statement log")

# I10: postflight must accept the SSH policy step 10 writes for a host whose root has keys, and
# its in-shell port probe must not pipe into grep -q (SIGPIPE under pipefail failed a listening
# port about one run in three).
postflight = (repo / "steps/99-postflight.sh").read_text()
ssh_step = (repo / "steps/10-ssh-hardening.sh").read_text()
assert "PermitRootLogin prohibit-password" in ssh_step
assert "prohibit-password|without-password" in postflight, "postflight refuses step 10's root-key policy"
assert "permitrootlogin no'" not in postflight
probe = postflight.split("port_listening() {", 1)[1].split("\n}", 1)[0]
assert "| grep -q" not in probe, "port_listening pipes into grep -q"
assert "kamctl add" not in postflight, "postflight still advises kamctl provisioning"
print("PASS postflight agrees with the SSH policy and probes ports without SIGPIPE")

# I11: the DNS mode is resolved once per step, even though dns_publish/dns_commit run it from
# command substitutions; and a provider failure queues the record for the manual fallback rather
# than aborting the step under set -e.
with tempfile.TemporaryDirectory(prefix="qwixbox-dns-") as folder:
    calls = pathlib.Path(folder) / "discoveries"
    result = run(f'''. "{repo}/lib/common.sh"
dc_available() {{ echo x >>"{calls}"; return 1; }}
DNS_PROVIDER=auto CLOUDFLARE_API_TOKEN=t
cf_zone_for_name() {{ echo zone; }}
cf_record_put() {{ :; }}
dns_resolve_mode
dns_publish A a.example 192.0.2.1
dns_publish A b.example 192.0.2.1
dns_commit
echo "mode=$_DNS_MODE"''')
    assert result.returncode == 0, result.stderr
    assert "mode=cloudflare" in result.stdout, result.stdout
    assert calls.read_text().count("x") == 1, f"auto discovery ran {calls.read_text().count('x')} times"

    result = run(f'''. "{repo}/lib/common.sh"
DNS_PROVIDER=cloudflare CLOUDFLARE_API_TOKEN=t
cf_zone_for_name() {{ return 1; }}
dns_resolve_mode
dns_publish A a.example 192.0.2.1
dns_publish TXT k._domainkey.example "v=DKIM1; p=abc"
dns_commit || echo "COMMIT-FAILED"
echo "STEP-CONTINUED"''')
    assert "STEP-CONTINUED" in result.stdout, ("a provider failure aborted the step", result.stdout, result.stderr)
    assert "COMMIT-FAILED" in result.stdout, "dns_commit hid a failed publication"
    assert "a.example" in result.stdout and "v=DKIM1; p=abc" in result.stdout, "the manual fallback did not print the records"
print("PASS DNS mode resolves once per step and a provider failure falls back to manual records")

# I11: certbot applies /etc/letsencrypt/cli.ini over every lineage's renewal config, so step 42's
# webroot cli.ini must only be written for HTTP-01, or a DNS-01 certificate renews over HTTP.
nginx_step = (repo / "steps/42-nginx.sh").read_text()
deploy = next(n for n, line in enumerate(nginx_step.splitlines()) if "letsencrypt-cli.ini" in line and "deploy_template" in line)
guard = nginx_step.splitlines()[deploy - 1]
assert 'ACME_CHALLENGE' in guard and '"http"' in guard, f"cli.ini is deployed without an HTTP-01 guard: {guard!r}"
print("PASS the webroot cli.ini is written only for HTTP-01 renewal")

# I12: step 11 gives each address family its own SSH rule (an IPv6 prefix under "ip saddr" made nft
# reject the whole ruleset), and refuses a malformed CIDR; step 15 refuses the placeholder sender
# and 465 with STARTTLS, and turns on Postfix's wrapper mode for implicit TLS.
firewall = (repo / "steps/11-firewall.sh").read_text()
block = firewall.split("reason=", 1)[1].split("\nif [[", 1)[0]
def admin_rules(cidrs):
    return run(f'. "{repo}/lib/common.sh"; CONFIG_FILE=x; ADMIN_ALLOW_CIDR="{cidrs}"; reason={block}\nprintf "%s" "$ADMIN_SSH_RULES"')
result = admin_rules("203.0.113.0/24 2001:db8::/32 198.51.100.7/32")
assert result.returncode == 0, result.stderr
assert "ip saddr { 203.0.113.0/24, 198.51.100.7/32 } tcp dport 22 accept" in result.stdout, result.stdout
assert "ip6 saddr { 2001:db8::/32 } tcp dport 22 accept" in result.stdout, result.stdout
assert "ip6" not in admin_rules("203.0.113.0/24").stdout
assert admin_rules("203.0.113.5").returncode != 0, "a CIDR without a prefix length was accepted"
assert "@ADMIN_SSH_RULES@" in (repo / "resources/conf/firewall/nftables.conf").read_text()
for sender, ok in [("pbx@example.com", False), ("pbx@example.org", False), ("pbx@acme.test", True)]:
    assert (run(f'. "{repo}/lib/common.sh"; valid_email "{sender}"').returncode == 0) == ok, sender
mail = (repo / "steps/15-mail.sh").read_text()
assert 'valid_email "$SMTP_FROM"' in mail and "smtp_tls_wrappermode = yes" in mail
assert '[ "$SMTP_PORT" = 465 ] && [ "$SMTP_STARTTLS" = on ]' in mail
assert 'SMTP_FROM="pbx@example.com"' not in (repo / "config.env.example").read_text()
print("PASS admin SSH rules split by address family, and mail refuses a placeholder sender or 465 with STARTTLS")
