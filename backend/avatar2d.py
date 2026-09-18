"""
2D full-body (waist-to-head) sign avatar renderer.

Draws a stylised character (head, torso, two articulated arms) frame by frame with Pillow and
animates BOTH hands per sign. Fingerspelled letters place the real handshape image (dictionary GIF)
on the dominant hand; common words use bimanual keyframe gestures. Frames are stitched by ffmpeg
(see server.build_sign_video) into one continuous MP4/WebM that plays inside the chat bubble.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from PIL import Image, ImageDraw, ImageFont

W = H = 480
FPS = 15
LETTER_SECONDS = 1.1
WORD_SECONDS = 1.6
BG = (13, 14, 18)
FONT_PATH = "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"

# Body landmarks (character centred, waist at the bottom edge, head at the top)
HEAD = (240, 112)
HEAD_R = 58
NECK_Y = 172
SHOULDER_Y = 205
SHOULDER_DX = 78
UPPER_ARM = 92
FOREARM = 92
ARM_W = 30
HAND_R = 24
CHIN = (240, 176)
CHEST = (240, 285)
REST_L = (150, 430)
REST_R = (330, 430)
SPELL_R = (345, 225)  # dominant hand held up beside the shoulder for fingerspelling

Point = Tuple[float, float]


@dataclass(frozen=True)
class Look:
    skin: Tuple[int, int, int]
    hair: Tuple[int, int, int]
    shirt: Tuple[int, int, int]
    hair_style: str  # short | long | bun | curly
    accent: Tuple[int, int, int]


# Visual identity of each presenter (ids match server.AVATARS)
LOOKS: Dict[str, Look] = {
    "m1": Look((224, 172, 132), (48, 34, 26), (255, 87, 34), "short", (255, 255, 255)),
    "m2": Look((198, 140, 100), (20, 20, 24), (38, 70, 120), "short", (255, 255, 255)),
    "m3": Look((240, 200, 170), (150, 95, 50), (30, 140, 90), "curly", (255, 255, 255)),
    "f1": Look((232, 184, 150), (70, 40, 30), (255, 87, 34), "long", (255, 255, 255)),
    "f2": Look((178, 122, 90), (25, 20, 20), (120, 60, 160), "bun", (255, 255, 255)),
    "f3": Look((245, 210, 185), (200, 120, 60), (40, 120, 200), "long", (255, 255, 255)),
}
DEFAULT_LOOK = LOOKS["f1"]


def _lerp(a: Point, b: Point, t: float) -> Point:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _ease(t: float) -> float:
    return 0.5 - 0.5 * math.cos(math.pi * max(0.0, min(1.0, t)))


def _elbow(shoulder: Point, hand: Point, outward: int) -> Point:
    """Two-bone IK: elbow position for an arm reaching `hand`, bending outward (left arm: -1, right: +1)."""
    dx, dy = hand[0] - shoulder[0], hand[1] - shoulder[1]
    d = max(1e-3, min(math.hypot(dx, dy), UPPER_ARM + FOREARM - 1))
    a = (UPPER_ARM**2 - FOREARM**2 + d**2) / (2 * d)
    h = math.sqrt(max(0.0, UPPER_ARM**2 - a**2))
    mx, my = shoulder[0] + a * dx / d, shoulder[1] + a * dy / d
    return (mx - outward * h * dy / d, my + outward * h * dx / d)


def _clamp_reach(shoulder: Point, hand: Point) -> Point:
    dx, dy = hand[0] - shoulder[0], hand[1] - shoulder[1]
    d = math.hypot(dx, dy)
    limit = UPPER_ARM + FOREARM - 6
    if d <= limit:
        return hand
    return (shoulder[0] + dx / d * limit, shoulder[1] + dy / d * limit)


def _font(size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONT_PATH, size)
    except OSError:
        return ImageFont.load_default()


def draw_character(look: Look, left_hand: Point, right_hand: Point, hand_image: Optional[Image.Image] = None,
                   caption: Optional[str] = None, mouth: float = 0.0) -> Image.Image:
    """One frame: full torso + head + both arms. `hand_image` (RGBA, circular) replaces the right hand."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    sl, sr = (HEAD[0] - SHOULDER_DX, SHOULDER_Y), (HEAD[0] + SHOULDER_DX, SHOULDER_Y)
    left_hand = _clamp_reach(sl, left_hand)
    right_hand = _clamp_reach(sr, right_hand)

    # Torso (shirt) and neck
    d.rounded_rectangle([sl[0] - 22, SHOULDER_Y - 18, sr[0] + 22, H + 40], radius=48, fill=look.shirt)
    d.rectangle([HEAD[0] - 18, NECK_Y - 10, HEAD[0] + 18, SHOULDER_Y], fill=look.skin)
    d.polygon([(HEAD[0] - 30, SHOULDER_Y - 18), (HEAD[0] + 30, SHOULDER_Y - 18), (HEAD[0], SHOULDER_Y + 26)], fill=look.skin)

    # Long hair behind the head
    if look.hair_style == "long":
        d.rounded_rectangle([HEAD[0] - HEAD_R - 6, HEAD[1] - HEAD_R, HEAD[0] + HEAD_R + 6, HEAD[1] + HEAD_R + 70], radius=40, fill=look.hair)

    # Arms: shoulder → elbow → hand (upper arm in a darker shirt shade, forearm in skin)
    sleeve = tuple(max(0, c - 28) for c in look.shirt)
    for shoulder, hand, outward in ((sl, left_hand, -1), (sr, right_hand, 1)):
        elbow = _elbow(shoulder, hand, outward)
        d.line([shoulder, elbow], fill=sleeve, width=ARM_W)
        d.ellipse([elbow[0] - ARM_W / 2, elbow[1] - ARM_W / 2, elbow[0] + ARM_W / 2, elbow[1] + ARM_W / 2], fill=sleeve)
        d.line([elbow, hand], fill=look.skin, width=ARM_W - 4)

    # Head + face
    d.ellipse([HEAD[0] - HEAD_R, HEAD[1] - HEAD_R, HEAD[0] + HEAD_R, HEAD[1] + HEAD_R], fill=look.skin)
    if look.hair_style in ("short", "long"):
        d.chord([HEAD[0] - HEAD_R, HEAD[1] - HEAD_R, HEAD[0] + HEAD_R, HEAD[1] + HEAD_R], 180, 360, fill=look.hair)
        d.rectangle([HEAD[0] - HEAD_R, HEAD[1] - 8, HEAD[0] + HEAD_R, HEAD[1]], fill=look.hair)
    elif look.hair_style == "bun":
        d.chord([HEAD[0] - HEAD_R, HEAD[1] - HEAD_R, HEAD[0] + HEAD_R, HEAD[1] + HEAD_R], 190, 350, fill=look.hair)
        d.ellipse([HEAD[0] - 24, HEAD[1] - HEAD_R - 30, HEAD[0] + 24, HEAD[1] - HEAD_R + 12], fill=look.hair)
    else:  # curly
        for i in range(-3, 4):
            cx = HEAD[0] + i * 19
            d.ellipse([cx - 16, HEAD[1] - HEAD_R - 6, cx + 16, HEAD[1] - HEAD_R + 30], fill=look.hair)
    eye_y = HEAD[1] - 4
    for ex in (HEAD[0] - 20, HEAD[0] + 20):
        d.ellipse([ex - 5, eye_y - 5, ex + 5, eye_y + 5], fill=(30, 30, 35))
    d.arc([HEAD[0] - 20, HEAD[1] + 10 - int(6 * mouth), HEAD[0] + 20, HEAD[1] + 34 + int(6 * mouth)], 15, 165, fill=(120, 60, 60), width=4)

    # Hands
    for hand in (left_hand, right_hand):
        d.ellipse([hand[0] - HAND_R, hand[1] - HAND_R, hand[0] + HAND_R, hand[1] + HAND_R], fill=look.skin)
    if hand_image is not None:
        r = hand_image.width // 2
        img.paste(hand_image, (int(right_hand[0] - r), int(right_hand[1] - r)), hand_image)

    # Caption (current sign)
    if caption:
        font = _font(30)
        tw = d.textlength(caption, font=font)
        d.rounded_rectangle([W / 2 - tw / 2 - 18, H - 62, W / 2 + tw / 2 + 18, H - 14], radius=18, fill=(0, 0, 0))
        d.text((W / 2 - tw / 2, H - 56), caption, font=font, fill=look.accent)
    return img


def handshape_image(path: Path, size: int = 132) -> Optional[Image.Image]:
    """Dictionary handshape picture → circular RGBA sticker used as the dominant hand."""
    try:
        src = Image.open(path).convert("RGB")
    except Exception:
        return None
    side = min(src.size)
    src = src.crop(((src.width - side) // 2, (src.height - side) // 2, (src.width + side) // 2, (src.height + side) // 2))
    src = src.resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rd.ellipse([0, 0, size - 1, size - 1], outline=(255, 255, 255), width=4)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(src, (0, 0), mask)
    out.alpha_composite(ring)
    return out


# ---- Bimanual word gestures live in gestures.py (all dictionary words + phrase vocabulary) ----
from gestures import WORD_GESTURES, normalize as normalize_word  # noqa: E402

GENERIC_GESTURE = [(0, REST_L, REST_R), (0.5, (190, 280), (290, 280)), (1, (170, 310), (310, 310))]


def _pose_at(keys: Sequence[Tuple[float, Point, Point]], t: float) -> Tuple[Point, Point]:
    for (t0, l0, r0), (t1, l1, r1) in zip(keys, keys[1:]):
        if t <= t1:
            k = _ease((t - t0) / max(1e-6, t1 - t0))
            return _lerp(l0, l1, k), _lerp(r0, r1, k)
    return keys[-1][1], keys[-1][2]


@dataclass
class Token:
    kind: str  # "letter" | "word"
    label: str
    handshape: Optional[Path] = None  # letter picture for fingerspelling


def render_frames(tokens: Sequence[Token], look: Look, out_dir: Path, intro: bool = True) -> int:
    """Write frame_XXXX.png for the tokens (optional intro + one clip per token + short return to rest). Returns frame count."""
    out_dir.mkdir(parents=True, exist_ok=True)
    idx = 0

    def emit(img: Image.Image) -> None:
        nonlocal idx
        img.save(out_dir / f"frame_{idx:04d}.png")
        idx += 1

    # Intro: neutral pose, small breathing motion
    for f in range(int(0.6 * FPS) if intro else 0):
        b = 3 * math.sin(2 * math.pi * f / FPS)
        emit(draw_character(look, (REST_L[0], REST_L[1] + b), (REST_R[0], REST_R[1] + b)))

    prev_l, prev_r = REST_L, REST_R
    hand_cache: Dict[Path, Optional[Image.Image]] = {}
    for tok in tokens:
        if tok.kind == "letter":
            n = int(LETTER_SECONDS * FPS)
            hand_img = hand_cache.setdefault(tok.handshape, handshape_image(tok.handshape)) if tok.handshape else None
            for f in range(n):
                t = f / max(1, n - 1)
                move = _ease(min(1.0, t / 0.3))  # travel from previous pose to spelling pose
                r = _lerp(prev_r, (SPELL_R[0], SPELL_R[1] + 4 * math.sin(4 * math.pi * t)), move)
                l = _lerp(prev_l, REST_L, move)
                emit(draw_character(look, l, r, hand_img if move >= 0.95 else None, tok.label, mouth=0.3 * math.sin(math.pi * t)))
            prev_l, prev_r = REST_L, SPELL_R
        else:
            keys = WORD_GESTURES.get(normalize_word(tok.label), GENERIC_GESTURE)
            n = int(WORD_SECONDS * FPS)
            for f in range(n):
                t = f / max(1, n - 1)
                l, r = _pose_at(keys, t)
                if t < 0.2:  # blend from the previous pose
                    k = _ease(t / 0.2)
                    l, r = _lerp(prev_l, l, k), _lerp(prev_r, r, k)
                emit(draw_character(look, l, r, None, tok.label, mouth=0.5 * math.sin(math.pi * t)))
            prev_l, prev_r = _pose_at(keys, 1.0)

    # Outro: return to rest
    n = int((0.5 if intro else 0.3) * FPS)
    for f in range(n):
        k = _ease(f / max(1, n - 1))
        emit(draw_character(look, _lerp(prev_l, REST_L, k), _lerp(prev_r, REST_R, k)))
    return idx


def render_portrait(look: Look, path: Path) -> Path:
    """Static preview (gallery / profile): character waving."""
    img = draw_character(look, REST_L, (370, 150))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    return path
