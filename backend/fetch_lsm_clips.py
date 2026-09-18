"""
Build the LSM (Mexican Sign Language) real-interpreter clip catalog from Spread the Sign (es.mx).
Run once (or when vocabulary grows):  python fetch_lsm_clips.py  →  writes clips_es.json
Only exact word/phrase matches are accepted (slug == normalized query).
"""
import json
import re
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from gestures import normalize  # noqa: E402

BASE = "https://www.spreadthesign.com"
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36", "Accept-Language": "es-MX,es;q=0.9"}
OUT = Path(__file__).parent / "clips_es.json"

VOCAB_ES = [
    "hola", "gracias", "sí", "no", "por favor", "perdón", "lo siento", "amor", "amigo", "familia", "mamá", "papá", "casa",
    "comer", "beber", "agua", "ayuda", "ayudar", "baño", "doctor", "dinero", "tiempo", "nombre", "entender", "aprender",
    "teléfono", "cansado", "despacio", "trabajo", "escuela", "hoy", "mañana", "ayer", "bien", "mal", "feliz", "triste",
    "buenos días", "buenas noches", "adiós", "dónde", "cómo", "necesitar", "necesito", "hambre", "poder", "puedo", "dar",
    "cuánto", "costar", "cuesta", "sordo", "escribir", "repetir", "lengua de señas", "señas", "hablar", "momento", "hora",
    "llegar", "minuto", "minutos", "paciencia", "estación", "te quiero", "día", "noche", "mucho gusto", "hasta luego",
    "cuídate", "ver", "saber", "qué", "quién", "cuándo", "gente", "persona", "pequeño", "grande", "yo", "tú", "usted",
    "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "esperar", "otra vez", "decir",
    "mucho", "poco", "comida", "madre", "padre", "estudiar", "llamar", "lento", "contento", "médico", "lugar", "ahora",
    "bueno", "malo", "pagar", "nos vemos", "cuidar", "dame", "amiga", "hogar", "tomar",
]


def find_clip(word: str):
    q = normalize(word)
    s = requests.get(f"{BASE}/es.mx/search/", params={"q": word}, headers=H, timeout=25)
    s.raise_for_status()
    seen = set()
    for wid, slug in re.findall(r'href="/es\.mx/word/(\d+)/([^/"]+)/(?:\d+/)?\?q=', s.text):
        if (wid, slug) in seen:
            continue
        seen.add((wid, slug))
        norm_slug = normalize(slug.replace("-", " "))
        if norm_slug == q or re.fullmatch(r"\d+ " + re.escape(q), norm_slug):
            p = requests.get(f"{BASE}/es.mx/word/{wid}/{slug}/", headers=H, timeout=25)
            m = re.search(r'(https://media\.spreadthesign\.com/video/mp4/\d+/\d+\.mp4)', p.text)
            if m:
                return {"url": m.group(1), "page": f"{BASE}/es.mx/word/{wid}/{slug}/"}
    return None


def main():
    found = json.loads(OUT.read_text()) if OUT.exists() else {}
    for w in VOCAB_ES:
        key = normalize(w)
        if key in found:
            continue
        try:
            clip = find_clip(w)
        except Exception as e:  # network hiccup → skip, rerun later
            print("ERR", w, e)
            continue
        if clip:
            found[key] = clip
            print("OK ", w, "->", clip["url"])
        else:
            print("--- no exact match:", w)
        time.sleep(0.4)
    OUT.write_text(json.dumps(found, ensure_ascii=False, indent=1))
    print(f"saved {len(found)} LSM clips → {OUT}")


if __name__ == "__main__":
    main()
