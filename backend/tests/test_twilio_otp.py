"""Tests for Twilio-backed OTP send/verify with dev bypass for OTP_TEST_NUMBERS."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://sign-talk-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
# For 424-path tests we hit the backend directly because Cloudflare intercepts origin 424s
# and replaces the JSON body with its own HTML error page. Backend behavior must still be verified.
LOCAL_API = "http://0.0.0.0:8001/api"

TEST_PHONE = "5550003333"
TEST_CC = "+52"
NON_TEST_PHONE = "4155552671"
NON_TEST_CC = "+1"


@pytest.fixture
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


class TestSendOtpTest:
    def test_send_otp_test_number_returns_mode_test(self, s):
        r = s.post(f"{API}/auth/send-otp", json={"phone": TEST_PHONE, "country_code": TEST_CC})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("success") is True
        assert data.get("mode") == "test"
        # Must NOT leak any OTP or code in response
        blob = r.text.lower()
        assert "mock_otp" not in blob
        assert "123456" not in blob

    @pytest.mark.parametrize("raw", ["555 000 3333", "(555) 000-3333", "555-000-3333"])
    def test_send_otp_formatting_variants_normalize(self, s, raw):
        r = s.post(f"{API}/auth/send-otp", json={"phone": raw, "country_code": TEST_CC})
        assert r.status_code == 200, r.text
        assert r.json().get("mode") == "test"


class TestVerifyOtpTest:
    def test_verify_correct(self, s):
        r = s.post(f"{API}/auth/verify-otp", json={"phone": TEST_PHONE, "country_code": TEST_CC, "otp": "123456"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and body["token"]
        assert "user" in body and body["user"].get("phone") == "+525550003333"

    def test_verify_wrong(self, s):
        # Use a fresh phone to avoid throttle interference
        r = s.post(f"{API}/auth/verify-otp", json={"phone": "5550004444", "country_code": TEST_CC, "otp": "000000"})
        assert r.status_code == 400
        assert r.json().get("detail") == "Invalid OTP"

    def test_verify_formatting_variant(self, s):
        r = s.post(f"{API}/auth/verify-otp", json={"phone": "(555) 000-3333", "country_code": TEST_CC, "otp": "123456"})
        assert r.status_code == 200
        assert "token" in r.json()


class TestNonTestNumber:
    def test_send_otp_real_number_424_generic(self, s):
        # Test backend directly - CDN intercepts 424s at the edge
        r = s.post(f"{LOCAL_API}/auth/send-otp", json={"phone": NON_TEST_PHONE, "country_code": NON_TEST_CC})
        assert r.status_code == 424, r.text
        detail = r.json().get("detail", "")
        assert detail == "No se pudo enviar el SMS. Inténtalo de nuevo."
        # No SID or Twilio leak
        blob = r.text.lower()
        assert "twilio" not in blob
        assert "ac1a67f7596a47a70b42b0f2cce77bb931" not in blob
        assert "20003" not in blob

    def test_verify_otp_real_number_424_generic(self, s):
        r = s.post(f"{LOCAL_API}/auth/verify-otp", json={"phone": NON_TEST_PHONE, "country_code": NON_TEST_CC, "otp": "123456"})
        assert r.status_code == 424, r.text
        detail = r.json().get("detail", "")
        assert detail == "No se pudo verificar el código. Inténtalo de nuevo."
        blob = r.text.lower()
        assert "twilio" not in blob
        assert "ac1a67f7596a47a70b42b0f2cce77bb931" not in blob

    def test_public_424_masked_by_cdn(self, s):
        """Fixed: backend now returns 424 (non-5xx) so the JSON detail survives the CDN."""
        r = s.post(f"{API}/auth/send-otp", json={"phone": NON_TEST_PHONE, "country_code": NON_TEST_CC})
        assert r.status_code == 424
        assert "application/json" in r.headers.get("content-type", "")
        assert r.json()["detail"] == "No se pudo enviar el SMS. Inténtalo de nuevo."

    def test_send_otp_invalid_too_short(self, s):
        r = s.post(f"{API}/auth/send-otp", json={"phone": "12", "country_code": "+1"})
        assert r.status_code == 400
        assert r.json().get("detail") == "Número de teléfono inválido"


class TestThrottle:
    def test_wrong_codes_throttle(self, s):
        phone = "5550008888"
        # 5 wrong attempts should return 400; the 6th should be 429
        for i in range(5):
            r = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "country_code": TEST_CC, "otp": "000000"})
            assert r.status_code == 400, f"attempt {i+1}: {r.status_code} {r.text}"
        r = s.post(f"{API}/auth/verify-otp", json={"phone": phone, "country_code": TEST_CC, "otp": "000000"})
        assert r.status_code == 429, r.text


class TestRegressionAuthed:
    def test_traductor_favorites_after_login(self, s):
        # login via test phone
        r = s.post(f"{API}/auth/verify-otp", json={"phone": "5550002222", "country_code": TEST_CC, "otp": "123456"})
        assert r.status_code == 200
        token = r.json()["token"]
        h = {"Authorization": f"Bearer {token}"}
        r2 = s.get(f"{API}/favorites", headers=h)
        assert r2.status_code == 200
        assert isinstance(r2.json(), list)
