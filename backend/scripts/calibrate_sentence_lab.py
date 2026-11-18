"""Chạy 20 ca hiệu chỉnh của gói "Kho luyện viết câu 45 buổi" qua bộ chấm thật.

    OPENAI_API_KEY=… python -m scripts.calibrate_sentence_lab --package <zip>

Chỉ GỌI MODEL, không đọc/ghi cơ sở dữ liệu. Mỗi ca là một lượt gọi riêng (các
ca dùng chung item_id). So `status`, mã lỗi kỳ vọng (ít nhất một mã), tổng điểm
khi gói có nêu, và việc coach không lộ lời giải (bộ kiểm đầu ra đã chặn sẵn).
Các tiêu chí `critical_checks` bằng lời in ra để người duyệt đọc cùng phản hồi.

Gói nên chạy lại mỗi khi đổi `SENTENCE_LAB_MODEL` hoặc prompt.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import zipfile
from pathlib import Path

from scripts import import_sentence_lab_course5 as imp
from services import sentence_lab_grader as g


def _private(path: Path, name: str) -> bytes:
    if path.is_dir():
        return (path / name).read_bytes()
    with zipfile.ZipFile(path) as zf:
        hits = [n for n in zf.namelist() if n == name or n.endswith("/" + name)]
        if len(hits) != 1:
            raise SystemExit(f"Không thấy {name} trong gói.")
        return zf.read(hits[0])


def _cases(path: Path) -> list[dict]:
    name = "private/calibration_cases.json"
    if path.is_dir():
        raw = (path / name).read_bytes()
    else:
        with zipfile.ZipFile(path) as zf:
            hits = [n for n in zf.namelist() if n == name or n.endswith("/" + name)]
            if len(hits) != 1:
                raise SystemExit(f"Không thấy {name} trong gói.")
            raw = zf.read(hits[0])
    return json.loads(raw)["cases"]


async def _run(package: Path) -> int:
    # Prompt chấm là nội dung private của gói, không nằm trong repo: lấy từ
    # SENTENCE_LAB_PROMPT nếu đã đặt, không thì đọc thẳng từ gói đang hiệu chỉnh.
    if not g.prompt_configured():
        g.settings.SENTENCE_LAB_PROMPT = _private(
            package, "private/ai_grader_prompt.md").decode("utf-8")
    plan = imp.build_plan(imp.read_package(package))
    rows = {r["qid"]: r for b in plan["banks"] for r in b["rows"]}
    failed = 0
    for case in _cases(package):
        row = rows[case["item_id"]]
        lab = row["segments"]["sentence_lab"]
        key = {**lab["key"], **(case.get("key_override") or {})}
        entry = {"qid": case["item_id"], "prompt": row["prompt"], "explain": "",
                 "item": lab["item"], "key": key, "response": case["response"],
                 "attempt": case.get("attempt"),
                 "previous_response": case.get("previous_response")}
        out, model = await g.grade([entry], mode=case["mode"])
        fb = out[0].get("feedback")
        problems = []
        if fb is None:
            problems.append("không có phản hồi hợp lệ")
        else:
            if fb["status"] != case["expected_status"]:
                problems.append(f"status={fb['status']} (cần {case['expected_status']})")
            want = set(case.get("expected_error_codes_any") or [])
            got = {e["code"] for e in fb.get("errors") or []}
            if want and not want & got:
                problems.append(f"mã lỗi {sorted(got)} (cần một trong {sorted(want)})")
            if "expected_total" in case and fb.get("total") != case["expected_total"]:
                problems.append(f"total={fb.get('total')} (cần {case['expected_total']})")
        failed += bool(problems)
        print(f"{'FAIL' if problems else 'ok  '} {case['case_id']} {case['item_id']} "
              f"{case['mode']}: {'; '.join(problems) or 'đạt'}  [{model}]")
        for check in case.get("critical_checks") or []:
            print(f"       · {check}")
        if fb is not None and problems:
            print("       ↳ " + json.dumps(fb, ensure_ascii=False)[:600])
    print(f"\n{failed} ca chưa đạt / {len(_cases(package))}.")
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--package", required=True)
    args = ap.parse_args(argv)
    return asyncio.run(_run(Path(args.package)))


if __name__ == "__main__":
    sys.exit(main())
