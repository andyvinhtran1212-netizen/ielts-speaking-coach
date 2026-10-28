#!/usr/bin/env python3
"""Synthetic identity factory for STAGING (plan §7.2 / Phase 0 data factory).

Creates the minimum identity set the staging E2E suite needs, namespaced by
a run id so parallel runs never collide, and removable in one command:

    python3 scripts/staging_seed.py --ns smoke          # create/ensure
    python3 scripts/staging_seed.py --ns smoke --cleanup

Identities (password = the REQUIRED env var E2E_PASSWORD; reseeding an
existing namespace ROTATES every identity's password to the current value):
  * student-activated   — role=user, used access code + ACTIVE assignment
  * user-unactivated    — role=user, no code assignment
  * instructor          — role=user (E2E promotes it via a grants_role code
                          or the admin role change; see migration 323)
  * admin               — role=admin
Access codes: E2E-<NS>-UNUSED (active, unused), E2E-<NS>-USED (consumed by
the student, canonical assignment row), E2E-<NS>-REVOKED (is_active=false).

Admin TOTP (ADMINAAL2-0032 FR-016 / T009): the admin also holds one verified
TOTP factor, enrolled as that admin through GoTrue REST. The base32 secret is
written ONLY to the QA creds store file given by --admin-totp-file (mode 0600,
dotenv line STAGING_E2E_ADMIN_TOTP_SECRET=..., ready for
`gh secret set -f <file>`); it never reaches stdout, a log or an exception.
A reseed keeps a verified factor after proving the stored secret still
verifies; --reset-admin-totp deletes the admin's TOTP factors and enrolls a
new one (then update the CI secret). Needs SUPABASE_ANON_KEY in .env.staging.

SAFETY: reads backend/.env.staging ONLY and refuses to run if the URL points
at the production project. Auth users are created with email_confirm=True so
password sign-in works immediately (enable the Email provider on staging).
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import hmac
import json
import os
import struct
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PROD_REF = "huwsmtubwulikhlmcirx"
EMAIL_DOMAIN = "staging-e2e.averlearning.com"
ADMIN_TOTP_ENV = "STAGING_E2E_ADMIN_TOTP_SECRET"


def _load_staging_env() -> dict:
    env = {}
    for line in (BACKEND / ".env.staging").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def _staging_auth_env() -> tuple[str, str, str]:
    """(url, service key, anon key) from .env.staging; refuses production."""
    env = _load_staging_env()
    url = env.get("SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_KEY", "")
    if PROD_REF in url:
        sys.exit(f"REFUSED: .env.staging points at the production project ({PROD_REF})")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY missing in backend/.env.staging")
    return url, key, env.get("SUPABASE_ANON_KEY", "")


def _client():
    url, key, _ = _staging_auth_env()
    from supabase import create_client
    return create_client(url, key)


def _email(role: str, ns: str) -> str:
    return f"e2e-{role}-{ns}@{EMAIL_DOMAIN}"


def _ensure_user(sb, role: str, ns: str, password: str) -> str:
    """Create (or find) an auth user + its public.users row. Returns user id."""
    email = _email(role, ns)
    # sessions.py _require_active gates on users.is_active (default false) —
    # every identity that must reach app flows needs it set explicitly. The
    # "unactivated" identity keeps false on purpose (§7.2 needs that state).
    is_active = role != "unactivated"
    db_role = "admin" if role == "admin" else "user"
    # Deterministic display_name (pilot-4 review): profile-mutation E2E must
    # be able to restore the field EXACTLY, but PATCH /auth/profile strips
    # nulls (no clear-to-null semantics) — so a null seed value would be
    # unrestorable. The sentinel makes reseed convergent: tests restore to
    # this same value.
    display_name = f"E2E {role} {ns}"
    existing = sb.table("users").select("id").eq("email", email).limit(1).execute()
    if existing.data:
        uid = existing.data[0]["id"]
        sb.table("users").update({
            "role": db_role, "is_active": is_active, "display_name": display_name,
        }).eq("id", uid).execute()
        sb.auth.admin.update_user_by_id(uid, {"password": password})
        print(f"  = {email} (exists — role/is_active enforced, password rotated)")
        return uid
    try:
        created = sb.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"e2e_ns": ns},
        })
        uid = created.user.id
    except Exception as exc:
        if "already been registered" not in str(exc):
            raise
        # Orphan auth user from an interrupted earlier run — recover it.
        uid = None
        page = 1
        while uid is None:
            batch = sb.auth.admin.list_users(page=page, per_page=100)
            if not batch:
                sys.exit(f"auth user {email} exists but could not be found via list_users")
            for u in batch:
                if (u.email or "").lower() == email.lower():
                    uid = u.id
                    break
            page += 1
        print(f"  ~ {email} (recovered orphan auth user)")
    # Migration 323 leaves chk_users_role (user|student|instructor|admin) as
    # the only role CHECK. The e2e-instructor identity still starts as 'user'
    # so E2E exercises the real promotion paths: a grants_role='instructor'
    # access code (routers/auth.py W-2) or PATCH /admin/users/{id}/role.
    sb.table("users").upsert({
        "id": uid, "email": email, "role": db_role, "is_active": is_active,
        "display_name": display_name,
    }).execute()
    print(f"  + {email} ({db_role})")
    return uid


def _ensure_code(sb, code: str, **fields) -> str:
    existing = sb.table("access_codes").select("id").eq("code", code).limit(1).execute()
    if existing.data:
        print(f"  = code {code} (exists)")
        return existing.data[0]["id"]
    # permissions defaults to '["all"]' at the column level; set it explicitly
    # so the seeded state never depends on schema defaults (review 2026-07-13).
    row = {"code": code, "is_active": True, "permissions": ["all"], **fields}
    res = sb.table("access_codes").insert(row).execute()
    print(f"  + code {code}")
    return res.data[0]["id"]


# ── Admin TOTP factor (ADMINAAL2-0032 FR-016) ───────────────────────────
# Nothing below prints, logs or raises with the TOTP secret, a TOTP code, the
# password or a token. GoTrue failures are reduced to status + error code.


def _totp(secret_b32: str, now: float | None = None) -> str:
    """RFC 6238 (HMAC-SHA1, 30 s, 6 digits), as GoTrue verifies it."""
    clean = secret_b32.strip().upper().replace(" ", "")
    key = base64.b32decode(clean + "=" * (-len(clean) % 8))
    counter = int((time.time() if now is None else now) // 30)
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    return str((struct.unpack(">I", mac[offset:offset + 4])[0] & 0x7FFFFFFF) % 10**6).zfill(6)


class GoTrueError(RuntimeError):
    """A failed GoTrue call, summarised without request or response secrets."""


def _gotrue(method: str, url: str, *, apikey: str, bearer: str | None = None, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={
        "apikey": apikey,
        "Authorization": f"Bearer {bearer or apikey}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read() or b"{}")
        except ValueError:
            payload = {}
        code = payload.get("error_code") or payload.get("code") or payload.get("error") or ""
        path = urllib.parse.urlsplit(url).path
        raise GoTrueError(f"{method} {path} -> HTTP {exc.code} {code}".rstrip()) from None


def _read_totp_secret(path: Path) -> str:
    if not path.exists():
        return ""
    for line in path.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() == ADMIN_TOTP_ENV:
            return value.strip()
    return ""


def _write_totp_secret(path: Path, secret: str, note: str) -> None:
    """Atomically write the dotenv secret file with mode 0600."""
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(f"# {note}\n{ADMIN_TOTP_ENV}={secret}\n")
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def _ensure_admin_totp(
    auth_env: tuple[str, str, str], uid: str, ns: str, password: str,
    secret_file: Path, reset: bool,
) -> None:
    url, service, anon = auth_env
    email = _email("admin", ns)
    admin_factors = f"{url}/auth/v1/admin/users/{uid}/factors"

    def sign_in() -> str:
        session = _gotrue("POST", f"{url}/auth/v1/token?grant_type=password", apikey=anon,
                          body={"email": email, "password": password})
        return session["access_token"]

    def verify(token: str, factor_id: str, secret: str) -> None:
        factor = f"{url}/auth/v1/factors/{factor_id}"
        challenge = _gotrue("POST", f"{factor}/challenge", apikey=anon, bearer=token, body={})
        _gotrue("POST", f"{factor}/verify", apikey=anon, bearer=token,
                body={"challenge_id": challenge["id"], "code": _totp(secret)})

    totp = [f for f in (_gotrue("GET", admin_factors, apikey=service) or [])
            if f.get("factor_type") == "totp"]
    verified = [f for f in totp if f.get("status") == "verified"]
    if verified and not reset:
        stored = _read_totp_secret(secret_file)
        if not stored:
            sys.exit(f"admin {email} has a verified TOTP factor but {secret_file} holds no "
                     f"{ADMIN_TOTP_ENV}; rerun with --reset-admin-totp to enroll a new one.")
        try:
            verify(sign_in(), verified[0]["id"], stored)
        except (GoTrueError, ValueError, binascii.Error) as exc:
            sys.exit(f"stored {ADMIN_TOTP_ENV} does not verify for {email} ({exc}); "
                     "rerun with --reset-admin-totp.")
        print(f"  = {email} TOTP factor kept (verified with the stored secret)")
        return
    # Reset deletes every TOTP factor; otherwise only stale unverified ones, so
    # the friendly name and the 10-factor limit (research.md §9.3) never block.
    for f in (totp if reset else [f for f in totp if f.get("status") != "verified"]):
        _gotrue("DELETE", f"{admin_factors}/{f['id']}", apikey=service)
    token = sign_in()
    factor = _gotrue("POST", f"{url}/auth/v1/factors", apikey=anon, bearer=token,
                     body={"factor_type": "totp", "friendly_name": f"staging-e2e-{ns}"})
    # Persist before verifying: a verified factor whose secret was lost would
    # need a reset, while an unverified one is simply replaced on the next run.
    _write_totp_secret(
        secret_file, factor["totp"]["secret"],
        f"staging_seed.py --ns {ns}: TOTP factor {factor['id']} of {email}",
    )
    verify(token, factor["id"], _read_totp_secret(secret_file))
    print(f"  + {email} TOTP factor enrolled and verified; secret written to {secret_file}")


def seed(ns: str, password: str, totp_file: Path, reset_totp: bool) -> None:
    auth_env = _staging_auth_env()
    if not auth_env[2]:
        sys.exit("SUPABASE_ANON_KEY missing in backend/.env.staging (needed for the admin TOTP step)")
    sb = _client()
    print(f"== seeding staging namespace '{ns}'")
    student = _ensure_user(sb, "student", ns, password)
    _ensure_user(sb, "unactivated", ns, password)
    _ensure_user(sb, "instructor", ns, password)
    admin = _ensure_user(sb, "admin", ns, password)
    try:
        _ensure_admin_totp(auth_env, admin, ns, password, totp_file, reset_totp)
    except GoTrueError as exc:
        sys.exit(f"admin TOTP step failed: {exc}")

    prefix = f"E2E-{ns.upper()}"
    _ensure_code(sb, f"{prefix}-UNUSED")
    used_id = _ensure_code(sb, f"{prefix}-USED", is_used=True, used_by=student)
    _ensure_code(sb, f"{prefix}-REVOKED", is_active=False)

    assignment = (
        sb.table("user_code_assignments").select("id")
        .eq("user_id", student).eq("code_id", used_id).limit(1).execute()
    )
    if not assignment.data:
        sb.table("user_code_assignments").insert({
            "user_id": student, "code_id": used_id, "is_active": True,
        }).execute()
        print("  + assignment student ↔ USED code (active)")
    print("== done. Password sign-in requires the Email provider enabled on staging.")
    print(f"   student login: {_email('student', ns)}")


def cleanup(ns: str) -> None:
    sb = _client()
    print(f"== cleaning staging namespace '{ns}'")
    emails = [_email(r, ns) for r in ("student", "unactivated", "instructor", "admin")]
    users = sb.table("users").select("id, email").in_("email", emails).execute().data or []
    ids = [u["id"] for u in users]
    if ids:
        sb.table("user_code_assignments").delete().in_("user_id", ids).execute()
    codes = sb.table("access_codes").select("id").like("code", f"E2E-{ns.upper()}-%").execute().data or []
    for c in codes:
        sb.table("user_code_assignments").delete().eq("code_id", c["id"]).execute()
        sb.table("access_codes").delete().eq("id", c["id"]).execute()
    for u in users:
        sb.table("users").delete().eq("id", u["id"]).execute()
        try:
            sb.auth.admin.delete_user(u["id"])
        except Exception as exc:  # auth user may already be gone
            print(f"  ! auth delete {u['email']}: {exc}")
        print(f"  - {u['email']}")
    print(f"  - {len(codes)} codes removed")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ns", default="smoke", help="run namespace (default: smoke)")
    ap.add_argument("--cleanup", action="store_true")
    ap.add_argument("--admin-totp-file", type=Path,
                    help="QA creds store file that receives the admin TOTP secret "
                         "(required when seeding; written 0600, never printed)")
    ap.add_argument("--reset-admin-totp", action="store_true",
                    help="delete the admin's TOTP factors and enroll a new one")
    args = ap.parse_args()
    pw = os.environ.get("E2E_PASSWORD", "")
    if not args.cleanup and not pw:
        sys.exit("E2E_PASSWORD is required (no committed default — review P1, "
                 "2026-07-13): export E2E_PASSWORD=... and store the same value "
                 "as the GitHub secret E2E_PASSWORD.")
    if not args.cleanup and not args.admin_totp_file:
        sys.exit("--admin-totp-file is required (ADMINAAL2-0032 FR-016): the admin "
                 "TOTP secret goes only to the QA creds store, never to stdout.")
    if args.cleanup:
        cleanup(args.ns)
    else:
        seed(args.ns, pw, args.admin_totp_file, args.reset_admin_totp)
