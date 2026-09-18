# Supercharge server

Run Supercharge on a VPS or homelab and chat from a phone browser, another laptop, or the CLI.

Modelled on [Paseo](https://github.com/getpaseo/paseo)’s daemon + clients: one process on the machine that has your files, many thin clients.

## What you get

Paseo-style: **clients never launch the CLI**. They talk to this daemon; the daemon launches Supercharge CLI.

Preferred command (CLI 1.3.16+):

```bash
supercharge agent daemon --bind 0.0.0.0:6767 --secret "$SUPERCHARGE_PASSWORD"
```

Docker uses that when the CLI supports `daemon`, otherwise `server/daemon.mjs`.

- **Daemon:** Node process on `:6767` (password-gated HTTP + SSE)
- **Web:** `http://HOST:6767`
- **Phone:** cloud-infra Flutter app → login → **Supercharge server** → host + password
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
