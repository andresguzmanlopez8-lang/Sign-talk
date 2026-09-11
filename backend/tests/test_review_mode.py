"""
Backend tests for Modo Repaso (Review Mode) — SignBridge.

Covers:
- Daily lesson generates 5 items with 4 options each containing entry.label
- POST /learn/complete tracks weak_ids and counted/streak
- /learn/progress reflects weak_count
- GET /learn/review returns quiz for weak ids only; empty for other language
- POST /learn/review/complete masters correct ids, keeps wrong ones weak, no streak change
- All learn endpoints require auth (401)
"""

import os
import time
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL"
) else None

# Fallback: read frontend .env directly (since BASE URL is stored there)
if not BASE_URL:
    _env_path = "/app/frontend/.env"
    with open(_env_path) as _f:
        for _line in _f:
            if _line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = _line.split("=", 1)[1].strip().rstrip("/")
                break

assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL is not configured"


@pytest.fixture(scope="module")
def auth():
    """Register a fresh phone user and return {token, headers}."""
    phone = f"555{int(time.time())}"[:10]
    r = requests.post(
        f"{BASE_URL}/api/auth/send-otp",
        json={"phone": phone, "country_code": "+52"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    r2 = requests.post(
        f"{BASE_URL}/api/auth/verify-otp",
        json={"phone": phone, "country_code": "+52", "otp": "123456"},
        timeout=15,
    )
    assert r2.status_code == 200, r2.text
    token = r2.json()["token"]
    return {"token": token, "headers": {"Authorization": f"Bearer {token}"}}


class TestReviewMode:
    def test_01_today_returns_5_items_each_with_4_options(self, auth):
        r = requests.get(
            f"{BASE_URL}/api/learn/today?language=es",
            headers=auth["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["language"] == "es"
        items = data["items"]
        assert len(items) == 5, f"expected 5 items, got {len(items)}"
        for it in items:
            assert "entry" in it and "options" in it
            assert len(it["options"]) == 4
            assert it["entry"]["label"] in it["options"]
        # Store ids for next step
        pytest.today_ids = [it["entry"]["id"] for it in items]

    def test_02_complete_marks_last_3_wrong_and_records_weak(self, auth):
        ids = pytest.today_ids
        correct = ids[:2]
        wrong = ids[2:]
        r = requests.post(
            f"{BASE_URL}/api/learn/complete",
            json={
                "language": "es",
                "correct_ids": correct,
                "wrong_ids": wrong,
                "score": 2,
                "total": 5,
            },
            headers=auth["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["counted"] is True
        assert d["streak"] == 1
        assert d["weak_count"] == 3
        assert sorted(d["weak_ids"]) == sorted(wrong)
        assert d["lessons_completed"] == 1

    def test_03_progress_weak_count_3(self, auth):
        r = requests.get(f"{BASE_URL}/api/learn/progress", headers=auth["headers"], timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["weak_count"] == 3
        assert d["streak"] == 1

    def test_04_review_es_returns_only_weak_ids_with_4_options(self, auth):
        r = requests.get(
            f"{BASE_URL}/api/learn/review?language=es",
            headers=auth["headers"], timeout=15,
        )
        assert r.status_code == 200
        d = r.json()
        items = d["items"]
        assert len(items) == 3
        weak_expected = set(pytest.today_ids[2:])
        assert {it["entry"]["id"] for it in items} == weak_expected
        for it in items:
            assert len(it["options"]) == 4
            assert it["entry"]["label"] in it["options"]

    def test_05_review_en_is_empty(self, auth):
        r = requests.get(
            f"{BASE_URL}/api/learn/review?language=en",
            headers=auth["headers"], timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["items"] == []

    def test_06_review_complete_does_not_change_streak_and_masters_correct(self, auth):
        weak_ids = pytest.today_ids[2:]
        mastered = weak_ids[:2]
        still_wrong = weak_ids[2:]
        r = requests.post(
            f"{BASE_URL}/api/learn/review/complete",
            json={
                "language": "es",
                "correct_ids": mastered,
                "wrong_ids": still_wrong,
                "score": 2,
                "total": 3,
            },
            headers=auth["headers"], timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["counted"] is False
        assert d["mastered"] == 2
        assert d["weak_count"] == 1
        assert d["streak"] == 1
        assert d["lessons_completed"] == 1
        pytest.remaining_weak = still_wrong
        pytest.mastered = mastered

    def test_07_progress_reflects_mastered_and_weak(self, auth):
        r = requests.get(f"{BASE_URL}/api/learn/progress", headers=auth["headers"], timeout=15)
        d = r.json()
        assert d["weak_count"] == 1
        # correct ids from lesson (2) + mastered from review (2) => 4 learned ids
        assert d["learned_count"] >= 4


class TestReviewAuth:
    endpoints_get = [
        "/api/learn/today?language=es",
        "/api/learn/progress",
        "/api/learn/review?language=es",
    ]
    endpoints_post = [
        ("/api/learn/complete", {"language": "es", "correct_ids": [], "wrong_ids": [], "score": 0, "total": 5}),
        ("/api/learn/review/complete", {"language": "es", "correct_ids": [], "wrong_ids": [], "score": 0, "total": 3}),
    ]

    @pytest.mark.parametrize("path", endpoints_get)
    def test_get_requires_auth(self, path):
        r = requests.get(f"{BASE_URL}{path}", timeout=15)
        assert r.status_code == 401

    @pytest.mark.parametrize("path,body", endpoints_post)
    def test_post_requires_auth(self, path, body):
        r = requests.post(f"{BASE_URL}{path}", json=body, timeout=15)
        assert r.status_code == 401
