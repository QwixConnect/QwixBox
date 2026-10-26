#!/usr/bin/env python3
"""Carrier-originated forwarding (R11, D5). Run as root inside a disposable full-install container,
like outbound-callerid.py, whose helpers it reuses:

    python3 /usr/src/qwixbox/tests/forwarding.py

A fake carrier on <container address>:5090 is both a trusted peer (its trunk's address) and the
trunk the outbound route sends to. It places inbound calls to a test DID and records every INVITE
Kamailio sends back out. Cases: the peer dials an external number directly (refused); DID ->
external; DID -> extension forwarding -> external; a two-extension chain; a forwarding loop
(MAX_DEPTH); a no-answer forward; and that forward with the API stopped mid-ring, which D5 says
must be refused with a tone. Never run it on a real install; it deletes what it created on exit.
"""
import importlib.util
import os
import re
import socket
import threading
import time

spec = importlib.util.spec_from_file_location("h", os.path.join(os.path.dirname(__file__), "outbound-callerid.py"))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

LOCAL = h.LOCAL
CARRIER = (LOCAL, 5090)
EXTERNAL = "14165551234"
DID = "+14165550177"
SIP_PORT = int(h.config("SIP_PORT"))
results = []


def check(label, ok, detail):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'} {label}: {detail}", flush=True)


def headers(message):
    head = {}
    for line in message.split("\r\n")[1:]:
        if not line:
            break
        if ":" in line:
            name, value = line.split(":", 1)
            head.setdefault(name.strip().lower(), []).append(value.strip())
    return head


def reply_to(message, code, reason, tag="x"):
    head = headers(message)
    out = f"SIP/2.0 {code} {reason}\r\n"
    for via in head.get("via", []):
        out += f"Via: {via}\r\n"
    to = head["to"][0] if ";tag=" in head["to"][0] else f"{head['to'][0]};tag={tag}"
    out += f"From: {head['from'][0]}\r\nTo: {to}\r\nCall-ID: {head['call-id'][0]}\r\n"
    out += f"CSeq: {head['cseq'][0]}\r\nContent-Length: 0\r\n\r\n"
    return out.encode()


class Carrier:
    """One socket: sends our inbound calls, answers Kamailio's outbound INVITEs with 486."""

    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(CARRIER)
        self.sock.settimeout(0.5)
        self.egress = []
        self.responses = []
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run)
        self.thread.start()

    def run(self):
        while not self.stop.is_set():
            try:
                data, peer = self.sock.recvfrom(65535)
            except socket.timeout:
                continue
            message = data.decode(errors="replace")
            if message.startswith("SIP/2.0"):
                self.responses.append(message)
            elif message.startswith("INVITE "):
                self.egress.append(message)
                self.sock.sendto(reply_to(message, 486, "Busy Here", "carrier"), peer)
            elif not message.startswith("ACK "):
                self.sock.sendto(reply_to(message, 200, "OK", "carrier"), peer)

    def call(self, number, timeout=40):
        """Place an inbound call to `number`; return (final code, outbound INVITEs it caused)."""
        call_id = f"fwd-{time.time_ns()}"
        uri = f"sip:{number}@{LOCAL}:{SIP_PORT}"
        sdp = (f"v=0\r\no=- 1 1 IN IP4 {LOCAL}\r\ns=-\r\nc=IN IP4 {LOCAL}\r\nt=0 0\r\n"
               f"m=audio 5092 RTP/AVP 0\r\na=rtpmap:0 PCMU/8000\r\n")
        branch = f"z9hG4bK-fwd{time.time_ns()}"
        common = (f"Via: SIP/2.0/UDP {LOCAL}:5090;branch={branch}\r\nFrom: <sip:+14165550000@carrier.test>;tag=c\r\n"
                  f"To: <sip:{number}@{LOCAL}>\r\nCall-ID: {call_id}\r\nMax-Forwards: 70\r\n")
        egress_before = len(self.egress)
        self.sock.sendto((f"INVITE {uri} SIP/2.0\r\n{common}CSeq: 1 INVITE\r\nContact: <sip:carrier@{LOCAL}:5090>\r\n"
                          f"Content-Type: application/sdp\r\nContent-Length: {len(sdp)}\r\n\r\n{sdp}").encode(), (LOCAL, SIP_PORT))
        final = None
        end = time.time() + timeout
        while time.time() < end and final is None:
            for message in [m for m in self.responses if call_id in m and "INVITE" in headers(m).get("cseq", [""])[0]]:
                code = int(message.split()[1])
                if code >= 200:
                    final = (code, message)
            time.sleep(0.2)
        if final:
            to = headers(final[1])["to"][0]
            ack = f"ACK {uri} SIP/2.0\r\n{common.replace(f'To: <sip:{number}@{LOCAL}>', f'To: {to}')}CSeq: 1 ACK\r\nContent-Length: 0\r\n\r\n"
            self.sock.sendto(ack.encode(), (LOCAL, SIP_PORT))
        time.sleep(1)
        return (final[0] if final else None), self.egress[egress_before:]

    def close(self):
        self.stop.set()
        self.thread.join()
        self.sock.close()


class Endpoint:
    """A registered handset that rings and never answers, so the no-answer forward runs."""

    def __init__(self, domain, number, password, on_invite=None):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind((LOCAL, 0))
        self.sock.settimeout(3)
        self.port = self.sock.getsockname()[1]
        self.on_invite = on_invite
        self.rang = threading.Event()
        assert self.register(domain, number, password, 60) == 200, "endpoint could not register"
        self.domain, self.number, self.password = domain, number, password
        self.sock.settimeout(0.5)
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run)
        self.thread.start()

    def register(self, domain, number, password, expires):
        md5 = lambda value: __import__("hashlib").md5(value.encode()).hexdigest()

        def send(seq, authorization=""):
            message = (f"REGISTER sip:{domain} SIP/2.0\r\nVia: SIP/2.0/UDP {LOCAL}:{self.port};branch=z9hG4bK-fr{seq}{time.time_ns()}\r\n"
                       f"From: <sip:{number}@{domain}>;tag=fr\r\nTo: <sip:{number}@{domain}>\r\nCall-ID: fr-{number}-{self.port}\r\n"
                       f"CSeq: {seq} REGISTER\r\nMax-Forwards: 10\r\nContact: <sip:{number}@{LOCAL}:{self.port}>\r\nExpires: {expires}\r\n"
                       f"{authorization}Content-Length: 0\r\n\r\n")
            self.sock.sendto(message.encode(), (LOCAL, SIP_PORT))
            while True:
                reply = self.sock.recv(65535).decode()
                if reply.startswith("SIP/2.0") and not re.match(r"SIP/2.0 1\d\d", reply):
                    return reply

        challenge = send(int(time.time()) % 1000 * 2 + 1)
        nonce = re.search(r'nonce="([^"]+)"', challenge)
        if not nonce:
            return int(challenge.split()[1])
        digest = md5(f'{md5(f"{number}:{domain}:{password}")}:{nonce.group(1)}:{md5(f"REGISTER:sip:{domain}")}')
        header = f'Authorization: Digest username="{number}", realm="{domain}", nonce="{nonce.group(1)}", uri="sip:{domain}", response="{digest}"\r\n'
        return int(send(int(time.time()) % 1000 * 2 + 2, header).split()[1])

    def run(self):
        ringing = {}
        while not self.stop.is_set():
            try:
                data, peer = self.sock.recvfrom(65535)
            except socket.timeout:
                continue
            message = data.decode(errors="replace")
            if message.startswith("INVITE "):
                ringing[headers(message)["call-id"][0]] = message
                self.sock.sendto(reply_to(message, 180, "Ringing", "handset"), peer)
                if not self.rang.is_set():
                    self.rang.set()
                    if self.on_invite:
                        threading.Thread(target=self.on_invite).start()
            elif message.startswith("CANCEL "):
                self.sock.sendto(reply_to(message, 200, "OK", "handset"), peer)
                invite = ringing.pop(headers(message)["call-id"][0], None)
                if invite:
                    self.sock.sendto(reply_to(invite, 487, "Request Terminated", "handset"), peer)
            elif not message.startswith(("SIP/2.0", "ACK ")):
                self.sock.sendto(reply_to(message, 200, "OK", "handset"), peer)

    def close(self):
        self.stop.set()
        self.thread.join()
        self.sock.settimeout(3)
        try:
            self.register(self.domain, self.number, self.password, 0)
        except (socket.timeout, OSError):
            pass
        self.sock.close()


def presented_number(invite):
    line = next(l for l in invite.split("\r\n") if l.lower().startswith("from:"))
    match = re.search(r"<sip:([^@>]+)@", line)
    return match.group(1) if match else None


def fs_log_since(lines_before):
    return h.sh(f"tail -n +{lines_before + 1} {h.FS_LOG}", check=False)


def main():
    h.sign_in()
    domain = h.api("GET", "/api/tenant")[1]["sipDomain"]
    carrier = Carrier()
    created = []
    endpoint = None
    try:
        status, trunk = h.api("POST", "/api/trunks", {"name": "R11 carrier", "host": LOCAL, "port": 5090, "transport": "udp"})
        assert status == 201, (status, trunk)
        created.append(f"/api/trunks/{trunk['id']}")
        status, route = h.api("POST", "/api/outbound-routes", {"name": "R11 NANP", "pattern": "^1[0-9]{10}$", "patternSyntax": "pcre", "trunkId": trunk["id"]})
        assert status == 201, (status, route)
        created.insert(0, f"/api/outbound-routes/{route['id']}")
        assert h.api("PATCH", "/api/tenant", {"defaultCallerIdNumber": "+14165550100"})[0] == 200
        stamp = str(int(time.time()) % 100).zfill(2)
        exts = []
        for suffix, caller_id in (("1", "+14165550101"), ("2", "+14165550102")):
            status, ext = h.api("POST", "/api/extensions", {"number": f"7{stamp}{suffix}", "displayName": f"R11 {suffix}", "callerIdNumber": caller_id})
            assert status == 201, (status, ext)
            created.insert(0, f"/api/extensions/{ext['id']}")
            exts.append(ext)
        x, y = exts
        status, did = h.api("POST", "/api/inbound-routes", {"didPattern": DID, "destinationType": "external", "destinationId": EXTERNAL})
        assert status == 201, (status, did)
        created.insert(0, f"/api/inbound-routes/{did['id']}")
        # The trunk's address must be trusted before the carrier can call in. Wait for Kamailio
        # itself to hold it: a reload within 5s of the previous one is refused, and the
        # projection has to notice and retry (kamcmd reports that refusal on stdout).
        assert h.wait_for(lambda: LOCAL in h.sh("kamcmd permissions.addressDump", check=False), 60), \
            "Kamailio never trusted the carrier's address"

        def configure(did_body=None, x_body=None, y_body=None):
            for path, body in ((f"/api/inbound-routes/{did['id']}", did_body), (f"/api/extensions/{x['id']}", x_body), (f"/api/extensions/{y['id']}", y_body)):
                if body:
                    status, reply = h.api("PATCH", path, body)
                    assert status == 200, (path, status, reply)
            h.api("POST", "/api/tenant/rebuild-cache")
            h.sh("/usr/local/freeswitch/bin/fs_cli -x xml_flush_cache", check=False)
            time.sleep(2)

        clear = {"forwardAllTo": None, "forwardNoAnswerTo": None, "ringTimeoutSec": None}

        code, out = carrier.call(EXTERNAL)
        check("peer dialling an external number directly is refused", not out and code is not None and code >= 400,
              f"final {code}, {len(out)} outbound INVITE(s)")

        configure()
        code, out = carrier.call(DID)
        check("DID -> external places the call as the tenant", len(out) == 1 and presented_number(out[0]) == "+14165550100",
              f"final {code}, outbound From {[presented_number(m) for m in out]}")

        configure({"destinationType": "extension", "destinationId": x["id"]}, {**clear, "forwardAllTo": EXTERNAL})
        code, out = carrier.call(DID)
        check("DID -> extension forward-all -> external places it as that extension",
              len(out) == 1 and presented_number(out[0]) == "+14165550101", f"final {code}, outbound From {[presented_number(m) for m in out]}")

        configure(None, {"forwardAllTo": y["number"]}, {**clear, "forwardAllTo": EXTERNAL})
        code, out = carrier.call(DID)
        check("DID -> extension -> extension -> external places it as the last extension",
              len(out) == 1 and presented_number(out[0]) == "+14165550102", f"final {code}, outbound From {[presented_number(m) for m in out]}")

        configure(None, None, {"forwardAllTo": x["number"]})
        before = int(h.sh(f"wc -l < {h.FS_LOG}"))
        code, out = carrier.call(DID)
        hops = "exceeded" in fs_log_since(before)
        check("a forwarding loop stops at MAX_DEPTH", not out and hops and code is not None and code >= 400,
              f"final {code}, {len(out)} outbound, MAX_DEPTH logged: {hops}")

        configure(None, {**clear, "forwardNoAnswerTo": EXTERNAL, "ringTimeoutSec": 5}, clear)
        endpoint = Endpoint(domain, x["number"], x["sipPassword"])
        code, out = carrier.call(DID)
        check("no-answer forward of a carrier call reaches the carrier", endpoint.rang.is_set() and len(out) == 1
              and presented_number(out[0]) == "+14165550101", f"rang {endpoint.rang.is_set()}, final {code}, {len(out)} outbound")
        endpoint.close()
        endpoint = None

        # D5: the API goes down while the handset rings; the forward must be refused, with a tone
        # and a server error (FreeSWITCH responds 503, which Kamailio must forward as 500).
        configure(None, {"ringTimeoutSec": 8})
        endpoint = Endpoint(domain, x["number"], x["sipPassword"], on_invite=lambda: h.sh("systemctl stop qwixbox-api"))
        before = int(h.sh(f"wc -l < {h.FS_LOG}"))
        code, out = carrier.call(DID)
        log = fs_log_since(before)
        refused = "refusing to forward a carrier call" in log
        check("with the API down the forward is refused with a tone (D5)", endpoint.rang.is_set() and not out and refused and code is not None and 500 <= code < 600,
              f"rang {endpoint.rang.is_set()}, final {code}, {len(out)} outbound, refusal logged: {refused}")
    finally:
        h.sh("systemctl start qwixbox-api", check=False)
        h.wait_for(h.api_up, 60)
        if endpoint:
            endpoint.close()
        carrier.close()
        h.sign_in()
        h.api("PATCH", "/api/tenant", {"defaultCallerIdNumber": None})
        for path in created:
            if path.startswith("/api/extensions/"):
                h.api("PATCH", path, {"forwardAllTo": None, "forwardNoAnswerTo": None})
        for path in created:
            status, reply = h.api("DELETE", path)
            if status >= 300:
                print(f"cleanup: DELETE {path} -> {status} {reply}", flush=True)
    print(f"\n{sum(results)}/{len(results)} checks passed", flush=True)
    raise SystemExit(0 if results and all(results) else 1)


if __name__ == "__main__":
    main()
