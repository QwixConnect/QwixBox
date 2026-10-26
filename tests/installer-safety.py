#!/usr/bin/env python3
"""Exercise installer scripts in a temporary filesystem, with host services stubbed."""
import os
import pathlib
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
