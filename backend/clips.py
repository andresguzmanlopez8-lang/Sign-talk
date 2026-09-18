"""
Real interpreter clip catalog (educational sources) used by the sign-video pipeline.

Each entry maps a normalized vocabulary key (see gestures.normalize) to a public clip that shows a real
interpreter (upper body, both hands). Signs without a clip fall back to the 2D avatar segment.
Currently: ASL (English) from Lifeprint.com — Dr. Bill Vicars, ASL University (educational use, credited).
LSM (Spanish) has no open source with direct files yet → 2D avatar fallback.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Optional

from gestures import normalize

LIFEPRINT = "https://www.lifeprint.com/asl101/"
CREDIT_EN = "ASL clip: Lifeprint.com / Dr. Bill Vicars (ASL University)"

_EN_FILES: Dict[str, str] = {
    "thank you|thanks": "gifs/t/thank-you.gif",
    "yes": "gifs/y/yes.gif",
    "sorry": "gifs-animated/sorry.gif",
    "love": "gifs/l/love.gif",
    "friend": "gifs/f/friend.gif",
    "family": "gifs/f/family.gif",
    "house|home": "gifs-animated/house.gif",
    "eat|food": "gifs/e/eat.gif",
    "water": "gifs/w/water.gif",
    "help": "gifs/h/help.gif",
    "bathroom|restroom|toilet": "gifs/b/bathroom.gif",
    "doctor": "gifs/d/doctor.gif",
    "money": "gifs/m/money.gif",
    "name": "gifs/n/name.gif",
    "understand": "gifs/u/understand.gif",
    "learn|learning": "gifs/l/learn.gif",
    "phone|call": "gifs/p/phone.gif",
    "tired": "gifs/t/tired.gif",
    "slow|slowly": "gifs/s/slow.gif",
    "school": "gifs/s/school.gif",
    "tomorrow": "gifs/t/tomorrow.gif",
    "yesterday": "gifs/y/yesterday.gif",
    "good|well": "gifs/g/good.gif",
    "bad": "gifs/b/bad.gif",
    "happy": "gifs/h/happy.gif",
    "sad": "gifs/s/sad.gif",
    "morning|good morning": "gifs/m/morning.gif",
    "night": "gifs/n/night.gif",
    "good night": "gifs-animated/goodnight.gif",
    "where": "gifs/w/where.gif",
    "need": "gifs/n/need.gif",
    "deaf": "gifs/d/deaf.gif",
    "write": "gifs/w/write.gif",
    "again|repeat": "gifs/a/again.gif",
    "wait|moment": "gifs/w/wait.gif",
    "see|look": "gifs-animated/see.gif",
    "know": "gifs/k/know.gif",
    "what": "gifs/w/what.gif",
    "who": "gifs/w/who.gif",
    "when": "gifs/w/when.gif",
    "later|see you later": "gifs/l/later.gif",
    "meet|nice to meet": "gifs/m/meet.gif",
    "nice": "gifs/n/nice.gif",
    "can": "gifs/c/can.gif",
    "arrive|get to": "gifs/a/arrive.gif",
    "speak|talk": "gifs/s/speak.gif",
    "small|little": "gifs-animated/small.gif",
    "people|person": "gifs-animated/people.gif",
    "time|what time": "gifs/t/time-1.gif",
    "how much": "gifs/h/how-much-2.gif",
    "patience|patient": "gifs-animated/patient.gif",
}

CLIPS: Dict[str, Dict[str, str]] = {"en": {}, "es": {}}
for _keys, _file in _EN_FILES.items():
    for _k in _keys.split("|"):
        CLIPS["en"][normalize(_k)] = LIFEPRINT + _file

# LSM (Spanish, Mexico): Spread the Sign — European Sign Language Centre (non-profit educational dictionary).
# Catalog built by fetch_lsm_clips.py (exact word/phrase matches only) → clips_es.json
CREDIT_ES = "Clip LSM: Spread the Sign (European Sign Language Centre)"
_ES_JSON = Path(__file__).parent / "clips_es.json"
if _ES_JSON.exists():
    for _key, _entry in json.loads(_ES_JSON.read_text()).items():
        CLIPS["es"][normalize(_key)] = _entry["url"]
# Spanish synonyms that share the same LSM sign
for _alias, _base in {"ayuda": "ayudar", "necesito": "necesitar", "puedo": "poder", "madre": "mama", "padre": "papa",
                      "medico": "doctor", "amiga": "amigo", "hogar": "casa", "tomar": "beber", "contento": "feliz",
                      "lento": "despacio", "minutos": "minuto", "otra vez": "repetir", "comida": "comer"}.items():
    if _base in CLIPS["es"] and _alias not in CLIPS["es"]:
        CLIPS["es"][_alias] = CLIPS["es"][_base]

INTERPRETERS = [
    {"id": "lifeprint-asl", "name": "Intérprete ASL · Bill Vicars", "language": "en", "credit": CREDIT_EN,
     "preview_key": normalize("thank you")},
    {"id": "spreadthesign-lsm", "name": "Intérprete LSM · Spread the Sign", "language": "es", "credit": CREDIT_ES,
     "preview_key": normalize("hola")},
]


def clip_for(language: str, label: str) -> Optional[str]:
    return CLIPS.get(language, {}).get(normalize(label))
