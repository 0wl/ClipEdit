# Renders the ClipEdit icon ([ ▶ ] mark on a dark rounded tile) to PNG/ICO assets.
from PIL import Image, ImageDraw
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 2048  # supersampled canvas


def mark(draw, ox, oy, scale, color=(255, 255, 255, 255)):
    """Draw the 32-unit logo geometry ([ play ]) at offset/scale."""
    R = lambda x0, y0, x1, y1: [ox + x0 * scale, oy + y0 * scale, ox + x1 * scale, oy + y1 * scale]
    r = 1.5 * scale
    for box in (
        (2.5, 3.5, 5.5, 28.5), (2.5, 3.5, 10.5, 6.5), (2.5, 25.5, 10.5, 28.5),      # [
        (26.5, 3.5, 29.5, 28.5), (21.5, 3.5, 29.5, 6.5), (21.5, 25.5, 29.5, 28.5),  # ]
    ):
        draw.rounded_rectangle(R(*box), radius=r, fill=color)
    P = lambda x, y: (ox + x * scale, oy + y * scale)
    draw.polygon([P(13.2, 10.4), P(23.2, 16.0), P(13.2, 21.6)], fill=color)


def tile():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # vertical gradient background clipped to a rounded square
    bg = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(bg)
    for y in range(S):
        t = y / S
        c = int(34 - 16 * t)
        gd.line([(0, y), (S, y)], fill=(c, c, c, 255))
    mask = Image.new("L", (S, S), 0)
    pad = int(S * 0.03)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, S - pad, S - pad], radius=int(S * 0.225), fill=255)
    img.paste(bg, (0, 0), mask)
    d = ImageDraw.Draw(img)
    # hairline highlight border
    d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=int(S * 0.225), outline=(255, 255, 255, 38), width=int(S * 0.008))
    scale = S * 0.6 / 32
    off = (S - 32 * scale) / 2
    mark(d, off, off, scale)
    return img


def plain_mark(size, pad_ratio=0.12):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    scale = S * (1 - 2 * pad_ratio) / 32
    off = (S - 32 * scale) / 2
    mark(d, off, off, scale)
    return img.resize((size, size), Image.LANCZOS)


big = tile()
res = os.path.join(ROOT, "resources")
os.makedirs(res, exist_ok=True)
big.resize((512, 512), Image.LANCZOS).save(os.path.join(res, "icon.png"))
sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
big.resize((256, 256), Image.LANCZOS).save(os.path.join(res, "icon.ico"), sizes=[(s, s) for s in sizes])

assets = os.path.join(ROOT, "shell", "package", "Assets")
os.makedirs(assets, exist_ok=True)
big.resize((150, 150), Image.LANCZOS).save(os.path.join(assets, "Square150x150Logo.png"))
big.resize((44, 44), Image.LANCZOS).save(os.path.join(assets, "Square44x44Logo.png"))
big.resize((50, 50), Image.LANCZOS).save(os.path.join(assets, "StoreLogo.png"))
print("icons written")
