"""Iteration 3: Backend tests for Share-to-Contacts (no server changes) and
Dictionary emoji field on words + learn/today emoji propagation."""
import os
import time
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://sign-talk-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def auth(s):
    phone = f"555{int(time.time()) % 10_000_000:07d}"
    cc = "+52"
    r = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "country_code": cc, "otp": "123456"}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    return {"headers": {"Authorization": f"Bearer {data['token']}"}}


# ---------- Dictionary: emoji on words, no emoji on letters ----------

class TestDictionaryEmoji:
    def test_es_counts_and_emoji(self, s):
        r = s.get(f"{API}/dictionary?language=es", timeout=15)
        assert r.status_code == 200
        items = r.json()
        letters = [i for i in items if i["kind"] == "letter"]
        words = [i for i in items if i["kind"] == "word"]
        # ES has 27 letters (A-Z + Ñ) and 38 words
        assert len(letters) == 27, f"letters={len(letters)}"
        assert len(words) == 38, f"words={len(words)}"
        assert len(items) == 65
        # every word has a non-empty emoji string
        for w in words:
            assert isinstance(w.get("emoji"), str) and w["emoji"].strip(), f"missing emoji on {w['id']}"
        # letters should not have a truthy emoji
        for L in letters:
            assert not L.get("emoji"), f"letter unexpectedly has emoji: {L['id']}"

    def test_en_counts_and_emoji(self, s):
        r = s.get(f"{API}/dictionary?language=en", timeout=15)
        assert r.status_code == 200
        items = r.json()
        letters = [i for i in items if i["kind"] == "letter"]
        words = [i for i in items if i["kind"] == "word"]
        assert len(letters) == 26
        assert len(words) == 38
        assert len(items) == 64
        for w in words:
            assert w.get("emoji"), f"missing emoji on {w['id']}"

    def test_ids_unique(self, s):
        r = s.get(f"{API}/dictionary", timeout=15)
        assert r.status_code == 200
        ids = [i["id"] for i in r.json()]
        assert len(ids) == len(set(ids))

    def test_specific_words_have_expected_emoji(self, s):
        r = s.get(f"{API}/dictionary?language=es", timeout=15).json()
        by_label = {i["label"]: i for i in r if i["kind"] == "word"}
        assert "Agua" in by_label and by_label["Agua"]["emoji"] == "💧"
        assert "Familia" in by_label
        assert "Doctor" in by_label
        rn = s.get(f"{API}/dictionary?language=en", timeout=15).json()
        en_labels = {i["label"] for i in rn if i["kind"] == "word"}
        assert {"Water", "Family", "Doctor"} <= en_labels

    def test_no_mongo_id(self, s):
        r = s.get(f"{API}/dictionary?language=en", timeout=15).json()
        for it in r:
            assert "_id" not in it


# ---------- Learn: word items must carry emoji ----------

class TestLearnEmojiPropagation:
    def test_learn_today_word_items_have_emoji(self, s, auth):
        r = s.get(f"{API}/learn/today?language=en", headers=auth["headers"], timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        # at least verify shape; if a word appears, emoji must be present
        for it in items:
            e = it["entry"]
            if e["kind"] == "word":
                assert e.get("emoji"), f"word entry missing emoji: {e['id']}"

    def test_learn_today_es_contains_valid_entries(self, s, auth):
        r = s.get(f"{API}/learn/today?language=es", headers=auth["headers"], timeout=15).json()
        assert r["language"] == "es"
        assert len(r["items"]) == 5
        for it in r["items"]:
            for k in ("id", "label", "kind"):
                assert k in it["entry"]
