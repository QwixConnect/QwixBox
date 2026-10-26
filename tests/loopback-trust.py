#!/usr/bin/env python3
"""Kamailio trusts FreeSWITCH by address AND source port, not by address alone (I28). Run as root
inside a disposable full-install container:

    python3 /usr/src/qwixbox/tests/loopback-trust.py

From 127.0.0.1 on an arbitrary port it sends an INVITE with no credentials to the public SIP port,
which must be challenged (407), and one to the egress listener, which must be refused (403).
Before the fix the first reached FreeSWITCH unchallenged and the second was routed towards a
carrier with whatever X-Auth-User it carried. It also checks FreeSWITCH binds UDP only, since a
TCP connection would leave from an ephemeral port. That FreeSWITCH's own traffic is still trusted
is what outbound-callerid.py, forwarding.py and emergency-ingress.py prove: every call they place
crosses both passes.
"""
import importlib.util
import os
import socket
import subprocess
import time

spec = importlib.util.spec_from_file_location("h", os.path.join(os.path.dirname(__file__), "outbound-callerid.py"))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

results = []


def check(label, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'} {label}{': ' + str(detail) if detail else ''}", flush=True)


def invite(domain, port, extra=""):
    """Send an unauthenticated INVITE from 127.0.0.1 to `port`; return the final response code."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))
    sock.settimeout(4)
    src = sock.getsockname()[1]
    uri = f"sip:14165551234@{domain}"
    message = (f"INVITE {uri} SIP/2.0\r\nVia: SIP/2.0/UDP 127.0.0.1:{src};branch=z9hG4bK-lt{time.time_ns()}\r\n"
               f"From: <sip:9999@{domain}>;tag=lt\r\nTo: <{uri}>\r\nCall-ID: lt-{time.time_ns()}\r\nCSeq: 1 INVITE\r\n"
               f"Max-Forwards: 70\r\nContact: <sip:9999@127.0.0.1:{src}>\r\n{extra}Content-Length: 0\r\n\r\n")
    sock.sendto(message.encode(), ("127.0.0.1", port))
    try:
        while True:
            code = int(sock.recv(65535).decode(errors="replace").split()[1])
            if code >= 200:
                return code
    except socket.timeout:
        return None
    finally:
        sock.close()


def main():
    domain = h.config("PBX_SIP_DOMAIN")
    sip, egress = int(h.config("SIP_PORT")), int(h.config("KAM_EGRESS_PORT"))
    code = invite(domain, sip)
    check("a loopback INVITE to the public port is challenged", code == 407, f"final {code}")
    code = invite(domain, egress, f"X-Auth-User: 9999\r\nX-Tenant-Domain: {domain}\r\n")
    check("a loopback INVITE to the egress listener is refused", code == 403, f"final {code}")
    listening = subprocess.run(["ss", "-ltnp"], capture_output=True, text=True).stdout
    check("FreeSWITCH listens on no TCP SIP port", "freeswitch" not in "\n".join(
        line for line in listening.splitlines() if ":508" in line))
    print(f"\n{sum(results)}/{len(results)} checks passed", flush=True)
    raise SystemExit(0 if results and all(results) else 1)


if __name__ == "__main__":
    main()
