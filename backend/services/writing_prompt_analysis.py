"""services/writing_prompt_analysis.py — Task 1 chart → verified answer key.

One-time vision extraction of a Task 1 Academic prompt image into static facts
(`PromptImageAnalysis`) that an admin reviews and that later anchor Task
Achievement grading. See docs/WRITING_TASK1_ANALYSIS_SPEC.md.

Reuses the writing grader's Gemini call/parse machinery (`_call_with_retry` +
`_parse_response`) so the retry / JSON-repair behaviour matches grading exactly —
no second copy of that logic to keep in sync.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from config import settings
from models.writing_feedback import PromptImageAnalysis
from services.gemini_writing_grader import get_grader
from services.writing_prompt_image import detect_format


logger = logging.getLogger(__name__)

_FETCH_TIMEOUT_S = 20.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

_SYSTEM_PROMPT = (
    "Bạn là examiner IELTS Writing Task 1 Academic. Nhiệm vụ: đọc HÌNH của đề và "
    "trích xuất \"đáp án chuẩn\" — những dữ kiện KHÁCH QUAN mà một bài band 9 phải "
    "nêu. TRƯỚC HẾT hãy XÁC ĐỊNH loại hình (chart_type), rồi áp đúng bộ quy tắc "
    "bên dưới cho loại đó.\n\n"
    "== Nếu là BIỂU ĐỒ SỐ LIỆU (line/bar/pie/table) ==\n"
    "- overview: xu hướng bao quát / khác biệt lớn nhất (1–2 câu).\n"
    "- key_features: 3–6 xu hướng / so sánh / cực trị bắt buộc đề cập.\n"
    "- notable_data: các MỐC SỐ LIỆU quan trọng để đối chiếu độ chính xác "
    "({label, value, unit}).\n"
    "- axes_or_categories: trục / đơn vị / danh mục.\n\n"
    "== Nếu là BẢN ĐỒ (map, thường before/after hoặc 2 địa điểm) ==\n"
    "- overview: BIẾN ĐỔI TỔNG THỂ + mốc thời gian (vd. 'khu vực đô thị hoá / "
    "thương mại hoá giữa 1990 và 2010').\n"
    "- key_features: liệt kê TỪNG thay đổi RỜI RẠC, MỖI DÒNG 1 thay đổi, dạng "
    "'[đối tượng] được thêm/bỏ/dời/mở rộng/thu hẹp/chuyển thành/giữ nguyên — ở "
    "[vị trí: hướng bắc/nam/đông/tây, cạnh gì, thay cho gì]'. ĐỪNG gộp nhiều thay "
    "đổi vào một dòng. Cố gắng ĐẦY ĐỦ mọi thay đổi thấy được.\n"
    "- notable_data: để TRỐNG (bản đồ không có số).\n"
    "- axes_or_categories: để trống hoặc ghi khung thời gian.\n\n"
    "== Nếu là SƠ ĐỒ QUY TRÌNH (process) ==\n"
    "- overview: SỐ BƯỚC + quy trình TUYẾN TÍNH hay TUẦN HOÀN (cyclical) + điểm "
    "bắt đầu và kết thúc.\n"
    "- key_features: liệt kê MỌI bước THEO ĐÚNG THỨ TỰ, mỗi dòng bắt đầu bằng "
    "'Bước N:' và nêu input→output khi có. THỨ TỰ là bắt buộc.\n"
    "- notable_data: để TRỐNG.\n"
    "- axes_or_categories: để trống.\n\n"
    "== Chung ==\n"
    "- chart_type: một trong line|bar|pie|table|map|process|mixed.\n"
    "- grading_note: lưu ý ngắn cho người chấm nếu cần.\n"
    "CHỈ mô tả những gì THẤY trong hình. TUYỆT ĐỐI không bịa số liệu. Chỉ trả JSON."
)


async def analyze_prompt_image(
    *,
    image_url: str,
    prompt_text: Optional[str] = None,
    model: Optional[str] = None,
) -> tuple[PromptImageAnalysis, str]:
    """Download the prompt chart and extract its verified answer key.

    Returns ``(analysis, model_used)``. Raises on fetch / non-image / parse
    failure — the caller (the BG trigger) catches and records status='failed'
    so the admin UI can offer a re-analyze. This function does NOT touch the DB.
    """
    resolved_model = model or settings.WRITING_ANALYSIS_MODEL

    async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT_S) as client:
        resp = await client.get(image_url)
    if resp.status_code != 200 or not resp.content:
        raise RuntimeError(f"prompt image fetch failed: HTTP {resp.status_code}")

    fmt = detect_format(resp.content)
    if fmt is None:
        raise RuntimeError("prompt image is not a supported PNG/JPG/WebP payload")
    mime = "image/jpeg" if fmt == "jpg" else f"image/{fmt}"

    grader = get_grader()
    user_prompt = (
        f"## Đề bài (Prompt)\n{prompt_text or '(không có phần chữ)'}\n\n"
        "Trích xuất đáp án chuẩn từ HÌNH kèm theo."
    )
    text, _usage = await grader._call_with_retry(
        model_name=resolved_model,
        system_prompt=_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        image=(resp.content, mime),
        parse_schema=PromptImageAnalysis,
    )
    analysis = grader._parse_response(text, schema=PromptImageAnalysis)
    return analysis, resolved_model


# ── DB-aware orchestration (trigger + BG task) ────────────────────────


def image_needs_analysis(prompt: dict) -> bool:
    """True when a task1_academic prompt has an image whose public_id differs
    from the one the current analysis was derived from — i.e. the chart is new
    or was replaced, so the answer key is missing or stale."""
    if prompt.get("task_type") != "task1_academic" or not prompt.get("prompt_image_url"):
        return False
    return prompt.get("prompt_image_public_id") != prompt.get("prompt_image_analysis_public_id")


def mark_analysis_pending(prompt_id: str) -> None:
    """Flip the prompt into 'pending' (and un-review) so the UI shows work in
    flight the instant a create/PATCH/reanalyze is accepted, before the BG task
    runs. Un-reviewing here is intentional: a new image must be re-approved."""
    from database import supabase_admin
    supabase_admin.table("writing_prompts").update({
        "prompt_image_analysis_status":   "pending",
        "prompt_image_analysis_reviewed": False,
        "prompt_image_analysis_error":    None,
    }).eq("id", prompt_id).execute()


async def run_and_store_analysis(prompt_id: str) -> None:
    """BG task: (re)extract the answer key for one prompt and persist it.

    NEVER raises — a failure records status='failed' + the error so the admin UI
    can offer a re-analyze. Stamps `analysis_public_id` with the image it ran on
    so `image_needs_analysis` won't re-trigger until the chart changes again. The
    result lands `reviewed=False` — an admin must approve before it grades."""
    from database import supabase_admin
    try:
        rows = (
            supabase_admin.table("writing_prompts")
            .select("id, task_type, prompt_text, prompt_image_url, prompt_image_public_id")
            .eq("id", prompt_id).limit(1).execute()
        ).data
        if not rows:
            return
        p = rows[0]
        if p.get("task_type") != "task1_academic" or not p.get("prompt_image_url"):
            return

        analysis, model = await analyze_prompt_image(
            image_url=p["prompt_image_url"], prompt_text=p.get("prompt_text"),
        )
        supabase_admin.table("writing_prompts").update({
            "prompt_image_analysis":           analysis.model_dump(),
            "prompt_image_analysis_status":    "ready",
            "prompt_image_analysis_reviewed":  False,
            "prompt_image_analysis_model":     model,
            "prompt_image_analysis_public_id": p.get("prompt_image_public_id"),
            "prompt_image_analysis_error":     None,
            "prompt_image_analysis_at":        _now_iso(),
        }).eq("id", prompt_id).execute()
        logger.info("[prompt-analysis] ready prompt=%s model=%s", prompt_id, model)
    except Exception as exc:  # noqa: BLE001 — BG task, must not surface
        logger.warning("[prompt-analysis] failed prompt=%s: %s", prompt_id, exc)
        try:
            supabase_admin.table("writing_prompts").update({
                "prompt_image_analysis_status": "failed",
                "prompt_image_analysis_error":  str(exc)[:500],
                "prompt_image_analysis_at":     _now_iso(),
            }).eq("id", prompt_id).execute()
        except Exception:  # noqa: BLE001 — best effort
            pass
