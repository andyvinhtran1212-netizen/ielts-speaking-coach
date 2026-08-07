"""Bảng `public` mới thêm phải BẬT RLS ngay trong migration của nó.

VÌ SAO CÓ CHỐT NÀY

Production và staging đều có RLS bật trên 89/89 bảng, nhưng KHÔNG migration nào
bật nó — trạng thái đó được đặt bằng tay ngoài luồng. Hệ quả đã xảy ra thật:
migration 086 ghi bảng nội dung là "RLS-free", nên đọc mã sẽ kết luận rằng khoá
anon lấy được đáp án. Cả tôi lẫn bộ review đều tin thế trong lượt rà #977; phải
đo bốn lượt qua PostgREST rồi truy vấn `pg_class` mới ra sự thật ngược lại.

Migration 197 ghi lại trạng thái đang chạy cho các bảng ĐÃ CÓ. Chốt này lo phần
còn lại: bảng thêm SAU 197 mà quên bật RLS thì môi trường dựng từ migration sẽ
hở, và không cổng nào khác thấy được.

PHẠM VI CÓ Ý THỨC: chốt đọc MIGRATION, không đọc CSDL — CI không có kết nối. Nó
bắt "quên viết", không bắt "ai đó tắt RLS bằng tay trên production". Việc kia
kiểm bằng truy vấn nêu trong đầu migration 197.
"""
import re
from pathlib import Path

MIG_DIR = Path(__file__).resolve().parents[1] / "migrations"

# `CREATE TABLE [IF NOT EXISTS] [public.]tên`
_CREATE = re.compile(
    r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?\"?([a-z_][a-z0-9_]*)\"?",
    re.I)
_ENABLE = re.compile(
    r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?\"?([a-z_][a-z0-9_]*)\"?"
    r"\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY", re.I)

# Migration ghi lại trạng thái RLS cho mọi bảng CÓ TỪ TRƯỚC. Bảng sinh ra ở các
# migration trước số này đã được nó phủ.
BLANKET = 197


def _strip_sql_comments(sql: str) -> str:
    sql = re.sub(r"--[^\n]*", "", sql)
    return re.sub(r"/\*.*?\*/", "", sql, flags=re.S)


def _num(path: Path) -> int:
    m = re.match(r"(\d+)_", path.name)
    return int(m.group(1)) if m else -1


def _files():
    return sorted(MIG_DIR.glob("*.sql"), key=_num)


def test_migration_197_ton_tai_va_quet_moi_bang():
    """Xoá nó đi là mất lớp ghi-lại-trạng-thái cho mọi bảng đang có."""
    f = MIG_DIR / "197_rls_explicit_on_public_tables.sql"
    assert f.exists(), "thiếu migration 197 — bảng đang có sẽ không được ghi lại"
    body = f.read_text(encoding="utf-8")
    assert "ENABLE ROW LEVEL SECURITY" in body.upper()
    assert "relrowsecurity" in body, "phải quét theo `pg_class`, không liệt kê tay"


def test_bo_do_doc_duoc_luong_migration_dang_ke():
    """Bộ dò hỏng ⇒ mọi khẳng định dưới thành xanh-rỗng."""
    files = _files()
    assert len(files) >= 150, f"chỉ thấy {len(files)} migration — sai thư mục?"
    created = set()
    for f in files:
        created |= set(_CREATE.findall(_strip_sql_comments(f.read_text(encoding="utf-8"))))
    assert len(created) >= 50, f"chỉ dò được {len(created)} bảng — biểu thức hỏng?"


def test_bang_them_sau_197_phai_bat_rls():
    enabled: set[str] = set()
    missing: list[str] = []

    for f in _files():
        sql = _strip_sql_comments(f.read_text(encoding="utf-8"))
        enabled |= {t.lower() for t in _ENABLE.findall(sql)}
        if _num(f) <= BLANKET:
            continue
        for tbl in {t.lower() for t in _CREATE.findall(sql)}:
            # Bảng tạm / bảng không thuộc `public` không tính.
            if tbl.startswith("tmp_") or tbl.startswith("temp_"):
                continue
            if tbl not in enabled:
                missing.append(f"{f.name}: bảng «{tbl}» chưa bật RLS")

    assert missing == [], (
        "Bảng mới phải có `ALTER TABLE <tên> ENABLE ROW LEVEL SECURITY` ngay trong "
        "migration tạo nó. Thiếu thì một môi trường dựng từ migration sẽ đọc được "
        "bảng đó bằng khoá anon, mà không cổng nào khác thấy.\n  " + "\n  ".join(missing)
    )
