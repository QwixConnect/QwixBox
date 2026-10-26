#!/usr/bin/env python3
"""Ring groups apply each member's DND and call waiting (I05). Run as root inside a disposable
full-install container, like forwarding.py, whose registered handsets it reuses:

    python3 /usr/src/qwixbox/tests/ring-group-policy.py

A simultaneous group of D (DND), B (call waiting off) and C (normal), all registered handsets that
ring and never answer:

1. A call to the group rings B and C, never D.
2. With B already ringing on a direct call, a call to the group rings C only.
3. Sequential, in the order D, B, C: B rings first and D never does. It also records when C starts
   ringing after B: each member rings for the group's ring timeout in turn.
4. With every member on DND, the call goes to the failover extension F.

It deletes what it created on exit.
"""
import importlib.util
import os
import threading
import time

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("h", os.path.join(here, "outbound-callerid.py"))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
spec = importlib.util.spec_from_file_location("f", os.path.join(here, "forwarding.py"))
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)

FS_CLI = "/usr/local/freeswitch/bin/fs_cli"
results = []


def check(label, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'} {label}{': ' + str(detail) if detail else ''}", flush=True)


class Handset(f.Endpoint):
    """forwarding.py's handset, recording when each INVITE arrived rather than only the first."""

    def __init__(self, *args):
        self.invites = []
        super().__init__(*args, on_invite=None)

    def run(self):
        # forwarding.Endpoint.run, recording every INVITE: ring, and answer CANCEL with 487.
        ringing = {}
        while not self.stop.is_set():
            try:
                data, peer = self.sock.recvfrom(65535)
            except OSError:
                continue
            message = data.decode(errors="replace")
            if "\r\nTo:" not in message and "\r\nt:" not in message:
                continue  # keep-alives and fragments
            if message.startswith("INVITE "):
                self.invites.append(time.time())
                ringing[f.headers(message)["call-id"][0]] = message
                self.sock.sendto(f.reply_to(message, 180, "Ringing", "handset"), peer)
            elif message.startswith("CANCEL "):
                self.sock.sendto(f.reply_to(message, 200, "OK", "handset"), peer)
                invite = ringing.pop(f.headers(message)["call-id"][0], None)
                if invite:
                    self.sock.sendto(f.reply_to(invite, 487, "Request Terminated", "handset"), peer)
            elif not message.startswith(("SIP/2.0", "ACK ")):
                self.sock.sendto(f.reply_to(message, 200, "OK", "handset"), peer)


def call_async(domain, number, caller):
    h.DIALLED = number
    thread = threading.Thread(target=h.place_call, args=(domain, caller["number"], caller["sipPassword"]))
    thread.start()
    return thread


def hang_up_all(handsets):
    h.sh(f"{FS_CLI} -x 'hupall NORMAL_CLEARING'", check=False)
    time.sleep(2)
    for handset in handsets:
        handset.invites.clear()


def main():
    h.sign_in()
    domain = h.api("GET", "/api/tenant")[1]["sipDomain"]
    stamp = str(int(time.time()) % 100).zfill(2)
    created, handsets, threads = [], [], []
    try:
        ext = {}
        for name in ["K", "O", "D", "B", "C", "F"]:
            status, body = h.api("POST", "/api/extensions", {"number": f"74{stamp}{'KODBCF'.index(name)}", "displayName": f"I05 {name}"})
            assert status == 201, (status, body)
            created.insert(0, f"/api/extensions/{body['id']}")
            ext[name] = body
        assert h.api("PATCH", f"/api/extensions/{ext['D']['id']}", {"dnd": True})[0] == 200
        assert h.api("PATCH", f"/api/extensions/{ext['B']['id']}", {"callWaitingEnabled": False, "voicemailEnabled": False})[0] == 200
        status, group = h.api("POST", "/api/ring-groups", {"number": f"75{stamp}", "name": "I05 group", "strategy": "simultaneous",
                                                           "ringTimeoutSec": 5, "failoverType": "extension", "failoverId": ext["F"]["id"]})
        assert status == 201, (status, group)
        created.insert(0, f"/api/ring-groups/{group['id']}")
        for position, name in enumerate(["D", "B", "C"]):
            status, body = h.api("POST", f"/api/ring-groups/{group['id']}/members", {"extensionId": ext[name]["id"], "position": position})
            assert status in (200, 201), (status, body)
        time.sleep(3)  # let the projections publish the profiles and the group
        hs = {name: Handset(domain, ext[name]["number"], ext[name]["sipPassword"]) for name in ["D", "B", "C", "F"]}
        handsets = list(hs.values())

        threads.append(call_async(domain, group["number"], ext["K"]))
        time.sleep(3)
        rang = sorted(n for n, x in hs.items() if x.invites)
        check("simultaneous: B and C ring, D (DND) does not", rang == ["B", "C"], rang)
        hang_up_all(handsets)

        threads.append(call_async(domain, ext["B"]["number"], ext["O"]))
        h.wait_for(lambda: hs["B"].invites, 5)
        usage = h.sh(f"{FS_CLI} -x 'limit_usage hash {domain} {ext['B']['number']}'", check=False)
        hs["B"].invites.clear()
        threads.append(call_async(domain, group["number"], ext["K"]))
        time.sleep(3)
        rang = sorted(n for n, x in hs.items() if x.invites)
        check("B on a call with call waiting off: only C rings", rang == ["C"], f"{rang}, B's usage {usage}")
        hang_up_all(handsets)

        assert h.api("PATCH", f"/api/ring-groups/{group['id']}", {"strategy": "sequential"})[0] == 200
        time.sleep(3)
        threads.append(call_async(domain, group["number"], ext["K"]))
        h.wait_for(lambda: hs["C"].invites, 15)
        first = min((x.invites[0], n) for n, x in hs.items() if x.invites)[1] if any(x.invites for x in hs.values()) else None
        check("sequential: B rings first and D never", first == "B" and not hs["D"].invites, f"first {first}")
        gap = hs["C"].invites[0] - hs["B"].invites[0] if hs["B"].invites and hs["C"].invites else None
        check("sequential: C rings once B's 5s ring timeout ends", gap is not None and 4 <= gap <= 8,
              f"C started {gap:.1f}s after B" if gap is not None else "C never rang")
        hang_up_all(handsets)

        for name in ["B", "C"]:
            assert h.api("PATCH", f"/api/extensions/{ext[name]['id']}", {"dnd": True})[0] == 200
        time.sleep(3)
        threads.append(call_async(domain, group["number"], ext["K"]))
        h.wait_for(lambda: hs["F"].invites, 8)
        rang = sorted(n for n, x in hs.items() if x.invites)
        check("every member on DND: the failover extension rings", rang == ["F"], rang)
        hang_up_all(handsets)
    finally:
        h.sh(f"{FS_CLI} -x 'hupall NORMAL_CLEARING'", check=False)
        for handset in handsets:
            handset.close()
        for thread in threads:
            thread.join(20)
        for path in created:
            h.api("DELETE", path)
    print(f"\n{sum(results)}/{len(results)} checks passed", flush=True)
    raise SystemExit(0 if results and all(results) else 1)


if __name__ == "__main__":
    main()
