#!/usr/bin/env python3
"""Nhập kết quả Speaking thi TRỰC TIẾP với giáo viên vào hồ sơ duyệt bài.

C2-FINAL-20260726: 13/14 học viên thi Speaking trực tiếp; kết quả nằm trong
13 file .docx (nhận xét đầy đủ) + 1 .xlsx (bảng band tổng hợp). Kỳ thi không
có speaking_topic_set nên nền tảng không biết gì về phần thi này — script đưa
nó vào đúng chỗ luồng duyệt đang đọc:

  · per_skill_notes.speaking = JSON có cấu trúc (intro, band 4 tiêu chí, số đo
    so với lớp, nhận xét từng tiêu chí + cách luyện) — trang TRF render khối
    riêng (mock-result.html renderSpeaking), console KHÔNG ghi đè trường này
    khi lưu band.
  · ai_draft.speaking = {band} — console điền sẵn ô Speaking (bandSkills()),
    giám khảo xác nhận rồi lưu; server chấp nhận band ngoài required
    (mock_review_workflow.save_final_bands, 2026-07-28).

Mỗi bài được ĐỐI CHIẾU band docx ↔ xlsx trước khi ghi — lệch là dừng cả lô.
Chữ ký "Giáo viên chấm: ..." bị bỏ. Transcript KHÔNG nhập (ASR còn lỗi; đưa
cho học viên là quyết định sản phẩm riêng).

    venv/bin/python -m scripts.import_speaking_results             # xem thử
    venv/bin/python -m scripts.import_speaking_results --commit    # ghi thật
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import supabase_admin  # noqa: E402

EXAM = "C2-FINAL-20260726"
DEFAULT_DIR = ("/Users/trantrongvinh/Library/CloudStorage/OneDrive-Personal"
               "/V/Test speaking/Ket qua cham")

# Tên trên hồ sơ chấm → tài khoản. Soi tay từng người qua bảng users
# (display_name + email) ngày 2026-07-28; hai biệt danh do anh Vinh xác nhận:
# Lucas = Mạnh Cường, nie Mun = Bảo Châu. Vỹ Kha (ce68932c) không thi Speaking.
NAME_TO_USER = {
    "01_Bao Chau":    "02edaf4d-0000",  # nie Mun
    "02_Hua Vy":      "3043d578-0000",
    "03_Khanh Duyen": "bd991524-0000",
    "04_Kim Phung":   "0a06b4a4-0000",
    "05_Manh Cuong":  "a46b949f-0000",  # Lucas
    "06_Nguyen Tra":  "158e3126-0000",
    "07_Nguyen Truc": "01f22256-0000",
    "08_Nhu Huynh":   "7afe922d-0000",
    "09_Phan Xuan":   "53e10a5b-0000",
    "10_Thy Anh":     "c24a0aed-0000",
    "11_Tran Truc":   "a1942b42-0000",
    "12_Trong Khiem": "2b48d51e-0000",
    "13_Vo Tien":     "fd6a50f8-0000",
}

_CRIT_LINES = [  # (khoá JSON, tiền tố dòng trong bảng band docx)
    ("fc",  "Fluency & Coherence"),
    ("lr",  "Lexical Resource"),
    ("gra", "Grammatical Range & Accuracy"),
    ("p",   "Pronunciation"),
]


def _docx_lines(p: Path) -> list[str]:
    with zipfile.ZipFile(p) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    text = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"</w:p>", "\n", xml)))
    return [l.strip() for l in text.split("\n") if l.strip()]


def parse_docx(p: Path) -> dict:
    L = _docx_lines(p)
    assert L[0] == "NHẬN XÉT BÀI THI SPEAKING", f"{p.name}: mở đầu lạ"
    name, meta_line = L[1], L[2]
    m = re.search(r"(Part .+?)\s+·\s+Bài thi dài\s+(\S+)", meta_line)
    meta = {"parts": m.group(1), "duration": m.group(2)} if m else {}
    intro = L[3]

    bands: dict = {}
    for key, prefix in _CRIT_LINES:
        i = next(i for i, l in enumerate(L) if l.startswith(prefix))
        bands[key] = float(L[i + 1])
    io = next(i for i, l in enumerate(L) if l == "ĐIỂM CHUNG")
    bands["overall"] = float(L[io + 1])

    ih = next(i for i, l in enumerate(L) if l.startswith("Đo trên bài thi"))
    # sau tiêu đề là 2 nhãn cột rồi 6 bộ ba (label, của em, trung bình lớp)
    mrows, j = [], ih + 3
    while not L[j].startswith("Các con số trên"):
        mrows.append({"label": L[j], "value": L[j + 1], "class_avg": L[j + 2]})
        j += 3
    assert len(mrows) == 6, f"{p.name}: {len(mrows)} số đo (chờ 6)"

    sec_idx = [i for i, l in enumerate(L)
               if re.match(r"^\d\.\s\S", l) and "·" in l]
    assert len(sec_idx) == 4, f"{p.name}: {len(sec_idx)} mục tiêu chí (chờ 4)"
    ip = next(i for i, l in enumerate(L) if l.startswith("Ba việc cần làm"))
    sections = []
    for k, start in enumerate(sec_idx):
        end = sec_idx[k + 1] if k + 1 < 4 else ip
        title = L[start]
        body_lines, advice = [], None
        for l in L[start + 1:end]:
            if l.startswith("Cách luyện:"):
                advice = l[len("Cách luyện:"):].strip()
            else:
                body_lines.append(l)
        sections.append({"title": title, "body": "\n".join(body_lines),
                         "advice": advice})
    # danh sách ưu tiên + lời nhắn cuối (bỏ dòng chữ ký)
    tail = [l for l in L[ip + 1:] if not l.startswith("Giáo viên chấm")]
    prio = [l for l in tail if re.match(r"^\d\.\s", l)]
    outro = [l for l in tail if not re.match(r"^\d\.\s", l)]
    sections.append({"title": L[ip], "body": "\n".join(prio), "advice": None})
    if outro:
        sections.append({"title": "Lời nhắn của giáo viên",
                         "body": "\n".join(outro), "advice": None})
    return {"name": name, "meta": meta, "intro": intro, "bands": bands,
            "metrics": mrows, "sections": sections}


def parse_xlsx(p: Path) -> dict[str, dict]:
    """Tên → band 4 tiêu chí + overall, đọc thẳng từ xml của xlsx."""
    with zipfile.ZipFile(p) as z:
        shared = z.read("xl/sharedStrings.xml").decode("utf-8")
        strings = re.findall(r"<t[^>]*>([^<]*)</t>", shared)
        sheet = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
    out = {}
    for _rn, rxml in re.findall(r'<row[^>]*r="(\d+)"[^>]*>(.*?)</row>', sheet, re.S):
        cells = []
        for cx in re.findall(r"(<c[^>]*>.*?</c>|<c[^>]*/>)", rxml, re.S):
            t = re.search(r't="(\w+)"', cx)
            v = re.search(r"<v>([^<]*)</v>", cx)
            if v is None:
                cells.append("")
            else:
                cells.append(html.unescape(strings[int(v.group(1))])
                             if t and t.group(1) == "s" else v.group(1))
        if len(cells) >= 7 and re.match(r"^\d+$", str(cells[0] or "")):
            out[cells[1]] = {"fc": float(cells[2]), "lr": float(cells[3]),
                             "gra": float(cells[4]), "p": float(cells[5]),
                             "overall": float(cells[6])}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=DEFAULT_DIR)
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()
    base = Path(args.dir)

    xlsx = parse_xlsx(base / "00_Bang_tong_hop_lop.xlsx")
    parsed = []
    for stem, uid_prefix in NAME_TO_USER.items():
        d = parse_docx(base / f"{stem}.docx")
        ref = xlsx.get(d["name"])
        assert ref, f"{stem}: tên {d['name']!r} không có trong xlsx"
        for k in ("fc", "lr", "gra", "p", "overall"):
            assert d["bands"][k] == ref[k], (
                f"{stem}: band {k} lệch docx={d['bands'][k]} xlsx={ref[k]}")
        parsed.append((stem, uid_prefix.split("-")[0], d))
    print(f"phân tích {len(parsed)}/13 · band docx ↔ xlsx khớp toàn bộ\n")

    ex = supabase_admin.table("mock_exams").select("id").eq("code", EXAM).execute()
    sit = (supabase_admin.table("mock_exam_sittings").select("id,user_id")
           .eq("mock_exam_id", ex.data[0]["id"]).execute().data or [])
    by_user = {x["user_id"][:8]: x["id"] for x in sit}

    plan = []
    for stem, u8, d in parsed:
        sid = by_user.get(u8)
        assert sid, f"{stem}: không có lượt thi cho user {u8}"
        rev = (supabase_admin.table("mock_exam_reviews")
               .select("id,status,ai_draft,per_skill_notes")
               .eq("sitting_id", sid).limit(1).execute()).data
        assert rev, f"{stem}: chưa có review cho sitting {sid[:8]}"
        r = rev[0]
        assert r["status"] != "released", (
            f"{stem}: review ĐÃ CÔNG BỐ — không ghi đè sau công bố")
        plan.append((stem, u8, d, r))
        print(f"  {d['name']:14} → user {u8} · review {r['id'][:8]} "
              f"[{r['status']}] · overall {d['bands']['overall']}")

    if not args.commit:
        print("\n(chỉ xem thử — thêm --commit để ghi)")
        return 0

    for stem, u8, d, r in plan:
        notes = dict(r.get("per_skill_notes") or {})
        notes["speaking"] = {k: d[k] for k in
                             ("meta", "intro", "bands", "metrics", "sections")}
        draft = dict(r.get("ai_draft") or {})
        draft["speaking"] = {"band": d["bands"]["overall"]}
        (supabase_admin.table("mock_exam_reviews")
         .update({"per_skill_notes": notes, "ai_draft": draft})
         .eq("id", r["id"]).execute())
        print(f"đã ghi {d['name']} ({u8})")
    print(f"\nxong: {len(plan)} học viên.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
