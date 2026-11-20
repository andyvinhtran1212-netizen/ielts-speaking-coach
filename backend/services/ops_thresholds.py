"""Operations thresholds (ADMINIA-0074 FR-081, FR-084; plan 5.6; G09-T22).

One table of thresholds that every admin and teacher surface reads: queues,
"Việc cần làm", the learner directory, classes, exams, codes. The values live
under the ``ops_thresholds`` key of ``admin_settings`` (migration 440) and the
owner edits them on ``/admin/settings?tab=thresholds``. Plan section 8 allows
the numbers in exactly two places: the defaults below and the seed in
migration 440. No other module may hard-code a threshold; read it with
:func:`get`.

* :func:`get` returns ``{key: value}`` for every editable key, the stored value
  winning over the default, cached for ``_TTL_SECONDS`` per process. A failed
  read with a previous good copy returns that copy (logged); with none it
  raises :class:`ThresholdsUnavailable`, so a caller never mistakes a guess for
  the owner's setting.
* :func:`set_many` validates every change before writing, then merges them
  through ``fn_admin_settings_merge``, which writes the value and its
  ``admin_settings_log`` row in one transaction.
* ``fixed`` rows are read-only: they come from G04 configuration, are never
  stored here, and a change to one is refused.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Iterable, Optional

from config import settings
from database import supabase_admin

logger = logging.getLogger(__name__)

SETTINGS_KEY = "ops_thresholds"
_TTL_SECONDS = 60.0


@dataclass(frozen=True)
class Threshold:
    key: str
    group: str
    label: str
    anchor: str
    unit: str
    default: Optional[int]
    min: Optional[int]
    max: Optional[int]
    nullable: bool = False
    # Read-only rows: the value comes from this Settings attribute (G04).
    fixed_from: Optional[str] = None

    @property
    def fixed(self) -> bool:
        return self.fixed_from is not None


_OVERDUE = "Quá hạn xử lý"
_ATTENTION = "Cần chú ý (học viên)"
_RESULTS = "Kết quả bài giao"
_EXPIRING = "Sắp hết hạn"
_EXAMS = "Kỳ thi"
_SURVEY = "Khảo sát"
_RETENTION = "Lưu dữ liệu"

# Plan 5.6, in the order of the AdminCaiDat sheet. The two GOI-12 rows
# (score_gap_*) load only when that part opens, so they are not listed.
THRESHOLDS: tuple[Threshold, ...] = (
    Threshold("order_confirm_hours", _OVERDUE, "Đơn đăng ký chờ xác nhận",
              "từ lúc học viên báo đã chuyển", "giờ", 24, 1, 168),
    Threshold("writing_review_hours", _OVERDUE, "Bài Writing chờ giáo viên duyệt (lớp offline)",
              "từ lúc AI chấm xong (bài AI lỗi: từ lúc nộp)", "giờ", 48, 1, 336),
    Threshold("regrade_hours", _OVERDUE, "Yêu cầu chấm lại",
              "từ lúc học viên gửi", "giờ", 48, 1, 336),
    Threshold("speaking_mock_hours", _OVERDUE, "Bài Speaking thi thử chờ chấm",
              "từ lúc thí sinh nộp bài", "giờ", 72, 1, 336),
    Threshold("incident_unclaimed_hours", _OVERDUE, "Sự cố chưa có người nhận",
              "từ lúc sự cố được ghi nhận", "giờ", 24, 1, 168),
    Threshold("feedback_unanswered_hours", _OVERDUE, "Phản hồi học viên chưa trả lời",
              "từ lúc học viên gửi", "giờ", 72, 1, 336),
    Threshold("late_streak_count", _ATTENTION, "Trễ bài liên tiếp",
              "tính theo bài giao của lớp", "bài", 2, 1, 20),
    Threshold("inactive_days", _ATTENTION, "Không hoạt động",
              "từ lần hoạt động gần nhất", "ngày", 7, 1, 90),
    Threshold("course_expiring_days", _ATTENTION, "Quyền khoá sắp hết",
              "số ngày còn lại tới hạn truy cập", "ngày", 7, 1, 90),
    Threshold("low_credits", _ATTENTION, "Sắp hết lượt chấm AI",
              "số lượt còn lại", "lượt", 3, 0, 100),
    Threshold("stalled_hours", _ATTENTION, "Bỏ dở bài",
              "đã mở, chưa nộp, không trả lời thêm", "giờ", 24, 1, 168),
    Threshold("lesson_review_pct", _RESULTS, "Cần ôn theo buổi",
              "tỉ lệ đúng của buổi dưới mức này", "%", 60, 1, 100),
    Threshold("too_fast_sec_per_question", _RESULTS, "Làm quá nhanh",
              "trung vị thời gian mỗi câu; để trống là tắt lý do này", "giây / câu",
              None, 1, 60, nullable=True),
    Threshold("many_retakes_count", _RESULTS, "Làm lại nhiều lần",
              "số lần làm lại một bài; để trống là tắt lý do này", "lần",
              None, 2, 20, nullable=True),
    Threshold("code_expiring_days", _EXPIRING, "Mã kích hoạt chưa dùng",
              "số ngày còn lại tới hạn mã", "ngày", 14, 1, 90),
    Threshold("exam_idle_minutes", _EXAMS, "Thí sinh đứng yên trong phòng thi",
              "từ thao tác gần nhất trong phòng thi", "phút", 5, 1, 60),
    Threshold("band_dist_min_papers", _EXAMS, "Số bài tối thiểu để hiện phân bố band",
              "số bài đã chấm của một kỹ năng; để trống là không hiện phân bố", "bài",
              None, 1, 50, nullable=True),
    Threshold("survey_remaining_sessions", _SURVEY, "Lớp sắp kết thúc mà chưa có khảo sát",
              "lớp còn từ số buổi này trở xuống; để trống là ẩn dòng", "buổi",
              None, 1, 50, nullable=True),
    Threshold("survey_min_respondents", _SURVEY, "Số người trả lời tối thiểu để hiện phần trăm",
              "ít hơn thì không tính phần trăm hay trung bình", "người", 5, 1, 100),
    Threshold("audio_retention_days", _RETENTION, "Giữ bản ghi âm Speaking",
              "từ lúc ghi; đã chốt tối đa 60 ngày", "ngày", None, None, None,
              fixed_from="RETENTION_AUDIO_DAYS"),
    Threshold("content_retention_after_expiry_days", _RETENTION, "Giữ bài làm sau khi khoá hết hạn",
              "từ ngày khoá hết hạn; đã chốt", "ngày", None, None, None,
              fixed_from="RETENTION_CONTENT_DAYS_AFTER_EXPIRY"),
    Threshold("import_error_report_days", _RETENTION, "Giữ báo cáo lỗi nhập liệu",
              "từ lúc nhập", "ngày", 30, 7, 365),
)
BY_KEY: dict[str, Threshold] = {t.key: t for t in THRESHOLDS}
EDITABLE: tuple[Threshold, ...] = tuple(t for t in THRESHOLDS if not t.fixed)


class ThresholdsUnavailable(RuntimeError):
    """The stored thresholds could not be read and no earlier copy exists."""


class ThresholdChangeError(ValueError):
    """A change was refused before anything was written.

    ``code`` is the 422 error code; ``message`` is the Vietnamese sentence
    shown under the field; ``key`` names the row (None for the whole request).
    """

    def __init__(self, code: str, message: str, key: Optional[str] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.key = key


_cache: Optional[tuple[dict[str, Optional[int]], float]] = None


def clear_cache() -> None:
    global _cache
    _cache = None


def _valid(t: Threshold, value: Any) -> bool:
    if value is None:
        return t.nullable
    # bool is an int subclass; a JSON true must not read as 1.
    return isinstance(value, int) and not isinstance(value, bool) and t.min <= value <= t.max


def _resolve(stored: Any) -> dict[str, Optional[int]]:
    """Stored object -> {key: value} for every editable key. A missing key
    takes its default; a stored value that fails validation (it never passes
    set_many) takes the default too, and is logged rather than trusted."""
    stored = stored if isinstance(stored, dict) else {}
    values: dict[str, Optional[int]] = {}
    for t in EDITABLE:
        if t.key not in stored:
            values[t.key] = t.default
        elif _valid(t, stored[t.key]):
            values[t.key] = stored[t.key]
        else:
            logger.warning("ops_thresholds: stored %s=%r is invalid; using the default", t.key, stored[t.key])
            values[t.key] = t.default
    return values


# Sync reads/writes on the service client, run off the event loop with
# asyncio.to_thread (the async-DB facade is reserved for the paths listed in
# tests/test_async_db_scaffold.py).
def _read_stored():
    return (supabase_admin.table("admin_settings").select("value")
            .eq("key", SETTINGS_KEY).limit(1).execute())


def _merge(merged: dict, reason: str, actor: Optional[str]):
    return supabase_admin.rpc("fn_admin_settings_merge", {
        "p_key": SETTINGS_KEY, "p_changes": merged, "p_reason": reason, "p_actor": actor,
    }).execute()


async def get() -> dict[str, Optional[int]]:
    """Every editable threshold, ``{key: int | None}`` (see module docstring)."""
    global _cache
    now = time.monotonic()
    if _cache is not None and _cache[1] > now:
        return dict(_cache[0])
    try:
        res = await asyncio.to_thread(_read_stored)
    except Exception as exc:
        if _cache is not None:
            logger.warning("ops_thresholds: read failed (%s); serving the previous copy", type(exc).__name__)
            return dict(_cache[0])
        raise ThresholdsUnavailable("ops_thresholds_unavailable") from exc
    rows = getattr(res, "data", None) or []
    values = _resolve(rows[0].get("value") if rows else None)
    _cache = (values, now + _TTL_SECONDS)
    return dict(values)


def fixed_value(t: Threshold) -> Optional[int]:
    """A read-only row's value from G04 configuration; None until G04 sets it."""
    value = getattr(settings, t.fixed_from, None) if t.fixed_from else None
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def items(values: dict[str, Optional[int]]) -> list[dict[str, Any]]:
    """The API rows of ``GET /admin/settings/thresholds`` (plan 5.4)."""
    return [
        {
            "key": t.key, "group": t.group, "label": t.label, "anchor": t.anchor,
            "value": fixed_value(t) if t.fixed else values.get(t.key, t.default),
            "unit": t.unit, "min": t.min, "max": t.max, "fixed": t.fixed,
        }
        for t in THRESHOLDS
    ]


def validate_changes(changes: Iterable[tuple[str, Any]]) -> dict[str, Optional[int]]:
    """``[(key, value)]`` -> ``{key: value}``, or :class:`ThresholdChangeError`."""
    merged: dict[str, Optional[int]] = {}
    for key, value in changes:
        t = BY_KEY.get(key)
        if t is None:
            raise ThresholdChangeError("unknown_key", "Ngưỡng này không có trong bảng.", key)
        if t.fixed:
            raise ThresholdChangeError("fixed", f"“{t.label}” cố định, không sửa ở trang này.", key)
        if key in merged:
            raise ThresholdChangeError("duplicate_key", f"“{t.label}” có hai giá trị trong cùng một lần lưu.", key)
        if not _valid(t, value):
            blank = " hoặc để trống" if t.nullable else ""
            raise ThresholdChangeError(
                "out_of_range", f"“{t.label}” phải là số nguyên từ {t.min} đến {t.max}{blank}.", key)
        merged[key] = value
    if not merged:
        raise ThresholdChangeError("no_changes", "Chưa có thay đổi nào để lưu.")
    return merged


async def set_many(changes: Iterable[tuple[str, Any]], reason: str, actor: Optional[str]) -> dict[str, Optional[int]]:
    """Validate, then merge and log in one transaction; returns the new values."""
    global _cache
    merged = validate_changes(changes)
    res = await asyncio.to_thread(_merge, merged, reason, actor)
    stored = getattr(res, "data", None)
    if not isinstance(stored, dict):
        # The write committed but its answer is unreadable: drop the cache so
        # the next read goes to the database instead of guessing.
        clear_cache()
        return await get()
    values = _resolve(stored)
    _cache = (values, time.monotonic() + _TTL_SECONDS)
    return dict(values)
