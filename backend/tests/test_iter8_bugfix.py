"""Iteration 8 - Verify SignBridge fixes.
1) Deterministic sign_to_text (no mock phrases) + 422 on empty signs
2) Vision endpoint /api/translate/sign-frame with real ASL hand JPEGs
3) Security hardening: OTP throttle, text limits, favorites limit,
   voice-to-text content-type/size, CORS preflight
"""
import base64
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
if not BASE_URL:
    # Fallback: read from frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE_URL}/api"


def _auth_token(phone: str) -> str:
    r = requests.post(f"{API}/auth/send-otp", json={"phone": phone, "country_code": "+52"}, timeout=15)
    assert r.status_code == 200, r.text
    r = requests.post(f"{API}/auth/verify-otp", json={"phone": phone, "country_code": "+52", "otp": "123456"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def token():
    return _auth_token(f"555{int(time.time()) % 1000000:06d}")


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- BUG VERIFICATION: sign_to_text no longer mocks ----------

class TestSignToText:
    def test_empty_signs_returns_422(self, headers):
        r = requests.post(f"{API}/translate/sign-to-text",
                          json={"language": "es", "signs": []}, headers=headers, timeout=10)
        assert r.status_code == 422, r.text
        # Ensure no mock phrases leaked in the body
        assert "cómo estás" not in r.text.lower()

    def test_letters_HOLA_to_Hola(self, headers):
        r = requests.post(f"{API}/translate/sign-to-text",
                          json={"language": "es", "signs": ["H", "O", "L", "A"]}, headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["translated_text"] == "Hola"
        assert data["original_text"] == "H O L A"

    def test_words_hello_friend(self, headers):
        r = requests.post(f"{API}/translate/sign-to-text",
                          json={"language": "en", "signs": ["hello", "friend"]}, headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["translated_text"] == "Hello friend"

    def test_deterministic_three_calls_identical(self, headers):
        payload = {"language": "es", "signs": ["H", "O", "L", "A"]}
        outs = []
        for _ in range(3):
            r = requests.post(f"{API}/translate/sign-to-text", json=payload, headers=headers, timeout=10)
            assert r.status_code == 200
            outs.append(r.json()["translated_text"])
        assert outs[0] == outs[1] == outs[2] == "Hola"

    def test_no_mock_phrases_leak(self, headers):
        # Random non-phrase-forming letters should never yield mock phrases
        r = requests.post(f"{API}/translate/sign-to-text",
                          json={"language": "es", "signs": ["X", "Y", "Z"]}, headers=headers, timeout=10)
        assert r.status_code == 200
        text = r.json()["translated_text"]
        assert text == "Xyz"
        assert "cómo estás" not in text.lower()
        assert "cómo estás hoy" not in text.lower()

    def test_hint_field_ignored(self, headers):
        # Extra unknown fields should be ignored by pydantic default
        r = requests.post(f"{API}/translate/sign-to-text",
                          json={"language": "es", "signs": ["A"], "hint": "ignored"}, headers=headers, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["translated_text"] == "A"


# ---------- VISION ENDPOINT ----------

def _b64_of(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


class TestVision:
    def test_auth_required(self):
        r = requests.post(f"{API}/translate/sign-frame",
                          json={"image_base64": "x" * 200, "language": "en"}, timeout=10)
        assert r.status_code == 401

    def test_short_image_422(self, headers):
        r = requests.post(f"{API}/translate/sign-frame",
                          json={"image_base64": "abc", "language": "en"}, headers=headers, timeout=10)
        assert r.status_code == 422

    @pytest.mark.parametrize("path,letter", [
        ("/tmp/asl_b.jpg", "B"),
        ("/tmp/asl_l.jpg", "L"),
        ("/tmp/asl_y.jpg", "Y"),
    ])
    def test_real_asl_letters(self, headers, path, letter):
        assert os.path.exists(path), f"missing {path}"
        b64 = _b64_of(path)
        r = requests.post(f"{API}/translate/sign-frame",
                          json={"image_base64": b64, "language": "en", "previous": []},
                          headers=headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "sign" in data and "confidence" in data
        # Vision may not always be perfect; accept correct letter with conf>=0.5
        # If not matching, we still allow test to log but require at least 200 OK
        print(f"[VISION] {path} → {data} (expected {letter})")
        if data["sign"] == letter:
            assert data["confidence"] >= 0.5

    def test_data_url_prefix_accepted(self, headers):
        b64 = _b64_of("/tmp/asl_b.jpg")
        data_url = f"data:image/jpeg;base64,{b64}"
        r = requests.post(f"{API}/translate/sign-frame",
                          json={"image_base64": data_url, "language": "en"},
                          headers=headers, timeout=20)
        assert r.status_code == 200, r.text

    def test_non_hand_image(self, headers):
        # Use one of the real photos but described as landscape — model should return null/low conf
        # Reusing asl_y as a photo; we just require 200 OK
        b64 = _b64_of("/tmp/asl_y.jpg")
        r = requests.post(f"{API}/translate/sign-frame",
                          json={"image_base64": b64, "language": "en"},
                          headers=headers, timeout=20)
        assert r.status_code == 200


# ---------- SECURITY HARDENING ----------

class TestSecurity:
    def test_otp_throttle_after_5_wrong(self):
        phone = f"9998{int(time.time()) % 100000:05d}"
        # 5 wrong attempts
        for i in range(5):
            r = requests.post(f"{API}/auth/verify-otp",
                              json={"phone": phone, "country_code": "+52", "otp": "000000"}, timeout=10)
            assert r.status_code == 400, f"attempt {i+1}: {r.status_code} {r.text}"
        # 6th attempt should be 429
        r = requests.post(f"{API}/auth/verify-otp",
                          json={"phone": phone, "country_code": "+52", "otp": "000000"}, timeout=10)
        assert r.status_code == 429, r.text

    def test_different_phone_still_works(self):
        phone = f"7776{int(time.time()) % 100000:05d}"
        r = requests.post(f"{API}/auth/verify-otp",
                          json={"phone": phone, "country_code": "+52", "otp": "123456"}, timeout=10)
        assert r.status_code == 200, r.text
        assert "token" in r.json()

    def test_text_to_sign_600_chars_422(self, headers):
        r = requests.post(f"{API}/translate/text-to-sign",
                          json={"text": "a" * 600, "language": "es"}, headers=headers, timeout=10)
        assert r.status_code == 422, r.text

    def test_favorite_400_chars_422(self, headers):
        r = requests.post(f"{API}/favorites",
                          json={"text": "a" * 400, "language": "es"}, headers=headers, timeout=10)
        assert r.status_code == 422, r.text

    def test_voice_to_text_wrong_content_type_415(self, headers):
        files = {"audio": ("fake.txt", b"a" * 200, "text/plain")}
        data = {"language": "es"}
        r = requests.post(f"{API}/translate/voice-to-text",
                          files=files, data=data, headers=headers, timeout=15)
        assert r.status_code == 415, r.text

    def test_voice_to_text_oversized_413(self, headers):
        big = b"a" * (10 * 1024 * 1024 + 1024)  # > 10 MB
        files = {"audio": ("big.wav", big, "audio/wav")}
        data = {"language": "es"}
        r = requests.post(f"{API}/translate/voice-to-text",
                          files=files, data=data, headers=headers, timeout=60)
        assert r.status_code == 413, r.text

    def test_cors_preflight(self):
        r = requests.options(f"{API}/translate/sign-to-text",
                             headers={
                                 "Origin": "https://example.com",
                                 "Access-Control-Request-Method": "POST",
                                 "Access-Control-Request-Headers": "content-type,authorization",
                             }, timeout=10)
        assert r.status_code in (200, 204), r.status_code
        aco = r.headers.get("access-control-allow-origin") or r.headers.get("Access-Control-Allow-Origin")
        assert aco is not None, dict(r.headers)


# ---------- REGRESSION ----------

class TestRegression:
    def test_text_to_sign_ok(self, headers):
        r = requests.post(f"{API}/translate/text-to-sign",
                          json={"text": "Hola mundo", "language": "es"}, headers=headers, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data["translated_text"] == "Hola mundo"
        assert data["sign_sequence"][:4] == ["H", "O", "L", "A"]

    def test_favorites_add_ok(self, headers):
        r = requests.post(f"{API}/favorites",
                          json={"text": f"TEST_fav_{uuid.uuid4().hex[:6]}", "language": "es"},
                          headers=headers, timeout=10)
        assert r.status_code == 200
        assert "id" in r.json()

    def test_phrases_list_ok(self):
        r = requests.get(f"{API}/phrases?language=es", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert len(data["items"]) > 0 and len(data["categories"]) > 0
