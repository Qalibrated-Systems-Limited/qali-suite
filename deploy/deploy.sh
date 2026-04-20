#!/bin/bash
# ============================================
# QaliSuite — Deploy / Redeploy
# Run as deploy user on the VPS
# Usage: ssh deploy@<IP> 'bash /opt/qalisuite/deploy.sh'
# ============================================

set -euo pipefail

APP_DIR="/opt/qalisuite"
REPO="git@github.com:YOUR_USERNAME/YOUR_REPO.git"  # <-- UPDATE THIS (SSH URL from GitHub)
BRANCH="main"

cd "$APP_DIR"

# First time: clone. After that: pull.
if [ ! -d "$APP_DIR/.git" ]; then
  echo "==> Cloning repository..."
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
else
  echo "==> Pulling latest changes..."
  git fetch origin
  git reset --hard "origin/$BRANCH"
fi

echo "==> Installing dependencies..."
npm ci --production=false

echo "==> Building Next.js..."
npm run build

echo "==> Starting/restarting with PM2..."
pm2 describe qalisuite > /dev/null 2>&1 && pm2 restart qalisuite || pm2 start npm --name "qalisuite" -- start -- -p 3000
pm2 save

echo ""
echo "============================================"
echo "  Deploy complete! App running on port 3000"
echo "============================================"
