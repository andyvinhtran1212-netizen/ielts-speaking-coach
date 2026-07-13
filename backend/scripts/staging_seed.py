#!/usr/bin/env python3
"""Synthetic identity factory for STAGING (plan §7.2 / Phase 0 data factory).

Creates the minimum identity set the staging E2E suite needs, namespaced by
a run id so parallel runs never collide, and removable in one command:

    python3 scripts/staging_seed.py --ns smoke          # create/ensure
    python3 scripts/staging_seed.py --ns smoke --cleanup

Identities (all with password E2E_PASSWORD or the documented default):
  * student-activated   — role=user, used access code + ACTIVE assignment
  * user-unactivated    — role=user, no code assignment
  * instructor          — role=user (promote via grants_role code in E2E)
  * admin               — role=admin
Access codes: E2E-<NS>-UNUSED (active, unused), E2E-<NS>-USED (consumed by
the student, canonical assignment row), E2E-<NS>-REVOKED (is_active=false).

SAFETY: reads backend/.env.staging ONLY and refuses to run if the URL points
at the production project. Auth users are created with email_confirm=True so
password sign-in works immediately (enable the Email provider on staging).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PROD_REF = "huwsmtubwulikhlmcirx"
EMAIL_DOMAIN = "staging-e2e.averlearning.com"
DEFAULT_PASSWORD = "E2e-staging-Passw0rd!"


def _load_staging_env() -> dict:
    env = {}
    for line in (BACKEND / ".env.staging").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def _client():
    env = _load_staging_env()
    url = env.get("SUPABASE_URL", "")
    key = env.get("SUPABASE_SERVICE_KEY", "")
    if PROD_REF in url:
        sys.exit(f"REFUSED: .env.staging points at the production project ({PROD_REF})")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY missing in backend/.env.staging")
    from supabase import create_client
    return create_client(url, key)


def _email(role: str, ns: str) -> str:
    return f"e2e-{role}-{ns}@{EMAIL_DOMAIN}"


def _ensure_user(sb, role: str, ns: str, password: str) -> str:
    """Create (or find) an auth user + its public.users row. Returns user id."""
    email = _email(role, ns)
    existing = sb.table("users").select("id").eq("email", email).limit(1).execute()
    if existing.data:
        uid = existing.data[0]["id"]
        print(f"  = {email} (exists)")
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
    # users_role_check only allows 'user' | 'admin' (production truth).
    # Instructor is granted at runtime via a grants_role='instructor' access
    # code (routers/auth.py W-2) — the e2e-instructor identity starts as
    # 'user' and E2E promotes it through that flow when needed.
    db_role = "admin" if role == "admin" else "user"
    sb.table("users").upsert({"id": uid, "email": email, "role": db_role}).execute()
    print(f"  + {email} ({db_role})")
    return uid


def _ensure_code(sb, code: str, **fields) -> str:
    existing = sb.table("access_codes").select("id").eq("code", code).limit(1).execute()
    if existing.data:
        print(f"  = code {code} (exists)")
        return existing.data[0]["id"]
    row = {"code": code, "is_active": True, **fields}
    res = sb.table("access_codes").insert(row).execute()
    print(f"  + code {code}")
    return res.data[0]["id"]


def seed(ns: str, password: str) -> None:
    sb = _client()
    print(f"== seeding staging namespace '{ns}'")
    student = _ensure_user(sb, "student", ns, password)
    _ensure_user(sb, "unactivated", ns, password)
    _ensure_user(sb, "instructor", ns, password)
    _ensure_user(sb, "admin", ns, password)

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
    args = ap.parse_args()
    pw = os.environ.get("E2E_PASSWORD", DEFAULT_PASSWORD)
    if args.cleanup:
        cleanup(args.ns)
    else:
        seed(args.ns, pw)
