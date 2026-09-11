"""SignBridge backend API tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://sign-talk-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

PHONE = "5551234999"
CC = "+1"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def auth(s):
    r = s.post(f"{API}/auth/send-otp", json={"phone": PHONE, "country_code": CC}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json().get("mock_otp") == "123456"
    r = s.post(f"{API}/auth/verify-otp", json={"phone": PHONE, "country_code": CC, "otp": "123456"}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    return {"token": data["token"], "user": data["user"], "headers": {"Authorization": f"Bearer {data['token']}"}}


# --- AUTH ---
def test_send_otp(s):
    r = s.post(f"{API}/auth/send-otp", json={"phone": PHONE, "country_code": CC})
    assert r.status_code == 200
    j = r.json()
    assert j["success"] is True
    assert j["mock_otp"] == "123456"


def test_verify_otp_invalid(s):
    r = s.post(f"{API}/auth/verify-otp", json={"phone": PHONE, "country_code": CC, "otp": "000000"})
    assert r.status_code == 400


def test_verify_otp_valid_returns_token_user(auth):
    assert auth["token"]
    assert "_id" not in auth["user"]
    assert auth["user"]["phone"] == f"{CC}{PHONE}"


def test_me(s, auth):
    r = s.get(f"{API}/auth/me", headers=auth["headers"])
    assert r.status_code == 200
    j = r.json()
    assert j["id"] == auth["user"]["id"]
    assert "_id" not in j


def test_me_unauth(s):
    r = s.get(f"{API}/auth/me")
    assert r.status_code == 401


def test_onboard(s, auth):
    payload = {"name": "TEST_User", "language": "en", "photo_url": "https://example.com/x.png"}
    r = s.post(f"{API}/auth/onboard", json=payload, headers=auth["headers"])
    assert r.status_code == 200
    j = r.json()
    assert j["name"] == "TEST_User"
    assert j["language"] == "en"
    assert j["onboarded"] is True
    # verify via GET
    r2 = s.get(f"{API}/auth/me", headers=auth["headers"])
    assert r2.json()["onboarded"] is True


def test_profile_patch(s, auth):
    r = s.patch(f"{API}/auth/profile", json={"name": "TEST_Updated", "language": "es"}, headers=auth["headers"])
    assert r.status_code == 200
    j = r.json()
    assert j["name"] == "TEST_Updated"
    assert j["language"] == "es"


# --- DICTIONARY ---
def test_dictionary_es(s):
    r = s.get(f"{API}/dictionary", params={"language": "es"})
    assert r.status_code == 200
    items = r.json()
    letters = [i for i in items if i["kind"] == "letter"]
    words = [i for i in items if i["kind"] == "word"]
    assert len(letters) == 27, f"ES letters: {len(letters)}"
    assert len(words) == 8, f"ES words: {len(words)}"
    assert len(items) == 35


def test_dictionary_en(s):
    r = s.get(f"{API}/dictionary", params={"language": "en"})
    assert r.status_code == 200
    items = r.json()
    letters = [i for i in items if i["kind"] == "letter"]
    words = [i for i in items if i["kind"] == "word"]
    assert len(letters) == 26, f"EN letters: {len(letters)}"
    assert len(words) == 8, f"EN words: {len(words)}"
    assert len(items) == 34


def test_dictionary_letter_filter(s):
    r = s.get(f"{API}/dictionary", params={"language": "en", "letter": "A"})
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    assert all(i["label"].upper().startswith("A") for i in items)


def test_dictionary_q_filter(s):
    r = s.get(f"{API}/dictionary", params={"language": "en", "q": "Hello"})
    assert r.status_code == 200
    items = r.json()
    assert any("Hello" in i["label"] for i in items)


def test_dictionary_no_mongo_id(s):
    r = s.get(f"{API}/dictionary", params={"language": "en"})
    for it in r.json():
        assert "_id" not in it


# --- TRANSLATE ---
def test_sign_to_text(s, auth):
    r = s.post(f"{API}/translate/sign-to-text", json={"language": "es", "hint": "greeting"}, headers=auth["headers"], timeout=45)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["direction"] == "sign_to_text"
    assert j["translated_text"]
    assert "_id" not in j


def test_text_to_sign(s, auth):
    r = s.post(f"{API}/translate/text-to-sign", json={"text": "Hola", "language": "es"}, headers=auth["headers"])
    assert r.status_code == 200
    j = r.json()
    assert j["direction"] == "text_to_sign"
    assert j["sign_sequence"] == ["H", "O", "L", "A"]


def test_messages_list_and_clear(s, auth):
    r = s.get(f"{API}/messages", headers=auth["headers"])
    assert r.status_code == 200
    assert len(r.json()) >= 2
    r = s.delete(f"{API}/messages", headers=auth["headers"])
    assert r.status_code == 200
    r = s.get(f"{API}/messages", headers=auth["headers"])
    assert r.json() == []


# --- TTS (best-effort) ---
def test_tts_flow(s, auth):
    r = s.post(f"{API}/tts", json={"text": "Hello world", "voice": "nova"}, headers=auth["headers"], timeout=45)
    if r.status_code == 500:
        pytest.skip(f"TTS 500 (Emergent LLM balance): {r.text}")
    assert r.status_code == 200
    url = r.json()["url"]
    assert url.startswith("/api/tts/")
    r2 = s.get(f"{BASE_URL}{url}", timeout=15)
    assert r2.status_code == 200
    assert r2.headers.get("content-type", "").startswith("audio/mpeg")
    assert len(r2.content) > 0
