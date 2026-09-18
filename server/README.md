# Supercharge server

Run Supercharge on a VPS or homelab and chat from a phone browser, another laptop, or the CLI.

Modelled on [Paseo](https://github.com/getpaseo/paseo)’s daemon + clients: one process on the machine that has your files, many thin clients.

## What you get

- **Daemon:** `supercharge agent serve` (ACP over WebSocket, password-gated)
- **Web / phone:** `http://HOST:6767` — log in with the same password
- **Local CLI:** `supercharge --remote ws://HOST:6767/ws --secret PASS`
- **Workspace:** bind-mount a folder at `/workspace`

## Docker Compose

```bash
cd server
# edit SUPERCHARGE_PASSWORD in docker-compose.yml
mkdir -p home workspace
docker compose up -d --build
```

Open `http://localhost:6767` (or `http://YOUR_VPS:6767`).

For a public host, put Caddy/nginx with TLS in front and keep `SUPERCHARGE_PASSWORD` long.

## Environment

| Variable | Purpose |
| --- | --- |
| `SUPERCHARGE_PASSWORD` | Required. Web login and `server-key` for the agent WebSocket. |
| `SUPERCHARGE_MODEL` | Optional model id passed to `supercharge agent --model`. |
| `SUPERCHARGE_HOME` | Agent config (default `/home/supercharge/.supercharge` in the container). |

## Security

- Do not publish port 6767 without a password.
- Prefer Tailscale, a VPN, or HTTPS at a reverse proxy instead of a raw public port.
- The container can read and write whatever you mount at `/workspace`.
