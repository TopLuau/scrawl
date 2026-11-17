"""Builds site/: the static landing page for Vercel (or any static host).

The live boards need the Scrawl server (WebSockets), which static hosts cannot run, so the landing
page's "Start a board" button points at the server set in site/config.js.
Run after changing web/home.html, web/landing.css or web/img/.
"""
import os, shutil

ROOT = os.path.join(os.path.dirname(__file__), "..")
WEB, SITE = os.path.join(ROOT, "web"), os.path.join(ROOT, "site")
SITE_URL = "https://scrawlboard.vercel.app"

os.makedirs(os.path.join(SITE, "img"), exist_ok=True)
html = open(os.path.join(WEB, "home.html"), encoding="utf8").read()
html = html.replace('content="/img/og.png"', f'content="{SITE_URL}/img/og.png"')
html = html.replace('<meta property="og:type" content="website">', f'<meta property="og:type" content="website">\n<meta property="og:url" content="{SITE_URL}/">')
open(os.path.join(SITE, "index.html"), "w", encoding="utf8").write(html)
board = open(os.path.join(WEB, "board.html"), encoding="utf8").read().replace('content="/img/og.png"', f'content="{SITE_URL}/img/og.png"')
open(os.path.join(SITE, "board.html"), "w", encoding="utf8").write(board)
for f in ("landing.css", "icon.svg", "icon-192.png", "style.css", "board.js", "p2p.js"):
    shutil.copy(os.path.join(WEB, f), os.path.join(SITE, f))
shutil.copy(os.path.join(WEB, "vendor", "peerjs.min.js"), os.path.join(SITE, "peerjs.min.js"))
for f in os.listdir(os.path.join(WEB, "img")):
    if not f.startswith("."):
        shutil.copy(os.path.join(WEB, "img", f), os.path.join(SITE, "img", f))

cfg = os.path.join(SITE, "config.js")
if not os.path.exists(cfg):  # never overwrite the user's server URL
    open(cfg, "w", encoding="utf8").write(
        '// Where the live Scrawl server runs, e.g. "https://scrawl.onrender.com" (no trailing slash).\n'
        '// Leave it empty and the "Start a board" buttons explain how to host one.\n'
        'window.SCRAWL = { app: "", repo: "TopLuau/scrawl" };\n')
open(os.path.join(SITE, "vercel.json"), "w", encoding="utf8").write('''{
  "cleanUrls": true,
  "rewrites": [
    { "source": "/b/:code([A-Za-z0-9_-]{3,40})", "destination": "/board.html" },
    { "source": "/:code([A-Za-z0-9_-]{3,40})", "destination": "/board.html" }
  ],
  "headers": [
    { "source": "/img/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=86400" }] },
    { "source": "/config.js", "headers": [{ "key": "Cache-Control", "value": "public, max-age=60" }] }
  ]
}
''')
print("site/ built")
