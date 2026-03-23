#!/bin/bash
# ============================================
# QaliSuite — Hetzner Server Setup
# Run as root on a fresh Ubuntu 24.04 VPS
# Usage: ssh root@<IP> 'bash -s' < setup-server.sh
# ============================================

set -euo pipefail

echo "==> Updating system..."
apt update && apt upgrade -y

echo "==> Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

echo "==> Installing PM2 globally..."
npm i -g pm2

echo "==> Installing Caddy (reverse proxy + auto SSL)..."
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy

echo "==> Creating deploy user..."
id deploy &>/dev/null || adduser deploy --disabled-password --gecos ""
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

echo "==> Setting up firewall (UFW)..."
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

echo "==> Creating app directory..."
mkdir -p /opt/qalisuite
chown deploy:deploy /opt/qalisuite

echo "==> Setting up PM2 startup for deploy user..."
env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy

echo ""
echo "============================================"
echo "  Server setup complete!"
echo "  Next: ssh deploy@<IP> and deploy the app"
echo "============================================"
