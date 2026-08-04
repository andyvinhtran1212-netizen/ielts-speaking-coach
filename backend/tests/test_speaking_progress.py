"""Dấu mốc tiến bộ BỀN — thứ còn lại sau khi bản gốc bị dọn.

`jobs/retention_sweep.py` xoá `transcript` và `pronunciation_payload` ở mốc 60
ngày. Nếu bộ rút này sai, cái sai ấy KHÔNG sửa được về sau: dữ liệu gốc đã đi
rồi. Nên phần lớn phép kiểm dưới đây dùng HÌNH DẠNG THẬT của payload trên prod,
không phải một mẫu tự bịa cho vừa mã.
"""

from __future__ import annotations

import json

from services import speaking_progress as mod


# Chép nguyên hình dạng Azure trả về, lấy từ một dòng thật trên prod
# (04/08/2026). Hai chi tiết ở đây từng làm bản đầu im lặng trả rỗng:
#   · payload nằm trong DB dưới dạng CHUỖI JSON, không phải object;
#   · `ErrorType` của từ đúng là chuỗi "None", không phải null.
_WORDS = [
    {"Word": "take", "ErrorType": "Mispronunciation", "AccuracyScore": 50.0,
     "Phonemes": [{"Phoneme": "t", "AccuracyScore": 54.0},
                  {"Phoneme": "ey", "AccuracyScore": 41.0},
                  {"Phoneme": "k", "AccuracyScore": 56.0}]},
    {"Word": "care", "ErrorType": "None", "AccuracyScore": 97.0,
     "Phonemes": [{"Phoneme": "k", "AccuracyScore": 100.0},
                  {"Phoneme": "eh", "AccuracyScore": 100.0},
                  {"Phoneme": "r", "AccuracyScore": 76.0}]},
    {"Word": "of", "ErrorType": "None", "AccuracyScore": 80.0,
     "Phonemes": [{"Phoneme": "ax", "AccuracyScore": 52.0},
                  {"Phoneme": "v", "AccuracyScore": 79.0}]},
]
_PAYLOAD_OBJ = {"RecognitionStatus": "Success", "NBest": [{"Words": _WORDS}]}
# ĐÚNG như cột lưu: một chuỗi.
_PAYLOAD = json.dumps(_PAYLOAD_OBJ)


# ── Bóc payload ──────────────────────────────────────────────────────────────

def test_the_payload_is_read_even_though_it_is_stored_as_a_STRING():
    """Trên prod 4.696/4.696 dòng có `jsonb_typeof = 'string'`. Đọc thẳng như
    dict sẽ im lặng không lấy được gì — bảng tiến bộ trống ở đúng cột quan trọng
    nhất mà không có lỗi nào để lần ra."""
    assert mod.weak_phonemes(_PAYLOAD), "payload dạng chuỗi phải đọc được"


def test_an_object_payload_also_works():
    """Chưa có gì bảo đảm cột này mãi là chuỗi."""
    assert mod.weak_phonemes(_PAYLOAD_OBJ) == mod.weak_phonemes(_PAYLOAD)


def test_a_purged_payload_yields_nothing_not_an_error():
    for bad in (None, "", "không-phải-json", "[]", '"chuỗi trần"'):
        assert mod.weak_phonemes(bad) == []
        assert mod.mispronounced_words(bad) == []


# ── Âm vị yếu ────────────────────────────────────────────────────────────────

def test_the_weakest_phonemes_come_first():
    out = mod.weak_phonemes(_PAYLOAD)
    assert out[0] == "ey", f"âm 41 điểm phải đứng đầu, nhận được {out}"
    assert "ax" in out          # 52
    assert "t" in out           # 54


def test_a_phoneme_scored_well_is_not_listed():
    out = mod.weak_phonemes(_PAYLOAD)
    assert "eh" not in out      # 100
    assert "v" not in out       # 79


def test_a_phoneme_is_judged_on_its_AVERAGE_not_its_worst_moment():
    """Một âm bị chấm 30 điểm ĐÚNG MỘT LẦN thường là lỗi nhận dạng; một âm đều
    đặn 55 điểm qua hai mươi lần mới là điều cần dạy lại. Bảng này sinh ra để
    thấy cái LẶP LẠI."""
    words = [{"Word": "a", "ErrorType": "None", "AccuracyScore": 90.0,
              "Phonemes": [{"Phoneme": "s", "AccuracyScore": 20.0}]}] + \
            [{"Word": f"w{i}", "ErrorType": "None", "AccuracyScore": 95.0,
              "Phonemes": [{"Phoneme": "s", "AccuracyScore": 99.0}]} for i in range(9)]
    payload = json.dumps({"NBest": [{"Words": words}]})
    # Trung bình = (20 + 99*9)/10 = 91.1 ⇒ KHÔNG yếu. Lấy lần tệ nhất sẽ ra 20.
    assert "s" not in mod.weak_phonemes(payload)


def test_only_the_top_few_are_kept():
    words = [{"Word": f"w{i}", "ErrorType": "None", "AccuracyScore": 10.0,
              "Phonemes": [{"Phoneme": f"p{i}", "AccuracyScore": float(i)}]}
             for i in range(20)]
    out = mod.weak_phonemes(json.dumps({"NBest": [{"Words": words}]}))
    assert len(out) == mod.TOP_N


# ── Từ phát âm sai ───────────────────────────────────────────────────────────

def test_only_words_azure_itself_marked_as_wrong_are_listed():
    """Dùng `ErrorType` của Azure chứ không tự đặt ngưỡng trên điểm: đó là phán
    quyết của chính bộ chấm, và một luật thứ hai sẽ cho ra danh sách khác với
    thứ học viên nhìn thấy trong bản đánh giá."""
    assert mod.mispronounced_words(_PAYLOAD) == ["take"]


def test_the_STRING_None_is_not_treated_as_an_error():
    """Azure trả chuỗi "None" cho từ đúng. Coi nó là một lỗi sẽ gắn nhãn phát âm
    sai cho TOÀN BỘ từ trong bài."""
    ok = {"Word": "hello", "ErrorType": "None", "AccuracyScore": 99.0, "Phonemes": []}
    assert mod.mispronounced_words(json.dumps({"NBest": [{"Words": [ok]}]})) == []


def test_repeated_wrong_words_are_listed_once():
    w = {"Word": "Take", "ErrorType": "Mispronunciation", "AccuracyScore": 40.0,
         "Phonemes": []}
    out = mod.mispronounced_words(json.dumps({"NBest": [{"Words": [w, w, w]}]}))
    assert out == ["take"]


# ── Tốc độ nói ───────────────────────────────────────────────────────────────

def test_words_per_minute_is_computed_while_the_transcript_still_exists():
    assert mod.words_per_minute("one two three four five six", 60.0) == 6.0


def test_a_purged_transcript_gives_None_not_zero():
    """0 sẽ kéo mọi phép trung bình xuống và bịa ra một xu hướng không có thật —
    đúng vào lúc cơ chế dọn được bật, tức là với TOÀN BỘ bài cũ cùng lúc."""
    assert mod.words_per_minute(None, 60.0) is None
    assert mod.words_per_minute("", 60.0) is None


def test_a_very_short_clip_gives_None():
    """Một từ trong 2 giây thành 30 wpm — một con số gây hiểu nhầm còn tệ hơn
    không có con số nào."""
    assert mod.words_per_minute("hello", 2.0) is None


def test_an_unknown_duration_gives_None():
    assert mod.words_per_minute("một hai ba", None) is None


# ── Nhãn ngữ pháp ────────────────────────────────────────────────────────────

def test_grammar_tags_use_the_CLOSED_slug_not_the_generated_prose():
    """`grammar_issue` là câu chữ do mô hình sinh ra: hai lần chấm cùng một lỗi
    có thể ra hai chuỗi khác nhau, và khi ấy không đếm được cái gì lặp lại. Slug
    là danh mục đóng — nó phải trỏ tới một bài Grammar Wiki có thật."""
    recs = [{"recommended_slug": "articles", "grammar_issue": "Thiếu mạo từ 'the'"},
            {"recommended_slug": "articles", "grammar_issue": "Bỏ quên mạo từ"},
            {"recommended_slug": "past-simple", "grammar_issue": "x"}]
    assert mod.grammar_tags(recs) == ["articles", "past-simple"]


def test_no_recommendations_is_an_empty_list():
    assert mod.grammar_tags([]) == [] and mod.grammar_tags(None) == []


# ── Dựng cả dấu mốc ──────────────────────────────────────────────────────────

def _resp(**over):
    base = {"id": "r1", "session_id": "s1", "overall_band": 6.5,
            "final_band_p": 6.0, "duration_seconds": 60.0,
            "transcript": "one two three four five six",
            "pronunciation_payload": _PAYLOAD, "score_confidence": "high",
            "recorded_at": "2026-08-04T10:00:00Z"}
    base.update(over)
    return base


_SESSION = {"id": "s1", "user_id": "u1", "part": 1,
            "started_at": "2026-08-04T09:55:00Z",
            "class_assignment_item_id": "item-1"}


def test_a_graded_answer_becomes_a_complete_mark():
    m = mod.build_mark(response=_resp(), session=_SESSION,
                       recommendations=[{"recommended_slug": "articles"}])
    assert m["response_id"] == "r1"
    assert m["user_id"] == "u1"
    assert m["class_assignment_item_id"] == "item-1"
    assert m["band"] == 6.5 and m["band_p"] == 6.0
    assert m["words_per_minute"] == 6.0
    assert m["weak_phonemes"][0] == "ey"
    assert m["mispronounced_words"] == ["take"]
    assert m["grammar_tags"] == ["articles"]


def test_an_ungraded_answer_makes_NO_mark():
    """Một dấu mốc không điểm sẽ được đếm như một lần luyện tập, trong khi nó là
    một lần chấm hỏng — và biểu đồ tiến bộ sẽ có một chỗ trũng không có thật."""
    assert mod.build_mark(response=_resp(overall_band=None), session=_SESSION) is None


def test_free_practice_has_no_class_link():
    m = mod.build_mark(response=_resp(), session={**_SESSION, "class_assignment_item_id": None})
    assert m["class_assignment_item_id"] is None


def test_an_OLD_answer_whose_extras_are_gone_still_makes_a_mark():
    """Bài đã bị dọn vẫn còn điểm. Dấu mốc lúc ấy nghèo hơn nhưng vẫn có ích —
    từ chối dựng sẽ để lại một khoảng trống trong lịch sử."""
    m = mod.build_mark(
        response=_resp(transcript=None, pronunciation_payload=None),
        session=_SESSION)
    assert m is not None
    assert m["band"] == 6.5
    assert m["words_per_minute"] is None
    assert m["weak_phonemes"] == [] and m["mispronounced_words"] == []
