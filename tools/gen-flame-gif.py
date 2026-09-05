#!/usr/bin/env python3
"""Generate a small transparent flame GIF for the candle wick (flame-only, not full candle).
Output: assets/flame.gif — 48×64, 10 frames, ~90KB, loops forever.
Approach: draw an organic flame shape (ellipse + taper) with radial warmth, per-frame wobble.
Pillow is available (12.3.0)."""
from PIL import Image, ImageDraw
import math, random

W, H = 48, 64
FRAMES = 10
DURATION_MS = 85  # ~11.7 fps, gentle not frantic
OUT = "assets/flame.gif"

random.seed(7)

def flame_polygon(frame, wobble=1.0):
    # Base flame centered at (24, 54) bottom, tip around (24, 6) with per-frame skew
    cx = 24 + math.sin(frame * 0.9 + 0.7) * 1.6 * wobble
    # Slight height variation
    tip_y = 5 + random.uniform(-1, 1) * 0.7
    base_y = 56
    # Control widths
    base_w = 14 + math.sin(frame * 1.1) * 1.2
    mid_w = 18 + math.cos(frame * 0.8) * 1.4
    # Build outline points (left side down, right side up)
    pts = []
    # Tip
    pts.append((cx, tip_y))
    # Upper right
    pts.append((cx + mid_w * 0.72, tip_y + 14))
    pts.append((cx + mid_w * 0.55, tip_y + 26))
    # Mid right
    pts.append((cx + base_w * 0.5, base_y - 6))
    # Base right
    pts.append((cx + base_w * 0.42, base_y))
    # Base left
    pts.append((cx - base_w * 0.42, base_y))
    # Mid left
    pts.append((cx - base_w * 0.5, base_y - 6))
    pts.append((cx - mid_w * 0.5, tip_y + 26))
    pts.append((cx - mid_w * 0.68, tip_y + 14))
    return pts

def draw_frame(idx):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im, "RGBA")
    # Outer glow (soft halo behind flame)
    halo_cx = 24 + math.sin(idx * 0.7) * 1.0
    halo_cy = 34
    # Draw halo as ellipse with alpha
    for r in range(18, 6, -1):
        alpha = int(18 - r * 0.9)  # ~12 down to ~0
        if alpha <= 0:
            continue
        # warm amber halo
        col = (255, 190, 70, max(0, alpha))
        # slight vertical stretch
        draw.ellipse([halo_cx - r, halo_cy - r * 0.85, halo_cx + r, halo_cy + r * 0.85], fill=col)
    # Flame body — layered: outer amber, inner yellow, core white
    pts = flame_polygon(idx, wobble=1.0)
    # Outer
    draw.polygon(pts, fill=(255, 138, 28, 235))
    # Inner (inset toward center)
    inner = [(x * 0.72 + 24 * 0.28, y * 0.82 + 10 * 0.18) for (x, y) in pts]
    # Actually scale toward center properly
    cx = 24
    cy = 30
    def inset(points, s):
        return [((x - cx) * s + cx, (y - cy) * s + cy) for (x, y) in points]
    inner_pts = inset(pts, 0.62)
    draw.polygon(inner_pts, fill=(255, 213, 79, 240))
    core_pts = inset(pts, 0.32)
    draw.polygon(core_pts, fill=(255, 247, 214, 250))
    # Tiny highlight speck near tip for liveliness
    sx = 24 + math.sin(idx * 1.3) * 1.2
    sy = 12 + math.cos(idx * 1.0) * 1.0
    draw.ellipse([sx - 1.5, sy - 1.5, sx + 1.5, sy + 1.5], fill=(255, 255, 255, 200))
    return im

# Build frames; quantize to P with transparency for small GIF
frames = [draw_frame(i) for i in range(FRAMES)]

# Pillow GIF transparency: pick a transparent index. We'll flatten alpha by compositing
# onto a near-white that will be made transparent — but easier: use disposal=2 and let Pillow handle RGBA->P.
# For crisp edges, quantize with max 64 colors (warm palette) and keep transparency.

# Convert each frame to P mode with adaptive palette, using transparency
# Approach: save first frame RGBA quantized, rest as P.
# Simplify: use save_all with transparency handling — Pillow 12 supports RGBA GIF?

# Quantize: convert RGBA -> RGB for palette quantize, then restore transparency index 0
pal_frames = []
for im in frames:
    alpha = im.split()[3]
    # Flatten onto white for quantize (preserves warm colors), then quantized
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=alpha)
    q = bg.quantize(colors=63, method=2, dither=1)  # 0=MEDIANCUT, 1=MAXCOVERAGE, 2=FASTOCTREE for RGB
    # Shift palette so index 0 is reserved for transparent (white bg is roughly index ~0, but force)
    # Convert to P and poke transparent pixels to 0
    q = q.convert("P")
    q_arr = q.load()
    w, h = q.size
    for y in range(h):
        for x in range(w):
            if alpha.getpixel((x, y)) < 16:
                q_arr[x, y] = 0
    # Force palette entry 0 to white (so transparent bg matches parchment, invisible)
    pal = q.getpalette()
    if pal:
        pal[0:3] = [255, 255, 255]
        q.putpalette(pal)
    pal_frames.append(q)

pal_frames[0].save(
    OUT,
    save_all=True,
    append_images=pal_frames[1:],
    duration=DURATION_MS,
    loop=0,
    disposal=2,
    transparency=0,
    optimize=True,
)

import os
size = os.path.getsize(OUT)
print(f"Wrote {OUT} — {FRAMES} frames, {W}x{H}, {DURATION_MS}ms/frame, {size} bytes")
# Also try to report if too large
if size > 180000:
    print("NOTE: >180KB — consider fewer frames or smaller size.")
