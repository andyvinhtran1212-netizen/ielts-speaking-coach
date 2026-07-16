#!/usr/bin/env python3
"""Self-check một file grammar quiz bank .md TRƯỚC khi import.

Kiểm tra bằng chính logic của importer (services/quiz_import.py) + hợp đồng
Adaptive Mastery (mỗi item_key cần ≥ correct_to_master skill khác nhau + ≥1 câu
production `input: text`). Không đụng DB — an toàn chạy offline.

Dùng:
    cd backend && python scripts/validate_grammar_quiz_bank.py ../docs/grammar-quiz-banks/G-tenses-present-perfect.md
    # nhiều file:
    python scripts/validate_grammar_quiz_bank.py ../docs/grammar-quiz-banks/*.md

Exit code 0 = sạch; 1 = có lỗi (in chi tiết). Dùng được trong CI/loop của agent.
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.quiz_import import (  # noqa: E402
    parse_quiz_question,
    validate_question,
    _is_meta_block,
    _grammar_slug_exists,
)


def _docs(text: str) -> list[dict]:
    """Tách file thành các YAML doc (bỏ block comment thuần)."""
    out = []
    for chunk in re.split(r"^---\s*$", text, flags=re.M):
        if not chunk.strip() or chunk.strip().startswith("#"):
            continue
        try:
            d = yaml.safe_load(chunk)
        except yaml.YAMLError as exc:
            out.append({"__yaml_error__": str(exc)})
            continue
        if isinstance(d, dict):
            out.append(d)
    return out


def check_file(path: Path) -> list[str]:
    problems: list[str] = []
    text = path.read_text(encoding="utf-8")
    docs = _docs(text)

    yaml_errs = [d["__yaml_error__"] for d in docs if "__yaml_error__" in d]
    for e in yaml_errs:
        problems.append(f"YAML lỗi: {e}")
    docs = [d for d in docs if "__yaml_error__" not in d]

    metas = [d for d in docs if _is_meta_block(d)]
    if len(metas) != 1:
        problems.append(f"Phải có đúng 1 block META (kind: quiz); thấy {len(metas)}.")
    meta = metas[0] if metas else {}
    correct_to_master = int(meta.get("correct_to_master", 2) or 2)
    if meta and str(meta.get("skill_area", "")).strip() != "grammar":
        problems.append("META.skill_area phải là 'grammar'.")
    if meta and not str(meta.get("code", "")).strip():
        problems.append("META.code trống.")

    qblocks = [d for d in docs if not _is_meta_block(d) and d.get("type")]
    if not qblocks:
        problems.append("Không có câu hỏi nào.")

    # Stray block: a non-META YAML doc WITHOUT `type`. The real importer rejects
    # it ("Block không có 'type' và không phải META"), so a typo'd/missing `type`
    # must FAIL the gate — never be silently excluded from validation.
    for d in docs:
        if not _is_meta_block(d) and not d.get("type"):
            qid = d.get("id") or "(thiếu id)"
            problems.append(
                f"Block lạc [{qid}]: không phải META và thiếu 'type' "
                "(importer sẽ reject)."
            )

    ids: dict[str, int] = defaultdict(int)
    pools: dict[str, dict] = defaultdict(lambda: {"skills": set(), "prod": False, "n": 0})

    for d in qblocks:
        p = parse_quiz_question(d)
        p["_bool_answer"] = d.get("answer") if isinstance(d.get("answer"), bool) else None
        qid = p.get("qid") or "(thiếu id)"
        ids[qid] += 1
        for ve in validate_question(p):
            problems.append(f"[{qid}] {ve['field']}: {ve['message']}")
        slug = p.get("grammar_article_slug")
        if not slug:
            problems.append(f"[{qid}] thiếu grammar_article_slug (bắt buộc theo chuẩn).")
        elif not _grammar_slug_exists(slug):
            problems.append(f"[{qid}] grammar_article_slug không tồn tại: '{slug}'.")
        if not d.get("explain"):
            problems.append(f"[{qid}] thiếu explain (bắt buộc theo chuẩn).")
        if not d.get("subtype"):
            problems.append(f"[{qid}] thiếu subtype/level (basic|intermediate|advanced).")
        k = p.get("item_key") or "(thiếu item_key)"
        pools[k]["skills"].add(p.get("skill"))
        pools[k]["n"] += 1
        if p.get("input") == "text":
            pools[k]["prod"] = True

    for qid, n in ids.items():
        if n > 1:
            problems.append(f"id trùng {n} lần: '{qid}'.")

    for k, v in pools.items():
        if len(v["skills"]) < correct_to_master:
            problems.append(
                f"item_key '{k}': cần ≥{correct_to_master} skill khác nhau, "
                f"đang có {sorted(s for s in v['skills'] if s)}."
            )
        if not v["prod"]:
            problems.append(f"item_key '{k}': thiếu câu production (input: text).")

    return problems


# --- Content-quality lint (§ authoring-guide "distractor phải sai rõ ràng") -------------
# Bắt hai lớp lỗi CƠ HỌC (deterministic) mà cổng QA2 (LLM, docs/QA2_REVIEWER_PROMPT.md)
# cũng nhắm tới, để chúng FAIL CI thay vì lọt tới học viên:
#   1. `explain` TỰ NHẬN câu hỏi/đáp án bị hỏng (tác giả để lại ghi chú "thực ra câu này
#      sai / câu hỏi nên dùng…" nhưng vẫn ship) — vd lỗi lc_addition_a2, rc_former_i1.
#   2. `gap_text` mà mọi biến thể `accept` đều là ký tự KHÓ GÕ (chỉ 'ø'), khiến học viên
#      không thể nhập được đáp án đúng.
# LƯU Ý: lớp khó hơn — MCQ có >1 phương án đúng tiếng Anh — cần phán đoán ngữ nghĩa, do
# reviewer QA2 (LLM) phụ trách, KHÔNG bắt được bằng lint tĩnh này.
_SELF_ADMITTED_BROKEN = re.compile(
    r"(prompt lạc lõng|lạc lõng|câu hỏi nên (dùng|sửa|là)|câu hỏi sai|đề bài sai"
    r"|explain bị ngược|giải thích bị ngược|thực tế là sai nhưng"
    # explain tự thú đáp án nước đôi (audit 2026-07-16 P6): "gấp 3 (hoặc gấp 4
    # nếu tính…)" / "cấu trúc không sai, nhưng nội dung…" là câu hỏng còn ship.
    r"|hoặc gấp \d|nếu tính cơ sở|cấu trúc không sai, nhưng)",
    re.I,
)
_UNTYPEABLE = re.compile(r"[øØ∅]")
# Prompt gap_text hứa một cách trả lời KHÔNG tồn tại trong player: ô trống không
# submit được (nút Kiểm tra disable khi rỗng) và 'ø' không gõ được trên bàn phím
# thường. Convention đúng: "nếu không cần, gõ số 0" + accept có "0".
_IMPOSSIBLE_GAP_INSTRUCTION = re.compile(r"để trống|bỏ trống|[øØ∅]")
# Số từ tối đa của accept[0] cho câu tự gõ — dài hơn là bắt học viên gõ nguyên
# câu/cụm dài, chấm exact-match + edit-distance-1 không đủ dung sai (audit S3).
_MAX_ACCEPT_WORDS = 3


def content_lint(path: Path) -> list[str]:
    """Lint nội dung (ngoài cấu trúc): đáp án tự-mâu-thuẫn + accept không gõ được."""
    problems: list[str] = []
    docs = [d for d in _docs(path.read_text(encoding="utf-8")) if "__yaml_error__" not in d]
    for d in docs:
        if _is_meta_block(d) or not d.get("type"):
            continue
        qid = d.get("id") or "(thiếu id)"
        explain = str(d.get("explain") or "")
        if _SELF_ADMITTED_BROKEN.search(explain):
            problems.append(
                f"[{qid}] explain tự nhận câu hỏi/đáp án bị hỏng — sửa đề/đáp án cho đúng "
                "thay vì để lại ghi chú nghi ngờ trong explain."
            )
        accept = d.get("accept")
        if isinstance(accept, list) and accept and all(_UNTYPEABLE.search(str(a)) for a in accept):
            problems.append(
                f"[{qid}] accept toàn ký tự khó gõ ({accept}) — thêm biến thể gõ được "
                "(vd 'no article') để học viên nhập được đáp án."
            )
        # ── 3 lint bổ sung theo audit 2026-07-16 (§V đợt 3) — chỉ cho câu tự gõ ──
        if str(d.get("input") or "") == "text":
            prompt = str(d.get("prompt") or "")
            if isinstance(accept, list):
                for a in accept:
                    if "/" in str(a):
                        problems.append(
                            f"[{qid}] accept chứa '/' literal ({a!r}) — engine so khớp "
                            "nguyên văn, không hiểu 'biến thể nào cũng được'; tách thành "
                            "các phần tử accept riêng."
                        )
                        break
            if _IMPOSSIBLE_GAP_INSTRUCTION.search(prompt):
                problems.append(
                    f"[{qid}] prompt gap_text hứa cách trả lời không tồn tại "
                    "('để trống'/'ø' — ô trống không submit được, ø không gõ được); "
                    "đổi sang convention 'nếu không cần, gõ số 0'."
                )
            if isinstance(accept, list) and accept:
                n_words = len(str(accept[0]).split())
                if n_words > _MAX_ACCEPT_WORDS:
                    problems.append(
                        f"[{qid}] accept[0] dài {n_words} từ (> {_MAX_ACCEPT_WORDS}) — "
                        "bắt gõ nguyên câu/cụm dài là chấm fragile; thu hẹp phần phải gõ "
                        "hoặc chuyển sang mcq (giữ ≥1 gap_text khác cho item_key)."
                    )
    return problems


def main(argv: list[str]) -> int:
    files = [Path(a) for a in argv[1:]]
    if not files:
        print(__doc__)
        return 1
    total = 0
    for f in files:
        if not f.exists():
            print(f"✗ {f} — không tìm thấy")
            total += 1
            continue
        probs = check_file(f) + content_lint(f)
        if probs:
            total += len(probs)
            print(f"✗ {f} — {len(probs)} vấn đề:")
            for p in probs:
                print(f"    - {p}")
        else:
            print(f"✓ {f} — sạch")
    print(f"\n{'PASS' if total == 0 else 'FAIL'} ({total} vấn đề)")
    return 0 if total == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
