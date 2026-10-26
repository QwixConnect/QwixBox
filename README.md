# QwixBox

An open-source, multi-tenant VoIP PBX that installs onto a bare Debian 13 server with one
command. Same job as FreePBX, FusionPBX and FSPBX — extensions, trunks, IVRs, ring groups,
voicemail, call detail records — built on a different set of choices.

**What is different**

- **Two engines, not one.** Kamailio owns the public SIP ports and does registration, digest
  auth and flood control; FreeSWITCH sits behind it on loopback and never faces the internet.
  Most alternatives expose a single engine that does both jobs. Splitting them is why an
  unauthenticated scanner reaching port 5060 cannot reach the media core at all.
- **Multi-tenant by construction, not by convention.** A tenant is an organization, and the API
  refuses to run a query that is not scoped to one — an unscoped query is a data breach, so it
  is an error rather than a default.
- **A modern stack.** TypeScript on Bun for the API, React for the portal, PostgreSQL and Redis
  for state. FreePBX and FusionPBX are PHP; this is not a criticism of them, it is the reason
  the two codebases feel different to extend.
- **API-first.** The portal is a client of the same REST API you get. There is no admin action
  that only exists as a form.
- **The installer is part of the product.** 28 idempotent steps, a setup wizard, and a
  re-run that is quiet instead of destructive. Not a tarball and a wiki page.

**Stack:** Kamailio (SIP edge) → FreeSWITCH (media/PBX core) → rtpengine (media relay),
PostgreSQL, Redis, nginx, Postfix/OpenDKIM, and a Bun/Hono API with a React portal.

## Status

Reviewed 2026-10-26. The install, registration and signalling rows below summarize historical
acceptance records; they do not certify a fresh install of the current revision. Current checks,
open findings and cleanup history are tracked in [docs/](docs/README.md).

| | |
|---|---|
| **Installs and configures** | Historical Debian arm64 install passed; current installer safety regressions pass. Full current-stack install remains owed |
| **Registration** | Historical softphone registration; current real Kamailio fixture verifies valid/wrong/empty digest credentials |
| **Call setup** | Historical signalling evidence for extension, inbound DID and outbound-to-carrier paths; current carrier/media acceptance remains owed |
| **Two-way audio** | **Not yet confirmed.** rtpengine is wired and answers on its control socket; no call has been listened to end to end |
| **Portal** | Live core CRUD; tests/build pass. Missing-feature previews show "Not available on this server"; see [issues](docs/issues.md#telephony-and-portal-gaps) |
| **Voicemail, fax, IVR DTMF** | Written and deployed; each needs the media path before it can be called done |

Not ready to carry a paying customer's calls yet — [docs/mvp.md](docs/mvp.md) is the list of what
stands between here and there, and [docs/roadmap.md](docs/roadmap.md) marks all 27 product areas
against the code rather than against intent.

## What it does

**Telephony** — extensions with encrypted SIP credentials, IP-authenticated SIP trunks (enabled registration trunks are rejected),
inbound DID routing, outbound routing with regex patterns and digit manipulation, ring groups
(simultaneous or sequential, with failover), IVR menus, time conditions for business hours and
holidays, and per-user call handling: DND, call forwarding (all / busy / no answer), call waiting
and ring timeout.

**Feature codes** — `*97`/`*98` voicemail, `*78`/`*79` DND, `*72`/`*73` forward-all,
`*90`/`*91` on busy, `*92`/`*93` on no answer. Matched before the directory so a tenant cannot
shadow one, and always attributed to the authenticated registration rather than the `From:`
header.

**Portal** — extensions, trunks, routing, call flows, call history with CSV export, faxes, users
and roles, an audit trail, and tenant settings. Four roles (`owner`, `admin`, `member`, `viewer`)
enforced server-side on every request, with the role re-read from the membership row rather than
trusted from the session.

**Platform** — multi-tenant with SIP-domain isolation, a fixed per-account edge call cap, TLS
throughout (SIP TLS, WSS, HTTPS) with automatic Let's Encrypt, nftables and fail2ban, a
responsive SIP firewall that tightens on sources that have never registered, DKIM-signed outbound
mail, scheduled backups, and Cloudflare DNS automation. Domain Connect discovery is implemented;
its provider approval flow has not been verified. Manual DNS configuration is supported.

**Deliberately absent** — no self-service registration (a portal account administers telephony,
so a compromise is toll fraud on someone else's bill) and no default credential (the installer
generates one and shows it once).

## Layout

```
bootstrap.sh            one-line installer - clones the repo and runs install.sh
install.sh              master installer - runs the steps in order
config.env.example      site configuration template
lib/common.sh           shared helpers (logging, idempotency, apt, files, services)
lib/tui.sh              whiptail wrappers and the input validators
lib/wizard.sh           the first-run configuration wizard
lib/detect.sh           host self-detection (public IP, FQDN, timezone, admin CIDR)
lib/dns.sh              picks a DNS tier and dispatches; the only entry point steps use
lib/dns-domainconnect.sh  Domain Connect - discovery and the browser approval flow
lib/dns-cloudflare.sh   Cloudflare API - zone lookup and record upsert
steps/                  the numbered step scripts
docs/                   current status, issues, change/deletion log, MVP, roadmap and designs
resources/              systemd unit template
resources/conf/         the config files the steps deploy, one directory per step
resources/lua/          FreeSWITCH call-time scripts (XML handler, ring groups, IVR, ...)
portal/api/             the Hono API source, plus the operator CLIs
portal/web/             the React admin portal
```

## Quick start

```bash
curl -fsSL https://get.qwixbox.com | sudo bash
```

Or clone it first, if you would rather read what you are about to run as root:

```bash
git clone https://github.com/QwixConnect/QwixBox.git
cd QwixBox
sudo ./install.sh
```

Either way the first run opens a setup wizard on a terminal, so there is nothing to edit by hand.
It asks four things — your domain, the hostname phones will register against, your company name,
and an email address — and shows everything else it detected before writing anything. When it
finishes you have a portal account and a password to sign in with; there is no default login.
`sudo ./install.sh --menu` gives the same wizard plus per-step re-runs, status and logs.

Without a terminal — CI, `nohup`, a provisioning script — nothing prompts. The first run writes
`/etc/qwixbox/config.env`, exits **78**, and tells you what to set; fill it in and run again.
That exit code means "waiting for configuration", not "failed".

### DNS

`PBX_FQDN` must resolve to this server's public IP before `13-tls-certs.sh` runs. Three ways to
get there, set by `DNS_PROVIDER`:

| | What happens | Stores a credential |
|---|---|---|
| `domainconnect` | Provider discovery and approval link; record creation remains unverified | no |
| `cloudflare` | The installer writes them with an API token | yes, in `config.env` |
| `none` | The installer prints the records for you to create | no |

The wizard discovers Domain Connect support, but discovery does not prove a provider has accepted
the template or that the approval flow creates records. Use the Cloudflare token path or create
the printed records manually until your provider flow has been verified.

### Getting a certificate without port 80

`ACME_CHALLENGE="http"` is the default and needs port 80 reachable from the internet. Set
`ACME_CHALLENGE="dns"` with a Cloudflare token to validate over DNS instead — the only option
behind a firewall that blocks 80, and the only one that can issue a wildcard. The token needs
**Zone:Read** and **DNS:Edit**, scoped to the one zone.

This needs `DNS_PROVIDER="cloudflare"` specifically. Domain Connect cannot do it: a certificate
renews every sixty days and that flow needs a person in a browser each time.

For a cloud instance, start at [Installing on a cloud server](#installing-on-a-cloud-server)
instead — the provider firewall has to be opened first or the install completes and no phone
can reach it.

## Installing on a cloud server

The same procedure works on Google Cloud, AWS and Vultr. Only two things differ between them:
how you create the instance, and where the inbound firewall lives.

### 1. What the server needs

| | |
|---|---|
| OS | Debian 13 (trixie) is the validation target. Preflight accepts Ubuntu; current Ubuntu behavior is unverified. |
| vCPU | 2 minimum. The FreeSWITCH build is the heavy part; call capacity needs far less. |
| RAM | 4 GB recommended, 2 GB is the floor (`00-preflight.sh` warns below ~1.8 GB). |
| Disk | 20 GB. The build plus sound files needs about 10 GB, and the rest is logs, recordings and voicemail. |
| Architecture | x86_64 or arm64. Historical FreeSWITCH builds covered both; a full current-stack amd64 acceptance pass is still owed. |

The sizes above are starting estimates, not measured call-capacity guarantees. Benchmark your
intended workload; build time varies by host, architecture and dependency downloads.

### 2. Open the ports in the provider firewall

**Do this before running the installer.** Every provider blocks inbound traffic by default
(Vultr is the exception — see below), and the installer's own nftables rules cannot open a port
the provider is already dropping.

| Port | Protocol | Source | What it is for |
|---|---|---|---|
| 22 | TCP | **your IP only** | SSH |
| 80 | TCP | 0.0.0.0/0 | Let's Encrypt HTTP-01 validation |
| 443 | TCP | 0.0.0.0/0 | Admin portal and API |
| 5060 | UDP **and** TCP | 0.0.0.0/0 | SIP signalling |
| 5061 | TCP | 0.0.0.0/0 | SIP over TLS |
| 8443 | TCP | 0.0.0.0/0 | SIP over secure WebSocket, for browser clients. Skip if `ENABLE_WEBRTC=0`. |
| 16384–32768 | UDP | 0.0.0.0/0 | RTP media, relayed by rtpengine |

Notes that matter:

- **The RTP range is genuinely that wide.** Media is relayed on both legs of every call
  (endpoint↔FreeSWITCH and FreeSWITCH↔carrier), so budget roughly 4 ports per concurrent call.
  Narrow it by setting `RTP_PORT_MIN`/`RTP_PORT_MAX` in the config *and* matching the provider
  rule to it — they must agree, or calls connect with no audio.
- **5060 needs both UDP and TCP.** Most SIP traffic is UDP; some endpoints and most carriers
  use TCP. Opening only one is a common cause of "some phones register and others do not".
- **Do not open 5070 or 5080.** Those are the internal Kamailio-egress and FreeSWITCH ports.
  They bind to loopback and must stay unreachable.
- Restrict 22 to your own address. `ADMIN_ALLOW_CIDR` in the config does the same thing at the
  host firewall; setting both is the point.

Port 5060 exposed to the internet is scanned within minutes. That is expected and handled —
nftables rate-limits SIP, fail2ban jails repeat offenders, and `14-responsive-firewall.sh`
tightens limits for sources that have never registered.

### 3a. Google Cloud Compute Engine

```bash
# Create the instance. Check the current image family first if this errors:
#   gcloud compute images list --project debian-cloud --filter="family~debian"
gcloud compute instances create qwixbox \
  --machine-type=e2-standard-2 \
  --image-family=debian-13 --image-project=debian-cloud \
  --boot-disk-size=20GB --boot-disk-type=pd-balanced \
  --tags=qwixbox \
  --zone=us-east1-b

# Reserve the address so it survives a stop/start, then note it for DNS.
gcloud compute addresses create qwixbox-ip --region=us-east1
gcloud compute instances describe qwixbox --zone=us-east1-b \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

Firewall rules apply to the `qwixbox` network tag:

```bash
gcloud compute firewall-rules create qwixbox-web \
  --allow=tcp:80,tcp:443 --target-tags=qwixbox --direction=INGRESS

gcloud compute firewall-rules create qwixbox-sip \
  --allow=udp:5060,tcp:5060,tcp:5061,tcp:8443 --target-tags=qwixbox --direction=INGRESS

gcloud compute firewall-rules create qwixbox-rtp \
  --allow=udp:16384-32768 --target-tags=qwixbox --direction=INGRESS

# SSH from your address only. Replace with your own /32.
gcloud compute firewall-rules create qwixbox-ssh \
  --allow=tcp:22 --source-ranges=203.0.113.10/32 --target-tags=qwixbox --direction=INGRESS
```

GCP gives the instance a private address on the NIC and maps the public IP with a 1:1 NAT.
That is handled — the installer detects it and configures Kamailio and rtpengine to advertise
the public address — but it is why `ip addr` on the server shows a 10.x address and nothing is
wrong.

### 3b. AWS EC2

```bash
# Find the current Debian 13 AMI for your region rather than hardcoding one.
aws ec2 describe-images --owners 136693071363 \
  --filters 'Name=name,Values=debian-13-amd64-*' 'Name=state,Values=available' \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text
```

```bash
# Security group
SG=$(aws ec2 create-security-group --group-name qwixbox \
      --description "qwixbox VoIP PBX" --query GroupId --output text)

aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22   --cidr 203.0.113.10/32
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 80   --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 443  --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol udp --port 5060 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 5060 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 5061 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 8443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol udp --port 16384-32768 --cidr 0.0.0.0/0

# Instance. t3.large is 2 vCPU / 8GB; t3.medium (2/4) also works.
aws ec2 run-instances --image-id <ami-from-above> --instance-type t3.large \
  --security-group-ids "$SG" --key-name <your-key> \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=20,VolumeType=gp3}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=qwixbox}]'
```

Then allocate an Elastic IP and associate it, so the address survives a stop/start:

```bash
EIP=$(aws ec2 allocate-address --query AllocationId --output text)
aws ec2 associate-address --instance-id <instance-id> --allocation-id "$EIP"
```

The default Debian user is `admin`, not `ubuntu` or `root`. Like GCP, EC2 uses 1:1 NAT — the
instance sees a private address and the installer handles the translation.

### 3c. Vultr Cloud Compute

Create the instance from the control panel or `vultr-cli`: Debian 13, at least 2 vCPU / 4 GB,
50 GB disk (Vultr's smaller plans include more disk than you need, which is fine).

Vultr differs from the other two in one important way: **the public IPv4 is assigned directly
to the instance's interface, and no cloud firewall is applied by default.** The server is
exposed to the internet from the moment it boots, so:

- Attach a Vultr Firewall Group with the ports from the table above, *or*
- Rely on the installer's nftables rules — but then run `11-firewall.sh` early, and set
  `ADMIN_ALLOW_CIDR` to your own address before you start.

Either way, do not leave the box reachable on every port while a 20-minute build runs.

Because there is no NAT, the installer will detect that the interface address and the public
address match and configure Kamailio and rtpengine without any translation. That is the
simpler case and needs nothing from you.

### 4. Point DNS at it

Create an **A record** for the name you will use as `PBX_FQDN`, pointing at the instance's
public IP, and wait for it to resolve:

```bash
dig +short pbx.example.com
```

This has to be right *before* the install reaches `13-tls-certs.sh`. Let's Encrypt validates
over HTTP against that name, and a certificate is needed for SIP TLS, WSS and the portal.

If the name is not ready yet, set `LETSENCRYPT_STAGING=1` in the config while testing so a
failed attempt does not burn the production rate limit.

### 5. Install

```bash
ssh admin@pbx.example.com          # 'admin' on AWS, your own user on GCP, 'root' on Vultr

sudo apt update && sudo apt install -y git
git clone https://github.com/QwixConnect/QwixBox.git
cd QwixBox

# First run creates /etc/qwixbox/config.env from the template and stops.
sudo ./install.sh

sudo editor /etc/qwixbox/config.env
```

That first run ends with `>> Waiting for configuration.` and exit code 78. **That is the
expected first run, not a failure** — the installer has nothing to work with until you fill in
the file. A real failure looks different: it prints `XX Failed during: <step>` and points at
the log.

At minimum set:

```bash
PBX_FQDN="pbx.example.com"          # must already resolve to this server
PBX_SIP_DOMAIN="pbx.example.com"    # what endpoints put after the @
LETSENCRYPT_EMAIL="you@example.com"
ADMIN_ALLOW_CIDR="203.0.113.10/32"  # your address(es), IPv4 and/or IPv6, not 0.0.0.0/0
TIMEZONE="America/Toronto"
```

Worth setting now rather than later:

```bash
SMTP_HOST="smtp.provider.example"   # voicemail-to-email and fax-to-email need a relay
SMTP_USER="..."
SMTP_PASSWORD="..."
SMTP_PORT="587"                     # 465 needs SMTP_STARTTLS="off" (implicit TLS)
SMTP_FROM="pbx@yourdomain.com"      # a domain you control, with SPF and DKIM; example.com is refused
MAX_CONCURRENT_CALLS=10             # configured value; dynamic tenant-limit enforcement is pending
```

Then run it:

```bash
sudo ./install.sh
```

It runs unattended from here — roughly 20–40 minutes, most of it compiling FreeSWITCH. Output
is logged to `/var/log/qwixbox/`. If it stops, fix what it reports and run the same
command again; completed steps are skipped.

Leave `SMTP_HOST` empty if you have no relay yet. Local voicemail/fax handling remains available,
but email delivery then depends on direct outbound port 25. Add it later with:

```bash
sudo ./install.sh --configure          # or edit /etc/qwixbox/config.env
sudo ./install.sh --only 15-mail.sh --force
```

**Set `SMTP_HOST` to a relay unless you know outbound port 25 works.** Postfix delivers straight
to recipient MX servers when it is empty, and GCP blocks port 25 egress permanently — AWS and
Vultr block it until you ask them not to. With a relay, mail leaves over 587 and is still signed
locally by OpenDKIM.

`15-mail.sh` prints the DKIM, DMARC and SPF records to publish, or creates them for you when
`the selected DNS provider supports publication. Verify the records: mail signed with a key that is not in DNS fails
verification exactly as if it were forged. Note that when you relay, the SPF record has to name
**your relay provider's** servers — their `include:` — not this host.

### 6. Check it came up

```bash
sudo qwixbox-healthcheck
sudo ./install.sh --only 99-postflight.sh
```

`99-postflight.sh` exits non-zero if anything is unsound and prints what. Then confirm from
*outside* the server that the provider firewall is actually open:

```bash
# From your laptop, not the server.
nc -zv pbx.example.com 5060       # TCP SIP
nmap -sU -p 5060 pbx.example.com  # UDP SIP
curl -I https://pbx.example.com   # portal
```

A port that works on the server but not from outside is the provider firewall, not the
installer.

### 7. Create an account and a tenant

If step 44 created your account, use the generated first-login credentials described under
[Portal access](#portal-access). The commands below are the fallback when `ADMIN_EMAIL` is empty.

**There is no self-service registration.** A portal account administers telephony, and a
compromise means toll fraud billed to a tenant, so accounts are created by the installer or an operator —
the signup endpoint returns 404 and the API refuses it. Both commands run from the *deployed*
API directory, which has the environment file and dependencies; the git checkout does not.

**First**, create the account. The password is generated and printed once:

```bash
cd /opt/qwixbox-api
sudo -u qwixbox bun run src/cli/create-user.ts \
  --email you@example.com \
  --name "Your Name"
```

Pass `--password` to choose your own (minimum 12 characters).

**Then** give that account a tenant. A tenant owns a SIP domain, which is the isolation
boundary, so this is deliberately a separate step:

```bash
sudo -u qwixbox bun run src/cli/provision-tenant.ts \
  --name "Acme Corp" \
  --slug acme \
  --domain pbx.example.com \
  --owner you@example.com
```

`--domain` is the SIP domain endpoints register against. It is unique platform-wide, and for a
single-tenant deployment it is normally the same as `PBX_SIP_DOMAIN`.

An account with no tenant can sign in but sees only a panel telling you to run the command
above — it is not broken, just unfinished.

**Now** open `https://pbx.example.com`, sign in, create an extension in the portal, and register
a softphone with:

| | |
|---|---|
| Server / domain | your `PBX_SIP_DOMAIN` |
| Username | the extension number |
| Password | the SIP password shown **once** at creation |
| Transport | TLS on 5061 preferred; UDP on 5060 works |

Confirm the registration reached Kamailio:

```bash
kamctl ul show
```

### 8. Roles, and adding more people

A tenant is an organization, and each account holds one role in it. The role decides what the
API will do for them — it is enforced server-side on every route, not just hidden in the UI:

| Role | Can |
|---|---|
| `viewer` | Read-only, and no recordings or audit log. For a support desk that must diagnose without being able to change routing. |
| `member` | Day-to-day work: extensions and call flows, plus recordings. Reads trunks and routes but cannot change them or set carrier credentials. |
| `admin` | Everything: trunks and carrier credentials, CDR export, deleting recordings, the audit log. |
| `owner` | Same rights as `admin`. Created by `provision-tenant.ts`; a tenant has exactly one. |

`member` is deliberately the useful-but-safe role — carrier credentials and billing exports are
the two things a customer most often wants withheld from a general admin.

No role can read a stored trunk password back. It is encrypted at rest and stripped from every
API response; `admin` can only replace it.

Create the additional account on the server, then attach it through the portal Users page
or the membership CLI:

```bash
cd /opt/qwixbox-api
sudo -u qwixbox bun run src/cli/create-user.ts --email ops@example.com --name "Ops"
sudo -u qwixbox bun run src/cli/add-tenant-user.ts --email ops@example.com --tenant acme --role admin
```

Invitations are unavailable. Existing accounts are added directly; owner changes are serialized
so concurrent requests cannot remove the last owner.

### Cloud gotchas worth knowing

- **The public IP must be static.** A GCP ephemeral address or an EC2 instance without an
  Elastic IP changes on stop/start, which breaks DNS, the TLS certificate and every registered
  phone at once. Reserve the address.
- **Do not put a load balancer in front of SIP.** Cloud L4 balancers rewrite source addresses
  and do not understand SIP; registrations and in-dialog routing break in ways that look like
  random call failures. Kamailio is the load balancer in this design.
- **Symmetric NAT on the provider side is not a thing you can configure around.** All three
  providers do plain 1:1 NAT or none at all, which is why this works. Providers that do
  carrier-grade NAT are not usable for a SIP edge.
- **Egress matters as much as ingress.** If you tighten outbound rules, the server still needs
  to reach your carrier on 5060/5061 and the RTP range, plus 80/443 for packages and
  Let's Encrypt.
- **Check the SIP ports are not already claimed.** Some provider images ship with their own
  agents; `ss -lnup | grep 5060` before installing costs nothing.

## Usage

```bash
sudo ./install.sh                            # run everything still pending
sudo ./install.sh --list                     # show the plan and each step's state
sudo ./install.sh --only 30-freeswitch.sh    # run one step
sudo ./install.sh --from 40-bun.sh           # resume from a step
sudo ./install.sh --force                    # re-run everything
sudo ./install.sh --dry-run                  # show what would run
```

Re-running is safe. Each step records the SHA-256 of the script that satisfied it, so a
completed step is skipped **until that script changes** — edit a step and it re-runs by
itself. All output is logged to `/var/log/qwixbox/`.

## Architecture

```text
                internet
                    |
            nftables (default deny)
                    |
    +---------------+----------------+
    |               |                |
 Kamailio        nginx           SSH (admin CIDR only)
 :5060/:5061     :443 (portal + API)
 :8443 (WSS)
    |               |
    |          Bun API :3000 (loopback)
    |               |
 rtpengine   PostgreSQL / Redis (loopback)
 RTP relay + WebRTC bridge
    |
 FreeSWITCH :5080 (loopback)
```

Kamailio owns the public SIP ports and handles registration, authentication and flood
protection. FreeSWITCH never faces the internet — it listens on loopback and trusts only what
Kamailio forwards. rtpengine relays media, which is what makes calls work for clients on WiFi
and mobile behind NAT.

## Steps

| Step | Purpose |
|------|---------|
| `00-preflight` | Host validation, hostname, timezone, NTP, kernel/limit tuning |
| `01-base-packages` | Tooling, CA certificates, unattended security upgrades |
| `02-dns` | A record for `PBX_FQDN` via the DNS provider (optional) |
| `10-ssh-hardening` | Key-only SSH; preserves root key access and leaves password authentication enabled when no keys exist |
| `11-firewall` | nftables default-deny with SIP rate limiting |
| `12-fail2ban` | Jails for sshd, FreeSWITCH and Kamailio |
| `13-tls-certs` | Let's Encrypt plus renewal hooks shared by all services |
| `14-responsive-firewall` | Reputation-tiered SIP limits, learned from registrations |
| `15-mail` | Postfix (loopback-only) + OpenDKIM signing, and the SPF/DKIM/DMARC records |
| `20-postgresql` | PostgreSQL from PGDG, tuned to host memory |
| `21-redis` | Redis for mod_hiredis and API caching |
| `22-provision-databases` | Roles and databases, least privilege |
| `30-freeswitch` | FreeSWITCH from source |
| `31-freeswitch-config` | SIP profile, ACLs, ESL on loopback, Opus preference, call-time Lua |
| `32-kamailio` | Kamailio from deb.kamailio.org |
| `33-stir-shaken` | STIR/SHAKEN caller attestation (source build, off by default) |
| `34-kamailio-config` | Schema, TLS, registrar, routing, WebRTC/WSS |
| `35-rtpengine` | Media relay, WebRTC bridging, kernel forwarding |
| `40-bun` | Bun runtime |
| `41-api-deploy` | API deploy, migrations, hardened systemd unit |
| `42-nginx` | TLS termination and reverse proxy |
| `43-portal-web` | Build the React admin portal and publish it |
| `44-admin-account` | First account and tenant when ADMIN_EMAIL is configured |
| `50-logrotate` | Log retention |
| `51-backups` | Nightly database and config backups |
| `52-monitoring` | Health checks and node_exporter |
| `53-cron` | Scheduled maintenance |
| `99-postflight` | Verify the result; non-zero exit if unsound |

## After installing

`99-postflight.sh` lists what remains. In short:

- If the installer did not create your account, use `create-user.ts`, then `provision-tenant.ts` — see
  [step 7](#7-create-an-account-and-a-tenant). There is no self-service signup: the endpoint
  returns 404 and the API refuses it
- Give anyone else the narrowest role that works — a `viewer` cannot change anything, and a
  `member` cannot touch trunks or carrier credentials. See
  [step 8](#8-roles-and-adding-more-people)
- Create extensions **in the portal**, not with `kamctl add`. The API writes Kamailio's
  `subscriber` table itself, as an HA1 digest; a subscriber added by hand registers fine but is
  invisible to the portal and gets no dialplan, voicemail or CDR
- Add a trunk and outbound routes so calls can leave. Strip/prepend number translation is supported;
  least-cost routing and billing are absent
- Narrow `ADMIN_ALLOW_CIDR` if it is still `0.0.0.0/0`
- Set `OFFSITE_RSYNC_TARGET` so backups leave the host
- Place a test call and confirm two-way audio in both directions

## Portal access

### Signing in the first time

If you set a company name and an email in the wizard, the install created your account and its
tenant for you — `44-admin-account.sh`. **The password is generated during the install and shown
once**, at the end of that step, and it is deliberately kept out of `/var/log/qwixbox/`. If it has
scrolled away:

```bash
sudo cat /etc/qwixbox/first-login     # url, email, password — 0600
```

Delete that file once you are in. Then browse to `https://<PBX_FQDN>/`.

There is **no default credential**. The password above exists only on this machine and only for
this install.

If you skipped it — no `ADMIN_EMAIL` in the config, or a split-role install — create the account
by hand. Both commands are needed: the account is who you are, the tenant is what you can reach,
and an account with no tenant signs in to an empty console.

```bash
cd /opt/qwixbox-api

sudo -u qwixbox bun run src/cli/create-user.ts \
  --email you@yourdomain.com --name "Your Name"

sudo -u qwixbox bun run src/cli/provision-tenant.ts \
  --name "Acme Corp" --slug acme \
  --domain <PBX_SIP_DOMAIN> --owner you@yourdomain.com
```

Run them from `/opt/qwixbox-api`, not the git checkout — the checkout has neither `.env` nor
dependencies. To add more people later, use the Users page in the portal, or
`add-tenant-user.ts --email ... --tenant acme --role admin|member|viewer`.

### How the gate works

The console is behind a session gate at nginx, so only the login page exists until you sign in.
`/extensions`, `/trunks`, `/routing`, `/call-flows`, `/calls`, `/faxes`, `/users`, `/audit`,
`/settings` and the rest return **404** to anyone not signed in, and
`/api/*` returns 401. A signed-in user refreshing on a deep link still gets the app.

This changes what a broken install looks like: if the *whole* site 404s **including after you
sign in**, the session probe is failing, not your account. Check the API first, then reapply the
nginx config:

```bash
curl -s http://127.0.0.1:3000/health          # on the server
sudo systemctl status qwixbox-api
sudo ./install.sh --only 42-nginx.sh --force  # the way back
```

The JavaScript bundle under `/assets/` stays public — the login page is served from it. So the
route names are readable by anyone; the gate stops the console being *usable* or indexable, it
does not make the feature list secret.

Sessions last 8 hours. **Forgot your password?** is on the login page and emails a link that
expires in an hour and works once. It needs a working MTA, which `15-mail.sh` installs — without
one the request still answers "check your email" (deliberately, so the reply cannot be used to
discover which addresses exist) and the API log records that the send failed.

## Feature codes

Dialled from a registered handset. The codes are fixed by convention rather than configurable —
users learn `*72` once and expect it to mean the same thing everywhere, and making them tenant
data would let one shadow `*97` or an emergency number.

| Code | Does |
|---|---|
| `*97` | Your own voicemail, no PIN — the registration is already authenticated |
| `*98` | Any mailbox, prompting for the number and PIN. For checking from someone else's desk |
| `*78` / `*79` | Do not disturb on / off |
| `*72<number>` / `*73` | Forward all calls to `<number>` / cancel |
| `*90<number>` / `*91` | Forward on busy / cancel |
| `*92<number>` / `*93` | Forward on no answer / cancel |

Each of these changes the *calling* extension's own settings. The subject is taken from the
authenticated identity Kamailio stamps on the call, not the `From:` header — otherwise editing
one field in a softphone would let anyone forward someone else's phone or read their voicemail.

## Operations

```bash
sudo qwixbox-healthcheck             # services, API/outbox, SIP auth, certificate, disk; alerts on change
sudo qwixbox-backup                  # run a backup now
fs_cli                            # FreeSWITCH console
kamctl ul show                    # current registrations
journalctl -u kamailio -f
```

## Secrets

Generated on first run and stored in `/etc/qwixbox/config.env` (mode 0600). They are never
rotated by a re-run — that would break every service already holding the old value. Back this
file up: without it the database passwords are unrecoverable.

## Requirements

- Debian 13 (trixie) with systemd; Ubuntu is accepted by preflight but lacks current validation
- Root/sudo access and internet access
- A DNS record for `PBX_FQDN` pointing at the server
- 2 vCPU, 4 GB RAM and 20 GB disk recommended; the installer warns below ~1.8 GB RAM or 15 GB
  free, which is roughly what the FreeSWITCH build plus sound files needs
- On a cloud provider, the inbound ports opened in the provider firewall — see
  [Installing on a cloud server](#installing-on-a-cloud-server)

## Notes

- Membership of the `freeswitch` group only applies to new login sessions — log out and back
  in after installing.
- Video is disabled (`--disable-libvpx`); this is a voice-only switch.
- WebRTC is on by default (`ENABLE_WEBRTC=1`, WSS on 8443). rtpengine bridges DTLS-SRTP to
  plain RTP, so FreeSWITCH needs no WebRTC support of its own and mod_verto stays disabled.
- STIR/SHAKEN is off by default. It is a source build (neither libstirshaken nor Kamailio's
  stirshaken module is packaged for Debian) and needs a certificate from an STI-CA.
- Sound files are installed at 8kHz and 48kHz only. See `FS_SOUND_RATES`.

## Local portal development

For UI development without a PBX, run `bun run dev:mock` from `portal/web` and open
http://127.0.0.1:5174/. It starts signed in with synthetic, editable in-memory data and provides
role/empty/error/slow controls. See [portal/web/README.md](portal/web/README.md) for details.

## Upgrading and verifying review fixes

See [project status](docs/status.md), [active issues](docs/issues.md) and
[the change log](docs/changelog.md) for implementation status, verification and deletions. Run the installer from the updated checkout so changed source/template hashes redeploy
the affected steps. Reapplying step 34 loads the corrected HA1 authentication settings; reapplying
step 31 moves runtime gateway credentials into a root-only environment file. Existing secrets are
preserved. Retest both successful and refused SIP authentication before returning the PBX to service.

DIDs are exact numbers, globally owned by one route (including disabled routes). Preserve the carrier's
leading `+` format. Step 41 refuses duplicate ownership before adding the unique index; resolve conflicts
with the owning tenants first. Outbound patterns use PCRE; legacy patterns require explicit operator
review with `src/cli/check-route-patterns.ts`. Enabled registration trunks are unavailable; use IP trunks.

Backup success requires the encryption configuration in the archive. Keep `config.env` with database
dumps, retain the corresponding key, and test a restore. Failed snapshots or offsite copies do not
prune previous local backups. To restore a snapshot onto a new host or in place, run
`sudo ./restore.sh /var/backups/qwixbox/<stamp>` from a checkout of the same release: see
[docs/restore.md](docs/restore.md). Voicemail, recordings and fax files are not in the backup. Each
upgrade also keeps a pre-upgrade dump and can be rolled back: see [docs/rollback.md](docs/rollback.md).
Regression-test instructions are in `tests/README.md`.

The site publishes an immutable installer ref. Commit the tested runtime changes before
`npm run deploy` in `site`; its predeploy check refuses a dirty installer/runtime tree. Local
`npm run build` remains available for preview. `QWIXBOX_INSTALL_REF` can select a full reviewed
commit SHA; `QWIXBOX_REF` overrides it when explicitly running the bootstrap source template.
