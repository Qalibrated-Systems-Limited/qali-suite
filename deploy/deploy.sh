#!/bin/bash
# ============================================
# QaliSuite — Deploy / Redeploy
# Run as deploy user on the VPS
# Usage: ssh deploy@<IP> 'bash /opt/qalisuite/deploy/deploy.sh'
# ============================================
#
# ORDER MATTERS, and it is the reason this script exists rather than a few
# commands typed by hand:
#
#   back up -> fetch -> deps -> MIGRATE -> build -> reload -> verify
#
# The migration runs BEFORE the build and the reload, so the new code never
# meets an old schema. Migrations are expand-only (add a column, add a table),
# which is what makes that safe while the previous version is still serving.
#
# There are no down-migrations. If a migration is the problem, restore the dump
# this script takes at step 1 — which is why step 1 is the dump.

set -euo pipefail

APP_DIR="/opt/qalisuite"

# Defaults to the branch already checked out, NOT to `main`.
#
# It used to default to main, and `git reset --hard origin/main` two lines below
# does not ask. On a server deployed from feat/postgres-migration, running this
# with no argument would have silently replaced the whole application with the
# Mongo-era one — and the deploy would have reported success.
BRANCH="${1:-$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)}"
HEALTH_URL="http://localhost:3000/api/health"

cd "$APP_DIR"

# ── 1. Back up before touching anything ─────────────────────────────────────
if command -v /usr/local/bin/qalisuite-backup >/dev/null 2>&1; then
  echo "==> Backing up the database..."
  sudo -u postgres /usr/local/bin/qalisuite-backup
else
  echo "==> WARNING: /usr/local/bin/qalisuite-backup not found — deploying"
  echo "    WITHOUT a fresh backup. See DEPLOYMENT.md Step 7."
fi

# ── 2. Code ─────────────────────────────────────────────────────────────────
PREVIOUS_SHA=$(git rev-parse HEAD)
echo "==> Current revision: $PREVIOUS_SHA"
echo "==> Deploying branch: $BRANCH"

echo "==> Fetching origin/$BRANCH..."
git fetch origin
git reset --hard "origin/$BRANCH"
echo "==> Now at: $(git rev-parse HEAD)"

# ── 3. Dependencies ─────────────────────────────────────────────────────────
echo "==> Installing dependencies (npm ci)..."
npm ci

# ── 3b. Repair the platform-native bindings npm left out ────────────────────
#
# package-lock.json is generated on a macOS arm64 machine, and npm records only
# the optional platform packages it resolved there (npm/cli#4828). `npm ci`
# installs exactly the lock, so on linux-x64 the native bindings the BUILD needs
# are simply absent and `next build` dies with:
#
#   Cannot find module '../lightningcss.linux-x64-gnu.node'
#
# which reads as a corrupt install rather than a missing optional dependency.
#
# Versions are read from what npm ci actually installed, so a dependency bump
# cannot silently reintroduce a mismatch. --no-save leaves the lockfile alone,
# so the deploy stays reproducible.
#
# The root fix is a platform-complete lockfile. Regenerating it moves other
# things and is a deliberate dependency pass, not a deploy-time change.
echo "==> Repairing platform-native bindings (npm/cli#4828)..."
ARCH_TRIPLE="linux-x64-gnu"
npm install --no-save --no-audit --no-fund \
  "lightningcss-${ARCH_TRIPLE}@$(node -p "require('lightningcss/package.json').version")" \
  "@tailwindcss/oxide-${ARCH_TRIPLE}@$(node -p "require('@tailwindcss/oxide/package.json').version")" \
  "@next/swc-${ARCH_TRIPLE}@$(node -p "require('next/package.json').version")" \
  || echo "    WARNING: binding repair failed — the build may fail next."

# ── 4. Schema, before the app that expects it ───────────────────────────────
echo "==> Applying database migrations..."
npm run db:migrate

# ── 5. Build while the old process keeps serving ────────────────────────────
echo "==> Building..."
npm run build

# ── 6. Reload, not restart ──────────────────────────────────────────────────
# `reload` replaces workers without dropping the listening socket, so in-flight
# requests finish. `restart` kills first and drops them.
echo "==> Reloading PM2..."
if pm2 describe qalisuite >/dev/null 2>&1; then
  pm2 reload qalisuite --update-env
else
  pm2 start npm --name qalisuite -- start -- -p 3000
fi
pm2 save

# ── 7. Verify, and say so loudly if it did not come back ────────────────────
echo "==> Waiting for health check..."
for i in $(seq 1 30); do
  if curl -fsS -m 5 "$HEALTH_URL" >/dev/null 2>&1; then
    echo ""
    echo "============================================"
    echo "  Deploy complete — $(curl -fsS "$HEALTH_URL")"
    echo "============================================"
    exit 0
  fi
  sleep 2
done

echo ""
echo "============================================"
echo "  DEPLOY UNHEALTHY — $HEALTH_URL did not come up."
echo ""
echo "  Logs:     pm2 logs qalisuite --lines 100"
echo "  Roll back code:"
echo "    cd $APP_DIR && git reset --hard $PREVIOUS_SHA \\"
echo "      && npm ci && npm run build && pm2 reload qalisuite"
echo ""
echo "  NOTE: that rolls back CODE only. Migrations do not roll back;"
echo "        if the schema is the problem, restore the dump from step 1."
echo "============================================"
exit 1
