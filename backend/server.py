from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Response, Request
from fastapi.concurrency import run_in_threadpool
from twilio.rest import Client as TwilioClient
from twilio.base.exceptions import TwilioRestException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import hashlib
import re
import json
import time
from collections import defaultdict
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timedelta, timezone
import jwt

from emergentintegrations.llm.openai import OpenAITextToSpeech, OpenAISpeechToText
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"



# ---- Twilio Verify (real SMS OTP) ----
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_VERIFY_SERVICE_SID = os.environ.get("TWILIO_VERIFY_SERVICE_SID", "")
twilio_client = (
    TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID
    else None
)
# Dev/test bypass: numbers in OTP_TEST_NUMBERS accept OTP_TEST_CODE without sending SMS.
# If OTP_DEV_BYPASS is true and Twilio is NOT configured, every number is treated as a test number.
OTP_DEV_BYPASS = os.environ.get("OTP_DEV_BYPASS", "false").lower() == "true"
OTP_TEST_CODE = os.environ.get("OTP_TEST_CODE", "123456")
OTP_TEST_NUMBERS = {n.strip() for n in os.environ.get("OTP_TEST_NUMBERS", "").split(",") if n.strip()}

def _e164(country_code: str, phone: str) -> str:
    digits = re.sub(r"\D", "", f"{country_code}{phone}")
    if not 7 <= len(digits) <= 15:
        raise HTTPException(400, "Número de teléfono inválido")
    return f"+{digits}"

def _is_test_number(full_phone: str) -> bool:
    if not OTP_DEV_BYPASS:
        return False
    return full_phone in OTP_TEST_NUMBERS or twilio_client is None

if twilio_client:
    logging.info("Twilio Verify configured")
else:
    logging.warning("Twilio Verify NOT configured — %s", "dev bypass active for all numbers" if OTP_DEV_BYPASS else "OTP endpoints will return 503")

# Brute-force protection for OTP verification: max attempts per phone within a window (in-memory).
OTP_MAX_ATTEMPTS = 5
OTP_WINDOW_SECONDS = 600
_otp_attempts: dict = defaultdict(list)

def _otp_throttle(key: str) -> None:
    now = time.time()
    attempts = [t for t in _otp_attempts[key] if now - t < OTP_WINDOW_SECONDS]
    _otp_attempts[key] = attempts
    if len(attempts) >= OTP_MAX_ATTEMPTS:
        raise HTTPException(429, "Too many attempts. Try again later.")

def _otp_record_failure(key: str) -> None:
    _otp_attempts[key].append(time.time())

MAX_AUDIO_BYTES = 10 * 1024 * 1024
ALLOWED_AUDIO_TYPES = {"audio/m4a", "audio/x-m4a", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/aac", "application/octet-stream"}

app = FastAPI()
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

# ------------------- MODELS -------------------

class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    phone: str
    country_code: str
    name: Optional[str] = None
    photo_url: Optional[str] = None
    language: Literal["es", "en"] = "es"
    onboarded: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SendOtpReq(BaseModel):
    phone: str
    country_code: str

class VerifyOtpReq(BaseModel):
    phone: str
    country_code: str
    otp: str

class OnboardReq(BaseModel):
    name: str
    photo_url: Optional[str] = None
    language: Literal["es", "en"] = "es"

class UpdateProfileReq(BaseModel):
    name: Optional[str] = None
    photo_url: Optional[str] = None
    language: Optional[Literal["es", "en"]] = None
    avatar_id: Optional[str] = None

# ------------------- AVATAR CATALOG -------------------
# Presenter avatars (male/female styles). Image = DiceBear PNG; used as the identity card of sign videos.
AVATARS = [
    {"id": "m1", "gender": "male", "name": "Mateo", "style": "Casual", "seed": "Mateo-signbridge"},
    {"id": "m2", "gender": "male", "name": "Diego", "style": "Formal", "seed": "Diego-sb"},
    {"id": "m3", "gender": "male", "name": "Andrés", "style": "Deportivo", "seed": "Andres-sb"},
    {"id": "f1", "gender": "female", "name": "Sofía", "style": "Casual", "seed": "Sofia-signbridge"},
    {"id": "f2", "gender": "female", "name": "Valeria", "style": "Formal", "seed": "Valeria-sb"},
    {"id": "f3", "gender": "female", "name": "Camila", "style": "Deportivo", "seed": "Camila-sb"},
]
DEFAULT_AVATAR_ID = "f1"
# Free plan: only one male + one female presenter. Premium unlocks the whole gallery.
FREE_AVATAR_IDS = {"m1", "f1"}

def _is_premium(user: Optional[dict]) -> bool:
    return bool(user and user.get("is_premium"))

def _avatar_view(a: dict, user: Optional[dict] = None) -> dict:
    return {**{k: v for k, v in a.items() if k != "seed"},
            "locked": a["id"] not in FREE_AVATAR_IDS and not _is_premium(user),
            "image_url": f"/api/media/avatars/{a['id']}.png"}

def _avatar_by_id(avatar_id: Optional[str]) -> dict:
    return next((a for a in AVATARS if a["id"] == avatar_id), next(a for a in AVATARS if a["id"] == DEFAULT_AVATAR_ID))

class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    direction: Literal["sign_to_text", "text_to_sign", "voice_to_text"]
    language: Literal["es", "en"]
    original_text: Optional[str] = None
    translated_text: str
    sign_sequence: Optional[List[str]] = None  # letters/words to animate
    audio_url: Optional[str] = None
    video_url: Optional[str] = None  # server-rendered avatar sign video (MP4)
    avatar_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SignToTextReq(BaseModel):
    language: Literal["es", "en"] = "es"
    # Sequence of signs recognized frame-by-frame by the vision model (letters and/or words)
    signs: List[str] = Field(default_factory=list, max_length=120)

class SignFrameReq(BaseModel):
    # Ordered burst of 1-5 key frames (base64 JPEG/PNG) captured at 2-3 fps; chronological order matters
    frames: List[str] = Field(default_factory=list, max_length=5)
    image_base64: Optional[str] = Field(default=None, max_length=4_000_000)  # legacy single frame
    language: Literal["es", "en"] = "es"
    previous: List[str] = Field(default_factory=list, max_length=20)

class TextToSignReq(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    language: Literal["es", "en"] = "es"

class TtsReq(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    voice: Literal["nova", "alloy", "echo", "fable", "onyx", "shimmer"] = "nova"

# ------------------- AUTH HELPERS -------------------

def make_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

async def get_current_user(cred: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    if not cred:
        raise HTTPException(401, "Missing token")
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload["sub"]
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    return user

async def get_optional_user(cred: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Optional[dict]:
    if not cred:
        return None
    try:
        return await get_current_user(cred)
    except HTTPException:
        return None

# ------------------- AUTH -------------------

@api_router.post("/auth/send-otp")
async def send_otp(req: SendOtpReq):
    full_phone = _e164(req.country_code, req.phone)
    if _is_test_number(full_phone):
        return {"success": True, "message": "OTP sent", "mode": "test"}
    if not twilio_client:
        raise HTTPException(503, "SMS service not configured")
    try:
        verification = await run_in_threadpool(
            lambda: twilio_client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID).verifications.create(to=full_phone, channel="sms")
        )
    except TwilioRestException as e:
        logging.warning(f"Twilio send error {e.code}: {e.msg}")
        if e.code in (60200, 21211, 21614):
            raise HTTPException(400, "Número de teléfono inválido")
        if e.code == 60203:
            raise HTTPException(429, "Demasiados envíos. Espera unos minutos.")
        if e.code == 21608:
            raise HTTPException(400, "Número no verificado en la cuenta de prueba de Twilio")
        raise HTTPException(424, "No se pudo enviar el SMS. Inténtalo de nuevo.")
    return {"success": True, "message": "OTP sent", "mode": "sms", "status": verification.status}

@api_router.post("/auth/verify-otp")
async def verify_otp(req: VerifyOtpReq):
    full_phone = _e164(req.country_code, req.phone)
    _otp_throttle(full_phone)
    if _is_test_number(full_phone):
        approved = req.otp == OTP_TEST_CODE
    else:
        if not twilio_client:
            raise HTTPException(503, "SMS service not configured")
        try:
            check = await run_in_threadpool(
                lambda: twilio_client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID).verification_checks.create(to=full_phone, code=req.otp)
            )
            approved = check.status == "approved"
        except TwilioRestException as e:
            logging.warning(f"Twilio check error {e.code}: {e.msg}")
            if e.code == 20404:
                raise HTTPException(400, "El código expiró. Solicita uno nuevo.")
            if e.code == 60202:
                raise HTTPException(429, "Demasiados intentos. Solicita un código nuevo.")
            raise HTTPException(424, "No se pudo verificar el código. Inténtalo de nuevo.")
    if not approved:
        _otp_record_failure(full_phone)
        raise HTTPException(400, "Invalid OTP")
    _otp_attempts.pop(full_phone, None)
    user = await db.users.find_one({"phone": full_phone}, {"_id": 0})
    if not user:
        u = User(phone=full_phone, country_code=req.country_code)
        await db.users.insert_one(u.model_dump())
        user = u.model_dump()
    token = make_token(user["id"])
    return {"token": token, "user": _user_safe(user), "new_user": not user.get("onboarded")}

def _user_safe(u: dict) -> dict:
    return {k: v for k, v in u.items() if k != "_id"}

@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return _user_safe(user)

@api_router.post("/auth/onboard")
async def onboard(req: OnboardReq, user=Depends(get_current_user)):
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"name": req.name, "photo_url": req.photo_url, "language": req.language, "onboarded": True}},
    )
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return _user_safe(updated)

@api_router.patch("/auth/profile")
async def update_profile(req: UpdateProfileReq, user=Depends(get_current_user)):
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    if "avatar_id" in updates and not any(a["id"] == updates["avatar_id"] for a in AVATARS):
        raise HTTPException(400, "Unknown avatar")
    if "avatar_id" in updates and updates["avatar_id"] not in FREE_AVATAR_IDS and not _is_premium(user):
        raise HTTPException(403, "Este avatar es exclusivo de SignBridge Premium")
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return _user_safe(updated)

@api_router.get("/avatars")
async def list_avatars(gender: Optional[Literal["male", "female"]] = None, user=Depends(get_optional_user)):
    items = [_avatar_view(a, user) for a in AVATARS if not gender or a["gender"] == gender]
    return {"items": items, "default_id": DEFAULT_AVATAR_ID, "free_ids": sorted(FREE_AVATAR_IDS), "is_premium": _is_premium(user)}

# ------------------- BILLING / PREMIUM PLAN -------------------
# Store products (create these SAME ids in Google Play / App Store). Purchases will be wired through
# RevenueCat later; until then, PREMIUM_DEV_MODE lets testers activate Premium without paying.
PREMIUM_PLANS = [
    {"id": "monthly", "product_id": "signbridge_premium_monthly", "period": "P1M",
     "price_mxn": 79, "price_usd": 3.99, "trial_days": 0, "best_value": False},
    {"id": "yearly", "product_id": "signbridge_premium_yearly", "period": "P1Y",
     "price_mxn": 599, "price_usd": 29.99, "trial_days": 7, "best_value": True},
]
FREE_LIMITS = {"sign_record_seconds": 15, "ad_every_messages": 10, "avatars": sorted(FREE_AVATAR_IDS)}
PREMIUM_LIMITS = {"sign_record_seconds": 60, "ad_every_messages": 0, "avatars": [a["id"] for a in AVATARS]}
PREMIUM_DEV_MODE = os.environ.get("PREMIUM_DEV_MODE", "false").lower() == "true"

class ActivateTestReq(BaseModel):
    plan: Literal["monthly", "yearly"] = "yearly"

def _billing_status(user: dict) -> dict:
    premium = _is_premium(user)
    return {
        "is_premium": premium,
        "plan": user.get("premium_plan"),
        "premium_since": user.get("premium_since"),
        "trial_ends_at": user.get("trial_ends_at"),
        "source": user.get("premium_source"),
        "limits": PREMIUM_LIMITS if premium else FREE_LIMITS,
        "dev_mode": PREMIUM_DEV_MODE,
    }

@api_router.get("/billing/plans")
async def billing_plans():
    return {"plans": PREMIUM_PLANS, "free_limits": FREE_LIMITS, "premium_limits": PREMIUM_LIMITS, "dev_mode": PREMIUM_DEV_MODE}

@api_router.get("/billing/status")
async def billing_status(user=Depends(get_current_user)):
    return _billing_status(user)

@api_router.post("/billing/activate-test")
async def billing_activate_test(req: ActivateTestReq, user=Depends(get_current_user)):
    """Dev/test only: activate Premium without a store purchase (mirrors what the RevenueCat hook will do)."""
    if not PREMIUM_DEV_MODE:
        raise HTTPException(403, "Test activation is disabled")
    plan = next(p for p in PREMIUM_PLANS if p["id"] == req.plan)
    now = datetime.now(timezone.utc)
    updates = {"is_premium": True, "premium_plan": plan["id"], "premium_since": now.isoformat(), "premium_source": "test",
               "trial_ends_at": (now + timedelta(days=plan["trial_days"])).isoformat() if plan["trial_days"] else None}
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    return _billing_status({**user, **updates})

@api_router.post("/billing/deactivate-test")
async def billing_deactivate_test(user=Depends(get_current_user)):
    if not PREMIUM_DEV_MODE:
        raise HTTPException(403, "Test activation is disabled")
    updates = {"is_premium": False, "premium_plan": None, "premium_since": None, "premium_source": None, "trial_ends_at": None}
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    return _billing_status({**user, **updates})

# ------------------- SIGN VIDEO RENDERING (ffmpeg) -------------------

import subprocess, shutil, urllib.request
import imageio_ffmpeg
import avatar2d
import gestures

FFMPEG = shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe()
MEDIA_DIR = ROOT_DIR / "media"
GIF_CACHE = MEDIA_DIR / "gifs"
VIDEO_DIR = MEDIA_DIR / "videos"
for _d in (GIF_CACHE, VIDEO_DIR):
    _d.mkdir(parents=True, exist_ok=True)
MAX_VIDEO_SIGNS = 24

def _download(url: str, dest: Path) -> Path:
    if not dest.exists() or dest.stat().st_size == 0:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 SignBridge"})
        with urllib.request.urlopen(req, timeout=20) as r, open(dest, "wb") as f:
            f.write(r.read())
    return dest

def _render_sign_video(tokens: List[avatar2d.Token], avatar: dict, out_path: Path) -> None:
    """Render the 2D full-body avatar frames for the whole message and encode ONE continuous MP4 (+ WebM twin)."""
    work = out_path.parent / f"tmp-{out_path.stem}"
    shutil.rmtree(work, ignore_errors=True)
    try:
        count = avatar2d.render_frames(tokens, avatar2d.LOOKS.get(avatar["id"], avatar2d.DEFAULT_LOOK), work)
        if count == 0:
            raise RuntimeError("No frames rendered")
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-framerate", str(avatar2d.FPS), "-i", str(work / "frame_%04d.png"),
                        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(out_path)],
                       check=True, timeout=180)
        if not out_path.exists() or out_path.stat().st_size == 0:
            raise RuntimeError("Rendered video is empty (0 KB)")
        # WebM (VP8) twin for web browsers without H.264 support; native players use the MP4.
        webm = out_path.with_suffix(".webm")
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(out_path), "-c:v", "libvpx", "-b:v", "500k",
                        "-deadline", "realtime", "-cpu-used", "8", "-an", str(webm)], check=True, timeout=180)
        if not webm.exists() or webm.stat().st_size == 0:
            raise RuntimeError("Rendered webm is empty (0 KB)")
    finally:
        shutil.rmtree(work, ignore_errors=True)

async def _tokenize_for_signs(text: str, language: str) -> List[avatar2d.Token]:
    """Greedy longest-match of phrases/words against the bimanual gesture library (accent-insensitive);
    function words are dropped (as in sign language); only unknown words (names…) are fingerspelled
    with the dictionary handshape picture on the dominant hand."""
    words = [w for w in re.split(r"[^\wáéíóúüñÁÉÍÓÚÜÑ']+", text) if w]
    norm = [gestures.normalize(w) for w in words]
    letters_needed = {c.upper() for w in words for c in w if c.isalpha()}
    entries = await db.dictionary.find({"language": language, "kind": "letter", "label": {"$in": sorted(letters_needed)}}, {"_id": 0}).to_list(100)
    by_label = {e["label"].upper(): e for e in entries}
    tokens: List[avatar2d.Token] = []
    signs = 0
    i = 0
    while i < len(words) and signs < MAX_VIDEO_SIGNS:
        matched = False
        for n in range(min(gestures.MAX_PHRASE_WORDS, len(words) - i), 0, -1):
            key = " ".join(norm[i:i + n])
            if key in gestures.WORD_GESTURES:
                tokens.append(avatar2d.Token("word", " ".join(words[i:i + n]).lower()))
                signs += 1
                i += n
                matched = True
                break
        if matched:
            continue
        w = words[i]
        i += 1
        if norm[i - 1] in gestures.STOPWORDS:
            continue
        for c in w:
            if not c.isalpha() or signs >= MAX_VIDEO_SIGNS:
                continue
            e = by_label.get(c.upper()) or by_label.get(c.upper().replace("Ñ", "N"))
            url = (e or {}).get("gif_url") or (e or {}).get("image_url")
            path = None
            if url:
                try:
                    path = await run_in_threadpool(_download, url, GIF_CACHE / f"{hashlib.sha1(url.encode()).hexdigest()}{Path(url).suffix or '.gif'}")
                except Exception as ex:
                    logging.warning(f"handshape download failed for {c}: {ex}")
            tokens.append(avatar2d.Token("letter", c.upper(), path))
            signs += 1
    return tokens

async def build_sign_video(text: str, language: str, avatar_id: Optional[str], priority: bool = False) -> Optional[str]:
    """Returns /api/media/videos/<key>.mp4 for the message, rendering (2D full-body avatar) and caching it on first use.
    Premium (priority=True) renders immediately; free renders wait in a single-slot queue."""
    avatar = _avatar_by_id(avatar_id)
    tokens = await _tokenize_for_signs(text, language)
    if not tokens:
        return None
    sig = "|".join(f"{t.kind}:{t.label}:{t.handshape.name if t.handshape else '-'}" for t in tokens)
    key = hashlib.sha256(f"v2|{language}|{avatar['id']}|{sig}".encode()).hexdigest()[:32]
    out = VIDEO_DIR / f"{key}.mp4"

    def _missing() -> bool:
        return not out.exists() or out.stat().st_size == 0 or not out.with_suffix(".webm").exists()

    if _missing():
        if priority:
            await run_in_threadpool(_render_sign_video, tokens, avatar, out)
        else:
            async with _free_render_queue:
                if _missing():
                    await run_in_threadpool(_render_sign_video, tokens, avatar, out)
    return f"/api/media/videos/{key}.mp4"

AVATAR_PORTRAIT_DIR = MEDIA_DIR / "avatars"

@api_router.get("/media/avatars/{avatar_id}.png")
async def get_avatar_portrait(avatar_id: str):
    look = avatar2d.LOOKS.get(avatar_id)
    if not look:
        raise HTTPException(404, "Not found")
    path = AVATAR_PORTRAIT_DIR / f"{avatar_id}-v2.png"
    if not path.exists() or path.stat().st_size == 0:
        await run_in_threadpool(avatar2d.render_portrait, look, path)
    return Response(content=path.read_bytes(), media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})

import asyncio
_free_render_queue = asyncio.Semaphore(1)

@api_router.get("/media/videos/{name}")
async def get_video(name: str, request: Request):
    if not re.fullmatch(r"[a-f0-9]{32}\.(mp4|webm)", name):
        raise HTTPException(404, "Not found")
    path = VIDEO_DIR / name
    if not path.exists() or path.stat().st_size == 0:
        raise HTTPException(404, "Not found")
    media_type = "video/webm" if name.endswith(".webm") else "video/mp4"
    size = path.stat().st_size
    headers = {"Cache-Control": "public, max-age=31536000", "Accept-Ranges": "bytes"}
    range_header = request.headers.get("range")
    m = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header or "")
    if m and (m.group(1) or m.group(2)):
        # Byte-range support so native/web players can seek and probe the file.
        start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2)))
        end = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            raise HTTPException(416, "Range not satisfiable")
        with open(path, "rb") as f:
            f.seek(start)
            chunk = f.read(end - start + 1)
        headers.update({"Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(len(chunk))})
        return Response(content=chunk, status_code=206, media_type=media_type, headers=headers)
    headers["Content-Length"] = str(size)
    return Response(content=path.read_bytes(), media_type=media_type, headers=headers)

# ------------------- DICTIONARY -------------------

# Public GIF sources for sign language alphabets
ASL_GIF_BASE = "https://www.lifeprint.com/asl101/fingerspelling/abc-gifs/"
LSM_IMG_BASE = "https://upload.wikimedia.org/wikipedia/commons/thumb"

def _seed_dictionary_data():
    """A-Z alphabet entries for LSM (Spanish/Mexican) and ASL (English)."""
    entries = []
    # ASL letters use lifeprint's public GIFs (works for demo)
    asl_desc = {
        "A": "Closed fist, thumb resting on the side of the index finger.",
        "B": "Flat hand, fingers together and thumb tucked across the palm.",
        "C": "Curve your hand into the shape of the letter C.",
        "D": "Index finger straight up, other fingers touching the thumb.",
        "E": "Curl your fingers inward, thumb tucked under.",
        "F": "Touch the tip of the thumb and index finger, other fingers up.",
        "G": "Point index finger and thumb horizontally forward.",
        "H": "Index and middle fingers extended horizontally together.",
        "I": "Pinky finger up, other fingers closed.",
        "J": "Pinky finger traces a J shape in the air.",
        "K": "Index up, middle finger angled, thumb between them.",
        "L": "L-shape with thumb and index finger.",
        "M": "Three fingers folded over the thumb.",
        "N": "Two fingers folded over the thumb.",
        "O": "Fingers and thumb touch to form an O.",
        "P": "Like K but pointing downward.",
        "Q": "Like G but pointing downward.",
        "R": "Cross the index and middle fingers.",
        "S": "Closed fist, thumb across the fingers.",
        "T": "Fist with thumb between index and middle finger.",
        "U": "Index and middle fingers extended up together.",
        "V": "Index and middle fingers extended in a V.",
        "W": "Three middle fingers extended up.",
        "X": "Hook the index finger.",
        "Y": "Thumb and pinky extended, other fingers closed.",
        "Z": "Trace a Z in the air with the index finger.",
    }
    for letter, desc in asl_desc.items():
        entries.append({
            "id": f"asl-{letter.lower()}",
            "language": "en",
            "label": letter,
            "kind": "letter",
            "description": desc,
            "gif_url": f"{ASL_GIF_BASE}{letter.lower()}.gif",
            "image_url": f"{ASL_GIF_BASE}{letter.lower()}.gif",
        })

    lsm_desc = {
        "A": "Puño cerrado con el pulgar al costado del dedo índice.",
        "B": "Mano plana, dedos juntos y pulgar cruzado en la palma.",
        "C": "Forma la letra C con la mano curvada.",
        "D": "Índice hacia arriba, otros dedos tocan el pulgar.",
        "E": "Dedos curvados hacia adentro, pulgar por debajo.",
        "F": "Punta del pulgar toca la del índice, otros dedos arriba.",
        "G": "Índice y pulgar apuntan horizontalmente hacia adelante.",
        "H": "Índice y medio extendidos juntos horizontalmente.",
        "I": "Meñique arriba, otros dedos cerrados.",
        "J": "El meñique dibuja una J en el aire.",
        "K": "Índice arriba, medio inclinado, pulgar entre ellos.",
        "L": "Forma L con pulgar e índice.",
        "M": "Tres dedos doblados sobre el pulgar.",
        "N": "Dos dedos doblados sobre el pulgar.",
        "Ñ": "Como la N pero moviendo la mano en zigzag.",
        "O": "Dedos y pulgar se tocan formando una O.",
        "P": "Como K pero apuntando hacia abajo.",
        "Q": "Como G pero apuntando hacia abajo.",
        "R": "Cruza el índice y el medio.",
        "S": "Puño cerrado, pulgar cruzado sobre los dedos.",
        "T": "Puño con el pulgar entre índice y medio.",
        "U": "Índice y medio extendidos juntos hacia arriba.",
        "V": "Índice y medio extendidos en V.",
        "W": "Tres dedos centrales extendidos hacia arriba.",
        "X": "Gancho con el dedo índice.",
        "Y": "Pulgar y meñique extendidos, otros cerrados.",
        "Z": "Dibuja una Z en el aire con el índice.",
    }
    for letter, desc in lsm_desc.items():
        # Use same ASL gif as visual (many LSM letters are similar)
        code = letter.lower().replace("ñ", "n")
        entries.append({
            "id": f"lsm-{letter.lower()}",
            "language": "es",
            "label": letter,
            "kind": "letter",
            "description": desc,
            "gif_url": f"{ASL_GIF_BASE}{code}.gif",
            "image_url": f"{ASL_GIF_BASE}{code}.gif",
        })

    # Common words
    common_words_en = [
        ("Hello", "Wave hand near the forehead as if saluting."),
        ("Thank you", "Touch chin with fingertips and move hand forward."),
        ("Yes", "Make an S-hand and nod it up and down."),
        ("No", "Snap index and middle fingers against the thumb."),
        ("Please", "Flat hand circles on the chest."),
        ("Sorry", "Closed fist circles on the chest."),
        ("Love", "Cross both fists over the chest."),
        ("Friend", "Interlock both curled index fingers."),
        ("Good morning", "Flat hand from chin forward, then the other arm rises like the sun."),
        ("Good night", "Flat hand from chin forward, then one hand lowers over the other like the sunset."),
        ("Goodbye", "Open hand waves side to side at shoulder height."),
        ("Family", "Two F-hands start together and circle outward until pinkies touch."),
        ("Mom", "Open hand with thumb tapping the chin."),
        ("Dad", "Open hand with thumb tapping the forehead."),
        ("House", "Flat hands trace a roof and walls in the air."),
        ("Eat", "Flattened O-hand taps the mouth a couple of times."),
        ("Drink", "C-hand tilts toward the mouth as if drinking from a cup."),
        ("Water", "W-hand taps the chin twice."),
        ("Help", "Fist with thumb up rests on the flat palm; both lift upward."),
        ("Work", "Fists stacked; the top one taps the bottom wrist twice."),
        ("School", "Clap flat hands twice, dominant hand on top."),
        ("Today", "Y-hands drop down together in front of the body."),
        ("Tomorrow", "Thumb of an A-hand on the cheek moves forward."),
        ("Yesterday", "Thumb of an A-hand on the cheek moves back toward the ear."),
        ("Good", "Flat hand from the chin moves down onto the other palm."),
        ("Bad", "Flat hand from the chin flips down, palm facing away."),
        ("Happy", "Flat hands brush upward on the chest twice."),
        ("Sad", "Both open hands slide down in front of the face."),
        ("Doctor", "Fingertips tap the inside of the opposite wrist, like checking a pulse."),
        ("Money", "Flattened O-hand taps the open palm twice."),
        ("Time", "Index finger taps the back of the opposite wrist, like a watch."),
        ("Name", "H-hands cross and tap twice."),
        ("Understand", "Index finger flicks up near the forehead."),
        ("Learn", "Fingers pick up from the palm and move to the forehead."),
        ("Bathroom", "T-hand shakes side to side."),
        ("Phone", "Y-hand held against the cheek like a telephone."),
        ("Tired", "Bent hands on the chest drop down and outward."),
        ("Slow", "One hand slides slowly up the back of the other hand."),
    ]
    common_words_es = [
        ("Hola", "Saludo con la mano cerca de la frente."),
        ("Gracias", "Toca la barbilla con las yemas y mueve la mano hacia adelante."),
        ("Sí", "Puño cerrado moviéndose de arriba a abajo."),
        ("No", "Chasquea el índice y el medio contra el pulgar."),
        ("Por favor", "Mano plana haciendo círculos en el pecho."),
        ("Perdón", "Puño cerrado haciendo círculos en el pecho."),
        ("Amor", "Cruza los puños sobre el pecho."),
        ("Amigo", "Entrelaza los índices curvados."),
        ("Buenos días", "Mano plana desde la barbilla hacia adelante y el otro brazo sube como el sol."),
        ("Buenas noches", "Mano plana desde la barbilla y luego una mano baja sobre la otra como el atardecer."),
        ("Adiós", "Mano abierta se agita de lado a lado a la altura del hombro."),
        ("Familia", "Dos manos en F juntas giran hacia afuera hasta que los meñiques se tocan."),
        ("Mamá", "Mano abierta con el pulgar tocando la barbilla."),
        ("Papá", "Mano abierta con el pulgar tocando la frente."),
        ("Casa", "Manos planas dibujan el techo y las paredes en el aire."),
        ("Comer", "Mano en O aplanada toca la boca un par de veces."),
        ("Beber", "Mano en C se inclina hacia la boca como tomando de un vaso."),
        ("Agua", "Mano en W toca la barbilla dos veces."),
        ("Ayuda", "Puño con pulgar arriba sobre la palma abierta; ambas suben."),
        ("Trabajo", "Puños apilados; el de arriba golpea la muñeca de abajo dos veces."),
        ("Escuela", "Aplaude dos veces con las manos planas, la dominante encima."),
        ("Hoy", "Manos en Y bajan juntas frente al cuerpo."),
        ("Mañana", "Pulgar de la mano en A en la mejilla avanza hacia adelante."),
        ("Ayer", "Pulgar de la mano en A en la mejilla retrocede hacia la oreja."),
        ("Bien", "Mano plana desde la barbilla baja sobre la otra palma."),
        ("Mal", "Mano plana desde la barbilla gira hacia abajo con la palma hacia afuera."),
        ("Feliz", "Manos planas rozan el pecho hacia arriba dos veces."),
        ("Triste", "Ambas manos abiertas bajan frente a la cara."),
        ("Doctor", "Las yemas tocan la muñeca contraria como tomando el pulso."),
        ("Dinero", "Mano en O aplanada golpea la palma abierta dos veces."),
        ("Tiempo", "El índice toca el dorso de la muñeca contraria como un reloj."),
        ("Nombre", "Manos en H se cruzan y tocan dos veces."),
        ("Entender", "El índice se levanta rápido cerca de la frente."),
        ("Aprender", "Los dedos recogen de la palma y suben a la frente."),
        ("Baño", "Mano en T se sacude de lado a lado."),
        ("Teléfono", "Mano en Y apoyada en la mejilla como un teléfono."),
        ("Cansado", "Manos curvadas en el pecho caen hacia abajo y afuera."),
        ("Despacio", "Una mano se desliza lentamente por el dorso de la otra."),
    ]
    WORD_EMOJI = [
        "🙋", "🙏", "👍", "👎", "🤲", "😔", "❤️", "🤝",
        "🌅", "🌙", "👋", "👨‍👩‍👧", "👩", "👨", "🏠", "🍽️", "🥤", "💧",
        "🆘", "💼", "🏫", "📅", "⏭️", "⏮️", "😊", "😠", "😄", "😢",
        "🩺", "💰", "⏰", "🪪", "💡", "📚", "🚻", "📱", "🥱", "🐢",
    ]
    for i, (w, d) in enumerate(common_words_en):
        entries.append({
            "id": f"asl-w-{i}",
            "language": "en",
            "label": w,
            "kind": "word",
            "description": d,
            "emoji": WORD_EMOJI[i],
            "gif_url": None,
            "image_url": "https://images.unsplash.com/photo-1585577028863-35a3349c60db?w=400",
        })
    for i, (w, d) in enumerate(common_words_es):
        entries.append({
            "id": f"lsm-w-{i}",
            "language": "es",
            "label": w,
            "kind": "word",
            "description": d,
            "emoji": WORD_EMOJI[i],
            "gif_url": None,
            "image_url": "https://images.unsplash.com/photo-1585577028863-35a3349c60db?w=400",
        })
    return entries

@app.on_event("startup")
async def seed():
    from pymongo import UpdateOne
    entries = _seed_dictionary_data()
    ops = [UpdateOne({"id": e["id"]}, {"$set": e}, upsert=True) for e in entries]
    res = await db.dictionary.bulk_write(ops)
    logging.info(f"Dictionary seed: {res.upserted_count} inserted, {res.modified_count} updated")
    # UserContacts collection (Contacts Manager) — ensure it exists with its indexes
    await db.UserContacts.create_index([("owner_user_id", 1), ("profileId", 1)])
    await db.UserContacts.create_index([("owner_user_id", 1), ("lastSyncDate", -1)])
    # Chat 1:1
    await db.conversations.create_index("key", unique=True)
    await db.conversations.create_index([("participants", 1), ("updated_at", -1)])
    await db.chat_messages.create_index([("conversation_id", 1), ("created_at", 1)])

@api_router.get("/dictionary")
async def get_dictionary(language: Optional[str] = None, q: Optional[str] = None, letter: Optional[str] = None):
    query = {}
    if language:
        query["language"] = language
    if letter:
        query["label"] = {"$regex": f"^{re.escape(letter)}", "$options": "i"}
    if q:
        query["label"] = {"$regex": re.escape(q), "$options": "i"}
    items = await db.dictionary.find(query, {"_id": 0}).sort("label", 1).to_list(500)
    return items

@api_router.get("/dictionary/{entry_id}")
async def get_dictionary_entry(entry_id: str):
    item = await db.dictionary.find_one({"id": entry_id}, {"_id": 0})
    if not item:
        raise HTTPException(404, "Not found")
    return item

# ------------------- TRANSLATION -------------------

VISION_MODEL = ("openai", "gpt-5.4")

def _sign_vocabulary(language: str) -> List[str]:
    """Words/phrases the camera should recognise as whole signs (dictionary words + phrase vocabulary)."""
    dictionary = [e["label"] for e in _seed_dictionary_data() if e["language"] == language and e["kind"] == "word"]
    extra_es = ["por favor", "mucho gusto", "hasta luego", "te quiero", "cuánto", "dónde", "cómo", "necesito", "puedes", "repetir",
                "escribir", "sordo", "señas", "hablar", "momento", "beber", "lengua de señas", "quién", "cuándo"]
    extra_en = ["please", "nice to meet", "see you later", "i love you", "how much", "where", "how", "need", "can", "repeat",
                "write", "deaf", "sign language", "speak", "moment", "who", "when", "what"]
    seen, out = set(), []
    for w in dictionary + (extra_es if language == "es" else extra_en):
        k = w.lower()
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out

def _sign_system_prompt(language: str) -> str:
    lang_name = "Mexican Sign Language (LSM)" if language == "es" else "American Sign Language (ASL)"
    text_lang = "Spanish" if language == "es" else "English"
    vocab = ", ".join(_sign_vocabulary(language))
    return (
        f"You are a {lang_name} recognition model. You receive an ORDERED burst of camera frames (chronological, "
        "captured at 2-3 frames per second, about 1-2 seconds total) of a person performing ONE sign. "
        "Analyze the frames as a temporal sequence: compare hand shape, position and movement of BOTH hands across frames. "
        "Distinguish STATIC fingerspelling (one hand held still, e.g. letter 'W') from DYNAMIC lexical signs with movement "
        f"(e.g. '{'agua' if language == 'es' else 'water'}': W-hand tapping the chin twice; '{'gracias' if language == 'es' else 'thank you'}': flat hand from the chin forward). "
        "Rule: if the hand is held STILL across the frames (no movement, one hand), it is FINGERSPELLING → return the single letter. "
        "Return a WORD or PHRASE only when you see its characteristic movement, location (chin, chest, forehead…) or a two-handed configuration; "
        "when a static handshape is ambiguous between a letter and a word, choose the letter. "
        f"Identify a fingerspelled letter (A-Z{', plus Ñ' if language == 'es' else ''}) or one of these {text_lang} words/phrases: {vocab}. "
        "If no hand or no clear sign is visible in the frames, return null. Never guess when the hands are not visible. "
        'Respond ONLY with compact JSON: {"sign": "<letter or word/phrase or null>", "confidence": <0.0-1.0>, "motion": "static"|"dynamic"|"none"}'
    )

def _parse_sign_json(raw: str) -> dict:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.S)
        data = json.loads(m.group(0)) if m else {}
    sign = data.get("sign")
    if isinstance(sign, str):
        sign = sign.strip()
        if not sign or sign.lower() in ("null", "none", "unknown"):
            sign = None
    else:
        sign = None
    try:
        confidence = max(0.0, min(1.0, float(data.get("confidence", 0))))
    except (TypeError, ValueError):
        confidence = 0.0
    motion = data.get("motion") if data.get("motion") in ("static", "dynamic", "none") else ("none" if sign is None else "static")
    return {"sign": sign, "confidence": confidence, "motion": motion}

def _strip_data_url(b64: str) -> str:
    return b64.split(",", 1)[1] if b64.startswith("data:") else b64

@api_router.post("/translate/sign-frame")
async def sign_frame(req: SignFrameReq, user=Depends(get_current_user)):
    """Recognize the sign performed across an ordered burst of frames using the vision model."""
    frames = [f for f in (req.frames or ([req.image_base64] if req.image_base64 else [])) if f and len(f) >= 100]
    if not frames:
        raise HTTPException(422, "At least one frame is required")
    prev = ", ".join(req.previous[-5:]) or "none"
    prompt = (
        f"Previously detected signs in this sequence: {prev}. "
        f"Here are {len(frames)} frames in chronological order (frame 1 first). Identify the single sign performed."
    )
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"sign-{user['id']}-{uuid.uuid4()}",
            system_message=_sign_system_prompt(req.language),
        ).with_model(*VISION_MODEL)
        raw = await chat.send_message(
            UserMessage(text=prompt, file_contents=[ImageContent(image_base64=_strip_data_url(f)) for f in frames])
        )
    except Exception as e:
        logging.warning(f"Vision model error: {e}")
        raise HTTPException(424, "Sign recognition service unavailable")
    result = _parse_sign_json(raw)
    if result["sign"] and len(result["sign"]) == 1:
        result["sign"] = result["sign"].upper()
    result["frames_analyzed"] = len(frames)
    return result

def _compose_sentence(signs: List[str], language: str) -> str:
    """Join recognized signs: consecutive single letters spell a word, words are separated by spaces."""
    words, spelled = [], ""
    for s in signs:
        s = s.strip()
        if not s:
            continue
        if len(s) == 1:
            spelled += s.upper()
        else:
            if spelled:
                words.append(spelled.capitalize())
                spelled = ""
            words.append(s.lower())
    if spelled:
        words.append(spelled.capitalize())
    sentence = " ".join(words)
    return sentence[:1].upper() + sentence[1:] if sentence else ""

@api_router.post("/translate/sign-to-text")
async def sign_to_text(req: SignToTextReq, user=Depends(get_current_user)):
    text = _compose_sentence(req.signs, req.language)
    if not text:
        raise HTTPException(422, "No signs detected")
    msg = Message(
        user_id=user["id"],
        direction="sign_to_text",
        language=req.language,
        original_text=" ".join(req.signs),
        translated_text=text,
    )
    await db.messages.insert_one(msg.model_dump())
    return msg.model_dump()

@api_router.post("/translate/text-to-sign")
async def text_to_sign(req: TextToSignReq, user=Depends(get_current_user)):
    # Break input into letters for avatar-like sequence (letters only)
    seq = [c.upper() for c in req.text if c.isalpha()][:60]
    avatar_id = user.get("avatar_id") or DEFAULT_AVATAR_ID
    try:
        video_url = await build_sign_video(req.text, req.language, avatar_id, priority=_is_premium(user))
    except Exception as e:
        logging.warning(f"Sign video render failed: {e}")
        raise HTTPException(424, "No se pudo generar el video del avatar. Inténtalo de nuevo.")
    msg = Message(
        user_id=user["id"],
        direction="text_to_sign",
        language=req.language,
        original_text=req.text,
        translated_text=req.text,
        sign_sequence=seq,
        video_url=video_url,
        avatar_id=avatar_id,
    )
    await db.messages.insert_one(msg.model_dump())
    return msg.model_dump()

async def _transcribe_upload(audio: UploadFile, language: str) -> str:
    """Validate an uploaded audio file and transcribe it with Whisper."""
    if audio.content_type and audio.content_type.split(";")[0] not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(415, "Unsupported audio type")
    audio_bytes = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio file too large (max 10 MB)")
    if len(audio_bytes) < 100:
        raise HTTPException(400, "Audio file is empty")
    try:
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        return await stt.transcribe_audio(
            audio_bytes=audio_bytes,
            filename=audio.filename or "audio.m4a",
            language="es" if language == "es" else "en",
        )
    except Exception as e:
        logging.warning(f"STT error: {e}")
        raise HTTPException(502, "Transcription service unavailable")

@api_router.post("/translate/voice-to-text")
async def voice_to_text(
    audio: UploadFile = File(...),
    language: str = Form("es"),
    user=Depends(get_current_user),
):
    text = await _transcribe_upload(audio, language)
    seq = [c.upper() for c in text if c.isalpha()][:60]
    lang = "es" if language == "es" else "en"
    avatar_id = user.get("avatar_id") or DEFAULT_AVATAR_ID
    video_url = None
    try:
        video_url = await build_sign_video(text, lang, avatar_id, priority=_is_premium(user))
    except Exception as e:
        logging.warning(f"Voice sign video render failed: {e}")
    msg = Message(
        user_id=user["id"],
        direction="voice_to_text",
        language=lang,
        original_text=text,
        translated_text=text,
        sign_sequence=seq,
        video_url=video_url,
        avatar_id=avatar_id,
    )
    await db.messages.insert_one(msg.model_dump())
    return msg.model_dump()

@api_router.get("/messages")
async def list_messages(user=Depends(get_current_user)):
    items = await db.messages.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return list(reversed(items))

@api_router.delete("/messages")
async def clear_messages(user=Depends(get_current_user)):
    await db.messages.delete_many({"user_id": user["id"]})
    return {"success": True}

# ------------------- FAVORITES -------------------

class FavoriteReq(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    language: Literal["es", "en"] = "es"

class FavoriteUpdateReq(BaseModel):
    text: str = Field(min_length=1, max_length=300)

class FavoriteReorderReq(BaseModel):
    ids: List[str]

@api_router.get("/favorites")
async def list_favorites(language: Optional[str] = None, user=Depends(get_current_user)):
    query = {"user_id": user["id"]}
    if language:
        query["language"] = language
    items = await db.favorites.find(query, {"_id": 0}).sort([("order", 1), ("created_at", -1)]).to_list(200)
    return items

@api_router.post("/favorites")
async def add_favorite(req: FavoriteReq, user=Depends(get_current_user)):
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "Empty text")
    existing = await db.favorites.find_one({"user_id": user["id"], "text": text, "language": req.language}, {"_id": 0})
    if existing:
        return existing
    count = await db.favorites.count_documents({"user_id": user["id"], "language": req.language})
    fav = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "text": text,
        "language": req.language,
        "order": count,
        "created_at": datetime.now(timezone.utc),
    }
    await db.favorites.insert_one(fav)
    fav.pop("_id", None)
    return fav

@api_router.patch("/favorites/{fav_id}")
async def rename_favorite(fav_id: str, req: FavoriteUpdateReq, user=Depends(get_current_user)):
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "Empty text")
    res = await db.favorites.update_one({"id": fav_id, "user_id": user["id"]}, {"$set": {"text": text}})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return await db.favorites.find_one({"id": fav_id}, {"_id": 0})

@api_router.put("/favorites/reorder")
async def reorder_favorites(req: FavoriteReorderReq, user=Depends(get_current_user)):
    from pymongo import UpdateOne
    if not req.ids:
        return {"success": True}
    ops = [UpdateOne({"id": fid, "user_id": user["id"]}, {"$set": {"order": i}}) for i, fid in enumerate(req.ids)]
    await db.favorites.bulk_write(ops)
    return {"success": True}

@api_router.delete("/favorites/{fav_id}")
async def delete_favorite(fav_id: str, user=Depends(get_current_user)):
    res = await db.favorites.delete_one({"id": fav_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"success": True}

# ------------------- LEARNING MODE -------------------

LESSON_SIZE = 5

class LearnCompleteReq(BaseModel):
    language: Literal["es", "en"] = "es"
    correct_ids: List[str] = []
    wrong_ids: List[str] = []
    score: int = 0
    total: int = LESSON_SIZE

def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()

def _yesterday() -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()

async def _get_progress(user_id: str) -> dict:
    prog = await db.learning.find_one({"user_id": user_id}, {"_id": 0})
    if not prog:
        prog = {
            "user_id": user_id,
            "streak": 0,
            "best_streak": 0,
            "last_completed": None,
            "learned_ids": [],
            "weak_ids": [],
            "lessons_completed": 0,
            "total_correct": 0,
        }
    return prog

def _progress_view(prog: dict) -> dict:
    last = prog.get("last_completed")
    streak = prog.get("streak", 0) if last in (_today(), _yesterday()) else 0
    return {
        "streak": streak,
        "best_streak": prog.get("best_streak", 0),
        "last_completed": last,
        "completed_today": last == _today(),
        "learned_count": len(prog.get("learned_ids", [])),
        "weak_ids": prog.get("weak_ids", []),
        "weak_count": len(prog.get("weak_ids", [])),
        "lessons_completed": prog.get("lessons_completed", 0),
        "total_correct": prog.get("total_correct", 0),
        "achievements_count": len(prog.get("achievements", {})),
    }

def _update_weak(prog: dict, correct_ids: List[str], wrong_ids: List[str]) -> None:
    weak = set(prog.get("weak_ids", []))
    weak -= set(correct_ids)
    weak |= set(wrong_ids)
    prog["weak_ids"] = sorted(weak)

def _build_quiz_items(entries: List[dict], picked: List[dict], rng) -> List[dict]:
    items = []
    for e in picked:
        same_kind = [x["label"] for x in entries if x["kind"] == e["kind"] and x["id"] != e["id"]]
        distractors = rng.sample(same_kind, min(3, len(same_kind)))
        options = distractors + [e["label"]]
        rng.shuffle(options)
        items.append({"entry": e, "options": options})
    return items

@api_router.get("/learn/progress")
async def learn_progress(user=Depends(get_current_user)):
    prog = await _get_progress(user["id"])
    return _progress_view(prog)

@api_router.get("/learn/today")
async def learn_today(language: Literal["es", "en"] = "es", user=Depends(get_current_user)):
    import random
    prog = await _get_progress(user["id"])
    entries = await _all_entries(language)
    signs = [e for e in entries if e["kind"] != "phrase"]
    phrases = [e for e in entries if e["kind"] == "phrase"]
    learned = set(prog.get("learned_ids", []))
    rng = random.Random(f"{user['id']}|{_today()}|{language}")
    # Occasionally (about 6 days out of 10) one slot becomes a full-phrase question.
    with_phrase = rng.random() < PHRASE_QUESTION_CHANCE and len(phrases) >= 4
    sign_slots = LESSON_SIZE - (1 if with_phrase else 0)
    candidates = [e for e in signs if e["id"] not in learned]
    if len(candidates) < sign_slots:
        candidates = signs  # everything learned: cycle through again
    picked = rng.sample(candidates, min(sign_slots, len(candidates)))
    if with_phrase:
        phrase_pool = [p for p in phrases if p["id"] not in learned] or phrases
        picked.insert(rng.randrange(len(picked) + 1), rng.choice(phrase_pool))
    items = _build_quiz_items(entries, picked, rng)
    return {"date": _today(), "language": language, "items": items, "progress": _progress_view(prog)}

PHRASE_QUESTION_CHANCE = 0.6

def _phrase_entries(language: str) -> List[dict]:
    """Full phrases as quiz entries: label = phrase in user's language, description = the other language."""
    other = "en" if language == "es" else "es"
    out = []
    for i, (cat, es, en) in enumerate(PHRASES):
        text = {"es": es, "en": en}
        out.append({
            "id": f"phrase-{i}",
            "language": language,
            "label": text[language],
            "kind": "phrase",
            "description": text[other],
            "emoji": CATEGORY_LABELS[cat]["emoji"],
            "gif_url": None,
            "image_url": None,
        })
    return out

async def _all_entries(language: str) -> List[dict]:
    entries = await db.dictionary.find({"language": language}, {"_id": 0}).to_list(500)
    return entries + _phrase_entries(language)

@api_router.get("/learn/review")
async def learn_review(language: Literal["es", "en"] = "es", user=Depends(get_current_user)):
    """Quiz built only from the signs the user previously got wrong."""
    import random
    prog = await _get_progress(user["id"])
    weak = set(prog.get("weak_ids", []))
    entries = await _all_entries(language)
    picked = [e for e in entries if e["id"] in weak]
    rng = random.Random()
    rng.shuffle(picked)
    picked = picked[:10]
    items = _build_quiz_items(entries, picked, rng)
    return {"language": language, "items": items, "progress": _progress_view(prog)}

@api_router.post("/learn/review/complete")
async def learn_review_complete(req: LearnCompleteReq, user=Depends(get_current_user)):
    """Review results: mastered signs leave the weak list, missed ones stay. No streak change."""
    prog = await _get_progress(user["id"])
    had_weak = len(prog.get("weak_ids", [])) > 0
    _update_weak(prog, req.correct_ids, req.wrong_ids)
    prog["total_correct"] = prog.get("total_correct", 0) + max(0, req.score)
    prog["learned_ids"] = sorted(set(prog.get("learned_ids", [])) | set(req.correct_ids))
    if had_weak and len(prog["weak_ids"]) == 0:
        prog["weak_cleared"] = True
    newly = await _check_achievements(user["id"], prog)
    await db.learning.update_one({"user_id": user["id"]}, {"$set": prog}, upsert=True)
    view = _progress_view(prog)
    view["counted"] = False
    view["mastered"] = len(req.correct_ids)
    view["newly_unlocked"] = _achievement_views(newly, prog, req.language)
    return view

@api_router.post("/learn/complete")
async def learn_complete(req: LearnCompleteReq, user=Depends(get_current_user)):
    prog = await _get_progress(user["id"])
    today = _today()
    counted = False
    if prog.get("last_completed") != today:
        counted = True
        prog["streak"] = prog.get("streak", 0) + 1 if prog.get("last_completed") == _yesterday() else 1
        prog["best_streak"] = max(prog.get("best_streak", 0), prog["streak"])
        prog["last_completed"] = today
        prog["lessons_completed"] = prog.get("lessons_completed", 0) + 1
    if req.total > 0 and req.score >= req.total:
        prog["perfect_lessons"] = prog.get("perfect_lessons", 0) + 1
    prog["total_correct"] = prog.get("total_correct", 0) + max(0, req.score)
    prog["learned_ids"] = sorted(set(prog.get("learned_ids", [])) | set(req.correct_ids))
    _update_weak(prog, req.correct_ids, req.wrong_ids)
    newly = await _check_achievements(user["id"], prog)
    await db.learning.update_one({"user_id": user["id"]}, {"$set": prog}, upsert=True)
    view = _progress_view(prog)
    view["counted"] = counted
    view["newly_unlocked"] = _achievement_views(newly, prog, req.language)
    return view

# ------------------- ACHIEVEMENTS -------------------

ACHIEVEMENTS = [
    {"id": "first_lesson", "emoji": "🎓", "es": ("Primera lección", "Completa tu primera lección diaria"), "en": ("First lesson", "Complete your first daily lesson"),
     "check": lambda p, c: p.get("lessons_completed", 0) >= 1},
    {"id": "streak_3", "emoji": "🔥", "es": ("3 días seguidos", "Mantén una racha de 3 días"), "en": ("3-day streak", "Keep a 3-day streak"),
     "check": lambda p, c: p.get("best_streak", 0) >= 3},
    {"id": "streak_7", "emoji": "🏅", "es": ("Semana perfecta", "Mantén una racha de 7 días"), "en": ("Perfect week", "Keep a 7-day streak"),
     "check": lambda p, c: p.get("best_streak", 0) >= 7},
    {"id": "streak_30", "emoji": "👑", "es": ("Mes constante", "Mantén una racha de 30 días"), "en": ("Steady month", "Keep a 30-day streak"),
     "check": lambda p, c: p.get("best_streak", 0) >= 30},
    {"id": "learned_10", "emoji": "🌱", "es": ("Primeras 10 señas", "Domina 10 señas"), "en": ("First 10 signs", "Master 10 signs"),
     "check": lambda p, c: len(p.get("learned_ids", [])) >= 10},
    {"id": "learned_50", "emoji": "🌳", "es": ("50 señas dominadas", "Domina 50 señas"), "en": ("50 signs mastered", "Master 50 signs"),
     "check": lambda p, c: len(p.get("learned_ids", [])) >= 50},
    {"id": "learned_100", "emoji": "🏆", "es": ("Centenario", "Domina 100 señas"), "en": ("Centurion", "Master 100 signs"),
     "check": lambda p, c: len(p.get("learned_ids", [])) >= 100},
    {"id": "lessons_10", "emoji": "📚", "es": ("Estudiante", "Completa 10 lecciones"), "en": ("Student", "Complete 10 lessons"),
     "check": lambda p, c: p.get("lessons_completed", 0) >= 10},
    {"id": "perfect_lesson", "emoji": "💯", "es": ("Lección perfecta", "Responde toda una lección sin errores"), "en": ("Perfect lesson", "Answer a whole lesson with no mistakes"),
     "check": lambda p, c: p.get("perfect_lessons", 0) >= 1},
    {"id": "review_clear", "emoji": "🎯", "es": ("Sin pendientes", "Vacía tu lista de repaso"), "en": ("All clear", "Empty your review list"),
     "check": lambda p, c: p.get("weak_cleared", False)},
    {"id": "fav_5", "emoji": "⭐", "es": ("Coleccionista", "Guarda 5 frases favoritas"), "en": ("Collector", "Save 5 favorite phrases"),
     "check": lambda p, c: c["favorites"] >= 5},
    {"id": "messages_10", "emoji": "💬", "es": ("Conversador", "Traduce 10 mensajes"), "en": ("Conversationalist", "Translate 10 messages"),
     "check": lambda p, c: c["messages"] >= 10},
]

async def _check_achievements(user_id: str, prog: dict) -> List[str]:
    """Evaluate all achievements; persist newly unlocked ids into prog. Returns newly unlocked ids."""
    counts = {
        "favorites": await db.favorites.count_documents({"user_id": user_id}),
        "messages": await db.messages.count_documents({"user_id": user_id}),
    }
    unlocked = prog.setdefault("achievements", {})
    newly = []
    for a in ACHIEVEMENTS:
        if a["id"] not in unlocked and a["check"](prog, counts):
            unlocked[a["id"]] = datetime.now(timezone.utc).isoformat()
            newly.append(a["id"])
    return newly

def _achievement_views(ids: List[str], prog: dict, language: str) -> List[dict]:
    unlocked = prog.get("achievements", {})
    out = []
    for a in ACHIEVEMENTS:
        if a["id"] in ids:
            title, desc = a[language]
            out.append({"id": a["id"], "emoji": a["emoji"], "title": title, "description": desc,
                        "unlocked": a["id"] in unlocked, "unlocked_at": unlocked.get(a["id"])})
    return out

@api_router.get("/learn/achievements")
async def learn_achievements(language: Literal["es", "en"] = "es", user=Depends(get_current_user)):
    prog = await _get_progress(user["id"])
    newly = await _check_achievements(user["id"], prog)
    if newly:
        await db.learning.update_one({"user_id": user["id"]}, {"$set": prog}, upsert=True)
    items = _achievement_views([a["id"] for a in ACHIEVEMENTS], prog, language)
    return {"items": items, "unlocked_count": sum(1 for i in items if i["unlocked"]), "total": len(items)}

# ------------------- PHRASES -------------------

PHRASES = [
    # (category, es, en)
    ("greetings", "Hola, ¿cómo estás?", "Hello, how are you?"),
    ("greetings", "Mucho gusto en conocerte.", "Nice to meet you."),
    ("greetings", "Hasta luego, cuídate.", "See you later, take care."),
    ("greetings", "Buenos días, que tengas buen día.", "Good morning, have a nice day."),
    ("needs", "¿Dónde está el baño?", "Where is the bathroom?"),
    ("needs", "Necesito ayuda, por favor.", "I need help, please."),
    ("needs", "Tengo hambre, ¿dónde puedo comer?", "I'm hungry, where can I eat?"),
    ("needs", "¿Me puedes dar agua?", "Can you give me some water?"),
    ("needs", "Necesito un doctor.", "I need a doctor."),
    ("needs", "¿Cuánto cuesta esto?", "How much does this cost?"),
    ("communication", "Soy sordo, ¿puedes escribirlo?", "I am deaf, can you write it down?"),
    ("communication", "No entiendo, ¿puedes repetir?", "I don't understand, can you repeat?"),
    ("communication", "Estoy aprendiendo lengua de señas.", "I am learning sign language."),
    ("communication", "¿Puedes hablar más despacio?", "Can you speak more slowly?"),
    ("communication", "Un momento, por favor.", "One moment, please."),
    ("daily", "¿A qué hora nos vemos?", "What time shall we meet?"),
    ("daily", "Llego en diez minutos.", "I'll be there in ten minutes."),
    ("daily", "Gracias por tu paciencia.", "Thank you for your patience."),
    ("daily", "¿Cómo llego a la estación?", "How do I get to the station?"),
    ("daily", "Te quiero mucho.", "I love you very much."),
]

CATEGORY_LABELS = {
    "greetings": {"es": "Saludos", "en": "Greetings", "emoji": "👋"},
    "needs": {"es": "Necesidades", "en": "Needs", "emoji": "🆘"},
    "communication": {"es": "Comunicación", "en": "Communication", "emoji": "💬"},
    "daily": {"es": "Día a día", "en": "Everyday", "emoji": "📅"},
}

@api_router.get("/phrases")
async def get_phrases(language: Literal["es", "en"] = "es"):
    items = [
        {"id": f"phrase-{i}", "category": cat, "text": es if language == "es" else en,
         "category_label": CATEGORY_LABELS[cat][language], "category_emoji": CATEGORY_LABELS[cat]["emoji"]}
        for i, (cat, es, en) in enumerate(PHRASES)
    ]
    return {"items": items, "categories": [
        {"id": k, "label": v[language], "emoji": v["emoji"]} for k, v in CATEGORY_LABELS.items()
    ]}

# ------------------- USER CONTACTS (Contacts Manager) -------------------

class ContactViewReq(BaseModel):
    """Payload sent whenever a profile (e.g. a contact picked to share a message) is accessed."""
    profileId: Optional[str] = Field(default=None, max_length=120)
    displayName: str = Field(min_length=1, max_length=120)
    profileImageUrl: Optional[str] = Field(default=None, max_length=2000)
    phone: Optional[str] = Field(default=None, max_length=40)

def _contact_view(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in ("_id", "owner_user_id")}

async def contacts_manager_on_profile_view(owner_user_id: str, req: ContactViewReq) -> dict:
    """Contacts Manager: on the FIRST access to a profile, persist it into `UserContacts`
    with isSavedLocally=True. Later accesses only refresh lastSyncDate."""
    now = datetime.now(timezone.utc)
    match = {"owner_user_id": owner_user_id}
    if req.profileId:
        match["profileId"] = req.profileId
    elif req.phone:
        match["phone"] = req.phone
    else:
        match["displayName"] = req.displayName.strip()
    existing = await db.UserContacts.find_one(match)
    if existing:
        await db.UserContacts.update_one({"_id": existing["_id"]}, {"$set": {"lastSyncDate": now, "displayName": req.displayName.strip()}})
        existing.update({"lastSyncDate": now, "displayName": req.displayName.strip()})
        return {"contact": _contact_view(existing), "created": False, "message": None}
    doc = {
        "id": str(uuid.uuid4()),
        "owner_user_id": owner_user_id,
        "profileId": req.profileId,
        "displayName": req.displayName.strip(),
        "profileImageUrl": req.profileImageUrl,
        "phone": req.phone,
        "lastSyncDate": now,
        "isSavedLocally": True,
        "createdAt": now,
    }
    await db.UserContacts.insert_one(doc)
    logging.info(f"ContactsManager: auto-saved contact '{doc['displayName']}' for user {owner_user_id}")
    return {"contact": _contact_view(doc), "created": True, "message": "Contacto sincronizado automáticamente"}

@api_router.post("/contacts/view")
async def contact_viewed(req: ContactViewReq, user=Depends(get_current_user)):
    return await contacts_manager_on_profile_view(user["id"], req)

@api_router.get("/contacts")
async def list_contacts(user=Depends(get_current_user)):
    items = await db.UserContacts.find({"owner_user_id": user["id"]}).sort("lastSyncDate", -1).to_list(500)
    return [_contact_view(i) for i in items]

@api_router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, user=Depends(get_current_user)):
    res = await db.UserContacts.delete_one({"id": contact_id, "owner_user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"success": True}

# ------------------- CHAT 1:1 (Phase 3) -------------------
# Conversations between two registered users found through the phone's contacts.
# Every message is stored as TEXT (typed, transcribed voice note, or recognized signs) so the
# receiver can read it, listen to it (TTS) or watch it as an avatar sign video (rendered lazily).

MAX_MATCH_PHONES = 2000

class MatchPhonesReq(BaseModel):
    phones: List[str] = Field(default_factory=list, max_length=MAX_MATCH_PHONES)

class NewConversationReq(BaseModel):
    peer_id: Optional[str] = Field(default=None, max_length=64)
    phone: Optional[str] = Field(default=None, max_length=40)

class ChatSendReq(BaseModel):
    kind: Literal["text", "sign"] = "text"
    text: Optional[str] = Field(default=None, max_length=500)
    signs: List[str] = Field(default_factory=list, max_length=120)
    language: Literal["es", "en"] = "es"

def _phone_digits(p: Optional[str]) -> str:
    return re.sub(r"\D", "", p or "")

def _phones_match(a: str, b: str) -> bool:
    """Same number ignoring formatting/country prefix: compare the last (up to) 10 digits."""
    if not a or not b:
        return False
    if a == b:
        return True
    tail = min(len(a), len(b), 10)
    return tail >= 7 and a[-tail:] == b[-tail:]

def _iso(dt) -> Optional[str]:
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()

def _peer_view(u: Optional[dict]) -> Optional[dict]:
    if not u:
        return None
    return {"id": u["id"], "name": u.get("name") or u["phone"], "phone": u["phone"],
            "photo_url": u.get("photo_url"), "avatar_id": u.get("avatar_id") or DEFAULT_AVATAR_ID}

def _chat_msg_view(m: dict) -> dict:
    return {**{k: v for k, v in m.items() if k != "_id"}, "created_at": _iso(m.get("created_at"))}

async def _find_user_by_phone(phone: str) -> Optional[dict]:
    d = _phone_digits(phone)
    if len(d) < 7:
        raise HTTPException(400, "Número de teléfono inválido")
    users = await db.users.find({}, {"_id": 0, "id": 1, "name": 1, "phone": 1, "photo_url": 1, "avatar_id": 1}).to_list(5000)
    return next((u for u in users if _phones_match(_phone_digits(u["phone"]), d)), None)

@api_router.post("/chat/match")
async def chat_match(req: MatchPhonesReq, user=Depends(get_current_user)):
    """Which of the given phone numbers (device contacts) belong to registered SignBridge users."""
    wanted = {}
    for p in req.phones:
        d = _phone_digits(p)
        if len(d) >= 7:
            wanted.setdefault(d, p)
    if not wanted:
        return {"items": []}
    users = await db.users.find({"id": {"$ne": user["id"]}}, {"_id": 0, "id": 1, "name": 1, "phone": 1, "photo_url": 1, "avatar_id": 1}).to_list(5000)
    items = []
    for u in users:
        ud = _phone_digits(u["phone"])
        for d, raw in wanted.items():
            if _phones_match(ud, d):
                items.append({**_peer_view(u), "matched_phone": raw})
                break
    return {"items": items}

async def _get_or_create_conversation(me_id: str, peer_id: str) -> dict:
    key = "|".join(sorted([me_id, peer_id]))
    conv = await db.conversations.find_one({"key": key}, {"_id": 0})
    if not conv:
        now = datetime.now(timezone.utc)
        conv = {"id": str(uuid.uuid4()), "key": key, "participants": sorted([me_id, peer_id]),
                "created_at": now, "updated_at": now, "last_message": None, "last_read": {}}
        await db.conversations.insert_one(conv)
        conv.pop("_id", None)
    return conv

async def _conversation_view(conv: dict, me_id: str) -> dict:
    peer_id = next((p for p in conv["participants"] if p != me_id), None)
    peer = await db.users.find_one({"id": peer_id}, {"_id": 0}) if peer_id else None
    last_read = (conv.get("last_read") or {}).get(me_id)
    q = {"conversation_id": conv["id"], "sender_id": {"$ne": me_id}}
    if last_read:
        q["created_at"] = {"$gt": last_read}
    unread = await db.chat_messages.count_documents(q)
    last = conv.get("last_message")
    if last:
        last = {**last, "created_at": _iso(last.get("created_at"))}
    return {"id": conv["id"], "peer": _peer_view(peer), "last_message": last,
            "unread_count": unread, "updated_at": _iso(conv.get("updated_at"))}

async def _conv_for(cid: str, user_id: str) -> dict:
    conv = await db.conversations.find_one({"id": cid, "participants": user_id}, {"_id": 0})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return conv

@api_router.post("/chat/conversations")
async def open_conversation(req: NewConversationReq, user=Depends(get_current_user)):
    peer = None
    if req.peer_id:
        peer = await db.users.find_one({"id": req.peer_id}, {"_id": 0})
    elif req.phone:
        peer = await _find_user_by_phone(req.phone)
    else:
        raise HTTPException(400, "peer_id or phone required")
    if not peer:
        raise HTTPException(404, "Este número aún no está registrado en SignBridge")
    if peer["id"] == user["id"]:
        raise HTTPException(400, "No puedes chatear contigo mismo")
    conv = await _get_or_create_conversation(user["id"], peer["id"])
    return await _conversation_view(conv, user["id"])

@api_router.get("/chat/conversations")
async def list_conversations(user=Depends(get_current_user)):
    convs = await db.conversations.find({"participants": user["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    return [await _conversation_view(c, user["id"]) for c in convs]

@api_router.get("/chat/unread")
async def chat_unread(user=Depends(get_current_user)):
    """Total unread messages across all conversations (tab badge)."""
    convs = await db.conversations.find({"participants": user["id"]}, {"_id": 0, "id": 1, "last_read": 1}).to_list(500)
    total = 0
    for c in convs:
        q = {"conversation_id": c["id"], "sender_id": {"$ne": user["id"]}}
        last_read = (c.get("last_read") or {}).get(user["id"])
        if last_read:
            q["created_at"] = {"$gt": last_read}
        total += await db.chat_messages.count_documents(q)
    return {"unread": total}

@api_router.get("/chat/conversations/{cid}/messages")
async def chat_messages(cid: str, after: Optional[str] = None, user=Depends(get_current_user)):
    """Messages of a conversation (oldest first). `after` (ISO) returns only newer ones → used for polling.
    Reading marks the conversation as read for the caller."""
    conv = await _conv_for(cid, user["id"])
    q = {"conversation_id": cid}
    if after:
        try:
            dt = datetime.fromisoformat(after.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "Invalid 'after' timestamp")
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        q["created_at"] = {"$gt": dt}
        items = await db.chat_messages.find(q, {"_id": 0}).sort("created_at", 1).to_list(300)
    else:
        items = await db.chat_messages.find(q, {"_id": 0}).sort("created_at", -1).limit(200).to_list(200)
        items.reverse()
    now = datetime.now(timezone.utc)
    await db.conversations.update_one({"id": cid}, {"$set": {f"last_read.{user['id']}": now}})
    peer_id = next((p for p in conv["participants"] if p != user["id"]), None)
    peer = await db.users.find_one({"id": peer_id}, {"_id": 0}) if peer_id else None
    return {"items": [_chat_msg_view(m) for m in items], "peer": _peer_view(peer), "me": user["id"], "server_time": _iso(now)}

async def _insert_chat_message(conv: dict, sender: dict, kind: str, text: str, language: str, signs: Optional[List[str]] = None) -> dict:
    now = datetime.now(timezone.utc)
    msg = {
        "id": str(uuid.uuid4()),
        "conversation_id": conv["id"],
        "sender_id": sender["id"],
        "kind": kind,  # text | voice | sign (how the SENDER produced it)
        "text": text,
        "language": language,
        "signs": signs,
        "video_url": None,  # avatar sign video, rendered on demand
        "avatar_id": sender.get("avatar_id") or DEFAULT_AVATAR_ID,
        "created_at": now,
    }
    await db.chat_messages.insert_one(msg)
    preview = {"text": text[:120], "kind": kind, "sender_id": sender["id"], "created_at": now}
    await db.conversations.update_one(
        {"id": conv["id"]},
        {"$set": {"updated_at": now, "last_message": preview, f"last_read.{sender['id']}": now}},
    )
    return _chat_msg_view(msg)

@api_router.post("/chat/conversations/{cid}/messages")
async def chat_send(cid: str, req: ChatSendReq, user=Depends(get_current_user)):
    conv = await _conv_for(cid, user["id"])
    if req.kind == "sign":
        text = _compose_sentence(req.signs, req.language)
        if not text:
            raise HTTPException(422, "No signs detected")
        return await _insert_chat_message(conv, user, "sign", text, req.language, [s.strip() for s in req.signs if s.strip()])
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(422, "Empty message")
    return await _insert_chat_message(conv, user, "text", text, req.language)

@api_router.post("/chat/conversations/{cid}/voice")
async def chat_send_voice(
    cid: str,
    audio: UploadFile = File(...),
    language: str = Form("es"),
    user=Depends(get_current_user),
):
    """Voice note → Whisper transcript stored as the message text."""
    conv = await _conv_for(cid, user["id"])
    text = (await _transcribe_upload(audio, language)).strip()
    if not text:
        raise HTTPException(422, "No se entendió la nota de voz")
    return await _insert_chat_message(conv, user, "voice", text, "es" if language == "es" else "en")

@api_router.post("/chat/messages/{mid}/sign-video")
async def chat_sign_video(mid: str, user=Depends(get_current_user)):
    """Render (once) the avatar sign video of a message, presented by the sender's avatar."""
    msg = await db.chat_messages.find_one({"id": mid}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Message not found")
    await _conv_for(msg["conversation_id"], user["id"])
    if msg.get("video_url"):
        return _chat_msg_view(msg)
    try:
        video_url = await build_sign_video(msg["text"], msg["language"], msg.get("avatar_id"), priority=_is_premium(user))
    except Exception as e:
        logging.warning(f"Chat sign video render failed: {e}")
        raise HTTPException(424, "No se pudo generar el video del avatar. Inténtalo de nuevo.")
    if not video_url:
        raise HTTPException(422, "Este mensaje no tiene letras para mostrar en señas")
    await db.chat_messages.update_one({"id": mid}, {"$set": {"video_url": video_url}})
    msg["video_url"] = video_url
    return _chat_msg_view(msg)

# ------------------- TTS -------------------

def _clean_tts(text: str) -> str:
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"[*_#>~|`]", "", text)
    return re.sub(r"\s+", " ", text).strip()

def _tts_key(text: str, voice: str) -> str:
    return hashlib.sha256(f"{text}|{voice}|1.0|tts-1|mp3".encode()).hexdigest()

@api_router.post("/tts")
async def create_tts(req: TtsReq, user=Depends(get_current_user)):
    clean = _clean_tts(req.text)[:4000]
    key = _tts_key(clean, req.voice)
    existing = await db.tts_cache.find_one({"key": key}, {"_id": 0})
    if not existing:
        try:
            tts = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
            audio_bytes = await tts.generate_speech(text=clean, model="tts-1", voice=req.voice)
        except Exception as e:
            logging.warning(f"TTS error: {e}")
            raise HTTPException(502, "Speech service unavailable")
        await db.tts_cache.insert_one({"key": key, "audio": audio_bytes})
    backend_url = os.environ.get("EXPO_PACKAGER_HOSTNAME", "")
    return {"url": f"/api/tts/{key}.mp3"}

@api_router.get("/tts/{key}.mp3")
async def fetch_tts(key: str):
    entry = await db.tts_cache.find_one({"key": key})
    if not entry:
        raise HTTPException(404, "Not found")
    return Response(
        content=entry["audio"],
        media_type="audio/mpeg",
        headers={"Cache-Control": "public, max-age=31536000"},
    )

# ------------------- HEALTH -------------------

@api_router.get("/")
async def root():
    return {"message": "SignBridge API", "status": "ok"}

app.include_router(api_router)

# Bearer-token auth (no cookies), so credentials are not needed. Set CORS_ORIGINS (comma-separated)
# to restrict origins explicitly in production.
_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=bool(_cors_origins),
    allow_origins=_cors_origins or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
