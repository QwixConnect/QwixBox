#!/usr/bin/env python3
"""Roll an upgrade back by the procedure in docs/rollback.md, end to end (I14). Run as root inside a
disposable full-install container; it replaces the qwixbox database and edits the checkout:

    python3 /usr/src/qwixbox/tests/rollback-drill.py

It makes extension A, then "upgrades" to a release whose schema adds a column (step 41 takes the
pre-upgrade dump). After the upgrade it deletes A and adds extension B and a trunk, so the dump and
the live projections disagree in both directions. It then rolls back: restores the dump, re-runs
step 22 for the database grants and step 41 for the previous release, and runs
reconcile-kamailio.ts. Afterwards A must be back everywhere, and B and the trunk gone everywhere,
including Kamailio and Redis, which the restore alone does not touch.
"""
import glob
import importlib.util
import json
import os
import time

spec = importlib.util.spec_from_file_location("h", os.path.join(os.path.dirname(__file__), "outbound-callerid.py"))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

REPO = "/usr/src/qwixbox"
SCHEMA = f"{REPO}/portal/api/src/db/schema.ts"
DUMPS = "/var/backups/qwixbox/pre-upgrade"
results = []


def check(label, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'} {label}{': ' + str(detail) if detail else ''}", flush=True)


def step(name, env=""):
    h.sh(f"cd {REPO} && {env} ./install.sh --only {name} --force --quiet")


def kamailio(query):
    return h.sh(f"su - postgres -c \"psql -d kamailio -tAc \\\"{query}\\\"\"").strip()


def qwixbox(query):
    return h.sh(f"su - postgres -c \"psql -d qwixbox -tAc \\\"{query}\\\"\"").strip()


def subscriber(number, domain):
    return kamailio(f"SELECT count(*) FROM subscriber WHERE username = '{number}' AND domain = '{domain}'") == "1"


def cached(number, domain):
    return h.redis("EXISTS", f"qwixbox:dir:{domain}:{number}").strip() == "1"


def health():
    return json.loads(h.sh("curl -s http://127.0.0.1:3000/health", check=False) or "{}")


def main():
    original = open(SCHEMA).read()
    assert "i14_drill" not in original and qwixbox(
        "SELECT count(*) FROM information_schema.columns WHERE column_name = 'i14_drill'") == "0", \
        "a previous drill was left half-done: redeploy step 41 with SCHEMA_ACCEPT_DESTRUCTIVE=1 first"
    h.sign_in()
    domain = h.api("GET", "/api/tenant")[1]["sipDomain"]
    stamp = str(int(time.time()) % 1000).zfill(3)
    status, a = h.api("POST", "/api/extensions", {"number": "8" + stamp, "displayName": "Before upgrade"})
    assert status == 201, (status, a)
    created = [a]
    try:
        assert h.wait_for(lambda: subscriber(a["number"], domain), 20), "A was never projected"

        # The upgrade: a release whose schema adds a column.
        marker = 'references(() => organization.id, { onDelete: "cascade" }),\n'
        assert original.count(marker) >= 1
        open(SCHEMA, "w").write(original.replace(marker, marker + '    i14Drill: text("i14_drill"),\n', 1))
        step("41-api-deploy.sh")
        dump = max(glob.glob(f"{DUMPS}/qwixbox-*.dump"), key=os.path.getmtime)
        check("the upgrade applied the new column", qwixbox("SELECT count(*) FROM information_schema.columns WHERE column_name = 'i14_drill'") == "1")
        h.sign_in()

        # Life after the upgrade: A deleted, B and a trunk added.
        deleted = h.api("DELETE", f"/api/extensions/{a['id']}")
        assert deleted[0] == 204, deleted
        status, b = h.api("POST", "/api/extensions", {"number": "9" + stamp, "displayName": "After upgrade"})
        assert status == 201, (status, b)
        created.append(b)
        status, trunk = h.api("POST", "/api/trunks", {"name": "I14 drill", "host": "192.0.2.77", "port": 5060, "transport": "udp"})
        assert status == 201, (status, trunk)
        assert h.wait_for(lambda: subscriber(b["number"], domain) and not subscriber(a["number"], domain), 20)
        assert h.wait_for(lambda: kamailio(f"SELECT count(*) FROM address WHERE tag = '{trunk['id']}'") == "1", 20)

        # The rollback, exactly as docs/rollback.md gives it.
        open(SCHEMA, "w").write(original)
        h.sh("systemctl stop qwixbox-api")
        h.sh(f"su - postgres -c 'dropdb --force qwixbox && createdb -O qwixbox qwixbox' "
             f"&& su - postgres -c 'pg_restore --exit-on-error -d qwixbox' < {dump}")
        step("22-provision-databases.sh")
        step("41-api-deploy.sh")
        assert h.wait_for(lambda: health().get("database"), 30), "API did not come back"
        h.sign_in()
        check("the restored schema has no new column", qwixbox("SELECT count(*) FROM information_schema.columns WHERE column_name = 'i14_drill'") == "0")
        check("before reconciling, B can still register (the gap the CLI closes)", subscriber(b["number"], domain))

        h.sh("cd /opt/qwixbox-api && sudo -u qwixbox bun run src/cli/reconcile-kamailio.ts")
        drained = h.wait_for(lambda: health().get("projections", {}).get("pending") == 0, 60)
        check("the reconcile jobs drained", drained, health().get("projections"))
        numbers = {e["number"] for e in h.api("GET", "/api/extensions")[1]}
        check("A is back in the database", a["number"] in numbers)
        check("A is back in Kamailio", subscriber(a["number"], domain))
        check("A is back in the cache", h.wait_for(lambda: cached(a["number"], domain), 20))
        check("B is gone from the database", b["number"] not in numbers)
        check("B can no longer register", not subscriber(b["number"], domain))
        check("B is gone from the cache", not cached(b["number"], domain))
        check("the trunk is no longer trusted", kamailio(f"SELECT count(*) FROM address WHERE tag = '{trunk['id']}'") == "0")
        check("health is ok", health().get("status") == "ok", health())
    finally:
        open(SCHEMA, "w").write(original)
        if h.api_up():
            for ext in created:
                h.api("DELETE", f"/api/extensions/{ext['id']}")
    print(f"\n{sum(results)}/{len(results)} checks passed", flush=True)
    raise SystemExit(0 if results and all(results) else 1)


if __name__ == "__main__":
    main()
