"""Xoá bài giao không được xoá mất bài học viên đã làm — CHẠY HÀM THẬT.

`fn_delete_class_assignment_if_unsubmitted` từ chối xoá khi đã có bằng chứng nộp
bài. Bài tập theo buổi ra đời sau và không được thêm vào danh sách ấy, nên:

  1. Học viên làm xong chặng cuối; lượt ghi sổ hỏng (ghi best-effort).
  2. Giáo viên xoá bài giao trước khi ai kịp đối chiếu.
  3. RPC không thấy bằng chứng nào ⇒ xoá.
  4. Hai khoá ngoại `ON DELETE SET NULL` biến khoá nối thành NULL.

Bài vẫn còn trên máy chủ nhưng `reconcile_course_items` tìm theo đúng cột vừa bị
xoá, nên không bao giờ tìm lại được. Mất vĩnh viễn.

── Vì sao chốt này DỰNG POSTGRES THẬT ──────────────────────────────────────────
Mọi chốt khác cho các RPC này đều soi CHỮ trong tệp SQL. Chữ đúng mà logic sai —
lồng nhầm dấu ngoặc trong chuỗi `OR EXISTS`, so `kind` với giá trị không tồn tại
— thì chốt vẫn xanh. Ở đây thì hậu quả là mất dữ liệu không lùi được, nên phải
NẠP hàm và GỌI nó.

Bỏ qua khi máy CỤC BỘ không có Postgres. Ở CI thì không: workflow dựng service
`postgres:16` và đặt `REQUIRE_PG=1`, nên thiếu kết nối là ĐỎ chứ không phải bỏ
qua — một chốt tự bỏ qua ở cổng merge là một chốt không bao giờ nổ.
"""

from __future__ import annotations

import os
import re
import subprocess
import uuid
from pathlib import Path

import pytest

_MIG = Path(__file__).resolve().parents[1] / "migrations" / \
    "196_delete_rpc_course_evidence.sql"
_DB = os.environ.get("TEST_PG_URL", "postgres://localhost/postgres")


def _psql(sql: str, db: str = _DB) -> str:
    r = subprocess.run(["psql", db, "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r.stdout.strip()


def _have_pg() -> bool:
    try:
        return _psql("SELECT 1") == "1"
    except Exception:
        return False


# Ở CI thì THIẾU Postgres là hỏng hạ tầng, không phải một lời miễn trừ: bỏ qua
# ở đó nghĩa là cổng merge không bao giờ chạy chốt này (codex 06/08).
if os.environ.get("REQUIRE_PG") == "1" and not _have_pg():
    raise RuntimeError(f"REQUIRE_PG=1 nhưng không nối được Postgres tại {_DB}")

pytestmark = pytest.mark.skipif(
    not _have_pg(), reason="không có Postgres cục bộ — chốt này cần chạy hàm thật")


# Lược đồ TỐI THIỂU: đúng những bảng và cột hàm chạm tới. Dựng lại cả lược đồ
# thật là chép một bản sao sẽ trôi khỏi bản gốc; ở đây cái cần kiểm là LOGIC của
# hàm, và hàm chỉ đọc chừng này cột.
_SCHEMA = """
DROP SCHEMA IF EXISTS rpc_probe CASCADE;
CREATE SCHEMA rpc_probe;
SET search_path = rpc_probe;

CREATE TABLE class_assignments (
    id UUID PRIMARY KEY, cohort_id UUID NOT NULL);
CREATE TABLE class_assignment_items (
    id UUID PRIMARY KEY,
    assignment_id UUID NOT NULL REFERENCES class_assignments(id) ON DELETE CASCADE,
    submitted_at TIMESTAMPTZ);
CREATE TABLE sessions (
    id UUID PRIMARY KEY, status TEXT,
    class_assignment_item_id UUID REFERENCES class_assignment_items(id) ON DELETE SET NULL);
CREATE TABLE reading_test_attempts (
    id UUID PRIMARY KEY, status TEXT,
    class_assignment_item_id UUID REFERENCES class_assignment_items(id) ON DELETE SET NULL);
CREATE TABLE listening_test_attempts (
    id UUID PRIMARY KEY, status TEXT,
    class_assignment_item_id UUID REFERENCES class_assignment_items(id) ON DELETE SET NULL);
-- `kind` dựng ĐÚNG như mig 189: NOT NULL, mặc định 'run', và CHECK chỉ cho hai
-- giá trị. Ô thử lỏng hơn thật thì chốt chạy được trên những trạng thái KHÔNG
-- TỒN TẠI (bản trước thử `NULL` và `'review'`, cả hai đều không thể có), tức là
-- chứng minh về một sản phẩm khác (codex 06/08).
CREATE TABLE quiz_sessions (
    id UUID PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'run' CHECK (kind IN ('run', 'retake')),
    ended_by TEXT,
    class_assignment_item_id UUID REFERENCES class_assignment_items(id) ON DELETE SET NULL);
CREATE TABLE course_writing_submissions (
    id UUID PRIMARY KEY,
    class_assignment_item_id UUID REFERENCES class_assignment_items(id) ON DELETE SET NULL);
"""


def _function_sql() -> str:
    """Lấy đúng phần định nghĩa hàm ra khỏi tệp migration.

    Bỏ REVOKE/GRANT: chúng nhắc tới vai trò của Supabase (`anon`, `service_role`)
    vốn không có trên một Postgres trắng. Phần quyền đã được ghim riêng ở
    `test_migration_161_rpc_grants.py` — chốt này lo phần LOGIC.
    """
    src = _MIG.read_text(encoding="utf-8")
    i = src.index("CREATE OR REPLACE FUNCTION")
    j = src.index("$$;", i) + len("$$;")
    body = src[i:j]
    # Hàm khai `SET search_path = public`; trong ô thử thì lược đồ nằm chỗ khác.
    return re.sub(r"SET search_path = public", "SET search_path = rpc_probe", body)


@pytest.fixture()
def probe():
    _psql(_SCHEMA + _function_sql())

    def _run(*, evidence=None, submitted=False):
        """Dựng một bài giao có ĐÚNG một mục, rồi gọi hàm xoá.

        Trả về (kết quả hàm, bài giao còn hay mất).
        """
        a, it = uuid.uuid4(), uuid.uuid4()
        co = uuid.uuid4()
        rows = [
            f"INSERT INTO rpc_probe.class_assignments VALUES ('{a}','{co}')",
            f"INSERT INTO rpc_probe.class_assignment_items VALUES ('{it}','{a}',"
            f"{'NOW()' if submitted else 'NULL'})",
        ]
        if evidence:
            rows.append(evidence.format(item=it, id=uuid.uuid4()))
        _psql("; ".join(rows))
        # HAI câu lệnh, không phải một. Trong CÙNG một câu `SELECT fn(...),
        # EXISTS(...)`, câu con `EXISTS` đọc bằng ảnh chụp lấy TỪ ĐẦU câu lệnh,
        # nên nó vẫn thấy dòng mà hàm vừa xoá — và mọi ca "xoá được" sẽ báo
        # ngược. Hỏi sau, bằng một câu riêng.
        got = _psql(f"SELECT COALESCE(rpc_probe."
                    f"fn_delete_class_assignment_if_unsubmitted('{a}','{co}')::text,"
                    f" 'NULL')")
        still = _psql(f"SELECT EXISTS(SELECT 1 FROM rpc_probe.class_assignments "
                      f"WHERE id='{a}')")
        return got, still == "t"
    return _run


def test_a_finished_course_stage_blocks_the_delete(probe):
    """Cảnh hỏng gốc: em ấy làm xong chặng cuối, lượt ghi sổ hỏng, giáo viên xoá
    bài giao — và bằng chứng mất khoá nối, không đường nào tìm lại."""
    got, still = probe(evidence="INSERT INTO rpc_probe.quiz_sessions VALUES "
                                "('{id}','run','completed','{item}')")
    assert (got, still) == ("false", True)


def test_a_graded_course_essay_blocks_the_delete(probe):
    """Dòng ở bảng này chỉ sinh ra sau khi đã chấm — có dòng là có bài nộp."""
    got, still = probe(evidence="INSERT INTO rpc_probe.course_writing_submissions "
                                "VALUES ('{id}','{item}')")
    assert (got, still) == ("false", True)


def test_a_finished_RETAKE_also_blocks_the_delete(probe):
    """Lượt kiểm tra lại cũng là công sức của em ấy.

    Đây là chỗ chốt xoá KHÁC `reconcile_course_items`, và khác có chủ ý: bên kia
    phải CHỌN một phiên làm bằng chứng chốt sổ nên chỉ nhận lượt chính; ở đây
    chỉ cần biết em ấy CÓ làm hay không. Chép nguyên bộ lọc `kind` từ bên kia
    sang là để rơi mất một lượt làm bài thật."""
    got, still = probe(evidence="INSERT INTO rpc_probe.quiz_sessions VALUES "
                                "('{id}','retake','completed','{item}')")
    assert (got, still) == ("false", True)


def test_a_paused_course_session_does_not_block(probe):
    """Tạm dừng giữa chừng không phải là nộp bài. Chặn cả nó thì một bài giao
    nhầm không bao giờ xoá được nữa."""
    got, still = probe(evidence="INSERT INTO rpc_probe.quiz_sessions VALUES "
                                "('{id}','run','paused','{item}')")
    assert (got, still) == ("true", False)


def test_the_probe_refuses_a_kind_that_production_cannot_hold(probe):
    """Ô thử phải TỪ CHỐI đúng những gì cơ sở dữ liệu thật từ chối.

    Không có chốt này thì một phép thử vô tình dựng `kind='review'` sẽ chạy êm
    và chứng minh một điều về sản phẩm không tồn tại — đúng lỗi bản trước mắc."""
    with pytest.raises(RuntimeError, match="quiz_sessions_kind_check|check constraint"):
        probe(evidence="INSERT INTO rpc_probe.quiz_sessions VALUES "
                       "('{id}','review','completed','{item}')")


def test_an_untouched_assignment_is_still_deletable(probe):
    """Chặn rộng vẫn phải chừa đường: giáo viên giao nhầm thì phải xoá được."""
    got, still = probe()
    assert (got, still) == ("true", False)


def test_the_four_older_kinds_of_evidence_still_block(probe):
    """Mở rộng một hàm là chỗ dễ đánh rơi những nhánh đã có."""
    for name, ev in (
        ("sổ cái", None),
        ("phiên Speaking", "INSERT INTO rpc_probe.sessions VALUES "
                           "('{id}','completed','{item}')"),
        ("lượt Reading", "INSERT INTO rpc_probe.reading_test_attempts VALUES "
                         "('{id}','submitted','{item}')"),
        ("lượt Listening", "INSERT INTO rpc_probe.listening_test_attempts VALUES "
                           "('{id}','submitted','{item}')"),
    ):
        got, still = probe(evidence=ev, submitted=(ev is None))
        assert (got, still) == ("false", True), name


def test_a_stranger_cohort_gets_NULL_not_a_delete(probe):
    """Lớp khác hỏi thì trả NULL để nơi gọi trả 404 — không được xoá hộ."""
    a, it, co = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    _psql(f"INSERT INTO rpc_probe.class_assignments VALUES ('{a}','{co}'); "
          f"INSERT INTO rpc_probe.class_assignment_items VALUES ('{it}','{a}',NULL)")
    got = _psql(f"SELECT COALESCE(rpc_probe."
                f"fn_delete_class_assignment_if_unsubmitted('{a}','{uuid.uuid4()}')"
                f"::text,'NULL')")
    still = _psql(f"SELECT EXISTS(SELECT 1 FROM rpc_probe.class_assignments "
                  f"WHERE id='{a}')")
    assert (got, still) == ("NULL", "t")
