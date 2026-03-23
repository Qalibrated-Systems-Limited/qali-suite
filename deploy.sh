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

echo ""cd /opt/qalisuite
vim .env

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