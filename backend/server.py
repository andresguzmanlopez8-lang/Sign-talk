from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import hashlib
import re
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timedelta, timezone
import jwt

from emergentintegrations.llm.openai import OpenAITextToSpeech, OpenAISpeechToText
from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"

MOCK_OTP = "123456"

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

class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    direction: Literal["sign_to_text", "text_to_sign", "voice_to_text"]
    language: Literal["es", "en"]
    original_text: Optional[str] = None
    translated_text: str
    sign_sequence: Optional[List[str]] = None  # letters/words to animate
    audio_url: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SignToTextReq(BaseModel):
    language: Literal["es", "en"] = "es"
    # In real app, video is uploaded; MVP simulates via a hint or random from set
    hint: Optional[str] = None

class TextToSignReq(BaseModel):
    text: str
    language: Literal["es", "en"] = "es"

class TtsReq(BaseModel):
    text: str
    voice: str = "nova"

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

# ------------------- AUTH -------------------

@api_router.post("/auth/send-otp")
async def send_otp(req: SendOtpReq):
    # Mock: OTP is always 123456
    return {"success": True, "message": "OTP sent", "mock_otp": MOCK_OTP}

@api_router.post("/auth/verify-otp")
async def verify_otp(req: VerifyOtpReq):
    if req.otp != MOCK_OTP:
        raise HTTPException(400, "Invalid OTP")
    full_phone = f"{req.country_code}{req.phone}"
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
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return _user_safe(updated)

# ------------------- DICTIONARY -------------------

# Public GIF sources for sign language alphabets
ASL_GIF_BASE = "https://www.lifeprint.com/asl101/gifs-animated/"
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

# Vocabulary pool for mock sign-to-text (realistic phrases)
MOCK_SIGN_PHRASES = {
    "en": [
        "Hello, how are you?",
        "Nice to meet you.",
        "Thank you very much.",
        "I need help please.",
        "What is your name?",
        "I am learning sign language.",
        "Where is the bathroom?",
        "Can you help me?",
        "I love you.",
        "See you tomorrow.",
    ],
    "es": [
        "Hola, ¿cómo estás?",
        "Mucho gusto en conocerte.",
        "Muchas gracias.",
        "Necesito ayuda por favor.",
        "¿Cuál es tu nombre?",
        "Estoy aprendiendo lengua de señas.",
        "¿Dónde está el baño?",
        "¿Me puedes ayudar?",
        "Te quiero.",
        "Hasta mañana.",
    ],
}

async def _llm_generate(prompt: str, language: str) -> str:
    """Use GPT to generate/refine a translation."""
    try:
        session_id = str(uuid.uuid4())
        system = (
            "You simulate a sign language recognition model. Given a hint, produce a natural, short sentence "
            f"in {'Spanish' if language == 'es' else 'English'} (max 12 words). Return only the sentence."
        )
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system).with_model("openai", "gpt-4o-mini")
        resp = await chat.send_message(UserMessage(text=prompt))
        return resp.strip().strip('"')
    except Exception as e:
        logging.warning(f"LLM error: {e}")
        import random
        return random.choice(MOCK_SIGN_PHRASES[language])

@api_router.post("/translate/sign-to-text")
async def sign_to_text(req: SignToTextReq, user=Depends(get_current_user)):
    prompt = req.hint or "The user signed a common greeting or question."
    text = await _llm_generate(f"Simulate sign recognition. Context: {prompt}", req.language)
    msg = Message(
        user_id=user["id"],
        direction="sign_to_text",
        language=req.language,
        translated_text=text,
    )
    await db.messages.insert_one(msg.model_dump())
    return msg.model_dump()

@api_router.post("/translate/text-to-sign")
async def text_to_sign(req: TextToSignReq, user=Depends(get_current_user)):
    # Break input into letters for avatar-like sequence (letters only)
    seq = [c.upper() for c in req.text if c.isalpha()][:60]
    msg = Message(
        user_id=user["id"],
        direction="text_to_sign",
        language=req.language,
        original_text=req.text,
        translated_text=req.text,
        sign_sequence=seq,
    )
    await db.messages.insert_one(msg.model_dump())
    return msg.model_dump()

@api_router.post("/translate/voice-to-text")
async def voice_to_text(
    audio: UploadFile = File(...),
    language: str = Form("es"),
    user=Depends(get_current_user),
):
    try:
        audio_bytes = await audio.read()
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        text = await stt.transcribe_audio(
            audio_bytes=audio_bytes,
            filename=audio.filename or "audio.m4a",
            language="es" if language == "es" else "en",
        )
    except Exception as e:
        logging.warning(f"STT error: {e}")
        raise HTTPException(500, f"Transcription failed: {e}")

    seq = [c.upper() for c in text if c.isalpha()][:60]
    msg = Message(
        user_id=user["id"],
        direction="voice_to_text",
        language=language,
        original_text=text,
        translated_text=text,
        sign_sequence=seq,
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
    text: str
    language: Literal["es", "en"] = "es"

class FavoriteUpdateReq(BaseModel):
    text: str

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
            raise HTTPException(500, f"TTS failed: {e}")
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

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
