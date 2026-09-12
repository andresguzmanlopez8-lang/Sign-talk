"""Backend tests for the 'Practicar Frases' quiz feature.

Covers /api/learn/today, /api/learn/complete, /api/learn/review, /api/learn/review/complete
with an emphasis on phrase-type quiz items.
"""
import os
import re
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


def _login(phone: str) -> str:
    r = requests.post(f"{API}/auth/send-otp", json={"country_code": "+52", "phone": phone})
    assert r.status_code == 200, r.text
    r = requests.post(f"{API}/auth/verify-otp", json={"country_code": "+52", "phone": phone, "otp": "123456"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def phrases_es():
    r = requests.get(f"{API}/phrases", params={"language": "es"})
    assert r.status_code == 200
    return {p["id"]: p for p in r.json()["items"]}


@pytest.fixture(scope="module")
def phrases_en():
    r = requests.get(f"{API}/phrases", params={"language": "en"})
    assert r.status_code == 200
    return {p["id"]: p for p in r.json()["items"]}


class TestPracticarFrasesToday:
    """Feature: today() occasionally injects a phrase question."""

    def test_iterate_users_distribution_and_shape(self, phrases_es, phrases_en):
        # Fresh phones so daily-random is unbiased by prior learned state.
        stamp = str(int(time.time()))
        phones = [f"555{stamp[-6:]}{i:02d}" for i in range(8)]
        with_phrase = 0
        without_phrase = 0
        phrase_items_seen = []
        tokens = []
        for phone in phones:
            token = _login(phone)
            tokens.append((phone, token))
            r = requests.get(f"{API}/learn/today", headers=_hdr(token), params={"language": "es"})
            assert r.status_code == 200, r.text
            data = r.json()
            items = data["items"]
            assert len(items) == 5, f"lesson must have 5 items, got {len(items)} for {phone}"
            phrase_items = [it for it in items if it["entry"]["kind"] == "phrase"]
            assert len(phrase_items) <= 1, "at most one phrase per lesson"
            if phrase_items:
                with_phrase += 1
                phrase_items_seen.append((phone, token, phrase_items[0]))
            else:
                without_phrase += 1

        assert with_phrase >= 1, "expected at least one user to receive a phrase question"
        assert without_phrase >= 1, "expected at least one user to receive NO phrase question"

        # Shape validation for each phrase item
        for phone, token, it in phrase_items_seen:
            entry = it["entry"]
            options = it["options"]
            assert re.match(r"^phrase-\d+$", entry["id"]), entry["id"]
            # label is Spanish (matches /api/phrases?language=es text)
            assert entry["id"] in phrases_es, f"unknown phrase id {entry['id']}"
            assert entry["label"] == phrases_es[entry["id"]]["text"], (entry["label"], phrases_es[entry["id"]]["text"])
            # description is the English translation for the same id
            assert entry["description"] == phrases_en[entry["id"]]["text"], (
                entry["description"], phrases_en[entry["id"]]["text"],
            )
            # 4 options, all distinct, all phrases (not letters), include entry.label
            assert len(options) == 4, options
            assert len(set(options)) == 4, f"options not distinct: {options}"
            assert entry["label"] in options
            # Every option must be a Spanish phrase (present in /api/phrases?language=es)
            all_es_texts = {p["text"] for p in phrases_es.values()}
            for opt in options:
                assert opt in all_es_texts, f"option '{opt}' is not a Spanish phrase (likely letter distractor leak)"
                # sanity: phrases are multi-word, letters are 1 char
                assert len(opt) > 3

    def test_today_is_deterministic_per_user(self):
        phone = f"5559{int(time.time())%1000000:06d}"
        token = _login(phone)
        r1 = requests.get(f"{API}/learn/today", headers=_hdr(token), params={"language": "es"}).json()
        r2 = requests.get(f"{API}/learn/today", headers=_hdr(token), params={"language": "es"}).json()
        ids1 = [it["entry"]["id"] for it in r1["items"]]
        ids2 = [it["entry"]["id"] for it in r2["items"]]
        assert ids1 == ids2, (ids1, ids2)
        # options identical too (rng seeded deterministically)
        opts1 = [it["options"] for it in r1["items"]]
        opts2 = [it["options"] for it in r2["items"]]
        assert opts1 == opts2


class TestPhraseWeakAndReview:
    """Wrong phrase -> weak list -> review -> mastery."""

    def _find_user_with_phrase(self, language="es"):
        """Try up to 15 fresh phones until one lesson contains a phrase item."""
        for i in range(15):
            phone = f"5566{int(time.time())%100000:05d}{i:02d}"
            token = _login(phone)
            r = requests.get(f"{API}/learn/today", headers=_hdr(token), params={"language": language}).json()
            phrase_item = next((it for it in r["items"] if it["entry"]["kind"] == "phrase"), None)
            if phrase_item:
                return phone, token, r, phrase_item
        pytest.skip("Could not find a user with a phrase item in 15 attempts")

    def test_wrong_phrase_flows_to_weak_and_review_es(self):
        phone, token, today_data, phrase_item = self._find_user_with_phrase("es")
        pid = phrase_item["entry"]["id"]
        correct_ids = [it["entry"]["id"] for it in today_data["items"] if it["entry"]["id"] != pid]

        # Complete the lesson: correct on the 4 signs, wrong on the phrase
        r = requests.post(
            f"{API}/learn/complete",
            headers=_hdr(token),
            json={"correct_ids": correct_ids, "wrong_ids": [pid], "score": 4, "language": "es"},
        )
        assert r.status_code == 200, r.text
        after = r.json()
        assert pid in after["weak_ids"], (pid, after.get("weak_ids"))
        weak_count_before = after["weak_count"]
        learned_before = after["learned_count"]
        assert weak_count_before >= 1

        # Review must include the phrase with kind='phrase'
        r = requests.get(f"{API}/learn/review", headers=_hdr(token), params={"language": "es"})
        assert r.status_code == 200
        rev = r.json()
        rev_ids = [it["entry"]["id"] for it in rev["items"]]
        assert pid in rev_ids, rev_ids
        phrase_in_rev = next(it for it in rev["items"] if it["entry"]["id"] == pid)
        assert phrase_in_rev["entry"]["kind"] == "phrase"
        # Options in review must also be Spanish phrases including the label
        assert phrase_in_rev["entry"]["label"] in phrase_in_rev["options"]

        # Master it via review/complete
        r = requests.post(
            f"{API}/learn/review/complete",
            headers=_hdr(token),
            json={"correct_ids": [pid], "wrong_ids": [], "score": 1, "language": "es"},
        )
        assert r.status_code == 200, r.text
        done = r.json()
        assert done["weak_count"] < weak_count_before, (done["weak_count"], weak_count_before)
        assert done["learned_count"] > learned_before, (done["learned_count"], learned_before)
        assert pid not in done["weak_ids"]


class TestLanguageEnSymmetric:
    """language=en: phrase label is English, description is Spanish."""

    def test_today_en_phrase_shape(self, phrases_es, phrases_en):
        # Try up to 15 fresh phones to find one with a phrase in EN mode
        stamp = str(int(time.time()))
        found = None
        for i in range(15):
            phone = f"5577{stamp[-5:]}{i:02d}"
            token = _login(phone)
            r = requests.get(f"{API}/learn/today", headers=_hdr(token), params={"language": "en"}).json()
            assert len(r["items"]) == 5
            pi = next((it for it in r["items"] if it["entry"]["kind"] == "phrase"), None)
            if pi:
                found = (phone, token, pi)
                break
        if not found:
            pytest.skip("No phrase question drawn in EN within 15 attempts")
        phone, token, it = found
        entry = it["entry"]
        options = it["options"]
        assert re.match(r"^phrase-\d+$", entry["id"])
        assert entry["language"] == "en"
        # label matches English phrase text
        assert entry["label"] == phrases_en[entry["id"]]["text"]
        # description is the Spanish translation
        assert entry["description"] == phrases_es[entry["id"]]["text"]
        # 4 unique English-phrase options including label
        all_en_texts = {p["text"] for p in phrases_en.values()}
        assert len(options) == 4 and len(set(options)) == 4
        assert entry["label"] in options
        for opt in options:
            assert opt in all_en_texts, f"non-English-phrase option leaked: {opt}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
