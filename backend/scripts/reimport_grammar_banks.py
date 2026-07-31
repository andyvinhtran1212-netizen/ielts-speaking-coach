#!/usr/bin/env python3
"""Re-import grammar quiz banks whose repo file differs from the DB.

Audit 2026-07-16 remediation: after merging the bank fixes (PR #792/#795), the
DB still serves the OLD questions until each bank is re-imported. This script
re-runs the exact importer (services.quiz_import.import_quiz_file) for the
given bank files, reusing each bank's EXISTING topic_id from quiz_banks —
same code path as admin POST /admin/quiz/import, no HTTP/auth needed.

Dùng (từ backend/, chạy trên PROD DB qua .env):
    python3 scripts/reimport_grammar_banks.py                # dry-run TẤT CẢ bank lệch DB
    python3 scripts/reimport_grammar_banks.py --commit       # import thật các bank lệch
    python3 scripts/reimport_grammar_banks.py --commit G-foundations-articles  # chỉ 1 bank

An toàn: mặc định dry-run (không ghi gì); --commit dùng RPC quiz_replace_questions
(replace nguyên tử từng bank). Chỉ đụng các bank có trong docs/grammar-quiz-banks/.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import supabase_admin
from services.quiz_import import import_quiz_file

BANK_DIR = Path(__file__).resolve().parents[2] / "docs" / "grammar-quiz-banks"


def main(argv: list[str]) -> int:
    commit = "--commit" in argv
    only = {a for a in argv[1:] if not a.startswith("--")}

    banks = (supabase_admin.table("quiz_banks")
             .select("id, code, topic_id")
             .eq("skill_area", "grammar").execute().data or [])
    topic_by_code = {b["code"]: b["topic_id"] for b in banks}

    files = sorted(BANK_DIR.glob("G-*.md"))
    ran = failed = 0
    for f in files:
        text = f.read_text(encoding="utf-8")
        m = re.search(r'^code:\s*"([^"]+)"', text, flags=re.M)
        if not m:
            print(f"✗ {f.name}: không tìm thấy code trong META")
            failed += 1
            continue
        code = m.group(1)
        if only and code not in only:
            continue
        topic_id = topic_by_code.get(code)
        if not topic_id:
            print(f"✗ {code}: chưa có trong DB (cần import lần đầu qua admin để chọn topic)")
            failed += 1
            continue
        res = import_quiz_file(text, topic_id=topic_id, dry_run=not commit)
        errs = [q for q in res.get("questions", []) if q.get("validation_errors")]
        if errs or res.get("errors"):
            print(f"✗ {code}: bị importer từ chối — {res.get('errors') or errs[:3]}")
            failed += 1
            continue
        n = len(res.get("questions", []))
        print(f"{'✓ imported' if commit else '· dry-run OK'} {code} ({n} câu)")
        ran += 1

    print(f"\n{'COMMIT' if commit else 'DRY-RUN'}: {ran} bank OK, {failed} lỗi")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
