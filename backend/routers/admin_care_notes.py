"""Care notes on a learner (ADMINIA-0074 FR-032; plan 5.4; G09-T35; mig 442).

* ``GET /admin/learners/{ref}/care-notes`` — admin. Newest first; the
  learner's ``students.persona_notes`` is the last item, ``is_initial``
  (shown as "Ghi chú ban đầu"), while no stored row is the initial note.
* ``POST /admin/learners/{ref}/care-notes`` — admin. 201 ``{note}``.
* ``PATCH /admin/care-notes/{id}`` — admin. Text, next step and due day:
  the author, inside ``CARE_NOTE_EDIT_HOURS`` (default 24), else 409
  ``note_locked``. ``done`` alone: always.
* ``DELETE /admin/care-notes/{id}`` — admin. Soft delete, author inside the
  window only, else 409 ``note_locked``. 204.

Admin only (Q16 b): no teacher route. A note is never shown in the system log
(FR-027). Before 442 is applied every route answers 503
``care_notes_unavailable``.
"""

from __future__ import annotations

import asyncio
import functools
import logging
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Response

from models.admin_learner_profile import CareNoteIn, CareNoteOut, CareNotePatch, CareNotes
from routers.admin import _actor_id, require_admin
from routers.admin_learners import _person
from services import learner_care_notes as notes

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-learners"])

_LOCKED = {"code": "note_locked",
           "message": "Ghi chú chỉ sửa hoặc xoá được bởi người ghi, trong {h} giờ đầu. Vẫn đánh dấu xong được."}


def _unavailable(action: str) -> HTTPException:
    return HTTPException(503, {"code": "care_notes_unavailable",
                               "message": f"Chưa {action} được ghi chú chăm sóc. Thử lại sau."})


def _locked() -> HTTPException:
    return HTTPException(409, {**_LOCKED, "message": _LOCKED["message"].format(h=notes.edit_hours())})


def _missing() -> HTTPException:
    return HTTPException(404, {"code": "note_not_found", "message": "Không tìm thấy ghi chú này."})


@router.get("/admin/learners/{ref}/care-notes", response_model=CareNotes)
async def list_care_notes(ref: str, authorization: str | None = Header(default=None)):
    admin = await require_admin(authorization)
    person = await _person(ref)
    try:
        items = await asyncio.to_thread(notes.list_notes, person, _actor_id(admin))
    except Exception as exc:
        logger.warning("care notes: read failed (%s)", type(exc).__name__)
        raise _unavailable("đọc") from exc
    return {"items": items}


@router.post("/admin/learners/{ref}/care-notes", response_model=CareNoteOut, status_code=201)
async def add_care_note(ref: str, body: CareNoteIn, authorization: str | None = Header(default=None)):
    admin = await require_admin(authorization)
    author = _actor_id(admin)
    if not author:
        raise HTTPException(403, "Không xác định được người ghi")
    person = await _person(ref)
    try:
        note = await asyncio.to_thread(functools.partial(
            notes.add, person, str(author), body=body.body, next_action=body.next_action, due_on=body.due_on))
    except Exception as exc:
        logger.warning("care notes: insert failed (%s)", type(exc).__name__)
        raise _unavailable("lưu") from exc
    return {"note": note}


@router.patch("/admin/care-notes/{note_id}", response_model=CareNoteOut)
async def patch_care_note(note_id: UUID, body: CareNotePatch, authorization: str | None = Header(default=None)):
    admin = await require_admin(authorization)
    viewer = str(_actor_id(admin) or "")
    changes = body.model_dump(include=body.model_fields_set)
    try:
        note = await asyncio.to_thread(notes.update, str(note_id), viewer, changes)
    except notes.NoteNotFound:
        raise _missing()
    except notes.NoteLocked:
        raise _locked()
    except Exception as exc:
        logger.warning("care notes: update failed (%s)", type(exc).__name__)
        raise _unavailable("lưu") from exc
    return {"note": note}


@router.delete("/admin/care-notes/{note_id}", status_code=204)
async def delete_care_note(note_id: UUID, authorization: str | None = Header(default=None)):
    admin = await require_admin(authorization)
    viewer = str(_actor_id(admin) or "")
    try:
        await asyncio.to_thread(notes.remove, str(note_id), viewer)
    except notes.NoteNotFound:
        raise _missing()
    except notes.NoteLocked:
        raise _locked()
    except Exception as exc:
        logger.warning("care notes: delete failed (%s)", type(exc).__name__)
        raise _unavailable("xoá") from exc
    return Response(status_code=204)
