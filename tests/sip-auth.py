#!/usr/bin/env python3
"""Run in disposable Debian with kamailio installed: python3 /work/tests/sip-auth.py.

Uses the repository auth_db settings, the dedicated SIP fixture DB and a loopback listener.
--legacy proves the empty-password regression by restoring the previous two settings.

The authorize calls, route[AUTHRESULT], route[AUTHFAIL] and the htables are copied from the
deployed config, so the ban phases test that code: wrong passwords ban an address, while a
database failure answers 503 and bans nobody (I29). The outage is simulated by renaming the
fixture table, so the URL's role needs ALTER on it.
"""
import hashlib
import pathlib
import re
import os
import socket
import subprocess
import sys
import tempfile
import time

repo = pathlib.Path(__file__).resolve().parents[1]
database_url = os.environ["SIP_TEST_DATABASE_URL"]
assert database_url.endswith("/qwixbox_sip_test"), "Use the dedicated disposable SIP fixture database"
md5 = lambda value: hashlib.md5(value.encode()).hexdigest()
settings = "\n".join(
    line for line in (repo / "resources/conf/kamailio/kamailio.cfg").read_text().splitlines()
    if line.startswith('modparam("auth_db"') and '"db_url"' not in line
)
cfg = (repo / "resources/conf/kamailio/kamailio.cfg").read_text()


def block(name):
    """The body of route[name] in the deployed config, braces included."""
    start = cfg.index(f"route[{name}] {{")
    depth = 0
    for end in range(start, len(cfg)):
        depth += {"{": 1, "}": -1}.get(cfg[end], 0)
        if cfg[end] == "}" and depth == 0:
            return cfg[start:end + 1]
    raise ValueError(name)


def authorize(call):
    """The deployed authorize-and-challenge lines for call, against the fixture table."""
    found = re.search(rf"    {call}\(.*?\n    }}\n", cfg, re.S)
    assert found, f"{call} not found in kamailio.cfg"
    return found.group(0).replace('"subscriber"', '"sip_auth_fixture"')


# Arithmetic on $sht concatenates once the item holds a string ("1" + 1 is "11"); counters use
# $shtinc/$shtdec. The ban phase below catches it for authfail; this catches every other counter.
arithmetic = [line for line in cfg.splitlines()
              if not line.lstrip().startswith("#") and re.search(r"\$sht\([^)]*\)\s*[-+]\s*\d", line)]
assert not arithmetic, f"htable arithmetic, use $shtinc/$shtdec: {arithmetic}"
tables = "\n".join(line for line in cfg.splitlines()
                   if line.startswith('modparam("htable", "htable", "ipban') or line.startswith('modparam("htable", "htable", "authfail'))
max_failures = next(line for line in cfg.splitlines() if line.startswith("#!define MAX_AUTH_FAILURES"))
risk_condition = next(line.strip() for line in (repo / "resources/conf/kamailio/kamailio.cfg").read_text().splitlines() if 'if ($rU =~ ' in line)
if "--legacy" in sys.argv:
    settings = settings.replace('"calculate_ha1", 0', '"calculate_ha1", 1').replace('"password_column", "ha1"', '"password_column", "password"')

with tempfile.TemporaryDirectory(prefix="qwixbox-sip-") as directory:
    work = pathlib.Path(directory)
    config = work / "kamailio.cfg"
    config.write_text(f'''#!KAMAILIO
listen=udp:127.0.0.1:15060
children=1
fork=no
log_stderror=yes
debug=3
loadmodule "sl.so"
loadmodule "pv.so"
loadmodule "textops.so"
loadmodule "db_postgres.so"
loadmodule "auth.so"
loadmodule "auth_db.so"
loadmodule "xlog.so"
loadmodule "htable.so"
{max_failures}
modparam("auth_db", "db_url", "{database_url}")
{settings}
{tables}
request_route {{
    if ($sht(ipban=>$si) != $null) drop;
    if (is_method("REGISTER")) {{
{authorize("www_authenticate")}
    }} else {{
{authorize("proxy_authorize")}
    }}
    {risk_condition}
        sl_send_reply("403", "Risk policy"); exit;
    }}
    sl_send_reply("200", "Authenticated");
}}
{block("AUTHRESULT")}
{block("AUTHFAIL")}
''')
    with (work / "log").open("w+") as log:
        proc = subprocess.Popen(["kamailio", "-f", str(config), "-m", "16", "-M", "4"], stdout=log, stderr=log)
        try:
            time.sleep(0.4)
            if proc.poll() is not None:
                log.seek(0)
                raise RuntimeError(log.read())
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.bind(("127.0.0.1", 0))
            sock.settimeout(2)
            seq = 0
            def request(method, domain, authorization="", target=""):
                global seq
                seq += 1
                uri = f"sip:{target + '@' if target else ''}{domain}"
                message = (f"{method} {uri} SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:{sock.getsockname()[1]};branch=z9hG4bK-test{seq}\r\n"
                           f"From: <sip:101@{domain}>;tag=test\r\nTo: <sip:101@{domain}>\r\nCall-ID: test{seq}\r\n"
                           f"CSeq: {seq} {method}\r\nMax-Forwards: 10\r\nContact: <sip:101@127.0.0.1>\r\n{authorization}Content-Length: 0\r\n\r\n")
                sock.sendto(message.encode(), ("127.0.0.1", 15060))
                return sock.recv(65535).decode()
            failures = []
            for domain in ["a.test", "b.test"]:
                for method in ["REGISTER", "INVITE"]:
                    for label, password, expected in [("valid", f"fixture-secret-{domain}", 200), ("wrong", "wrong", 401), ("empty", "", 401)]:
                        challenge = request(method, domain)
                        nonce = re.search(r'nonce="([^"]+)"', challenge).group(1)
                        digest = md5(f'{md5(f"101:{domain}:{password}")}:{nonce}:{md5(f"{method}:sip:{domain}")}')
                        header_name = "Authorization" if method == "REGISTER" else "Proxy-Authorization"
                        authorization = f'{header_name}: Digest username="101", realm="{domain}", nonce="{nonce}", uri="sip:{domain}", response="{digest}"\r\n'
                        status = int(request(method, domain, authorization).split()[1])
                        expected = 407 if expected == 401 and method == "INVITE" else expected
                        if status != expected:
                            failures.append(f"{method} {domain} {label}: expected {expected}, got {status}")
                        else:
                            print(f"PASS {method} {domain} {label}")
            assert not failures, "\n".join(failures)
            for number, expected in [("+2521234567", 403), ("002521234567", 403), ("0112521234567", 403), ("+88213123456", 403), ("+14165551234", 200), ("911", 200)]:
                domain, method, password = "a.test", "INVITE", "fixture-secret-a.test"
                challenge = request(method, domain, target=number)
                nonce = re.search(r'nonce="([^"]+)"', challenge).group(1)
                uri = f"sip:{number}@{domain}"
                digest = md5(f'{md5(f"101:{domain}:{password}")}:{nonce}:{md5(f"{method}:{uri}")}')
                authorization = f'Proxy-Authorization: Digest username="101", realm="{domain}", nonce="{nonce}", uri="{uri}", response="{digest}"\r\n'
                status = int(request(method, domain, authorization, number).split()[1])
                assert status == expected, f"Risk policy {number}: expected {expected}, got {status}"
                print(f"PASS risk policy {number}")

            def register(source, password):
                """A challenged REGISTER for 101@a.test from source: the final reply, or None if dropped."""
                global sock
                sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                sock.bind((source, 0))
                sock.settimeout(1)
                try:
                    challenge = request("REGISTER", "a.test")
                except socket.timeout:
                    return None
                nonce = re.search(r'nonce="([^"]+)"', challenge).group(1)
                digest = md5(f'{md5(f"101:a.test:{password}")}:{nonce}:{md5("REGISTER:sip:a.test")}')
                reply = request("REGISTER", "a.test", f'Authorization: Digest username="101", realm="a.test", nonce="{nonce}", uri="sip:a.test", response="{digest}"\r\n')
                return reply

            limit = int(max_failures.split()[-1])
            # Wrong passwords from one address: answered until the limit, then silently dropped.
            replies = [register("127.0.0.3", "wrong") for _ in range(limit + 1)]
            codes = [reply and int(reply.split()[1]) for reply in replies]
            assert codes == [401] * limit + [None], f"wrong-password ban: {codes}"
            print(f"PASS {limit} wrong passwords ban the address")

            def psql(sql):
                subprocess.run(["psql", database_url, "-qc", sql], check=True)

            # The auth database failing: 503 with Retry-After, and no ban, however many retries.
            psql("ALTER TABLE sip_auth_fixture RENAME TO sip_auth_fixture_down")
            try:
                replies = [register("127.0.0.2", "fixture-secret-a.test") for _ in range(limit + 2)]
            finally:
                psql("ALTER TABLE sip_auth_fixture_down RENAME TO sip_auth_fixture")
            codes = [reply and int(reply.split()[1]) for reply in replies]
            assert codes == [503] * (limit + 2), f"database outage: {codes}"
            assert all("Retry-After: 30" in reply for reply in replies), "503 without Retry-After"
            print(f"PASS {limit + 2} requests during a database failure get 503 Retry-After")
            reply = register("127.0.0.2", "fixture-secret-a.test")
            assert reply and int(reply.split()[1]) == 200, f"after the outage: {reply and reply.splitlines()[0]}"
            print("PASS the same address registers once the database is back (I29)")
        except BaseException:
            log.seek(0)
            print("".join(line for line in log if "DEBUG" not in line)[-6000:], file=sys.stderr)
            raise
        finally:
            proc.terminate()
            proc.wait(timeout=5)
