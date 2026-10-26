# Acceptance procedures

Procedures for gates 2, 3, 4, 5 and 7 in [mvp.md](mvp.md). Gates 1 and 6 are in
[hardware testing](testing-on-real-hardware.md), and gate 8 is the M1 exit check in the
[delivery plan](mvp-plan.md).

Each procedure states its pass condition before the steps. Decide the result against that
condition, not against what the run happened to show. Record every run, including failures, as a
row under [Acceptance runs](status.md#acceptance-runs) in the status page. A gate passes only when
a recorded run on the release candidate meets every condition.

**Two kinds of evidence, never mixed.** A *container* run uses the repository harnesses in a
disposable systemd container with a fake carrier. Those harnesses stop services, refuse database
roles and delete what they create, so **never run them on a real install**. A *host* run uses the
amd64 release-candidate host with real endpoints and the test carrier (D3). Where a gate lists
both, both are required.

Record these for every run:

- the revision (`git rev-parse --short HEAD` on the host);
- the host, its architecture and its OS release;
- the component versions: `freeswitch -version`, `kamailio -v | head -1`, `rtpengine --version`,
  `psql --version`, `redis-server --version`, `bun --version`;
- the procedure and section run, the result against each numbered condition, and where the raw
  output or capture is kept.

## Common preparation (host runs)

- The host has passed gate 6: a full install, a clean postflight and an idempotent re-run.
- One test tenant, created by step 44 or `provision-tenant.ts`, with two registered endpoints:
  extensions **1001** and **1002**. They should be on different networks, as in gate 1.
- A third extension, **1003**, registered on a softphone you can leave unanswered.
- For gates 2 and 3, `SMTP_HOST` is configured and a mailbox you can read receives the mail.

---

## Gate 2: call features

**Pass when all of these hold on the release candidate:**

1. A message left for 1002 plays back through `*97` on 1002 and through `*98` from 1001 (with
   the PIN), and its notification email arrives with the recording attached.
2. The received voicemail email shows a DKIM pass for `MAIL_DOMAIN` in the receiver's
   authentication results.
3. An IVR plays its greeting. Each configured digit, including `#`, reaches its destination.
   With no input, the timeout destination is reached.
4. With DND on (`*78`), a call to 1002 is not offered to 1002 and goes to voicemail. `*79`
   restores it.
5. Each forward reaches its target, and each cancel code restores normal ringing. The forwards
   are `*72<n>` (unconditional), `*90<n>` (busy) and `*92<n>` (no answer); the cancels are `*73`,
   `*91` and `*93`.
6. With call waiting off on 1002 and 1002 on a call, a second call to 1002 gets busy treatment
   (voicemail or busy). With call waiting on, it is offered as a second call.
7. A ring group of 1001, 1002 and 1003 rings according to each strategy:
   - simultaneous rings all members together;
   - sequential rings them in order, each for the group's ring timeout;
   - random rings each member once, one at a time.

   A member on DND is never rung. When nobody answers, the failover destination is reached.
8. A fax sent from an external fax service to a DID routed to fax is received. It is listed under
   `/faxes`, and its email carries a PDF that opens and matches the pages sent.

**Container part.** Run `tests/ring-group-policy.py` and `lua tests/ivr-choice.lua` on the release
candidate. They cover the DND, busy and sequential-timing rules of condition 7, and the `#` digit
of condition 3, against handsets that never answer. They do not replace the host part.

**Host part.**

1. Leave a message for 1002 by calling it from 1001 and not answering. Retrieve it with `*97` on
   1002, then with `*98` from 1001. Open the email and check the attachment and the
   `Authentication-Results` header.
2. Create an IVR with options 1, 2 and `#`, plus a timeout destination, and give it an internal
   number. From 1001, try each option, then wait out the timeout.
3. Run the DND, forward and call-waiting cases in condition order. After each cancel code, place
   one plain call to confirm normal ringing.
4. Create the ring group and run each strategy from an outside caller. Leave every member
   unanswered for one run of each strategy, so that failover is reached. Set 1003 to DND for one
   run.
5. Send a 2-page fax from an external fax service. Compare the received PDF with the original.

Record a pass or fail for each condition. Note which member answered or rang, with the
`fs_cli -x 'show channels'` output for the ring-group runs.

**Does not prove:** media quality under loss (gate 1), or carrier-originated forwarding (gate 3).

---

## Gate 3: carrier paths and identity

**Pass when all of these hold:**

1. An inbound call from the PSTN to the test DID rings the mapped extension, with two-way audio.
2. An outbound call from 1001 to a PSTN number reaches it with the expected digits after
   strip/prepend. The callee sees the configured caller ID: the route override, else the
   extension's, else the tenant default.
3. The carrier's trusted-peer address cannot place a call to an external number directly: the
   call is refused and never reaches the carrier.
4. An inbound DID pointed at an external number forwards through the outbound route, with the
   tenant default caller ID.
5. An inbound DID to 1002, with 1002 forwarding (`*72<external>`), reaches the external number.
   The leg uses 1002's caller ID.
6. A registration-mode trunk cannot be enabled: the portal and API refuse it.

**Container part (fake carrier).** On the release candidate, run `tests/outbound-callerid.py` and
`tests/forwarding.py` in a disposable full-install container. Both must exit 0. They cover
conditions 2 and 5 at the signalling level in both XML tiers, condition 3, the forwarding loop
limit, and the forward that is refused while the API is down (D5).

**Host part (the test carrier, D3).**

1. Configure the carrier trunk (IP authentication) and the DID as the README describes. Add an
   outbound route with the strip/prepend rules the carrier needs.
2. Call the DID from a mobile phone, answer on the mapped extension and speak both ways.
3. Call your mobile from 1001. On the mobile, check the caller ID shown. Use the carrier's
   portal or CDR to confirm the dialled digits.
4. For condition 3, place a call from the carrier side to an external number on the DID's trunk,
   if the carrier allows it. Otherwise send a crafted INVITE from the carrier's signalling address,
   as `forwarding.py` does. Confirm in the Kamailio log that it was refused, and in the carrier
   CDR that no outbound leg appeared.
5. Run conditions 4 and 5 from the mobile. On the second mobile, check the caller ID each
   forwarded leg presents.
6. Try to enable a registration-mode trunk in the portal.

**Does not prove:** STIR/SHAKEN attestation (D4, YYZ-33), or alternate-carrier retry, which is
not built (I08).

---

## Gate 4: emergency behavior

**Blocked until D2** names the jurisdiction, the emergency provider and its **approved test
destination**. Never dial live emergency services for these tests. Use only the destination the
provider documents for testing (for example, a 933 address-readback service where the provider
supports it). YYZ-24, YYZ-25 and YYZ-105 add conditions 4 to 6, which are not yet built.

**Pass when all of these hold:**

1. With the caller's extension at its concurrent-call limit, a call to the approved test
   destination is accepted at Kamailio ingress and reaches the provider. An ordinary call from
   the same extension at the same moment is refused.
2. With the tenant's emergency route disabled, the same test call gets no exemption: it is refused
   at the limit like any other.
3. A tenant cannot mark an arbitrary pattern as an emergency route. Only the platform-approved
   patterns are accepted (I31, YYZ-105).
4. The call presents the callback number configured for the caller's location (YYZ-24).
5. The provider's readback (or record) shows the dispatchable location assigned to the caller's
   extension (YYZ-24).
6. The tenant's notification address receives an email within one minute of the call (YYZ-25).

**Container part.** Run `tests/emergency-ingress.py` on the release candidate. It covers
conditions 1 and 2 against a fake carrier.

**Host part.**

1. Set the test extension's capacity to 1. Hold one call on it.
2. From the same extension, dial an ordinary external number (it must be refused), then the
   approved test destination.
3. Disable the emergency flag on the route and repeat step 2. Re-enable it.
4. Record the provider's readback, the presented callback number and the notification email time.

**Does not prove:** regulatory compliance. Deployment obligations need the separate jurisdiction
and provider review that D2 names.

---

## Gate 5: restore

The full procedure is the [restore runbook](restore.md). This section fixes what counts as a pass.

**Pass when all of these hold:**

1. A snapshot taken by `qwixbox-backup` on the release-candidate host restores onto a **fresh
   amd64 host** with `./restore.sh`. Exit status 0, and `/health` reports `"status":"ok"` with no
   pending projections.
2. An extension created before the backup registers on the new host with its **old** SIP password,
   and a call to it rings and carries two-way audio.
3. The portal account from before the backup signs in on the new host.
4. A snapshot whose `config.env` holds a different `ENCRYPTION_KEY` is refused at the key check,
   with no data restored.
5. A forced backup failure (a failed dump, or a failed offsite copy) keeps the previous complete
   snapshot, and `qwixbox-healthcheck` raises `backup run`.

**Earlier container evidence.** Conditions 4 and 5, and the signalling part of condition 2, were
run in arm64 containers on 2026-10-26 (YYZ-36, YYZ-38, YYZ-39); see [status](status.md). That
evidence does not count for the release candidate. Repeat them on the hosts.

**Host part.**

1. On the release-candidate host, create a probe extension and record its number and password in
   a root-only file, as `tests/restore-check.py` expects. Take a backup:
   `systemctl start qwixbox-backup`.
2. Copy the snapshot to a second, fresh amd64 host with the same release checked out. Run
   `./restore.sh <snapshot>`.
3. On the new host, run `python3 tests/restore-check.py /root/restore-probe.json`. It must exit 0:
   it registers with the old password and requires a ring. Then point a softphone at the new host
   with the probe credentials, register and call it to hear audio. Sign in to the portal with the
   pre-backup account.
4. Run the wrong-key and failed-backup cases on the second host, not on the release candidate.

**Does not prove:** voicemail, recordings or fax files, which the backup does not hold.

---

## Gate 7: consistent published state

**Pass when all of these hold on amd64:**

1. `tests/gate7-convergence.py` exits 0 in an amd64 full-install container on the release
   candidate. That container is a disposable VM, or a container on an amd64 host, so that systemd
   works.
2. On the release-candidate host, a disabled extension stops registering within 60 seconds, and
   its call profile disappears from Redis.
3. On the same host, with Redis restarted (which empties it), a call between 1001 and 1002
   connects within one warm-watchdog interval (60 s) of the restart. `redis-cli exists
   qwixbox:warm` returns 1 again.
4. On the same host, with the API stopped, calls between existing extensions still connect from
   the Redis tier. A change saved before the stop is live after the restart.
5. R08 is closed by its own ticket (YYZ-18, blocked on D6). Until then, record capacity
   enforcement as not tested rather than passed.

**Host part.**

1. Disable 1003 in the portal, then watch `kamctl ul show` and try to register 1003 again.
2. Restart Redis, then call 1001 → 1002 until it connects, noting the time.
3. Stop `qwixbox-api`, call 1001 → 1002, then start it again.

**Does not prove:** behavior under load. These are convergence checks, not capacity tests.
