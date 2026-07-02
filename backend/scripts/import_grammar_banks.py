#!/usr/bin/env python3
"""Bulk import grammar quiz banks → Supabase.

Nạp cả loạt file `docs/grammar-quiz-banks/G-*.md` vào bảng quiz_banks/quiz_questions,
map `code` (G-<category>-<slug>) → grammar topic_id của category. Mỗi bank commit
ALL-OR-NOTHING (qua import_quiz_file). Có cổng QA trước khi commit.

AN TOÀN: mặc định **dry-run** (không ghi DB). Thêm --commit để ghi thật.

Dùng:
    cd backend
    python scripts/import_grammar_banks.py                 # dry-run tất cả
    python scripts/import_grammar_banks.py --only tenses   # lọc theo code chứa 'tenses'
    python scripts/import_grammar_banks.py --commit        # ghi thật
    python scripts/import_grammar_banks.py --commit --allow-warnings   # bỏ qua cảnh báo chất lượng (chỉ chặn lỗi importer)

Cổng QA (mặc định STRICT): mỗi bank phải sạch theo scripts/validate_grammar_quiz_bank.py
(cấu trúc importer + hợp đồng mastery + slug + explain/subtype). Bank có vấn đề → BỎ QUA,
không commit. --allow-warnings nới lỏng: chỉ chặn khi importer thật sự báo lỗi.
"""
from __future__ import annotations

import argparse
import glob
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import supabase_admin  # noqa: E402
from services.quiz_import import import_quiz_file  # noqa: E402
from scripts.validate_grammar_quiz_bank import check_file  # noqa: E402
from scripts.qa_grammar_banks import CATEGORIES, is_bank_file  # noqa: E402

DEFAULT_BANK_DIR = Path(__file__).resolve().parents[2] / "docs" / "grammar-quiz-banks"


def grammar_topic_map() -> dict:
    """slug(category) -> topic_id cho các grammar topic (mig 120)."""
    rows = (
        supabase_admin.table("content_topics").select("id, slug")
        .eq("skill_area", "grammar").execute()
    ).data or []
    return {r["slug"]: r["id"] for r in rows}


def category_of(code: str) -> str | None:
    """Suy category từ bank code G-<category>-<slug> (category có thể chứa '-')."""
    # Ưu tiên category dài nhất khớp prefix, tránh nhầm khi tên lồng nhau.
    for cat in sorted(CATEGORIES, key=len, reverse=True):
        if code.startswith(f"G-{cat}-"):
            return cat
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(DEFAULT_BANK_DIR))
    ap.add_argument("--only", default=None, help="chỉ xử lý file có code chứa chuỗi này")
    ap.add_argument("--commit", action="store_true", help="ghi thật (mặc định dry-run)")
    ap.add_argument("--allow-warnings", action="store_true",
                    help="bỏ qua cảnh báo chất lượng; chỉ chặn lỗi importer")
    args = ap.parse_args()

    bank_dir = Path(args.dir)
    files = sorted(
        Path(p) for p in glob.glob(str(bank_dir / "G-*.md"))
        if is_bank_file(Path(p)) and (not args.only or args.only in Path(p).name)
    )
    if not files:
        print("Không tìm thấy bank nào khớp.")
        return 1

    topics = grammar_topic_map()
    missing_topics = sorted(set(CATEGORIES) - set(topics))
    if missing_topics:
        print(f"⚠ Thiếu grammar topic trong DB (mig 120?): {missing_topics}")

    batch_id = f"grammar-bulk-{time.strftime('%Y%m%d-%H%M%S')}"
    mode = "COMMIT (ghi DB)" if args.commit else "DRY-RUN (không ghi)"
    print(f"Chế độ: {mode}   |   batch_id: {batch_id}   |   {len(files)} bank\n")

    n_ok = n_skip = n_fail = 0
    for f in files:
        text = f.read_text(encoding="utf-8")

        # code + category → topic_id
        m = re.search(r'^code:\s*["\']?([^"\'\n]+)', text, re.M)
        code = (m.group(1).strip() if m else "")
        cat = category_of(code)
        topic_id = topics.get(cat) if cat else None

        # Cổng QA
        problems = check_file(f)
        if problems and not args.allow_warnings:
            n_skip += 1
            print(f"  ⊘ SKIP {f.name} — QA {len(problems)} vấn đề (chạy validate để xem chi tiết)")
            continue

        if not cat or not topic_id:
            n_fail += 1
            print(f"  ✗ FAIL {f.name} — không map được topic (code={code!r}, category={cat})")
            continue

        # Import (dry-run luôn để lấy summary; commit nếu --commit và QA sạch)
        do_commit = args.commit
        res = import_quiz_file(text, topic_id=topic_id,
                               dry_run=not do_commit, import_batch_id=batch_id)
        errs = res["summary"]["errors"]
        qn = res["summary"]["questions"]
        pools = res["summary"]["pools"]

        if errs:
            n_fail += 1
            print(f"  ✗ FAIL {f.name} — importer báo {errs} lỗi (không ghi)")
            for e in res.get("validation_errors", [])[:8]:
                print(f"        - [{e.get('qid','')}] {e.get('field','')}: {e.get('message','')}")
        elif do_commit:
            n_ok += 1
            print(f"  ✓ COMMIT {f.name} → topic={cat} bank_id={res['committed_bank_id']} "
                  f"({qn} câu / {pools} item_key)")
        else:
            n_ok += 1
            print(f"  ✓ OK(dry) {f.name} → topic={cat} ({qn} câu / {pools} item_key)")

    print("\n" + "=" * 60)
    print(f"OK={n_ok}  SKIP(QA)={n_skip}  FAIL={n_fail}   [{mode}]")
    if not args.commit and n_ok:
        print("→ Chạy lại với --commit để ghi vào DB.")
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
