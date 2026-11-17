"""Original demo media used in the captures: a landscape picture and a spinning-logo GIF."""
import math, os
from PIL import Image, ImageDraw
OUT = os.path.join(os.path.dirname(__file__), "..", "scratch")
os.makedirs(OUT, exist_ok=True)

def landscape():
    W, H = 640, 400
    im = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(40 + 190 * t), int(30 + 90 * t), int(110 + 60 * (1 - t))))
    d.ellipse([430, 90, 520, 180], fill=(255, 226, 160))
    for pts, col in [([(-20, 330), (140, 160), (300, 330)], (74, 58, 130)), ([(180, 340), (360, 120), (560, 340)], (52, 42, 104)), ([(380, 340), (540, 190), (700, 340)], (36, 30, 78))]:
        d.polygon(pts, fill=col)
    d.rectangle([0, 320, W, H], fill=(24, 20, 56))
    im.save(os.path.join(OUT, "photo.png"))

def spin():
    S, frames = 160, []
    for i in range(24):
        im = Image.new("RGB", (S, S), (20, 20, 30))
        d = ImageDraw.Draw(im)
        a0 = i / 24 * 2 * math.pi
        for k in range(12):
            a = a0 + k / 12 * 2 * math.pi
            r = 10 + 4 * math.sin(a0 * 2 + k)
            x, y = S / 2 + math.cos(a) * 52, S / 2 + math.sin(a) * 52
            c = (int(124 + 100 * math.sin(a)), int(92 + 60 * math.cos(a)), 255)
            d.ellipse([x - r, y - r, x + r, y + r], fill=c)
        d.ellipse([S / 2 - 14, S / 2 - 14, S / 2 + 14, S / 2 + 14], fill=(255, 255, 255))
        frames.append(im.quantize(64))
    frames[0].save(os.path.join(OUT, "spin.gif"), save_all=True, append_images=frames[1:], duration=60, loop=0)

landscape(); spin(); print("ok")
