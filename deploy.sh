#!/bin/bash
set -e

IMAGE="ghcr.io/geoffrey-oongo/qalisuite"
TAG="${1:-latest}"
SERVER="geoffrey@164.68.116.82"
DEPLOY_DIR="/var/www/qalisuite"

echo "========================================="
echo "  QaliSuite Build & Deploy"
echo "  Image: $IMAGE:$TAG"
echo "========================================="

# NOTE: this is the CONTAINER path and it is currently BROKEN — the Dockerfile
# copies .next/standalone, which is only produced when next.config.js sets
# `output: "standalone"`, and it does not. docker-compose.yaml also passes
# MONGODB_URI/DB_LOCAL_URI and no DATABASE_URL, so the container cannot reach
# the database. Use deploy/deploy.sh (PM2 + Caddy) until those are fixed.
#
# Two lines were removed here: a mangled `echo ""cd /opt/qalisuite` and a bare
# `vim .env`, which opened an editor in the middle of a non-interactive deploy
# and hung it.

echo "[1/4] Building Docker image..."
docker build -t $IMAGE:$TAG .

echo ""
echo "[2/4] Pushing to GHCR..."
docker push $IMAGE:$TAG

echo ""
echo "[3/4] Deploying on server..."
ssh $SERVER "cd $DEPLOY_DIR && docker compose pull && docker compose up -d"

echo ""
echo "[4/4] Verifying..."
sleep 10
ssh $SERVER "docker ps | grep qalisuite"

echo ""
echo "✅ Deployment complete!"
echo "   https://qalisuite.com"