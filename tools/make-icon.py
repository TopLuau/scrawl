"""Draws the Scrawl icon in code: icon.svg, icon-192.png and the social card og.png."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "web")
PLATE, INK, CORAL, SKY, PAPER = "#17171c", "#ffffff", "#ff6b3d", "#7cc4ff", "#f6f4ee"

# Cubic bezier segments (512 box) for the scribble
SEGS = [((112, 372), (196, 452), (336, 412), (306, 306)),
        ((306, 306), (276, 200), (140, 232), (198, 150)),
        ((198, 150), (250, 78), (382, 104), (396, 176))]
CURSOR = [(396, 176), (432, 288), (412, 262), (388, 290)]  # little pointer at the end of the line
W = 46


def bez(p, t):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = p
    m = 1 - t
    return (m**3*x0 + 3*m*m*t*x1 + 3*m*t*t*x2 + t**3*x3, m**3*y0 + 3*m*m*t*y1 + 3*m*t*t*y2 + t**3*y3)


def pts():
    out = []
    for s in SEGS:
        for i in range(60):
            out.append(bez(s, i / 60))
    out.append(SEGS[-1][3])
    return out


def render(size, with_plate=True):
    S = 4
    n = size * S
    k = n / 512
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if with_plate:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(112 * k), fill=PLATE)
    p = pts()
    r = W / 2 * k
    for x, y in p:
        d.ellipse([x * k - r, y * k - r, x * k + r, y * k + r], fill=CORAL)
    # pointer
    tip = (412, 168)
    poly = [(tip[0], tip[1]), (tip[0] + 6, tip[1] + 98), (tip[0] + 30, tip[1] + 72), (tip[0] + 62, tip[1] + 96), (tip[0] + 76, tip[1] + 80), (tip[0] + 44, tip[1] + 56), (tip[0] + 76, tip[1] + 44)]
    d.polygon([(x * k, y * k) for x, y in poly], fill=INK, outline=PLATE, width=int(8 * k))
    return im.resize((size, size), Image.LANCZOS)


def svg():
    path = "M{} {} ".format(*SEGS[0][0]) + " ".join("C{} {} {} {} {} {}".format(*s[1], *s[2], *s[3]) for s in SEGS)
    tip = (412, 168)
    poly = [(tip[0], tip[1]), (tip[0] + 6, tip[1] + 98), (tip[0] + 30, tip[1] + 72), (tip[0] + 62, tip[1] + 96), (tip[0] + 76, tip[1] + 80), (tip[0] + 44, tip[1] + 56), (tip[0] + 76, tip[1] + 44)]
    pp = " ".join(f"{x},{y}" for x, y in poly)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="112" fill="{PLATE}"/>
<path d="{path}" fill="none" stroke="{CORAL}" stroke-width="{W}" stroke-linecap="round" stroke-linejoin="round"/>
<polygon points="{pp}" fill="{INK}" stroke="{PLATE}" stroke-width="8" stroke-linejoin="round"/>
</svg>
'''


def font(sz, bold=False):
    for f in (["C:/Windows/Fonts/segoeuib.ttf"] if bold else ["C:/Windows/Fonts/segoeui.ttf"]) + ["DejaVuSans.ttf"]:
        try:
            return ImageFont.truetype(f, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def og():
    im = Image.new("RGB", (1200, 630), PAPER)
    d = ImageDraw.Draw(im)
    # dot grid
    for x in range(30, 1200, 30):
        for y in range(30, 630, 30):
            d.ellipse([x - 1.5, y - 1.5, x + 1.5, y + 1.5], fill="#d8d5cb")
    ic = render(260)
    im.paste(ic, (90, 185), ic)
    d.text((390, 200), "Scrawl", font=font(120, True), fill="#17171c")
    d.text((396, 345), "A whiteboard you can share in one click.", font=font(36), fill="#4a4a55")
    d.text((396, 400), "Draw, write, drop in images and GIFs, together.", font=font(36), fill="#4a4a55")
    im.save(os.path.join(OUT, "og.png"))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "icon.svg"), "w", encoding="utf8").write(svg())
    render(192).save(os.path.join(OUT, "icon-192.png"))
    render(512).save(os.path.join(OUT, "icon-512.png"))
    og()
    print("ok")
