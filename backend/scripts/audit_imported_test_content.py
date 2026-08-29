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

# "AND/OR A NUMBER" và "OR A NUMBER" đều có thật (mẫu chuẩn trong
# test_listening_convert.py dùng "ONE WORD OR A NUMBER"), và OCR hay đọc dấu
# gạch chéo thành chữ I → "ANDIOR".
_NUM = r"(?:AND\s*[/I|]\s*OR|OR)\s+A\s+NUMBER"
# THỨ TỰ QUAN TRỌNG: dạng DÀI đứng trước. Và tuyệt đối KHÔNG cho "ONE WORD"
# đứng một mình thành đáp án — nếu cho, "ONE WORD ANDIOR A NUMBER" (OCR hỏng)
# sẽ khớp mẩu "ONE WORD" và báo lệch giả.
LIMIT_RE = re.compile(
    r"(ONE WORD ONLY"
    r"|ONE WORD\s+" + _NUM +
    r"|NO MORE THAN THREE WORDS\s+" + _NUM +
    r"|NO MORE THAN THREE WORDS"
    r"|NO MORE THAN TWO WORDS\s+" + _NUM +
    r"|NO MORE THAN TWO WORDS"
    # "Write ONE WORD for each answer." (không ONLY) là cách viết THẬT — kiểm
    # 700dpi ở Cambridge 17 Test 4 Part 1, và 10/10 đáp án đều một từ không số.
    # Đặt CUỐI + lookahead phủ định để nó không bao giờ cắn mẩu đầu của hai
    # dạng dài phía trên.
    r"|ONE WORD(?!\s+(?:ONLY|(?:AND\s*[/I|]\s*OR|OR)\s+A\s+NUMBER))"
    r")", re.I)
# Đầu mục khối câu hỏi. Bộ Cambridge KHÔNG đồng nhất — phải nuốt cả bốn dạng:
#   "### Questions 1-5"            (quyển 15-19)
#   "### Questions 19 and 20"      (quyển 20-21)
#   "## PART 1 Questions 1-10"     (quyển 17-21)
#   "## Section 1 Questions 1-10"  (quyển 13-14)
# Bản đầu chỉ nhận dạng thứ nhất nên 11 đề âm thầm không được đối chiếu gì cả —
# và vì `want` là None, mọi phép L1 của chúng đều "xanh" một cách vô nghĩa.
QHEAD_RE = re.compile(
    r"^#{0,3}\s*(?:(?:PART|Section)\s+\d+\s+)?Questions?\s+"
    r"(\d+)\s*(?:[-–—]|and)\s*(\d+)\s*$",
    re.M | re.I)


# Giới hạn từ đọc THẲNG từ PDF gốc, dùng khi file .md nguồn đánh rơi dòng đó.
#
# Đây KHÔNG phải danh sách miễn kiểm. Bản trước tôi tắt cảnh báo theo mã đề —
# nghĩa là một lần re-import làm hỏng chính khối ấy cũng sẽ im lặng luôn. Nay
# lưu thành KỲ VỌNG TƯỜNG MINH: khối vẫn bị đối chiếu như mọi khối khác, chỉ là
# chuẩn so sánh lấy từ PDF thay vì .md (Codex vòng 2).
# Khoá: (mã đề, câu đầu của khối) → giới hạn thật.
PDF_VERIFIED_LIMITS: dict[tuple[str, int], str] = {
    ("ILR-LIS-CAM-B20-T1", 31): "ONE WORD ONLY",   # PDF Cambridge 20 trang 10
    ("ILR-LIS-CAM-B20-T2", 31): "ONE WORD ONLY",   # trang 47
    ("ILR-LIS-CAM-B20-T3", 31): "ONE WORD ONLY",   # trang 86
    ("ILR-LIS-CAM-B20-T4", 31): "ONE WORD ONLY",   # trang 122
    ("ILR-LIS-CAM-B20-T1", 1): "ONE WORD AND/OR A NUMBER",   # trang 5
    ("ILR-LIS-CAM-B20-T2", 1): "ONE WORD AND/OR A NUMBER",   # trang 41
    ("ILR-LIS-CAM-B20-T3", 1): "ONE WORD AND/OR A NUMBER",   # trang 79
    ("ILR-LIS-CAM-B20-T4", 1): "ONE WORD AND/OR A NUMBER",   # trang 116
    # Cambridge 17 Test 4 — định vị trang bằng chính tiêu đề template trong DB
    # ("Easy Life Cleaning Services" / "Maple syrup") nên không nhầm đề.
    ("ILR-LIS-CAM-B17-T4", 1): "ONE WORD",        # trang 68, kiểm lại ở 700dpi
    ("ILR-LIS-CAM-B17-T4", 31): "ONE WORD ONLY",  # trang 73
}
# Đề mà .md nguồn không có dòng giới hạn nào NHƯNG mọi khối của nó đã có kỳ vọng
# trong PDF_VERIFIED_LIMITS ⇒ không cần kêu S1 ở mức file.
_PDF_COVERED_TESTS = {code for code, _ in PDF_VERIFIED_LIMITS}


# MỐC PHỦ SÓNG. 36 khối dưới đây là những chỗ file .md nguồn KHÔNG có giới hạn
# từ để đối chiếu, tính đến 02/08/2026 — đã rà tay và chấp nhận.
#
# Vì sao phải chốt danh sách thay vì "S2 luôn là cảnh báo mềm": một lần chỉnh
# parser hỏng mà VẪN đọc được một giới hạn trong mỗi file thì sẽ không kêu S1,
# hàng chục khối khác lặng lẽ rơi xuống S2, và lệnh mặc định vẫn exit 0. Khe hở
# MỚI phải là lỗi CỨNG; chỉ khe hở đã biết mới được mềm (Codex vòng 3).
#
# Khoá: (mã đề, khoảng câu của khối) cho Listening, (mã đề, "số câu") cho Reading.
KNOWN_SOURCE_GAPS: set[tuple[str, str]] = {
    ('ILR-LIS-CAM-B17-T1', '31-40'),
    ('ILR-LIS-CAM-B17-T2', '31-40'),
    ('ILR-LIS-CAM-B17-T3', '31-40'),
    ('ILR-LIS-CAM-B21-T2', '27-30'),
    ('ILR-RDG-CAM-B13-T1', '32'),
    ('ILR-RDG-CAM-B13-T1', '33'),
    ('ILR-RDG-CAM-B13-T1', '34'),
    ('ILR-RDG-CAM-B13-T1', '35'),
    ('ILR-RDG-CAM-B13-T1', '36'),
    ('ILR-RDG-CAM-B13-T1', '37'),
    ('ILR-RDG-CAM-B13-T2', '38'),
    ('ILR-RDG-CAM-B13-T2', '39'),
    ('ILR-RDG-CAM-B13-T2', '40'),
    ('ILR-RDG-CAM-B15-T3', '27'),
    ('ILR-RDG-CAM-B15-T3', '28'),
    ('ILR-RDG-CAM-B15-T3', '29'),
    ('ILR-RDG-CAM-B15-T3', '30'),
    ('ILR-RDG-CAM-B15-T3', '31'),
    ('ILR-RDG-CAM-B18-T3', '31'),
    ('ILR-RDG-CAM-B18-T3', '32'),
    ('ILR-RDG-CAM-B18-T3', '33'),
    ('ILR-RDG-CAM-B18-T3', '34'),
    ('ILR-RDG-CAM-B18-T3', '35'),
    ('ILR-RDG-CAM-B20-T1', '31'),
    ('ILR-RDG-CAM-B20-T1', '32'),
    ('ILR-RDG-CAM-B20-T1', '33'),
    ('ILR-RDG-CAM-B20-T1', '34'),
    ('ILR-RDG-CAM-B20-T1', '35'),
    ('ILR-RDG-CAM-B20-T2', '33'),
    ('ILR-RDG-CAM-B20-T2', '34'),
    ('ILR-RDG-CAM-B20-T2', '35'),
    ('ILR-RDG-CAM-B20-T2', '36'),
    ('ILR-RDG-CAM-B20-T2', '37'),
    ('ILR-RDG-CAM-B20-T3', '24'),
    ('ILR-RDG-CAM-B20-T3', '25'),
    ('ILR-RDG-CAM-B20-T3', '26'),
}


def _canon_limit(s: str) -> str:
    """Chuẩn hoá cụm giới hạn (gộp biến thể OCR 'ANDIOR' → 'AND/OR')."""
    s = re.sub(r"AND\s*[/I|]\s*OR", "AND/OR", s.upper())
    return re.sub(r"\s+", " ", s).strip()

# Dạng bắt học viên CHỌN CHỮ CÁI ⇒ phải có NGUỒN LỰA CHỌN. Mỗi dạng cất lựa
# chọn ở CHỖ KHÁC NHAU — tra thẳng trong listening-test-player.js chứ đừng đoán:
#   plan_label  → metadata.letter_options  (renderPlanLabel đọc meta trước)
#   mcq_multi   → metadata.match_options   (renderMultiSelect)
#   matching    → metadata.match_options / letter_options
#   mcq_*option → options của TỪNG câu
LETTER_KINDS = {"plan_label", "mcq_3option", "mcq_4option", "matching", "mcq_multi"}
# Dạng mà lựa chọn nằm ở TỪNG CÂU. Với các dạng còn lại, `question.options` là
# vô nghĩa — renderMultiSelect/renderMatching KHÔNG hề đọc nó — nên coi nó là
# bằng chứng "có lựa chọn" sẽ che mất khối đã mất bank (Codex vòng 2).
PER_QUESTION_OPTION_KINDS = {"mcq_3option", "mcq_4option"}
# Khối completion + short-answer đều mang giới hạn từ ⇒ đều phải đối chiếu L1.
LIMIT_KINDS = {"notes_completion", "table_completion", "form_completion",
               "sentence_completion", "summary_completion",
               "flow_chart", "flow_chart_completion", "short_answer"}
# Dạng điền chữ: đề bài có thể nằm trong template thay cho prompt.
# listening_convert.py phát ra CẢ "flow_chart" LẪN "flow_chart_completion" —
# thiếu tên thứ hai thì flow-chart hợp lệ bị báo oan E1.
TEMPLATE_KINDS = {"notes_completion", "table_completion", "form_completion",
                  "sentence_completion", "summary_completion",
                  "flow_chart", "flow_chart_completion"}
COMPLETION_RDG = {"notes_completion", "summary_completion", "table_completion",
                  "form_completion", "sentence_completion", "short_answer",
                  "flow_chart_completion", "diagram_label_completion"}
# Reading: các dạng LUÔN cần một bank lựa chọn trong payload.options.
# KHÔNG có trong danh sách này, và có lý do rõ ràng cho từng cái:
#   true_false_not_given / yes_no_not_given → lựa chọn cố định trong renderer
#   summary_completion                      → bản không-bank là chép từ bài đọc
#   matching_information                    → chữ cái là NHÃN ĐOẠN VĂN của chính
#       bài đọc (reading-exam.js §2A.6), lấy từ template.paragraph_labels và có
#       sẵn fallback A-H; đòi payload.options ở đây là báo oan 40+ câu lành.
READING_NEED_OPTIONS = {"mcq_single", "mcq_multi", "matching_headings",
                        "matching_features", "matching_sentence_endings"}

CLASS_NAMES = {
    "L1": "Listening: hướng dẫn sai giới hạn từ",
    "L2": "Listening: template lẫn rác (ô trống giả / số trang)",
    "L3": "Listening: prompt chính là dòng hướng dẫn",
    "L4": "Listening: prompt lặp số thứ tự",
    "L5": "Listening: matching mất câu hỏi gốc",
    "L6": "Listening: bản đồ thiếu lựa chọn",
    "L7": "Listening: prompt/option bị cắt hoặc tràn dòng",
    "L8": "Listening: option bank lệch đề gốc đã xác minh",
    "R1": "Reading: thiếu/sai giới hạn từ",
    "R2": "Reading: prompt/option bị cắt dòng",
    "R3": "Reading: prompt/option lệch đề gốc đã xác minh",
    "E1": "KHÔNG TRẢ LỜI ĐƯỢC: câu không có đề bài",
    "E2": "KHÔNG TRẢ LỜI ĐƯỢC: câu chọn-chữ-cái không có lựa chọn",
    "E3": "KHÔNG TRẢ LỜI ĐƯỢC: exercise không có câu hỏi hợp lệ",
    "E4": "KHÔNG TRẢ LỜI ĐƯỢC: bản đồ/sơ đồ không có hình",
    "E5": "KHÔNG ĐỦ CÂU: thiếu/trùng số câu so với 1-40",
    "S1": "KHÔNG SOÁT ĐƯỢC: thiếu file nguồn để đối chiếu",
    "S2": "KHÔNG SOÁT ĐƯỢC: khối này không có giới hạn từ trong nguồn",
    "S3": "KHÔNG SOÁT ĐƯỢC: không chọn được đề nào",
}

# Các bank đã đối chiếu tay trực tiếp với PDF Cambridge.  Giống
# PDF_VERIFIED_LIMITS, đây là kỳ vọng phải tiếp tục khớp sau re-import, không
# phải waiver.  Chỉ ghim những block từng bị parser làm lệch để giữ phạm vi
# detector hẹp và tránh false positive.
PDF_VERIFIED_CHOICE_BLOCKS = {
    ("ILR-LIS-CAM-B17-T4", 15): {
        "options": [
            ("A", "improving relationships and teamwork"),
            ("B", "offering incentives and financial benefits"),
            ("C", "providing career opportunities"),
        ],
    },
    ("ILR-LIS-CAM-B17-T4", 21): {
        "options": [
            ("A", "He should have felt more positive about them."),
            ("B", "The training was too challenging for him."),
            ("C", "He could have worked harder at them."),
            ("D", "His parents were disappointed in him."),
            ("E", "His fellow students admired him."),
        ],
    },
    ("ILR-RDG-CAM-B17-T4", 23): {
        "prompt": "Which TWO of the following statements does the writer make about literacy rates in Section B?",
        "options": [
            ("A", "Very little research has been done into the link between high literacy rates and improved earnings."),
            ("B", "Literacy rates in Germany between 1600 and 1900 were very good."),
            ("C", "There is strong evidence that high literacy rates in the modern world result in economic growth."),
            ("D", "England is a good example of how high literacy rates helped a country industrialise."),
            ("E", "Economic growth can help to improve literacy rates."),
        ],
    },
    ("ILR-RDG-CAM-B17-T4", 25): {
        "prompt": "Which TWO of the following statements does the writer make in Section F about guilds in German-speaking Central Europe between 1600 and 1900?",
    },
}


def has_choices(kind: str, payload: dict, question: dict) -> bool:
    """Câu này có nguồn lựa chọn để học viên bấm không?

    Mỗi dạng cất lựa chọn một chỗ; kiểm sai chỗ thì vừa bỏ lọt câu hỏng vừa
    đánh trượt câu lành. Tra thẳng listening-test-player.js, đừng suy đoán:

      mcq_3option/4option → options của TỪNG câu
      plan_label          → metadata.letter_options (nghĩa nằm trên hình)
      mcq_multi           → metadata.match_options (renderMultiSelect dựng
                            checkbox TỪ ĐÂY, không đọc options của câu)
      matching            → metadata.match_options BẮT BUỘC: letter_options chỉ
                            đổ chữ cái vào dropdown, còn phần chữ giải nghĩa
                            dựng riêng từ match_options — có chữ cái mà mất
                            bank thì học viên không biết A/B/C nghĩa là gì.
    """
    meta = payload.get("metadata") or {}
    if kind in PER_QUESTION_OPTION_KINDS:
        return _valid_options(question.get("options"))
    if kind == "plan_label":
        return (_valid_letters(meta.get("letter_options"))
                or _valid_options(question.get("options")))
    if kind in ("mcq_multi", "matching"):
        return _valid_options(meta.get("match_options"), need_text=True)
    return _valid_options(question.get("options"))


def _valid_options(opts, need_text: bool = False) -> bool:
    """Bank có DÙNG ĐƯỢC không, chứ không chỉ "có tồn tại".

    `[{}]` hay entry rỗng letter/text vẫn truthy nhưng renderMultiSelect dựng ra
    checkbox không nhãn còn renderMatching dựng bank trắng — vẫn là câu không
    trả lời được (Codex vòng 3).
    """
    if not isinstance(opts, list) or len(opts) < 2:
        return False
    letters = []
    for o in opts:
        if not isinstance(o, dict):
            return False
        letter = str(o.get("letter") or "").strip()
        if not letter:
            return False
        if need_text and not str(o.get("text") or "").strip():
            return False
        letters.append(letter.upper())
    return len(set(letters)) == len(letters)


def _valid_letters(letters) -> bool:
    if not isinstance(letters, list) or len(letters) < 2:
        return False
    vals = [str(x or "").strip().upper() for x in letters]
    return all(vals) and len(set(vals)) == len(vals)


def has_visual(payload: dict) -> bool:
    """Khối gắn nhãn bản đồ/sơ đồ có hình để nhìn không?

    Đủ prompt và đủ chữ cái vẫn vô nghĩa nếu không có hình: renderPlanLabel sẽ
    hiện thông báo "thiếu bản đồ" và học viên chẳng có vị trí nào để gắn nhãn.
    """
    return bool(payload.get("map_image_storage_path")
                or payload.get("map_svg")
                or payload.get("map_image_url"))


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
            out[(lo, hi)] = _canon_limit(m.group(1))
    return out


def limit_for(qnum: int, table: dict[tuple[int, int], str]) -> str | None:
    """Giới hạn của khối HẸP NHẤT chứa câu này.

    Đầu mục lồng nhau: "## PART 1 Questions 1-10" bọc ngoài "### Questions 1-5".
    Lấy khối hẹp nhất thì khối con luôn thắng khối cha, nên một đề có cả hai
    tầng vẫn ra đúng giới hạn của riêng từng khối.
    """
    best: tuple[int, str] | None = None
    for (lo, hi), v in table.items():
        if lo <= qnum <= hi:
            span = hi - lo
            if best is None or span < best[0]:
                best = (span, v)
    return best[1] if best else None


# ── tiện ích ────────────────────────────────────────────────────────────────
def fetch(table: str, cols: str, **eq):
    q = supabase_admin.table(table).select(cols)
    for k, v in eq.items():
        q = q.eq(k, v)
    return q.execute().data or []


# CÚ PHÁP TOKEN KHÁC NHAU giữa hai renderer — phải khớp ĐÚNG từng bên, dùng
# chung một mẫu "dễ dãi" là sai cả hai chiều (Codex vòng 3):
#   listening-test-player.js  /^\{\{Q(\d+)\}\}$/        → BẮT BUỘC chữ Q, KHÔNG
#                                                         cho khoảng trắng
#   reading-exam.js           /\{\{\s*(\d{1,3})\s*\}\}/ → CHỈ chữ số, cho khoảng
#                                                         trắng
def listening_token(qnum: int) -> re.Pattern:
    return re.compile(r"\{\{Q" + str(qnum) + r"\}\}")


def reading_token(qnum: int) -> re.Pattern:
    return re.compile(r"\{\{\s*" + str(qnum) + r"\s*\}\}")


def template_has(tpl, qnum: int, token: re.Pattern | None = None) -> bool:
    """Template có chỗ dành riêng cho câu này không?

    Hai hình dạng, phải nhận CẢ HAI:
      • ô có `q_num` (notes/table/form/flow-chart)
      • token khoảng trống trong chuỗi — summary_completion cất kiểu này trong
        `template.paragraph` và để prompt của từng câu rỗng.

    `token` mặc định là cú pháp của LISTENING; phía Reading phải truyền
    `reading_token(qnum)` vào.
    """
    token = token or listening_token(qnum)
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
        elif isinstance(n, str):
            if token.search(n):
                hit = True

    walk(tpl)
    return hit


JUNK_RE = re.compile(r"_{3,}|^\d{1,3}$|\|\s*\d+\s*\.|^[-–—.\s]{2,}$")
_DANGLING_END_RE = re.compile(
    # Keep this deliberately narrow: prepositions at the end are valid in
    # English MCQ stems/options ("what it was built with", "used to").
    # Coordinators/articles and bare OCR punctuation are much stronger signs
    # that a PDF line was cut before its continuation.
    r"(?:\b(?:and|or|a|an|the)|[-–—/])\s*$",
    re.I,
)


def junk_items(tpl) -> list[str]:
    bad: list[str] = []

    def walk(n):
        if isinstance(n, dict):
            for key in ("text", "prefix", "suffix", "summary_text", "paragraph"):
                t = n.get(key)
                if isinstance(t, str) and JUNK_RE.search(t.strip()):
                    bad.append(t.strip()[:70])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(tpl)
    return list(dict.fromkeys(bad))


def dangling_fragments(prompt: str | None, options) -> list[str]:
    """Conservative detector for PDF line-wrap damage.

    A prompt/option ending in a connector is almost never a complete IELTS
    statement.  Also catch an option that is literally the tail of its own
    prompt (Cam17 T4 Listening accidentally turned ``at school?`` into option
    A).  This detector complements exact PDF expectations below and remains
    useful for future imports that fail in the same way.
    """
    prompt = str(prompt or "").strip()
    bad: list[str] = []
    if not isinstance(options, list):
        return bad
    prompt_fold = re.sub(r"\s+", " ", prompt).casefold()
    option_has_dangling_end = False
    for option in options:
        if not isinstance(option, dict):
            continue
        text = str(option.get("text") or "").strip()
        if not text:
            continue
        if _DANGLING_END_RE.search(text):
            option_has_dangling_end = True
            bad.append(f"option {option.get('letter') or option.get('label')}: {text[:100]}")
        text_fold = re.sub(r"\s+", " ", text).casefold()
        if len(text_fold) >= 5 and prompt_fold.endswith(text_fold):
            bad.append(f"option {option.get('letter') or option.get('label')}: duplicated prompt tail")
    # Ending a stem with a preposition can be legitimate ("leave because of"
    # followed by three noun-phrase choices).  It becomes strong line-wrap
    # evidence only when at least one option is truncated too.
    if prompt and option_has_dangling_end and _DANGLING_END_RE.search(prompt):
        bad.insert(0, f"prompt: {prompt[:100]}")
    return bad


def verified_choice_mismatch(test_id: str, first_q: int, prompt: str | None,
                             options) -> dict | None:
    expected = PDF_VERIFIED_CHOICE_BLOCKS.get((test_id, first_q))
    if not expected:
        return None
    mismatch: dict[str, object] = {}
    if expected.get("prompt") and str(prompt or "").strip() != expected["prompt"]:
        mismatch["prompt"] = str(prompt or "").strip()
    if expected.get("options"):
        got = [
            (str(row.get("letter") or row.get("label") or "").strip(),
             str(row.get("text") or "").strip())
            for row in (options if isinstance(options, list) else [])
            if isinstance(row, dict)
        ]
        if got != expected["options"]:
            mismatch["options"] = got
    return mismatch or None


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
            src = source_dir / f"cambridge_ielts_{m.group(1)}_test_{m.group(2)}_listening.md"
            limits = source_limits(src)
            # Thiếu file nguồn KHÔNG được coi là "sạch": --source-dir gõ sai thì
            # mọi phép so-với-nguồn im lặng biến mất và lệnh vẫn in SẠCH, exit 0
            # — đúng cái kiểu "xanh mà rỗng" mà bộ soát này sinh ra để chặn.
            if not limits and t["test_id"] not in _PDF_COVERED_TESTS:
                issues.append({"class": "S1", "file": str(src),
                               "why": "không đọc được giới hạn từ nào"})

        seen_qnums: list[int] = []
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
                # Exercise không có câu nào đánh số ⇒ không hiện được, không lưu
                # được đáp án. Bản đầu `continue` lặng lẽ ở đây nên nó vô hình.
                if "answerable" in modes:
                    issues.append({"class": "E3", "exercise": e["id"],
                                   "kind": p.get("template_kind"),
                                   "n_questions": len(qs)})
                continue
            seen_qnums.extend(qn)
            rng = f"{qn[0]}-{qn[-1]}"
            kind = p.get("template_kind")

            if "fidelity" in modes:
                if kind in LIMIT_KINDS and source_dir:
                    # Kỳ vọng từ PDF thắng, rồi mới tới .md nguồn.
                    want = (PDF_VERIFIED_LIMITS.get((t["test_id"], qn[0]))
                            or limit_for(qn[0], limits))
                    got = LIMIT_RE.search(instr)
                    got = _canon_limit(got.group(1)) if got else None
                    if not want:
                        # Nguồn đọc được MỘT SỐ khối nhưng không có khối này ⇒
                        # trước đây lặng lẽ bỏ qua vì `want=None`. Đó đúng là
                        # cái lỗ đã giấu 27 lỗi, chỉ nhỏ hơn một cấp.
                        issues.append({"class": "S2", "range": rng, "kind": kind})
                    elif want != got:
                        # So NGAY KHI có `want`: `got=None` nghĩa là hướng dẫn
                        # mất hẳn cụm giới hạn — hỏng nặng hơn là ghi sai.
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
                shared_options = ((p.get("metadata") or {}).get("match_options")
                                  if kind in ("mcq_multi", "matching") else None)
                fragments = []
                for question in qs:
                    fragments.extend(dangling_fragments(
                        question.get("prompt"),
                        shared_options if shared_options is not None else question.get("options"),
                    ))
                if fragments:
                    issues.append({"class": "L7", "range": rng,
                                   "fragments": list(dict.fromkeys(fragments))})
                verified = verified_choice_mismatch(
                    t["test_id"], qn[0], qs[0].get("prompt") if qs else None,
                    shared_options if shared_options is not None else
                    (qs[0].get("options") if qs else None),
                )
                if verified:
                    issues.append({"class": "L8", "range": rng, **verified})

            if "answerable" in modes:
                for q in qs:
                    prompt = (q.get("prompt") or "").strip()
                    opts = q.get("options") or []
                    if not prompt and not (kind in TEMPLATE_KINDS
                                           and template_has(p.get("template"), q["q_num"])):
                        issues.append({"class": "E1", "q": q["q_num"], "kind": kind})
                    if kind in LETTER_KINDS and not has_choices(kind, p, q):
                        issues.append({"class": "E2", "q": q["q_num"], "kind": kind})
                if kind == "plan_label" and not has_visual(p):
                    issues.append({"class": "E4", "range": rng})

        if "answerable" in modes:
            # KHÔNG gác bằng `if seen_qnums`: một đề bị xoá sạch content/exercise
            # thì danh sách rỗng, E3 chẳng có gì để soi, và bộ soát báo xanh cho
            # một đề TRỐNG RỖNG (Codex vòng 3). Chạy phép đếm cả khi rỗng.
            # Đủ prompt, đủ lựa chọn vẫn chưa đủ: một exercise mất 1 trong 10 câu
            # thì `qn` vẫn khác rỗng nên câu bị rơi hoàn toàn vô hình. Đếm phủ
            # sóng ở mức ĐỀ mới thấy (Codex vòng 2).
            dup = sorted({x for x in seen_qnums if seen_qnums.count(x) > 1})
            missing = sorted(set(range(1, 41)) - set(seen_qnums))
            extra = sorted(set(seen_qnums) - set(range(1, 41)))
            if dup or missing or extra:
                issues.append({"class": "E5", "thieu": missing,
                               "trung": dup, "ngoai_pham_vi": extra})

        report["listening"][t["test_id"]] = issues

    for t in rdg:
        issues = []
        m = re.search(r"B(\d+)-T(\d)$", t["test_id"])
        limits = {}
        if source_dir and m:
            src = source_dir / f"cambridge_ielts_{m.group(1)}_test_{m.group(2)}_reading.md"
            limits = source_limits(src)
            if not limits:
                issues.append({"class": "S1", "file": str(src),
                               "why": "không đọc được giới hạn từ nào"})
        rdg_qnums: list[int] = []
        for pg in fetch("reading_passages", "id", test_id=t["id"]):
            # `prompt` PHẢI có trong projection: phép soát E1 đọc nó, và một cột
            # không fetch thì luôn là None ⇒ báo oan mọi câu là "không có đề bài".
            for q in fetch("reading_questions", "q_num,question_type,prompt,payload",
                           passage_id=pg["id"]):
                p = q.get("payload") or {}
                rdg_qnums.append(q["q_num"])
                if "fidelity" in modes and limits \
                        and q["question_type"] in COMPLETION_RDG and not p.get("options"):
                    want = limit_for(q["q_num"], limits)
                    got = _canon_limit(p["word_limit"]) if p.get("word_limit") else None
                    if not want:
                        issues.append({"class": "S2", "q": q["q_num"],
                                       "kind": q["question_type"]})
                    elif want != got:
                        issues.append({"class": "R1", "q": q["q_num"],
                                       "got": got, "want": want})
                if "fidelity" in modes:
                    fragments = dangling_fragments(q.get("prompt"), p.get("options"))
                    if fragments:
                        issues.append({"class": "R2", "q": q["q_num"],
                                       "fragments": fragments})
                    # Grouped legacy MCQ repeats the same prompt/options on the
                    # second row; checking each row is deliberate so a partial
                    # repair cannot look green.
                    first_q = 23 if q["q_num"] in (23, 24) else 25 if q["q_num"] in (25, 26) else q["q_num"]
                    verified = verified_choice_mismatch(
                        t["test_id"], first_q, q.get("prompt"), p.get("options"))
                    if verified:
                        issues.append({"class": "R3", "q": q["q_num"], **verified})
                    template_junk = junk_items(p.get("template"))
                    if template_junk:
                        issues.append({"class": "R2", "q": q["q_num"],
                                       "template_junk": template_junk})
                if "answerable" in modes:
                    summary = (p.get("template") or {}).get("summary_text") or ""
                    # Có summary_text CHƯA ĐỦ: _renderFlowingSummaryBlock chỉ
                    # dựng ô nhập cho câu nào CÓ token {{N}} của chính nó. Mất
                    # một token là câu đó không có gì để gõ, mà bản trước vẫn
                    # coi cả khối là lành (Codex vòng 2).
                    has_marker = bool(summary) and bool(
                        reading_token(q["q_num"]).search(summary))
                    if not (q.get("prompt") or "").strip() and not has_marker:
                        issues.append({"class": "E1", "q": q["q_num"],
                                       "kind": q["question_type"]})
                    # Bản đầu chỉ hỏi "có đề bài không" cho Reading, nên một câu
                    # mcq/matching có đề bài đầy đủ nhưng bank RỖNG vẫn lọt —
                    # đúng lớp lỗi đã làm 11 câu Listening không trả lời được.
                    if q["question_type"] in READING_NEED_OPTIONS \
                            and not (p.get("options") or []):
                        issues.append({"class": "E2", "q": q["q_num"],
                                       "kind": q["question_type"]})
        if "answerable" in modes:
            dup = sorted({x for x in rdg_qnums if rdg_qnums.count(x) > 1})
            missing = sorted(set(range(1, 41)) - set(rdg_qnums))
            extra = sorted(set(rdg_qnums) - set(range(1, 41)))
            if dup or missing or extra:
                issues.append({"class": "E5", "thieu": missing,
                               "trung": dup, "ngoai_pham_vi": extra})
        report["reading"][t["test_id"]] = issues

    # Không chọn được đề nào KHÔNG phải là "sạch" — gõ sai --test-prefix hoặc
    # trỏ nhầm database sẽ cho ra hai bảng rỗng và lệnh vẫn in SẠCH, exit 0.
    if not lis or not rdg:
        report.setdefault("_global", {})["__coverage__"] = [{
            "class": "S3",
            "listening": len(lis), "reading": len(rdg),
            "prefix": [lis_prefix, rdg_prefix],
        }]
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
    ap.add_argument("--strict", action="store_true",
                    help="Coi cả cảnh báo phủ sóng (S2) là lỗi ⇒ thoát 1.")
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

    # HAI loại kết quả, đừng trộn:
    #   LỖI      — nội dung thật sự hỏng (L*, R1, E*) ⇒ luôn thoát 1.
    #   PHỦ SÓNG — chỗ bộ soát KHÔNG kiểm được. S1/S3 nghĩa là gần như không
    #              kiểm gì ⇒ cũng thoát 1. S2 nghĩa là kiểm được phần lớn,
    #              riêng vài khối nguồn không có chuẩn để so ⇒ cảnh báo, chỉ
    #              thoát 1 khi --strict.
    #   Trộn chúng lại thì bộ soát đỏ vĩnh viễn, và một bộ soát đỏ vĩnh viễn
    #   sẽ bị ngó lơ — đúng cách ~1000 lỗi trước đây sống sót.
    defects = {k: v for k, v in tally.items() if not k.startswith("S")}
    hard_gaps = {k: v for k, v in tally.items() if k in ("S1", "S3")}

    # S2 chỉ được "mềm" khi nó nằm trong MỐC đã rà tay. Khe hở MỚI là lỗi cứng —
    # nếu không, một lần chỉnh parser hỏng có thể đẩy hàng chục khối xuống S2 mà
    # lệnh mặc định vẫn exit 0.
    new_gaps = []
    for side in ("listening", "reading"):
        for tid, issues in report.get(side, {}).items():
            for i in issues:
                if i["class"] != "S2":
                    continue
                key = (tid, str(i.get("range") if i.get("range") is not None else i.get("q")))
                if key not in KNOWN_SOURCE_GAPS:
                    new_gaps.append(key)
    soft_gaps = {k: v for k, v in tally.items() if k == "S2"}

    def _dump(pred):
        for side in ("listening", "reading", "_global"):
            for tid, issues in sorted(report.get(side, {}).items()):
                for i in issues:
                    if not pred(i["class"]):
                        continue
                    extra = {k: v for k, v in i.items() if k != "class"}
                    print(f"  {i['class']}  {tid}: {extra}")

    if defects or hard_gaps:
        print("=== LỖI ===")
        for k in sorted({**defects, **hard_gaps}):
            print(f"  {k}  {tally[k]:5d}   {CLASS_NAMES.get(k, k)}")
        print()
        _dump(lambda c: c in defects or c in hard_gaps)
    else:
        print("KHÔNG CÓ LỖI NỘI DUNG.")

    if soft_gaps:
        n = tally["S2"]
        print(f"\n=== CẢNH BÁO PHỦ SÓNG: {n} khối không đối chiếu được ===")
        print("  (file nguồn không có giới hạn từ cho khối này — CHƯA KIỂM,"
              " không phải ĐÃ ĐÚNG. Dùng --strict để coi đây là lỗi.)")
        _dump(lambda c: c == "S2")

    if args.json:
        print(f"\n→ báo cáo đầy đủ: {args.json}")
    if new_gaps:
        print(f"\n=== KHE HỞ MỚI ({len(new_gaps)}) — NGOÀI MỐC ĐÃ RÀ ===")
        print("  Không có trong KNOWN_SOURCE_GAPS ⇒ coi là LỖI. Hoặc parser vừa"
              " hỏng, hoặc nguồn vừa đổi; rà tay rồi mới thêm vào mốc.")
        for k in sorted(new_gaps):
            print(f"  S2* {k[0]}: {k[1]}")

    if defects or hard_gaps or new_gaps:
        return 1
    return 1 if (soft_gaps and args.strict) else 0


if __name__ == "__main__":
    raise SystemExit(main())
