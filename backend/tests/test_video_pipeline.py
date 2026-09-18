"""Backend tests for SignBridge video pipeline iteration (Jan 2026):
- POST /api/translate/sign-video (full video analysis)
- POST /api/translate/text-to-sign (real interpreter clip + 2D fallback concat)
- GET  /api/avatars (avatars + interpreters catalog)
- Media endpoints for interpreter/avatar thumbnails
- Regressions: sign-frame, sign-to-text, chat sign-video
"""
from __future__ import annotations

import io
import os
import re
import base64
import subprocess
import pathlib
import time
from typing import Dict

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
if not BASE_URL:
    # fallback to preview host reading env from frontend/.env
    env_txt = pathlib.Path("/app/frontend/.env").read_text()
    m = re.search(r"EXPO_PUBLIC_BACKEND_URL=(\S+)", env_txt)
    assert m, "Missing EXPO_PUBLIC_BACKEND_URL"
    BASE_URL = m.group(1).rstrip("/")

API = f"{BASE_URL}/api"
PHONE_A = "+525550001111"
PHONE_B = "+525550002222"
OTP = "123456"


# --------- utils ---------

def _ffmpeg_bin() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def _make_testsrc_mp4(path: pathlib.Path, duration: int = 3, size: str = "320x240") -> pathlib.Path:
    """Generate a small H.264 MP4 with ffmpeg testsrc pattern."""
    subprocess.run(
        [
            _ffmpeg_bin(), "-y", "-f", "lavfi", "-i", f"testsrc=duration={duration}:size={size}:rate=15",
            "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", str(path),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return path


def _ffprobe(path: pathlib.Path) -> str:
    """Return combined ffmpeg -i stderr output for probing."""
    p = subprocess.run(
        [_ffmpeg_bin(), "-i", str(path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    return p.stderr.decode("utf-8", errors="ignore")


# --------- fixtures ---------

@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


def _split_phone(full: str) -> Dict[str, str]:
    # +525550001111 → cc=+52, phone=5550001111
    return {"country_code": "+52", "phone": full.replace("+52", "")}


def _login(session: requests.Session, phone: str) -> Dict:
    parts = _split_phone(phone)
    r = session.post(f"{API}/auth/send-otp", json=parts)
    assert r.status_code == 200, f"send-otp: {r.status_code} {r.text}"
    r = session.post(f"{API}/auth/verify-otp", json={**parts, "otp": OTP})
    assert r.status_code == 200, f"verify-otp: {r.status_code} {r.text}"
    data = r.json()
    return data


@pytest.fixture(scope="session")
def user_a(api):
    d = _login(api, PHONE_A)
    return {"token": d["token"], "id": d["user"]["id"]}


@pytest.fixture(scope="session")
def user_b(api):
    # separate session for B (independent Authorization header)
    s2 = requests.Session()
    d = _login(s2, PHONE_B)
    return {"token": d["token"], "id": d["user"]["id"], "session": s2}


@pytest.fixture(scope="session")
def auth_headers(user_a):
    return {"Authorization": f"Bearer {user_a['token']}"}


@pytest.fixture(scope="session")
def tmp_clip(tmp_path_factory) -> pathlib.Path:
    """Reuse a real interpreter segment if available (better content), else fabricate testsrc."""
    seg_dir = pathlib.Path("/app/backend/media/segments")
    real = next(iter(sorted(seg_dir.glob("*.mp4"))), None) if seg_dir.exists() else None
    if real and real.stat().st_size > 1000:
        return real
    tmp = tmp_path_factory.mktemp("clips") / "test.mp4"
    return _make_testsrc_mp4(tmp)


# --------- POST /api/translate/sign-video ---------

class TestSignVideo:
    def test_sign_video_ok_save_false(self, api, auth_headers, tmp_clip):
        with open(tmp_clip, "rb") as f:
            r = api.post(
                f"{API}/translate/sign-video",
                headers=auth_headers,
                files={"video": ("clip.mp4", f, "video/mp4")},
                data={"language": "en", "save": "false"},
                timeout=120,
            )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        j = r.json()
        assert "signs" in j and isinstance(j["signs"], list)
        assert "text" in j
        assert j.get("frames_analyzed", 0) > 0
        # save=false → message must be null even if text non-empty
        assert j["message"] is None

    def test_sign_video_ok_save_true(self, api, auth_headers, tmp_clip):
        with open(tmp_clip, "rb") as f:
            r = api.post(
                f"{API}/translate/sign-video",
                headers=auth_headers,
                files={"video": ("clip.mp4", f, "video/mp4")},
                data={"language": "en", "save": "true"},
                timeout=120,
            )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        j = r.json()
        assert j.get("frames_analyzed", 0) > 0
        # message: object only when text non-empty
        if j.get("text"):
            assert isinstance(j.get("message"), dict)
            assert j["message"].get("direction") == "sign_to_text"
        else:
            assert j.get("message") is None

    def test_sign_video_bad_content_type(self, api, auth_headers):
        r = api.post(
            f"{API}/translate/sign-video",
            headers=auth_headers,
            files={"video": ("notes.txt", io.BytesIO(b"hello world" * 200), "text/plain")},
            data={"language": "en", "save": "false"},
            timeout=30,
        )
        assert r.status_code == 415, f"{r.status_code} {r.text}"

    def test_sign_video_too_small(self, api, auth_headers):
        r = api.post(
            f"{API}/translate/sign-video",
            headers=auth_headers,
            files={"video": ("tiny.mp4", io.BytesIO(b"\x00" * 200), "video/mp4")},
            data={"language": "en", "save": "false"},
            timeout=30,
        )
        assert r.status_code == 400, f"{r.status_code} {r.text}"

    def test_sign_video_unauthorized(self, api, tmp_clip):
        with open(tmp_clip, "rb") as f:
            r = api.post(
                f"{API}/translate/sign-video",
                files={"video": ("clip.mp4", f, "video/mp4")},
                data={"language": "en", "save": "false"},
                timeout=30,
            )
        # FastAPI HTTPBearer auto_error → 401 or 403
        assert r.status_code in (401, 403), f"{r.status_code} {r.text}"


# --------- POST /api/translate/text-to-sign ---------

class TestTextToSign:
    def test_text_to_sign_en_real_clip(self, api, auth_headers, tmp_path):
        payload = {"text": "Thank you my friend, I need water", "language": "en"}
        r = api.post(f"{API}/translate/text-to-sign", headers=auth_headers, json=payload, timeout=180)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        j = r.json()
        assert j.get("video_url", "").startswith("/api/media/videos/")
        assert j["video_url"].endswith(".mp4")
        # Fetch mp4
        v = api.get(f"{BASE_URL}{j['video_url']}", timeout=60)
        assert v.status_code == 200
        assert v.headers.get("Content-Type", "").startswith("video/mp4")
        assert len(v.content) > 1000

        # Fetch webm twin
        webm_url = j["video_url"].replace(".mp4", ".webm")
        w = api.get(f"{BASE_URL}{webm_url}", timeout=60)
        assert w.status_code == 200, f"webm: {w.status_code}"
        assert w.headers.get("Content-Type", "").startswith("video/webm")

        # Range request → 206
        rr = api.get(f"{BASE_URL}{j['video_url']}", headers={"Range": "bytes=0-1023"}, timeout=30)
        assert rr.status_code == 206, f"range: {rr.status_code}"

        # ffprobe verify h264 baseline, 480x480, 15 fps, duration > 5s
        out = tmp_path / "out.mp4"
        out.write_bytes(v.content)
        info = _ffprobe(out)
        assert "h264" in info.lower(), f"expected h264 codec, got: {info[:400]}"
        assert "480x480" in info, f"expected 480x480: {info[:400]}"
        # fps
        m_fps = re.search(r"(\d+(?:\.\d+)?)\s*fps", info)
        assert m_fps, f"no fps in probe: {info[:400]}"
        assert 14.0 <= float(m_fps.group(1)) <= 16.0, f"fps={m_fps.group(1)}"
        # duration
        m_dur = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", info)
        assert m_dur, f"no duration: {info[:400]}"
        dur = int(m_dur.group(1)) * 3600 + int(m_dur.group(2)) * 60 + float(m_dur.group(3))
        assert dur > 5.0, f"duration={dur:.2f}s should be > 5s"
        # Constrained Baseline
        assert "constrained baseline" in info.lower() or "baseline" in info.lower(), f"expected baseline profile: {info[:400]}"

        # cache: same text again → same url
        r2 = api.post(f"{API}/translate/text-to-sign", headers=auth_headers, json=payload, timeout=60)
        assert r2.status_code == 200
        assert r2.json()["video_url"] == j["video_url"]

    def test_text_to_sign_es_fallback(self, api, auth_headers):
        payload = {"text": "Hola amigo, gracias", "language": "es"}
        r = api.post(f"{API}/translate/text-to-sign", headers=auth_headers, json=payload, timeout=180)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        j = r.json()
        assert j.get("video_url", "").endswith(".mp4")
        v = api.get(f"{BASE_URL}{j['video_url']}", timeout=60)
        assert v.status_code == 200
        assert v.headers.get("Content-Type", "").startswith("video/mp4")


# --------- GET /api/avatars ---------

class TestAvatars:
    def test_avatars_catalog(self, api, auth_headers):
        r = api.get(f"{API}/avatars", headers=auth_headers, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        j = r.json()
        items = j.get("items", [])
        assert len(items) >= 6, f"expected >=6 avatars, got {len(items)}"
        for a in items:
            assert a["image_url"] == f"/api/media/avatars/{a['id']}.png"
        interpreters = j.get("interpreters", [])
        assert len(interpreters) >= 1
        lp = next((i for i in interpreters if i["id"] == "lifeprint-asl"), None)
        assert lp, f"lifeprint-asl not in interpreters: {interpreters}"
        assert lp["language"] == "en"
        assert lp["image_url"] == "/api/media/interpreters/lifeprint-asl.png"
        assert lp.get("clips", 0) > 0
        assert lp.get("credit")

    def test_interpreter_thumbnail(self, api):
        r = api.get(f"{BASE_URL}/api/media/interpreters/lifeprint-asl.png", timeout=60)
        assert r.status_code == 200, f"{r.status_code}"
        assert r.headers.get("Content-Type", "").startswith("image/png")
        assert len(r.content) > 500

    def test_avatar_portrait(self, api):
        r = api.get(f"{BASE_URL}/api/media/avatars/m1.png", timeout=60)
        assert r.status_code == 200
        assert r.headers.get("Content-Type", "").startswith("image/png")
        assert len(r.content) > 500

    def test_interpreter_unknown_404(self, api):
        r = api.get(f"{BASE_URL}/api/media/interpreters/does-not-exist.png", timeout=30)
        assert r.status_code == 404

    def test_avatar_portrait_unknown_404(self, api):
        r = api.get(f"{BASE_URL}/api/media/avatars/zzz.png", timeout=30)
        assert r.status_code == 404


# --------- Regressions ---------

class TestRegressions:
    def test_sign_frame_burst_stub(self, api, auth_headers):
        # 1x1 white jpeg
        jpg_b64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q=="
        r = api.post(
            f"{API}/translate/sign-frame",
            headers=auth_headers,
            json={"image_base64": jpg_b64, "language": "en"},
            timeout=60,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        j = r.json()
        for k in ("sign", "confidence", "motion"):
            assert k in j, f"missing {k}: {j}"

    def test_sign_to_text_es_carlos(self, api, auth_headers):
        r = api.post(
            f"{API}/translate/sign-to-text",
            headers=auth_headers,
            json={"signs": ["hola", "cómo estás", "C", "A", "R", "L", "O", "S"], "language": "es"},
            timeout=60,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        j = r.json()
        text = (j.get("translated_text") or j.get("text") or "").strip()
        low = text.lower()
        assert "hola" in low and "cómo estás" in low and "carlos" in low, f"got: {text}"

    def test_chat_sign_video(self, api, auth_headers, user_b):
        # Ensure conversation between A and B, send a text, request sign video
        r = api.post(
            f"{API}/chat/conversations",
            headers=auth_headers,
            json={"phone": PHONE_B},
            timeout=30,
        )
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        conv = r.json()
        conv_id = conv.get("id") or conv.get("_id") or conv.get("conversation_id")
        assert conv_id, f"no conversation id: {conv}"

        # send text message A → B
        r = api.post(
            f"{API}/chat/conversations/{conv_id}/messages",
            headers=auth_headers,
            json={"kind": "text", "text": "thank you friend"},
            timeout=30,
        )
        assert r.status_code in (200, 201), f"send text: {r.status_code} {r.text}"
        msg = r.json()
        mid = msg.get("id") or msg.get("_id")
        assert mid

        # request sign video for this message
        r = api.post(
            f"{API}/chat/messages/{mid}/sign-video",
            headers=auth_headers,
            json={"language": "en"},
            timeout=180,
        )
        assert r.status_code == 200, f"chat sign-video: {r.status_code} {r.text}"
        j = r.json()
        assert (j.get("video_url") or "").startswith("/api/media/videos/"), f"no video_url: {j}"


# --------- cleanup: leave test users NON-premium ---------

class TestZzzCleanup:
    def test_deactivate_premium_for_test_users(self, api, auth_headers, user_b):
        for hdr in (auth_headers, {"Authorization": f"Bearer {user_b['token']}"}):
            try:
                api.post(f"{API}/billing/deactivate-test", headers=hdr, timeout=10)
            except Exception:
                pass
        # not an assertion — best-effort teardown
        assert True
