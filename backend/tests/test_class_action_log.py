"""NHẬT KÝ THAO TÁC — ai đổi hạn / trả bài, lúc nào, từ gì sang gì.

Ngày 08/08 ship hai đường cho giáo viên SỬA thứ đã ghi vào sổ lớp (đổi hạn #1005,
trả bài #1000). Cả hai đổi thứ học viên nhìn thấy, và trước mig 198 dấu vết duy
nhất là một dòng log máy chủ — hết hạn theo chính sách giữ log, không truy vấn
được, không ai mở ra khi có tranh cãi.

Ba tính chất được ghim ở đây:

  · ghi nhật ký hỏng KHÔNG được làm đổ việc chính (việc đã xảy ra rồi);
  · nhưng cũng KHÔNG nuốt trong im lặng — nơi gọi phải nói ra;
  · dòng nhật ký phải đủ để đọc lại thao tác mà không phải đoán: trước → sau.
"""

from __future__ import annotations

import pytest

from services.class_assignment_service import log_class_action, read_class_actions


class _Resp:
    def __init__(self, data): self.data = data


class _Table:
    def __init__(self, rows, log, boom=False):
        self._rows, self._log, self._boom = rows, log, boom
        self._f, self._limit, self._desc, self._lt = [], None, False, None

    def select(self, *_a, **_k): return self
    def eq(self, f, v): self._f.append((f, v)); return self
    def lt(self, f, v): self._lt = (f, v); return self
    def order(self, _f, desc=False): self._desc = desc; return self
    def limit(self, n): self._limit = n; return self

    def insert(self, row):
        if self._boom:
            raise RuntimeError("mạng hỏng")
        self._log.append(row)
        self._rows.append({**row, "id": f"lg{len(self._rows)}",
                           "created_at": f"2026-08-08T0{len(self._rows)}:00:00Z"})
        return self

    def execute(self):
        hit = self._rows
        for f, v in self._f:
            hit = [r for r in hit if r.get(f) == v]
        if self._lt:
            f, v = self._lt
            hit = [r for r in hit if str(r.get(f)) < str(v)]
        if self._desc:
            hit = list(reversed(hit))
        return _Resp(hit[: self._limit] if self._limit else hit)


def _db(rows=None, boom=False):
    rows = rows if rows is not None else []
    log = []
    db = type("DB", (), {})()
    db.table = lambda _n: _Table(rows, log, boom)
    db._rows, db._log = rows, log
    return db


ACTOR = {"id": "u-admin", "email": "co.giao@averlearning.com"}


def test_a_due_change_is_written_with_who_and_before_after():
    db = _db()
    ok = log_class_action(
        db, action="due_change", cohort_id="c1", actor=ACTOR, assignment_id="a1",
        details={"previous_due_at": "2026-08-07T19:00:00+07:00",
                 "due_at": "2026-08-09T19:00:00+07:00",
                 "flips": {"to_ontime": 1, "to_late": 0}})
    assert ok is True
    row = db._log[0]
    assert row["action"] == "due_change"
    assert row["actor_user_id"] == "u-admin"
    assert row["actor_email"] == "co.giao@averlearning.com", \
        "chép email lúc thao tác — `users` có thể đổi hoặc mất dòng"
    assert row["details"]["previous_due_at"] and row["details"]["due_at"], \
        "thiếu một trong hai đầu thì không đọc lại được thao tác"
    assert row["student_id"] is None, "đổi hạn không nhắm vào một em nào"


def test_returning_work_names_the_student():
    db = _db()
    log_class_action(db, action="return_work", cohort_id="c1", actor=ACTOR,
                     assignment_id="a1", student_id="st1",
                     details={"artifact_kind": "course_writing",
                              "draft_restored": 10, "score_cleared": False})
    row = db._log[0]
    assert row["student_id"] == "st1"
    assert row["details"]["draft_restored"] == 10


def test_a_failed_log_write_never_raises():
    """Việc chính ĐÃ xảy ra — hạn đã đổi, bài đã trả. Ném ở đây là báo hỏng cho
    một việc đã thành công, và giáo viên sẽ bấm lại lần nữa."""
    assert log_class_action(_db(boom=True), action="due_change", cohort_id="c1",
                            actor=ACTOR) is False


def test_a_failed_log_write_is_reported_not_swallowed():
    # Một nhật ký thủng lỗ mà không ai biết còn tệ hơn không có nhật ký, vì nó
    # được tin. `False` là cách nơi gọi biết mà nói ra.
    assert log_class_action(_db(boom=True), action="return_work",
                            cohort_id="c1", actor=ACTOR) is not True


def test_an_unknown_actor_still_produces_a_row():
    # Thiếu danh tính không được làm mất luôn dòng nhật ký: "có người đổi lúc
    # 19:03" vẫn hơn hẳn không có gì.
    db = _db()
    assert log_class_action(db, action="due_change", cohort_id="c1", actor=None) is True
    assert db._log[0]["actor_user_id"] is None


def test_reading_returns_newest_first_and_is_capped():
    db = _db()
    for i in range(5):
        log_class_action(db, action="due_change", cohort_id="c1", actor=ACTOR,
                         details={"n": i})
    page = read_class_actions(db, cohort_id="c1", limit=3)
    assert len(page["actions"]) == 3
    assert page["actions"][0]["details"]["n"] == 4, "mới nhất phải đứng trước"


def test_the_read_cap_cannot_be_widened_without_bound():
    db = _db()
    for i in range(3):
        log_class_action(db, action="due_change", cohort_id="c1", actor=ACTOR)
    # Xin 100000 thì kẹp về 200 — trần là của máy chủ, không phải của người gọi.
    assert len(read_class_actions(db, cohort_id="c1", limit=100000)["actions"]) == 3
    assert len(read_class_actions(db, cohort_id="c1", limit=0)["actions"]) == 3


def test_another_class_log_is_not_returned():
    db = _db()
    log_class_action(db, action="due_change", cohort_id="c1", actor=ACTOR)
    log_class_action(db, action="due_change", cohort_id="c-KHAC", actor=ACTOR)
    assert len(read_class_actions(db, cohort_id="c1")["actions"]) == 1


def test_a_truncated_history_says_so_and_gives_a_way_onward():
    """Cắt trong IM LẶNG làm người đọc tin rằng mình đã thấy hết — đúng lúc họ
    đang đi tìm một thao tác cũ (codex cục bộ 08/08 vòng 5)."""
    db = _db()
    for i in range(5):
        log_class_action(db, action="due_change", cohort_id="c1", actor=ACTOR,
                         at=f"2026-08-08T0{i}:00:00Z", details={"n": i})
    first = read_class_actions(db, cohort_id="c1", limit=2)
    assert [a["details"]["n"] for a in first["actions"]] == [4, 3]
    assert first["has_more"] is True
    assert first["next_before"] == "2026-08-08T03:00:00Z"

    second = read_class_actions(db, cohort_id="c1", limit=2,
                                before=first["next_before"])
    assert [a["details"]["n"] for a in second["actions"]] == [2, 1]
    assert second["has_more"] is True

    last = read_class_actions(db, cohort_id="c1", limit=2,
                              before=second["next_before"])
    assert [a["details"]["n"] for a in last["actions"]] == [0]
    assert last["has_more"] is False, "hết thật thì đừng mời bấm tiếp"
    assert last["next_before"] is None


def test_the_target_name_is_snapshotted_so_a_deletion_cannot_erase_it():
    """Hai khoá ngoại là ON DELETE SET NULL, nên xoá bài giao (hay học viên) cắt
    đường tra tên — dòng còn lại chỉ nói "có người đổi cái gì đó" (codex #1010)."""
    db = _db()
    log_class_action(db, action="return_work", cohort_id="c1", actor=ACTOR,
                     assignment_id="a1", assignment_title="Grammar 1",
                     student_id="st1", student_name="Lê Ngọc Hà Linh")
    row = db._log[0]
    assert row["assignment_title"] == "Grammar 1"
    assert row["student_name"] == "Lê Ngọc Hà Linh"


def test_the_log_is_append_only_in_the_database_not_just_by_convention():
    """Câu "chỉ THÊM" phải được RÀNG BUỘC, không phải chỉ được viết ra.

    Bản đầu cấp `FOR ALL` cho admin — tức là chính người đang bị ghi lại có thể
    sửa hoặc xoá bằng chứng về mình qua PostgREST. Và RLS một mình cũng không
    đủ: `service_role` (backend dùng) bỏ qua RLS hoàn toàn.
    """
    import pathlib as _p
    src = (_p.Path(__file__).resolve().parents[1] / "migrations" /
           "198_class_action_log.sql").read_text()
    ddl = "\n".join(l for l in src.splitlines() if not l.strip().startswith("--"))
    assert "FOR ALL" not in ddl, "FOR ALL cho phép sửa/xoá chính nhật ký về mình"
    assert "FOR SELECT" in ddl and "FOR INSERT" in ddl
    # Trigger là thứ ràng buộc được CẢ service_role.
    assert "BEFORE UPDATE OR DELETE ON class_action_log" in ddl
    assert "RAISE EXCEPTION" in ddl
    # Quy ước bắt buộc của kho (backend/migrations/README.md): search_path thả
    # nổi cho phép một lược đồ khác che mất đối tượng hàm tham chiếu.
    assert "SET search_path = public, pg_temp" in ddl


def test_the_migration_writes_the_table_and_turns_rls_on():
    """Bảng mới PHẢI bật RLS — quy ước chốt lại ở mig 197 sau khi phát hiện
    trạng thái thật của prod không hề có trong repo."""
    import pathlib
    sql = pathlib.Path(__file__).resolve().parents[1] / "migrations" / \
        "198_class_action_log.sql"
    src = sql.read_text()
    assert "CREATE TABLE IF NOT EXISTS class_action_log" in src
    assert "ENABLE ROW LEVEL SECURITY" in src
    assert "is_current_user_admin()" in src
    # Soi DDL, KHÔNG soi văn xuôi: chính chú thích của migration có nhắc chữ
    # `updated_at` để giải thích vì sao nó vắng mặt, và bản test đầu tiên của
    # tôi đỏ vì đúng câu ấy — ghim chữ thay vì ghim cấu trúc.
    ddl = "\n".join(l for l in src.splitlines() if not l.strip().startswith("--"))
    assert "updated_at" not in ddl, "nhật ký sửa được thì không phải nhật ký"
    assert "ON DELETE" not in ddl.split("actor_user_id")[1].split(",")[0], \
        "người thao tác không được kéo theo nhật ký khi tài khoản bị xoá"


def test_the_log_is_stamped_with_when_the_change_happened_not_when_it_was_written():
    """Hai lượt ghi song song: A đổi hạn xong rồi khựng trước lúc chèn, B đổi
    tiếp và chèn TRƯỚC. Để `created_at` mặc định NOW() thì nhật ký kể ngược thứ
    tự, mà màn hình sắp theo chính cột ấy (codex cục bộ 08/08 vòng 3)."""
    db = _db()
    log_class_action(db, action="due_change", cohort_id="c1", actor=ACTOR,
                     at="2026-08-08T10:00:00+00:00")
    assert db._log[0]["created_at"] == "2026-08-08T10:00:00+00:00"

    # Không truyền mốc thì để CSDL tự đặt — không bịa ra một giờ nào cả.
    db2 = _db()
    log_class_action(db2, action="due_change", cohort_id="c1", actor=ACTOR)
    assert "created_at" not in db2._log[0]


def test_both_write_paths_hand_the_log_their_own_change_time():
    """Chốt ở ĐƯỜNG, không chỉ ở hàm: hai nơi gọi phải THẬT SỰ truyền mốc."""
    import inspect
    import routers.admin_class_assignments as r
    for fn in (r.update_assignment_due, r.return_student_work):
        src = inspect.getsource(fn)
        assert 'at=out.get("changed_at")' in src, fn.__name__


def test_no_foreign_key_may_reach_out_of_the_log():
    """Khoá ngoại + trigger chỉ-thêm = xoá bài giao sẽ HỎNG.

    Postgres thực hiện `ON DELETE SET NULL` bằng một lệnh UPDATE lên bảng con và
    `CASCADE` bằng DELETE — trigger chặn cả hai. Bản đầu có ba khoá ngoại, nên
    xoá một bài giao đã có dòng nhật ký sẽ đổ đúng chức năng "Xoá" đang chạy
    trên trang lớp (codex cục bộ 08/08, P1).
    """
    import pathlib as _p
    src = (_p.Path(__file__).resolve().parents[1] / "migrations" /
           "198_class_action_log.sql").read_text()
    ddl = "\n".join(l for l in src.splitlines() if not l.strip().startswith("--"))
    assert "REFERENCES" not in ddl, \
        "một khoá ngoại ở đây làm xoá bài giao/lớp đụng trigger rồi hỏng"
    assert "ON DELETE" not in ddl
