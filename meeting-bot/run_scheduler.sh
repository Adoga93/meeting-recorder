#!/bin/bash
# PAS Tutors 24/7 Automated Class Recorder Scheduler (Linux / OCI)

cd "$(dirname "$0")"

echo "========================================================"
echo "  🤖 PAS TUTORS 24/7 CLASS RECORDER SCHEDULER (OCI/LINUX)"
echo "========================================================"
echo ""

# Check if Docker daemon is running
if ! docker info > /dev/null 2>&1; then
    echo "⚠️ [WARNING] Docker daemon is not running! Trying to start service..."
    sudo systemctl start docker 2>/dev/null
    sleep 2
fi

if docker info > /dev/null 2>&1; then
    echo "✅ [OK] Docker daemon is running and responsive."
else
    echo "❌ [ERROR] Could not connect to Docker. Ensure Docker is running (sudo systemctl start docker)."
fi

# Continuous execution loop (auto-restarts if process crashes)
while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Scheduler (node scheduler.js)..."
    node scheduler.js
    echo ""
    echo "⚠️ [ALERT] Scheduler stopped or crashed. Restarting in 5 seconds..."
    sleep 5
done
