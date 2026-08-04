"""Chạy bù sổ tiến bộ Speaking cho toàn bộ bài đã chấm.

    python -m scripts.backfill_speaking_progress --dry-run
    python -m scripts.backfill_speaking_progress --commit
    python -m scripts.backfill_speaking_progress --commit --limit 200

VÌ SAO CHẠY NGAY. `jobs/retention_sweep.py` dọn `transcript` và
`pronunciation_payload` ở mốc 60 ngày. Đo trên prod 04/08/2026: job ấy CHƯA TỪNG
CHẠY (0/5.514 phiên bị dọn), nên toàn bộ lịch sử vẫn còn nguyên. Một lượt chạy bù
bây giờ giữ được nó; bật cơ chế dọn trước là vứt đi thứ không lấy lại được.

CHỈ ĐỌC, GHI SANG BẢNG MỚI. Không sửa một dòng nào của `responses` hay
`sessions` — nếu lượt chạy này hỏng, thứ duy nhất phải làm là chạy lại.

CHẠY LẠI ĐƯỢC. `speaking_progress_marks.response_id` là UNIQUE, và script bỏ qua
những câu đã có dấu mốc (trừ khi `--redo`).

MẶC ĐỊNH LÀ THỬ KHÔ.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter

from database import supabase_admin
from services import speaking_progress as sp

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("backfill-progress")

_PAGE = 1000
_ID_CHUNK = 100

_R_COLS = ("id, session_id, overall_band, final_band_p, duration_seconds, "
           "transcript, pronunciation_payload, score_confidence, recorded_at")
_S_COLS = "id, user_id, part, started_at, class_assignment_item_id"


def _paged(table: str, columns: str, apply_filters) -> list[dict]:
    out, start = [], 0
    while True:
        rows = (apply_filters(supabase_admin.table(table).select(columns))
                .order("id").range(start, start + _PAGE - 1).execute().data) or []
        out.extend(rows)
        if len(rows) < _PAGE:
            return out
        start += _PAGE


def _existing_marks() -> set:
    return {r["response_id"] for r in
            _paged("speaking_progress_marks", "response_id", lambda q: q)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--commit", action="store_true", help="Ghi thật.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Chỉ xem (đây cũng là mặc định).")
    ap.add_argument("--limit", type=int, help="Dừng sau N câu — để thử.")
    ap.add_argument("--redo", action="store_true",
                    help="Dựng lại cả những câu ĐÃ có dấu mốc.")
    args = ap.parse_args()
    commit = args.commit and not args.dry_run

    logger.info("Đọc câu trả lời đã chấm…")
    responses = _paged("responses", _R_COLS,
                       lambda q: q.not_.is_("overall_band", "null"))
    logger.info("  %d câu đã có điểm", len(responses))

    done = set() if args.redo else _existing_marks()
    todo = [r for r in responses if r["id"] not in done]
    if args.limit:
        todo = todo[: args.limit]
    logger.info("  %d câu cần dựng dấu mốc (%d đã có)", len(todo), len(done))
    if not todo:
        logger.info("Không có gì để làm.")
        return 0

    sids = list({r["session_id"] for r in todo if r.get("session_id")})
    sessions: dict = {}
    for chunk in (sids[i:i + _ID_CHUNK] for i in range(0, len(sids), _ID_CHUNK)):
        for s in _paged("sessions", _S_COLS, lambda q, c=chunk: q.in_("id", c)):
            sessions[s["id"]] = s

    rids = [r["id"] for r in todo]
    recs: dict = {}
    for chunk in (rids[i:i + _ID_CHUNK] for i in range(0, len(rids), _ID_CHUNK)):
        for g in _paged("grammar_recommendations", "response_id, recommended_slug",
                        lambda q, c=chunk: q.in_("response_id", c)):
            recs.setdefault(g["response_id"], []).append(g)

    marks, skipped = [], 0
    for r in todo:
        s = sessions.get(r.get("session_id")) or {}
        m = sp.build_mark(response=r, session=s, recommendations=recs.get(r["id"]))
        if m is None:
            skipped += 1
            continue
        marks.append(m)

    have = Counter()
    for m in marks:
        if m["words_per_minute"] is not None:
            have["tốc độ nói"] += 1
        if m["weak_phonemes"]:
            have["âm vị yếu"] += 1
        if m["mispronounced_words"]:
            have["từ phát âm sai"] += 1
        if m["grammar_tags"]:
            have["nhãn ngữ pháp"] += 1
        if m["class_assignment_item_id"]:
            have["thuộc bài tập lớp"] += 1
    logger.info("\nDựng được %d dấu mốc (bỏ qua %d chưa chấm xong).", len(marks), skipped)
    for k, v in have.most_common():
        logger.info("  có %-22s %d", k, v)

    if not commit:
        logger.info("\n-- THỬ KHÔ. Ba dấu mốc mẫu: --")
        for m in marks[:3]:
            logger.info("  band=%s wpm=%s âm yếu=%s ngữ pháp=%s",
                        m["band"], m["words_per_minute"],
                        m["weak_phonemes"], m["grammar_tags"])
        logger.info("\nThêm --commit để ghi thật.")
        return 0

    # Ghi theo mẻ. `upsert` theo `response_id` để chạy lại (kể cả với --redo)
    # không đâm vào ràng buộc duy nhất.
    written = failed = 0
    for i in range(0, len(marks), _ID_CHUNK):
        batch = marks[i:i + _ID_CHUNK]
        try:
            supabase_admin.table("speaking_progress_marks") \
                .upsert(batch, on_conflict="response_id").execute()
            written += len(batch)
        except Exception as exc:                       # noqa: BLE001
            # Một mẻ hỏng không được làm đổ cả lượt: chạy lại sẽ bỏ qua phần đã
            # ghi và làm nốt phần còn thiếu.
            failed += len(batch)
            logger.warning("  mẻ %d-%d hỏng: %s", i, i + len(batch), exc)
        if (i // _ID_CHUNK) % 10 == 0:
            logger.info("  … %d/%d", min(i + _ID_CHUNK, len(marks)), len(marks))

    logger.info("\nXong: ghi %d · hỏng %d", written, failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
