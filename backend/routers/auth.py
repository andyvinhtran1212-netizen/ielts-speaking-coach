from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
import httpx

from config import settings
from database import supabase_admin

router = APIRouter(prefix="/auth", tags=["auth"])


class ActivateRequest(BaseModel):
    access_code: str


# ── Shared helper ─────────────────────────────────────────────────────────────

async def get_supabase_user(authorization: str | None):
    """Verify Bearer token with Supabase and return the user dict."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header",
        )

    token = authorization.replace("Bearer ", "").strip()

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
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

    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user.get("display_name"),
        "avatar_url": user.get("avatar_url"),
        "role": user.get("role", "user"),
        "is_active": user.get("is_active", False),
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

    if not code_result.data:
        raise HTTPException(status_code=400, detail="Access code không hợp lệ")

    access_code_row = code_result.data[0]

    if access_code_row.get("is_used"):
        raise HTTPException(status_code=400, detail="Access code này đã được sử dụng rồi")

    # ── Step 2: upsert user row (in case /me was never called) ───────────────
    try:
        existing = (
            supabase_admin.table("users")
            .select("id")
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
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi tạo người dùng: {e}",
        )

    # ── Step 3: activate the user ─────────────────────────────────────────────
    # NOTE: only update columns that definitely exist in your `users` table.
    # If you haven't added `access_code_used` yet, remove that line below
    # and run: ALTER TABLE users ADD COLUMN access_code_used text;
    try:
        supabase_admin.table("users").update({
            "is_active": True,
            "access_code_used": code,   # remove if column doesn't exist yet
        }).eq("id", user_id).execute()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi kích hoạt tài khoản: {e}",
        )

    # ── Step 4: mark access code as used ─────────────────────────────────────
    # Use a real ISO timestamp string instead of the string "now()" which
    # PostgREST does NOT evaluate as a SQL function — it's just a literal string.
    now_iso = datetime.now(timezone.utc).isoformat()

    try:
        supabase_admin.table("access_codes").update({
            "is_used": True,
            "used_by": user_id,
            "used_at": now_iso,
        }).eq("id", access_code_row["id"]).execute()
    except Exception as e:
        # Non-fatal: user is already activated. Log and continue.
        print(f"[warn] Could not mark access_code as used: {e}")

    return {
        "success": True,
        "message": "Tài khoản đã được kích hoạt!",
    }
