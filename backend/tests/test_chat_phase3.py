"""
Backend tests for Phase 3 - 1-to-1 chat between registered users.
Covers: /api/chat/match, /api/chat/conversations, /api/chat/conversations/{cid}/messages,
        /api/chat/conversations/{cid}/voice, /api/chat/messages/{mid}/sign-video.
"""
import io
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://sign-talk-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TEST_A = "5550001111"
TEST_B = "5550002222"
TEST_C = "5550003333"
CC = "+52"
OTP = "123456"


# ---------------------------- helpers ----------------------------
def _login(session: requests.Session, phone: str) -> dict:
    """Returns dict {token, user_id, headers}."""
    payload = {"country_code": CC, "phone": phone}
    r = session.post(f"{API}/auth/send-otp", json=payload, timeout=15)
    assert r.status_code == 200, f"send-otp failed for {phone}: {r.status_code} {r.text}"
    r = session.post(f"{API}/auth/verify-otp", json={**payload, "otp": OTP}, timeout=15)
    assert r.status_code == 200, f"verify-otp failed for {phone}: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"no token in verify-otp response: {data}"
    user = data.get("user") or {}
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    return {"token": token, "user_id": user.get("id"), "phone": phone, "headers": headers, "user": user}


@pytest.fixture(scope="module")
def sess():
    return requests.Session()


@pytest.fixture(scope="module")
def user_a(sess):
    return _login(sess, TEST_A)


@pytest.fixture(scope="module")
def user_b(sess):
    return _login(sess, TEST_B)


@pytest.fixture(scope="module")
def user_c(sess):
    return _login(sess, TEST_C)


# ---------------------------- /api/chat/match ----------------------------
class TestChatMatch:
    def test_match_returns_registered_by_last10(self, sess, user_a, user_b, user_c):
        # Feed raw phones with different formatting; expect matches on last 10 digits
        payload = {"phones": ["5550002222", "+52 555 000 3333", "9998887777"]}
        r = sess.post(f"{API}/chat/match", json=payload, headers=user_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        items = r.json().get("items", [])
        ids = {i["id"] for i in items}
        assert user_b["user_id"] in ids
        assert user_c["user_id"] in ids
        # Self must not be returned
        assert user_a["user_id"] not in ids
        # Unregistered 9998887777 not present
        assert not any("998887777" in i["phone"].replace(" ", "") for i in items)

    def test_match_excludes_self(self, sess, user_a):
        r = sess.post(f"{API}/chat/match", json={"phones": [TEST_A]},
                      headers=user_a["headers"], timeout=15)
        assert r.status_code == 200
        assert r.json().get("items") == []

    def test_match_unauth(self, sess):
        r = sess.post(f"{API}/chat/match", json={"phones": [TEST_B]}, timeout=15)
        assert r.status_code in (401, 403)


# ---------------------------- /api/chat/conversations POST ----------------------------
class TestOpenConversation:
    def test_open_by_phone_returns_conv(self, sess, user_a, user_b):
        r = sess.post(f"{API}/chat/conversations", json={"phone": TEST_B},
                      headers=user_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data
        assert data["peer"]["id"] == user_b["user_id"]
        pytest.conv_id_ab = data["id"]

    def test_open_idempotent_same_id(self, sess, user_a, user_b):
        r1 = sess.post(f"{API}/chat/conversations", json={"peer_id": user_b["user_id"]},
                       headers=user_a["headers"], timeout=15)
        r2 = sess.post(f"{API}/chat/conversations", json={"phone": TEST_B},
                       headers=user_a["headers"], timeout=15)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["id"] == r2.json()["id"] == pytest.conv_id_ab

    def test_open_reverse_same_conv(self, sess, user_a, user_b):
        r = sess.post(f"{API}/chat/conversations", json={"phone": TEST_A},
                      headers=user_b["headers"], timeout=15)
        assert r.status_code == 200
        assert r.json()["id"] == pytest.conv_id_ab

    def test_open_self_400(self, sess, user_a):
        r = sess.post(f"{API}/chat/conversations", json={"phone": TEST_A},
                      headers=user_a["headers"], timeout=15)
        assert r.status_code == 400

    def test_open_unregistered_404(self, sess, user_a):
        r = sess.post(f"{API}/chat/conversations", json={"phone": "9998887777"},
                      headers=user_a["headers"], timeout=15)
        assert r.status_code == 404

    def test_open_unauth(self, sess):
        r = sess.post(f"{API}/chat/conversations", json={"phone": TEST_B}, timeout=15)
        assert r.status_code in (401, 403)


# ---------------------------- /api/chat/conversations GET ----------------------------
class TestListConversations:
    def test_list_has_peer_and_updated(self, sess, user_a, user_b):
        r = sess.get(f"{API}/chat/conversations", headers=user_a["headers"], timeout=15)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 1
        conv = next((c for c in arr if c["id"] == pytest.conv_id_ab), None)
        assert conv is not None
        assert conv["peer"]["id"] == user_b["user_id"]
        assert "unread_count" in conv
        assert "updated_at" in conv


# ---------------------------- /api/chat/conversations/{cid}/messages ----------------------------
class TestChatMessages:
    def test_send_empty_text_422(self, sess, user_a):
        r = sess.post(f"{API}/chat/conversations/{pytest.conv_id_ab}/messages",
                      json={"kind": "text", "text": "   ", "language": "es"},
                      headers=user_a["headers"], timeout=15)
        assert r.status_code == 422

    def test_send_text_ok(self, sess, user_a):
        r = sess.post(f"{API}/chat/conversations/{pytest.conv_id_ab}/messages",
                      json={"kind": "text", "text": "Hola desde A", "language": "es"},
                      headers=user_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["text"] == "Hola desde A"
        assert data["kind"] == "text"
        assert data["sender_id"] == user_a["user_id"]
        pytest.msg_text_id = data["id"]

    def test_send_sign_composes(self, sess, user_a):
        r = sess.post(f"{API}/chat/conversations/{pytest.conv_id_ab}/messages",
                      json={"kind": "sign", "signs": ["H", "O", "L", "A", "gracias"], "language": "es"},
                      headers=user_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # Composed sentence should contain HOLA & gracias tokens; typically 'Hola gracias'
        assert "hola" in data["text"].lower()
        assert "gracias" in data["text"].lower()
        assert data["kind"] == "sign"
        pytest.msg_sign_id = data["id"]

    def test_send_sign_empty_422(self, sess, user_a):
        r = sess.post(f"{API}/chat/conversations/{pytest.conv_id_ab}/messages",
                      json={"kind": "sign", "signs": ["", "  "], "language": "es"},
                      headers=user_a["headers"], timeout=15)
        assert r.status_code == 422

    def test_get_messages_marks_read(self, sess, user_a, user_b):
        # B fetches → should include A's messages and mark read → unread_count 0 for B
        r = sess.get(f"{API}/chat/conversations/{pytest.conv_id_ab}/messages",
                     headers=user_b["headers"], timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["me"] == user_b["user_id"]
        assert body["peer"]["id"] == user_a["user_id"]
        assert isinstance(body["items"], list) and len(body["items"]) >= 2
        assert "server_time" in body
        pytest.server_time = body["server_time"]

        # Now list conversations for B → unread should be 0 for this conv
        rlist = sess.get(f"{API}/chat/conversations", headers=user_b["headers"], timeout=15)
        conv = next(c for c in rlist.json() if c["id"] == pytest.conv_id_ab)
        assert conv["unread_count"] == 0

    def test_unread_increments_for_a(self, sess, user_a, user_b):
        # B sends a reply → A's unread should be >=1
        r = sess.post(f"{API}/chat/conversations/{pytest.conv_id_ab}/messages",
                      json={"kind": "text", "text": "hola A soy B", "language": "es"},
                      headers=user_b["headers"], timeout=15)
        assert r.status_code == 200
        rlist = sess.get(f"{API}/chat/conversations", headers=user_a["headers"], timeout=15)
        conv = next(c for c in rlist.json() if c["id"] == pytest.conv_id_ab)
        assert conv["unread_count"] >= 1

    def test_polling_after_returns_only_newer(self, sess, user_a, user_b):
        # A polls with after=server_time from earlier (before B's reply)
        r = sess.get(f"{API}/chat/conversations/{pytest.conv_id_ab}/messages",
                     params={"after": pytest.server_time},
                     headers=user_a["headers"], timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        # Only newer messages (B's reply) — must be >=1 and not include the initial "Hola desde A"
        assert len(items) >= 1
        assert not any(i.get("text") == "Hola desde A" for i in items)

    def test_polling_after_invalid_400(self, sess, user_a):
        r = sess.get(f"{API}/chat/conversations/{pytest.conv_id_ab}/messages",
                     params={"after": "not-a-date"},
                     headers=user_a["headers"], timeout=15)
        assert r.status_code == 400

    def test_messages_404_for_outsider(self, sess, user_c):
        r = sess.get(f"{API}/chat/conversations/{pytest.conv_id_ab}/messages",
                     headers=user_c["headers"], timeout=15)
        assert r.status_code == 404

    def test_messages_unauth(self, sess):
        r = sess.get(f"{API}/chat/conversations/{pytest.conv_id_ab}/messages", timeout=15)
        assert r.status_code in (401, 403)


# ---------------------------- /voice ----------------------------
class TestVoiceUpload:
    def test_voice_non_audio_415(self, sess, user_a):
        files = {"audio": ("hello.txt", io.BytesIO(b"hi"), "text/plain")}
        r = sess.post(f"{API}/chat/conversations/{pytest.conv_id_ab}/voice",
                      files=files, data={"language": "es"},
                      headers={"Authorization": user_a["headers"]["Authorization"]}, timeout=30)
        assert r.status_code == 415, f"expected 415 got {r.status_code} {r.text}"

    def test_voice_empty_400(self, sess, user_a):
        files = {"audio": ("empty.wav", io.BytesIO(b""), "audio/wav")}
        r = sess.post(f"{API}/chat/conversations/{pytest.conv_id_ab}/voice",
                      files=files, data={"language": "es"},
                      headers={"Authorization": user_a["headers"]["Authorization"]}, timeout=30)
        assert r.status_code == 400, f"expected 400 got {r.status_code} {r.text}"


# ---------------------------- /sign-video ----------------------------
class TestSignVideo:
    def test_render_and_cache(self, sess, user_a):
        assert getattr(pytest, "msg_text_id", None), "prereq missing"
        r1 = sess.post(f"{API}/chat/messages/{pytest.msg_text_id}/sign-video",
                       headers=user_a["headers"], timeout=90)
        assert r1.status_code == 200, r1.text
        v1 = r1.json().get("video_url")
        assert v1 and v1.startswith("/api/media/videos/") and v1.endswith(".mp4")

        # second call → cached (same url)
        r2 = sess.post(f"{API}/chat/messages/{pytest.msg_text_id}/sign-video",
                       headers=user_a["headers"], timeout=30)
        assert r2.status_code == 200
        assert r2.json().get("video_url") == v1
        pytest.video_url = v1

    def test_video_served_mp4_and_webm(self, sess):
        v = getattr(pytest, "video_url", None)
        assert v, "prereq missing"
        r = sess.get(f"{BASE_URL}{v}", headers={"Range": "bytes=0-1023"}, timeout=30)
        assert r.status_code in (200, 206), f"mp4 got {r.status_code}"
        webm = v.rsplit(".", 1)[0] + ".webm"
        r2 = sess.get(f"{BASE_URL}{webm}", headers={"Range": "bytes=0-1023"}, timeout=30)
        assert r2.status_code in (200, 206), f"webm got {r2.status_code}"

    def test_sign_video_forbidden_for_outsider(self, sess, user_c):
        assert getattr(pytest, "msg_text_id", None)
        r = sess.post(f"{API}/chat/messages/{pytest.msg_text_id}/sign-video",
                      headers=user_c["headers"], timeout=30)
        # msg exists but user_c is not in conv → 404 (per _conv_for)
        assert r.status_code == 404
