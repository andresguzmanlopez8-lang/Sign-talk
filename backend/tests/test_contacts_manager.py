"""Backend tests for Contacts Manager (UserContacts collection + /api/contacts endpoints)."""
import os
import time
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
if not BASE_URL:
    # Fallback: read from frontend .env
    from pathlib import Path
    envf = Path("/app/frontend/.env").read_text()
    for line in envf.splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

API = f"{BASE_URL}/api"


def _login(phone: str) -> str:
    """Return bearer token for a given phone via mock OTP."""
    requests.post(f"{API}/auth/send-otp", json={"phone": phone, "country_code": "+52"}, timeout=10)
    r = requests.post(
        f"{API}/auth/verify-otp",
        json={"phone": phone, "country_code": "+52", "otp": "123456"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def user_a_token():
    # unique phone for this test run
    phone = f"55TESTA{int(time.time())}"
    return _login(phone)


@pytest.fixture(scope="module")
def user_b_token():
    phone = f"55TESTB{int(time.time())}"
    return _login(phone)


@pytest.fixture(autouse=True)
def _cleanup(user_a_token, user_b_token):
    # cleanup contacts before/after the test to keep the module isolated
    def _wipe(tok):
        h = {"Authorization": f"Bearer {tok}"}
        items = requests.get(f"{API}/contacts", headers=h, timeout=10).json()
        for c in items:
            requests.delete(f"{API}/contacts/{c['id']}", headers=h, timeout=10)
    _wipe(user_a_token); _wipe(user_b_token)
    yield
    _wipe(user_a_token); _wipe(user_b_token)


# -------- POST /api/contacts/view --------

def test_view_first_time_creates_andy(user_a_token):
    h = {"Authorization": f"Bearer {user_a_token}"}
    payload = {
        "profileId": "demo-andy",
        "displayName": "Andy",
        "profileImageUrl": "https://i.pravatar.cc/150?u=andy",
        "phone": "+52 55 0000 0001",
    }
    r = requests.post(f"{API}/contacts/view", json=payload, headers=h, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["created"] is True
    assert data["message"] == "Contacto sincronizado automáticamente"
    c = data["contact"]
    assert c["displayName"] == "Andy"
    assert c["profileImageUrl"] == "https://i.pravatar.cc/150?u=andy"
    assert c["phone"] == "+52 55 0000 0001"
    assert c["isSavedLocally"] is True
    assert "id" in c and c["id"]
    assert "lastSyncDate" in c and c["lastSyncDate"]
    # must not leak internals
    assert "owner_user_id" not in c
    assert "_id" not in c


def test_view_second_time_refreshes_only(user_a_token):
    h = {"Authorization": f"Bearer {user_a_token}"}
    payload = {
        "profileId": "demo-andy",
        "displayName": "Andy",
        "profileImageUrl": "https://i.pravatar.cc/150?u=andy",
        "phone": "+52 55 0000 0001",
    }
    r1 = requests.post(f"{API}/contacts/view", json=payload, headers=h, timeout=10).json()
    time.sleep(1.1)
    r2 = requests.post(f"{API}/contacts/view", json=payload, headers=h, timeout=10)
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["created"] is False
    assert d2["message"] is None
    assert d2["contact"]["id"] == r1["contact"]["id"]
    assert d2["contact"]["lastSyncDate"] >= r1["contact"]["lastSyncDate"]


def test_get_contacts_after_andy(user_a_token):
    h = {"Authorization": f"Bearer {user_a_token}"}
    requests.post(f"{API}/contacts/view", json={
        "profileId": "demo-andy", "displayName": "Andy",
        "profileImageUrl": "https://i.pravatar.cc/150?u=andy",
        "phone": "+52 55 0000 0001",
    }, headers=h, timeout=10)
    r = requests.get(f"{API}/contacts", headers=h, timeout=10)
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["displayName"] == "Andy"
    assert "owner_user_id" not in items[0]
    assert "_id" not in items[0]


def test_view_by_phone_without_profileId_dedupes(user_a_token):
    h = {"Authorization": f"Bearer {user_a_token}"}
    payload = {"displayName": "Beatriz", "phone": "+52 55 9999 8888"}
    r1 = requests.post(f"{API}/contacts/view", json=payload, headers=h, timeout=10).json()
    assert r1["created"] is True
    r2 = requests.post(f"{API}/contacts/view", json=payload, headers=h, timeout=10).json()
    assert r2["created"] is False
    assert r2["contact"]["id"] == r1["contact"]["id"]


def test_get_contacts_sorted_desc(user_a_token):
    h = {"Authorization": f"Bearer {user_a_token}"}
    requests.post(f"{API}/contacts/view", json={
        "profileId": "demo-andy", "displayName": "Andy", "phone": "+52 55 0000 0001",
    }, headers=h, timeout=10)
    time.sleep(1.1)
    requests.post(f"{API}/contacts/view", json={
        "displayName": "Beatriz", "phone": "+52 55 9999 8888",
    }, headers=h, timeout=10)
    r = requests.get(f"{API}/contacts", headers=h, timeout=10)
    items = r.json()
    assert len(items) == 2
    # newer first
    assert items[0]["lastSyncDate"] >= items[1]["lastSyncDate"]
    assert items[0]["displayName"] == "Beatriz"


def test_delete_contact_then_404(user_a_token):
    h = {"Authorization": f"Bearer {user_a_token}"}
    created = requests.post(f"{API}/contacts/view", json={
        "profileId": "demo-andy", "displayName": "Andy", "phone": "+52 55 0000 0001",
    }, headers=h, timeout=10).json()["contact"]
    r1 = requests.delete(f"{API}/contacts/{created['id']}", headers=h, timeout=10)
    assert r1.status_code == 200
    assert r1.json().get("success") is True
    r2 = requests.delete(f"{API}/contacts/{created['id']}", headers=h, timeout=10)
    assert r2.status_code == 404


def test_view_validation_empty_display_name(user_a_token):
    h = {"Authorization": f"Bearer {user_a_token}"}
    r = requests.post(f"{API}/contacts/view", json={"displayName": ""}, headers=h, timeout=10)
    assert r.status_code == 422


def test_no_auth_returns_401():
    r = requests.post(f"{API}/contacts/view", json={"displayName": "X"}, timeout=10)
    assert r.status_code == 401
    r2 = requests.get(f"{API}/contacts", timeout=10)
    assert r2.status_code == 401


def test_owner_scoping_between_users(user_a_token, user_b_token):
    ha = {"Authorization": f"Bearer {user_a_token}"}
    hb = {"Authorization": f"Bearer {user_b_token}"}
    requests.post(f"{API}/contacts/view", json={
        "profileId": "demo-andy", "displayName": "Andy", "phone": "+52 55 0000 0001",
    }, headers=ha, timeout=10)
    items_b = requests.get(f"{API}/contacts", headers=hb, timeout=10).json()
    assert items_b == []


# -------- DB verification --------

def test_mongo_collection_and_document_shape(user_a_token):
    h = {"Authorization": f"Bearer {user_a_token}"}
    requests.post(f"{API}/contacts/view", json={
        "profileId": "demo-andy", "displayName": "Andy",
        "profileImageUrl": "https://i.pravatar.cc/150?u=andy",
        "phone": "+52 55 0000 0001",
    }, headers=h, timeout=10)

    mc = MongoClient(MONGO_URL)
    db = mc[DB_NAME]
    assert "UserContacts" in db.list_collection_names(), "Collection must be literally named 'UserContacts'"
    doc = db.UserContacts.find_one({"displayName": "Andy"})
    assert doc is not None
    assert "displayName" in doc
    assert "profileImageUrl" in doc
    assert "lastSyncDate" in doc
    from datetime import datetime as _dt
    assert isinstance(doc["lastSyncDate"], _dt)
    assert doc["isSavedLocally"] is True
    mc.close()
