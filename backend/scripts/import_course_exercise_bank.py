"""Nạp một buổi bài tập của giáo trình (JSONL) vào kho quiz.

    python -m scripts.import_course_exercise_bank --file <KBT-buoi-01.jsonl> --course C1
    python -m scripts.import_course_exercise_bank --file <...> --course C1 --commit

MẶC ĐỊNH LÀ THỬ KHÔ. Ghi thật phải nêu `--commit`.

VÌ SAO KHÔNG DÙNG `services/quiz_import.py`. Bộ nhập sẵn có được viết cho kho TỪ
VỰNG: nó đòi `topic_id`, gom câu theo "pool" của từng từ, tra audio theo
`vocab_cards`, và tính điều kiện "thuộc" theo số kỹ năng đã qua. Một buổi bài tập
ngữ pháp 100 câu không có từ nào để gom, và học viên làm nó TUẦN TỰ chứ không lặp
tới khi thuộc. Nhét nó qua đường ấy nghĩa là bịa ra một `topic_id` giả và tắt một
nửa số trường.

DÙNG CHUNG chỗ quan trọng: cùng bảng `quiz_banks`/`quiz_questions`, và cùng RPC
`quiz_replace_questions` — nên mọi thứ đã dựng quanh chúng (sổ lượt làm, thống kê
admin, màn xem lại bài) chạy được ngay mà không phải sửa gì.

BẢN ĐỒ TRƯỜNG
    id           → qid            "B01-A1-01"
    dang         → subtype        A1…E3, 14 dạng trong 5 họ
    truc         → item_key       trục kiến thức — chỗ gom "em này sai ở đâu"
    truc_nhom    → skill          nhóm trục
    de           → prompt
    pa           → options
    dap_an       → answer         chỉ số 0-based
    giai_thich   → explain        vì sao ĐÁP ÁN ĐÚNG là đúng
    bay          → why_wrong      vì sao TỪNG NHIỄU sai (mig 186)
    muc          → points         1-3, cũng là độ khó

HỌ E KHÔNG CHẤM TỰ ĐỘNG. Mười câu cuối mỗi buổi là tự luận — viết lại câu, gộp
câu, sửa lỗi kèm lý do. Nguồn có `dap_an_mau`, `bien_the_chap_nhan` và `tieu_chi`
("Thiếu be ⟹ 0 điểm"), tức là chính người soạn coi đây là việc CẦN NGƯỜI CHẤM.

Chấm chúng bằng so chuỗi sẽ đánh trượt mọi cách diễn đạt đúng khác — đúng lỗi đã
mắc ở kho drill trước đây. Nên chúng vào kho ở dạng TỰ ĐỐI CHIẾU: học viên viết,
rồi trang hiện đáp án mẫu + biến thể + tiêu chí để tự chấm, và câu ấy KHÔNG tính
vào tỷ lệ đúng.
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

from config import settings
from database import supabase_admin
from services import quiz_why_wrong

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("import-course-bank")

# Bốn phương án là hợp đồng của kho này (SPEC mục B). Một câu 3 hoặc 5 phương án
# là dấu hiệu tệp hỏng, không phải một biến thể hợp lệ.
_OPTIONS = 4

# Họ E — tự luận, không chấm máy. Xem docstring.
_ESSAY = ("E1", "E2", "E3")

# Mười bốn dạng của SPEC, không hơn. Một mã lạ (gõ nhầm "A9") sẽ lọt vào kho, và
# trang học viên hiện một thẻ dạng TRỐNG — không có gì đỏ để lần ra.
_DANG = ("A1", "A2", "A3", "B1", "B2", "B3",
         "C1", "C2", "C3", "C4", "D1", "D2", "D3", "D4") + _ESSAY

_SKILL_AREA = "course"

_READING_KIND = "reading"
_LISTENING_KIND = "listening"
_AUDIO_BUCKET = settings.LISTENING_AUDIO_BUCKET
_MP3_MAGIC = (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")


def _lesson_no(path: Path, override: int | None) -> int:
    if override:
        return override
    m = re.search(r"buoi[-_]?(\d+)", path.stem, re.I)
    if not m:
        raise SystemExit(
            f"Không đoán được số buổi từ tên tệp {path.name!r}. Nêu --lesson.")
    return int(m.group(1))


def _course(code: str) -> dict:
    rows = (supabase_admin.table("courses").select("id, code, name")
            .eq("code", code).limit(1).execute().data) or []
    if not rows:
        raise SystemExit(f"Không có khoá nào mã {code!r}.")
    return rows[0]


def _mcq_row(r: dict, order: int) -> dict:
    """Một câu trắc nghiệm. Kiểm ĐỦ trước khi ghi — xem `_normalise`."""
    pa = r["pa"]
    bay = r.get("bay") or []
    # `bay` xếp SONG SONG với `pa`, và ô của đáp án đúng để rỗng. `why_wrong` chỉ
    # gồm phương án SAI, khoá là chỉ số dạng CHUỖI (JSON không có khoá số).
    why = {str(i): (bay[i] or "").strip()
           for i in range(len(pa)) if i != r["dap_an"] and i < len(bay)}
    return {
        "qid":       r["id"],
        "item_key":  (r.get("truc") or r.get("diem_day") or "").strip() or None,
        "type":      "mcq",
        "subtype":   r["dang"],
        "input":     "choice",
        "skill":     r.get("truc_nhom") or r["dang"][0],
        "pair":      r.get("chieu"),
        "counts_toward_mastery": True,
        "prompt":    r["de"],
        "hint":      None,
        "options":   pa,
        "answer":    r["dap_an"],
        "accept":    None,
        "segments":  None,
        "mask":      None,
        "pairs":     None,
        "explain":   r.get("giai_thich"),
        "why_wrong": why or None,
        "points":    int(r.get("muc") or 1),
        "audio_url": None,
        "grammar_article_slug": None,
        "order":     order,
    }


def _essay_row(r: dict, order: int) -> dict:
    """Một câu tự luận — TỰ ĐỐI CHIẾU, không chấm máy.

    `accept` để RỖNG có chủ đích: bộ chấm phía trình duyệt so chuỗi, nên đưa đáp
    án mẫu vào đó sẽ đánh trượt mọi cách diễn đạt đúng khác. Đáp án mẫu, biến thể
    và tiêu chí đi vào `explain` — thứ chỉ hiện SAU khi học viên đã viết xong.
    """
    parts = [f"**Đáp án mẫu:** {r['dap_an_mau']}"]
    variants = r.get("bien_the_chap_nhan") or []
    if variants:
        parts.append("**Cũng được chấp nhận:** " + " · ".join(variants))
    if r.get("tieu_chi"):
        parts.append(f"**Chấm thế nào:** {r['tieu_chi']}")
    if r.get("giai_thich"):
        parts.append(r["giai_thich"])
    return {
        "qid":       r["id"],
        "item_key":  (r.get("diem_day") or "").strip() or None,
        "type":      "writing",
        "subtype":   r["dang"],
        "input":     "text",
        "skill":     "TU-LUAN",
        "pair":      None,
        # KHÔNG tính vào tỷ lệ đúng: máy không chấm được thì một con số "đúng/sai"
        # ở đây là con số bịa.
        "counts_toward_mastery": False,
        "prompt":    r["de"],
        "hint":      None,
        "options":   None,
        "answer":    None,
        "accept":    None,
        "segments":  None,
        "mask":      None,
        "pairs":     None,
        "explain":   "\n\n".join(parts),
        "why_wrong": None,
        "points":    int(r.get("muc") or 1),
        "audio_url": None,
        "grammar_article_slug": None,
        "order":     order,
    }


def _required_text(value, label: str, reading_id: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise SystemExit(f"[{reading_id}] bài đọc thiếu {label}.")
    return text


def _reading_prompt(value, input_type: str, number: int, reading_id: str) -> str:
    prompt = _required_text(value, f"đề câu {number}", reading_id)
    # Nguồn in giấy mang sẵn ô “→ T / F / NG” và “→ …”. Giao diện web dựng
    # radio/input thật, nên giữ đuôi ấy sẽ hiện hai lần cùng một điều khiển.
    if input_type == "tfng":
        prompt = re.sub(r"\s*→\s*T\s*/\s*F\s*/\s*NG\s*$", "", prompt,
                        flags=re.IGNORECASE)
    else:
        prompt = re.sub(r"\s*→\s*…+\s*$", "", prompt)
    return prompt.strip()


def _reading_meta(r: dict) -> dict:
    """Chuẩn hoá bài đọc thêm ở cấp BANK, không trộn vào 100 câu chấm điểm.

    Bản dịch và đáp án vẫn được lưu cùng nguồn canonical, nhưng đường phát đề
    cho học viên sẽ lọc chúng ra. Chỉ endpoint đối chiếu mới trả hai phần ấy.
    """
    reading_id = (r.get("id") or "").strip()
    if not reading_id:
        raise SystemExit("Bài đọc không có id.")
    passage = _required_text(r.get("bai_doc"), "nội dung", reading_id)
    translation = _required_text(r.get("ban_dich"), "bản dịch", reading_id)

    vocabulary = r.get("tu_vung")
    if not isinstance(vocabulary, list) or not vocabulary:
        raise SystemExit(f"[{reading_id}] bài đọc không có danh sách từ vựng.")
    vocab_rows = []
    for i, item in enumerate(vocabulary, 1):
        if not isinstance(item, dict):
            raise SystemExit(f"[{reading_id}] từ vựng thứ {i} không hợp lệ.")
        vocab_rows.append({
            "term": _required_text(item.get("tu"), f"từ vựng thứ {i}", reading_id),
            "part_of_speech": _required_text(
                item.get("loai"), f"loại từ của từ vựng thứ {i}", reading_id),
            "meaning": _required_text(
                item.get("nghia"), f"nghĩa của từ vựng thứ {i}", reading_id),
        })

    question_source = r.get("cau_hoi") or {}
    answer_source = r.get("dap_an") or {}
    group_specs = (
        ("content", "Đọc hiểu", "tfng", "phan1_noi_dung"),
        ("structure", "Soi cấu trúc câu", "short_text", "phan2_cau_truc"),
    )
    groups, answers = [], []
    next_number = 1
    for group_id, title, input_type, source_key in group_specs:
        prompts = question_source.get(source_key)
        keys = answer_source.get(source_key)
        if not isinstance(prompts, list) or not prompts:
            raise SystemExit(f"[{reading_id}] thiếu nhóm câu hỏi {title!r}.")
        if not isinstance(keys, list) or len(keys) != len(prompts):
            raise SystemExit(
                f"[{reading_id}] nhóm {title!r} có {len(prompts)} câu nhưng "
                f"{len(keys) if isinstance(keys, list) else 0} đáp án.")
        questions = []
        for offset, prompt in enumerate(prompts):
            number = next_number + offset
            key = keys[offset]
            if not isinstance(key, dict) or key.get("cau") != number:
                raise SystemExit(
                    f"[{reading_id}] đáp án câu {number} sai số thứ tự.")
            questions.append({
                "id": f"{reading_id}-{number:02d}",
                "number": number,
                "prompt": _reading_prompt(prompt, input_type, number, reading_id),
            })
            answers.append({
                "id": f"{reading_id}-{number:02d}",
                "number": number,
                "answer": _required_text(
                    key.get("dap_an"), f"đáp án câu {number}", reading_id),
                "explanation": _required_text(
                    key.get("giai_thich"), f"giải thích câu {number}", reading_id),
            })
        groups.append({
            "id": group_id,
            "title": title,
            "input_type": input_type,
            "questions": questions,
        })
        next_number += len(prompts)

    declared_words = r.get("so_tu")
    actual_words = len(passage.split())
    if declared_words != actual_words:
        raise SystemExit(
            f"[{reading_id}] ghi {declared_words!r} từ nhưng đếm được {actual_words}.")

    return {
        "id": reading_id,
        "role": _required_text(r.get("vai_tro"), "vai trò", reading_id),
        "title": _required_text(r.get("chu_de"), "chủ đề", reading_id),
        "focus": _required_text(r.get("cau_truc_trong_tam"), "trọng tâm", reading_id),
        "word_count": actual_words,
        "passage": passage,
        "vocabulary": vocab_rows,
        "question_groups": groups,
        "translation": translation,
        "answers": answers,
    }


def _choice_answer(value, options: list, label: str, listening_id: str) -> str:
    answer = _required_text(value, f"đáp án {label}", listening_id).upper()
    if len(answer) != 1:
        raise SystemExit(f"[{listening_id}] đáp án {label} không khớp lựa chọn: {answer!r}.")
    index = ord(answer) - ord("A")
    if not 0 <= index < len(options):
        raise SystemExit(f"[{listening_id}] đáp án {label} không khớp lựa chọn: {answer!r}.")
    return answer


def _listening_meta(r: dict) -> dict:
    """Chuẩn hoá phần nghe cấp bank; đáp án/transcript được giữ riêng để lọc."""
    listening_id = (r.get("id") or "").strip()
    if not listening_id:
        raise SystemExit("Bài nghe không có id.")

    specs = (
        ("sound", "A", "Nhận diện âm", r.get("phan_A_am")),
        ("spelling", "B", "Nghe chữ và từ", r.get("phan_B_chu")),
        ("sentence", "C", "Nghe câu và chọn phản hồi", r.get("phan_C_cau")),
    )
    sections, answers, audio_files = [], [], []
    for section_id, label, title, source in specs:
        if not isinstance(source, list) or not source:
            raise SystemExit(f"[{listening_id}] thiếu phần nghe {label}.")
        questions = []
        for position, item in enumerate(source, 1):
            if not isinstance(item, dict) or item.get("so") != position:
                raise SystemExit(f"[{listening_id}] phần {label} sai số thứ tự câu {position}.")
            options = item.get("lua_chon")
            if not isinstance(options, list) or len(options) < 2 or any(
                    not str(option or "").strip() for option in options):
                raise SystemExit(f"[{listening_id}] phần {label} câu {position} thiếu lựa chọn.")
            audio = _required_text(item.get("audio"), f"audio {label}{position}", listening_id)
            if Path(audio).name != audio or not audio.lower().endswith(".mp3"):
                raise SystemExit(f"[{listening_id}] tên audio không an toàn: {audio!r}.")
            qid = f"{listening_id}-{label}{position}"
            questions.append({
                "id": qid, "number": position, "audio_file": audio,
                "options": [str(option).strip() for option in options],
            })
            answers.append({
                "id": qid,
                "answer": _choice_answer(item.get("dap_an"), options,
                                           f"{label}{position}", listening_id),
                "transcript": _required_text(
                    item.get("nghe_duoc"), f"transcript {label}{position}", listening_id),
            })
            audio_files.append(audio)
        sections.append({
            "id": section_id, "label": label, "title": title,
            "mode": "question_audio", "questions": questions,
        })

    talk = r.get("phan_D_noi_dung")
    if not isinstance(talk, dict):
        raise SystemExit(f"[{listening_id}] thiếu phần nghe D.")
    talk_audio = _required_text(talk.get("audio"), "audio phần D", listening_id)
    if Path(talk_audio).name != talk_audio or not talk_audio.lower().endswith(".mp3"):
        raise SystemExit(f"[{listening_id}] tên audio không an toàn: {talk_audio!r}.")
    talk_questions = talk.get("cau_hoi")
    if not isinstance(talk_questions, list) or not talk_questions:
        raise SystemExit(f"[{listening_id}] phần D không có câu hỏi.")
    questions = []
    for position, item in enumerate(talk_questions, 1):
        if not isinstance(item, dict) or item.get("so") != position:
            raise SystemExit(f"[{listening_id}] phần D sai số thứ tự câu {position}.")
        qid = f"{listening_id}-D{position}"
        questions.append({
            "id": qid, "number": position,
            "prompt": _required_text(item.get("prompt"), f"đề D{position}", listening_id),
            "options": ["T", "F", "NG"],
        })
        answer = _required_text(item.get("dap_an"), f"đáp án D{position}", listening_id).upper()
        if answer not in ("T", "F", "NG"):
            raise SystemExit(f"[{listening_id}] đáp án D{position} phải là T/F/NG.")
        answers.append({"id": qid, "answer": answer})
    sections.append({
        "id": "content", "label": "D", "title": "Nghe hiểu nội dung",
        "mode": "section_audio", "audio_file": talk_audio, "questions": questions,
    })
    audio_files.append(talk_audio)
    if len(set(audio_files)) != len(audio_files):
        raise SystemExit(f"[{listening_id}] có tên file audio bị dùng trùng.")

    return {
        "id": listening_id,
        "role": _required_text(r.get("vai_tro"), "vai trò", listening_id),
        "title": _required_text(r.get("chu_de"), "chủ đề", listening_id),
        "focus": _required_text(r.get("cau_truc_trong_tam"), "trọng tâm", listening_id),
        "language": _required_text(r.get("lang"), "ngôn ngữ", listening_id),
        "audio_zip": _required_text(r.get("audio_zip"), "tên gói audio", listening_id),
        "sections": sections,
        "solution": {
            "answers": answers,
            "talk_transcript": _required_text(talk.get("doan_noi"), "transcript phần D", listening_id),
            "talk_translation": _required_text(talk.get("ban_dich"), "bản dịch phần D", listening_id),
        },
    }


def _normalise(rows: list[dict]) -> tuple[list[dict], dict | None, dict | None]:
    """Kiểm TOÀN BỘ tệp trước khi ghi dòng đầu tiên.

    RPC `quiz_replace_questions` xoá sạch câu cũ rồi ghi lại — nên một tệp hỏng
    nửa chừng không để lại bank thiếu câu (giao dịch cuộn lại), nhưng nó vẫn tốn
    một lượt chạy và một thông báo lỗi từ Postgres thay vì một câu tiếng Việt nói
    rõ dòng nào hỏng.
    """
    out, seen = [], set()
    reading = None
    listening = None
    for i, r in enumerate(rows, 1):
        if r.get("kind") == _READING_KIND:
            if reading is not None:
                raise SystemExit("Mỗi buổi chỉ nhận một bài đọc thêm.")
            reading = _reading_meta(r)
            continue
        if r.get("kind") == _LISTENING_KIND:
            if listening is not None:
                raise SystemExit("Mỗi buổi chỉ nhận một bài nghe thêm.")
            listening = _listening_meta(r)
            continue
        qid = (r.get("id") or "").strip()
        if not qid:
            raise SystemExit(f"Câu thứ {i} không có id.")
        if qid in seen:
            raise SystemExit(f"id {qid!r} xuất hiện hai lần.")
        seen.add(qid)
        if not (r.get("de") or "").strip():
            raise SystemExit(f"[{qid}] không có đề.")
        dang = (r.get("dang") or "").strip()
        if dang not in _DANG:
            raise SystemExit(
                f"[{qid}] mã dạng không hợp lệ: {dang!r} "
                f"(chỉ nhận {', '.join(_DANG)}).")

        if dang in _ESSAY:
            if not (r.get("dap_an_mau") or "").strip():
                raise SystemExit(f"[{qid}] câu tự luận không có đáp án mẫu.")
            out.append(_essay_row(r, i - 1))
            continue

        pa = r.get("pa")
        if not isinstance(pa, list) or len(pa) != _OPTIONS:
            raise SystemExit(
                f"[{qid}] cần đúng {_OPTIONS} phương án, tệp có "
                f"{len(pa) if isinstance(pa, list) else 'không có'}.")
        ans = r.get("dap_an")
        if not isinstance(ans, int) or isinstance(ans, bool) or not (0 <= ans < len(pa)):
            raise SystemExit(f"[{qid}] đáp án không hợp lệ: {ans!r}.")
        if len(set(pa)) != len(pa):
            raise SystemExit(f"[{qid}] có hai phương án trùng nhau.")
        if not (r.get("giai_thich") or "").strip():
            raise SystemExit(f"[{qid}] không có giải thích.")

        row = _mcq_row(r, i - 1)
        # Kiểm bằng CHÍNH bộ kiểm của tính năng (services/quiz_why_wrong.py), ở
        # chế độ BẮT BUỘC: kho này có dữ liệu cho mọi nhiễu, nên thiếu một ô là
        # tệp hỏng chứ không phải "tuỳ chọn không điền".
        errs = quiz_why_wrong.validate_why_wrong(
            {**row, "why_wrong": row["why_wrong"]}, qid, required=True)
        if errs:
            raise SystemExit(f"[{qid}] " + " · ".join(errs))
        out.append(row)
    return out, reading, listening


def _prepare_listening_audio(listening: dict, jsonl_path: Path,
                             override: str | None = None) -> tuple[dict, list[tuple[str, bytes]]]:
    """Kiểm ZIP đầy đủ trước mọi write và gắn storage path bất biến theo hash."""
    zip_path = Path(override) if override else jsonl_path.parent / listening["audio_zip"]
    if not zip_path.is_file():
        raise SystemExit(f"Không thấy gói audio {zip_path}.")
    blob = zip_path.read_bytes()
    bundle_hash = hashlib.sha256(blob).hexdigest()[:16]
    expected = {
        q["audio_file"] for section in listening["sections"]
        for q in section.get("questions", []) if q.get("audio_file")
    }
    expected.update(section["audio_file"] for section in listening["sections"]
                    if section.get("audio_file"))
    try:
        with zipfile.ZipFile(zip_path) as archive:
            names = {info.filename for info in archive.infolist() if not info.is_dir()}
            unsafe = [name for name in names if Path(name).name != name]
            if unsafe:
                raise SystemExit(f"ZIP audio chứa đường dẫn không an toàn: {unsafe[0]!r}.")
            missing, extra = expected - names, names - expected
            if missing or extra:
                raise SystemExit(
                    f"ZIP audio không khớp JSONL: thiếu {sorted(missing)} · thừa {sorted(extra)}.")
            if archive.testzip():
                raise SystemExit(f"ZIP audio hỏng CRC ở {archive.testzip()!r}.")
            audio = []
            for name in sorted(expected):
                data = archive.read(name)
                if not data.startswith(_MP3_MAGIC):
                    raise SystemExit(f"File {name!r} không phải MP3 hợp lệ.")
                storage_path = f"course/{bundle_hash}/{name}"
                audio.append((storage_path, data))
    except zipfile.BadZipFile as exc:
        raise SystemExit(f"Không đọc được ZIP audio {zip_path}: {exc}") from exc

    prepared = json.loads(json.dumps(listening))
    for section in prepared["sections"]:
        if section.get("audio_file"):
            section["audio_storage_path"] = f"course/{bundle_hash}/{section.pop('audio_file')}"
        for question in section.get("questions", []):
            if question.get("audio_file"):
                question["audio_storage_path"] = f"course/{bundle_hash}/{question.pop('audio_file')}"
    prepared.pop("audio_zip", None)
    prepared["audio_bundle"] = {
        "bucket": _AUDIO_BUCKET, "sha256": hashlib.sha256(blob).hexdigest(),
        "file_count": len(audio), "source": zip_path.name,
    }
    return prepared, audio


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", required=True, help="Tệp JSONL của một buổi.")
    ap.add_argument("--course", required=True, help="Mã khoá, ví dụ C1.")
    ap.add_argument("--lesson", type=int, help="Số buổi (mặc định đoán từ tên tệp).")
    ap.add_argument("--title", help="Tên bank (mặc định 'Buổi N — bài tập').")
    ap.add_argument("--audio-zip", help="ZIP audio (mặc định lấy cạnh JSONL).")
    ap.add_argument("--publish", action="store_true",
                    help="Xuất bản luôn. Mặc định nạp ở trạng thái NHÁP.")
    ap.add_argument("--commit", action="store_true", help="Ghi thật.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Chỉ xem (đây cũng là mặc định).")
    args = ap.parse_args()
    commit = args.commit and not args.dry_run

    path = Path(args.file)
    if not path.is_file():
        raise SystemExit(f"Không thấy tệp {path}.")
    raw = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    lesson = _lesson_no(path, args.lesson)
    rows, reading, listening = _normalise(raw)
    audio_uploads: list[tuple[str, bytes]] = []
    if listening:
        listening, audio_uploads = _prepare_listening_audio(
            listening, path, args.audio_zip)
    # Kiểm hết nội dung trước khi đụng tới kho dữ liệu — tệp hỏng phải dừng ở
    # nguồn, không phụ thuộc kết nối production có đang sống hay không.
    course = _course(args.course)

    code = f"{course['code']}-B{lesson:02d}"
    title = args.title or f"Buổi {lesson} — bài tập"
    mcq = [r for r in rows if r["type"] == "mcq"]
    essay = [r for r in rows if r["type"] == "writing"]

    logger.info("Khoá: %s — %s", course["code"], course["name"])
    logger.info("Buổi %d · mã bank %s · %d câu (%d trắc nghiệm · %d tự luận)",
                lesson, code, len(rows), len(mcq), len(essay))
    by_dang: dict = {}
    for r in rows:
        by_dang[r["subtype"]] = by_dang.get(r["subtype"], 0) + 1
    logger.info("Dạng: %s", ", ".join(f"{k}×{v}" for k, v in sorted(by_dang.items())))
    logger.info("Trục kiến thức: %d nhóm", len({r["item_key"] for r in rows if r["item_key"]}))
    if reading:
        reading_questions = sum(len(g["questions"]) for g in reading["question_groups"])
        logger.info("Bài đọc thêm: %s · %d từ · %d từ vựng · %d câu tự đối chiếu",
                    reading["title"], reading["word_count"],
                    len(reading["vocabulary"]), reading_questions)
    if listening:
        listening_questions = sum(len(s["questions"]) for s in listening["sections"])
        logger.info("Bài nghe thêm: %s · %d phần · %d câu · %d file MP3 đã kiểm",
                    listening["title"], len(listening["sections"]),
                    listening_questions, len(audio_uploads))

    if not commit:
        logger.info("\n-- THỬ KHÔ. Một câu mẫu: --")
        s = mcq[0]
        logger.info("  [%s · %s] %s", s["qid"], s["subtype"], s["prompt"].replace("\n", " ⏎ ")[:90])
        for i, o in enumerate(s["options"]):
            mark = "✓" if i == s["answer"] else " "
            why = (s["why_wrong"] or {}).get(str(i), "")
            logger.info("    %s %d. %s", mark, i + 1, o[:70])
            if why:
                logger.info("         ↳ bẫy: %s", why[:78])
        logger.info("\nThêm --commit để ghi thật.")
        return 0

    existing = (supabase_admin.table("quiz_banks").select("id, code")
                .eq("course_id", course["id"]).eq("lesson_no", lesson)
                .limit(1).execute().data) or []
    payload = {
        "code": code, "title": title, "skill_area": _SKILL_AREA,
        "course_id": course["id"], "lesson_no": lesson,
        "words_count": len(rows), "source": f"course-{course['code']}-jsonl",
        # CHƯA xuất bản ở bước này, kể cả khi có --publish. Bank và câu hỏi là hai
        # request riêng (PostgREST không có giao dịch nhiều lệnh); hỏng giữa chừng
        # mà bank đã published sẽ để lại một bài tập RỖNG mà học viên mở được.
        # Cờ --publish được áp SAU khi RPC ghi câu thành công.
        "is_published": False,
        "meta": {
            "nguon": path.name,
            "so_tu_luan": len(essay),
            **({"short_reading": reading} if reading else {}),
            **({"short_listening": listening} if listening else {}),
        },
    }
    # Audio dùng prefix theo hash nội dung. Upload hoàn tất trước khi metadata
    # của bank trỏ tới prefix ấy; nếu request sau hỏng, bank cũ vẫn không trỏ
    # tới một gói dở dang. x-upsert làm lệnh chạy lại idempotent.
    for storage_path, audio_bytes in audio_uploads:
        supabase_admin.storage.from_(_AUDIO_BUCKET).upload(
            storage_path, audio_bytes,
            {"content-type": "audio/mpeg", "x-upsert": "true"})
    if existing:
        bank_id = existing[0]["id"]
        supabase_admin.table("quiz_banks").update(payload).eq("id", bank_id).execute()
        logger.info("Bank đã có → cập nhật (%s).", existing[0]["code"])
    else:
        bank_id = (supabase_admin.table("quiz_banks").insert(payload)
                   .execute().data[0]["id"])
        logger.info("Tạo bank mới.")

    # Xoá-sạch-rồi-ghi-lại trong MỘT giao dịch: không có khoảnh khắc bank rỗng,
    # và tệp hỏng nửa chừng không để lại trộn câu cũ với câu mới.
    try:
        n = supabase_admin.rpc("quiz_replace_questions",
                               {"p_bank_id": bank_id, "p_rows": rows}).execute().data
    except Exception as exc:                       # noqa: BLE001
        # Bank ở lại trạng thái CHƯA xuất bản, nên học viên không mở được nó.
        # Nói rõ trạng thái ấy thay vì để người chạy tự đoán.
        logger.error("\nHỎNG khi ghi câu hỏi: %s", exc)
        logger.error("Bank %s KHÔNG được xuất bản, học viên chưa mở được. "
                     "Chạy lại đúng lệnh này để hoàn tất.", code)
        return 1
    logger.info("Đã ghi %s câu vào bank %s.", n, bank_id)

    # XUẤT BẢN SAU CÙNG — dấu chốt "bài này đã đủ câu". Xem ghi chú ở payload.
    if args.publish:
        supabase_admin.table("quiz_banks").update({"is_published": True}) \
            .eq("id", bank_id).eq("is_published", False).execute()
    logger.info("Trạng thái: %s", "ĐÃ XUẤT BẢN" if args.publish
                else "NHÁP (thêm --publish để mở cho học viên)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
