"""
Bimanual gesture library for the 2D sign avatar.

Each gesture = list of keyframes (t in 0..1, left_hand, right_hand). Built from a few motion
primitives so every dictionary word (LSM/ASL) and every phrase word has a two-handed animation.
Matching is accent-insensitive and supports multi-word keys ("por favor", "thank you").
"""
from __future__ import annotations

import math
import unicodedata
from typing import Dict, List, Sequence, Tuple

Point = Tuple[float, float]
Keys = List[Tuple[float, Point, Point]]

REST_L: Point = (150, 430)
REST_R: Point = (330, 430)
CHIN: Point = (260, 190)
MOUTH: Point = (255, 170)
CHEEK: Point = (280, 150)
EAR: Point = (305, 120)
FOREHEAD: Point = (280, 80)
CHEST: Point = (250, 280)
PALM_L: Point = (210, 330)   # non-dominant palm held in front of the body
PALM_R_ON_L: Point = (215, 312)


def normalize(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def _spread(points: Sequence[Point]) -> List[Tuple[float, Point]]:
    n = max(1, len(points) - 1)
    return [(i / n, p) for i, p in enumerate(points)]


def R(*points: Point, left: Point = REST_L) -> Keys:
    """Right (dominant) hand travels through points; left hand static."""
    return [(t, left, p) for t, p in _spread(points)]


def BOTH(left: Sequence[Point], right: Sequence[Point]) -> Keys:
    n = max(len(left), len(right))
    lp = [left[min(i, len(left) - 1)] for i in range(n)]
    rp = [right[min(i, len(right) - 1)] for i in range(n)]
    return [(i / max(1, n - 1), lp[i], rp[i]) for i in range(n)]


def MIRROR(*right: Point) -> Keys:
    """Both hands move symmetrically (mirrored around the body axis)."""
    return BOTH([(480 - p[0], p[1]) for p in right], list(right))


def TAP(p: Point, n: int = 2, lift: float = 28, left: Point = REST_L) -> Keys:
    pts: List[Point] = []
    for _ in range(n):
        pts += [(p[0], p[1] - lift), p]
    return R(*pts, left=left)


def CIRCLE(c: Point, r: float = 30, left: Point = REST_L, steps: int = 9) -> Keys:
    return R(*[(c[0] + r * math.cos(2 * math.pi * i / (steps - 1)), c[1] + r * math.sin(2 * math.pi * i / (steps - 1))) for i in range(steps)], left=left)


def SHAKE(c: Point, dx: float = 22, n: int = 3, left: Point = REST_L) -> Keys:
    pts: List[Point] = []
    for i in range(n):
        pts += [(c[0] - dx, c[1]), (c[0] + dx, c[1])]
    return R(*pts, left=left)


WAVE = R((330, 230), (370, 150), (300, 150), (370, 150), (330, 230))

_GESTURES: Dict[str, Keys] = {
    # greetings
    "hola|hello|hi|adiós|goodbye|bye": WAVE,
    "gracias|thank you|thanks": R(CHIN, CHIN, (330, 300)),
    "buenos días|good morning|buen día|día|day": BOTH([REST_L, REST_L, (240, 300)], [CHIN, (330, 300), (330, 300)]),
    "buenas noches|good night|noche|night": BOTH([(200, 320)], [CHIN, (230, 300), (230, 300)]),
    "mucho gusto|nice to meet|conocerte|meet": BOTH([(170, 300), (230, 290), (230, 290)], [(310, 300), (250, 290), (250, 290)]),
    "hasta luego|see you later|nos vemos|luego|later": R((275, 110), (275, 110), (340, 160)),
    "cuídate|take care|cuidar|care": BOTH([(225, 300)], [(255, 262), (255, 290), (255, 262), (255, 290)]),
    # answers / politeness
    "sí|yes": R((330, 250), (330, 300), (330, 250), (330, 300)),
    "no": R((330, 240), (300, 250), (330, 240)),
    "por favor|please": CIRCLE(CHEST, 36),
    "perdón|sorry|lo siento": CIRCLE((250, 290), 26),
    "amor|love|te quiero|i love you|quiero": BOTH([REST_L, (280, 290), (280, 290)], [REST_R, (200, 290), (200, 290)]),
    "amigo|friend|amiga": BOTH([(200, 300), (240, 280), (240, 300)], [(280, 300), (240, 300), (240, 280)]),
    "familia|family": BOTH([(240, 260), (170, 280), (240, 330)], [(240, 260), (310, 280), (240, 330)]),
    "mamá|mom|mother|madre": TAP((285, 195), lift=18),
    "papá|dad|father|padre": TAP((290, 105), lift=18),
    "casa|house|home": BOTH([(200, 240), (160, 300), (160, 380)], [(280, 240), (320, 300), (320, 380)]),
    # needs
    "comer|eat|comida|food|hambre|hungry": R((300, 260), MOUTH, (300, 260), MOUTH),
    "beber|drink|tomar": R((300, 260), (255, 178), (255, 178), (300, 260)),
    "agua|water": TAP((270, 195), lift=22),
    "ayuda|help|ayudar|ayúdame": BOTH([(240, 340), (240, 280), (240, 280)], [(240, 310), (240, 250), (240, 250)]),
    "baño|bathroom|toilet|restroom": SHAKE((315, 250)),
    "doctor|médico|medico": TAP((205, 302), left=(200, 320)),
    "dinero|money|cuesta|cost|costar|pagar|pay": TAP((215, 306), left=PALM_L),
    "cuánto|how much|cuanto": R(PALM_R_ON_L, (240, 220), (240, 220), left=PALM_L),
    "necesito|need|necesitar|necesitas": TAP((300, 280), lift=40),
    "dar|give|puedes dar|dame": R((280, 280), (350, 260), (350, 260)),
    "dónde|where|donde": SHAKE((315, 220), dx=18),
    "estación|station|lugar|place": BOTH([(190, 300), (190, 300)], [(290, 240), (290, 300)]),
    "cómo llego|llegar|llego|arrive|get to": R((320, 240), PALM_R_ON_L, PALM_R_ON_L, left=PALM_L),
    # everyday
    "trabajo|work|trabajar": TAP((240, 300), left=(240, 330)),
    "escuela|school": TAP((255, 300), left=(225, 320)),
    "hoy|today|ahora|now": MIRROR((290, 260), (290, 320), (290, 260), (290, 320)),
    "mañana|tomorrow": R(CHEEK, CHEEK, (330, 175)),
    "ayer|yesterday": R(CHEEK, CHEEK, EAR),
    "bien|good|buen|buena|bueno|well|fine": R(CHIN, CHIN, (220, 330)),
    "mal|bad|malo": R(CHIN, (290, 270), (310, 300)),
    "feliz|happy|contento": MIRROR((290, 320), (290, 260), (290, 320), (290, 260)),
    "triste|sad": MIRROR((275, 110), (275, 220), (275, 220)),
    "tiempo|time|hora|what time": TAP((205, 300), left=(200, 320)),
    "minutos|minutes|minuto|minute": R(PALM_R_ON_L, (228, 300), (228, 300), left=PALM_L),
    "nombre|name|llamas|llamo": TAP((250, 290), left=(230, 300)),
    "entender|understand|entiendo": R((290, 95), (300, 62), (290, 95), (300, 62)),
    "aprender|learn|aprendiendo|learning|estudiar": R(PALM_R_ON_L, PALM_R_ON_L, FOREHEAD, left=PALM_L),
    "teléfono|phone|telefono|llamar|call": R((330, 250), (292, 140), (292, 140), (292, 140)),
    "cansado|tired": MIRROR((280, 270), (280, 270), (300, 325)),
    "despacio|slow|slowly|lento": R((170, 400), (210, 330), (210, 330), left=(175, 380)),
    "paciencia|patience|paciente": R(MOUTH, (250, 205), (250, 205)),
    "momento|moment|espera|wait": R((215, 300), (240, 312), (215, 322), left=PALM_L),
    # communication
    "cómo|how|como": MIRROR((280, 300), (310, 270), (310, 270)),
    "estás|estas|you|tú|tu|usted|are you|your|tus|su|sus": R((330, 250), (345, 235), (345, 235)),
    "yo|soy|estoy|i|i am|i'm|me|my": R((300, 260), (250, 280), (250, 280)),
    "sordo|deaf|sorda": R(EAR, EAR, MOUTH, MOUTH),
    "escribir|write|escribirlo|escríbelo|escrito": R((200, 314), (232, 314), (200, 314), (232, 314), left=PALM_L),
    "repetir|repeat|otra vez|again": R((280, 260), PALM_R_ON_L, PALM_R_ON_L, left=PALM_L),
    "lengua de señas|sign language|señas|signs|lengua|language|seña|sign": BOTH([(190, 260), (220, 300), (190, 340)], [(290, 340), (260, 300), (290, 260)]),
    "hablar|speak|talk|decir|say": R((272, 182), (305, 200), (272, 182), (305, 200)),
    "puedo|puedes|can|poder|puede": MIRROR((290, 260), (290, 320), (290, 320)),
    "ver|see|mirar|look": R((275, 110), (330, 140), (330, 140)),
    "saber|know": TAP((280, 90), lift=16),
    "what": MIRROR((290, 300), (320, 300), (290, 300)),
    "quién|who": R((250, 175), (250, 195), (250, 175), (250, 195)),
    "cuándo|when|cuando": R((240, 250), (215, 300), (215, 300), left=(210, 310)),
    "gente|people|persona|person": MIRROR((290, 260), (290, 300), (290, 260)),
    "pequeño|small|little|poco": BOTH([(200, 300), (225, 300)], [(280, 300), (255, 300)]),
    "uno|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten|cien|hundred|mil|thousand": R((330, 250), (335, 215), (335, 215), (335, 215)),
    "grande|big|mucho|much|many": BOTH([(225, 300), (170, 300)], [(255, 300), (310, 300)]),
}

WORD_GESTURES: Dict[str, Keys] = {}
for _keys, _g in _GESTURES.items():
    for _k in _keys.split("|"):
        WORD_GESTURES[normalize(_k)] = _g

MAX_PHRASE_WORDS = max(len(k.split()) for k in WORD_GESTURES)

# Function words dropped in sign language (articles, prepositions, copulas) — never fingerspelled.
STOPWORDS = {normalize(w) for w in (
    "el la los las un una unos unas de del a al en con por para y o u que lo le les se su sus mi tu te "
    "es está están son ser estar hay este esta esto ese esa eso tengas tenga tener ha he han "
    "the a an to of in on at for and or is are am be been it this that these those there some any do does did "
    "i'm i'll it's you're we're shall will would can't don't".split()
)}
