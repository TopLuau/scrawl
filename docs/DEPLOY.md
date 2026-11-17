# Deploying Scrawl

Scrawl has two parts and they live in different places:

| Part | What it is | Where it can run |
| --- | --- | --- |
| **Landing page** (`site/`) | static HTML, CSS, GIFs | Vercel, Netlify, GitHub Pages, anywhere |
| **Board server** (the `scrawl` binary) | WebSockets, saved boards, image uploads | Render, Fly.io, Railway, a VPS, a Raspberry Pi, your laptop |

Vercel serves static files and short-lived functions. It cannot hold WebSocket connections or keep files on disk, so the board server cannot run there. (Deploying the whole repository to Vercel is what produced a 500 error: there is nothing for it to run.) The server also serves the landing page itself at `/`, so you can skip Vercel entirely if you want one address.

## 1. The landing page on Vercel

The repository has a root `vercel.json` that publishes the `site/` folder, so importing the repo works as it is.

1. Vercel → **Add New → Project** → import the GitHub repo.
2. Framework preset **Other**. Leave build and install commands empty. (Alternatively set **Root Directory** to `site`.)
3. Deploy. You get a URL like `https://scrawlboard.vercel.app`.

After editing anything in `web/` (landing page, images), regenerate `site/`:

```bash
python tools/build-site.py
```

## 2. The board server

### Render (easiest)

1. Push the repo to GitHub.
2. Open `https://render.com/deploy?repo=https://github.com/topluau/scrawl` (the *Deploy to Render* button in the README), or New → Blueprint and pick the repo. `render.yaml` sets everything up.
3. When it is live you get `https://something.onrender.com`. Check `/healthz` answers `ok`.

Free Render instances sleep when idle (the first visit wakes them in about 30 seconds) and **lose saved boards on restart**, because there is no persistent disk on the free plan. For boards that last, use a paid plan with a disk (see the commented block in `render.yaml`).

### Fly.io (boards persist, small free allowance)

```bash
fly launch --copy-config --no-deploy
fly volumes create scrawl_data --size 1
fly deploy
```

`fly.toml` mounts the volume at `/data` and stops the machine when idle.

### Any Linux box or Raspberry Pi

```bash
cargo build --release
SCRAWL_DATA=/var/lib/scrawl PORT=7878 ./target/release/scrawl
```

Or download the matching build from the Releases page. Put it behind a reverse proxy for HTTPS. Caddy example:

```
scrawl.example.com {
    reverse_proxy localhost:7878
}
```

Caddy forwards WebSockets automatically. For nginx, add `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` on the `/ws/` location. Set `SCRAWL_TRUST_PROXY=1` so rate limits see real client addresses.

## 3. Connect the landing page to the server

Edit `site/config.js`:

```js
window.SCRAWL = { app: "https://something.onrender.com", repo: "topluau/scrawl" };
```

Commit and push; Vercel redeploys. The *Start a board* buttons then open `https://something.onrender.com/b/<code>`. While `app` is empty, the buttons show a short "no board server yet" dialog instead.

## Backups

Everything lives in the data folder: `boards/<code>.json` and `files/`. Copy that folder to back it up.
