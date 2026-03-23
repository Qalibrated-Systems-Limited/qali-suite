#!/bin/bash
# ============================================
# QaliSuite — Cron Jobs Setup
# Replaces Vercel cron functionality
# Run as deploy user
# ============================================

set -euo pipefail

DOMAIN="${1:-qalisuite.com}"

echo "==> Setting up cron jobs..."

# Write crontab for deploy user
crontab -l 2>/dev/null | grep -v "mark-absent" | crontab -

# Mark absent — weekdays at 3:00 PM UTC (matches vercel.json: "0 15 * * 1-5")
(crontab -l 2>/dev/null; echo "0 15 * * 1-5 curl -s https://$DOMAIN/api/cron/mark-absent > /dev/null 2>&1") | crontab -

echo "==> Cron jobs installed:"
crontab -l

echo ""
echo "============================================"
echo "  Cron jobs configured"
echo "============================================"
