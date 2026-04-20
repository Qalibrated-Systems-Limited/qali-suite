# QaliSuite Deployment Guide

Standard production deployment on any Ubuntu VPS (Hetzner, DigitalOcean, AWS EC2, etc).

**Stack:** Node.js 22 + PM2 (process manager) + Caddy (reverse proxy + auto SSL)

---

## Prerequisites

- Ubuntu 24.04 VPS (minimum 2 vCPU, 4GB RAM)
- A domain name with DNS A record pointing to your server IP
- MongoDB Atlas connection string (or self-hosted MongoDB)
- SSH root access to the server

---

## Step 1 — Server Setup (run once)

SSH into the server as root and run:

```bash
ssh root@YOUR_SERVER_IP
```

### Install Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v  # should print v22.x
```

### Install PM2

```bash
npm i -g pm2
```

### Install Caddy (reverse proxy + auto SSL)

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

### Create a deploy user (don't run the app as root)

```bash
adduser deploy --disabled-password --gecos ""

# Copy your SSH key so you can SSH in as deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
```

After this, you can SSH in as `deploy`:

```bash
ssh deploy@YOUR_SERVER_IP
```

### Set up Git access for deploy user (for private repos)

SSH in as `deploy` and generate an SSH key:

```bash
ssh deploy@YOUR_SERVER_IP
ssh-keygen -t ed25519 -C "deploy@qalisuite" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copy the output and add it as a **Deploy Key** on your GitHub repo:
`Repo > Settings > Deploy Keys > Add deploy key` (read-only is fine).

Test the connection:

```bash
ssh -T git@github.com
```

Then use the SSH URL in your clone/deploy commands:

```bash
git clone git@github.com:YOUR_USERNAME/YOUR_REPO.git /opt/qalisuite
```

### Firewall

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

### Create app directory

```bash
mkdir -p /opt/qalisuite
chown deploy:deploy /opt/qalisuite
```

### PM2 auto-start on reboot

```bash
env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
```

Or run the provided script in one go:

```bash
ssh root@YOUR_SERVER_IP 'bash -s' < deploy/setup-server.sh
```

---

## Step 2 — Configure Caddy (SSL + reverse proxy)

As root, create the Caddyfile:

```bash
cat > /etc/caddy/Caddyfile << 'EOF'
yourdomain.com {
    reverse_proxy localhost:3000

    encode gzip zstd

    header {
        X-Frame-Options DENY
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
    }
}
EOF

systemctl reload caddy
```

Caddy automatically provisions a Let's Encrypt SSL certificate. Make sure your DNS A record is already pointing to the server IP before this step.

Or use the provided script:

```bash
ssh root@YOUR_SERVER_IP 'bash -s' < deploy/setup-caddy.sh yourdomain.com
```

---

## Step 3 — Environment Variables

SSH in as the deploy user and create the `.env` file:

```bash
ssh deploy@YOUR_SERVER_IP
nano /opt/qalisuite/.env
```

Required variables (see `deploy/env.example` for the full template):

```env
# Auth
AUTH_SECRET=<generate with: openssl rand -base64 32>
JWT_KEY=<generate with: openssl rand -base64 32>

# Database
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/qalisuite

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Resend (email invites)
RESEND_API_KEY=
FROM_EMAIL=QaliSuite <noreply@yourdomain.com>

# Cloudinary (file uploads)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# App URL (must match your domain)
APP_URL=https://yourdomain.com
NEXTAUTH_URL=https://yourdomain.com
```

---

## Step 4 — Deploy the App

SSH in as the deploy user:

```bash
ssh deploy@YOUR_SERVER_IP
cd /opt/qalisuite
```

### First deploy (clone)

```bash
git clone --branch main git@github.com:YOUR_USERNAME/YOUR_REPO.git .
npm ci --production=false
npm run build
pm2 start npm --name "qalisuite" -- start -- -p 3000
pm2 save
```

### Subsequent deploys (update)

```bash
cd /opt/qalisuite
git fetch origin && git reset --hard origin/main
npm ci --production=false
npm run build
pm2 restart qalisuite
```

Or use the provided script:

```bash
ssh deploy@YOUR_SERVER_IP 'bash /opt/qalisuite/deploy.sh'
```

---

## Step 5 — Cron Jobs

Set up cron jobs for scheduled tasks (replaces Vercel cron):

```bash
ssh deploy@YOUR_SERVER_IP
crontab -e
```

Add:

```cron
# Mark absent — weekdays at 3:00 PM UTC
0 15 * * 1-5 curl -s https://yourdomain.com/api/cron/mark-absent > /dev/null 2>&1
```

Or use the provided script:

```bash
ssh deploy@YOUR_SERVER_IP 'bash /opt/qalisuite/deploy/setup-cron.sh yourdomain.com'
```

---

## Common Operations

### View logs

```bash
pm2 logs qalisuite          # live logs
pm2 logs qalisuite --lines 100  # last 100 lines
```

### Check status

```bash
pm2 status
```

### Restart

```bash
pm2 restart qalisuite
```

### Stop

```bash
pm2 stop qalisuite
```

### Monitor resources (CPU/RAM)

```bash
pm2 monit
```

### View Caddy logs

```bash
journalctl -u caddy -f
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| App won't start | Check `pm2 logs qalisuite` for errors. Usually a missing env var. |
| SSL not working | Ensure DNS A record points to server IP. Check `journalctl -u caddy -f`. |
| Port 3000 already in use | `pm2 kill` then `pm2 start npm --name "qalisuite" -- start -- -p 3000` |
| Build fails (OOM) | Add swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` |
| MongoDB connection timeout | Check `MONGODB_URI` and that the Atlas IP whitelist includes your server IP. |
| Permission denied | Make sure you're running as `deploy` user, not `root`. |

---

## Quick Reference

```
Server setup:    ssh root@IP 'bash -s' < deploy/setup-server.sh
Caddy config:    ssh root@IP 'bash -s' < deploy/setup-caddy.sh yourdomain.com
Deploy/update:   ssh deploy@IP 'bash /opt/qalisuite/deploy.sh'
Cron setup:      ssh deploy@IP 'bash /opt/qalisuite/deploy/setup-cron.sh yourdomain.com'
Logs:            ssh deploy@IP 'pm2 logs qalisuite --lines 50'
Status:          ssh deploy@IP 'pm2 status'
Restart:         ssh deploy@IP 'pm2 restart qalisuite'
```
