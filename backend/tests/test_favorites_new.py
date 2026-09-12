"""Backend tests for the new favorites features (order field, reorder, rename)."""
import os
import time
import pytest
import requests

from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def auth_token():
    phone = f"555{int(time.time())}"
    r = requests.post(f"{BASE_URL}/api/auth/send-otp", json={"phone": phone, "country_code": "+52"})
    assert r.status_code == 200
    r = requests.post(
        f"{BASE_URL}/api/auth/verify-otp",
        json={"phone": phone, "country_code": "+52", "otp": "123456"},
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ---------- ordered creation ----------
def test_create_three_favorites_get_order_field(headers):
    ids = {}
    for i, text in enumerate(["TEST_A", "TEST_B", "TEST_C"]):
        r = requests.post(f"{BASE_URL}/api/favorites", json={"text": text, "language": "es"}, headers=headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["text"] == text
        assert data["language"] == "es"
        assert data.get("order") == i, f"expected order {i} got {data.get('order')}"
        ids[text] = data["id"]
    # persist for other tests
    pytest.favorite_ids = ids


def test_get_favorites_es_returns_in_order(headers):
    r = requests.get(f"{BASE_URL}/api/favorites?language=es", headers=headers)
    assert r.status_code == 200
    items = r.json()
    texts = [i["text"] for i in items if i["text"].startswith("TEST_")]
    assert texts == ["TEST_A", "TEST_B", "TEST_C"], texts


# ---------- reorder ----------
def test_reorder_favorites(headers):
    ids = pytest.favorite_ids
    payload = {"ids": [ids["TEST_C"], ids["TEST_B"], ids["TEST_A"]]}
    r = requests.put(f"{BASE_URL}/api/favorites/reorder", json=payload, headers=headers)
    assert r.status_code == 200
    assert r.json().get("success") is True

    r = requests.get(f"{BASE_URL}/api/favorites?language=es", headers=headers)
    assert r.status_code == 200
    texts = [i["text"] for i in r.json() if i["text"].startswith("TEST_")]
    assert texts == ["TEST_C", "TEST_B", "TEST_A"], texts


# ---------- rename ----------
def test_rename_favorite_success(headers):
    fid = pytest.favorite_ids["TEST_A"]
    r = requests.patch(f"{BASE_URL}/api/favorites/{fid}", json={"text": "TEST_A renamed"}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "TEST_A renamed"

    r = requests.get(f"{BASE_URL}/api/favorites?language=es", headers=headers)
    texts = [i["text"] for i in r.json() if i["id"] == fid]
    assert texts == ["TEST_A renamed"]


def test_rename_unknown_id_returns_404(headers):
    r = requests.patch(f"{BASE_URL}/api/favorites/does-not-exist", json={"text": "x"}, headers=headers)
    assert r.status_code == 404


def test_rename_empty_text_returns_400(headers):
    fid = pytest.favorite_ids["TEST_B"]
    r = requests.patch(f"{BASE_URL}/api/favorites/{fid}", json={"text": "   "}, headers=headers)
    assert r.status_code == 400


# ---------- delete still works ----------
def test_delete_favorite_still_works(headers):
    fid = pytest.favorite_ids["TEST_C"]
    r = requests.delete(f"{BASE_URL}/api/favorites/{fid}", headers=headers)
    assert r.status_code == 200

    r = requests.get(f"{BASE_URL}/api/favorites?language=es", headers=headers)
    ids = [i["id"] for i in r.json()]
    assert fid not in ids


# ---------- auth required ----------
@pytest.mark.parametrize(
    "method,path,body",
    [
        ("GET", "/api/favorites?language=es", None),
        ("POST", "/api/favorites", {"text": "x", "language": "es"}),
        ("PATCH", "/api/favorites/anything", {"text": "x"}),
        ("PUT", "/api/favorites/reorder", {"ids": []}),
        ("DELETE", "/api/favorites/anything", None),
    ],
)
def test_favorites_require_auth(method, path, body):
    r = requests.request(method, f"{BASE_URL}{path}", json=body)
    assert r.status_code == 401, f"{method} {path}: got {r.status_code}"


# ---------- cleanup ----------
def test_cleanup(headers):
    r = requests.get(f"{BASE_URL}/api/favorites", headers=headers)
    for f in r.json():
        requests.delete(f"{BASE_URL}/api/favorites/{f['id']}", headers=headers)
