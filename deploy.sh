#!/bin/bash
# ============================================
# QaliSuite — deploy from your machine
#
#   ./deploy.sh                 deploy the checked-out branch
#   ./deploy.sh --dry-run       show the plan, change nothing
#   ./deploy.sh --skip-migrate  code only, leave the schema alone
#   ./deploy.sh --branch main   deploy a different branch
#
# Every flag is passed straight through to deploy/deploy.sh on the server,
# which is where the actual work happens. This is a one-line wrapper on
# purpose: two scripts that both know how to deploy will disagree eventually,
# and the one on the server is the one that can see the server.
# ============================================
#
# WHAT THIS REPLACED, because every line of it was wrong against the running
# system and it would have reported success for most of them:
#
#   docker build / push to GHCR   production does not run in Docker. It is PM2
#                                 behind Caddy, and the `deploy` user has no
#                                 access to the docker socket at all.
#   geoffrey@164.68.116.82        that user cannot log in — publickey denied.
#                                 The deploy account is `deploy`.
#   /var/www/qalisuite            a checkout from February running the MONGO
#                                 app, with no DATABASE_URL in its .env. The
#                                 live application is /opt/qalisuite.
#   https://qalisuite.com         the site is erp.qalisuite.com.
#
# Its own header already said the container path was broken and to use
# deploy/deploy.sh. This makes that the actual behaviour rather than a comment.

set -euo pipefail

SERVER="${QALISUITE_SERVER:-deploy@164.68.116.82}"
APP_DIR="/opt/qalisuite"
PUBLIC_HEALTH="https://erp.qalisuite.com/api/health"

echo "==> Deploying to $SERVER:$APP_DIR"
echo ""

# -t so the remote script's output streams as it happens rather than arriving
# in one lump at the end — a deploy you cannot watch is a deploy you cannot
# interrupt.
ssh -t "$SERVER" "bash $APP_DIR/deploy/deploy.sh $*"

# The server checks localhost:3000, which says nothing about whether the site
# is actually reachable. This is the only check that exercises DNS, Caddy and
# the certificate — the three things that are fine until they are not.
case " $* " in
  *" --dry-run "*) exit 0 ;;
esac

echo ""
echo "==> Verifying the public endpoint..."
if curl -fsS -m 20 "$PUBLIC_HEALTH" >/dev/null 2>&1; then
  echo "    $PUBLIC_HEALTH -> $(curl -fsS -m 20 "$PUBLIC_HEALTH")"
  echo ""
  echo "    https://erp.qalisuite.com is up."
else
  echo "    WARNING: $PUBLIC_HEALTH did not answer." >&2
  echo "    The app passed its own health check on the server, so this is"      >&2
  echo "    Caddy, DNS or the certificate rather than the deploy." >&2
  echo "      ssh $SERVER 'sudo systemctl status caddy; sudo journalctl -u caddy -n 50'" >&2
  exit 1
fi
