"""Iteration 15: real interpreter clips + video-based sign analysis.

Covers:
- POST /api/translate/text-to-sign: mp4 + webm, cached, Range header (206), Spanish 2D fallback
- GET /api/avatars: includes interpreters list (lifeprint-asl) with clips>0 image_url
- GET /api/media/interpreters/<id>.png: 200 image/png >10KB; unknown → 404
- GET /api/media/avatars/m1.png: 200 image/png
- POST /api/translate/sign-video: multipart with a real clip fixture → 200 + signs (save=false → message None; save=true → message in /api/messages)
- Validation: text/plain upload → 415, tiny 10-byte → 400, no auth → 401
- Regression: POST /api/chat/messages/{mid}/sign-video returns a video_url for an English text message
"""
import os
import time
import pytest
import requests
from pathlib import Path

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

PHONE_A, PHONE_B, CC, OTP = "5550001111", "5550002222", "+52", "123456"
TIMEOUT = 90
SEGMENTS_DIR = Path("/app/backend/media/segments")


# --- helpers ---
def _login(session: requests.Session, phone: str) -> dict:
    r = session.post(f"{API}/auth/send-otp", json={"phone": phone, "country_code": CC}, timeout=15)
    assert r.status_code == 200, r.text
    r = session.post(f"{API}/auth/verify-otp", json={"phone": phone, "country_code": CC, "otp": OTP}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def auth(s):
    data = _login(s, PHONE_A)
    return {"headers": {"Authorization": f"Bearer {data['token']}"}, "user": data["user"]}


@pytest.fixture(scope="module")
def auth_b(s):
    data = _login(s, PHONE_B)
    return {"headers": {"Authorization": f"Bearer {data['token']}"}, "user": data["user"]}


@pytest.fixture(scope="module")
def real_clip_path() -> Path:
    files = sorted(SEGMENTS_DIR.glob("clip-*.mp4"))
    assert files, f"No fixture clips found in {SEGMENTS_DIR}"
    # Prefer the largest one — better chance of a recognisable full sign
    return max(files, key=lambda p: p.stat().st_size)


# ---------------- text-to-sign (real clips concat) ----------------
class TestTextToSignRealClips:

    def test_english_text_returns_mp4_with_ranges(self, s, auth):
        payload = {"text": "Thank you my friend, I need water", "language": "en"}
        t0 = time.time()
        r = s.post(f"{API}/translate/text-to-sign", json=payload, headers=auth["headers"], timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        url = body["video_url"]
        assert url.startswith("/api/media/videos/"), url
        assert url.endswith(".mp4")
        # 32-hex filename
        name = url.rsplit("/", 1)[-1]
        assert len(name) == len("00000000000000000000000000000000.mp4"), name

        # GET full mp4
        r2 = s.get(f"{BASE_URL}{url}", headers=auth["headers"], timeout=TIMEOUT)
        assert r2.status_code == 200, r2.text
        assert r2.headers.get("Accept-Ranges") == "bytes"
        assert int(r2.headers.get("Content-Length", 0)) > 5000
        assert r2.headers.get("Content-Type", "").startswith("video/mp4")

        # Range request → 206
        r3 = s.get(f"{BASE_URL}{url}", headers={**auth["headers"], "Range": "bytes=0-1023"}, timeout=TIMEOUT)
        assert r3.status_code == 206, r3.text
        assert r3.headers.get("Content-Range", "").startswith("bytes 0-1023/")
        assert int(r3.headers.get("Content-Length", 0)) == 1024

        # WebM twin present
        webm_url = url[:-4] + ".webm"
        r4 = s.get(f"{BASE_URL}{webm_url}", headers=auth["headers"], timeout=TIMEOUT)
        assert r4.status_code == 200, r4.text
        assert r4.headers.get("Content-Type", "").startswith("video/webm")

        # 2nd identical request → same cached url, fast
        t1 = time.time()
        r5 = s.post(f"{API}/translate/text-to-sign", json=payload, headers=auth["headers"], timeout=TIMEOUT)
        elapsed = time.time() - t1
        assert r5.status_code == 200
        assert r5.json()["video_url"] == url, "cached video_url mismatch"
        assert elapsed < (time.time() - t0) / 2 + 5, f"cache slower than first render: {elapsed:.1f}s"

    def test_spanish_text_returns_avatar_fallback_video(self, s, auth):
        payload = {"text": "Hola amigo gracias", "language": "es"}
        r = s.post(f"{API}/translate/text-to-sign", json=payload, headers=auth["headers"], timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        url = r.json()["video_url"]
        assert url.endswith(".mp4")
        r2 = s.get(f"{BASE_URL}{url}", headers=auth["headers"], timeout=TIMEOUT)
        assert r2.status_code == 200
        assert int(r2.headers.get("Content-Length", 0)) > 3000


# ---------------- /avatars + interpreter thumbnail ----------------
class TestAvatarsInterpreters:

    def test_avatars_include_interpreters(self, s):
        r = s.get(f"{API}/avatars", timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j.get("items"), list) and len(j["items"]) == 6, len(j.get("items") or [])
        interps = j.get("interpreters")
        assert isinstance(interps, list) and len(interps) >= 1
        entry = next((i for i in interps if i["id"] == "lifeprint-asl"), None)
        assert entry is not None, interps
        assert entry["language"] == "en"
        assert entry["clips"] > 0
        assert entry["image_url"] == "/api/media/interpreters/lifeprint-asl.png"

    def test_interpreter_thumbnail_200(self, s):
        r = s.get(f"{BASE_URL}/api/media/interpreters/lifeprint-asl.png", timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert r.headers.get("Content-Type", "").startswith("image/png")
        assert len(r.content) > 10_000, f"thumbnail too small: {len(r.content)}"

    def test_interpreter_unknown_404(self, s):
        r = s.get(f"{BASE_URL}/api/media/interpreters/unknown-xyz.png", timeout=15)
        assert r.status_code == 404

    def test_avatar_portrait_m1_200(self, s):
        r = s.get(f"{BASE_URL}/api/media/avatars/m1.png", timeout=30)
        assert r.status_code == 200
        assert r.headers.get("Content-Type", "").startswith("image/png")
        assert len(r.content) > 1000


# ---------------- /translate/sign-video (multipart) ----------------
class TestSignVideoUpload:

    def test_sign_video_analysis_no_save(self, s, auth, real_clip_path):
        with real_clip_path.open("rb") as fh:
            files = {"video": (real_clip_path.name, fh, "video/mp4")}
            data = {"language": "en", "save": "false"}
            r = s.post(f"{API}/translate/sign-video", files=files, data=data,
                       headers=auth["headers"], timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        j = r.json()
        assert set(j.keys()) >= {"signs", "text", "frames_analyzed", "message"}
        assert isinstance(j["signs"], list)
        assert isinstance(j["frames_analyzed"], int) and j["frames_analyzed"] > 0
        assert j["message"] is None, "save=false must not persist"

    def test_sign_video_analysis_save_persists_message(self, s, auth, real_clip_path):
        with real_clip_path.open("rb") as fh:
            files = {"video": (real_clip_path.name, fh, "video/mp4")}
            r = s.post(f"{API}/translate/sign-video", files=files,
                       data={"language": "en"},  # save default = true
                       headers=auth["headers"], timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        j = r.json()
        # Only assert message if signs were detected (else backend leaves message=None)
        if j["text"]:
            assert j["message"] is not None, j
            mid = j["message"]["id"]
            assert j["message"]["direction"] == "sign_to_text"
            # GET /messages should include it
            lst = s.get(f"{API}/messages", headers=auth["headers"], timeout=15)
            assert lst.status_code == 200
            ids = [m["id"] for m in lst.json()]
            assert mid in ids, f"stored translator message {mid} not in /messages"
        else:
            pytest.skip("Vision model returned no signs for this clip; message is None as expected.")

    def test_sign_video_text_plain_415(self, s, auth):
        files = {"video": ("bad.txt", b"hello world", "text/plain")}
        r = s.post(f"{API}/translate/sign-video", files=files, data={"language": "en"},
                   headers=auth["headers"], timeout=15)
        assert r.status_code == 415, r.text

    def test_sign_video_tiny_file_400(self, s, auth):
        files = {"video": ("tiny.mp4", b"0" * 10, "video/mp4")}
        r = s.post(f"{API}/translate/sign-video", files=files, data={"language": "en"},
                   headers=auth["headers"], timeout=15)
        assert r.status_code == 400, r.text

    def test_sign_video_no_auth_401(self, s, real_clip_path):
        with real_clip_path.open("rb") as fh:
            files = {"video": (real_clip_path.name, fh, "video/mp4")}
            r = s.post(f"{API}/translate/sign-video", files=files, data={"language": "en"}, timeout=15)
        assert r.status_code == 401, r.text


# ---------------- regression: chat message sign-video ----------------
class TestChatSignVideoRegression:

    def test_chat_english_message_sign_video(self, s, auth, auth_b):
        # Open conversation A→B, send an English text, then request sign-video render
        peer_b_phone = f"{CC}{PHONE_B}"
        r = s.post(f"{API}/chat/conversations", json={"phone": peer_b_phone},
                   headers=auth["headers"], timeout=15)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        r = s.post(f"{API}/chat/conversations/{cid}/messages",
                   json={"kind": "text", "text": "Thank you friend", "language": "en"},
                   headers=auth["headers"], timeout=15)
        assert r.status_code == 200, r.text
        mid = r.json()["id"]

        r2 = s.post(f"{API}/chat/messages/{mid}/sign-video",
                    headers=auth["headers"], timeout=TIMEOUT)
        assert r2.status_code == 200, r2.text
        j = r2.json()
        assert j.get("video_url"), j
        assert j["video_url"].startswith("/api/media/videos/")
        # Fetch it
        r3 = s.get(f"{BASE_URL}{j['video_url']}", headers=auth["headers"], timeout=TIMEOUT)
        assert r3.status_code == 200
        assert r3.headers.get("Content-Type", "").startswith("video/mp4")
