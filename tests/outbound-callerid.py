#!/usr/bin/env python3
"""Outbound caller ID as a carrier receives it (I03). Run as root inside a disposable full-install
container, like gate7-convergence.py:

    python3 /usr/src/qwixbox/tests/outbound-callerid.py

It adds a trunk pointing at a fake carrier on 127.0.0.1:5090, an outbound route and a test
extension, then places a digest-authenticated INVITE through Kamailio for each caller-ID case. Each
case runs twice: with the API stopped, so only the Redis/Lua tier can answer the dialplan, and with
Redis stopped, so only the API tier can. The carrier records the INVITE's From header. Never run it
on a real install; it restores services and deletes what it created on exit.
"""
import hashlib
import json
import re
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request

API = "http://127.0.0.1:3000"
CARRIER = ("127.0.0.1", 5090)
DIALLED = "14165551234"
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


cookie = ""


def api(method, path, body=None):
    global cookie
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method)
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
        if "session_token" in value.split(";", 1)[0]:
            cookie = value.split(";", 1)[0]
    try:
        return status, json.loads(raw) if raw else None
    except json.JSONDecodeError:
        return status, raw.decode()


def api_up():
    try:
        with urllib.request.urlopen(API + "/health", timeout=3):
            return True
    except urllib.error.HTTPError:
        return True
    except OSError:
        return False


def wait_for(predicate, timeout):
    end = time.time() + timeout
    while time.time() < end:
        if predicate():
            return True
        time.sleep(1)
    return False


def sign_in():
    creds = dict(line.strip().split("=", 1) for line in open("/etc/qwixbox/first-login") if "=" in line)
    assert api("POST", "/api/auth/sign-in/email", {"email": creds["email"], "password": creds["password"]})[0] == 200
    status, orgs = api("GET", "/api/auth/organization/list")
    assert status == 200 and orgs
    assert api("POST", "/api/auth/organization/set-active", {"organizationId": orgs[0]["id"]})[0] == 200


# --- The fake carrier: record each INVITE's From, answer 486 so the call ends at once ---
received = []


def carrier(stop):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(CARRIER)
    sock.settimeout(0.5)
    while not stop.is_set():
        try:
            data, peer = sock.recvfrom(65535)
        except socket.timeout:
            continue
        message = data.decode(errors="replace")
        if not message.startswith("INVITE "):
            continue
        received.append(message)
        head = {}
        for line in message.split("\r\n")[1:]:
            if ":" in line:
                name, value = line.split(":", 1)
                head.setdefault(name.strip().lower(), []).append(value.strip())
        reply = "SIP/2.0 486 Busy Here\r\n"
        for via in head.get("via", []):
            reply += f"Via: {via}\r\n"
        reply += f"From: {head['from'][0]}\r\nTo: {head['to'][0]};tag=carrier\r\n"
        reply += f"Call-ID: {head['call-id'][0]}\r\nCSeq: {head['cseq'][0]}\r\nContent-Length: 0\r\n\r\n"
        sock.sendto(reply.encode(), peer)
    sock.close()


# --- The caller: a digest-authenticated INVITE through Kamailio ---
# Not from loopback: route[AUTH] treats 127.0.0.1 as FreeSWITCH and skips authentication and the
# X-Tenant-Domain/X-Auth-User headers, so a loopback caller never reaches tenant routing.
LOCAL = sh("hostname -I").split()[0]


def place_call(domain, number, password):
    md5 = lambda value: hashlib.md5(value.encode()).hexdigest()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((LOCAL, 0))
    sock.settimeout(8)
    port = sock.getsockname()[1]
    uri = f"sip:{DIALLED}@{domain}"
    call_id = f"cid-{time.time_ns()}"
    sdp = (f"v=0\r\no=- 1 1 IN IP4 {LOCAL}\r\ns=-\r\nc=IN IP4 {LOCAL}\r\nt=0 0\r\n"
           f"m=audio {port + 1} RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n")

    def send(seq, extra=""):
        branch = f"z9hG4bK-cid{seq}{time.time_ns()}"
        message = (f"INVITE {uri} SIP/2.0\r\nVia: SIP/2.0/UDP {LOCAL}:{port};branch={branch}\r\n"
                   f"From: <sip:{number}@{domain}>;tag=caller\r\nTo: <{uri}>\r\nCall-ID: {call_id}\r\n"
                   f"CSeq: {seq} INVITE\r\nMax-Forwards: 70\r\nContact: <sip:{number}@{LOCAL}:{port}>\r\n"
                   f"{extra}Content-Type: application/sdp\r\nContent-Length: {len(sdp)}\r\n\r\n{sdp}")
        sock.sendto(message.encode(), (LOCAL, int(config("SIP_PORT"))))
        while True:
            reply = sock.recv(65535).decode(errors="replace")
            code = int(reply.split()[1])
            if code >= 200:
                ack = (f"ACK {uri} SIP/2.0\r\nVia: SIP/2.0/UDP {LOCAL}:{port};branch={branch}\r\n"
                       f"From: <sip:{number}@{domain}>;tag=caller\r\nTo: <{uri}>\r\nCall-ID: {call_id}\r\n"
                       f"CSeq: {seq} ACK\r\nMax-Forwards: 70\r\nContent-Length: 0\r\n\r\n")
                sock.sendto(ack.encode(), (LOCAL, int(config("SIP_PORT"))))
                return code, reply

    try:
        code, challenge = send(1)
        nonce = re.search(r'nonce="([^"]+)"', challenge)
        if code != 407 or not nonce:
            return code
        digest = md5(f'{md5(f"{number}:{domain}:{password}")}:{nonce.group(1)}:{md5(f"INVITE:{uri}")}')
        auth = (f'Proxy-Authorization: Digest username="{number}", realm="{domain}", nonce="{nonce.group(1)}", '
                f'uri="{uri}", response="{digest}"\r\n')
        return send(2, auth)[0]
    except socket.timeout:
        return None
    finally:
        sock.close()


def presented(message):
    line = next(l for l in message.split("\r\n") if l.lower().startswith("from:"))
    name = re.search(r'From:\s*"([^"]*)"', line, re.I)
    user = re.search(r"<sip:([^@>]+)@", line)
    return {"name": name.group(1) if name else None, "number": user.group(1) if user else None}


def redis(*args):
    password = config("REDIS_PASSWORD")
    return sh("REDISCLI_AUTH=" + password + " redis-cli " + " ".join(args))


FS_LOG = "/usr/local/freeswitch/log/freeswitch.log"


def call_via(tier, domain, number, password):
    """Place one call with only `tier` able to answer the dialplan; return what the carrier saw."""
    if tier == "warm":
        # A Redis restart (the previous cold phase) empties the cache; the watchdog would refill it
        # within 60s, but the call must not race it.
        sign_in()
        api("POST", "/api/tenant/rebuild-cache")
        keys = [f"qwixbox:tenant:{domain}", f"qwixbox:call:{domain}:{number}"]
        assert wait_for(lambda: redis("EXISTS", *keys) == str(len(keys)), 30), "warm keys never appeared"
    sh("/usr/local/freeswitch/bin/fs_cli -x xml_flush_cache", check=False)
    sh("systemctl stop " + ("qwixbox-api" if tier == "warm" else "redis-server"))
    log_from = int(sh(f"wc -l < {FS_LOG}"))
    try:
        before = len(received)
        code = place_call(domain, number, password)
        wait_for(lambda: len(received) > before, 5)
        if len(received) > before:
            return code, presented(received[-1])
        print(sh(f"tail -n +{log_from + 1} {FS_LOG} | grep -E 'xml_handler|ERR|WARN|Hangup|No Route' | tail -15"))
        return code, None
    finally:
        sh("systemctl start qwixbox-api redis-server")
        wait_for(api_up, 60)


def main():
    sign_in()
    domain = api("GET", "/api/tenant")[1]["sipDomain"]
    stop = threading.Event()
    listener = threading.Thread(target=carrier, args=(stop,))
    listener.start()
    created = []
    try:
        status, trunk = api("POST", "/api/trunks", {"name": "I03 carrier", "host": CARRIER[0], "port": CARRIER[1], "transport": "udp"})
        assert status == 201, (status, trunk)
        created.append(f"/api/trunks/{trunk['id']}")
        status, route = api("POST", "/api/outbound-routes", {"name": "I03 NANP", "pattern": "^1[0-9]{10}$", "patternSyntax": "pcre", "trunkId": trunk["id"]})
        assert status == 201, (status, route)
        created.insert(0, f"/api/outbound-routes/{route['id']}")
        stamp = str(int(time.time()) % 1000).zfill(3)
        status, ext = api("POST", "/api/extensions", {"number": "6" + stamp, "displayName": "Caller"})
        assert status == 201, (status, ext)
        created.insert(0, f"/api/extensions/{ext['id']}")

        cases = [
            ("tenant default", "/api/tenant", {"defaultCallerIdName": "Acme", "defaultCallerIdNumber": "+14165550100"},
             {"name": "Acme", "number": "+14165550100"}),
            ("extension", f"/api/extensions/{ext['id']}", {"callerIdName": "Front Desk", "callerIdNumber": "+14165550101"},
             {"name": "Front Desk", "number": "+14165550101"}),
            ("route override", f"/api/outbound-routes/{route['id']}", {"callerIdOverride": "+14165550199"},
             {"name": "Front Desk", "number": "+14165550199"}),
        ]
        for label, path, body, expected in cases:
            status, _ = api("PATCH", path, body)
            assert status == 200, (label, status)
            for tier in ("warm", "cold"):
                code, seen = call_via(tier, domain, ext["number"], ext["sipPassword"])
                ok = seen == expected
                results.append(ok)
                print(f"{'PASS' if ok else 'FAIL'} {label} via {tier} tier: carrier saw {seen} (final {code}), expected {expected}", flush=True)
    finally:
        stop.set()
        listener.join()
        sh("systemctl start qwixbox-api redis-server", check=False)
        wait_for(api_up, 60)
        sign_in()
        api("PATCH", "/api/tenant", {"defaultCallerIdName": None, "defaultCallerIdNumber": None})
        for path in created:
            api("DELETE", path)
    print(f"\n{sum(results)}/{len(results)} checks passed", flush=True)
    raise SystemExit(0 if results and all(results) else 1)


if __name__ == "__main__":
    main()
