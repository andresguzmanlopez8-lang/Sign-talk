"""Phase 2 tests: avatar catalog, avatar_id persistence, text-to-sign MP4 rendering, byte-range serving."""
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://sign-talk-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TEST_PHONE = "5550002222"
CC = "+52"
OTP = "123456"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def token():
    s = requests.Session()
    r = s.post(f"{API}/auth/send-otp", json={"country_code": CC, "phone": TEST_PHONE}, timeout=15)
    assert r.status_code == 200, r.text
    r = s.post(f"{API}/auth/verify-otp", json={"country_code": CC, "phone": TEST_PHONE, "otp": OTP}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- /api/avatars ----------
class TestAvatars:
    def test_list_all(self):
        r = requests.get(f"{API}/avatars", timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["default_id"] == "f1"
        assert len(j["items"]) == 6
        for item in j["items"]:
            for k in ("id", "gender", "name", "style", "image_url"):
                assert k in item, f"missing {k}"
            assert item["image_url"].startswith("http")
            assert item["gender"] in {"male", "female"}

    def test_filter_male(self):
        r = requests.get(f"{API}/avatars?gender=male", timeout=10)
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 3
        assert all(i["gender"] == "male" for i in items)

    def test_filter_female(self):
        r = requests.get(f"{API}/avatars?gender=female", timeout=10)
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) == 3
        assert all(i["gender"] == "female" for i in items)


# ---------- PATCH /auth/profile avatar_id ----------
class TestAvatarProfile:
    def test_set_valid_avatar(self, auth):
        r = requests.patch(f"{API}/auth/profile", json={"avatar_id": "m3"}, headers=auth, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("avatar_id") == "m3"

    def test_me_returns_avatar(self, auth):
        r = requests.get(f"{API}/auth/me", headers=auth, timeout=10)
        assert r.status_code == 200
        assert r.json().get("avatar_id") == "m3"

    def test_invalid_avatar_returns_400(self, auth):
        r = requests.patch(f"{API}/auth/profile", json={"avatar_id": "zzz"}, headers=auth, timeout=10)
        assert r.status_code == 400


VIDEO_URL_RE = re.compile(r"^/api/media/videos/[a-f0-9]{32}\.mp4$")


# ---------- POST /translate/text-to-sign ----------
class TestTextToSign:
    def test_text_to_sign_sol_m3(self, auth):
        r = requests.post(f"{API}/translate/text-to-sign", json={"text": "Sol", "language": "es"}, headers=auth, timeout=120)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("avatar_id") == "m3"
        vurl = j.get("video_url")
        assert vurl and VIDEO_URL_RE.match(vurl), f"unexpected video_url: {vurl}"
        pytest.first_video_url = vurl  # stash for cache test

    def test_get_video_full(self, auth):
        vurl = getattr(pytest, "first_video_url", None)
        assert vurl, "prior test failed"
        r = requests.get(f"{BASE_URL}{vurl}", headers=auth, timeout=30)
        assert r.status_code == 200
        assert r.headers.get("Content-Type", "").startswith("video/mp4")
        assert int(r.headers.get("Content-Length", "0")) > 0
        assert r.headers.get("Accept-Ranges") == "bytes"
        assert len(r.content) > 0

    def test_get_video_range(self, auth):
        vurl = getattr(pytest, "first_video_url", None)
        r = requests.get(f"{BASE_URL}{vurl}", headers={**auth, "Range": "bytes=0-99"}, timeout=30)
        assert r.status_code == 206
        assert r.headers.get("Content-Range", "").startswith("bytes 0-99/")
        assert int(r.headers.get("Content-Length", "0")) == 100
        assert len(r.content) == 100

    def test_get_webm_twin(self, auth):
        vurl = getattr(pytest, "first_video_url", None)
        webm = vurl.replace(".mp4", ".webm")
        r = requests.get(f"{BASE_URL}{webm}", headers=auth, timeout=30)
        assert r.status_code == 200
        assert r.headers.get("Content-Type", "").startswith("video/webm")
        assert len(r.content) > 0

    def test_invalid_video_name_404(self, auth):
        r = requests.get(f"{API}/media/videos/abc.mp4", headers=auth, timeout=10)
        assert r.status_code == 404

    def test_cached_second_call_fast(self, auth):
        t0 = time.time()
        r = requests.post(f"{API}/translate/text-to-sign", json={"text": "Sol", "language": "es"}, headers=auth, timeout=30)
        dt = time.time() - t0
        assert r.status_code == 200
        assert r.json().get("video_url") == getattr(pytest, "first_video_url")
        assert dt < 5, f"cached call took {dt:.2f}s"

    def test_different_avatar_different_url(self, auth):
        # switch to f2
        r = requests.patch(f"{API}/auth/profile", json={"avatar_id": "f2"}, headers=auth, timeout=10)
        assert r.status_code == 200 and r.json()["avatar_id"] == "f2"
        r = requests.post(f"{API}/translate/text-to-sign", json={"text": "Sol", "language": "es"}, headers=auth, timeout=120)
        assert r.status_code == 200
        vurl2 = r.json().get("video_url")
        assert vurl2 and VIDEO_URL_RE.match(vurl2)
        assert vurl2 != getattr(pytest, "first_video_url"), "different avatar should produce different key"
        # restore m3 for next tests
        requests.patch(f"{API}/auth/profile", json={"avatar_id": "m3"}, headers=auth, timeout=10)

    def test_english_water(self, auth):
        r = requests.post(f"{API}/translate/text-to-sign", json={"text": "Water", "language": "en"}, headers=auth, timeout=120)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("video_url") and VIDEO_URL_RE.match(j["video_url"])
        assert j.get("avatar_id") == "m3"


# ---------- regression ----------
class TestSignToTextRegression:
    def test_sol_letters(self, auth):
        r = requests.post(f"{API}/translate/sign-to-text",
                          json={"signs": ["S", "O", "L"], "language": "es"},
                          headers=auth, timeout=60)
        assert r.status_code == 200, r.text
        assert r.json().get("translated_text", "").strip().lower() == "sol"
