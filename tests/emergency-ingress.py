#!/usr/bin/env python3
"""Emergency calls are exempt from the capacity check on Kamailio ingress (I02). Run as root inside
a disposable full-install container, like outbound-callerid.py, whose helpers it reuses:

    python3 /usr/src/qwixbox/tests/emergency-ingress.py

It adds a trunk to a fake carrier on UDP 127.0.0.1:5090 with an emergency route for 933 (the
carrier is fake: nothing leaves the container) and an ordinary NANP route, then sets the test
extension's concurrent-call counter to the limit. At the limit an ordinary call must be refused
before FreeSWITCH (the carrier sees nothing) while 933 must reach the carrier. Clearing the
route's emergency flag must withdraw the exemption, which proves Kamailio's copy follows the
route. It deletes what it created and resets the counter on exit.
"""
import importlib.util
import os
import re
import threading
import time

spec = importlib.util.spec_from_file_location("h", os.path.join(os.path.dirname(__file__), "outbound-callerid.py"))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

EMERGENCY = "933"
ORDINARY = "14165551234"
LIMIT = int(re.search(r"#!define MAX_CONCURRENT_CALLS (\d+)", open("/etc/kamailio/kamailio.cfg").read()).group(1))
results = []


def check(label, ok, detail):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'} {label}: {detail}", flush=True)


def emergency_loaded():
    return h.sh("kamcmd htable.dump emergency", check=False)


def call(number, ext, domain):
    """Dial `number` as `ext`; return (final code, whether the carrier received it)."""
    h.DIALLED = number
    before = len(h.received)
    code = h.place_call(domain, ext["number"], ext["sipPassword"])
    h.wait_for(lambda: len(h.received) > before, 3)
    reached = any(f"INVITE sip:{number}@" in m for m in h.received[before:])
    return code, reached


def main():
    h.sign_in()
    domain = h.api("GET", "/api/tenant")[1]["sipDomain"]
    stop = threading.Event()
    listener = threading.Thread(target=h.carrier, args=(stop,))
    listener.start()
    created = []
    account = None
    try:
        status, trunk = h.api("POST", "/api/trunks", {"name": "I02 carrier", "host": h.CARRIER[0], "port": h.CARRIER[1], "transport": "udp"})
        assert status == 201, (status, trunk)
        created.append(f"/api/trunks/{trunk['id']}")
        status, sos = h.api("POST", "/api/outbound-routes", {"name": "I02 emergency", "pattern": f"^{EMERGENCY}$", "patternSyntax": "pcre", "trunkId": trunk["id"], "isEmergency": True})
        assert status == 201, (status, sos)
        created.insert(0, f"/api/outbound-routes/{sos['id']}")
        status, nanp = h.api("POST", "/api/outbound-routes", {"name": "I02 NANP", "pattern": "^1[0-9]{10}$", "patternSyntax": "pcre", "trunkId": trunk["id"]})
        assert status == 201, (status, nanp)
        created.insert(0, f"/api/outbound-routes/{nanp['id']}")
        stamp = str(int(time.time()) % 1000).zfill(3)
        status, ext = h.api("POST", "/api/extensions", {"number": "7" + stamp, "displayName": "Caller"})
        assert status == 201, (status, ext)
        created.insert(0, f"/api/extensions/{ext['id']}")
        account = f"{ext['number']}@{domain}"

        loaded = h.wait_for(lambda: f"^{EMERGENCY}$" in emergency_loaded(), 30)
        check("projected into Kamailio", loaded, f"htable emergency holds ^{EMERGENCY}$ for {domain}")

        h.sh(f"kamcmd htable.seti concurrent {account} 0")
        code, reached = call(EMERGENCY, ext, domain)
        check("below the limit, 933 reaches the carrier", reached, f"final {code}")

        h.sh(f"kamcmd htable.seti concurrent {account} {LIMIT}")
        code, reached = call(ORDINARY, ext, domain)
        check("at the limit, an ordinary call is refused at ingress", code == 486 and not reached, f"final {code}, carrier received it: {reached}")
        code, reached = call(EMERGENCY, ext, domain)
        check("at the limit, 933 still reaches the carrier", reached, f"final {code}")

        status, _ = h.api("PATCH", f"/api/outbound-routes/{sos['id']}", {"isEmergency": False})
        assert status == 200, status
        gone = h.wait_for(lambda: f"^{EMERGENCY}$" not in emergency_loaded(), 30)
        check("clearing the flag withdraws the pattern", gone, "htable no longer holds it")
        code, reached = call(EMERGENCY, ext, domain)
        check("at the limit, 933 without an emergency route is refused", code == 486 and not reached, f"final {code}, carrier received it: {reached}")
    finally:
        stop.set()
        listener.join()
        if account:
            h.sh(f"kamcmd htable.delete concurrent {account}", check=False)
        for path in created:
            h.api("DELETE", path)
    print(f"\n{sum(results)}/{len(results)} checks passed", flush=True)
    raise SystemExit(0 if results and all(results) else 1)


if __name__ == "__main__":
    main()
