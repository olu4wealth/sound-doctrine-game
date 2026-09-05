#!/usr/bin/env python3
"""Flame-only GIF v2 — warmer, more organic teardrop with turbulent flicker.
64x80 canvas, 12 frames, 2.2s loop at ~75-95ms/frame (breathing, not frantic).
Transparent bg, 72 colors, FASTOCTREE."""
from PIL import Image, ImageDraw
import math, random

W, H = 64, 80
FRAMES = 12
OUT = "assets/flame.gif"
random.seed(13)

# Durations per frame — varied so it doesn't feel metronomic
DURS = [70, 90, 80, 110, 75, 95, 85, 100, 70, 90, 80, 105]

def flame_shape(t):
    # t 0..FRAMES-1
    # Base wobble
    cx = 32 + math.sin(t*1.25 + 0.9)*2.0 + math.sin(t*2.6)*0.7
    # Tip leans left/right
    tip_x = cx + math.sin(t*1.05 + 1.2)*1.8
    tip_y = 6 + math.sin(t*1.4)*1.5 + random.uniform(-0.6, 0.6)
    base_y = 68
    base_w = 15 + math.sin(t*1.0 + 0.3)*1.4
    belly_w = 20 + math.cos(t*0.9 + 0.5)*2.0
    # Build closed polygon with 9 points, teardrop + belly
    pts = [
        (tip_x, tip_y),
        (tip_x + belly_w*0.68, tip_y+16),
        (tip_x + belly_w*0.58, tip_y+28),
        (tip_x + base_w*0.52, base_y-8),
        (tip_x + base_w*0.38, base_y),
        (tip_x - base_w*0.38, base_y),
        (tip_x - base_w*0.50, base_y-8),
        (tip_x - belly_w*0.54, tip_y+28),
        (tip_x - belly_w*0.62, tip_y+16),
    ]
    # center for inset
    return pts, (cx, 38)

def draw_frame(t):
    im = Image.new("RGBA", (W, H), (0,0,0,0))
    d = ImageDraw.Draw(im, "RGBA")
    pts, (cx, cy) = flame_shape(t)
    halo_cx = cx + math.sin(t*0.8)*1.2
    halo_cy = 40
    # Soft halo — 3 concentric ellipses, very low alpha so it tints parchment without boxing
    for r, a in [(24, 10), (18, 16), (12, 22)]:
        d.ellipse([halo_cx - r, halo_cy - r*0.9, halo_cx + r, halo_cy + r*0.9],
                  fill=(255, 184, 64, a))
    # Outer flame — deep amber
    d.polygon(pts, fill=(255, 126, 22, 238))
    # Inset helper
    def inset(points, s, ref_cx=cx, ref_cy=38):
        return [((x - ref_cx)*s + ref_cx, (y - ref_cy)*s + ref_cy) for (x,y) in points]
    # Middle layer — golden
    mid = inset(pts, 0.68)
    d.polygon(mid, fill=(255, 208, 78, 242))
    # Core — near-white, smaller and slightly higher (hottest part is mid)
    core = inset(pts, 0.38)
    # lift core up a bit
    core = [(x, y-6) for (x,y) in core]
    d.polygon(core, fill=(255, 248, 220, 252))
    # Tiny white highlight near tip
    hx = cx + math.sin(t*1.6)*0.9
    hy = 14 + math.cos(t*1.1)*0.8
    d.ellipse([hx-1.4, hy-1.2, hx+1.4, hy+1.6], fill=(255,255,255,210))
    return im

frames = [draw_frame(i) for i in range(FRAMES)]

# Quantize each frame: FASTOCTREE handles RGBA correctly if we keep alpha
# To keep transparency crisp, quantize with 80 colors and dither off for halo softness? Use light dither.
pal_frames = []
for im in frames:
    q = im.quantize(colors=80, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    pal_frames.append(q)

pal_frames[0].save(
    OUT, save_all=True, append_images=pal_frames[1:], duration=DURS, loop=0,
    disposal=2, transparency=0, optimize=True
)
import os
print(f"Wrote {OUT} — {FRAMES}f {W}x{H} total {sum(DURS)}ms loop, {os.path.getsize(OUT)} bytes")
im = Image.open(OUT)
print(f"GIF n_frames={im.n_frames} is_animated={im.is_animated} mode={im.mode} size={im.size}")
