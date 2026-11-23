"""ENROLL-0060 T22: the three open-alert routes (DB mocked; SQL is covered by
test_migration_394_course_open_alerts.py)."""
from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from routers import course_open_alerts as R

GUEST_EMAIL = "khach@example.test"
TOKEN = "a" * 64


class _Call:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        self.db.calls.append((self.name, self.params))
        result = self.db.results.get(self.name)
        if isinstance(result, Exception):
            raise result
        return type("R", (), {"data": result})()


class _DB:
    def __init__(self, **results):
        self.calls: list[tuple[str, dict]] = []
        self.results = {"fn_course_open_alert_attempt_check": {"allowed": True, "retry_after_s": 0},
                        "fn_course_open_alert_subscribe": "ok",
                        "fn_course_open_alert_unsubscribe": 1,
                        "fn_course_open_alerts_for_user": ["ielts-65"], **results}

    def rpc(self, name, params):
        return _Call(self, name, params)

    def names(self):
        return [name for name, _ in self.calls]


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(R.router)
    db = _DB()
    monkeypatch.setattr(R, "supabase_admin", db)

    async def _user(authorization):
        if authorization != "Bearer good":
            raise HTTPException(401, "Token không hợp lệ hoặc đã hết hạn")
        return {"id": "11111111-1111-1111-1111-111111111111", "email": "hocvien@example.test"}

    monkeypatch.setattr(R, "get_supabase_user", _user)
    c = TestClient(app)
    c.db = db
    return c


def test_guest_subscribe_is_202_ok_and_never_returns_a_token(client):
    response = client.post("/api/courses/ielts-65/open-alerts", json={"email": f" {GUEST_EMAIL} "},
                           headers={"X-Real-IP": "203.0.113.7"})
    assert response.status_code == 202 and response.json() == {"ok": True}
    assert "token" not in response.text
    check, subscribe = client.db.calls
    assert check[0] == "fn_course_open_alert_attempt_check" and check[1]["p_action"] == "subscribe"
    key = check[1]["p_rate_key"]  # guest: per keyed hash of the IP (amendment 1)
    assert key.startswith("ip:") and len(key) == 35 and "203.0.113.7" not in key
    assert subscribe == ("fn_course_open_alert_subscribe",
                         {"p_slug": "ielts-65", "p_email": GUEST_EMAIL, "p_user_id": None})


def test_signed_in_subscribe_uses_the_account_email_not_the_body(client):
    response = client.post("/api/courses/ielts-65/open-alerts", json={"email": "someone@else.test"},
                           headers={"Authorization": "Bearer good"})
    assert response.status_code == 202
    assert client.db.calls[-1][1] == {"p_slug": "ielts-65", "p_email": "hocvien@example.test",
                                      "p_user_id": "11111111-1111-1111-1111-111111111111"}
    # Signed in: counted per account, whatever the IP (amendment 1).
    assert client.db.calls[0][1] == {"p_rate_key": "user:11111111-1111-1111-1111-111111111111",
                                     "p_action": "subscribe"}


def test_bad_session_is_401_not_a_silent_guest_subscribe(client):
    response = client.post("/api/courses/ielts-65/open-alerts", json={"email": GUEST_EMAIL},
                           headers={"Authorization": "Bearer stale"})
    assert response.status_code == 401 and client.db.calls == []


@pytest.mark.parametrize("email", ["", "no-at-sign", "a@b", "two@@example.test", "x" * 250 + "@ex.test"])
def test_guest_email_is_validated_before_any_db_call(client, email):
    response = client.post("/api/courses/ielts-65/open-alerts", json={"email": email})
    assert response.status_code == 422 and client.db.calls == []


@pytest.mark.parametrize("result, status, code", [
    ("course_not_found", 404, "course_not_found"),
    ("course_already_open", 409, "course_already_open"),
])
def test_subscribe_refusals(client, result, status, code):
    client.db.results["fn_course_open_alert_subscribe"] = result
    response = client.post("/api/courses/ielts-65/open-alerts", json={"email": GUEST_EMAIL})
    assert response.status_code == status and response.json()["detail"]["error_code"] == code


def test_bad_slug_is_404_without_db(client):
    response = client.post("/api/courses/Not_A_Slug/open-alerts", json={"email": GUEST_EMAIL})
    assert response.status_code == 404 and client.db.calls == []


def test_rate_limited_is_429_with_retry_after_and_no_subscribe(client):
    client.db.results["fn_course_open_alert_attempt_check"] = {"allowed": False, "retry_after_s": 1200}
    response = client.post("/api/courses/ielts-65/open-alerts", json={"email": GUEST_EMAIL})
    assert response.status_code == 429 and response.headers["Retry-After"] == "1200"
    assert response.json()["detail"]["error_code"] == "open_alert_rate_limited"
    assert client.db.names() == ["fn_course_open_alert_attempt_check"]


@pytest.mark.parametrize("verdict", [RuntimeError("PGRST202 function missing"), None,
                                     {"allowed": "yes", "retry_after_s": 0}])
def test_counter_failure_fails_closed_with_503(client, verdict, caplog):
    client.db.results["fn_course_open_alert_attempt_check"] = verdict
    with caplog.at_level(logging.ERROR):
        response = client.post("/api/courses/ielts-65/open-alerts", json={"email": GUEST_EMAIL})
    assert response.status_code == 503
    assert response.json()["detail"]["error_code"] == "open_alerts_unavailable"
    assert client.db.names() == ["fn_course_open_alert_attempt_check"]
    assert GUEST_EMAIL not in caplog.text


def test_subscribe_rpc_failure_is_503_and_logs_no_email(client, caplog):
    client.db.results["fn_course_open_alert_subscribe"] = RuntimeError("42883 undefined function")
    with caplog.at_level(logging.ERROR):
        response = client.post("/api/courses/ielts-65/open-alerts", json={"email": GUEST_EMAIL})
    assert response.status_code == 503 and GUEST_EMAIL not in caplog.text


def test_unsubscribe_by_mail_token_needs_no_session_and_is_idempotent(client):
    for count in (1, 0):  # second click, or an unknown token: still 200
        client.db.results["fn_course_open_alert_unsubscribe"] = count
        response = client.request("DELETE", "/api/courses/ielts-65/open-alerts",
                                  json={"unsubscribe_token": TOKEN})
        assert response.status_code == 200 and response.json() == {"ok": True}
    name, params = client.db.calls[-1]
    assert name == "fn_course_open_alert_unsubscribe"
    assert params == {"p_slug": "ielts-65", "p_token": TOKEN, "p_user_id": None, "p_email": None}
    checks = [p for n, p in client.db.calls if n == "fn_course_open_alert_attempt_check"]
    assert [p["p_action"] for p in checks] == ["unsubscribe", "unsubscribe"]
    assert all(p["p_rate_key"].startswith("ip:") for p in checks)  # no session: per IP


def test_unsubscribe_by_session(client):
    response = client.request("DELETE", "/api/courses/ielts-65/open-alerts", json={},
                              headers={"Authorization": "Bearer good"})
    assert response.status_code == 200
    assert client.db.calls[0][1]["p_rate_key"] == "user:11111111-1111-1111-1111-111111111111"
    assert client.db.calls[-1][1] == {"p_slug": "ielts-65", "p_token": None,
                                      "p_user_id": "11111111-1111-1111-1111-111111111111",
                                      "p_email": "hocvien@example.test"}


def test_unsubscribe_without_token_or_session_is_401(client):
    response = client.request("DELETE", "/api/courses/ielts-65/open-alerts", json={})
    assert response.status_code == 401 and client.db.calls == []


def test_unsubscribe_rate_limit(client):
    client.db.results["fn_course_open_alert_attempt_check"] = {"allowed": False, "retry_after_s": 30}
    response = client.request("DELETE", "/api/courses/ielts-65/open-alerts", json={"unsubscribe_token": TOKEN})
    assert response.status_code == 429
    assert client.db.names() == ["fn_course_open_alert_attempt_check"]


def test_my_open_alerts(client):
    response = client.get("/api/me/open-alerts", headers={"Authorization": "Bearer good"})
    assert response.status_code == 200 and response.json() == {"slugs": ["ielts-65"]}
    assert client.db.calls == [("fn_course_open_alerts_for_user",
                                {"p_user_id": "11111111-1111-1111-1111-111111111111",
                                 "p_email": "hocvien@example.test"})]
    assert client.get("/api/me/open-alerts").status_code == 401
    client.db.results["fn_course_open_alerts_for_user"] = {"bad": "shape"}
    assert client.get("/api/me/open-alerts", headers={"Authorization": "Bearer good"}).status_code == 503


def test_ip_hash_is_keyed_and_stable(monkeypatch):
    class _Req:
        def __init__(self, ip):
            self.headers = {"x-real-ip": ip}
            self.client = None
    a1, a2, b = R._ip_hash(_Req("198.51.100.1")), R._ip_hash(_Req("198.51.100.1")), R._ip_hash(_Req("198.51.100.2"))
    assert a1 == a2 != b
    monkeypatch.setattr(R.settings, "READING_ANON_SALT", "another-key")
    assert R._ip_hash(_Req("198.51.100.1")) != a1


def test_routes_are_activation_exempt_and_registered():
    import main
    from services.activation_gate import ACTIVATION_EXEMPT_ROUTES
    paths = {(m, r.path) for r in main.app.routes if hasattr(r, "methods") for m in r.methods}
    for key in (("POST", "/api/courses/{slug}/open-alerts"), ("DELETE", "/api/courses/{slug}/open-alerts"),
                ("GET", "/api/me/open-alerts")):
        assert key in ACTIVATION_EXEMPT_ROUTES and key in paths
