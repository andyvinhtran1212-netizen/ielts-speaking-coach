"""Responses for the admin course-access and credit ledger routes."""

from typing import Literal

from pydantic import BaseModel, Field, JsonValue


class AdminCourseCreditBalance(BaseModel):
    balance: int
    usable_from: str | None
    usable_until: str | None
    carry_balance: int
    carry_expires_at: str | None


class AdminUserAccessItem(BaseModel):
    entitlement_id: str | None
    course_code: str | None
    product_slug: str | None
    title: str | None
    short_title: str | None
    kind: str | None
    source: str | None
    state: str
    starts_at: str | None
    expires_at: str | None
    days_left: int | None
    review_mode: str | None
    can_renew: bool
    renew_order_code: str | None
    credits: AdminCourseCreditBalance | None


class AdminCreditsByKind(BaseModel):
    online: int
    class_: int = Field(alias="class")


class AdminCreditTotals(BaseModel):
    total: int
    by_kind: AdminCreditsByKind


class AdminEntitlementEvent(BaseModel):
    entitlement_id: str
    action: str | None
    actor_id: str | None
    actor_kind: str | None
    before: JsonValue
    after: JsonValue
    reason: str | None
    at: str | None


class AdminUserAccessResponse(BaseModel):
    items: list[AdminUserAccessItem]
    credits: AdminCreditTotals
    content_visible_until: str | None
    content_days_after_expiry: int | None
    events: list[AdminEntitlementEvent]


class AdminCreditActor(BaseModel):
    id: str
    email: str | None
    display_name: str | None


class AdminCreditLedgerRow(BaseModel):
    at: str | None
    delta: int
    reason: str | None
    balance_after: int
    course_code: str | None
    feature: str | None
    label_vi: str
    note: str | None
    entitlement_id: str | None
    actor: AdminCreditActor | None


class AdminUserCreditsResponse(BaseModel):
    balance: int
    items: list[AdminCreditLedgerRow]
    next_cursor: str | None


class AdminCreditAdjustResponse(BaseModel):
    status: Literal["adjusted", "replay"]
    balance: int | None
