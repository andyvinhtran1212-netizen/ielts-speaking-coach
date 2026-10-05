"""Recording identity and conditional saves on the existing response row."""
import hashlib
import re
from fastapi import HTTPException

_TOKEN = re.compile(r"/[^/]+\.([0-9a-f-]{36})\.([0-9a-f]{64})\.[a-z0-9]+$")


def submission_id(row):
    match = _TOKEN.search((row or {}).get("audio_storage_path") or "")
    return match.group(1) if match else None


def submission_revision(row):
    if not row:
        return "absent"
    return hashlib.sha256(f"{row['id']}:{row.get('audio_storage_path') or ''}".encode()).hexdigest()


class SubmissionReplay(Exception):
    def __init__(self, response_id):
        self.response_id = response_id


def load_response(db, session_id, question_id):
    rows = (db.table("responses").select("id,audio_storage_path")
            .eq("session_id", session_id).eq("question_id", question_id)
            .limit(1).execute().data) or []
    return rows[0] if rows else None


def check_submission(current, token, storage_path, expected_revision):
    if submission_id(current) == token:
        if current.get("audio_storage_path") != storage_path:
            raise HTTPException(409, {"code": "submission_audio_changed"})
        raise SubmissionReplay(current["id"])
    if submission_revision(current) != expected_revision:
        raise HTTPException(409, {"code": "submission_superseded",
                                 "message": "Bản ghi đã thay đổi. Hãy gửi lại bản ghi đang giữ."})


def save_response(db, row, *, baseline, token, storage_path, expected_revision):
    current = load_response(db, row["session_id"], row["question_id"])
    check_submission(current, token, storage_path, expected_revision)
    if baseline:
        query = db.table("responses").update(row).eq("id", baseline["id"])
        old_path = baseline.get("audio_storage_path")
        query = query.eq("audio_storage_path", old_path) if old_path else query.is_("audio_storage_path", "null")
        saved = query.execute().data
        if saved:
            return baseline["id"]
    else:
        try:
            saved = db.table("responses").insert(row).execute().data
            if saved:
                return saved[0]["id"]
        except Exception:
            # The existing unique session/question index arbitrates insert races.
            current = load_response(db, row["session_id"], row["question_id"])
            if current:
                check_submission(current, token, storage_path, expected_revision)
            raise
    current = load_response(db, row["session_id"], row["question_id"])
    check_submission(current, token, storage_path, expected_revision)
    raise HTTPException(409, {"code": "submission_superseded"})
