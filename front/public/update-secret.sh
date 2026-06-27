#!/bin/bash
# =========================================================================
#  Xray Daemon Agent Secret Rotation Script
# =========================================================================

set -e

# Make sure we run as root
if [ "$EUID" -ne 0 ]; then
  echo "[-] Error: Please run this script as root (sudo)."
  exit 1
fi

if [ -z "$1" ]; then
  echo "Usage: curl -sS https://<controller_url>/update-secret.sh | bash -s -- <new_secret>"
  exit 1
fi

NEW_SECRET="$1"
CONFIG_FILE="/etc/xray-daemon/config.env"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "[-] Error: Xray Daemon is not installed or config file is missing at $CONFIG_FILE"
  exit 1
fi

echo "[+] Updating node secret..."
# Backup existing config
cp "$CONFIG_FILE" "${CONFIG_FILE}.bak"

# Replace the secret
sed -i "s/^NODE_SECRET=.*/NODE_SECRET=$NEW_SECRET/" "$CONFIG_FILE"

echo "[+] Restarting xray-daemon to apply changes..."
systemctl restart xray-daemon

echo "========================================================="
echo " Secret Update Completed Successfully!"
echo " The daemon is now running with the new secret."
echo "========================================================="
