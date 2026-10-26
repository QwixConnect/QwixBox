#!/usr/bin/env python3
"""After restore.sh, prove the restored host carries calls with the credentials it had before (I13).
Run as root on the restored host, with the probe file written on the source host before the backup:

    python3 /usr/src/qwixbox/tests/restore-check.py /root/restore-probe.json

The probe file holds {id, number, sipPassword, domain} for an extension created before the
snapshot; the API returns sipPassword once, at creation. The check registers that extension with
that password (Kamailio's restored digest, re-projected from the restored ciphertext under the
restored key), then calls it from a new extension and requires the handset to ring. Anything it
creates is deleted on exit.
"""
import importlib.util
import json
import os
import sys
import time

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("h", os.path.join(here, "outbound-callerid.py"))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
spec = importlib.util.spec_from_file_location("f", os.path.join(here, "forwarding.py"))
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)

results = []


def check(label, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'} {label}{': ' + str(detail) if detail else ''}", flush=True)


def main():
    probe = json.load(open(sys.argv[1]))
    h.sign_in()
    domain = h.api("GET", "/api/tenant")[1]["sipDomain"]
    check("the tenant came back", domain == probe["domain"], domain)
    status, ext = h.api("GET", f"/api/extensions/{probe['id']}")
    check("the extension came back", status == 200 and ext["number"] == probe["number"], status)

    handset = f.Endpoint(domain, probe["number"], probe["sipPassword"])
    check("it registers with its pre-backup password", True)
    stamp = str(int(time.time()) % 1000).zfill(3)
    status, caller = h.api("POST", "/api/extensions", {"number": "6" + stamp, "displayName": "Restore caller"})
    assert status == 201, (status, caller)
    try:
        h.DIALLED = probe["number"]
        threading_call = __import__("threading").Thread(target=h.place_call, args=(domain, caller["number"], caller["sipPassword"]))
        threading_call.start()
        check("a call to it rings the handset", handset.rang.wait(20))
        threading_call.join(60)
    finally:
        handset.close()
        h.api("DELETE", f"/api/extensions/{caller['id']}")
    print(f"\n{sum(results)}/{len(results)} checks passed", flush=True)
    raise SystemExit(0 if results and all(results) else 1)


if __name__ == "__main__":
    main()
