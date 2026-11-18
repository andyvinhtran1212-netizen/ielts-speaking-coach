"""Nạp "Kho luyện viết câu IELTS Academic — 45 buổi" vào Course 5.

    python -m scripts.import_sentence_lab_course5 --package <IELTS_45_buoi_Kho_bai_tap_AI.zip>
    python -m scripts.import_sentence_lab_course5 --package <zip> --commit --publish --expect-ref <ref>

MẶC ĐỊNH LÀ THỬ KHÔ: chỉ đọc gói, kiểm toàn bộ, in kế hoạch. Không đọc cũng
không ghi cơ sở dữ liệu. Ghi thật phải nêu `--commit` (và cần phê duyệt ghi DB
theo quy trình release).

MỖI BUỔI = MỘT BANK của Course 5 (`code` = ``C5-SL-S01`` … ``C5-SL-S45``,
`skill_area='course'`). `lesson_no` để NULL có chủ đích, giống Advanced
Vocabulary: các ô (course_id, lesson_no) là lịch buổi canonical của lớp, còn kho
này là bài bổ trợ giáo viên chọn giao. Bank được tìm lại theo `code`, nên chạy
lại lệnh cập nhật đúng bank cũ.

MỖI ITEM = MỘT CÂU `type='writing'` — đi đúng đường tự luận sẵn có
(`course_writing_state` / `submit_course_writing` / bản nháp / bảng giáo viên).
Phần khác duy nhất là bộ chấm: bank mang `meta.sentence_lab.kind` nên lượt nộp
đi qua `services/sentence_lab_grader.py` (GPT, khóa chấm riêng) thay cho bộ soát
ngữ pháp của Course 1.

KHÓA CHẤM KHÔNG RỜI MÁY CHỦ. Đề công khai + khóa chấm nằm ở
`quiz_questions.segments` — cột mà đường phát đề Course luôn giữ lại
(`_COURSE_WITHHELD_FIELDS`), và `course_writing_state` không đọc. Đáp án tham
khảo (`explain`) chỉ hiện sau khi học viên đã qua lượt sửa (xem quiz_service).

KIỂM TRƯỚC KHI GHI: SHA-256 từng tệp khớp `manifest.json`; đủ 45 buổi × 12 câu;
`id` duy nhất; mỗi đề có đúng một khóa chấm và ngược lại; `required` của đề và
khóa giống nhau; course JSON và items JSONL nói cùng một nội dung.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import sys
import zipfile
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("import-sentence-lab")

KIND = "sentence_lab_v1"
COURSE_CODE = "C5"
CODE_PREFIX = "C5-SL-"
SOURCE = "sentence-lab-45"
_SESSIONS = 45
_ITEMS_PER_SESSION = 12
_ID = re.compile(r"^S(0[1-9]|[1-3][0-9]|4[0-5])-Q(0[1-9]|1[0-2])$")

OPERATION_LABELS = {
    "sua_loi": "Sửa lỗi",
    "ghep_cau": "Ghép câu",
    "tu_du_lieu": "Viết từ dữ liệu",
    "tu_y": "Viết từ ý",
    "viet_lai": "Viết lại câu",
}
TASK_LABELS = {"task1": "Task 1", "task2": "Task 2", "both": "Task 1 & 2"}
_PUBLIC_ITEM_FIELDS = ("id", "session_id", "group_id", "stage", "operation",
                       "task", "source", "instruction", "required", "review_of")
_KEY_FIELDS = ("answer", "meaning", "required", "variants", "explanation",
               "error_tags")
_FILES = ("public/course_public.json", "public/items_public.jsonl",
          "private/grading_keys.private.jsonl", "public/error_codes.json",
          "private/ai_grader_prompt.md")


class PackageError(SystemExit):
    pass


def _fail(msg: str) -> None:
    raise PackageError(f"GÓI KHÔNG HỢP LỆ: {msg}")


def read_package(path: Path) -> dict[str, bytes]:
    """{đường dẫn trong gói: bytes} cho manifest + các tệp cần dùng."""
    wanted = ("manifest.json",) + _FILES
    out: dict[str, bytes] = {}
    if path.is_dir():
        for name in wanted:
            f = path / name
            if f.is_file():
                out[name] = f.read_bytes()
    elif zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            all_names = [n for n in zf.namelist() if not n.endswith("/")]
            for name in wanted:
                # Gói có thể nằm ở gốc ZIP hoặc trong đúng một thư mục bọc.
                hits = [n for n in all_names
                        if n == name or n.endswith("/" + name)
                        and n.count("/") == name.count("/") + 1]
                if len(hits) > 1:
                    _fail(f"ZIP có nhiều bản {name}.")
                if hits:
                    out[name] = zf.read(hits[0])
    else:
        _fail(f"{path} không phải thư mục hay tệp ZIP.")
    missing = [n for n in wanted if n not in out]
    if missing:
        _fail("thiếu tệp " + ", ".join(missing))
    return out


def _jsonl(raw: bytes, label: str) -> list[dict]:
    rows = []
    for n, line in enumerate(raw.decode("utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            _fail(f"{label} dòng {n} không phải JSON ({exc.msg}).")
        if not isinstance(obj, dict):
            _fail(f"{label} dòng {n} không phải object.")
        rows.append(obj)
    return rows


def _text(value, label: str) -> str:
    t = str(value or "").strip()
    if not t:
        _fail(f"{label} rỗng.")
    return t


def build_plan(files: dict[str, bytes]) -> dict:
    """Kiểm toàn bộ gói và dựng 45 bank. Không chạm cơ sở dữ liệu."""
    manifest = json.loads(files["manifest.json"])
    declared = {f["path"]: f for f in manifest.get("files") or []}
    for name in _FILES:
        info = declared.get(name)
        if not info:
            _fail(f"manifest không khai {name}.")
        digest = hashlib.sha256(files[name]).hexdigest()
        if digest != info.get("sha256"):
            _fail(f"SHA-256 của {name} không khớp manifest.")
    content_version = _text(manifest.get("content_version"), "content_version")
    schema_version = _text(manifest.get("schema_version"), "schema_version")

    course = json.loads(files["public/course_public.json"])
    if course.get("content_version") != content_version:
        _fail("content_version của course_public.json khác manifest.")
    items = _jsonl(files["public/items_public.jsonl"], "items_public.jsonl")
    keys = _jsonl(files["private/grading_keys.private.jsonl"],
                  "grading_keys.private.jsonl")

    by_id: dict[str, dict] = {}
    for it in items:
        iid = str(it.get("id") or "")
        if not _ID.match(iid):
            _fail(f"id đề không hợp lệ {iid!r}.")
        if iid in by_id:
            _fail(f"id đề trùng {iid}.")
        if not iid.startswith(str(it.get("session_id") or "") + "-"):
            _fail(f"{iid} không thuộc buổi {it.get('session_id')!r}.")
        if it.get("operation") not in OPERATION_LABELS:
            _fail(f"{iid} có operation lạ {it.get('operation')!r}.")
        if it.get("task") not in TASK_LABELS:
            _fail(f"{iid} có task lạ {it.get('task')!r}.")
        _text(it.get("source"), f"{iid}.source")
        _text(it.get("instruction"), f"{iid}.instruction")
        if not isinstance(it.get("required"), list) or not it["required"]:
            _fail(f"{iid}.required phải là danh sách có nội dung.")
        for k in ("answer", "explanation"):
            if k in it:
                _fail(f"{iid} (đề công khai) chứa trường khóa `{k}`.")
        by_id[iid] = it

    key_by_id: dict[str, dict] = {}
    for k in keys:
        iid = str(k.get("item_id") or "")
        if iid in key_by_id:
            _fail(f"khóa chấm trùng {iid}.")
        if iid not in by_id:
            _fail(f"khóa chấm {iid} không có đề tương ứng.")
        _text(k.get("answer"), f"{iid}.answer")
        if not isinstance(k.get("meaning"), list) or not k["meaning"]:
            _fail(f"{iid}.meaning phải là danh sách có nội dung.")
        if k.get("required") != by_id[iid]["required"]:
            _fail(f"{iid}: required của khóa chấm khác đề công khai.")
        key_by_id[iid] = k
    missing_keys = sorted(set(by_id) - set(key_by_id))
    if missing_keys:
        _fail(f"{len(missing_keys)} đề không có khóa chấm (vd. {missing_keys[0]}).")

    sessions = course.get("sessions") or []
    if len(sessions) != _SESSIONS:
        _fail(f"cần {_SESSIONS} buổi, gói có {len(sessions)}.")
    groups = {g.get("id"): g.get("title") for g in course.get("groups") or []}
    banks = []
    for s_no, s in enumerate(sessions, 1):
        sid = f"S{s_no:02d}"
        if s.get("id") != sid:
            _fail(f"buổi thứ {s_no} mang id {s.get('id')!r}, cần {sid}.")
        s_items = s.get("items") or []
        if len(s_items) != _ITEMS_PER_SESSION:
            _fail(f"{sid} có {len(s_items)} câu, cần {_ITEMS_PER_SESSION}.")
        rows = []
        for order, ci in enumerate(s_items, 1):
            iid = f"{sid}-Q{order:02d}"
            if ci.get("id") != iid:
                _fail(f"{sid} câu {order} mang id {ci.get('id')!r}.")
            pub = by_id.get(iid)
            if not pub:
                _fail(f"{iid} có trong course JSON nhưng không có trong items JSONL.")
            for f in ("stage", "operation", "task", "source", "instruction",
                      "required", "review_of"):
                if ci.get(f) != pub.get(f):
                    _fail(f"{iid}.{f} khác nhau giữa course JSON và items JSONL.")
            rows.append(question_row(pub, key_by_id[iid], order))
        worked = s.get("worked") or {}
        banks.append({
            "code": CODE_PREFIX + sid,
            "title": f"Viết câu {sid} — {_text(s.get('title'), sid + '.title')}",
            "meta": {
                "nguon": "IELTS_45_buoi_Kho_bai_tap_AI",
                "so_tu_luan": len(rows),
                "sentence_lab": {
                    "kind": KIND,
                    "content_version": content_version,
                    "schema_version": schema_version,
                    "session_id": sid,
                    "session_no": s_no,
                    "group_id": s.get("group"),
                    "group_title": groups.get(s.get("group")),
                    "title": s.get("title"),
                    "checkpoint": bool(s.get("checkpoint")),
                    "show_guidance_after_first_submission":
                        bool(s.get("show_guidance_after_first_submission")),
                    "recall_from": s.get("recall_from") or [],
                    "guide": {
                        "objective": s.get("objective"),
                        "ielts_use": s.get("ielts_use"),
                        "focus": s.get("focus") or [],
                        "mini_rules": s.get("mini_rules") or [],
                        "worked": {k: worked.get(k) for k in
                                   ("instruction", "source", "answer", "explanation")},
                        "exit_check": s.get("exit_check") or [],
                    },
                },
            },
            "rows": rows,
        })
    total = sum(len(b["rows"]) for b in banks)
    if total != len(by_id):
        _fail(f"course JSON có {total} câu nhưng items JSONL có {len(by_id)}.")
    return {"content_version": content_version, "banks": banks}


def prompt_text(pub: dict) -> str:
    """Bản chữ của đề — dùng cho mọi mặt đọc cũ (bảng giáo viên, bản chụp)."""
    req = " · ".join(str(r).strip() for r in pub["required"])
    return (f"**{pub['instruction'].strip()}**\n"
            f"Câu/dữ kiện gốc: {pub['source'].strip()}\n"
            f"Bắt buộc: {req}")


def explain_text(key: dict) -> str:
    parts = [f"**Đáp án tham khảo:** {key['answer'].strip()}"]
    if str(key.get("variants") or "").strip():
        parts.append(f"**Cách viết khác:** {str(key['variants']).strip()}")
    if str(key.get("explanation") or "").strip():
        parts.append(str(key["explanation"]).strip())
    return "\n\n".join(parts)


def question_row(pub: dict, key: dict, order: int) -> dict:
    op = pub["operation"]
    return {
        "qid": pub["id"],
        "item_key": op,
        "type": "writing",
        "subtype": f"{OPERATION_LABELS[op]} · {TASK_LABELS[pub['task']]}",
        "input": "text",
        "skill": "VIET-CAU",
        "pair": None,
        # Điểm luyện câu 0–10 không phải một đúng/sai trắc nghiệm.
        "counts_toward_mastery": False,
        "prompt": prompt_text(pub),
        "hint": None,
        "options": None,
        "answer": None,
        "accept": None,
        "segments": {"sentence_lab": {
            "item": {f: pub.get(f) for f in _PUBLIC_ITEM_FIELDS},
            "key": {f: key.get(f) for f in _KEY_FIELDS},
        }},
        "mask": None,
        "pairs": None,
        "explain": explain_text(key),
        "why_wrong": None,
        "points": 1,
        "audio_url": None,
        "grammar_article_slug": None,
        "order": order,
    }


def database_dsn(expect_ref: str) -> str:
    """DATABASE_URL đã kiểm project ref — không bao giờ ghi nhầm môi trường.

    Ghi qua kết nối Postgres trực tiếp (như repair_cam16_cam18_screening), không
    qua PostgREST: từ migration 309, CHECK `quiz_banks_grammar_revision_shape`
    gọi một hàm `grammar_quiz_*` mà service_role không còn quyền EXECUTE, nên
    mọi INSERT/UPDATE `quiz_banks` qua PostgREST bị từ chối (42501).
    """
    from urllib.parse import unquote, urlparse
    from config import settings
    raw = (getattr(settings, "DATABASE_URL", "") or "").strip()
    if not raw:
        raise SystemExit("Cần DATABASE_URL để ghi.")
    dsn = raw.replace("postgresql+asyncpg://", "postgresql://", 1)
    parsed = urlparse(dsn)
    host = (parsed.hostname or "").lower()
    user = unquote(parsed.username or "")
    refs: set[str] = set()
    if host.startswith("db.") and host.endswith(".supabase.co"):
        refs.add(host.removeprefix("db.").removesuffix(".supabase.co"))
    if host.endswith(".pooler.supabase.com") and user.startswith("postgres."):
        refs.add(user.split(".", 1)[1])
    api_ref = (urlparse(getattr(settings, "SUPABASE_URL", "") or "").hostname
               or "").split(".", 1)[0]
    if refs != {expect_ref} or api_ref != expect_ref:
        raise SystemExit("Sai môi trường: project ref của DATABASE_URL/SUPABASE_URL "
                         f"không khớp --expect-ref {expect_ref!r} — không ghi gì.")
    return dsn


async def _commit_async(plan: dict, *, publish: bool, dsn: str) -> int:
    import asyncpg
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        async with conn.transaction():
            course = await conn.fetchrow(
                "select id, code, name from public.courses where code = $1", COURSE_CODE)
            if not course:
                raise SystemExit(f"Không có khoá nào mã {COURSE_CODE!r}.")
            logger.info("Khoá: %s — %s", course["code"], course["name"])
            for bank in plan["banks"]:
                rows = await conn.fetch(
                    "select id, course_id, source, is_published from public.quiz_banks "
                    "where code = $1 and skill_area = 'course' for update", bank["code"])
                if len(rows) > 1:
                    raise SystemExit(f"{bank['code']}: có {len(rows)} bank cùng mã — "
                                     "dừng, không ghi gì.")
                if rows and (rows[0]["course_id"] != course["id"]
                             or rows[0]["source"] != SOURCE):
                    raise SystemExit(f"{bank['code']}: mã đã thuộc một bank khác "
                                     "(course/source lệch) — dừng, không ghi gì.")
                meta = json.dumps(bank["meta"], ensure_ascii=False)
                if rows:
                    bank_id = rows[0]["id"]
                    await conn.execute(
                        "update public.quiz_banks set title = $2, words_count = $3, "
                        "lesson_no = null, meta = $4::jsonb where id = $1",
                        bank_id, bank["title"], len(bank["rows"]), meta)
                else:
                    bank_id = await conn.fetchval(
                        "insert into public.quiz_banks (code, title, skill_area, course_id, "
                        "lesson_no, words_count, source, is_published, meta) values "
                        "($1, $2, 'course', $3, null, $4, $5, false, $6::jsonb) returning id",
                        bank["code"], bank["title"], course["id"], len(bank["rows"]),
                        SOURCE, meta)
                n = await conn.fetchval(
                    "select public.quiz_replace_questions($1, $2::jsonb)", bank_id,
                    json.dumps(bank["rows"], ensure_ascii=False))
                if n != len(bank["rows"]):
                    raise SystemExit(f"{bank['code']}: ghi {n}/{len(bank['rows'])} câu — "
                                     "huỷ toàn bộ, không ghi gì.")
                if publish:
                    await conn.execute(
                        "update public.quiz_banks set is_published = true where id = $1",
                        bank_id)
                logger.info("%s  %s  %d câu  %s", bank["code"], bank_id, n,
                            "XUẤT BẢN" if publish else
                            ("giữ trạng thái cũ" if rows else "NHÁP"))
            total = await conn.fetchval(
                "select count(*) from public.quiz_questions q join public.quiz_banks b "
                "on b.id = q.bank_id where b.course_id = $1 and b.source = $2",
                course["id"], SOURCE)
            want = sum(len(b["rows"]) for b in plan["banks"])
            if total != want:
                raise SystemExit(f"Kiểm cuối: {total} câu, cần {want} — huỷ toàn bộ.")
    finally:
        await conn.close()
    logger.info("Xong: %d bank, %d câu, một giao dịch.", len(plan["banks"]), want)
    return 0


def commit_plan(plan: dict, *, publish: bool, expect_ref: str) -> int:
    """Ghi cả 45 bank trong MỘT giao dịch: hỏng ở đâu là không ghi gì cả."""
    import asyncio
    return asyncio.run(_commit_async(plan, publish=publish,
                                     dsn=database_dsn(expect_ref)))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--package", required=True,
                    help="ZIP gói nội dung, hoặc thư mục đã giải nén.")
    ap.add_argument("--commit", action="store_true", help="Ghi thật vào DB.")
    ap.add_argument("--publish", action="store_true",
                    help="Xuất bản sau khi ghi đủ câu (chỉ có tác dụng với --commit).")
    ap.add_argument("--expect-ref",
                    help="Project ref Supabase phải khớp (bắt buộc với --commit).")
    args = ap.parse_args(argv)

    plan = build_plan(read_package(Path(args.package)))
    banks = plan["banks"]
    logger.info("Gói %s: %d buổi · %d câu · mỗi khóa chấm đã khớp đề.",
                plan["content_version"], len(banks), sum(len(b["rows"]) for b in banks))
    for b in banks[:3] + [banks[-1]]:
        logger.info("  %s  %s", b["code"], b["title"])
    if not args.commit:
        s = banks[0]["rows"][0]
        logger.info("\n-- THỬ KHÔ. Câu mẫu %s (%s) --\n%s", s["qid"], s["subtype"], s["prompt"])
        logger.info("\nThêm --commit (và --publish) để ghi thật. Cần phê duyệt ghi DB.")
        return 0
    if not args.expect_ref:
        raise SystemExit("--commit cần --expect-ref <project ref> của môi trường đích.")
    return commit_plan(plan, publish=args.publish, expect_ref=args.expect_ref)


if __name__ == "__main__":
    sys.exit(main())
