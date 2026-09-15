from pathlib import Path


SQL = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "262_restore_cambridge_15_test_4_reading_q07_explanation.sql"
).read_text(encoding="utf-8")


def test_repair_is_scoped_and_preserves_historical_attempts():
    assert "ILR-RDG-CAM-B15-T4" in SQL
    assert "rq.q_num = 7" in SQL
    assert "rq.q_num = 6" in SQL
    assert "UPDATE reading_questions" in SQL
    assert "DELETE" not in SQL.upper()
    assert "TRUNCATE" not in SQL.upper()


def test_repair_restores_the_two_word_answer_and_structured_explanation():
    for value in (
        "leaves bark",
        "bark leaves",
        "question_text",
        "tips",
        "trap_analysis",
        "chỉ điền một từ thì không được tính điểm",
        "cả hai đều bắt buộc",
    ):
        assert value in SQL
    assert "IS DISTINCT FROM" in SQL
    assert "jsonb_set(\n           COALESCE(rq.payload, '{}'::jsonb)" in SQL
    assert "COALESCE(rq.payload -> 'solution', '{}'::jsonb)" in SQL


def test_repair_keeps_the_shared_q06_q08_template_canonical():
    assert "{{6}} | fuel" in SQL
    assert "{{7}} | medicine — enter both tree parts, either order" in SQL
    assert "{{8}} | construction" in SQL
