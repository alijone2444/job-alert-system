#!/usr/bin/env bash
# One-shot setup for an Oracle Cloud "Always Free" Ubuntu VM.
# Installs Node + the project + Playwright Chromium, and sets up a systemd
# service that runs the poller 24/7 (auto-restart on crash/reboot).
#
# Run as the default 'ubuntu' user:
#   bash setup-vm.sh
#
# AFTER this script: copy backend/service-account.json onto the VM (see guide),
# then:  sudo systemctl start jobalert-poller
set -e

REPO_URL="https://github.com/alijone2444/job-alert-system.git"
APP_DIR="$HOME/job-alert-system"

echo "==> Installing Node.js 20 + git"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

echo "==> Getting the code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi

echo "==> Installing backend dependencies"
cd "$APP_DIR/backend"
npm ci

echo "==> Installing Playwright Chromium + system libraries"
npx playwright install --with-deps chromium

echo "==> Installing systemd service"
sudo cp "$APP_DIR/deploy/jobalert-poller.service" /etc/systemd/system/jobalert-poller.service
sudo systemctl daemon-reload
sudo systemctl enable jobalert-poller

echo ""
echo "============================================================"
echo " Setup done."
echo " NEXT: put your Firebase key on the VM, then start the service:"
echo "   nano $APP_DIR/backend/service-account.json   # paste the JSON, save"
echo "   sudo systemctl start jobalert-poller"
echo ""
echo " Check it:    sudo systemctl status jobalert-poller"
echo " Live logs:   journalctl -u jobalert-poller -f"
echo "============================================================"
