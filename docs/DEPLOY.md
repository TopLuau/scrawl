# Deploying Scrawl

There are two ways to run Scrawl, and you can use either or both.

| | Web (peer-to-peer) | Rust server |
| --- | --- | --- |
| Needs a server | no, a static host is enough (Vercel, Netlify, GitHub Pages) | yes, one small binary |
| Board addresses | `yoursite.com/CODE` | `yourserver.com/CODE` |
| Saved boards | live while someone has them open; the host's browser remembers them | JSON files on disk, always on |
| Images | about 3 MB, GIFs about 2.2 MB (they travel inside the board) | 10 MB uploads |
| Strict firewalls | can fail (no relay is built in) | works |
| Cost | free | a small VM or a free tier |

## 1. The static site on Vercel (peer-to-peer boards)

The repository has a root `vercel.json` that publishes the `site/` folder and rewrites `/CODE` to the board page (Vercel only reads this file from the project root), so importing the repo works as it is.

1. Vercel: **Add New, Project**, import the GitHub repo.
2. Framework preset **Other**. Leave build and install commands empty.
3. Deploy. `https://your-project.vercel.app/ABC123` is now a board.

Or from a terminal: `npx vercel link` then `npx vercel --prod`.

After editing anything in `web/` (landing page, board, images), regenerate `site/`:

```bash
python tools/build-site.py
```

How it connects: the first browser to open a code registers `scrawl-v1-<code>` with the public PeerJS matchmaking server and becomes the host. Others connect to that id over WebRTC. You can run your own PeerJS server and set `peer: { host: "...", port: 443, secure: true, path: "/" }` in `site/config.js`; add `config: { iceServers: [...] }` there to supply TURN servers for networks that block direct connections.

## 2. The Rust server (always-on boards)

### Render

1. Push the repo to GitHub.
2. Open `https://render.com/deploy?repo=https://github.com/TopLuau/scrawl` (the button in the README), or New, Blueprint, pick the repo. `render.yaml` sets it up.
3. When it is live, `https://something.onrender.com/healthz` answers `ok`.

Free Render instances sleep when idle (the first visit takes about 30 seconds) and **lose saved boards on restart**. For boards that last, use a paid plan with a disk (see the commented block in `render.yaml`).

### Fly.io

```bash
fly launch --copy-config --no-deploy
fly volumes create scrawl_data --size 1
fly deploy
```

### Any Linux box or Raspberry Pi

```bash
cargo build --release
SCRAWL_DATA=/var/lib/scrawl PORT=7878 ./target/release/scrawl
```

Or download the matching build from the Releases page. Put it behind a reverse proxy for HTTPS. Caddy:

```
scrawl.example.com {
    reverse_proxy localhost:7878
}
```

Caddy forwards WebSockets automatically. For nginx add `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` on the `/ws/` location. Set `SCRAWL_TRUST_PROXY=1` so rate limits see real client addresses.

### Pointing the static site at your server

In `site/config.js`:

```js
window.SCRAWL = { mode: "server", app: "https://something.onrender.com", repo: "TopLuau/scrawl" };
```

The landing page then sends people to `https://something.onrender.com/CODE`. With `mode: "p2p"` and `app: ""` boards stay on the static site.

## Backups (server mode)

Everything lives in the data folder: `boards/<code>.json` and `files/`. Copy it to back up.
