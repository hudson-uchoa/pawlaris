# Tailnet ingress

Profile C is the selected Pawlaris ingress. It has no public HTTP, HTTPS, or
SSH exposure: the box and both phones are members of the family Tailscale
tailnet. Tailscale terminates HTTPS and forwards HTTP requests and WebSocket
upgrades to the API's loopback listener. The API remains published only as
`127.0.0.1:8000:8000` by Compose; never publish port 8000 elsewhere.

These commands are run on the real Ubuntu box by the owner. The bootstrap
script installs the official Tailscale APT repository and package, but does not
run `tailscale up`, because that needs the owner's login.

## Join the box and publish the API

1. From the box, log in to the owner's tailnet. This opens the owner-controlled
   browser/login flow; do not put an auth key in the repository or `.env`:

   ```sh
   sudo tailscale up
   ```

2. Confirm the box is connected and read its stable MagicDNS name. The output
   is the box's `*.ts.net` name, without the trailing dot:

   ```sh
   sudo tailscale status
   tailscale status --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))'
   ```

   The same name is visible in the Tailscale admin console under the box's
   machine details. Call it `<box>.ts.net` below. Install Tailscale on both
   phones, sign them into this tailnet, and leave it enabled.

3. Start the stack, confirm local health, then publish the API:

   ```sh
   cd /opt/pawlaris/infra
   sudo docker compose --env-file ../.env up -d
   curl --fail http://127.0.0.1:8000/api/v1/health
   sudo tailscale serve --bg --https=443 http://127.0.0.1:8000
   sudo tailscale serve status
   ```

   `tailscale serve` passes WebSocket upgrades through HTTPS, so the socket is
   available at `wss://<box>.ts.net/api/v1/ws`. The `--bg` configuration is
   stored by the Tailscale service and restored after reboot; verify it after
   reboot with `sudo tailscale serve status` and a health request. Do not
   replace it with a temporary foreground proxy.

4. Bake this URL into the release build, using the exact name read above:

   ```text
   EXPO_PUBLIC_API_URL=https://<box>.ts.net/api/v1
   ```

   The URL contains no token. The socket sends the access token in its first
   frame, never in the URL.

## Key-only SSH, safely restricted to the tailnet

Use a key already authorized for `<user>`; never enable password SSH. Keep the
current SSH session open while making the firewall change.

1. From a second terminal on a device already connected to the tailnet, prove
   key-only SSH works before changing UFW:

   ```sh
   ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no \
     <user>@<box>.ts.net 'hostname; sudo -n true'
   ```

   Do not continue unless this succeeds in the second session. If `sudo -n`
   needs a password, authenticate once in the first session and repeat the
   test; SSH authentication itself must still be key-only.

2. On the box, allow SSH only on Tailscale, then deny other incoming traffic:

   ```sh
   sudo ufw allow in on tailscale0 to any port 22 proto tcp
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw --force enable
   sudo ufw status verbose
   ```

   The established session and the second-terminal test must still work. For
   a cloud box, also remove inbound TCP 22 from the provider firewall/security
   group; the host firewall alone is not sufficient.

3. If the second-terminal test fails, use the open console/session to restore
   access, then test again before retrying:

   ```sh
   sudo ufw delete allow in on tailscale0 to any port 22 proto tcp
   sudo ufw default allow incoming
   sudo ufw --force enable
   sudo ufw status verbose
   ```

   For a cloud box, temporarily restore its provider SSH rule as well. Keep
   `PasswordAuthentication no` and confirm it with:

   ```sh
   sudo sshd -T | grep -Fx 'passwordauthentication no'
   ```
