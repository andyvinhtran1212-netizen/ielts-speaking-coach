"""Response model for GET /api/student/course (LEARNERCORE-0063 T15, plan.md)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class CourseProgress(BaseModel):
    done: int
    total: int


class CourseOnlineRow(BaseModel):
    course_code: str
    product_slug: Optional[str] = None
    title: str
    state: Literal["active", "expired"]
    days_left: Optional[int] = None
    expires_at: Optional[str] = None
    can_renew: bool = False
    progress: Optional[CourseProgress] = None
    credits_left: Optional[int] = None


class CourseOtherProduct(BaseModel):
    slug: str
    title: str
    status: Literal["open", "coming_soon"]
    starts_at: Optional[str] = None


class CourseRepractice(BaseModel):
    course_code: str
    title: str


class CourseClass(BaseModel):
    name: Optional[str] = None
    teacher_name: Optional[str] = None
    course_title: Optional[str] = None
    repractice: list[CourseRepractice] = Field(default_factory=list)


class StudentCourseResponse(BaseModel):
    online: list[CourseOnlineRow] = Field(default_factory=list)
    other_products: list[CourseOtherProduct] = Field(default_factory=list)
    # `class` is a Python keyword; the wire name stays `class`.
    class_: Optional[CourseClass] = Field(default=None, alias="class")
    assigned_open: int = 0
    has_online: bool = False
    has_class: bool = False
    selected: Optional[str] = None
    degraded: list[Literal["online", "other_products", "class", "assigned_open"]] = Field(
        default_factory=list)

    model_config = {"populate_by_name": True}
