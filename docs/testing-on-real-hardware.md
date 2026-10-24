# Testing on real hardware

Two things cannot be tested in the container and are the remaining blockers in
[mvp.md](mvp.md): confirmed two-way remote audio and an x86_64 build. These are
the steps.

---

## 1. Register a softphone and make a real call

This is the single highest-value test left. Digest authentication is now covered by a real Kamailio/PostgreSQL regression, including
wrong/empty-password refusal for two tenants. These steps still need to prove actual audio
through rtpengine, NAT and the installed stack.

### Prepare the server

```bash
sudo ./install.sh                       # setup wizard; skip manual account creation if step 44 already created it
cd /opt/qwixbox-api
sudo -u qwixbox bun run src/cli/create-user.ts --email you@example.com --name "You"
sudo -u qwixbox bun run src/cli/provision-tenant.ts \
      --name "Test Co" --slug testco --domain pbx.example.com --owner you@example.com
```

Then create two extensions in the portal (or via the API) — say **1001** and **1002** — each with
a SIP password you choose. Confirm they reached Kamailio:

```bash
sudo -u postgres psql -d kamailio -c "SELECT username, domain FROM subscriber;"
```

Two rows, with the SIP domain. If they are missing the projection did not run; check
`journalctl -u qwixbox-api` for `kamailio-sync` warnings.

### Register

Any softphone (Linphone, Zoiper, Groundwire, a desk phone). Two devices, or one device and one
softphone on a laptop.

| Setting | Value |
|---|---|
| Username / auth user | `1001` |
| Password | what you set on the extension |
| Domain / registrar | `pbx.example.com` (your `PBX_SIP_DOMAIN`) |
| Transport | UDP or TLS on 5061; try UDP first |

**Confirm the registration landed:**

```bash
sudo kamctl ul show                     # should list 1001@pbx.example.com with a contact
sudo journalctl -u kamailio -f          # watch it happen
```

If it fails, the useful signal is in the Kamailio log. A `401` followed by nothing means the
phone never answered the challenge (wrong password). Repeated `401`s mean the HA1 does not match —
re-save the extension in the portal to re-project it.

### The calls that matter

Do these in order and **listen** each time. Audio is the thing being tested; the signalling is
already known to work.

1. **1001 → 1002.** Two-way audio. This is the whole stack: digest auth, `extension.lua`,
   the dial-string back through Kamailio, `lookup("location")`, rtpengine relaying RTP.
2. **1001 → 1002, let it ring out.** Should land in voicemail and you should *hear* the prompt.
   Leave a message; confirm the email arrives if SMTP is configured.
3. **Dial `*97`.** Your own mailbox, no PIN. You should hear the message count.
4. **Inbound DID**, once a carrier is pointed at you. Rings the mapped extension.
5. **Outbound to a real number.** Confirm the carrier sees the translated digits and there is
   two-way audio.
6. **`*72<number>` then call 1001.** It should follow the forward out to the carrier. `*73` cancels.
7. **Ring group and IVR**, if configured — the group rings all members; the IVR plays its greeting
   and responds to a DTMF keypress.

### If there is no audio

One-way or no audio is almost always NAT or the media relay, not signalling:

```bash
sudo rtpengine-ctl list totals          # are sessions being created at all?
sudo nft list ruleset | grep 16384      # is the RTP range actually open?
sudo tcpdump -ni any udp portrange 16384-32768 -c 20
```

Check the provider firewall too — the installer's nftables rules cannot open a port the cloud
provider is dropping. The RTP range must be open **and** match `RTP_PORT_MIN`/`RTP_PORT_MAX`.

If the server is behind 1:1 NAT (GCP, EC2), confirm Kamailio is advertising the public address:
`sudo kamctl srv sockets` should show the public IP as the advertised address, not the 10.x one.

---

## 2. The x86_64 build

Production is GCP C4 (x86_64); everything verified so far has been arm64. The concrete risk is
documented in `CLAUDE.md`: libvpx needs an external assembler on x86_64 and does not on arm64, so
a missing dependency is invisible until an amd64 build. The `mod_hiredis` patch, Postfix, OpenDKIM
and the Kamailio routing have never been compiled there.

The cheapest real test is a throwaway cloud instance, because an emulated amd64 container has
broken systemd and cannot verify the services:

```bash
gcloud compute instances create qwix-amd64-test \
  --machine-type=e2-standard-4 \
  --image-family=debian-13 --image-project=debian-cloud \
  --boot-disk-size=20GB --zone=us-east1-b

gcloud compute ssh qwix-amd64-test --zone=us-east1-b
```

On the instance:

```bash
git clone https://github.com/QwixConnect/QwixBox.git && cd QwixBox
sudo ./install.sh
```

What to check afterwards — each of these has caught a real bug before:

```bash
echo $?                                              # 0, or 1 only from postflight
ls /usr/local/freeswitch/bin/freeswitch               # exists
grep -c 'libs/libvpx' /var/log/qwixbox/install-*.log  # 0 - libvpx must never be entered
grep -i 'Patched mod_hiredis' /var/log/qwixbox/install-*.log
systemctl is-active freeswitch kamailio rtpengine-daemon nginx qwixbox-api postfix opendkim
fs_cli -x "show codec" | grep -i opus
sudo qwixbox-healthcheck
```

And the one that matters most on a fresh architecture — a clean FreeSWITCH boot:

```bash
sudo -u freeswitch grep -cE '\[(ERR|CRIT)\]' /usr/local/freeswitch/log/freeswitch.log
```

Then delete the instance. If it also has a public FQDN pointed at it, this is the natural place to
do the softphone test above with a real certificate instead of a self-signed one.

```bash
gcloud compute instances delete qwix-amd64-test --zone=us-east1-b
```

---

## After both pass

The backup restore (item 5 in [mvp.md](mvp.md)) is the next one, and it is worth doing on the
instance from step 2 before deleting it — a restore into the same architecture it was dumped from
is the case that actually matters. Note the ordering trap: `/etc/qwixbox/config.env` must be
restored *with* the database, or `ENCRYPTION_KEY` no longer matches and every stored SIP secret
and voicemail PIN is undecryptable.
