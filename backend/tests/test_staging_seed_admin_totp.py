"""ADMINAAL2-0032 FR-016 / T009: the staging seed's admin TOTP step.

The secret must reach only the QA creds store file (0600), never stdout or an
error message; a reseed keeps a verified factor only when the stored secret
still verifies. GoTrue is replaced by an in-memory double, so no network.
"""

from __future__ import annotations

import stat
import time

import pytest

from scripts import staging_seed

URL = "https://zjphffoujxkpltixsbzj.supabase.co"
AUTH_ENV = (URL, "service-key", "anon-key")
UID = "11111111-1111-4111-8111-111111111111"
RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
PASSWORD = "seed-password"


class FakeGoTrue:
    def __init__(self, factors=None, secret=RFC_SECRET):
        self.factors = list(factors or [])
        self.secret = secret
        self.calls: list[tuple[str, str, dict | None]] = []
        self.codes: list[str] = []

    def __call__(self, method, url, *, apikey, bearer=None, body=None):
        path = url.removeprefix(URL)
        self.calls.append((method, path, body))
        admin_path = f"/auth/v1/admin/users/{UID}/factors"
        if method == "GET" and path == admin_path:
            assert apikey == "service-key"
            return [dict(f) for f in self.factors]
        if method == "DELETE" and path.startswith(admin_path + "/"):
            fid = path.rsplit("/", 1)[1]
            self.factors = [f for f in self.factors if f["id"] != fid]
            return {}
        if method == "POST" and path == "/auth/v1/token?grant_type=password":
            assert apikey == "anon-key" and body["password"] == PASSWORD
            return {"access_token": "aal1-token"}
        if method == "POST" and path == "/auth/v1/factors":
            assert bearer == "aal1-token"
            self.factors.append({"id": "new-factor", "factor_type": "totp", "status": "unverified"})
            return {"id": "new-factor", "totp": {"secret": self.secret, "uri": "otpauth://…"}}
        if method == "POST" and path.endswith("/challenge"):
            return {"id": "challenge-1"}
        if method == "POST" and path.endswith("/verify"):
            self.codes.append(body["code"])
            now = time.time()  # GoTrue accepts one 30 s step of skew
            if body["code"] not in {staging_seed._totp(self.secret, now + d) for d in (-30, 0, 30)}:
                raise staging_seed.GoTrueError(f"POST {path} -> HTTP 422 mfa_verification_failed")
            fid = path.split("/")[-2]
            for f in self.factors:
                if f["id"] == fid:
                    f["status"] = "verified"
            return {"access_token": "aal2-token"}
        raise AssertionError(f"unexpected GoTrue call {method} {path}")


@pytest.fixture
def gotrue(monkeypatch):
    def install(**kwargs):
        fake = FakeGoTrue(**kwargs)
        monkeypatch.setattr(staging_seed, "_gotrue", fake)
        return fake
    return install


def _run(secret_file, *, reset=False):
    staging_seed._ensure_admin_totp(AUTH_ENV, UID, "smoke", PASSWORD, secret_file, reset)


def _assert_no_secret(text: str, *secrets: str) -> None:
    for secret in (RFC_SECRET, PASSWORD, "aal1-token", "aal2-token", *secrets):
        assert secret not in text


def test_totp_matches_rfc_6238_vectors():
    assert staging_seed._totp(RFC_SECRET, 59) == "287082"
    assert staging_seed._totp(RFC_SECRET, 1111111109) == "081804"
    assert staging_seed._totp(RFC_SECRET.lower(), 1234567890) == "005924"


def test_enroll_writes_the_secret_only_to_a_0600_creds_file(gotrue, tmp_path, capsys):
    fake = gotrue(factors=[
        {"id": "stale", "factor_type": "totp", "status": "unverified"},
        {"id": "phone", "factor_type": "phone", "status": "verified"},
    ])
    secret_file = tmp_path / "creds" / "staging-e2e-admin-totp-smoke.env"
    _run(secret_file)

    assert ("DELETE", f"/auth/v1/admin/users/{UID}/factors/stale", None) in fake.calls
    assert not any(c[1].endswith("/factors/phone") for c in fake.calls), "non-TOTP factors are left alone"
    assert {"id": "new-factor", "factor_type": "totp", "status": "verified"} in fake.factors
    assert stat.S_IMODE(secret_file.stat().st_mode) == 0o600
    assert stat.S_IMODE(secret_file.parent.stat().st_mode) == 0o700
    assert f"STAGING_E2E_ADMIN_TOTP_SECRET={RFC_SECRET}\n" in secret_file.read_text()
    assert [p.name for p in secret_file.parent.iterdir()] == [secret_file.name], "no temp file left"
    out = capsys.readouterr()
    assert "enrolled and verified" in out.out
    _assert_no_secret(out.out + out.err, *fake.codes)


def test_reseed_keeps_a_verified_factor_after_proving_the_stored_secret(gotrue, tmp_path, capsys):
    secret_file = tmp_path / "admin.env"
    staging_seed._write_totp_secret(secret_file, RFC_SECRET, "note")
    fake = gotrue(factors=[{"id": "kept", "factor_type": "totp", "status": "verified"}])
    _run(secret_file)

    methods = [(m, p) for m, p, _ in fake.calls]
    assert ("POST", "/auth/v1/factors/kept/verify") in methods
    assert not any(m == "DELETE" for m, _ in methods) and ("POST", "/auth/v1/factors") not in methods
    assert len(fake.codes) == 1
    out = capsys.readouterr()
    assert "TOTP factor kept" in out.out
    _assert_no_secret(out.out + out.err, *fake.codes)


@pytest.mark.parametrize("stored", [None, "JBSWY3DPEHPK3PXP"])
def test_verified_factor_without_a_working_stored_secret_stops_with_the_reset_hint(gotrue, tmp_path, capsys, stored):
    secret_file = tmp_path / "admin.env"
    if stored:
        staging_seed._write_totp_secret(secret_file, stored, "note")
    fake = gotrue(factors=[{"id": "kept", "factor_type": "totp", "status": "verified"}])
    with pytest.raises(SystemExit) as exc:
        _run(secret_file)
    message = str(exc.value)
    assert "--reset-admin-totp" in message
    assert not any(m == "DELETE" for m, _, _ in fake.calls), "never deletes a verified factor implicitly"
    out = capsys.readouterr()
    _assert_no_secret(message + out.out + out.err, stored or RFC_SECRET, *fake.codes)


def test_reset_replaces_every_totp_factor_and_rewrites_the_secret(gotrue, tmp_path):
    secret_file = tmp_path / "admin.env"
    staging_seed._write_totp_secret(secret_file, "JBSWY3DPEHPK3PXP", "old")
    fake = gotrue(factors=[
        {"id": "v1", "factor_type": "totp", "status": "verified"},
        {"id": "u1", "factor_type": "totp", "status": "unverified"},
    ])
    _run(secret_file, reset=True)
    deleted = {p.rsplit("/", 1)[1] for m, p, _ in fake.calls if m == "DELETE"}
    assert deleted == {"v1", "u1"}
    assert [f["id"] for f in fake.factors] == ["new-factor"]
    assert staging_seed._read_totp_secret(secret_file) == RFC_SECRET


def test_gotrue_error_summary_carries_no_request_body(monkeypatch):
    import io
    import urllib.error

    def refuse(req, timeout):
        assert PASSWORD.encode() in req.data
        body = io.BytesIO(b'{"error_code":"invalid_credentials","msg":"Invalid login credentials"}')
        raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {}, body)

    monkeypatch.setattr(staging_seed.urllib.request, "urlopen", refuse)
    with pytest.raises(staging_seed.GoTrueError) as exc:
        staging_seed._gotrue("POST", f"{URL}/auth/v1/token?grant_type=password",
                             apikey="anon-key", body={"email": "e", "password": PASSWORD})
    assert str(exc.value) == "POST /auth/v1/token -> HTTP 400 invalid_credentials"
    assert exc.value.__cause__ is None and exc.value.__suppress_context__


# ── seed(): every precondition runs before the first write (job 1oh) ─────


class FakeQuery:
    def __init__(self, sb, table):
        self.sb, self.table, self.op, self.payload, self.filters = sb, table, "select", None, []

    def select(self, *_):
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def limit(self, _):
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def upsert(self, payload):
        self.op, self.payload = "upsert", payload
        return self

    def execute(self):
        from types import SimpleNamespace
        if self.op == "select":
            rows = [r for r in self.sb.rows.get(self.table, [])
                    if all(r.get(c) == v for c, v in self.filters)]
            return SimpleNamespace(data=rows)
        self.sb.events.append(("db-write", self.op, self.table))
        return SimpleNamespace(data=[{"id": f"{self.table}-{len(self.sb.events)}"}])


class FakeSupabase:
    """Every seeded identity already exists, so a reseed rotates 4 passwords."""

    def __init__(self, events):
        from types import SimpleNamespace
        self.events = events
        ids = {"student": "s-id", "unactivated": "u-id", "instructor": "i-id", "admin": UID}
        self.rows = {"users": [{"id": i, "email": staging_seed._email(r, "smoke")} for r, i in ids.items()]}
        self.auth = SimpleNamespace(admin=SimpleNamespace(
            update_user_by_id=lambda uid, attrs: events.append(("password", uid)),
            create_user=lambda attrs: events.append(("create_user", attrs["email"])),
            list_users=lambda **_: [],
        ))

    def table(self, name):
        return FakeQuery(self, name)


@pytest.fixture
def seed_env(monkeypatch, gotrue):
    events: list[tuple] = []
    fake_gotrue = gotrue(factors=[{"id": "kept", "factor_type": "totp", "status": "verified"}])

    def logged_gotrue(method, url, **kwargs):
        events.append(("gotrue", method, url.removeprefix(URL)))
        return fake_gotrue(method, url, **kwargs)

    monkeypatch.setattr(staging_seed, "_gotrue", logged_gotrue)
    monkeypatch.setattr(staging_seed, "_staging_auth_env", lambda: AUTH_ENV)
    monkeypatch.setattr(staging_seed, "_client", lambda: FakeSupabase(events))
    return events


@pytest.mark.parametrize("stored", [None, "", "NOT-BASE32!"])
def test_seed_changes_no_password_when_the_totp_precondition_fails(seed_env, tmp_path, capsys, stored):
    secret_file = tmp_path / "admin.env"
    if stored is not None:
        staging_seed._write_totp_secret(secret_file, stored, "note")
    with pytest.raises(SystemExit) as exc:
        staging_seed.seed("smoke", PASSWORD, secret_file, False)

    assert not [e for e in seed_env if e[0] in {"password", "create_user", "db-write"}], seed_env
    assert seed_env == [("gotrue", "GET", f"/auth/v1/admin/users/{UID}/factors")], "precheck is read-only"
    message = str(exc.value)
    assert "--reset-admin-totp" in message and "Nothing was changed" in message
    out = capsys.readouterr()
    assert "seeding staging namespace" not in out.out
    _assert_no_secret(message + out.out + out.err, PASSWORD)


def test_seed_refuses_a_directory_as_the_totp_file_before_any_write(seed_env, tmp_path):
    with pytest.raises(SystemExit) as exc:
        staging_seed.seed("smoke", PASSWORD, tmp_path, False)
    assert "is a directory" in str(exc.value)
    assert seed_env == []


def test_seed_checks_the_totp_precondition_before_rotating_passwords(seed_env, tmp_path):
    secret_file = tmp_path / "admin.env"
    staging_seed._write_totp_secret(secret_file, RFC_SECRET, "note")
    staging_seed.seed("smoke", PASSWORD, secret_file, False)

    first_write = next(i for i, e in enumerate(seed_env) if e[0] in {"password", "db-write"})
    assert ("gotrue", "GET", f"/auth/v1/admin/users/{UID}/factors") in seed_env[:first_write]
    assert [e[1] for e in seed_env if e[0] == "password"] == ["s-id", "u-id", "i-id", UID]
    assert ("gotrue", "POST", "/auth/v1/factors/kept/verify") in seed_env[first_write:]


def test_seed_reset_skips_the_factor_precheck(seed_env, tmp_path):
    secret_file = tmp_path / "creds" / "admin.env"
    staging_seed.seed("smoke", PASSWORD, secret_file, True)
    assert seed_env.index(("password", "s-id")) < seed_env.index(
        ("gotrue", "GET", f"/auth/v1/admin/users/{UID}/factors"))
    assert staging_seed._read_totp_secret(secret_file) == RFC_SECRET
