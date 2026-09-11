"""Private, read-only per-attempt diagnostics; no Gate F floor calculation."""

from uuid import UUID
from datetime import datetime

from fastapi import APIRouter, Header, HTTPException, Query, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel

from routers.admin import require_admin
from services.core_attempt_inspection import AttemptInspection, AttemptKind, Surface, inspect_attempt
from services.core_attempt_aggregate import ObservationReport, get_observation_aggregate, validate_window


class EvidenceReadRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request):
            try:
                return await handler(request)
            except RequestValidationError:
                # Validation runs before endpoint auth. Do not echo raw input
                # or leave these private diagnostic errors cacheable.
                raise HTTPException(422, "Tham số kiểm tra bài làm không hợp lệ",
                                    headers={"Cache-Control": "no-store"}) from None
        return private_handler


router = APIRouter(prefix="/admin/core-attempt-evidence", tags=["admin"], route_class=EvidenceReadRoute)


class ObservationHTTPError(BaseModel):
    # Includes framework validation errors sanitized by EvidenceReadRoute.
    detail: str


async def _require_private_admin(authorization: str | None) -> dict:
    """Apply the shared admin guard without exposing provider/DB failures."""
    try:
        return await require_admin(authorization)
    except HTTPException as exc:
        raise HTTPException(
            exc.status_code,
            {401: "Vui lòng đăng nhập", 403: "Chỉ admin mới có quyền truy cập"}.get(
                exc.status_code, "Không thể xác minh quyền quản trị lúc này"
            ),
            headers={**(exc.headers or {}), "Cache-Control": "no-store"},
        ) from None
    except Exception:
        raise HTTPException(
            503,
            "Không thể xác minh quyền quản trị lúc này",
            headers={"Cache-Control": "no-store"},
        ) from None


@router.get("", response_model=ObservationReport, responses={
    401: {"model": ObservationHTTPError, "description": "Authentication required"},
    403: {"model": ObservationHTTPError, "description": "Admin access required"},
    422: {"model": ObservationReport | ObservationHTTPError, "description": "Invalid request or rejected/oversized receipt window"},
    500: {"model": ObservationHTTPError, "description": "Admin verification failed"},
    503: {"model": ObservationReport | ObservationHTTPError, "description": "Evidence read or admin verification unavailable"},
})
async def aggregate_core_observations(
    response: Response,
    window_start: datetime = Query(...),
    window_end: datetime | None = Query(default=None, description="Exclusive receipt cutoff; omitted uses database statement time, not the app clock."),
    authorization: str | None = Header(default=None),
):
    """Historical receipt cohort only: counts overlap, eligibility stays unknown."""
    await _require_private_admin(authorization)
    try:
        validate_window(window_start, window_end)
    except ValueError:
        raise HTTPException(422, "Khoảng thời gian phải có múi giờ, không ở tương lai và không quá 31 ngày", headers={"Cache-Control": "no-store"}) from None
    response.headers["Cache-Control"] = "no-store"
    report = await get_observation_aggregate(window_start, window_end)
    if report.status == "unavailable":
        response.status_code = 422 if report.unavailable_reason in {"window_rejected", "window_too_large"} else 503
    return report


@router.get("/{surface}/{canonical_attempt_id}", response_model=AttemptInspection)
async def inspect_core_attempt(
    surface: Surface,
    canonical_attempt_id: UUID,
    response: Response,
    attempt_kind: AttemptKind = Query(default="default"),
    authorization: str | None = Header(default=None),
):
    """Receipt counts are not attempt counts. Current readback is independent.

    Speaking requires an explicit session/full-test namespace. Unknown coverage
    stays unknown even with a successful canonical result and capture enabled.
    """
    await _require_private_admin(authorization)
    if (surface == "speaking") != (attempt_kind != "default"):
        raise HTTPException(422, "Loại bài làm không phù hợp với kỹ năng")
    response.headers["Cache-Control"] = "no-store"
    return await inspect_attempt(surface, attempt_kind, canonical_attempt_id)
