"""Phase 1: burst-based ASL sign recognition — POST /api/translate/sign-frame.

Covers:
- ordered burst of 3-4 real ASL photos → {sign, confidence, motion, frames_analyzed}
- legacy body {image_base64: ...} still works, frames_analyzed=1
- validation: 0 frames → 422, >5 frames → 422
- data:image/... prefixes accepted
- unauth → 401
- regression: /translate/sign-to-text
"""
import base64
import os
import pytest
import requests
from pathlib import Path

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
FIX = Path(__file__).parent / "fixtures"

PHONE, CC = "5550001111", "+52"
OTP = "123456"
TIMEOUT = 30


def _b64(name: str) -> str:
    return base64.b64encode((FIX / name).read_bytes()).decode()


# --- fixtures ---
@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def auth(s):
    r = s.post(f"{API}/auth/send-otp", json={"phone": PHONE, "country_code": CC}, timeout=15)
    assert r.status_code == 200, r.text
    r = s.post(f"{API}/auth/verify-otp", json={"phone": PHONE, "country_code": CC, "otp": OTP}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    return {"headers": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def frames():
    return {k: _b64(f"asl_{k.lower()}.jpg") for k in ["B", "L", "W", "Y"]}


# --- burst tests ---
class TestSignFrameBurst:

    def test_burst_W_static(self, s, auth, frames):
        payload = {"frames": [frames["W"]] * 4, "language": "en", "previous": []}
        r = s.post(f"{API}/translate/sign-frame", json=payload, headers=auth["headers"], timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        j = r.json()
        assert set(j.keys()) >= {"sign", "confidence", "motion", "frames_analyzed"}
        assert j["frames_analyzed"] == 4
        assert j["motion"] in ("static", "dynamic", "none")
        # Primary expectation: W static ≥ 0.5
        assert j["sign"] == "W", f"expected W got {j['sign']}"
        assert j["confidence"] >= 0.5, f"low confidence: {j['confidence']}"
        assert j["motion"] == "static", f"expected static got {j['motion']}"

    def test_burst_L_static_3frames(self, s, auth, frames):
        payload = {"frames": [frames["L"]] * 3, "language": "en"}
        r = s.post(f"{API}/translate/sign-frame", json=payload, headers=auth["headers"], timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["frames_analyzed"] == 3
        assert j["sign"] == "L", f"expected L got {j['sign']}"
        assert j["motion"] == "static"

    def test_burst_mixed_BLY(self, s, auth, frames):
        payload = {"frames": [frames["B"], frames["L"], frames["Y"]], "language": "en"}
        r = s.post(f"{API}/translate/sign-frame", json=payload, headers=auth["headers"], timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["frames_analyzed"] == 3
        assert set(j.keys()) >= {"sign", "confidence", "motion", "frames_analyzed"}
        assert j["motion"] in ("dynamic", "static", "none")

    def test_legacy_single_image_base64(self, s, auth, frames):
        payload = {"image_base64": frames["Y"], "language": "en"}
        r = s.post(f"{API}/translate/sign-frame", json=payload, headers=auth["headers"], timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["frames_analyzed"] == 1
        assert j["sign"] == "Y", f"expected Y got {j['sign']}"

    def test_data_url_prefix_accepted(self, s, auth, frames):
        payload = {"frames": [f"data:image/jpeg;base64,{frames['W']}"] * 3, "language": "en"}
        r = s.post(f"{API}/translate/sign-frame", json=payload, headers=auth["headers"], timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["frames_analyzed"] == 3

    # --- validation ---
    def test_empty_body_422(self, s, auth):
        r = s.post(f"{API}/translate/sign-frame", json={"frames": [], "language": "en"}, headers=auth["headers"], timeout=15)
        assert r.status_code == 422, r.text

    def test_too_many_frames_422(self, s, auth, frames):
        payload = {"frames": [frames["W"]] * 6, "language": "en"}
        r = s.post(f"{API}/translate/sign-frame", json=payload, headers=auth["headers"], timeout=15)
        assert r.status_code == 422, r.text

    def test_unauthenticated_401(self, s, frames):
        payload = {"frames": [frames["W"]] * 3, "language": "en"}
        r = s.post(f"{API}/translate/sign-frame", json=payload, timeout=15)
        assert r.status_code == 401, r.text


# --- regression: sign-to-text ---
class TestSignToTextRegression:

    def test_single_letter_W(self, s, auth):
        r = s.post(f"{API}/translate/sign-to-text", json={"language": "en", "signs": ["W"]}, headers=auth["headers"], timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["translated_text"] == "W"
        assert j["direction"] == "sign_to_text"
        assert "_id" not in j

    def test_empty_signs_422(self, s, auth):
        r = s.post(f"{API}/translate/sign-to-text", json={"language": "en", "signs": []}, headers=auth["headers"], timeout=15)
        assert r.status_code == 422, r.text
