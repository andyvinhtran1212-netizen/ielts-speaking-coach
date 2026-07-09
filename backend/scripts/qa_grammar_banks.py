#!/usr/bin/env python3
"""QA harness cho ngân hàng grammar quiz — chạy TRƯỚC khi import hàng loạt.

Gộp 3 lớp kiểm tra tự động (Track C lớp 1 trong docs/GRAMMAR_CHECKUP_PLAN.md):

  1. STRUCTURAL + MASTERY  — mỗi bank hợp lệ importer + mỗi item_key đạt hợp đồng
     mastery (dùng lại check_file của validate_grammar_quiz_bank.py).
  2. CROSS-BANK DEDUP      — cảnh báo câu trùng `prompt` (chuẩn hoá) giữa các bank
     / trong cùng bank ⇒ giữ "ngân hàng lớn không lặp".
  3. COVERAGE              — so với 107 bank kỳ vọng (auto từ backend/content):
     bank nào CHƯA tạo; bank có mã lỗi mục tiêu nhưng <2 câu error_id.

KHÔNG đụng DB. Dùng:
    cd backend && python scripts/qa_grammar_banks.py
    python scripts/qa_grammar_banks.py --dir ../docs/grammar-quiz-banks

Exit 0 nếu không có lỗi chặn (structural/mastery). Dedup + coverage là cảnh báo
(không chặn) — in ra để review. Dùng được trong CI/loop.
"""
from __future__ import annotations

import argparse
import glob
import re
import sys
from collections import defaultdict
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.validate_grammar_quiz_bank import check_file, _docs  # noqa: E402

CONTENT_DIR = Path(__file__).resolve().parents[1] / "content"
DEFAULT_BANK_DIR = Path(__file__).resolve().parents[2] / "docs" / "grammar-quiz-banks"
CATEGORIES = [
    "foundations", "parts-of-speech", "modifiers", "sentence-structures",
    "tenses", "verb-patterns", "grammar-for-meaning", "ielts-grammar-lab",
    "grammar-for-writing", "error-clinic", "grammar-for-reading",
]


def _norm_prompt(p: str) -> str:
    """Chuẩn hoá prompt để so trùng: lower, gộp khoảng trắng, bỏ dấu câu, gộp ____."""
    p = (p or "").lower()
    p = re.sub(r"_{2,}", " ____ ", p)
    p = re.sub(r"[^\w\s]", " ", p, flags=re.UNICODE)
    p = re.sub(r"\s+", " ", p).strip()
    return p


def expected_banks() -> dict:
    """107 bank kỳ vọng từ frontmatter thật: code -> {category, slug, err_codes}."""
    out = {}
    for cat in CATEGORIES:
        for f in sorted((CONTENT_DIR / cat).glob("*.md")):
            txt = f.read_text(encoding="utf-8")
            m = re.match(r"^---\n(.*?)\n---", txt, re.S)
            fm = yaml.safe_load(m.group(1)) if m else {}
            slug = fm.get("slug", f.stem)
            cet = fm.get("common_error_tags") or []
            err = [t for t in cet if "_" in str(t)]  # mã lỗi thật (underscore)
            out[f"G-{cat}-{slug}"] = {"category": cat, "slug": slug, "err_codes": err}
    return out


def is_bank_file(path: Path) -> bool:
    """True nếu file có block META kind: quiz (bỏ _TEMPLATE, AGENT_PROMPT, README)."""
    try:
        for d in _docs(path.read_text(encoding="utf-8")):
            if isinstance(d, dict) and str(d.get("kind", "")).strip().lower() == "quiz":
                return True
    except Exception:
        return False
    return False


def parse_bank(path: Path) -> dict:
    docs = [d for d in _docs(path.read_text(encoding="utf-8")) if "__yaml_error__" not in d]
    meta = next((d for d in docs if str(d.get("kind", "")).lower() == "quiz"), {})
    qs = [d for d in docs if d.get("type")]
    return {"code": str(meta.get("code", "")).strip(), "questions": qs}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(DEFAULT_BANK_DIR))
    args = ap.parse_args()
    bank_dir = Path(args.dir)

    all_md = [Path(p) for p in glob.glob(str(bank_dir / "*.md"))]
    # Bank thật = tên theo convention G-<category>-<slug> + có META kind: quiz.
    # (bỏ _TEMPLATE.md, AGENT_PROMPT.md, README…)
    banks = sorted(p for p in all_md if p.name.startswith("G-") and is_bank_file(p))
    skipped = [p.name for p in all_md if p not in banks]

    print(f"Thư mục: {bank_dir}")
    print(f"Bank tìm thấy: {len(banks)}  (bỏ qua non-bank: {skipped})\n")

    # ── Lớp 1: structural + mastery ─────────────────────────────────────────
    blocking = 0
    print("── Lớp 1: cấu trúc + mastery ──")
    for p in banks:
        probs = check_file(p)
        if probs:
            blocking += len(probs)
            print(f"  ✗ {p.name} — {len(probs)} lỗi:")
            for x in probs:
                print(f"      - {x}")
        else:
            print(f"  ✓ {p.name}")
    if not banks:
        print("  (chưa có bank nào)")

    # ── Lớp 2: dedup chéo ───────────────────────────────────────────────────
    print("\n── Lớp 2: trùng câu (prompt chuẩn hoá) ──")
    seen = defaultdict(list)  # norm_prompt -> [(code, qid)]
    for p in banks:
        b = parse_bank(p)
        for q in b["questions"]:
            key = _norm_prompt(q.get("prompt", ""))
            if key:
                seen[key].append((b["code"], q.get("id")))
    dups = {k: v for k, v in seen.items() if len(v) > 1}
    if dups:
        for k, v in list(dups.items())[:50]:
            locs = ", ".join(f"{c}:{q}" for c, q in v)
            print(f"  ⚠ trùng ({len(v)}): {locs}")
        print(f"  → tổng {len(dups)} nhóm trùng.")
    else:
        print("  ✓ không có prompt trùng.")

    # ── Lớp 3: coverage vs 107 bank kỳ vọng ─────────────────────────────────
    print("\n── Lớp 3: coverage vs ma trận (107 bank) ──")
    exp = expected_banks()
    produced = set()
    err_warn = []
    for p in banks:
        b = parse_bank(p)
        produced.add(b["code"])
        info = exp.get(b["code"])
        if info and info["err_codes"]:
            n_err = sum(1 for q in b["questions"]
                        if q.get("skill") == "error_id" or q.get("type") == "boolean")
            if n_err < 2:
                err_warn.append(f"{b['code']}: có mã lỗi mục tiêu nhưng chỉ {n_err} câu error_id (<2)")
    unknown = produced - set(exp)
    if unknown:
        print(f"  ⚠ bank không khớp code chuẩn (kiểm tra code): {sorted(unknown)}")
    missing = [c for c in exp if c not in produced]
    print(f"  Đã tạo: {len(produced & set(exp))}/107   Còn thiếu: {len(missing)}")
    by_cat = defaultdict(int)
    for c in missing:
        by_cat[exp[c]["category"]] += 1
    for cat in CATEGORIES:
        if by_cat[cat]:
            print(f"      thiếu {by_cat[cat]:2}  {cat}")
    for w in err_warn:
        print(f"  ⚠ {w}")

    # ── Kết luận ────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"BLOCKING (lớp 1): {blocking}   |   dup groups: {len(dups)}   |   "
          f"missing banks: {len(missing)}   |   error_id warnings: {len(err_warn)}")
    print("PASS ✅ (không lỗi chặn)" if blocking == 0 else "FAIL ❌ (còn lỗi chặn lớp 1)")
    return 0 if blocking == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
