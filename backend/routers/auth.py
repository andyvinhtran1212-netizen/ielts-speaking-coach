import logging
from datetime import datetime, timezone
from time import perf_counter

from fastapi import APIRouter, HTTPException, Header

logger = logging.getLogger(__name__)
from pydantic import BaseModel
import httpx

from config import settings
from database import supabase_admin
from services.server_timing import record_stage
from services.feature_flags import is_flashcard_enabled

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Perf (B) — shared keep-alive httpx client for token verification ──────────
# get_supabase_user() runs on EVERY authenticated request. It used to open a
# fresh `httpx.AsyncClient` per call, so every verify paid a full TLS handshake
# to Supabase Auth. Backend (Railway, Singapore) ↔ Supabase (ap-south-1, Mumbai)
# is ~56ms RTT, so a fresh handshake costs ~2-3 RTT (~110-170ms) on top of the
# request — on the hottest path in the app. A module-level client reuses ONE
# keep-alive connection pool, collapsing that to ~1 RTT after the first call.
# Built lazily (must live on the running loop) and closed on app shutdown.
_auth_http_client: httpx.AsyncClient | None = None


def _get_auth_http_client() -> httpx.AsyncClient:
    global _auth_http_client
    if _auth_http_client is None or _auth_http_client.is_closed:
        _auth_http_client = httpx.AsyncClient(
            timeout=20.0,
            limits=httpx.Limits(max_keepalive_connections=20, keepalive_expiry=60.0),
        )
    return _auth_http_client


async def close_auth_http_client() -> None:
    """Close the shared client on app shutdown (idempotent)."""
    global _auth_http_client
    if _auth_http_client is not None and not _auth_http_client.is_closed:
        await _auth_http_client.aclose()
    _auth_http_client = None


class ActivateRequest(BaseModel):
    access_code: str


class ProfileUpdate(BaseModel):
    target_band: float | None = None
    exam_date: str | None = None          # ISO date string "YYYY-MM-DD"
    self_level: str | None = None
    preferred_topics: list[str] | None = None
    onboarding_completed: bool | None = None
    display_name: str | None = None
    timezone: str | None = None
    weekly_goal: int | None = None        # 1–14 sessions/week
    notification_email: bool | None = None


# ── W-2 instructor-promote helpers (Option B, email-bound) ────────────────────

def _norm_email(value: str | None) -> str | None:
    """Normalise an email for comparison: trim + Unicode casefold. None/empty → None."""
    return ((value or "").strip().casefold()) or None


def _audit_promote_attempt(
    user_id: str, code_id: str | None, *,
    ok: bool, before_role: str | None = None, intended_email: str | None = None,
) -> None:
    """Append one row to access_code_audit for a role-promote attempt. BEST-EFFORT:
    never raises (a logging failure must not break/block activation). Records
    both successful promotes (action='promote_role') and rejected ones
    (action='promote_role_rejected') so an email-mismatch attempt is visible."""
    try:
        supabase_admin.table("access_code_audit").insert({
            "actor_user_id":  user_id,          # self-service via code (verified token)
            "action":         "promote_role" if ok else "promote_role_rejected",
            "code_id":        code_id,
            "target_user_id": user_id,
            "before":         {"role": before_role} if ok else None,
            "after":          ({"role": "instructor"} if ok
                               else {"reason": "email_mismatch", "intended_email": intended_email}),
        }).execute()
    except Exception as e:
        logger.warning("[warn] promote_role audit failed: %s", e)


def _audit_enroll_reject(user_id: str, code_id: str | None, *,
                         current_owner, attempted_owner) -> None:
    """W-5 — best-effort audit of a BLOCKED enroll-reassign (a different
    instructor's enroll-code tried to take an already-owned student). Never raises."""
    try:
        supabase_admin.table("access_code_audit").insert({
            "actor_user_id":  user_id,
            "action":         "enroll_reassign_rejected",
            "code_id":        code_id,
            "target_user_id": user_id,
            "before":         {"instructor_id": str(current_owner) if current_owner else None},
            "after":          {"attempted_owner": str(attempted_owner) if attempted_owner else None},
        }).execute()
    except Exception as e:
        logger.warning("[warn] enroll_reassign audit failed: %s", e)


# ── Shared helper ─────────────────────────────────────────────────────────────

async def get_supabase_user(authorization: str | None):
    """Verify Bearer token with Supabase and return the user dict."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.replace("Bearer ", "").strip()

    # A valid Supabase JWT is always ASCII. Reject a non-ASCII token (a garbled
    # / placeholder header, e.g. a Vietnamese "DÁN_TOKEN_VÀO_ĐÂY" pasted into the
    # curl) with a clean 401 — otherwise httpx ascii-encodes the downstream
    # `Authorization` header below and raises UnicodeEncodeError → an opaque 500.
    if not token or not token.isascii():
        raise HTTPException(
            status_code=401,
            detail="Invalid Authorization header",
        )

    auth_start = perf_counter()
    try:
        client = _get_auth_http_client()
        response = await client.get(
            f"{settings.SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": settings.SUPABASE_ANON_KEY,
            },
        )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Không thể kết nối Supabase để xác thực: {e}",
        )
    finally:
        record_stage("auth", (perf_counter() - auth_start) * 1000)

    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Token không hợp lệ hoặc đã hết hạn")

    return response.json()


# ── GET /auth/me ──────────────────────────────────────────────────────────────

@router.get("/me")
async def get_me(authorization: str | None = Header(default=None)):
    auth_user = await get_supabase_user(authorization)

    user_id = auth_user["id"]
    email = auth_user.get("email")
    metadata = auth_user.get("user_metadata", {}) or {}

    try:
        existing = (
            supabase_admin.table("users")
            .select("*")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi truy vấn người dùng: {e}")

    if not existing.data:
        try:
            supabase_admin.table("users").insert({
                "id": user_id,
                "email": email,
                "display_name": metadata.get("full_name") or metadata.get("name"),
                "avatar_url": metadata.get("avatar_url"),
                "role": "user",
                "is_active": False,
            }).execute()

            existing = (
                supabase_admin.table("users")
                .select("*")
                .eq("id", user_id)
                .limit(1)
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Lỗi khi tạo người dùng: {e}")

    user = existing.data[0]

    try:
        supabase_admin.table("users").update(
            {"last_seen_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", user_id).execute()
    except Exception:
        pass  # non-fatal

    flags = user.get("feature_flags") or {}
    # PR1 single-source: /auth/me returns the LIVE access-code permissions (same
    # source as /api/student/permissions), NOT the users.permissions snapshot —
    # so the two agree and a revoke is reflected immediately. No snapshot
    # fallback: an empty live list means no access (don't re-grant a default).
    from services.access_code_permissions import (  # local — avoid import cycle
        get_user_access_code_permissions_cached,
    )
    live_permissions = get_user_access_code_permissions_cached(user_id)
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user.get("display_name"),
        "avatar_url": user.get("avatar_url"),
        "role": user.get("role", "user"),
        "is_active": user.get("is_active", False),
        "permissions": live_permissions,
        "onboarding_completed": user.get("onboarding_completed", False),
        "target_band": user.get("target_band"),
        "exam_date": str(user["exam_date"]) if user.get("exam_date") else None,
        "self_level": user.get("self_level"),
        "preferred_topics": user.get("preferred_topics") or [],
        "vocab_bank_enabled": flags.get("vocab_enabled") is True,
        "d1_enabled": settings.D1_ENABLED and flags.get("d1_enabled") is True,
        "d3_enabled": settings.D3_ENABLED and flags.get("d3_enabled") is True,
        # Phase D Wave 2 — strict default-deny via the canonical helper so
        # frontends can rely on `=== true` without re-implementing the rule.
        "flashcard_enabled": is_flashcard_enabled(user_id, settings.FLASHCARD_ENABLED),
    }


# ── GET /auth/check-active ────────────────────────────────────────────────────

@router.get("/check-active")
async def check_active(authorization: str | None = Header(default=None)):
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        result = (
            supabase_admin.table("users")
            .select("is_active")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi kiểm tra trạng thái: {e}")

    if not result.data:
        return {"is_active": False}

    return {"is_active": bool(result.data[0].get("is_active", False))}


# ── GET /auth/profile ─────────────────────────────────────────────────────────

@router.get("/profile")
async def get_profile(authorization: str | None = Header(default=None)):
    """Return the full user profile including extended fields from migration 013."""
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        result = (
            supabase_admin.table("users")
            .select("*")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải profile: {e}")

    if not result.data:
        raise HTTPException(status_code=404, detail="Người dùng không tồn tại")

    user = result.data[0]

    # Aggregate session stats for the profile page
    stats = {"total_sessions": 0, "avg_band": None, "joined_at": None}
    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("overall_band, started_at")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .execute()
        )
        sessions = s_res.data or []
        stats["total_sessions"] = len(sessions)
        bands = [s["overall_band"] for s in sessions if s.get("overall_band") is not None]
        if bands:
            # C2 (audit 2026-07-03): half-up via the canonical ielts_round, not
            # banker's round(x*2)/2, so the profile average matches the web.
            from services.band_rounding import ielts_round  # local — avoid cycle
            stats["avg_band"] = ielts_round(sum(bands) / len(bands))
    except Exception:
        pass  # non-fatal — stats are display-only

    joined = user.get("joined_at") or user.get("created_at")

    return {
        "id": user["id"],
        "email": user.get("email"),
        "display_name": user.get("display_name"),
        "avatar_url": user.get("avatar_url"),
        "role": user.get("role", "user"),
        "is_active": user.get("is_active", False),
        "onboarding_completed": user.get("onboarding_completed", False),
        "target_band": user.get("target_band"),
        "exam_date": str(user["exam_date"]) if user.get("exam_date") else None,
        "self_level": user.get("self_level"),
        "preferred_topics": user.get("preferred_topics") or [],
        "timezone": user.get("timezone") or "Asia/Ho_Chi_Minh",
        "weekly_goal": user.get("weekly_goal") or 5,
        "notification_email": user.get("notification_email", True),
        "joined_at": str(joined) if joined else None,
        "stats": stats,
    }


# ── POST /auth/activate ───────────────────────────────────────────────────────

@router.post("/activate")
async def activate_account(
    payload: ActivateRequest,
    authorization: str | None = Header(default=None),
):
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]
    email = auth_user.get("email")
    metadata = auth_user.get("user_metadata", {}) or {}
    code = payload.access_code.strip().upper()

    # ── Step 1: look up the access code ──────────────────────────────────────
    try:
        code_result = (
            supabase_admin.table("access_codes")
            .select("*")
            .eq("code", code)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi kiểm tra access code trong database: {e}",
        )

    # Audit 2026-07-03 S5 — anti-enumeration. Distinct messages for
    # not-found / used / revoked / expired let a caller distinguish a code that
    # EXISTS-but-is-unusable from one that never existed (36^8 keyspace probe).
    # Collapse all of those to ONE generic message so existence isn't revealed.
    # The one exception is the caller's OWN already-activated code: telling them
    # "you already activated this" leaks nothing (they clearly possess the code)
    # and is the common, legitimate confusion — so keep that message specific.
    _GENERIC = "Access code không hợp lệ hoặc không thể sử dụng. Kiểm tra lại mã hoặc liên hệ admin."

    if not code_result.data:
        raise HTTPException(status_code=400, detail=_GENERIC)

    access_code_row = code_result.data[0]

    if access_code_row.get("is_used") and access_code_row.get("used_by") == user_id:
        raise HTTPException(status_code=400, detail="Bạn đã kích hoạt mã này rồi.")

    if access_code_row.get("is_used"):
        raise HTTPException(status_code=400, detail=_GENERIC)

    if access_code_row.get("is_revoked"):
        raise HTTPException(status_code=400, detail=_GENERIC)

    # Sprint 5.2.1 RED hotfix — refuse activation of a code past its
    # expiry. Activating an expired code would create a "ghost" link in
    # user_code_assignments that the live permission lookup correctly
    # ignores (post-Sprint 5.2.1) but that admins can't easily explain.
    # (Message collapsed into the generic anti-enumeration string above.)
    from services.access_code_permissions import _is_expired  # local — avoid cycle
    if _is_expired(access_code_row.get("expires_at"), datetime.now(timezone.utc)):
        raise HTTPException(status_code=400, detail=_GENERIC)

    # ── Step 1b (W-2): instructor-promote gate (Option B, email-bound) ───────
    # Evaluate BEFORE activating/consuming so a mismatch fails CLOSED (HARD-403)
    # WITHOUT marking the code used — the code stays valid for the intended GV.
    # Email check applies ONLY to grants_role='instructor' codes; ordinary codes
    # (grants_role NULL) are untouched (students activate normally). The email is
    # the VERIFIED token email (auth_user), never request body.
    promote_role: str | None = None
    if (access_code_row.get("grants_role") or "").strip().lower() == "instructor":
        intended = _norm_email(access_code_row.get("intended_email"))
        if not intended or intended != _norm_email(email):
            _audit_promote_attempt(
                user_id, access_code_row.get("id"),
                ok=False, intended_email=access_code_row.get("intended_email"),
            )
            raise HTTPException(
                status_code=403,
                detail="Email không khớp với instructor-code này. Mã CHƯA được sử "
                       "dụng — đăng nhập bằng đúng email được cấp, hoặc liên hệ admin.",
            )
        promote_role = "instructor"

    # ── Step 2: upsert user row (in case /me was never called) ───────────────
    # Select `role` too so the promote below is upgrade-only / idempotent.
    current_role = "user"
    was_already_active = False  # B1/Mục 2: needed to roll back ONLY a fresh activation if we lose a race
    try:
        existing = (
            supabase_admin.table("users")
            .select("id, role, is_active")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            supabase_admin.table("users").insert({
                "id": user_id,
                "email": email,
                "display_name": metadata.get("full_name") or metadata.get("name"),
                "avatar_url": metadata.get("avatar_url"),
                "role": "user",
                "is_active": False,
            }).execute()
        else:
            current_role = existing.data[0].get("role") or "user"
            was_already_active = bool(existing.data[0].get("is_active"))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi tạo người dùng: {e}",
        )

    # ── Step 3: activate the user ─────────────────────────────────────────────
    # Copy permissions from access_code so they survive code revocation later.
    code_permissions = access_code_row.get("permissions") or ["practice_single", "practice_part", "practice_full"]
    update_fields = {
        "is_active": True,
        "access_code_used": code,
        "permissions": code_permissions,
    }
    # W-2 — fold the role promote into the SAME update (ATOMIC with activation,
    # no bolt-tail). Upgrade-only: never downgrade admin; no-op if already
    # ≥ instructor. Only set when the email-bound gate above passed.
    will_promote = promote_role == "instructor" and current_role not in ("admin", "instructor")
    if will_promote:
        update_fields["role"] = "instructor"
    try:
        supabase_admin.table("users").update(update_fields).eq("id", user_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi kích hoạt tài khoản: {e}",
        )

    # Audit the successful promote (best-effort; the role write already committed).
    if will_promote:
        _audit_promote_attempt(
            user_id, access_code_row.get("id"),
            ok=True, before_role=current_role,
        )

    # ── Step 3b (W-5): enroll-chain — stamp students.instructor_id ATOMICALLY,
    # BEFORE the code is consumed (seam-defect #4: no bolt-tail). Any failure here
    # RAISES → Step 4 (mark is_used) never runs → the code stays valid → retry-able.
    #
    # Owner = the CODE'S issuer IF that issuer is an instructor; admin/mass codes
    # (or no issuer) → NULL (never stamp an admin → keeps roster/metrics clean).
    # owner is read server-side from access_codes.issued_by, NEVER the request body.
    issued_by = access_code_row.get("issued_by")
    owner: str | None = None
    if issued_by:
        try:
            ir = (supabase_admin.table("users").select("role")
                  .eq("id", issued_by).limit(1).execute().data or [None])[0]
        except Exception as e:
            raise HTTPException(500, f"Lỗi khi kiểm tra người phát mã: {e}")
        if ir and ir.get("role") == "instructor":
            owner = str(issued_by)

    code_cohort_id = access_code_row.get("cohort_id")
    try:
        by_user = (supabase_admin.table("students").select("id, user_id, instructor_id, cohort_id")
                   .eq("user_id", user_id).limit(1).execute().data or [])
        by_code = (supabase_admin.table("students").select("id, user_id, instructor_id, cohort_id")
                   .eq("student_code", code).limit(1).execute().data or [])
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tra cứu hồ sơ học viên: {e}")

    target = None
    if by_user:
        target = by_user[0]                              # this user already has a profile
    elif by_code and not by_code[0].get("user_id"):
        target = by_code[0]                              # admin-precreated unlinked bridge
    elif by_code and str(by_code[0].get("user_id")) == str(user_id):
        target = by_code[0]                              # already linked to me (idempotent)

    # 2nd-code cross-instructor block: an already-owned student can NOT be moved to
    # a different instructor by another GV's enroll-code → REJECT 403, leave is_used
    # FALSE (don't burn the code), audit. Same owner = idempotent; owner NULL on the
    # new code (admin/mass) = no ownership change → proceed.
    if target:
        cur_owner = target.get("instructor_id")
        if cur_owner and owner and str(cur_owner) != owner:
            _audit_enroll_reject(user_id, access_code_row.get("id"),
                                 current_owner=cur_owner, attempted_owner=owner)
            raise HTTPException(
                status_code=403,
                detail="Học viên này đã thuộc một giảng viên khác. Mã CHƯA được sử "
                       "dụng — liên hệ admin để chuyển giảng viên/lớp.",
            )

    # B1 (PR #589 review, comment 2): Step 3b runs BEFORE the code is claimed
    # (Step 4), so a request that later LOSES the claim race may already have
    # linked or created a students row for itself. Record what we write here so
    # the lost-race path can undo it. This keeps W-5 intact (the claim still runs
    # LAST, so an enroll-write failure still does NOT consume the code).
    enroll_inserted_id: str | None = None
    enroll_revert: tuple | None = None  # (student_id, {field: prior_value_to_restore})
    try:
        if target:
            upd: dict = {}
            revert: dict = {}
            if not target.get("user_id"):
                upd["user_id"] = user_id
                revert["user_id"] = None
            if code_cohort_id:
                upd["cohort_id"] = code_cohort_id            # cohort fold (same atomic write)
                revert["cohort_id"] = target.get("cohort_id")
            if owner and not target.get("instructor_id"):
                upd["instructor_id"] = owner                  # stamp ONLY when currently NULL
                revert["instructor_id"] = None
            if upd:
                supabase_admin.table("students").update(upd).eq("id", target["id"]).execute()
                enroll_revert = (target["id"], revert)
        elif by_code:
            # student_code==code exists but is linked to ANOTHER user (code/account
            # mismatch — NOT an ownership conflict). Existing behaviour: log + skip
            # the enroll (don't relink, don't 403). Activation still proceeds.
            logger.warning(
                "[auth] student_code=%s linked to user=%s; refusing relink to %s",
                code, by_code[0].get("user_id"), user_id,
            )
        elif owner or code_cohort_id:
            # ENROLL SIGNAL only (instructor code OR cohort/class code) AND no row
            # exists → create the profile. A plain mass/speaking code (no owner, no
            # cohort) creates NOTHING — don't pollute the writing roster with
            # student rows for speaking-only users.
            full_name = (metadata.get("full_name") or metadata.get("name")
                         or (email.split("@")[0] if email else None) or "Học viên")
            _ins = supabase_admin.table("students").insert({
                "user_id":       user_id,
                "student_code":  code,
                "full_name":     full_name,
                "created_by":    issued_by,        # provenance: who issued the code
                "instructor_id": owner,            # GV if issuer is instructor, else NULL
                "cohort_id":     code_cohort_id,
            }).execute()
            if _ins.data:
                enroll_inserted_id = (_ins.data[0] or {}).get("id")
        # else: no row + no enroll signal (plain mass code) → no-op (no pollution).
    except HTTPException:
        raise
    except Exception as e:
        # FATAL, BEFORE consume — fail closed so the code stays retry-able.
        raise HTTPException(500, f"Lỗi khi ghi danh học viên: {e}")

    # ── Step 4: atomically CLAIM the access code (B1 / review Mục 2) ─────────
    # P0 fix for double-redemption. The is_used check in Step 1 and this write
    # used to be a TOCTOU pair: two concurrent activations of the SAME code both
    # read is_used=false, both activated a (different) user → one code redeemed
    # twice. The `.eq("is_used", False)` guard turns this into an atomic
    # compare-and-swap — under the row lock only the FIRST writer matches, the
    # loser's conditional UPDATE affects 0 rows. No migration needed: the
    # row-level WHERE clause IS the lock. PostgREST does not evaluate "now()", so
    # use a real ISO timestamp.
    now_iso = datetime.now(timezone.utc).isoformat()

    claimed = False
    indeterminate = False
    try:
        claim = (
            supabase_admin.table("access_codes")
            .update({"is_used": True, "used_by": user_id, "used_at": now_iso})
            .eq("id", access_code_row["id"])
            .eq("is_used", False)
            .execute()
        )
        if claim.data:
            claimed = True  # our conditional UPDATE matched the row → we won
        else:
            # 0 rows: either we LOST the race or it's our own idempotent re-claim.
            # Re-read to disambiguate (also robust to clients that don't return the
            # updated representation — then claim.data is empty even on a win).
            fresh = (
                supabase_admin.table("access_codes")
                .select("is_used, used_by")
                .eq("id", access_code_row["id"])
                .limit(1)
                .execute()
            )
            frow = (fresh.data or [{}])[0]
            # Not actually used (no real contention) OR used BY US → we hold it.
            if (not frow.get("is_used")) or str(frow.get("used_by")) == str(user_id):
                claimed = True
            # else: another user owns it → claimed stays False (lost the race).
    except Exception as e:
        # PR #589 review, comment 1: an exception here makes the claim/readback
        # INDETERMINATE — we cannot confirm we own the code. FAIL CLOSED (claimed
        # stays False) rather than fall through to Step 5, which would risk a
        # second active redemption in a transient DB/PostgREST failure window.
        indeterminate = True
        logger.error("[auth] access-code claim indeterminate — failing closed: %s", e)

    if not claimed:
        # Lost the race (or indeterminate claim). Undo EVERY side effect this
        # request made BEFORE the claim so the loser is neither active nor
        # enrolled on a code another user owns (PR #589 review, comments 1 & 2).
        if not was_already_active:
            try:
                supabase_admin.table("users").update(
                    {"is_active": False}
                ).eq("id", user_id).execute()
            except Exception as e:
                logger.error(
                    "[auth] race rollback of is_active FAILED for user=%s (critical): %s",
                    user_id, e,
                )
        if enroll_inserted_id:
            try:
                supabase_admin.table("students").delete().eq("id", enroll_inserted_id).execute()
            except Exception as e:
                logger.error(
                    "[auth] race rollback of inserted student FAILED id=%s (critical): %s",
                    enroll_inserted_id, e,
                )
        elif enroll_revert:
            _sid, _fields = enroll_revert
            try:
                supabase_admin.table("students").update(_fields).eq("id", _sid).execute()
            except Exception as e:
                logger.error(
                    "[auth] race rollback of student link FAILED id=%s (critical): %s",
                    _sid, e,
                )
        if indeterminate:
            # Transient DB/PostgREST failure — we don't actually know the code is
            # used. Ask the user to retry rather than wrongly claiming it's spent.
            raise HTTPException(
                status_code=503,
                detail="Lỗi tạm thời khi kích hoạt mã. Vui lòng thử lại.",
            )
        raise HTTPException(status_code=400, detail="Access code này đã được sử dụng rồi")

    # ── Step 5: upsert assignment row so admin panel can show the redeemer ───
    try:
        supabase_admin.table("user_code_assignments").upsert({
            "user_id":     user_id,
            "code_id":     access_code_row["id"],
            "assigned_at": now_iso,
            "is_active":   True,
        }, on_conflict="user_id,code_id").execute()
    except Exception as e:
        logger.warning("[warn] Could not create user_code_assignment: %s", e)

    # (Phase-2.1 student-link + WF-1 cohort enroll moved to Step 3b above and
    # folded into the atomic, pre-consume enroll write — see W-5.)

    return {
        "success": True,
        "message": "Tài khoản đã được kích hoạt!",
    }


# ── PATCH /auth/profile ───────────────────────────────────────────────────────

@router.patch("/profile")
async def update_profile(
    payload: ProfileUpdate,
    authorization: str | None = Header(default=None),
):
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    updates: dict = {}
    if payload.target_band is not None:
        updates["target_band"] = payload.target_band
    if payload.exam_date is not None:
        updates["exam_date"] = payload.exam_date
    if payload.self_level is not None:
        valid_levels = {"beginner", "intermediate", "upper_intermediate", "advanced"}
        if payload.self_level not in valid_levels:
            raise HTTPException(
                status_code=400,
                detail=f"self_level không hợp lệ. Phải là: {', '.join(valid_levels)}",
            )
        updates["self_level"] = payload.self_level
    if payload.preferred_topics is not None:
        updates["preferred_topics"] = payload.preferred_topics
    if payload.onboarding_completed is not None:
        updates["onboarding_completed"] = payload.onboarding_completed
    if payload.display_name is not None:
        updates["display_name"] = payload.display_name.strip()[:100]
    if payload.timezone is not None:
        updates["timezone"] = payload.timezone
    if payload.weekly_goal is not None:
        updates["weekly_goal"] = max(1, min(14, payload.weekly_goal))
    if payload.notification_email is not None:
        updates["notification_email"] = payload.notification_email

    if not updates:
        raise HTTPException(status_code=400, detail="Không có trường nào để cập nhật.")

    try:
        result = (
            supabase_admin.table("users")
            .update(updates)
            .eq("id", user_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi cập nhật profile: {e}")

    if not result.data:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng.")

    user = result.data[0]
    return {
        "id": user["id"],
        "email": user.get("email"),
        "display_name": user.get("display_name"),
        "avatar_url": user.get("avatar_url"),
        "role": user.get("role", "user"),
        "is_active": user.get("is_active", False),
        "onboarding_completed": user.get("onboarding_completed", False),
        "target_band": user.get("target_band"),
        "exam_date": str(user["exam_date"]) if user.get("exam_date") else None,
        "self_level": user.get("self_level"),
        "preferred_topics": user.get("preferred_topics") or [],
        "timezone": user.get("timezone") or "Asia/Ho_Chi_Minh",
        "weekly_goal": user.get("weekly_goal") or 5,
        "notification_email": user.get("notification_email", True),
    }
