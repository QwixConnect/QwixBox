#!/usr/bin/env python3
"""Run the deployed nginx templates against a stub API and check the auth rate limits (I21).

Needs root and nginx (disposable Debian 13 container): it binds 80/443 on loopback. The stub
counts what reaches the API, so a refusal is proven at the edge rather than inferred from a status.
"""
import http.client
import http.server
import pathlib
import re
import shutil
import ssl
import subprocess
import tempfile
import threading

repo = pathlib.Path(__file__).resolve().parents[1]
conf = repo / "resources/conf/nginx"
API_PORT = 18080
HOST = "pbx.example.test"

reached = []

class Stub(http.server.BaseHTTPRequestHandler):
    def answer(self):
        length = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(length)
        reached.append(self.path)
        body = b"{}"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    do_GET = do_POST = answer
    def log_message(self, *args):
        pass

def render(text, values):
    for key, value in values.items():
        text = text.replace(f"@{key}@", value)
    leftover = re.findall(r"@[A-Z_]+@", text)
    assert not leftover, f"Unrendered placeholders: {leftover}"
    return text

insecure = ssl.create_default_context()
insecure.check_hostname = False
insecure.verify_mode = ssl.CERT_NONE

def request(path, method="GET", body=None, source="127.0.0.1"):
    # nginx keys both zones on the client address, so each check uses its own loopback source
    # address and starts from an empty bucket rather than one a previous check drained.
    conn = http.client.HTTPSConnection("127.0.0.1", 443, context=insecure, timeout=5,
                                       source_address=(source, 0))
    try:
        conn.request(method, path, body=body, headers={"Host": HOST, "Content-Type": "application/json"})
        return conn.getresponse().status
    finally:
        conn.close()

with tempfile.TemporaryDirectory(prefix="qwixbox-nginx-") as folder:
    root = pathlib.Path(folder)
    (root / "logs").mkdir()
    (root / "web").mkdir()
    (root / "web/index.html").write_text("<!doctype html>")
    tls = root / "tls"
    tls.mkdir()
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-subj", f"/CN={HOST}", "-keyout", tls / "privkey.pem", "-out", tls / "fullchain.pem"],
                   check=True, capture_output=True)
    values = {"API_PORT": str(API_PORT), "PBX_FQDN": HOST, "TLS_DIR": str(tls), "WEB_ROOT": str(root / "web")}
    shutil.copy(conf / "proxy_params", root / "proxy_params")
    site = render((conf / "sites-available/qwixbox-api").read_text(), values)
    site = site.replace("/etc/nginx/proxy_params", str(root / "proxy_params"))
    site = site.replace("/var/log/nginx/", f"{root}/logs/")
    hardening = (conf / "conf.d/00-hardening.conf").read_text().replace("ssl_stapling on;", "ssl_stapling off;")
    (root / "nginx.conf").write_text(f"""
pid {root}/nginx.pid;
error_log {root}/logs/error.log warn;
events {{}}
http {{
    access_log off;
    {hardening}
    {(conf / "conf.d/01-upgrade-map.conf").read_text()}
    {site}
}}
""")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", API_PORT), Stub)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    nginx = ["nginx", "-p", str(root), "-c", str(root / "nginx.conf")]
    subprocess.run(nginx + ["-t"], check=True, capture_output=True)
    subprocess.run(nginx, check=True)
    try:
        # A signed-in operator with four tabs: each boots the SPA (session, organization list,
        # set-active, role), the Users page lists members, and every focus change refetches the
        # session. This is ordinary use and must never be throttled.
        reached.clear()
        routine = []
        for _ in range(4):
            routine += ["/api/auth/get-session", "/api/auth/organization/list",
                        "/api/auth/organization/get-active-member-role"]
            routine.append(("/api/auth/organization/set-active", "POST"))
            routine.append("/api/auth/organization/list-members?organizationId=t1")
        routine += ["/api/auth/get-session"] * 20
        statuses = [request(*p) if isinstance(p, tuple) else request(p) for p in routine]
        refused = [s for s in statuses if s != 200]
        assert len(reached) == len(statuses), "Routine requests did not all reach the API"
        assert not refused, f"Routine portal traffic was throttled: {len(refused)} of {len(statuses)} refused ({set(refused)})"
        print(f"PASS routine session/organization traffic ({len(statuses)} requests) is not throttled")

        # Credential guessing must still be refused at the edge, before it reaches the API.
        reached.clear()
        statuses = [request("/api/auth/sign-in/email", "POST", b'{"email":"a@b.c","password":"x"}', "127.0.0.2")
                    for _ in range(30)]
        assert len(reached) <= 6, f"{len(reached)} of 30 sign-in attempts reached the API"
        assert statuses.count(429) >= 24, f"Expected 429 refusals, got {statuses}"
        print(f"PASS sign-in brute force refused at nginx ({len(reached)} of 30 reached the API)")

        # The strict zone is the default for /api/auth: anything not on the routine list - a reset,
        # a password change, an endpoint added by a future better-auth release - stays throttled,
        # including a routine name smuggled into the query string.
        for index, path in enumerate(["/api/auth/request-password-reset", "/api/auth/reset-password",
                     "/api/auth/change-password", "/api/auth/sign-in/email?x=/get-session",
                     "/api/auth/some-future-endpoint"]):
            reached.clear()
            statuses = [request(path, "POST", b"{}", f"127.0.0.{10 + index}") for _ in range(12)]
            assert 1 <= len(reached) <= 6, f"{path}: {len(reached)} of 12 reached the API"
            assert 429 in statuses, f"{path}: never refused ({statuses})"
        print("PASS credential, reset and unlisted auth endpoints share the strict limit")

        assert request("/api/auth/sign-up/email", "POST", b"{}") == 404
        print("PASS sign-up still 404s at the edge")
    finally:
        subprocess.run(nginx + ["-s", "stop"], capture_output=True)
        server.shutdown()
