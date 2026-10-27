#!/usr/bin/env python3
"""
Generate the Hop icon set from code (no design tool required).

    python scripts/make-icons.py

Outputs (all committed, so a fresh clone can build without Python):

    build/icon.svg            vector source of record
    build/icon.png            1024×1024 master (electron-builder / Linux)
    build/icon.ico            Windows icon, 7 sizes, PNG-compressed entries
    build/icons/icon-<n>.png  16 … 512 px, for the app window / docs

Design: a rounded "app tile" with an indigo→violet gradient, a white prompt
chevron and an underscore — the universal "there is a shell here" glyph, plus a
subtle top-left specular so the tile reads as glass rather than flat paint.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
ICONS = BUILD / "icons"

SIZE = 1024
SS = 2  # supersampling factor
W = SIZE * SS

TOP = np.array([0x5B, 0x6C, 0xFF], dtype=np.float32)     # indigo
BOTTOM = np.array([0x93, 0x4E, 0xF6], dtype=np.float32)  # violet
RADIUS_RATIO = 0.225


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def gradient_tile(size: int) -> Image.Image:
    """Diagonal indigo→violet gradient clipped to a rounded square."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    t = np.clip((xx + yy) / (2.0 * (size - 1)), 0.0, 1.0)[..., None]
    rgb = TOP * (1.0 - t) + BOTTOM * t

    # Faint vertical sheen: brighter at the top, darker at the bottom.
    sheen = np.linspace(1.06, 0.94, size, dtype=np.float32)[:, None, None]
    rgb = np.clip(rgb * sheen, 0, 255)

    alpha = np.asarray(rounded_mask(size, int(size * RADIUS_RATIO)), dtype=np.float32)[..., None]
    rgba = np.concatenate([rgb, alpha], axis=2).astype(np.uint8)
    return Image.fromarray(rgba, mode="RGBA")


def specular(size: int) -> Image.Image:
    """Soft highlight in the upper-left corner (glass feel)."""
    layer = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(layer)
    r = int(size * 0.62)
    draw.ellipse(
        [-int(size * 0.28), -int(size * 0.42), int(size * 0.28) + r, -int(size * 0.42) + r],
        fill=110,
    )
    layer = layer.filter(ImageFilter.GaussianBlur(size * 0.10))
    out = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    out.putalpha(layer)
    return out


def glyph(size: int, simplified: bool = False) -> Image.Image:
    """Prompt chevron + underscore, white, with round caps.

    `simplified` drops the underscore: below ~24 px the two strokes fuse into a
    blob, so small sizes get the chevron alone (a normal practice for app icons).
    """
    layer = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(layer)
    size_stroke = 0.098 if simplified else 0.082
    stroke = int(size * size_stroke)
    inset = stroke / 2

    # Chevron ">"
    chevron = [
        (size * 0.315, size * 0.315),
        (size * 0.575, size * 0.500),
        (size * 0.315, size * 0.685),
    ]
    draw.line(chevron, fill=255, width=stroke, joint="curve")
    for x, y in chevron:
        draw.ellipse([x - inset, y - inset, x + inset, y + inset], fill=255)

    if not simplified:
        # Underscore "_", sitting on the chevron's baseline (y = 0.685).
        bar_left, bar_right = size * 0.600, size * 0.770
        bar_top = size * 0.685 - stroke / 2
        draw.rounded_rectangle(
            [bar_left, bar_top, bar_right, bar_top + stroke],
            radius=inset,
            fill=255,
        )

    out = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    out.putalpha(layer)
    return out


def compose(simplified: bool = False) -> Image.Image:
    tile = gradient_tile(W)

    # Inner hairline: keeps the tile crisp on light backgrounds.
    hairline = Image.new("L", (W, W), 0)
    d = ImageDraw.Draw(hairline)
    d.rounded_rectangle(
        [W * 0.008, W * 0.008, W * 0.992, W * 0.992],
        radius=int(W * RADIUS_RATIO),
        outline=70,
        width=max(2, int(W * 0.006)),
    )
    edge = Image.new("RGBA", (W, W), (255, 255, 255, 0))
    edge.putalpha(hairline.filter(ImageFilter.GaussianBlur(W * 0.002)))

    img = Image.alpha_composite(tile, specular(W))
    img = Image.alpha_composite(img, glyph(W, simplified=simplified))
    img = Image.alpha_composite(img, edge)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5b6cff"/>
      <stop offset="1" stop-color="#934ef6"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.18" cy="0.08" r="0.75">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#tile)"/>
  <rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#sheen)"/>
  <rect x="8" y="8" width="1008" height="1008" rx="222" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="6"/>
  <g fill="none" stroke="#ffffff" stroke-width="84" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="322,322 589,512 322,701"/>
    <line x1="656" y1="701" x2="746" y2="701"/>
  </g>
</svg>
"""


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    ICONS.mkdir(parents=True, exist_ok=True)

    master = compose()
    master_simple = compose(simplified=True)
    master.save(BUILD / "icon.png", optimize=True)
    (BUILD / "icon.svg").write_text(SVG, encoding="utf-8")

    sizes = [16, 24, 32, 48, 64, 128, 256, 512]
    frames: dict[int, Image.Image] = {}
    for s in sizes:
        source = master_simple if s <= 32 else master
        frame = source.resize((s, s), Image.LANCZOS)
        frame.save(ICONS / f"icon-{s}.png", optimize=True)
        frames[s] = frame

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    frames[256].save(
        BUILD / "icon.ico",
        format="ICO",
        append_images=[frames[s] for s in ico_sizes[:-1]],
    )

    print(f"wrote {BUILD / 'icon.png'} ({master.width}x{master.height})")
    print(f"wrote {BUILD / 'icon.ico'} ({', '.join(str(s) for s in ico_sizes)})")
    print(f"wrote {len(sizes)} PNGs in {ICONS}")
    print(f"wrote {BUILD / 'icon.svg'}")


if __name__ == "__main__":
    main()
