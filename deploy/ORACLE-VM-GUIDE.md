# Deploy the poller 24/7 on an Oracle Cloud "Always Free" VM

This runs the LinkedIn poller forever (no PC needed), on a real home-like IP
that LinkedIn rate-limits far less than GitHub/Vercel datacenter IPs.

## 1. Create the free VM (Oracle Cloud console)
1. Sign up: https://www.oracle.com/cloud/free/ (needs a card for identity check —
   **Always Free resources are not charged**).
2. Console → **Compute → Instances → Create instance**.
3. Image & shape:
   - **Image:** Canonical **Ubuntu 22.04**.
   - **Shape:** "Ampere" **VM.Standard.A1.Flex** → set **1–2 OCPU, 6–12 GB RAM**
     (all within Always Free). (If A1 is "out of capacity", try another
     Availability Domain, or use the AMD `VM.Standard.E2.1.Micro` — 1 GB RAM,
     tighter but works.)
4. **SSH keys:** "Generate a key pair for me" → **download the private key**
   (you'll need it to log in).
5. Networking: keep defaults (it gets a public IPv4). Create.
6. Note the instance's **Public IP address**.

## 2. SSH into the VM
From your PC (PowerShell), in the folder where the key downloaded:
```powershell
ssh -i .\ssh-key-*.key ubuntu@<PUBLIC_IP>
```
(If it complains about key permissions, that's OK on Windows; if on Linux/Mac:
`chmod 600 the-key`.)

## 3. Run the setup script (installs everything + service)
On the VM:
```bash
curl -fsSL https://raw.githubusercontent.com/alijone2444/job-alert-system/main/deploy/setup-vm.sh -o setup-vm.sh
bash setup-vm.sh
```

## 4. Put the Firebase key on the VM
The key is intentionally NOT in the repo. Get its one-line form on your PC:
```powershell
(Get-Content "d:\Aj work space\job-alert-system\backend\service-account.json" -Raw | ConvertFrom-Json | ConvertTo-Json -Compress) | Set-Clipboard
```
Then on the VM, paste it into the file:
```bash
nano ~/job-alert-system/backend/service-account.json   # paste, Ctrl+O, Enter, Ctrl+X
```
(Or from your PC: `scp -i key.key "d:\Aj work space\job-alert-system\backend\service-account.json" ubuntu@<PUBLIC_IP>:~/job-alert-system/backend/`)

## 5. Start it
```bash
sudo systemctl start jobalert-poller
sudo systemctl status jobalert-poller     # should say active (running)
journalctl -u jobalert-poller -f          # live logs: "Saved and notified: ..."
```

That's it — it now runs 24/7, restarts on crash, and auto-starts on reboot.

## Updating later (after you push new code)
```bash
cd ~/job-alert-system && git pull
cd backend && npm ci
sudo systemctl restart jobalert-poller
```

## Change polling speed
Edit `Environment=POLL_INTERVAL_SECONDS=150` in
`/etc/systemd/system/jobalert-poller.service`, then:
```bash
sudo systemctl daemon-reload && sudo systemctl restart jobalert-poller
```

## Notes
- The committed `backend/.env` already has all config (LinkedIn keywords,
  Pakistan default, Upwork off). The app still controls country/time/sort via
  Firestore, so changing filters in the phone app updates this VM too.
- Once the VM runs the poller 24/7, you can disable the GitHub Actions cron if
  you want (Actions tab → Job Alert Cron → ⋯ → Disable workflow), or leave it as
  a backup.
