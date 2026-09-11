"""Tests for NEW features (iter 5):
   - Frases Completas: GET /phrases (no auth)
   - Logros y Medallas: GET /learn/achievements + newly_unlocked in /learn/complete
"""
import os
import time
import pytest
import requests

def _load_env_url():
    # Read from frontend/.env directly (test env may not inherit it)
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if url:
        return url.rstrip("/")
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not configured")

BASE_URL = _load_env_url()
API = f"{BASE_URL}/api"


def _phone():
    # unique phone per run so achievements/progress start empty
    return f"555{int(time.time() * 1000) % 10_000_000:07d}"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def auth(s):
    phone = _phone()
    cc = "+1"
    r = s.post(f"{API}/auth/send-otp", json={"phone": phone, "country_code": cc}, timeout=15)
    assert r.status_code == 200, r.text
    r = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "country_code": cc, "otp": "123456"}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "token": data["token"],
        "user": data["user"],
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


# ==================== PHRASES (public) ====================

class TestPhrases:
    def test_phrases_es_no_auth(self, s):
        r = s.get(f"{API}/phrases?language=es", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        items = data["items"]
        cats = data["categories"]
        assert len(items) == 20, f"expected 20 items, got {len(items)}"
        assert len(cats) == 4, f"expected 4 categories, got {len(cats)}"
        for it in items:
            for k in ("id", "category", "text", "category_label", "category_emoji"):
                assert k in it, f"missing {k} in phrase item"
        texts = [it["text"] for it in items]
        assert "¿Dónde está el baño?" in texts

    def test_phrases_en(self, s):
        r = s.get(f"{API}/phrases?language=en", timeout=15)
        assert r.status_code == 200
        data = r.json()
        items = data["items"]
        assert len(items) == 20
        texts = [it["text"] for it in items]
        assert "Where is the bathroom?" in texts

    def test_phrases_invalid_language(self, s):
        r = s.get(f"{API}/phrases?language=fr", timeout=15)
        assert r.status_code == 422


# ==================== ACHIEVEMENTS ====================

class TestAchievementsFresh:
    def test_achievements_requires_auth(self, s):
        r = s.get(f"{API}/learn/achievements?language=es")
        assert r.status_code == 401

    def test_fresh_user_all_locked(self, s, auth):
        r = s.get(f"{API}/learn/achievements?language=es", headers=auth["headers"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] == 12
        assert data["unlocked_count"] == 0
        assert len(data["items"]) == 12
        for it in data["items"]:
            for k in ("id", "emoji", "title", "description", "unlocked", "unlocked_at"):
                assert k in it
            assert it["unlocked"] is False
            assert it["unlocked_at"] is None


# ==================== PERFECT LESSON FLOW ====================

class TestPerfectLessonFlow:
    """Fresh user completes a perfect lesson → first_lesson + perfect_lesson unlocked."""

    def test_complete_perfect_unlocks_two(self, s):
        # own auth (fresh) so we do not pollute the module fixture
        phone = _phone() + "b"
        cc = "+1"
        s.post(f"{API}/auth/send-otp", json={"phone": phone, "country_code": cc}, timeout=15)
        r = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "country_code": cc, "otp": "123456"}, timeout=15)
        assert r.status_code == 200
        h = {"Authorization": f"Bearer {r.json()['token']}"}

        today = s.get(f"{API}/learn/today?language=es", headers=h).json()
        ids = [i["entry"]["id"] for i in today["items"]]
        assert len(ids) == 5

        r1 = s.post(f"{API}/learn/complete",
                    json={"language": "es", "correct_ids": ids, "wrong_ids": [], "score": 5, "total": 5},
                    headers=h)
        assert r1.status_code == 200, r1.text
        v1 = r1.json()
        assert v1["counted"] is True
        assert v1["achievements_count"] == 2
        newly_ids = [a["id"] for a in v1["newly_unlocked"]]
        assert "first_lesson" in newly_ids
        assert "perfect_lesson" in newly_ids
        for a in v1["newly_unlocked"]:
            for k in ("id", "emoji", "title", "description"):
                assert k in a and a[k]

        # GET achievements confirms
        r2 = s.get(f"{API}/learn/achievements?language=es", headers=h).json()
        assert r2["unlocked_count"] == 2
        unlocked_map = {a["id"]: a for a in r2["items"]}
        for aid in ("first_lesson", "perfect_lesson"):
            assert unlocked_map[aid]["unlocked"] is True
            assert unlocked_map[aid]["unlocked_at"] is not None
            # ISO-ish date string
            assert "T" in unlocked_map[aid]["unlocked_at"]

        # English titles
        r3 = s.get(f"{API}/learn/achievements?language=en", headers=h).json()
        titles_en = {a["id"]: a["title"] for a in r3["items"]}
        assert titles_en["first_lesson"] == "First lesson"
        assert titles_en["perfect_lesson"] == "Perfect lesson"

        # Second complete → no duplicates
        r4 = s.post(f"{API}/learn/complete",
                    json={"language": "es", "correct_ids": ids, "wrong_ids": [], "score": 5, "total": 5},
                    headers=h)
        v4 = r4.json()
        assert v4["counted"] is False
        assert v4["newly_unlocked"] == []
        assert v4["achievements_count"] == 2


# ==================== FAV_5 & MESSAGES_10 ====================

class TestFavAndMessages:
    def test_fav_5_and_messages_10(self, s):
        phone = _phone() + "c"
        cc = "+1"
        s.post(f"{API}/auth/send-otp", json={"phone": phone, "country_code": cc}, timeout=15)
        r = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "country_code": cc, "otp": "123456"}, timeout=15)
        h = {"Authorization": f"Bearer {r.json()['token']}"}

        # 5 distinct favorites
        for i in range(5):
            fr = s.post(f"{API}/favorites",
                        json={"text": f"TEST_fav_iter5_{i}_{int(time.time()*1000)}", "language": "es"},
                        headers=h)
            assert fr.status_code == 200, fr.text

        ach = s.get(f"{API}/learn/achievements?language=es", headers=h).json()
        umap = {a["id"]: a for a in ach["items"]}
        assert umap["fav_5"]["unlocked"] is True, f"fav_5 not unlocked. unlocked_count={ach['unlocked_count']}"
        assert umap["messages_10"]["unlocked"] is False

        # 10 text-to-sign messages
        for i in range(10):
            mr = s.post(f"{API}/translate/text-to-sign",
                        json={"text": f"TEST_msg_iter5_{i}", "language": "es"},
                        headers=h)
            assert mr.status_code == 200, mr.text

        ach2 = s.get(f"{API}/learn/achievements?language=es", headers=h).json()
        umap2 = {a["id"]: a for a in ach2["items"]}
        assert umap2["messages_10"]["unlocked"] is True, "messages_10 should unlock after 10 translations"
        assert umap2["fav_5"]["unlocked"] is True
