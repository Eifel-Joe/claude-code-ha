"""Builds icon.png and logo.png for Claude Workbench.

The original Claude spark (tools/logo/claude-spark.png, the app's logo before
3.0.0) sits in a dark terminal window next to a ">_" prompt; chosen over a
redrawn spark in the 3.0.0 rename (docs/specs/2026-10-07-claude-workbench-rename-design.md).
The prompt is drawn as lines, so no font is needed. Run by hand after a logo
change: python tools/make-logo.py (needs Pillow).
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SPARK = ROOT / "tools" / "logo" / "claude-spark.png"
APP = ROOT / "claude-workbench"
S = 512  # drawn at 512 px, scaled down for a clean edge

BACKGROUND = "#F1EFE8"
WINDOW = "#2C2C2A"
DOTS = "#888780"
PROMPT = "#F1EFE8"


def master():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=100, fill=BACKGROUND)
    win = (56, 72, S - 56, S - 72)
    d.rounded_rectangle(win, radius=36, fill=WINDOW)
    for x in (100, 136):
        d.ellipse([x - 12, 96, x + 12, 120], fill=DOTS)

    spark = Image.open(SPARK).convert("RGBA")
    spark = spark.crop(spark.getbbox())
    size = 230
    spark = spark.resize((size, size), Image.LANCZOS)
    cx, cy = S // 2 + 52, (win[1] + win[3]) // 2 + 6
    img.alpha_composite(spark, (cx - size // 2, cy - size // 2))

    # ">_" in the lower left corner of the window
    base = win[3] - 50
    d.line([(96, base - 70), (140, base - 35), (96, base)], fill=PROMPT, width=20, joint="curve")
    d.rounded_rectangle([160, base - 10, 224, base + 8], radius=6, fill=PROMPT)
    return img


def main():
    img = master()
    img.resize((128, 128), Image.LANCZOS).save(APP / "icon.png", optimize=True)
    img.resize((256, 256), Image.LANCZOS).save(APP / "logo.png", optimize=True)
    print("wrote", APP / "icon.png", "and", APP / "logo.png")


if __name__ == "__main__":
    main()
