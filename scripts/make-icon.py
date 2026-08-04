#!/usr/bin/env python3
"""Generate build/icon.ico (and icon.png) without any image libraries.

Windows installers and shortcuts need a multi-resolution .ico. Rather than
committing an opaque binary, the icon is drawn here in a few dozen lines of
arithmetic and regenerated with `npm run icon`.
"""
from __future__ import annotations

import math
import os
import struct
import zlib

SIZES = [16, 24, 32, 48, 64, 128, 256]
# macOS wants a much larger source; electron-builder turns this into an .icns.
MAC_SIZE = 1024
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build")

BG_TOP = (0x2C, 0x6F, 0xE0)
BG_BOTTOM = (0x14, 0x36, 0x8C)
PAPER = (0xF7, 0xFA, 0xFF)
PAPER_EDGE = (0xC9, 0xD8, 0xF0)
INK = (0x2B, 0x36, 0x4B)
MARK = (0xE0, 0x43, 0x3B)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def blend(dst, src, alpha):
    return tuple(round(d + (s - d) * alpha) for d, s in zip(dst, src))


def coverage(px, py, inside, samples=3):
    """Box-filtered coverage of `inside` over one pixel, for cheap anti-aliasing."""
    hits = 0
    for sy in range(samples):
        for sx in range(samples):
            x = px + (sx + 0.5) / samples
            y = py + (sy + 0.5) / samples
            if inside(x, y):
                hits += 1
    return hits / (samples * samples)


def rounded_rect(x0, y0, x1, y1, r):
    def inside(x, y):
        if x < x0 or x > x1 or y < y0 or y > y1:
            return False
        cx = min(max(x, x0 + r), x1 - r)
        cy = min(max(y, y0 + r), y1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    return inside


def draw(size, samples=3):
    """Return RGBA bytes for one square icon."""
    s = size / 256.0
    px = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]

    tile = rounded_rect(6 * s, 6 * s, 250 * s, 250 * s, 48 * s)
    page = rounded_rect(72 * s, 48 * s, 190 * s, 208 * s, 10 * s)

    for y in range(size):
        for x in range(size):
            a = coverage(x, y, tile, samples)
            if a <= 0:
                continue
            base = lerp(BG_TOP, BG_BOTTOM, y / max(1, size - 1))
            colour = base
            alpha = a

            pa = coverage(x, y, page, samples)
            if pa > 0:
                colour = blend(colour, PAPER, pa)

            px[y][x] = (colour[0], colour[1], colour[2], round(alpha * 255))

    # Text lines on the page, plus a red editing stroke across them.
    line_x0, line_x1 = 88 * s, 174 * s
    for i, ly in enumerate((80, 100, 120, 140, 160)):
        y0 = ly * s
        y1 = y0 + max(1.0, 9 * s)
        width = line_x1 if i % 3 else line_x1 - 26 * s
        band = rounded_rect(line_x0, y0, width, y1, 4 * s)
        for y in range(size):
            for x in range(size):
                c = coverage(x, y, band, samples)
                if c <= 0:
                    continue
                r, g, b, a = px[y][x]
                if a == 0:
                    continue
                nr, ng, nb = blend((r, g, b), INK, c * 0.85)
                px[y][x] = (nr, ng, nb, a)

    # A marker pen laid across the lower-right corner of the page. Kept short so
    # it reads as a pen rather than as a "no entry" slash.
    def pen_body(x, y):
        ax, ay, bx, by = 132 * s, 214 * s, 214 * s, 132 * s
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= 11 * s

    def pen_tip(x, y):
        # Triangular nib pointing down-left, at the low end of the body.
        ax, ay = 126 * s, 220 * s
        u = (x - ax) + (y - ay)          # along the pen axis
        v = (x - ax) - (y - ay)          # across it
        return -26 * s <= u <= 6 * s and abs(v) <= (u + 30 * s) * 0.42

    for y in range(size):
        for x in range(size):
            c = coverage(x, y, pen_body, samples)
            tip = coverage(x, y, pen_tip, samples)
            if c <= 0 and tip <= 0:
                continue
            r, g, b, a = px[y][x]
            target = MARK if c >= tip else INK
            cover = max(c, tip)
            base_alpha = max(a, round(cover * 255))
            nr, ng, nb = blend((r, g, b) if a else target, target, cover)
            px[y][x] = (nr, ng, nb, base_alpha)

    # Soften the paper edge so it reads at small sizes.
    edge = rounded_rect(72 * s, 48 * s, 190 * s, 208 * s, 10 * s)
    inner = rounded_rect(72 * s + 1.5 * s, 48 * s + 1.5 * s, 190 * s - 1.5 * s, 208 * s - 1.5 * s, 10 * s)
    for y in range(size):
        for x in range(size):
            c = coverage(x, y, edge, samples) - coverage(x, y, inner, samples)
            if c <= 0.02:
                continue
            r, g, b, a = px[y][x]
            nr, ng, nb = blend((r, g, b), PAPER_EDGE, min(1.0, c))
            px[y][x] = (nr, ng, nb, a)

    out = bytearray()
    for row in px:
        for r, g, b, a in row:
            out += bytes((r, g, b, a))
    return bytes(out)


def png(size, rgba):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter: none
        raw += rgba[y * stride:(y + 1) * stride]

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def ico(images):
    """Pack PNG-compressed entries into an .ico (supported since Windows Vista)."""
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)
    entries = bytearray()
    body = bytearray()
    for size, data in images:
        entries += struct.pack(
            "<BBBBHHII",
            0 if size >= 256 else size,
            0 if size >= 256 else size,
            0,
            0,
            1,
            32,
            len(data),
            offset,
        )
        body += data
        offset += len(data)
    return header + bytes(entries) + bytes(body)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    images = []
    for size in SIZES:
        images.append((size, png(size, draw(size))))
    with open(os.path.join(OUT_DIR, "icon.ico"), "wb") as fh:
        fh.write(ico(images))

    # One sample per pixel is plenty at 1024, and keeps this under a minute.
    with open(os.path.join(OUT_DIR, "icon.png"), "wb") as fh:
        fh.write(png(MAC_SIZE, draw(MAC_SIZE, samples=2)))

    print(f"wrote {OUT_DIR}/icon.ico ({', '.join(str(s) for s in SIZES)})")
    print(f"wrote {OUT_DIR}/icon.png ({MAC_SIZE}x{MAC_SIZE}, for macOS)")


if __name__ == "__main__":
    main()
