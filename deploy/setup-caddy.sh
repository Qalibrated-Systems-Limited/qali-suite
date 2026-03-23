#!/bin/bash
# ============================================
# QaliSuite — Caddy Config (auto SSL)
# Run as root on the VPS
# Usage: ssh root@<IP> 'bash -s' < setup-caddy.sh
# ============================================

set -euo pipefail

DOMAIN="${1:-qalisuite.com}"  # pass domain as arg, or edit default

echo "==> Configuring Caddy for $DOMAIN..."

cat > /etc/caddy/Caddyfile << EOF
$DOMAIN {
    reverse_proxy localhost:3000

    encode gzip zstd

    header {
        X-Frame-Options DENY
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
    }
}
EOF

echo "==> Reloading Caddy..."
systemctl reload caddy

echo ""
echo "============================================"
echo "  Caddy configured for $DOMAIN"
echo "  SSL certificate will auto-provision"
echo "  Make sure DNS A record points to this IP"
echo "============================================"
