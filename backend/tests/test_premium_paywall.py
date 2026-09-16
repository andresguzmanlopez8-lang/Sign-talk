"""
Premium/Paywall backend tests for SignBridge.

Covers:
- GET /api/billing/plans (public)
- GET /api/billing/status (auth) — default free
- GET /api/avatars — public & authed free-user views (locks on m2/m3/f2/f3)
- PATCH /api/auth/profile — free user cannot switch to locked avatar (403), can pick free m1 (200)
- POST /api/billing/activate-test — yearly (trial 7d) & monthly, verifies limits, unlocks avatars,
  auth/me reflects is_premium, patch avatar m2 works
- POST /api/billing/deactivate-test — restores free state
- activate-test invalid plan -> 422
- Unauth on billing/status, activate-test, deactivate-test -> 401/403
- /translate/text-to-sign works for both free (queue) and premium (priority) user.

Cleanup: users +52 5550001111 and +52 5550002222 left NON-premium at the end.
"""

import os
import time
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://sign-talk-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OTP = "123456"
COUNTRY = "+52"
PHONE_A = "5550001111"  # main free user
PHONE_B = "5550002222"  # premium activation user
PHONE_C = "5550003333"  # secondary

FREE_AVATARS = {"m1", "f1"}
LOCKED_AVATARS = {"m2", "m3", "f2", "f3"}


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session: requests.Session, phone: str) -> dict:
    r = session.post(f"{API}/auth/send-otp", json={"phone": phone, "country_code": COUNTRY}, timeout=15)
    assert r.status_code == 200, f"send-otp failed: {r.status_code} {r.text}"
    r = session.post(f"{API}/auth/verify-otp", json={"phone": phone, "country_code": COUNTRY, "otp": OTP}, timeout=15)
    assert r.status_code == 200, f"verify-otp failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["token"], "user": data["user"], "headers": {"Authorization": f"Bearer {data['token']}"}}


@pytest.fixture(scope="session")
def user_a(api_client):
    ctx = _login(api_client, PHONE_A)
    # Ensure starts free
    api_client.post(f"{API}/billing/deactivate-test", headers=ctx["headers"], timeout=15)
    # Reset avatar to a free one
    api_client.patch(f"{API}/auth/profile", json={"avatar_id": "f1"}, headers=ctx["headers"], timeout=15)
    yield ctx
    # Teardown: leave non-premium
    api_client.post(f"{API}/billing/deactivate-test", headers=ctx["headers"], timeout=15)


@pytest.fixture(scope="session")
def user_b(api_client):
    ctx = _login(api_client, PHONE_B)
    api_client.post(f"{API}/billing/deactivate-test", headers=ctx["headers"], timeout=15)
    api_client.patch(f"{API}/auth/profile", json={"avatar_id": "m1"}, headers=ctx["headers"], timeout=15)
    yield ctx
    # Teardown: leave non-premium
    api_client.post(f"{API}/billing/deactivate-test", headers=ctx["headers"], timeout=15)
    # And reset avatar back to a free one
    api_client.patch(f"{API}/auth/profile", json={"avatar_id": "m1"}, headers=ctx["headers"], timeout=15)


# ---------- Billing plans (public) ----------
class TestBillingPlans:
    def test_plans_public_no_auth(self, api_client):
        r = api_client.get(f"{API}/billing/plans", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("dev_mode") is True
        plans = {p["id"]: p for p in body["plans"]}
        assert set(plans.keys()) == {"monthly", "yearly"}

        m = plans["monthly"]
        assert m["product_id"] == "signbridge_premium_monthly"
        assert m["price_mxn"] == 79
        assert m["price_usd"] == 3.99
        assert m["trial_days"] == 0

        y = plans["yearly"]
        assert y["product_id"] == "signbridge_premium_yearly"
        assert y["price_mxn"] == 599
        assert y["price_usd"] == 29.99
        assert y["trial_days"] == 7
        assert y["best_value"] is True

        # sanity limits shape
        assert body["free_limits"]["sign_record_seconds"] == 15
        assert body["free_limits"]["ad_every_messages"] == 10
        assert body["premium_limits"]["sign_record_seconds"] == 60
        assert body["premium_limits"]["ad_every_messages"] == 0


# ---------- Billing status ----------
class TestBillingStatus:
    def test_status_default_free(self, api_client, user_a):
        r = api_client.get(f"{API}/billing/status", headers=user_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["is_premium"] is False
        limits = b["limits"]
        assert limits["sign_record_seconds"] == 15
        assert limits["ad_every_messages"] == 10
        assert sorted(limits["avatars"]) == ["f1", "m1"]

    def test_status_unauth_401(self, api_client):
        r = api_client.get(f"{API}/billing/status", timeout=15)
        assert r.status_code in (401, 403), r.text


# ---------- Avatars catalog ----------
class TestAvatars:
    def test_avatars_public(self, api_client):
        r = api_client.get(f"{API}/avatars", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["default_id"] == "f1"
        assert sorted(body["free_ids"]) == ["f1", "m1"]
        assert body["is_premium"] is False
        by_id = {a["id"]: a for a in body["items"]}
        for fid in FREE_AVATARS:
            assert by_id[fid]["locked"] is False, f"{fid} should be unlocked"
        for lid in LOCKED_AVATARS:
            assert by_id[lid]["locked"] is True, f"{lid} should be locked (public)"

    def test_avatars_free_user(self, api_client, user_a):
        r = api_client.get(f"{API}/avatars", headers=user_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_premium"] is False
        by_id = {a["id"]: a for a in body["items"]}
        for fid in FREE_AVATARS:
            assert by_id[fid]["locked"] is False
        for lid in LOCKED_AVATARS:
            assert by_id[lid]["locked"] is True


# ---------- Profile avatar guarding ----------
class TestProfileAvatarGuarding:
    def test_free_cannot_set_locked_avatar(self, api_client, user_a):
        r = api_client.patch(f"{API}/auth/profile", json={"avatar_id": "m2"}, headers=user_a["headers"], timeout=15)
        assert r.status_code == 403, r.text

    def test_free_can_set_free_avatar(self, api_client, user_a):
        r = api_client.patch(f"{API}/auth/profile", json={"avatar_id": "m1"}, headers=user_a["headers"], timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("avatar_id") == "m1"


# ---------- Activate/deactivate test ----------
class TestActivateDeactivate:
    def test_activate_yearly_unlocks_everything(self, api_client, user_b):
        r = api_client.post(f"{API}/billing/activate-test", json={"plan": "yearly"},
                            headers=user_b["headers"], timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["is_premium"] is True
        assert b["plan"] == "yearly"
        # Trial ~ now + 7d
        assert b["trial_ends_at"], "trial_ends_at should be set for yearly"
        end = datetime.fromisoformat(b["trial_ends_at"])
        delta_days = (end - datetime.now(timezone.utc)).total_seconds() / 86400.0
        assert 6.5 <= delta_days <= 7.5, f"trial_ends_at ~7d expected, got {delta_days:.2f}d"
        assert b["limits"]["sign_record_seconds"] == 60
        assert b["limits"]["ad_every_messages"] == 0
        assert set(b["limits"]["avatars"]) >= (FREE_AVATARS | LOCKED_AVATARS)

        # /avatars now all unlocked for this user
        r2 = api_client.get(f"{API}/avatars", headers=user_b["headers"], timeout=15)
        assert r2.status_code == 200
        body = r2.json()
        assert body["is_premium"] is True
        assert all(a["locked"] is False for a in body["items"])

        # Can switch to locked avatar
        r3 = api_client.patch(f"{API}/auth/profile", json={"avatar_id": "m2"},
                              headers=user_b["headers"], timeout=15)
        assert r3.status_code == 200, r3.text
        assert r3.json()["avatar_id"] == "m2"

        # /auth/me is_premium true
        r4 = api_client.get(f"{API}/auth/me", headers=user_b["headers"], timeout=15)
        assert r4.status_code == 200
        assert r4.json().get("is_premium") is True

    def test_activate_monthly_no_trial(self, api_client, user_b):
        r = api_client.post(f"{API}/billing/activate-test", json={"plan": "monthly"},
                            headers=user_b["headers"], timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["is_premium"] is True
        assert b["plan"] == "monthly"
        assert b["trial_ends_at"] in (None, "", None)

    def test_deactivate(self, api_client, user_b):
        r = api_client.post(f"{API}/billing/deactivate-test", headers=user_b["headers"], timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["is_premium"] is False
        assert b["plan"] in (None, "")
        assert b["limits"]["sign_record_seconds"] == 15
        assert b["limits"]["ad_every_messages"] == 10

        # After deactivate, /avatars re-locks
        r2 = api_client.get(f"{API}/avatars", headers=user_b["headers"], timeout=15)
        by_id = {a["id"]: a for a in r2.json()["items"]}
        for lid in LOCKED_AVATARS:
            assert by_id[lid]["locked"] is True

    def test_activate_invalid_plan_422(self, api_client, user_a):
        r = api_client.post(f"{API}/billing/activate-test", json={"plan": "lifetime"},
                            headers=user_a["headers"], timeout=15)
        assert r.status_code == 422, r.text

    def test_activate_unauth(self, api_client):
        r = api_client.post(f"{API}/billing/activate-test", json={"plan": "yearly"}, timeout=15)
        assert r.status_code in (401, 403), r.text

    def test_deactivate_unauth(self, api_client):
        r = api_client.post(f"{API}/billing/deactivate-test", timeout=15)
        assert r.status_code in (401, 403), r.text


# ---------- text-to-sign priority path ----------
class TestTextToSign:
    def test_text_to_sign_free_user(self, api_client, user_a):
        r = api_client.post(f"{API}/translate/text-to-sign",
                            json={"text": "hola", "language": "es"},
                            headers=user_a["headers"], timeout=120)
        assert r.status_code == 200, r.text
        body = r.json()
        # Response is a Message dict with a video_url or sign_sequence
        assert body.get("direction") == "text_to_sign"
        assert body.get("translated_text")

    def test_text_to_sign_premium_priority(self, api_client, user_b):
        # Activate premium
        act = api_client.post(f"{API}/billing/activate-test", json={"plan": "yearly"},
                              headers=user_b["headers"], timeout=15)
        assert act.status_code == 200

        r = api_client.post(f"{API}/translate/text-to-sign",
                            json={"text": "gracias", "language": "es"},
                            headers=user_b["headers"], timeout=120)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("direction") == "text_to_sign"
        assert body.get("translated_text")

        # Deactivate to leave non-premium
        d = api_client.post(f"{API}/billing/deactivate-test", headers=user_b["headers"], timeout=15)
        assert d.status_code == 200
        assert d.json()["is_premium"] is False


# ---------- Final cleanup guarantee ----------
def test_zzz_final_cleanup_leaves_users_non_premium(api_client):
    for phone in (PHONE_A, PHONE_B):
        ctx = _login(api_client, phone)
        api_client.post(f"{API}/billing/deactivate-test", headers=ctx["headers"], timeout=15)
        # Reset avatar to a free one so the app stays consistent
        api_client.patch(f"{API}/auth/profile", json={"avatar_id": "f1" if phone == PHONE_A else "m1"},
                         headers=ctx["headers"], timeout=15)
        s = api_client.get(f"{API}/billing/status", headers=ctx["headers"], timeout=15).json()
        assert s["is_premium"] is False, f"{phone} still premium!"
