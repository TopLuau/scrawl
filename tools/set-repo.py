"""Point every link at your GitHub repo:  python tools/set-repo.py YOURNAME/scrawl [https://your-site.vercel.app]"""
import os, sys
new = sys.argv[1]
site = sys.argv[2].rstrip("/") if len(sys.argv) > 2 else None
root = os.path.join(os.path.dirname(__file__), "..")
for d, dirs, files in os.walk(root):
    dirs[:] = [x for x in dirs if x not in ("target", ".git", "scratch", "data")]
    for f in files:
        if f.endswith((".md", ".html", ".js", ".yml", ".yaml", ".rs", ".py", ".toml")):
            p = os.path.join(d, f)
            s = open(p, encoding="utf8").read(); t = s.replace("topluau/scrawl", new)
            if site: t = t.replace("https://scrawlboard.vercel.app", site).replace("scrawlboard.vercel.app", site.split("://")[-1])
            if t != s and not p.endswith("set-repo.py"): open(p, "w", encoding="utf8").write(t); print("updated", os.path.relpath(p, root))
