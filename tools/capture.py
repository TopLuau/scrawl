"""Records the landing-page GIFs and screenshots from the real running app.

Drives two real browser sessions (Ada and Bob) against a local server, so the collaboration you
see is the actual WebSocket sync. Usage:
    SCRAWL_ADDR=127.0.0.1:7879 SCRAWL_DATA=scratch/capdata target/release/scrawl &
    python tools/make-demo-assets.py && python tools/capture.py http://127.0.0.1:7879
"""
import base64, io, math, os, random, sys, time
from PIL import Image
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:7879"
ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "web", "img")
SCR = os.path.join(ROOT, "scratch")
W, H = 1280, 760
random.seed(7)

FAKE_CURSOR = """
addEventListener('DOMContentLoaded',()=>{
 const c=document.createElement('div');
 c.style.cssText='position:fixed;left:0;top:0;width:22px;height:26px;pointer-events:none;z-index:99999;transform:translate(-100px,-100px)';
 c.innerHTML='<svg width="22" height="26" viewBox="0 0 13 20"><path d="M0 0L0 17L4.5 13L8 20L10.5 19L7 12L13 12Z" fill="#7048e8" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
 document.body.appendChild(c);
 addEventListener('pointermove',e=>{c.style.transform=`translate(${e.clientX}px,${e.clientY}px)`},true);
});
"""


def init_script(name, color, fake):
    return f"localStorage.setItem('scrawl.name','{name}');localStorage.setItem('scrawl.color','{color}');" + (FAKE_CURSOR if fake else "")


class Rec:
    def __init__(self, page):
        self.page, self.frames = page, []

    def snap(self, d=70):
        im = Image.open(io.BytesIO(self.page.screenshot(type="png"))).convert("RGB")
        self.frames.append((im, d))

    def hold(self, n, d=70, wait=0.05):
        for _ in range(n):
            time.sleep(wait)
            self.snap(d)

    def move(self, a, b, n=8, snap_every=2):
        for i in range(1, n + 1):
            t = i / n
            t = t * t * (3 - 2 * t)
            self.page.mouse.move(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            if i % snap_every == 0:
                self.snap()

    def stroke(self, pts, every=2):
        self.page.mouse.move(*pts[0])
        self.page.mouse.down()
        for i, p in enumerate(pts[1:]):
            self.page.mouse.move(*p)
            if i % every == 0:
                self.snap()
        self.page.mouse.up()
        self.snap()

    def key(self, k):
        self.page.keyboard.press(k)

    def type(self, text, every=2):
        for i, ch in enumerate(text):
            self.page.keyboard.type(ch)
            if i % every == 0:
                self.snap()
        self.snap()

    def save(self, name, width=960, colors=192, last_hold=1400):
        frames = self.frames
        scaled = [(im.resize((width, int(im.height * width / im.width)), Image.LANCZOS), d) for im, d in frames]
        step = max(1, len(scaled) // 10)
        sample = [im for im, _ in scaled[::step]][:10]
        sheet = Image.new("RGB", (width, sample[0].height * len(sample)))
        for i, im in enumerate(sample):
            sheet.paste(im, (0, i * im.height))
        pal = sheet.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        q = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im, _ in scaled]
        durs = [d for _, d in scaled]
        durs[-1] = last_hold
        q[0].save(os.path.join(OUT, name), save_all=True, append_images=q[1:], duration=durs, loop=0, optimize=True, disposal=1)
        print(name, len(q), "frames", os.path.getsize(os.path.join(OUT, name)) // 1024, "KB")


def drop_file(page, path, mime, x, y):
    b64 = base64.b64encode(open(path, "rb").read()).decode()
    page.evaluate(
        """([b64,mime,name,x,y])=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const f=new File([bytes],name,{type:mime});
        const dt=new DataTransfer();dt.items.add(f);window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,clientX:x,clientY:y,bubbles:true,cancelable:true}));}""",
        [b64, mime, os.path.basename(path), x, y],
    )


def swatch(page, i):
    page.locator("#sw button").nth(i).click()


def size(page, i):
    page.locator("#wd button").nth(i).click()


def wave(x0, y0, x1, amp=7, n=36):
    return [(x0 + (x1 - x0) * i / n, y0 + math.sin(i / n * 7) * amp) for i in range(n + 1)]


def ellipse(cx, cy, rx, ry, a0=-1.2, turns=1.05, n=44):
    return [(cx + rx * math.cos(a0 + turns * 2 * math.pi * i / n), cy + ry * math.sin(a0 + turns * 2 * math.pi * i / n)) for i in range(n + 1)]


def tour(A, B):
    r = Rec(A)
    r.hold(4)
    size(A, 2)
    r.key("t")
    A.mouse.click(236, 150)
    r.snap()
    r.type("Launch plan", 2)
    r.key("Escape")
    r.hold(1)
    size(A, 1)
    swatch(A, 5)
    r.key("p")
    r.stroke(wave(240, 222, 560), 2)
    swatch(A, 4)
    r.key("r")
    r.stroke([(240, 290), (450, 290), (450, 390), (240, 390), (240, 290)][:2] if False else [(240, 290), (345, 340), (450, 390)], 1)
    r.key("r")
    r.stroke([(620, 290), (715, 340), (810, 390)], 1)
    r.key("a")
    r.stroke([(456, 340), (520, 340), (612, 340)], 2)
    swatch(A, 0)
    r.key("t")
    A.mouse.click(272, 322)
    r.type("Ideas", 2)
    r.key("Escape")
    r.key("t")
    A.mouse.click(660, 322)
    r.type("Ship", 2)
    r.key("Escape")
    r.hold(2)
    # Bob joins in: sticky note, then circles "Ship"
    B.keyboard.press("n")
    B.mouse.move(500, 600)
    r.hold(2)
    B.mouse.click(930, 470)
    B.keyboard.type("Friday?")
    B.keyboard.press("Escape")
    r.hold(3)
    B.locator("#sw button").nth(1).click()
    B.keyboard.press("p")
    pts = ellipse(715, 340, 128, 66)
    B.mouse.move(*pts[0])
    B.mouse.down()
    for i, p in enumerate(pts[1:]):
        B.mouse.move(*p)
        if i % 2 == 0:
            r.snap()
    B.mouse.up()
    r.hold(2)
    B.mouse.move(980, 620)
    r.hold(2)
    # Ada drops in a GIF
    drop_file(A, os.path.join(SCR, "spin.gif"), "image/gif", 400, 560)
    r.hold(14, 80, 0.03)
    r.snap(80)
    return r


def draw():
    return None


def media(A):
    r = Rec(A)
    r.hold(3)
    drop_file(A, os.path.join(SCR, "photo.png"), "image/png", 560, 330)
    r.hold(6, 80, 0.12)
    r.key("v")
    r.move((20, 400), (600, 330), 6)
    A.mouse.click(560, 330)
    r.hold(2)
    # resize with the corner handle
    box = A.evaluate("(()=>{const o=[...window.__scrawl.objs.values()][0],c=window.__scrawl.cam;return [c.x+(o.x+o.w)*c.k,c.y+(o.y+o.h)*c.k,c.x+(o.x+o.w/2)*c.k,c.y+(o.y+o.h/2)*c.k]})()")
    r.move((box[2], box[3]), (box[0], box[1]), 6)
    A.mouse.down()
    for i in range(1, 11):
        A.mouse.move(box[0] - i * 18, box[1] - i * 12)
        if i % 2 == 0:
            r.snap()
    A.mouse.up()
    r.hold(2)
    # drag it left
    c = A.evaluate("(()=>{const o=[...window.__scrawl.objs.values()][0],c=window.__scrawl.cam;return [c.x+(o.x+o.w/2)*c.k,c.y+(o.y+o.h/2)*c.k]})()")
    r.move((box[0] - 180, box[1] - 120), (c[0], c[1]), 4)
    A.mouse.down()
    for i in range(1, 13):
        A.mouse.move(c[0] - i * 24, c[1] + i * 2)
        if i % 2 == 0:
            r.snap()
    A.mouse.up()
    r.hold(2)
    drop_file(A, os.path.join(SCR, "spin.gif"), "image/gif", 880, 330)
    r.hold(16, 80, 0.03)
    # a note next to it
    swatch(A, 5)
    r.key("n")
    A.mouse.click(930, 560)
    r.type("GIFs keep playing", 2)
    r.key("Escape")
    r.key("v")
    r.hold(14, 80, 0.03)
    return r


def sketch(A):
    r = Rec(A)
    r.hold(3)
    size(A, 1)
    # house
    swatch(A, 0)
    r.key("r")
    r.stroke([(420, 420), (520, 470), (620, 520)], 1)
    r.key("l")
    r.stroke([(410, 420), (470, 360), (530, 300)], 2)
    r.key("l")
    r.stroke([(530, 300), (590, 360), (630, 420)], 2)
    swatch(A, 1)
    r.key("r")
    r.stroke([(500, 450), (520, 480), (540, 520)], 1)
    # sun with the highlighter
    swatch(A, 2)
    r.key("h")
    for k in range(3):
        r.stroke(ellipse(820, 230, 40 - k * 8, 40 - k * 8, 0.3 * k, 1.0, 26), 2)
    swatch(A, 2)
    r.key("p")
    for a in range(0, 360, 45):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        r.stroke([(820 + ca * 56, 230 + sa * 56), (820 + ca * 78, 230 + sa * 78)], 1)
    # tree
    swatch(A, 3)
    r.key("p")
    r.stroke(ellipse(760, 440, 46, 56, -1.5, 1.05, 30), 2)
    swatch(A, 0)
    r.key("p")
    r.stroke([(760, 496), (760, 540), (762, 560)], 2)
    swatch(A, 4)
    r.key("a")
    r.stroke([(240, 560), (330, 520), (410, 500)], 2)
    swatch(A, 0)
    r.key("t")
    A.mouse.click(150 + 90, 575)
    r.type("my place", 2)
    r.key("Escape")
    r.hold(3)
    # erase the sun rays on one side
    r.key("e")
    r.move((730, 170), (760, 220), 3, 1)
    A.mouse.down()
    for i in range(0, 18):
        A.mouse.move(740 + i * 4, 170 + i * 3)
        if i % 2 == 0:
            r.snap()
    A.mouse.up()
    r.hold(2)
    r.key("Escape")
    A.keyboard.press("Control+z")
    r.hold(6)
    return r


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome")
        mk = lambda name, col, fake: br.new_context(viewport={"width": W, "height": H}, color_scheme="dark")
        # collaboration tour
        ca, cb = mk("Ada", "#7048e8", True), mk("Bob", "#1971c2", False)
        ca.add_init_script(init_script("Ada", "#7048e8", True))
        cb.add_init_script(init_script("Bob", "#1971c2", False))
        A, B = ca.new_page(), cb.new_page()
        room = "tour" + str(int(time.time()) % 100000)
        A.goto(f"{BASE}/b/{room}")
        B.goto(f"{BASE}/b/{room}")
        A.wait_for_selector("#dot.ok")
        B.wait_for_selector("#dot.ok")
        time.sleep(0.6)
        r = tour(A, B)
        r.save("tour.gif", 1000)
        r.frames[-1][0].save(os.path.join(OUT, "board.png"))
        # sketch + media on fresh boards (Ada only)
        for fn, name in ((sketch, "sketch.gif"), (media, "media.gif")):
            A.goto(f"{BASE}/b/{fn.__name__}{int(time.time()) % 100000}")
            A.wait_for_selector("#dot.ok")
            time.sleep(0.5)
            rr = fn(A)
            rr.save(name, 960)
            if fn is media:
                rr.frames[-1][0].save(os.path.join(OUT, "media.png"))
        br.close()


if __name__ == "__main__":
    main()
