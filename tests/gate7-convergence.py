#!/usr/bin/env python3
"""Gate 7 failure injection (M2 exit). Run as root inside a disposable full-install container:

    python3 /usr/src/qwixbox/tests/gate7-convergence.py

Needs steps 20-22, 30-35, 40, 41 and 44 applied (44 leaves the first account in
/etc/qwixbox/first-login). It creates and disables test extensions in the first tenant, stops
Redis, refuses the `kamailio` database role, and restarts services. Never run it on a real install.

Each phase checks both XML tiers separately (Redis for the warm tier, the API's /fs/xml for the
cold tier) and then FreeSWITCH itself, with `xml_flush_cache` before every FreeSWITCH lookup so its
own directory cache cannot answer for either tier.
"""
import base64
import hashlib
import json
import re
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

API = "http://127.0.0.1:3000"
FS_CLI = "/usr/local/freeswitch/bin/fs_cli"
results = []


def sh(command, check=True):
    done = subprocess.run(command, shell=True, capture_output=True, text=True)
    if check and done.returncode != 0:
        raise RuntimeError(f"{command}: {done.stderr.strip() or done.stdout.strip()}")
    return done.stdout.strip()


def config(name):
    for line in open("/etc/qwixbox/config.env"):
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"')
    raise KeyError(name)


def record(phase, ok, detail):
    results.append((phase, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} {phase}: {detail}", flush=True)


def wait_for(predicate, timeout, step=1.0):
    started = time.time()
    while time.time() - started < timeout:
        if predicate():
            return time.time() - started
        time.sleep(step)
    return None


# --- API session (Secure cookies, so the header is carried by hand over loopback HTTP) ---
cookie = ""


def api(method, path, body=None):
    global cookie
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("Origin", f"https://{config('PBX_FQDN')}")
    req.add_header("X-Real-IP", "127.0.0.9")
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            status, raw, headers = res.status, res.read(), res.headers
    except urllib.error.HTTPError as err:
        status, raw, headers = err.code, err.read(), err.headers
    for value in headers.get_all("Set-Cookie") or []:
        pair = value.split(";", 1)[0]
        if "session_token" in pair:
            cookie = pair
    try:
        return status, json.loads(raw) if raw else None
    except json.JSONDecodeError:
        return status, raw.decode()


def sign_in():
    creds = dict(line.strip().split("=", 1) for line in open("/etc/qwixbox/first-login") if "=" in line)
    status, _ = api("POST", "/api/auth/sign-in/email", {"email": creds["email"], "password": creds["password"]})
    assert status == 200, f"sign-in returned {status}"
    status, orgs = api("GET", "/api/auth/organization/list")
    assert status == 200 and orgs, f"organization list returned {status}"
    status, _ = api("POST", "/api/auth/organization/set-active", {"organizationId": orgs[0]["id"]})
    assert status == 200, f"set-active returned {status}"


def api_up():
    try:
        with urllib.request.urlopen(API + "/health", timeout=3) as res:
            return res.status in (200, 503)
    except urllib.error.HTTPError as err:
        return err.code == 503
    except OSError:
        return False


# --- The two tiers, and FreeSWITCH in front of them ---
def redis(*args):
    # Redis requires a password; without it redis-cli prints NOAUTH, which reads as a value.
    quoted = " ".join(f"'{arg}'" for arg in args)
    out = sh(f"REDISCLI_AUTH='{config('REDIS_PASSWORD')}' redis-cli --no-auth-warning {quoted}")
    assert "NOAUTH" not in out and not out.startswith("ERR"), out
    return out


def warm(domain, number):
    return redis("GET", f"qwixbox:dir:{domain}:{number}") != ""


def cold(domain, number):
    secret = config("FS_XML_GATEWAY_SECRET")
    form = urllib.parse.urlencode({"section": "directory", "domain": domain, "user": number}).encode()
    req = urllib.request.Request(API + "/fs/xml", data=form, method="POST")
    req.add_header("Authorization", "Basic " + base64.b64encode(f"freeswitch:{secret}".encode()).decode())
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return f'id="{number}"' in res.read().decode()
    except urllib.error.HTTPError:
        raise  # a wrong path or secret is a harness fault, not an answer
    except OSError:
        return None  # API down: the cold tier cannot answer either way


def freeswitch(domain, number):
    sh(f"{FS_CLI} -x xml_flush_cache", check=False)
    return sh(f"{FS_CLI} -x 'user_exists id {number} {domain}'", check=False) == "true"


def subscriber(domain, number):
    sql = f"SELECT count(*) FROM subscriber WHERE username='{number}' AND domain='{domain}'"
    return sh(f"su - postgres -c \"psql -qAt -d kamailio -c \\\"{sql}\\\"\"") == "1"


# --- A real REGISTER through Kamailio, digest-authenticated ---
def register(domain, number, password):
    md5 = lambda value: hashlib.md5(value.encode()).hexdigest()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))
    sock.settimeout(3)
    port = sock.getsockname()[1]

    def send(seq, authorization=""):
        message = (f"REGISTER sip:{domain} SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:{port};branch=z9hG4bK-g7{seq}{time.time_ns()}\r\n"
                   f"From: <sip:{number}@{domain}>;tag=g7\r\nTo: <sip:{number}@{domain}>\r\nCall-ID: g7-{number}-{port}\r\n"
                   f"CSeq: {seq} REGISTER\r\nMax-Forwards: 10\r\nContact: <sip:{number}@127.0.0.1:{port}>\r\nExpires: 60\r\n"
                   f"{authorization}Content-Length: 0\r\n\r\n")
        sock.sendto(message.encode(), ("127.0.0.1", int(config("SIP_PORT"))))
        while True:
            reply = sock.recv(65535).decode()
            if not re.match(r"SIP/2.0 1\d\d", reply):
                return reply

    try:
        challenge = send(1)
        nonce = re.search(r'nonce="([^"]+)"', challenge)
        if not nonce:
            return int(challenge.split()[1])
        digest = md5(f'{md5(f"{number}:{domain}:{password}")}:{nonce.group(1)}:{md5(f"REGISTER:sip:{domain}")}')
        header = f'Authorization: Digest username="{number}", realm="{domain}", nonce="{nonce.group(1)}", uri="sip:{domain}", response="{digest}"\r\n'
        return int(send(2, header).split()[1])
    except socket.timeout:
        return None
    finally:
        sock.close()


def state(domain, number, password):
    return {
        "warm": warm(domain, number),
        "cold": cold(domain, number),
        "freeswitch": freeswitch(domain, number),
        "subscriber": subscriber(domain, number),
        "register": register(domain, number, password),
    }


def main():
    for unit in ["postgresql", "redis-server", "freeswitch", "kamailio", "qwixbox-api"]:
        assert sh(f"systemctl is-active {unit}", check=False) == "active", f"{unit} is not active"
    sign_in()
    status, tenant = api("GET", "/api/tenant")
    assert status == 200, f"/api/tenant returned {status}"
    domain = tenant["sipDomain"]
    print(f"tenant domain {domain}", flush=True)

    stamp = str(int(time.time()) % 100000).zfill(5)
    number, other = "7" + stamp[-3:], "8" + stamp[-3:]
    status, created = api("POST", "/api/extensions", {"number": number, "displayName": "Gate 7"})
    assert status == 201, f"extension create returned {status}: {created}"
    status, kept = api("POST", "/api/extensions", {"number": other, "displayName": "Gate 7 control"})
    assert status == 201, f"control extension create returned {status}: {kept}"
    password, ext_id = created["sipPassword"], created["id"]

    # Baseline: every surface knows the extension.
    before = state(domain, number, password)
    record("baseline", before == {"warm": True, "cold": True, "freeswitch": True, "subscriber": True, "register": 200},
           json.dumps(before))

    # --- Revocation: dependencies fail after the commit, the API restarts, then they recover ---
    sh("systemctl stop redis-server")
    sh("su - postgres -c \"psql -qAt -c 'ALTER ROLE kamailio NOLOGIN'\"")
    sh("su - postgres -c \"psql -qAt -c \\\"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='kamailio'\\\"\"")
    status, _ = api("PATCH", f"/api/extensions/{ext_id}", {"enabled": False})
    record("revocation: disable committed while Redis and Kamailio's DB are down", status == 200, f"HTTP {status}")
    pending = sh("su - postgres -c \"psql -qAt -d qwixbox -c 'SELECT count(*) FROM projection_job'\"")
    record("revocation: projection queued, not lost", pending not in ("", "0"), f"{pending} job(s) pending")
    sh("systemctl restart qwixbox-api")
    wait_for(api_up, 60)
    still = subscriber(domain, number)
    record("revocation: subscriber survives while Kamailio's DB refuses", still, f"subscriber present={still}")
    sh("systemctl start redis-server")
    sh("su - postgres -c \"psql -qAt -c 'ALTER ROLE kamailio LOGIN'\"")
    took = wait_for(lambda: not subscriber(domain, number) and not warm(domain, number), 120)
    record("revocation: converges after recovery with no operator action", took is not None,
           f"subscriber and warm entry gone after {took:.1f}s" if took is not None else "not converged in 120s")
    # Kamailio lost its own connections too; give it a moment to reconnect before registering.
    wait_for(lambda: register(domain, other, kept["sipPassword"]) == 200, 60)
    after = state(domain, number, password)
    record("revocation: every surface refuses the disabled extension",
           after["warm"] is False and after["cold"] is False and after["freeswitch"] is False
           and after["subscriber"] is False and after["register"] in (401, 403),
           json.dumps(after))
    # Stopping Redis emptied it, so the untouched extension's warm entry returns with the warm
    # watchdog (60s poll); until then FreeSWITCH must still find it through the cold tier.
    covered = freeswitch(domain, other)
    took = wait_for(lambda: warm(domain, other), 90)
    control = state(domain, other, kept["sipPassword"])
    record("revocation: an unrelated extension is unaffected",
           covered and took is not None
           and all(control[k] for k in ("warm", "cold", "freeswitch", "subscriber")) and control["register"] == 200,
           f"found during the gap={covered}; warm back after {took:.1f}s; {json.dumps(control)}" if took is not None
           else f"warm entry not back in 90s; {json.dumps(control)}")
    jobs = lambda: sh("su - postgres -c \"psql -qAt -d qwixbox -c 'SELECT count(*) FROM projection_job'\"")
    took = wait_for(lambda: jobs() == "0", 180)
    record("revocation: queue drains", took is not None,
           f"empty after {took:.1f}s" if took is not None else f"{jobs()} job(s) left after 180s")

    # --- Rebuild: readers never see the tenant missing while full rebuilds run ---
    stop = threading.Event()
    counts = {"reads": 0, "missing": 0, "fs_checks": 0, "fs_misses": 0}

    def redis_reader():
        tenant_key, dir_key = f"qwixbox:tenant:{domain}", f"qwixbox:dir:{domain}:{other}"
        while not stop.is_set():
            # One atomic read of both keys; values are multi-line XML, so count rather than parse.
            counts["reads"] += 1
            if redis("EXISTS", tenant_key, dir_key) != "2":
                counts["missing"] += 1

    def fs_reader():
        while not stop.is_set():
            counts["fs_checks"] += 1
            if not freeswitch(domain, other):
                counts["fs_misses"] += 1

    readers = [threading.Thread(target=redis_reader), threading.Thread(target=fs_reader)]
    for reader in readers:
        reader.start()
    rebuilt = 0
    for _ in range(50):
        status, _ = api("POST", "/api/tenant/rebuild-cache")
        rebuilt += status in (200, 202)
    stop.set()
    for reader in readers:
        reader.join()
    record("rebuild: 50 full rebuilds accepted", rebuilt == 50, f"{rebuilt}/50")
    record("rebuild: no reader saw the tenant or extension missing",
           counts["missing"] == 0 and counts["reads"] > 100,
           f"{counts['missing']} missing in {counts['reads']} Redis reads")
    record("rebuild: FreeSWITCH found the extension throughout",
           counts["fs_misses"] == 0 and counts["fs_checks"] > 5,
           f"{counts['fs_misses']} misses in {counts['fs_checks']} flushed lookups")

    # --- Restart: each tier covers for the other ---
    sh("systemctl restart redis-server")
    empty = not warm(domain, other)
    covered = freeswitch(domain, other)
    record("restart redis: cache empty, cold tier answers", empty and covered is True,
           f"warm empty={empty}, FreeSWITCH found={covered}")
    took = wait_for(lambda: warm(domain, other), 90)
    record("restart redis: warm watchdog repopulates", took is not None,
           f"warm entry back after {took:.1f}s" if took is not None else "not back in 90s")
    sh("systemctl stop qwixbox-api")
    cold_down = cold(domain, other) is None
    covered = freeswitch(domain, other)
    record("API stopped: warm tier answers", cold_down and covered, f"API down={cold_down}, FreeSWITCH found={covered}")
    sh("systemctl start qwixbox-api")
    wait_for(api_up, 60)
    sign_in()

    # Clean up the test extensions so a repeat run starts clean.
    for ident in (ext_id, kept["id"]):
        api("DELETE", f"/api/extensions/{ident}")

    failed = [phase for phase, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed", flush=True)
    raise SystemExit(1 if failed else 0)


def restore():
    # Whatever happened above, leave the container's services as the run found them.
    sh("su - postgres -c \"psql -qAt -c 'ALTER ROLE kamailio LOGIN'\"", check=False)
    for unit in ["redis-server", "qwixbox-api"]:
        sh(f"systemctl start {unit}", check=False)


if __name__ == "__main__":
    try:
        main()
    finally:
        restore()
