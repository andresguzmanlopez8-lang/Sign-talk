"""Tests for NEW features: Favorites, Learning Mode, PDF export prerequisites."""
import os
import time
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://sign-talk-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _phone():
    # unique phone per run so learning progress starts at zero
    return f"555{int(time.time()) % 10_000_000:07d}"


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
    return {"token": data["token"], "user": data["user"], "headers": {"Authorization": f"Bearer {data['token']}"}, "phone": phone}


# -------- FAVORITES --------

class TestFavorites:
    def test_create_favorite_requires_auth(self, s):
        r = s.post(f"{API}/favorites", json={"text": "Hola", "language": "es"})
        assert r.status_code == 401

    def test_list_favorites_requires_auth(self, s):
        r = s.get(f"{API}/favorites")
        assert r.status_code == 401

    def test_delete_favorite_requires_auth(self, s):
        r = s.delete(f"{API}/favorites/some-id")
        assert r.status_code == 401

    def test_create_favorite_and_dedupe(self, s, auth):
        r1 = s.post(f"{API}/favorites", json={"text": "TEST_Hola amigo", "language": "es"}, headers=auth["headers"])
        assert r1.status_code == 200, r1.text
        j1 = r1.json()
        assert j1["text"] == "TEST_Hola amigo"
        assert j1["language"] == "es"
        assert "id" in j1
        assert "_id" not in j1

        # Same text+language => same id (dedupe)
        r2 = s.post(f"{API}/favorites", json={"text": "TEST_Hola amigo", "language": "es"}, headers=auth["headers"])
        assert r2.status_code == 200
        assert r2.json()["id"] == j1["id"]

        # Different language => new record
        r3 = s.post(f"{API}/favorites", json={"text": "TEST_Hola amigo", "language": "en"}, headers=auth["headers"])
        assert r3.status_code == 200
        assert r3.json()["id"] != j1["id"]

    def test_list_favorites_filter_by_language(self, s, auth):
        # ensure at least one es fav from previous test
        r = s.get(f"{API}/favorites?language=es", headers=auth["headers"])
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert all(i["language"] == "es" for i in items)
        assert any(i["text"] == "TEST_Hola amigo" for i in items)
        for it in items:
            assert "_id" not in it

    def test_delete_favorite_and_404_on_second(self, s, auth):
        # create one to delete
        r = s.post(f"{API}/favorites", json={"text": "TEST_delete_me", "language": "es"}, headers=auth["headers"])
        fav_id = r.json()["id"]
        d1 = s.delete(f"{API}/favorites/{fav_id}", headers=auth["headers"])
        assert d1.status_code == 200
        assert d1.json()["success"] is True
        d2 = s.delete(f"{API}/favorites/{fav_id}", headers=auth["headers"])
        assert d2.status_code == 404

    def test_empty_text_rejected(self, s, auth):
        r = s.post(f"{API}/favorites", json={"text": "   ", "language": "es"}, headers=auth["headers"])
        assert r.status_code == 400


# -------- LEARNING MODE --------

class TestLearn:
    def test_today_requires_auth(self, s):
        r = s.get(f"{API}/learn/today?language=es")
        assert r.status_code == 401

    def test_progress_requires_auth(self, s):
        r = s.get(f"{API}/learn/progress")
        assert r.status_code == 401

    def test_complete_requires_auth(self, s):
        r = s.post(f"{API}/learn/complete", json={"language": "es", "correct_ids": [], "score": 0, "total": 5})
        assert r.status_code == 401

    def test_today_es_returns_5_items_with_shape(self, s, auth):
        r = s.get(f"{API}/learn/today?language=es", headers=auth["headers"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["language"] == "es"
        items = data["items"]
        assert len(items) == 5
        for it in items:
            assert "entry" in it and "options" in it
            e = it["entry"]
            for k in ("id", "label", "kind", "description"):
                assert k in e, f"missing {k} in entry"
            assert len(it["options"]) == 4
            assert e["label"] in it["options"]
            assert "_id" not in e

    def test_today_deterministic_same_day(self, s, auth):
        r1 = s.get(f"{API}/learn/today?language=es", headers=auth["headers"]).json()
        r2 = s.get(f"{API}/learn/today?language=es", headers=auth["headers"]).json()
        ids1 = [i["entry"]["id"] for i in r1["items"]]
        ids2 = [i["entry"]["id"] for i in r2["items"]]
        assert ids1 == ids2, "learn/today must be deterministic per user+day"

    def test_today_en_works(self, s, auth):
        r = s.get(f"{API}/learn/today?language=en", headers=auth["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data["language"] == "en"
        assert len(data["items"]) == 5

    def test_complete_flow_progress_and_idempotent(self, s, auth):
        # Fresh user progress starts at zero
        prog0 = s.get(f"{API}/learn/progress", headers=auth["headers"]).json()
        assert prog0["streak"] == 0
        assert prog0["lessons_completed"] == 0
        assert prog0["learned_count"] == 0
        assert prog0["completed_today"] is False

        today = s.get(f"{API}/learn/today?language=es", headers=auth["headers"]).json()
        correct_ids = [i["entry"]["id"] for i in today["items"][:3]]  # 3 correct

        # First complete call
        r1 = s.post(
            f"{API}/learn/complete",
            json={"language": "es", "correct_ids": correct_ids, "score": len(correct_ids), "total": 5},
            headers=auth["headers"],
        )
        assert r1.status_code == 200, r1.text
        v1 = r1.json()
        assert v1["counted"] is True
        assert v1["streak"] == 1
        assert v1["completed_today"] is True
        assert v1["learned_count"] == len(correct_ids)
        assert v1["lessons_completed"] == 1

        # Second call same day - should NOT double-count
        r2 = s.post(
            f"{API}/learn/complete",
            json={"language": "es", "correct_ids": correct_ids, "score": len(correct_ids), "total": 5},
            headers=auth["headers"],
        )
        assert r2.status_code == 200
        v2 = r2.json()
        assert v2["counted"] is False
        assert v2["streak"] == 1
        assert v2["lessons_completed"] == 1
        assert v2["completed_today"] is True

        # GET progress reflects state
        prog = s.get(f"{API}/learn/progress", headers=auth["headers"]).json()
        assert prog["streak"] == 1
        assert prog["lessons_completed"] == 1
        assert prog["completed_today"] is True
        assert prog["learned_count"] >= len(correct_ids)
