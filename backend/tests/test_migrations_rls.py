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
    """Số thứ tự, BỎ QUA hậu tố chữ. Repo có `019b_`, `022b_`, `161b_` — đòi dấu
    gạch dưới ngay sau chữ số sẽ trả -1 cho chúng, và một tệp `198b_` tương lai
    sẽ lọt qua mốc chặn như thể nó có trước 197 (codex cục bộ #978)."""
    m = re.match(r"(\d+)", path.name)
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
    # Bảng phân mảnh CHA mang `relkind='p'`. Bật RLS cho mảnh con không che được
    # truy vấn đi qua bảng cha, nên thiếu 'p' là để hở đúng đường người ta query.
    assert re.search(r"relkind\s+IN\s*\(\s*'r'\s*,\s*'p'\s*\)", body), (
        "migration 197 phải phủ CẢ `relkind='r'` (bảng thường) lẫn `'p'` "
        "(bảng phân mảnh cha)")


def test_bo_do_doc_duoc_luong_migration_dang_ke():
    """Bộ dò hỏng ⇒ mọi khẳng định dưới thành xanh-rỗng."""
    files = _files()
    assert len(files) >= 150, f"chỉ thấy {len(files)} migration — sai thư mục?"
    created = set()
    for f in files:
        created |= set(_CREATE.findall(_strip_sql_comments(f.read_text(encoding="utf-8"))))
    assert len(created) >= 50, f"chỉ dò được {len(created)} bảng — biểu thức hỏng?"


# ── Bộ dò phải được ĐEM RA CHẠY, không chỉ tồn tại ──────────────────────────
#
# Hôm nay chưa có migration nào sau 197, nên thân vòng lặp của
# `test_bang_them_sau_197_phai_bat_rls` KHÔNG chạy lần nào: nó xanh vì rỗng chứ
# không vì đúng, và `_ENABLE` có thể bị đổi thành một biểu thức không bao giờ
# khớp mà cả tệp vẫn xanh. Các ca dựng sẵn dưới đây bắt bộ dò phải làm việc ngay
# từ hôm nay (codex cục bộ #978).

def _classify(files: dict[str, str]) -> list[str]:
    """Chạy đúng logic của chốt trên một bộ tệp dựng sẵn."""
    enabled: set[str] = set()
    missing: list[str] = []
    for name in sorted(files):
        sql = _strip_sql_comments(files[name])
        enabled |= {t.lower() for t in _ENABLE.findall(sql)}
        # GỌI `_num` chứ không chép lại cách đọc số: chép lại thì phá `_num`
        # đi mà ca dựng sẵn vẫn xanh — đúng cái bẫy "ghim hàm nhưng quên ghim
        # chỗ gọi" (phá thử bắt ở #978).
        if _num(Path(name)) <= BLANKET:
            continue
        for tbl in {t.lower() for t in _CREATE.findall(sql)}:
            if tbl.startswith(("tmp_", "temp_")) or tbl in enabled:
                continue
            missing.append(f"{name}: {tbl}")
    return missing


def test_bo_do_chay_dung_tren_cac_ca_dung_san():
    assert _classify({"198_a.sql": "CREATE TABLE public.x (id uuid);"}) == ["198_a.sql: x"]
    assert _classify({"198_a.sql":
        "CREATE TABLE public.x (id uuid);\nALTER TABLE public.x ENABLE ROW LEVEL SECURITY;"}) == []
    # hậu tố chữ vẫn phải bị chặn
    assert _classify({"198b_a.sql": "CREATE TABLE public.y (id uuid);"}) == ["198b_a.sql: y"]
    # Bật ở migration SAU thì KHÔNG được tính. Giữa hai lần áp, một môi trường
    # dựng từ migration có bảng đó ĐANG HỞ — đúng khoảng trống chốt này sinh ra
    # để đóng. Luật là "bật ngay trong migration tạo nó".
    assert _classify({"198_a.sql": "CREATE TABLE public.z (id uuid);",
                      "199_b.sql": "ALTER TABLE public.z ENABLE ROW LEVEL SECURITY;"}) \
        == ["198_a.sql: z"]
    # trước mốc chặn thì migration 197 đã phủ
    assert _classify({"150_a.sql": "CREATE TABLE public.w (id uuid);"}) == []
    # cú pháp thật trong repo: định danh có nháy kép, IF NOT EXISTS, IF EXISTS
    assert _classify({'198_a.sql':
        'CREATE TABLE IF NOT EXISTS public."q" (id uuid);\n'
        'ALTER TABLE IF EXISTS public."q" ENABLE ROW LEVEL SECURITY;'}) == []


def test_bo_do_ENABLE_that_su_khop_cu_phap_dang_dung():
    """`_ENABLE` phải khớp các dòng CÓ THẬT trong repo — nếu không, chốt chính chỉ
    xanh vì không nhận ra dòng nào cả."""
    seen = set()
    for f in _files():
        seen |= {t.lower() for t in _ENABLE.findall(
            _strip_sql_comments(f.read_text(encoding="utf-8")))}
    assert len(seen) >= 20, f"chỉ nhận ra {len(seen)} lệnh bật RLS — biểu thức hỏng?"


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
