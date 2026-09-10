# QaliSuite Deployment Guide

Production deployment on an Ubuntu VPS (Hetzner, DigitalOcean, AWS EC2, Contabo…).

**Stack:** Ubuntu 24.04 · PostgreSQL 16 · Node.js 22 · PM2 · Caddy (reverse proxy + auto SSL)

> **The datastore is PostgreSQL.** As of migration `0102` there is no MongoDB
> anywhere in the application — no driver, no models, no connection. If you are
> following an older copy of this guide, the `MONGODB_URI` steps are gone and
> the app will refuse to start without `DATABASE_URL`.

---

## Contents

1. [Prerequisites](#prerequisites)
2. [Step 1 — Server setup](#step-1--server-setup-run-once)
3. [Step 2 — PostgreSQL](#step-2--postgresql-the-important-one)
4. [Step 3 — Caddy (SSL)](#step-3--caddy-ssl--reverse-proxy)
5. [Step 4 — Environment](#step-4--environment-variables)
6. [Step 5 — Deploy](#step-5--deploy-the-app)
7. [Step 6 — Cron jobs](#step-6--cron-jobs)
8. [Step 7 — Backups](#step-7--backups-and-restore)
9. [Updating (zero-downtime)](#updating-the-app)
10. [Operations](#common-operations)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Ubuntu 24.04 LTS** (22.04 works; **20.04 does not** — see below), minimum
  2 vCPU / 4 GB RAM (the Next build needs ~2 GB; see the swap note in
  [Troubleshooting](#troubleshooting) for 2 GB boxes)

  > **Ubuntu 20.04 (focal) cannot run this.** PostgreSQL's own apt repository
  > carries `jammy`, `noble`, `bookworm` and `trixie` — it **dropped focal**, so
  > there is no `postgresql-16` for it from any official source, and focal's own
  > PostgreSQL is 12, three major versions under our floor of 15. 20.04 also
  > left standard support in May 2025 and is ESM-only, which is the wrong base
  > for a multi-tenant financial system. Reprovision as 24.04 rather than
  > working around it; Node and Caddy install fine on focal, so the box looks
  > healthy right up until `apt install postgresql-16` fails.
- A domain with a DNS **A record** pointing at the server IP, propagated
  *before* you configure Caddy — Let's Encrypt validates over HTTP
- SSH root access
- Outbound HTTPS (Resend/Cloudinary/Google OAuth)

---

## Step 1 — Server setup (run once)

```bash
ssh root@YOUR_SERVER_IP
```

### System, then Node 22

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # v22.x
```

### PM2 and Caddy

```bash
npm i -g pm2

apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

### A non-root deploy user

The app must never run as root. Nothing below this line is done as root except
the PostgreSQL role setup and the Caddyfile.

```bash
adduser deploy --disabled-password --gecos ""
mkdir -p /home/deploy/.ssh

# Copy the key you are ALREADY logging in with. Which file that is depends on
# how you reached this prompt:
#   - ssh root@server        -> /root/.ssh/authorized_keys
#   - ssh you@server + sudo  -> /home/YOUR_USER/.ssh/authorized_keys
# On a provider image that disables direct root login, root often has no
# authorized_keys at all, and copying from it gives you an EMPTY file — which
# locks you out of the deploy account without saying so.
SRC=$(ls /root/.ssh/authorized_keys 2>/dev/null || echo "$HOME/.ssh/authorized_keys")
[ -s "$SRC" ] || SRC=$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)/.ssh/authorized_keys
echo "copying from: $SRC"
test -s "$SRC" || { echo "No authorized_keys found — find it before continuing"; }

cp "$SRC" /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
```

**Confirm `ssh deploy@YOUR_SERVER_IP` works from a second terminal before
closing this session** — and certainly before the SSH hardening below, which
disables password login.

> **You may not need a separate `deploy` user.** Its only job is that the app
> does not run as root. If you already log in as an ordinary sudo-capable user,
> that user can own `/opt/qalisuite` and run PM2 instead — substitute it
> throughout. Keeping them separate is still slightly better, because the
> account running the app then has no sudo at all.

### Harden SSH

Password logins and direct root SSH are the two ways these boxes get taken.

```bash
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/'  /etc/ssh/sshd_config
systemctl restart ssh
```

**Confirm `ssh deploy@IP` works in a second terminal before closing this one.**

### Automatic security updates and fail2ban

```bash
apt install -y unattended-upgrades fail2ban
dpkg-reconfigure -plow unattended-upgrades   # answer Yes
systemctl enable --now fail2ban
```

### Firewall

Only SSH and HTTP(S). **PostgreSQL is deliberately absent** — it listens on
localhost and must not be reachable from the internet.

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
ufw status verbose
```

### App directory and PM2 boot

```bash
mkdir -p /opt/qalisuite
chown deploy:deploy /opt/qalisuite
env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
```

Or run the whole step:

```bash
ssh root@YOUR_SERVER_IP 'bash -s' < deploy/setup-server.sh
```

---

## Step 2 — PostgreSQL (the important one)

### Install

**PostgreSQL 15 is the minimum; 16 is what this is tested on.** Migration
`0062_categories.sql` uses `NULLS NOT DISTINCT`, which does not exist before 15
— so an older server installs happily and then fails 62 migrations in, with the
schema half-built.

Do NOT rely on `apt install postgresql`, which gives whatever the release
carries: 24.04 (noble) has 16, but 22.04 (jammy) has **14** and would fail.
`apt install postgresql-16` on jammy gives:

```
E: Unable to locate package postgresql-16
```

Add the PostgreSQL project's own repository instead. It carries 16 for every
supported Ubuntu release, so this step does not depend on which one you are on:

Use PostgreSQL's own installer script. It works out the release codename
itself, which is the part that goes wrong by hand:

```bash
apt install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt install -y postgresql-16
systemctl enable --now postgresql
```

<details>
<summary>Adding the repository by hand instead</summary>

Read the codename from `/etc/os-release`, **not** from `lsb_release` — that
command is not installed on a minimal server image, and when it is missing
`$(lsb_release -cs)` expands to nothing. The repo line silently becomes
`… /pub/repos/apt -pgdg main`, `apt update` reports no error worth noticing, and
`apt install postgresql-16` fails with the same "Unable to locate package" you
were trying to fix.

```bash
apt install -y curl ca-certificates
. /etc/os-release
install -d /usr/share/postgresql-common/pgdg
curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt update
apt install -y postgresql-16
systemctl enable --now postgresql
```

Check the repo line resolved to a real codename before moving on — it should
read `… /pub/repos/apt noble-pgdg main`, or `jammy-pgdg`, not `-pgdg`:

```bash
cat /etc/apt/sources.list.d/pgdg.list
apt-cache policy postgresql-16 | head -3
```

</details>

Check the version and that both extensions the schema needs are available —
`btree_gist` and `ltree` ship inside the `postgresql-16` package on Debian and
Ubuntu, but verify rather than assume:

```bash
sudo -u postgres psql -c "SHOW server_version;"
sudo -u postgres psql -c \
  "SELECT name, default_version FROM pg_available_extensions
    WHERE name IN ('btree_gist','ltree');"
```

Two rows, and a version of 15 or higher. If either extension is missing, install
`postgresql-contrib-16`.

### Alternative — PostgreSQL 16 in a container

If the host cannot install PostgreSQL 16 (Ubuntu 20.04 is the case that forces
this), run it in Docker instead. The container carries its own server, so the
host release stops mattering. **This does not fix the host being out of
support** — it unblocks the deployment while a supported box is arranged.

```bash
# Docker, from Docker's own repository — focal's docker.io is old but works too
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

cd /opt/qalisuite/deploy/docker
cp .env.example .env
chmod 600 .env
nano .env                        # two passwords — see below

docker compose -f docker-compose.postgres.yml up -d
docker compose -f docker-compose.postgres.yml logs -f postgres   # ctrl-c when ready
```

`.env` needs **two** passwords — the superuser and the application role, which
are the two roles described below. Generate each separately:

```bash
openssl rand -hex 24   # -> POSTGRES_SUPERUSER_PASSWORD
openssl rand -hex 24   # -> APP_DB_PASSWORD
```

> **Hex, not base64.** Both values end up inside a connection string —
> `postgresql://app_user:PASSWORD@127.0.0.1:5432/qalisuite` — and base64 emits
> `+`, `/` and `=`. A `/` or an `@` in the password breaks the URL, and the
> error you get says authentication failed, which sends you looking at the
> password rather than at the URL around it. Hex is the same entropy per
> character length with nothing that needs escaping.
>
> Do not reuse one password for both. It does not merge the roles, but it
> removes the reason they are separate: `app_user` is a non-superuser *so that
> RLS applies to it*, and anyone holding the app's password would also hold the
> superuser's, which bypasses every tenant policy.

The role setup from the section below is **already done** — `initdb/01-app-user.sh`
creates `app_user` on first start, grants it the schema, sets default privileges
so the ~139 tables migrations create are reachable, and then refuses to start if
that role can bypass RLS. Verify anyway:

```bash
docker exec qalisuite-pg psql -U postgres -d qalisuite -c \
  "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
    WHERE rolname IN ('app_user','postgres');"
docker exec qalisuite-pg psql -U postgres -c "SHOW server_version;"
```

`app_user` must read `f | f`.

Then in `/opt/qalisuite/.env`, point both URLs at the published port:

```env
DATABASE_URL=postgresql://app_user:APP_DB_PASSWORD@127.0.0.1:5432/qalisuite
DIRECT_DATABASE_URL=postgresql://postgres:POSTGRES_SUPERUSER_PASSWORD@127.0.0.1:5432/qalisuite
```

**The port is published on `127.0.0.1` deliberately.** `5432:5432` would expose
the database to every interface — and Docker writes its own DNAT rules *ahead*
of UFW, so `ufw deny 5432` would not stop it. UFW would report the port closed
while it was open to the internet. Loopback binding is what actually confines
it.

Backups change shape — `pg_dump` runs inside the container:

```bash
docker exec qalisuite-pg pg_dump -U postgres -Fc qalisuite \
  > /var/backups/qalisuite/qalisuite-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Substitute that line into `/usr/local/bin/qalisuite-backup` (Step 7) and drop
the `sudo -u postgres`. The data itself lives in the named volume
`qalisuite-pgdata`, which survives `docker compose down`; only `down -v`
destroys it.

Two things this arrangement does not give you, versus a host install: the
`ALTER SYSTEM` tuning in the next section is instead passed as `command:` flags
in the compose file, and `systemctl status postgresql` becomes
`docker compose ps` / `docker logs qalisuite-pg`.

### Create the database and **two** roles

> **Read this part even if you skim the rest.**
>
> The application relies on **row-level security** for tenant isolation. Every
> tenant table is `FORCE ROW LEVEL SECURITY` with a policy comparing
> `company_id` against `current_setting('app.company_id')`.
>
> **A superuser bypasses RLS entirely.** If the app connects as `postgres`, every
> policy is skipped and any tenant can read every other tenant's ledger — with
> no error and nothing in the logs. The app connecting as a *non-superuser* is
> not a preference; it is the isolation mechanism.
>
> This is not hypothetical: during the 0102 work a policy bug was invisible when
> tested as `postgres` (which has `rolbypassrls`) and reproduced instantly as
> `app_user`.

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE qalisuite;

-- The role the APPLICATION connects as. No SUPERUSER, no BYPASSRLS, no CREATEDB.
-- Generate the password with `openssl rand -hex 24` — HEX, because this value
-- goes straight into DATABASE_URL and base64's `+`, `/` and `=` break a URL.
CREATE ROLE app_user LOGIN PASSWORD 'CHANGE_ME_STRONG';

-- The role MIGRATIONS and privileged platform reads connect as. It owns the
-- schema; it is never used for ordinary request traffic.
ALTER DATABASE qalisuite OWNER TO postgres;
SQL

sudo -u postgres psql -d qalisuite <<'SQL'
GRANT USAGE ON SCHEMA public TO app_user;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO app_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Future tables created by migrations must be reachable too, or the next
-- migration silently leaves the app with "permission denied for table ...".
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES    TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO app_user;
SQL
```

Verify the app role really cannot bypass RLS:

```bash
sudo -u postgres psql -d qalisuite -c \
  "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('app_user','postgres');"
```

`app_user` **must** show `f | f`. If it shows `t` anywhere, stop and fix it —
tenant isolation is off.

### Keep it on localhost

```bash
sudo -u postgres psql -c "SHOW listen_addresses;"   # expect: localhost
```

If you ever need a remote connection, tunnel over SSH rather than opening 5432.

### Tuning for a 4 GB box

```bash
sudo -u postgres psql <<'SQL'
ALTER SYSTEM SET shared_buffers          = '1GB';
ALTER SYSTEM SET effective_cache_size    = '3GB';
ALTER SYSTEM SET work_mem                = '16MB';
ALTER SYSTEM SET maintenance_work_mem    = '256MB';
ALTER SYSTEM SET max_connections         = 100;
-- SSD: random reads are not 4x sequential.
ALTER SYSTEM SET random_page_cost        = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;
-- Keep WAL for point-in-time recovery and safer restarts.
ALTER SYSTEM SET wal_compression         = on;
-- Log the slow ones only; a query log of everything is its own outage.
ALTER SYSTEM SET log_min_duration_statement = '500ms';
SQL
systemctl restart postgresql
```

> **Do not set `synchronous_commit = off` in production.** The test suite does,
> because every test begins by deleting all its data. On a real deployment it
> trades committed transactions for speed.

---

## Step 3 — Caddy (SSL + reverse proxy)

```bash
cat > /etc/caddy/Caddyfile << 'EOF'
yourdomain.com {
    reverse_proxy localhost:3000

    encode gzip zstd

    header {
        X-Frame-Options              DENY
        X-Content-Type-Options       nosniff
        Referrer-Policy             strict-origin-when-cross-origin
        Strict-Transport-Security   "max-age=31536000; includeSubDomains"
        X-Permitted-Cross-Domain-Policies none
        -Server
    }

    # The health endpoint is for your monitoring, not for the public.
    @health path /api/health
    handle @health {
        reverse_proxy localhost:3000
    }

    log {
        output file /var/log/caddy/qalisuite.log {
            roll_size 50mb
            roll_keep 10
        }
    }
}
EOF

systemctl reload caddy
```

DNS must already resolve to this box or certificate issuance fails.

```bash
ssh root@YOUR_SERVER_IP 'bash -s' < deploy/setup-caddy.sh yourdomain.com
```

---

## Step 4 — Environment variables

```bash
ssh deploy@YOUR_SERVER_IP
nano /opt/qalisuite/.env
chmod 600 /opt/qalisuite/.env      # secrets: owner-read only
```

```env
# ── Auth ────────────────────────────────────────────────────────────────────
AUTH_SECRET=          # openssl rand -base64 32
JWT_KEY=              # openssl rand -base64 32

# ── Database ────────────────────────────────────────────────────────────────
# The APPLICATION connects as app_user — a non-superuser, so RLS applies.
DATABASE_URL=postgresql://app_user:STRONG_PASSWORD@localhost:5432/qalisuite

# Migrations, provisioning and the SuperAdmin platform dashboard. Owns the
# schema and is NOT used for ordinary request traffic.
DIRECT_DATABASE_URL=postgresql://postgres@localhost:5432/qalisuite

# Connection pool per Node process. Keep (PGPOOL_MAX × instances) well under
# Postgres max_connections.
PGPOOL_MAX=10

# ── Cron authentication ─────────────────────────────────────────────────────
# REQUIRED. Every /api/cron/* route returns 401 without a matching bearer token.
CRON_SECRET=          # openssl rand -hex 32

# ── Email ───────────────────────────────────────────────────────────────────
RESEND_API_KEY=
FROM_EMAIL=QaliSuite <noreply@yourdomain.com>

# ── OAuth ───────────────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ── Uploads ─────────────────────────────────────────────────────────────────
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# ── URLs (must match the certificate) ───────────────────────────────────────
APP_URL=https://yourdomain.com
NEXTAUTH_URL=https://yourdomain.com
AUTH_URL=https://yourdomain.com
```

**Never set `ALLOW_UNSCOPED_DB` on a running server.** It disables the guard that
blocks unscoped, RLS-bypassing database access in production. It exists for
one-off maintenance scripts. The app logs a warning at boot if it finds it.

`DATABASE_URL` and `AUTH_SECRET` are validated at boot — the process refuses to
start without them rather than failing on the first request.

---

## Step 5 — Deploy the app

### Give the server read access to the repository

The repository is private, so a bare `git clone` fails with
`Permission denied (publickey)`. Generate a key **as the deploy user** and
register it as a **deploy key** on the repository:

```bash
ssh deploy@YOUR_SERVER_IP
ssh-keygen -t ed25519 -C "deploy@$(hostname)" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copy that line into GitHub: **repo → Settings → Deploy keys → Add deploy key**.
Give it the server's name, and **leave "Allow write access" unchecked**.

> **A deploy key, not a personal access token.** A deploy key is scoped to one
> repository and is read-only, so a compromised server can clone this project
> and nothing else. A PAT in the clone URL is the alternative and is worse in
> three ways: it lands in `.git/config` in plaintext, it usually carries access
> to every repository the account can see, and it can push. If a token is
> already embedded in a remote URL anywhere, replace it with SSH and revoke it.

Then pre-accept GitHub's host key, so the first clone does not sit waiting on a
`yes/no` prompt — which is what hangs an otherwise-working scripted deploy:

```bash
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts
ssh -T git@github.com    # "Hi <repo>! You've successfully authenticated" — no shell access is expected
```

### Clone

```bash
cd /opt/qalisuite
git clone --branch BRANCH git@github.com:ORG/REPO.git .
npm ci
```

**Check which branch you mean.** `main` is the usual answer, but this work is
currently on `feat/postgres-migration` and `main` is behind it — deploying
`main` today would ship the Mongo-era application. Either merge to `main` first
or clone the branch explicitly; do not let the default carry the decision.

**And which remote.** `deploy/deploy.sh` pulls from whatever `origin` points at
on the server, so clone from the repository that is canonical for the team, not
whichever one you happen to use locally.

### Run migrations **before** starting the app

```bash
npm run db:migrate
```

This applies every file in `app/db/migrations` in order, through
`DIRECT_DATABASE_URL`. It is idempotent — already-applied migrations are
skipped — so it is safe to re-run.

On a brand-new database this creates the full schema including row-level
security policies. Confirm they landed:

```bash
sudo -u postgres psql -d qalisuite -c \
  "SELECT count(*) FILTER (WHERE relrowsecurity)     AS with_rls,
          count(*) FILTER (WHERE relforcerowsecurity) AS forced
     FROM pg_class c JOIN pg_tables t ON t.tablename = c.relname
    WHERE t.schemaname = 'public';"
```

On the current schema that is **137 of 139 tables, all of them forced**. The two
without RLS are `_migration_id_map` and `_migration_rejects` — migration
bookkeeping, not tenant data.

**Zero means RLS is not on and the deployment is not tenant-safe.** Stop and
find out why before letting anyone sign in.

### Build and start

```bash
npm run build
pm2 start npm --name qalisuite -- start -- -p 3000
pm2 save
```

### Verify

```bash
curl -fsS http://localhost:3000/api/health   # {"ok":true,"db":"up"}
curl -fsS https://yourdomain.com/api/health
```

`/api/health` returns **503** when Postgres does not answer, which is what your
load balancer and uptime monitor should watch.

---

## Step 6 — Cron jobs

Five scheduled routes exist, and **every one requires the bearer token**. A cron
line without the `Authorization` header gets a silent `401` — the job appears to
run and never does.

```bash
ssh deploy@YOUR_SERVER_IP
crontab -e
```

First a small runner, so the token is read in one place and never appears in
`crontab -l` or in the process list:

```bash
cat > /opt/qalisuite/run-cron.sh <<'EOF'
#!/bin/bash
# Usage: run-cron.sh <route-name> [curl-timeout-seconds]
set -euo pipefail
ROUTE="$1"; TIMEOUT="${2:-60}"

# DO NOT `source` the .env file. It is not a shell script — FROM_EMAIL contains
# `<noreply@...>`, which the shell reads as a redirect and dies on. Pull out the
# one value we need instead.
SECRET=$(sed -n 's/^CRON_SECRET=//p' /opt/qalisuite/.env | head -1 | tr -d "\"' ")
[ -n "$SECRET" ] || { echo "CRON_SECRET missing from .env" >&2; exit 1; }

BASE=$(sed -n 's/^APP_URL=//p' /opt/qalisuite/.env | head -1 | tr -d "\"' ")
BASE=${BASE:-http://localhost:3000}

curl -fsS -m "$TIMEOUT" -H "Authorization: Bearer $SECRET" "$BASE/api/cron/$ROUTE"
EOF

chmod 700 /opt/qalisuite/run-cron.sh
chown deploy:deploy /opt/qalisuite/run-cron.sh
```

Then the schedule. Output goes to a log rather than `/dev/null`, so a job that
starts failing is visible:

```cron
# Webhook retry — every minute. Failed outbound deliveries queue in sync_logs
# with next_retry_at set; this is what drains them.
* * * * * /opt/qalisuite/run-cron.sh webhook-retry 60 >> /var/log/qalisuite-cron.log 2>&1

# Stale approval reaper — every 10 min. Frees requests stuck in 'applying'
# because a process died between claiming and finalising.
*/10 * * * * /opt/qalisuite/run-cron.sh reap-approvals 60 >> /var/log/qalisuite-cron.log 2>&1

# Daily alert digests — 06:00 EAT (03:00 UTC). Overdue invoices and low stock.
0 3 * * * /opt/qalisuite/run-cron.sh notify-alerts 300 >> /var/log/qalisuite-cron.log 2>&1

# Mark absent — weekdays 15:00 UTC.
0 15 * * 1-5 /opt/qalisuite/run-cron.sh mark-absent 120 >> /var/log/qalisuite-cron.log 2>&1

# Notification pruning — Sundays 02:00 UTC.
0 2 * * 0 /opt/qalisuite/run-cron.sh prune-notifications 300 >> /var/log/qalisuite-cron.log 2>&1
```

Create the log with the right owner, and rotate it:

```bash
sudo touch /var/log/qalisuite-cron.log
sudo chown deploy:deploy /var/log/qalisuite-cron.log
sudo tee /etc/logrotate.d/qalisuite-cron >/dev/null <<'EOF'
/var/log/qalisuite-cron.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
}
EOF
```

Check one by hand before trusting the schedule:

```bash
/opt/qalisuite/run-cron.sh webhook-retry
# {"ok":true,...}                      — good
# curl: (22) ... 401                   — CRON_SECRET mismatch
```

---

## Step 7 — Backups and restore

A backup you have never restored is not a backup.

```bash
sudo -u postgres mkdir -p /var/backups/qalisuite
cat > /usr/local/bin/qalisuite-backup <<'EOF'
#!/bin/bash
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST=/var/backups/qalisuite
# -Fc is the custom format: compressed, and restorable table-by-table.
pg_dump -Fc qalisuite > "$DEST/qalisuite-$STAMP.dump"
# Keep 14 dailies.
find "$DEST" -name 'qalisuite-*.dump' -mtime +14 -delete
EOF
chmod +x /usr/local/bin/qalisuite-backup
```

As root, add to `/etc/cron.d/qalisuite-backup`:

```cron
0 1 * * * postgres /usr/local/bin/qalisuite-backup
```

**Copy the dumps off the box** — a backup on the same disk as the database
survives nothing that matters. `rclone`, `restic` or `aws s3 cp` to remote
storage, nightly.

### Restore drill (do this once, on a scratch database)

```bash
sudo -u postgres createdb qalisuite_restore_test
sudo -u postgres pg_restore -d qalisuite_restore_test /var/backups/qalisuite/qalisuite-XXXX.dump
sudo -u postgres psql -d qalisuite_restore_test -c "SELECT count(*) FROM companies;"
sudo -u postgres dropdb qalisuite_restore_test
```

---

## Updating the app

Order matters. Migrations first, then build, then restart — so the new code
never meets an old schema.

```bash
ssh deploy@YOUR_SERVER_IP
cd /opt/qalisuite

sudo -u postgres /usr/local/bin/qalisuite-backup   # 1. back up first
git fetch origin && git reset --hard origin/main   # 2. new code
npm ci                                             # 3. exact lockfile deps
npm run db:migrate                                 # 4. schema, before the app
npm run build                                      # 5. build (app still serving old code)
pm2 reload qalisuite                               # 6. reload, not restart
curl -fsS http://localhost:3000/api/health         # 7. verify
```

`pm2 reload` replaces the process without dropping the listening socket, so
in-flight requests finish. `pm2 restart` kills first and drops them.

All seven steps, including the health check and the rollback instructions it
prints on failure:

```bash
ssh deploy@YOUR_SERVER_IP 'bash /opt/qalisuite/deploy/deploy.sh main'
```

**Migrations are expand-only.** Adding a column or table is safe while the old
code runs. Dropping or renaming one is not — split it across two deploys (add
the new, deploy code that writes both, backfill, then drop) or accept a
maintenance window.

### Rollback

```bash
git reset --hard <previous-good-sha>
npm ci && npm run build && pm2 reload qalisuite
```

Code rolls back cleanly. **Migrations do not** — there are no down-migrations.
If a migration is the problem, restore the pre-deploy dump. This is why step 1
is the backup.

---

## Common operations

```bash
pm2 status                       # process state
pm2 logs qalisuite --lines 100   # app logs
pm2 monit                        # live CPU/RAM
pm2 reload qalisuite             # zero-downtime restart
journalctl -u caddy -f           # proxy/TLS logs
journalctl -u postgresql -f      # database logs

# Slowest queries (needs pg_stat_statements)
sudo -u postgres psql -d qalisuite -c \
  "SELECT calls, round(mean_exec_time::numeric,1) ms, left(query,80)
     FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# Connection pressure
sudo -u postgres psql -d qalisuite -c \
  "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"
```

### Log rotation

PM2 logs grow without bound by default:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 10
pm2 set pm2-logrotate:compress true
```

---

## Troubleshooting

| Problem | Cause / fix |
|---|---|
| `E: Unable to locate package postgresql-16` **after** adding PGDG | Check the OS. On **20.04 (focal)** PGDG has no repository at all — `apt.postgresql.org/pub/repos/apt/dists/` has no `focal-pgdg`. Reprovision as 24.04; there is no fix on focal short of Docker or managed Postgres. |
| `E: Unable to locate package postgresql-16` | The distro repo has no 16 — you are probably on 22.04 (`lsb_release -cs` prints `jammy`). Add the PGDG repository, Step 2. Do **not** fall back to `apt install postgresql`: 22.04 gives PG 14, and migration 0062 needs 15+. |
| Migrations fail around `0062_categories` with a syntax error near `NULLS` | The server is older than PostgreSQL 15. `SHOW server_version;` — the floor is 15, tested on 16. |
| `extension "btree_gist" is not available` | Install `postgresql-contrib-16`. |
| `Missing required environment variables: DATABASE_URL — refusing to start` | The boot check. Set `DATABASE_URL` in `/opt/qalisuite/.env`. |
| `DATABASE_URL is not set — see .env.example` at runtime | PM2 started without the env file loaded. Restart from `/opt/qalisuite` so `.env` is read, or set `--env`. |
| `/api/health` returns 503 | Postgres is down or unreachable. `systemctl status postgresql`, then `psql "$DATABASE_URL" -c 'select 1'`. |
| `permission denied for table …` | `app_user` is missing grants — usually a migration created a table before `ALTER DEFAULT PRIVILEGES` was set. Re-run the GRANT block in Step 2. |
| **A tenant can see another tenant's data** | `DATABASE_URL` is connecting as a superuser, which bypasses RLS. Check `rolbypassrls` (Step 2). This is the failure that guide section exists to prevent. |
| Cron jobs do nothing | Missing `Authorization: Bearer $CRON_SECRET`. Test by hand (Step 6) — a bare `curl` returns 401 and cron discards the output. |
| Webhooks never retry | The `webhook-retry` cron is not installed or is 401ing. Failed deliveries sit in `sync_logs` with `status='retrying'`. |
| Build fails, OOM-killed | Add swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab` |
| `remaining connection slots are reserved` | `PGPOOL_MAX` × PM2 instances exceeds `max_connections`. Lower `PGPOOL_MAX` or raise `max_connections`. |
| `Permission denied (publickey)` on clone | The deploy key is not registered, or was generated as the wrong user. It must be `~/.ssh/id_ed25519.pub` **of the deploy user**, added under the repo's Deploy keys. Test with `ssh -T git@github.com`. |
| Clone hangs with no output | GitHub's host key was never accepted. `ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts`. |
| Deployed, but the app looks like the old Mongo version | You cloned `main`. The Postgres work is on `feat/postgres-migration` until it is merged. |
| SSL not issued | DNS A record not resolving yet. `dig +short yourdomain.com`, then `journalctl -u caddy -f`. |
| Port 3000 in use | `pm2 delete qalisuite` then start again. |

---

## Notes on the other deployment paths in this repo

`Dockerfile` and `docker-compose.yaml` predate the Postgres migration and are
**not** currently usable:

- The `Dockerfile` copies `.next/standalone`, which is only produced when
  `next.config.js` sets `output: "standalone"`. It does not, so the build fails
  at that `COPY`.
- `docker-compose.yaml` passes `MONGODB_URI` and `DB_LOCAL_URI` and no
  `DATABASE_URL`, so the container could not reach the database.
- Its healthcheck probes `/` rather than `/api/health`.
- `deploy.sh` at the repository root has a corrupted line
  (`echo ""cd /opt/qalisuite`) and a stray `vim .env`.

Use the PM2 + Caddy path documented above. If you want the container path,
those four items need fixing first.

---

## Quick reference

```
Server setup:   ssh root@IP 'bash -s' < deploy/setup-server.sh
Caddy:          ssh root@IP 'bash -s' < deploy/setup-caddy.sh yourdomain.com
Migrate:        ssh deploy@IP 'cd /opt/qalisuite && npm run db:migrate'
Deploy/update:  see "Updating the app" — backup, migrate, build, reload
Health:         curl -fsS https://yourdomain.com/api/health
Logs:           ssh deploy@IP 'pm2 logs qalisuite --lines 50'
Backup now:     ssh root@IP '/usr/local/bin/qalisuite-backup'
```
