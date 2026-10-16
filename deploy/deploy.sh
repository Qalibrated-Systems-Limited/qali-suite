#!/bin/bash
# ============================================
# QaliSuite — Deploy / Redeploy
# Run as the deploy user on the VPS:
#   ssh deploy@<IP> 'bash /opt/qalisuite/deploy/deploy.sh'
#
#   --branch <name>   deploy a branch other than the one checked out
#   --remote <name>   fetch from a remote other than origin
#   --skip-migrate    deploy code only, leave the schema alone
#   --dry-run         say what would happen and change nothing
# ============================================
#
# ORDER MATTERS, and it is the reason this script exists rather than a few
# commands typed by hand:
#
#   plan -> back up -> fetch -> deps -> BUILD -> MIGRATE -> reload -> verify
#
# BUILD BEFORE MIGRATE. This used to migrate first, reasoning that "the new
# code never meets an old schema". The exposure is identical either way —
# between the migration and the reload the OLD code is serving against the NEW
# schema, which is safe because migrations here are expand-only — but a build
# that fails AFTER the schema has moved leaves a database ahead of the code
# with nothing running that understands it. Building first means a broken build
# costs three minutes and touches nothing.
#
# There are no down-migrations. If a migration is the problem, restore the dump
# this script takes at step 2 — which is why step 2 refuses to be skipped when
# there are migrations to apply.

set -euo pipefail

APP_DIR="/opt/qalisuite"
HEALTH_URL="http://localhost:3000/api/health"
# The site as the world sees it. Checked after the local one passes, because
# the two fail for different reasons: localhost says the app came back, and
# this says DNS, Caddy and the certificate are also doing their jobs. An app
# that is healthy on :3000 and unreachable on the domain is still an outage.
PUBLIC_HEALTH_URL="https://qalisuite.com/api/health"
PM2_NAME="qalisuite"
BACKUP_DIR="/var/backups/qalisuite"

BRANCH=""
REMOTE="origin"
SKIP_MIGRATE=0
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="$2"; shift 2 ;;
    --remote) REMOTE="$2"; shift 2 ;;
    --skip-migrate) SKIP_MIGRATE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    # A bare branch name, for the way this was called before it took flags.
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) BRANCH="$1"; shift ;;
  esac
done

cd "$APP_DIR"

# Defaults to the branch already checked out, NOT to `main`.
#
# It used to default to main, and `git reset --hard` below does not ask. On a
# server deployed from feat/postgres-migration, running this with no argument
# would have silently replaced the whole application with the Mongo-era one —
# and reported success.
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

say() { echo "==> $*"; }
run() { if [ "$DRY_RUN" = "1" ]; then echo "    [dry-run] $*"; else eval "$@"; fi; }

# ── 1. Plan: say what is about to happen, before anything happens ───────────
#
# A deploy that prints nothing until it has already reset the working tree
# gives the operator no moment to notice they are on the wrong branch.
PREVIOUS_SHA=$(git rev-parse HEAD)
say "Fetching $REMOTE/$BRANCH..."
git fetch "$REMOTE" "$BRANCH"
TARGET_SHA=$(git rev-parse "$REMOTE/$BRANCH")

echo ""
echo "  from:   $PREVIOUS_SHA  $(git log -1 --format=%s "$PREVIOUS_SHA" | cut -c1-58)"
echo "  to:     $TARGET_SHA  $(git log -1 --format=%s "$TARGET_SHA" | cut -c1-58)"

if [ "$PREVIOUS_SHA" = "$TARGET_SHA" ]; then
  say "Already at $TARGET_SHA — nothing to deploy."
  exit 0
fi

# Newly ADDED migration files between the two revisions. Added, not modified:
# an edited migration that has already been applied is a separate problem and
# this does not pretend to detect it.
PENDING_MIGRATIONS=$(git diff --name-only --diff-filter=A \
  "$PREVIOUS_SHA" "$TARGET_SHA" -- 'app/db/migrations/*.sql' || true)
MIGRATION_COUNT=$(printf "%s" "$PENDING_MIGRATIONS" | grep -c . || true)

echo "  commits: $(git rev-list --count "$PREVIOUS_SHA..$TARGET_SHA")"
echo "  new migrations: ${MIGRATION_COUNT:-0}"
if [ "${MIGRATION_COUNT:-0}" -gt 0 ]; then
  printf "%s\n" "$PENDING_MIGRATIONS" | sed 's#app/db/migrations/#      #'
fi
echo ""

# ── 2. Back up, and refuse to migrate without one ───────────────────────────
#
# This used to WARN and continue when the backup tool was missing, which meant
# every schema change on this server has gone in with no dump behind it. A
# warning nobody reads is not a safeguard. Code-only deploys still proceed —
# they are revertible with a git reset; a migration is not.
backup() {
  mkdir -p "$BACKUP_DIR" 2>/dev/null || true
  local stamp; stamp=$(date +%Y%m%d-%H%M%S)
  local out="$BACKUP_DIR/qalisuite-$stamp.sql.gz"

  if command -v /usr/local/bin/qalisuite-backup >/dev/null 2>&1; then
    say "Backing up via qalisuite-backup..."
    run "sudo -u postgres /usr/local/bin/qalisuite-backup" && return 0
  fi

  # Postgres runs in a container here and there is no pg_dump on the host, so
  # the dump has to go through the container that owns the data directory.
  local cid
  cid=$(docker ps --filter "ancestor=postgres" --format '{{.ID}}' 2>/dev/null | head -1 || true)
  [ -z "$cid" ] && cid=$(docker ps --format '{{.ID}} {{.Names}}' 2>/dev/null | grep -iE 'postgres|pg' | awk '{print $1}' | head -1 || true)
  if [ -n "$cid" ]; then
    say "Backing up via container $cid -> $out"
    run "docker exec $cid pg_dumpall -U postgres | gzip > '$out'" && return 0
  fi

  return 1
}

if [ "${MIGRATION_COUNT:-0}" -gt 0 ] && [ "$SKIP_MIGRATE" = "0" ]; then
  if ! backup; then
    echo "" >&2
    echo "  REFUSING TO DEPLOY: $MIGRATION_COUNT migration(s) to apply and no way" >&2
    echo "  to take a backup. There are no down-migrations, so the dump is the" >&2
    echo "  only way back." >&2
    echo "" >&2
    echo "  Fix one of these, then re-run:" >&2
    echo "    - install /usr/local/bin/qalisuite-backup (DEPLOYMENT.md step 7)" >&2
    echo "    - give this user docker access to the postgres container" >&2
    echo "" >&2
    echo "  Or deploy the code alone with --skip-migrate." >&2
    exit 1
  fi
else
  say "No migrations to apply — skipping backup."
fi

# ── 3. Code ─────────────────────────────────────────────────────────────────
say "Checking out $TARGET_SHA..."
run "git reset --hard '$TARGET_SHA'"

# ── 4. Dependencies ─────────────────────────────────────────────────────────
say "Installing dependencies..."
#
# `npm ci` FIRST, and a fallback that does not touch the lockfile.
#
# package-lock.json is generated on macOS arm64 and npm records only the
# optional platform packages it resolved there (npm/cli#4828). On this host
# that lock is incomplete: @tailwindcss/oxide@4.2.2 declares twelve platform
# packages and the lock contains one, darwin-arm64. npm 11 does not tolerate
# that — it refuses outright:
#
#   npm error `npm ci` can only install packages when your package.json and
#   npm error package-lock.json are in sync.
#   npm error Missing: @tailwindcss/oxide-linux-x64-gnu@4.2.2 from lock file
#
# and prints its own help, which reads like a scripting mistake rather than a
# platform one.
#
# --no-package-lock is the whole point of the fallback. Past deploys fell back
# to a plain `npm install`, which REWROTE package-lock.json on the server —
# which is where the +8,894/-5,039 of uncommitted lockfile drift on this box
# came from, and why the dependency tree running in production stopped matching
# the one in the repository. This installs what package.json asks for and
# leaves the lockfile exactly as committed.
#
# The root fix is a platform-complete lockfile. Generating one is a deliberate
# dependency pass, not something a deploy should do at 2am.
if ! run "npm ci"; then
  echo "    npm ci refused (platform-incomplete lockfile, npm/cli#4828)."
  echo "    Falling back to npm install --no-package-lock."
  run "npm install --no-package-lock --no-audit --no-fund"
fi

# ── 4b. Repair the platform-native bindings npm left out ────────────────────
#
# package-lock.json is generated on a macOS arm64 machine, and npm records only
# the optional platform packages it resolved there (npm/cli#4828). `npm ci`
# installs exactly the lock, so on linux-x64 the native bindings the BUILD needs
# are absent and `next build` dies with
#
#   Cannot find module '../lightningcss.linux-x64-gnu.node'
#
# which reads as a corrupt install rather than a missing optional dependency.
#
# Versions are read from what npm ci actually installed, so a dependency bump
# cannot silently reintroduce a mismatch. --no-save leaves the lockfile alone,
# so the deploy stays reproducible. The root fix is a platform-complete
# lockfile; regenerating it is a deliberate dependency pass, not a deploy-time
# change.
say "Repairing platform-native bindings (npm/cli#4828)..."
ARCH_TRIPLE="linux-x64-gnu"
run "npm install --no-save --no-audit --no-fund \
  'lightningcss-${ARCH_TRIPLE}@\$(node -p \"require('lightningcss/package.json').version\")' \
  '@tailwindcss/oxide-${ARCH_TRIPLE}@\$(node -p \"require('@tailwindcss/oxide/package.json').version\")' \
  '@next/swc-${ARCH_TRIPLE}@\$(node -p \"require('next/package.json').version\")'" \
  || echo "    WARNING: binding repair failed — the build may fail next."

# ── 5. Build, while the old process keeps serving ───────────────────────────
say "Building..."
run "npm run build"

# ── 6. Schema, only once the build that needs it exists ─────────────────────
if [ "$SKIP_MIGRATE" = "1" ]; then
  say "--skip-migrate: leaving the schema alone."
elif [ "${MIGRATION_COUNT:-0}" -eq 0 ]; then
  say "No new migrations."
else
  say "Applying $MIGRATION_COUNT migration(s)..."
  if ! run "npm run db:migrate"; then
    echo "" >&2
    echo "  MIGRATION FAILED. Nothing was reloaded; the previous build is still" >&2
    echo "  serving, and the failed migration rolled back — but any migration" >&2
    echo "  BEFORE it in the series has applied." >&2
    echo "" >&2
    echo "  A CHECK constraint that fails here is usually existing data that" >&2
    echo "  does not satisfy a rule the new code enforces. Find the rows, fix" >&2
    echo "  them, and re-run — do not weaken the constraint to make it pass." >&2
    echo "" >&2
    echo "  Code is at $TARGET_SHA but NOT serving. To go back:" >&2
    echo "    git reset --hard $PREVIOUS_SHA && npm ci && npm run build" >&2
    exit 1
  fi
fi

# ── 7. Reload, not restart ──────────────────────────────────────────────────
# `reload` replaces workers without dropping the listening socket, so in-flight
# requests finish. `restart` kills first and drops them.
say "Reloading PM2..."
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  run "pm2 reload '$PM2_NAME' --update-env"
else
  run "pm2 start npm --name '$PM2_NAME' -- start -- -p 3000"
fi
run "pm2 save"

# ── 8. Verify, and put the code back if it did not come up ──────────────────
say "Waiting for health check..."
for i in $(seq 1 30); do
  if [ "$DRY_RUN" = "1" ]; then break; fi
  if curl -fsS -m 5 "$HEALTH_URL" >/dev/null 2>&1; then
    echo ""
    echo "============================================"
    echo "  App healthy — $(curl -fsS "$HEALTH_URL")"
    echo "  $TARGET_SHA on $BRANCH"

    # Not fatal, and not silent. The deploy itself succeeded — the app is
    # serving on :3000 — so rolling the code back would fix nothing. What is
    # broken is in front of it, and the operator needs to know that now rather
    # than from a customer.
    if curl -fsS -m 20 "$PUBLIC_HEALTH_URL" >/dev/null 2>&1; then
      echo "  Public  — $PUBLIC_HEALTH_URL is up."
    else
      echo "  WARNING — $PUBLIC_HEALTH_URL did NOT answer, though the app did."
      echo "            That is Caddy, DNS or the certificate, not this deploy."
      echo "            sudo systemctl status caddy"
    fi
    echo "============================================"
    exit 0
  fi
  sleep 2
done

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  say "Dry run finished — nothing was changed."
  exit 0
fi

# The code goes back by itself. The schema does not, and saying so is the
# point: an automatic rollback that quietly left the database ahead would be
# worse than no rollback at all.
echo "" >&2
echo "  UNHEALTHY after 60s — rolling the CODE back to $PREVIOUS_SHA." >&2
git reset --hard "$PREVIOUS_SHA"
npm ci
npm run build
pm2 reload "$PM2_NAME" --update-env || pm2 start npm --name "$PM2_NAME" -- start -- -p 3000

if curl -fsS -m 5 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "  Rolled back and healthy at $PREVIOUS_SHA." >&2
else
  echo "  STILL UNHEALTHY after rollback. pm2 logs $PM2_NAME --lines 100" >&2
fi

if [ "${MIGRATION_COUNT:-0}" -gt 0 ] && [ "$SKIP_MIGRATE" = "0" ]; then
  echo "" >&2
  echo "  NOTE: $MIGRATION_COUNT migration(s) APPLIED and were not undone." >&2
  echo "  The code is back at $PREVIOUS_SHA and the schema is not. If the" >&2
  echo "  schema is the problem, restore the dump from $BACKUP_DIR." >&2
fi
exit 1
