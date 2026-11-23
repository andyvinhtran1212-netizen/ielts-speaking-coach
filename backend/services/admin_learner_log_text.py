"""Plain Vietnamese text for one line of the learner's Nhật ký hệ thống tab
(ADMINIA-0074 FR-027; G09-T04c).

One function per source. Each reads only the action code and the before /
after values it names, never free text a person typed (a reason, an e-mail
that did not match, a note): the log says what happened, not what was
written. An access code appears only masked (:func:`masked`), never whole. An action this module does not know reads "Thao tác khác", never a
raw code.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Optional

OTHER = "Thao tác khác"

_ROLE = {"user": "Học viên", "student": "Học viên", "instructor": "Giáo viên", "admin": "Quản trị"}


# access_codes fields an edit can change, in a fixed order.
_FIELD = {"permissions": "quyền", "expires_at": "hạn dùng", "is_active": "trạng thái", "session_limit": "số lượt",
          "notes": "ghi chú", "code_type": "loại mã", "cohort_id": "lớp"}


def _role(value: Any) -> str:
    return _ROLE.get(str(value or ""), "vai trò khác")


def masked(code: Optional[str]) -> Optional[str]:
    """An access code is a bearer credential: the log names it only by a
    masked tail (``…AB12``), enough to find it on the code page, never the
    whole value. A 12-symbol code keeps 4 symbols, a legacy 8-symbol code 2,
    a shorter one none."""
    symbols = "".join(ch for ch in str(code or "") if ch.isalnum())
    keep = 4 if len(symbols) >= 12 else 2 if len(symbols) >= 8 else 0
    return f"…{symbols[-keep:]}" if keep else None


def _code(code: Optional[str]) -> str:
    label = masked(code)
    return f"mã {label}" if label else "một mã"


def _band(value: Any) -> Optional[str]:
    try:
        return f"{float(value):.1f}"
    except (TypeError, ValueError):
        return None


def _day(value: Any) -> Optional[str]:
    try:
        return date.fromisoformat(str(value)[:10]).strftime("%d/%m/%Y")
    except (TypeError, ValueError):
        return None


def access_code(action: str, *, code: Optional[str], before: Optional[dict], after: Optional[dict],
                received: bool) -> str:
    """``received`` is False only for the person a reassigned code left."""
    after = after if isinstance(after, dict) else {}
    if action == "create":
        if after.get("via") == "refill":
            return f"Được cấp {_code(code)} (cấp lại từ mã cũ)"
        return f"Được cấp {_code(code)}"
    if action == "remove_user":
        return f"Gỡ khỏi {_code(code)}"
    if action == "reassign":
        return f"Nhận {_code(code)} chuyển từ người khác" if received else f"{_code(code)[0].upper()}{_code(code)[1:]} được chuyển sang người khác"
    if action == "refill":
        # The new code itself (after.new_code) is never shown: it may not be
        # used yet, and its own "Được cấp" line names it masked.
        return f"Cấp lại {_code(code)}, thay bằng mã mới"
    if action == "revoke":
        return f"Thu hồi {_code(code)}"
    if action == "hard_delete":
        return f"Xoá hẳn {_code(code)}"
    if action == "edit":
        fields = [_FIELD[k] for k in _FIELD if k in after]
        return f"Sửa {_code(code)}: {', '.join(fields)}" if fields else f"Sửa {_code(code)}"
    if action == "promote_role":
        return f"Kích hoạt {_code(code)}: vai trò thành {_role(after.get('role'))}"
    if action == "promote_role_rejected":
        return f"Kích hoạt {_code(code)} bị từ chối: email không khớp"
    if action == "promote_role_failed":
        return f"Kích hoạt {_code(code)} nhưng chưa đổi được vai trò"
    if action == "enroll_reassign_rejected":
        return f"Kích hoạt {_code(code)} bị từ chối: học viên đang thuộc giáo viên khác"
    if action == "enroll_rejected_cohort_archived":
        return f"Kích hoạt {_code(code)} bị từ chối: lớp đã lưu trữ"
    return OTHER


def security(event: str, *, before: Optional[dict], after: Optional[dict]) -> str:
    before = before if isinstance(before, dict) else {}
    after = after if isinstance(after, dict) else {}
    if event == "role_changed":
        return f"Đổi vai trò: {_role(before.get('role'))} → {_role(after.get('role'))}"
    if event == "active_changed":
        if after.get("is_active") is True:
            return "Mở lại tài khoản"
        if after.get("is_active") is False:
            return "Tạm khoá tài khoản"
        return OTHER
    return {
        "staff_row_inserted": "Tạo tài khoản nhân sự",
        "sessions_revoked": "Đăng xuất khỏi mọi thiết bị",
        "sessions_revoke_failed": "Đăng xuất khỏi mọi thiết bị không thành công",
        "mfa_factor_enrolled": "Thêm xác thực hai bước",
        "mfa_factor_verified": "Xác minh xác thực hai bước",
        "mfa_factor_deleted": "Gỡ xác thực hai bước",
        "bootstrap_recovery": "Khôi phục quyền quản trị",
    }.get(event, OTHER)


def _vn_day(value: Any) -> Optional[str]:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    if not value:
        return None
    try:
        at = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return (at.astimezone(ZoneInfo("Asia/Ho_Chi_Minh")) if at.tzinfo else at).strftime("%d/%m/%Y")


def class_action(action: str, *, title: Optional[str], details: Optional[dict] = None) -> str:
    named = f"“{title}”" if title else "một bài"
    details = details if isinstance(details, dict) else {}
    if action == "return_work":
        return f"Trả lại bài {named} để làm lại"
    if action == "due_change":
        old, new = _vn_day(details.get("previous_due_at")), _vn_day(details.get("due_at"))
        if old and new:
            return f"Đổi hạn bài {named}: {old} → {new}"
        if new:
            return f"Đổi hạn bài {named} thành {new}"
        return f"Đổi hạn bài {named}"
    return OTHER


def goal(used: str, *, after: Optional[dict]) -> str:
    after = after if isinstance(after, dict) else {}
    side = {"admin": "giá trị Admin nhập", "learner": "giá trị học viên khai"}.get(used)
    if side is None:
        return OTHER
    parts = [p for p in (f"band {_band(after.get('target_band'))}" if _band(after.get("target_band")) else None,
                         f"ngày thi {_day(after.get('target_date'))}" if _day(after.get("target_date")) else None) if p]
    tail = f": {', '.join(parts)}" if parts else ""
    return f"Thống nhất mục tiêu theo {side}{tail}"
