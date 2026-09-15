#!/bin/bash
# ============================================
# QaliSuite — Ubuntu Server Setup
# Run as root on a fresh Ubuntu 24.04 VPS
# Usage: ssh root@<IP> 'bash -s' < deploy/setup-server.sh
# ============================================
#
# Installs PostgreSQL 16, Node 22, PM2 and Caddy; creates the deploy user;
# hardens SSH and the firewall.
#
# It does NOT create the database roles — that needs a password you choose, and
# getting it wrong disables tenant isolation. See DEPLOYMENT.md Step 2, which
# this script points you at when it finishes.

set -euo pipefail

echo "==> Updating system..."
apt update && apt upgrade -y

echo "==> Installing PostgreSQL 16 (from the PGDG repository)..."
# NOT `apt install postgresql-16` against the distro repos. Ubuntu 24.04 carries
# 16, but 22.04 carries 14 and the command fails with "Unable to locate package".
# 15 is the FLOOR: migration 0062 uses NULLS NOT DISTINCT, which does not exist
# before it — an older server installs fine and dies 62 migrations in.
# PGDG carries 16 for every supported release, so this does not depend on which.
# PostgreSQL's own installer script works out the release codename itself.
# Doing it by hand needs lsb_release, which a minimal server image does not
# have — and when it is missing the codename expands to nothing, the repo line
# becomes ".../apt -pgdg main", and apt reports "Unable to locate package
# postgresql-16" exactly as if the repository had never been added.
apt install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt install -y postgresql-16
systemctl enable --now postgresql

echo "==> Verifying the server meets the floor..."
sudo -u postgres psql -tAc "SHOW server_version;" | sed 's/^/    version: /'
sudo -u postgres psql -tAc \
  "SELECT count(*) FROM pg_available_extensions WHERE name IN ('btree_gist','ltree');" \
  | grep -q '^2$' \
  && echo "    btree_gist and ltree: available" \
  || echo "    WARNING: btree_gist/ltree missing — install postgresql-contrib-16"

echo "==> Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

echo "==> Installing PM2 globally..."
npm i -g pm2

echo "==> Installing Caddy (reverse proxy + auto SSL)..."
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy

echo "==> Creating deploy user..."
id deploy &>/dev/null || adduser deploy --disabled-password --gecos ""
mkdir -p /home/deploy/.ssh
# Where the invoking key actually lives depends on how this was reached. Run as
# `ssh root@host` it is root's; run via `sudo` from an ordinary account it is
# that account's, and root's may not exist at all — on such a box copying from
# /root gives an EMPTY authorized_keys and locks the deploy user out silently.
KEY_SRC=""
for candidate in \
  "/root/.ssh/authorized_keys" \
  "$(getent passwd "${SUDO_USER:-}" 2>/dev/null | cut -d: -f6)/.ssh/authorized_keys"
do
  if [ -s "$candidate" ]; then KEY_SRC="$candidate"; break; fi
done

if [ -n "$KEY_SRC" ]; then
  echo "    copying authorized_keys from $KEY_SRC"
  cp "$KEY_SRC" /home/deploy/.ssh/authorized_keys
else
  echo "    WARNING: no non-empty authorized_keys found — add a key for deploy"
  echo "             yourself before hardening SSH, or you will be locked out."
fi
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
[ -f /home/deploy/.ssh/authorized_keys ] && chmod 600 /home/deploy/.ssh/authorized_keys

echo "==> Installing unattended-upgrades and fail2ban..."
apt install -y unattended-upgrades fail2ban
systemctl enable --now fail2ban

echo "==> Setting up firewall (UFW)..."
# PostgreSQL (5432) is deliberately NOT opened. It listens on localhost; the
# app connects over the loopback interface. Reach it remotely with an SSH
# tunnel, never by opening the port.
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

echo "==> Creating app directory..."
mkdir -p /opt/qalisuite
chown deploy:deploy /opt/qalisuite

echo "==> Setting up PM2 startup for deploy user..."
env PATH="$PATH:/usr/bin" pm2 startup systemd -u deploy --hp /home/deploy

# ── SSH hardening, last, and only once a deploy key is in place ─────────────
#
# Deliberately at the end and guarded: disabling password auth before the
# deploy user has a working key locks everybody out of the box.
if [ -s /home/deploy/.ssh/authorized_keys ]; then
  echo "==> Hardening SSH (key-only, no direct root password login)..."
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/'  /etc/ssh/sshd_config
  systemctl restart ssh
  echo "    Done. VERIFY 'ssh deploy@<IP>' in another terminal before logging out."
else
  echo "==> SKIPPING SSH hardening: /home/deploy/.ssh/authorized_keys is empty."
  echo "    Add a key, then re-run the two sed lines in DEPLOYMENT.md Step 1."
fi

echo ""
echo "============================================"
echo "  Server setup complete."
echo ""
echo "  NEXT, AND DO NOT SKIP IT:"
echo "    DEPLOYMENT.md Step 2 — create the database and the app_user role."
echo "    The app must connect as a NON-SUPERUSER or row-level security is"
echo "    bypassed and tenants can read each other's data."
echo "============================================"
