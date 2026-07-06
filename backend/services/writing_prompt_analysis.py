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
from typing import Optional

import httpx

from config import settings
from models.writing_feedback import PromptImageAnalysis
from services.gemini_writing_grader import get_grader
from services.writing_prompt_image import detect_format


logger = logging.getLogger(__name__)

_FETCH_TIMEOUT_S = 20.0

_SYSTEM_PROMPT = (
    "Bạn là examiner IELTS Writing Task 1 Academic. Nhiệm vụ: đọc HÌNH của đề "
    "(biểu đồ / bảng / bản đồ / sơ đồ quy trình) và trích xuất \"đáp án chuẩn\" — "
    "những dữ kiện KHÁCH QUAN mà một bài band 9 phải nêu.\n\n"
    "Trả về JSON đúng schema:\n"
    "- chart_type: một trong line|bar|pie|table|map|process|mixed.\n"
    "- overview: 1–2 câu tổng quan lớn nhất (xu hướng bao quát / khác biệt chính).\n"
    "- key_features: 3–6 điểm nổi bật BẮT BUỘC đề cập (xu hướng, so sánh, cực trị).\n"
    "- notable_data: các mốc số liệu quan trọng để kiểm tra độ chính xác "
    "({label, value, unit}). Với map/process có thể để trống.\n"
    "- axes_or_categories: mô tả trục / đơn vị / danh mục (nếu có).\n"
    "- grading_note: lưu ý cho người chấm (vd. map/process: 'dựa vào hình cho "
    "quan hệ không gian').\n\n"
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
