# Deploying a claude-mesh relay

Three supported hosting recipes, all running the same Docker image.

## 1. Single VPS + Caddy + Compose (default)

Prereqs: a small Linux VPS with Docker + DNS pointing at it.

```
git clone https://github.com/you/claude-mesh && cd claude-mesh/docker
cp Caddyfile.example Caddyfile   # edit: set your domain
docker compose up -d relay
docker compose run --rm relay init
# follow prompts. /data/admin.token and /data/<handle>.paircode are written.
docker compose up -d caddy
```

Caddy automatically provisions Let's Encrypt TLS for the domain you configure.

## 2. Tailscale-internal (private network)

Prereqs: Tailscale on the relay host and on every teammate's machine.

```
docker run -it -v /srv/mesh:/data -p 100.64.0.1:8443:8443 \
  -e PORT=8443 -e HOST=0.0.0.0 claude-mesh/relay:latest init
docker run -d --restart=always --name mesh-relay \
  -v /srv/mesh:/data -p 100.64.0.1:8443:8443 \
  -e PORT=8443 -e HOST=0.0.0.0 claude-mesh/relay:latest
tailscale cert mesh.yournet.ts.net   # if you want TLS
```

Teammates pair with `mesh pair --relay https://mesh.yournet.ts.net:8443 <code>`.

## 3. Fly.io / Railway / other managed

Publish the image to GHCR (`ghcr.io/<repo>/relay:latest`) and deploy with:

- a persistent volume mounted at `/data`
- an env var `PORT` matching the platform's expected port
- a platform-managed TLS endpoint

## Admin workflow

```
mesh admin bootstrap --token-file /srv/mesh/admin.token --relay https://mesh.example.com
mesh admin add-user --handle bob --display-name "Bob" --relay https://mesh.example.com
mesh admin disable-user bob --relay https://mesh.example.com
mesh admin revoke-token <token-id> --relay https://mesh.example.com
mesh admin audit --since 2026-04-17T00:00:00Z --relay https://mesh.example.com
```

## Retention & tuning

Environment variables on the relay container:

| Var | Default | Purpose |
|---|---|---|
| `TEAM_RETENTION_DAYS` | 7 | how long delivered messages are retained |
| `MAX_MESSAGE_BYTES` | 65536 | reject oversized content |
| `RATE_LIMIT_PER_MIN` | 120 | per-token /messages rate cap |
| `PAIR_CODE_TTL_HOURS` | 24 | single-use pair code lifetime |
| `PERMISSION_REQUEST_TTL_SECONDS` | 300 | verdict grace window |
