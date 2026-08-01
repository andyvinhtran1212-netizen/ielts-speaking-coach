"""Soát nội dung đề Listening/Reading ĐÃ NHẬP so với file nguồn.

VÌ SAO CÓ FILE NÀY. Đợt kiểm 01/08/2026 phát hiện bộ chuyển đổi Cambridge làm
hỏng 961 chỗ trên 70/72 đề mà không ai biết — đề vẫn "published", vẫn chấm được,
nên không có tín hiệu nào báo động. Hai câu hỏi phải hỏi sau MỖI lần import, và
chúng khác nhau:

    1. Nội dung có khớp đề gốc không?          → --mode fidelity
    2. Câu hỏi có TRẢ LỜI ĐƯỢC không?          → --mode answerable

Câu (2) là thứ đã bị bỏ sót lâu nhất: 11 câu trắc nghiệm không có lựa chọn A/B/C
nào và 5 câu flow-chart rỗng cả đề bài — học viên đọc được câu hỏi nhưng không
có gì để chọn. Bộ soát (1) báo XANH suốt vì nó chỉ so chữ với nguồn, không bao
giờ hỏi "câu này có đủ thứ để làm không". Chạy CẢ HAI.

Chỉ ĐỌC — không ghi gì vào DB.

Cách chạy (từ backend/, venv có .env prod):
  python3 scripts/audit_imported_test_content.py                       # cả hai
  python3 scripts/audit_imported_test_content.py --mode answerable
  python3 scripts/audit_imported_test_content.py --source-dir <thư mục md nguồn>
  python3 scripts/audit_imported_test_content.py --json report.json

Thoát 1 nếu còn lỗi ⇒ dùng được trong CI/cron.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _script_env import load_env                              # noqa: E402
load_env()

from database import supabase_admin                           # noqa: E402

# Mặc định trỏ vào bộ Cambridge; đổi bằng --test-prefix cho bộ khác.
LIS_PREFIX = "ILR-LIS-CAM-B"
RDG_PREFIX = "ILR-RDG-CAM-B"

LIMIT_RE = re.compile(
    r"(ONE WORD ONLY|ONE WORD AND/OR A NUMBER|"
    r"NO MORE THAN THREE WORDS(?: AND/OR A NUMBER)?|"
    r"NO MORE THAN TWO WORDS(?: AND/OR A NUMBER)?)", re.I)
QHEAD_RE = re.compile(r"^#{0,3}\s*Questions?\s+(\d+)\s*[-–—]\s*(\d+)\s*$", re.M | re.I)

# Dạng bắt học viên CHỌN CHỮ CÁI ⇒ bắt buộc phải có lựa chọn hiển thị.
LETTER_KINDS = {"plan_label", "mcq_3option", "mcq_4option", "matching"}
# Dạng điền chữ: đề bài có thể nằm trong template thay cho prompt.
TEMPLATE_KINDS = {"notes_completion", "table_completion", "form_completion",
                  "sentence_completion", "summary_completion", "flow_chart"}
COMPLETION_RDG = {"notes_completion", "summary_completion", "table_completion",
                  "form_completion", "sentence_completion", "short_answer",
                  "flow_chart_completion", "diagram_label_completion"}

CLASS_NAMES = {
    "L1": "Listening: hướng dẫn sai giới hạn từ",
    "L2": "Listening: template lẫn rác (ô trống giả / số trang)",
    "L3": "Listening: prompt chính là dòng hướng dẫn",
    "L4": "Listening: prompt lặp số thứ tự",
    "L5": "Listening: matching mất câu hỏi gốc",
    "L6": "Listening: bản đồ thiếu lựa chọn",
    "R1": "Reading: thiếu/sai giới hạn từ",
    "E1": "KHÔNG TRẢ LỜI ĐƯỢC: câu không có đề bài",
    "E2": "KHÔNG TRẢ LỜI ĐƯỢC: câu chọn-chữ-cái không có lựa chọn",
}


# ── nguồn ───────────────────────────────────────────────────────────────────
def source_limits(path: Path) -> dict[tuple[int, int], str]:
    """{(lo,hi): 'ONE WORD ONLY'} đọc từ file md nguồn."""
    if not path.exists():
        return {}
    txt = path.read_text(errors="ignore")
    heads = [(m.start(), int(m.group(1)), int(m.group(2)))
             for m in QHEAD_RE.finditer(txt)]
    out: dict[tuple[int, int], str] = {}
    for i, (pos, lo, hi) in enumerate(heads):
        end = heads[i + 1][0] if i + 1 < len(heads) else len(txt)
        head = "\n".join(txt[pos:end].splitlines()[:8])
        m = LIMIT_RE.search(head)
        if m:
            out[(lo, hi)] = m.group(1).upper()
    return out


def limit_for(qnum: int, table: dict[tuple[int, int], str]) -> str | None:
    for (lo, hi), v in table.items():
        if lo <= qnum <= hi:
            return v
    return None


# ── tiện ích ────────────────────────────────────────────────────────────────
def fetch(table: str, cols: str, **eq):
    q = supabase_admin.table(table).select(cols)
    for k, v in eq.items():
        q = q.eq(k, v)
    return q.execute().data or []


def template_has(tpl, qnum: int) -> bool:
    """Template có dòng riêng cho câu này không (prefix/suffix hoặc ô bảng)."""
    hit = False

    def walk(n):
        nonlocal hit
        if hit:
            return
        if isinstance(n, dict):
            if n.get("q_num") == qnum:
                hit = True
                return
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(tpl)
    return hit


JUNK_RE = re.compile(r"_{3,}|^\d{1,3}$|\|\s*\d+\s*\.")


def junk_items(tpl) -> list[str]:
    bad: list[str] = []

    def walk(n):
        if isinstance(n, dict):
            t = n.get("text")
            if isinstance(t, str) and JUNK_RE.search(t.strip()):
                bad.append(t.strip()[:70])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(tpl)
    return bad


# ── soát ────────────────────────────────────────────────────────────────────
def audit(source_dir: Path | None, modes: set[str],
          lis_prefix: str, rdg_prefix: str) -> dict:
    report: dict[str, dict[str, list]] = {"listening": {}, "reading": {}}

    lis = sorted([r for r in fetch("listening_tests", "id,test_id")
                  if (r["test_id"] or "").startswith(lis_prefix)],
                 key=lambda r: r["test_id"])
    rdg = sorted([r for r in fetch("reading_tests", "id,test_id")
                  if (r["test_id"] or "").startswith(rdg_prefix)],
                 key=lambda r: r["test_id"])

    for t in lis:
        issues: list[dict] = []
        m = re.search(r"B(\d+)-T(\d)$", t["test_id"])
        limits = {}
        if source_dir and m:
            limits = source_limits(
                source_dir / f"cambridge_ielts_{m.group(1)}_test_{m.group(2)}_listening.md")

        content = fetch("listening_content", "id,section_num", test_id=t["id"])
        cids = [c["id"] for c in content]
        exs = (supabase_admin.table("listening_exercises")
               .select("id,content_id,order_num,payload")
               .in_("content_id", cids).execute().data or []) if cids else []

        for e in exs:
            p = e["payload"] or {}
            instr = p.get("instruction") or ""
            qs = p.get("questions") or []
            qn = sorted(q["q_num"] for q in qs if q.get("q_num"))
            if not qn:
                continue
            rng = f"{qn[0]}-{qn[-1]}"
            kind = p.get("template_kind")

            if "fidelity" in modes:
                if kind in TEMPLATE_KINDS and limits:
                    want = limit_for(qn[0], limits)
                    got = LIMIT_RE.search(instr)
                    got = got.group(1).upper() if got else None
                    if want and got and want != got:
                        issues.append({"class": "L1", "range": rng,
                                       "got": got, "want": want})
                j = junk_items(p.get("template"))
                if j:
                    issues.append({"class": "L2", "range": rng, "junk": j})
                same = [q["q_num"] for q in qs
                        if q.get("prompt") and instr
                        and q["prompt"].strip() == instr.strip()]
                if same:
                    issues.append({"class": "L3", "range": rng, "qs": same})
                dup = [q["q_num"] for q in qs
                       if isinstance(q.get("prompt"), str)
                       and re.match(rf"^\s*{q['q_num']}\b", q["prompt"])]
                if dup:
                    issues.append({"class": "L4", "range": rng, "qs": dup})
                if kind == "matching" and instr.startswith("Match each item"):
                    issues.append({"class": "L5", "range": rng})
                if kind == "plan_label":
                    mm = re.search(r"letter,?\s*A\s*[-–—]\s*([A-Z])", instr)
                    have = (p.get("metadata") or {}).get("letter_options") or []
                    if mm and have and (ord(mm.group(1)) - 64) != len(have):
                        issues.append({"class": "L6", "range": rng,
                                       "instr_upto": mm.group(1), "have": len(have)})

            if "answerable" in modes:
                for q in qs:
                    prompt = (q.get("prompt") or "").strip()
                    opts = q.get("options") or []
                    if not prompt and not (kind in TEMPLATE_KINDS
                                           and template_has(p.get("template"), q["q_num"])):
                        issues.append({"class": "E1", "q": q["q_num"], "kind": kind})
                    if kind in LETTER_KINDS and not opts \
                            and not (p.get("metadata") or {}).get("match_options"):
                        issues.append({"class": "E2", "q": q["q_num"], "kind": kind})

        report["listening"][t["test_id"]] = issues

    for t in rdg:
        issues = []
        m = re.search(r"B(\d+)-T(\d)$", t["test_id"])
        limits = {}
        if source_dir and m:
            limits = source_limits(
                source_dir / f"cambridge_ielts_{m.group(1)}_test_{m.group(2)}_reading.md")
        for pg in fetch("reading_passages", "id", test_id=t["id"]):
            # `prompt` PHẢI có trong projection: phép soát E1 đọc nó, và một cột
            # không fetch thì luôn là None ⇒ báo oan mọi câu là "không có đề bài".
            for q in fetch("reading_questions", "q_num,question_type,prompt,payload",
                           passage_id=pg["id"]):
                p = q.get("payload") or {}
                if "fidelity" in modes and limits \
                        and q["question_type"] in COMPLETION_RDG and not p.get("options"):
                    want = limit_for(q["q_num"], limits)
                    got = (p.get("word_limit") or "").upper() or None
                    if want and want != got:
                        issues.append({"class": "R1", "q": q["q_num"],
                                       "got": got, "want": want})
                if "answerable" in modes and not (q.get("prompt") or "").strip() \
                        and not (p.get("template") or {}).get("summary_text"):
                    issues.append({"class": "E1", "q": q["q_num"],
                                   "kind": q["question_type"]})
        report["reading"][t["test_id"]] = issues

    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["fidelity", "answerable", "both"],
                    default="both")
    ap.add_argument("--source-dir", type=Path, default=None,
                    help="Thư mục chứa file md nguồn. Thiếu ⇒ bỏ qua các phép "
                         "so-với-nguồn (L1/R1) và chỉ soát phần tự-kiểm-được.")
    ap.add_argument("--test-prefix", nargs=2, metavar=("LISTENING", "READING"),
                    default=[LIS_PREFIX, RDG_PREFIX])
    ap.add_argument("--json", type=Path, default=None, help="Ghi báo cáo đầy đủ.")
    args = ap.parse_args()

    modes = {"fidelity", "answerable"} if args.mode == "both" else {args.mode}
    if "fidelity" in modes and not args.source_dir:
        print("• Không có --source-dir: bỏ qua L1/R1 (các phép so với đề gốc).\n")

    report = audit(args.source_dir, modes, args.test_prefix[0], args.test_prefix[1])
    if args.json:
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=1))

    tally: Counter = Counter()
    for side in report.values():
        for issues in side.values():
            for i in issues:
                tally[i["class"]] += 1

    n_lis, n_rdg = len(report["listening"]), len(report["reading"])
    print(f"Đã soát {n_lis} đề Listening · {n_rdg} đề Reading\n")
    if not tally:
        print("SẠCH — không lỗi nào.")
        return 0

    print("=== SỐ CHỖ LỖI THEO LỚP ===")
    for k in sorted(tally):
        print(f"  {k}  {tally[k]:5d}   {CLASS_NAMES.get(k, k)}")
    print("\n=== CHI TIẾT ===")
    for side in ("listening", "reading"):
        for tid, issues in sorted(report[side].items()):
            for i in issues:
                extra = {k: v for k, v in i.items() if k != "class"}
                print(f"  {i['class']}  {tid}: {extra}")
    if args.json:
        print(f"\n→ báo cáo đầy đủ: {args.json}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
