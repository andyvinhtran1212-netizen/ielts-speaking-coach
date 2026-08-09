"""Bộ test phải chạy được khi RÚT MẠNG — và điều đó phải được RÀNG BUỘC.

Ngày 08/08 `tests/smoke/test_gemini_smoke.py` chạy khoảng 24 lượt trong một
ngày: mỗi lần `pytest tests/` chạy tay, và mỗi lần `git push` (hook pre-push
gọi cả bộ; kể cả push XOÁ NHÁNH). Cơ chế loại trừ khi ấy là một câu dặn trong
docstring — "excluded via the developer's invocation" — tức là không có gì
trong mã chặn nó. Không ai biết cho tới khi chủ dự án nhìn thấy bài văn mẫu
trong log của Google và hỏi "ai nộp bài này?".

Ba chốt ở đây ghim HÀNH VI, không ghim tên hàm: chúng thử gọi thật rồi đòi bị
chặn. Gỡ chốt trong conftest là ba ca này đỏ.

VÌ SAO PHẢI CÓ CẢ CHỐT SDK, KHÔNG CHỈ CHỐT SOCKET: SDK Gemini đi bằng gRPC —
thư viện C tự mở kết nối ở tầng dưới, KHÔNG đụng `socket.socket.connect` của
Python. Tôi đã chạy chính test smoke dưới chốt socket: nó vẫn gọi tới Google và
vẫn pass sau 40 giây. Một lượt quét chỉ dựa vào socket báo "sạch" cho đúng cái
đường đang tiêu tiền.
"""

from __future__ import annotations

import configparser
import pathlib
import socket
import subprocess
import sys

import pytest


def test_an_outbound_tcp_connection_is_refused():
    with pytest.raises(RuntimeError, match="gọi ra ngoài"):
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect(("example.com", 80))


def test_calling_gemini_for_real_is_refused():
    """Đường mà chốt socket KHÔNG thấy."""
    genai = pytest.importorskip("google.generativeai")
    model = genai.GenerativeModel("gemini-2.5-flash")
    with pytest.raises(RuntimeError, match="Gemini THẬT"):
        model.generate_content("xin chào")


def test_dns_lookups_are_refused_too():
    """Chặn mỗi `connect` là chưa đủ.

    `socket.create_connection` giải tên miền TRƯỚC khi connect, nên một resolver
    chậm hoặc đứt mạng vẫn làm bộ test treo — đúng cảnh "mất mạng thì bộ test
    TREO chứ không đỏ" đã ghi trong ghi chú dự án.
    """
    with pytest.raises(RuntimeError, match="tra tên miền"):
        socket.create_connection(("example.com", 80), timeout=1)


def test_no_marker_expression_can_smuggle_the_paid_test_back_in():
    """`-m` trên dòng lệnh GHI ĐÈ `addopts`, nên chốt thật phải nằm ở hook thu
    thập. `pytest -m asyncio` là một câu lệnh bình thường, và test smoke có
    mang marker `asyncio` (codex cục bộ 08/08 vòng 2)."""
    root = pathlib.Path(__file__).resolve().parents[1]
    # `-rs` để LÝ DO bỏ qua hiện ra: "1 skipped" một mình không chứng minh nó
    # bị chính cổng của ta chặn — nó có thể bỏ qua vì bất cứ lý do nào khác.
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/smoke", "-m", "asyncio", "-q", "-rs"],
        cwd=root, capture_output=True, text=True, timeout=180,
    )
    assert "1 skipped" in r.stdout, (
        "test tốn tiền lọt qua bằng một biểu thức marker khác:\n" + r.stdout[-800:])
    assert "--run-smoke" in r.stdout, (
        "bị bỏ qua vì lý do KHÁC, không phải vì cổng của ta:\n" + r.stdout[-800:])


def test_the_documented_opt_in_command_actually_runs_it():
    """Một cổng thì phải mở được bằng chính chìa của nó.

    Bản trước có HAI cổng đánh nhau: `addopts = -m "not smoke"` loại test smoke
    TRƯỚC khi hook `--run-smoke` kịp cho phép, nên câu lệnh có chủ ý ghi trong
    tài liệu lại không chạy được gì (codex cục bộ 08/08 vòng 3).

    Chỉ THU THẬP, không chạy — chạy là tốn tiền thật.
    """
    root = pathlib.Path(__file__).resolve().parents[1]
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/smoke", "--run-smoke",
         "--collect-only", "-q"],
        cwd=root, capture_output=True, text=True, timeout=180,
    )
    assert "1 test collected" in r.stdout, r.stdout[-800:]


def test_the_gemini_guard_is_armed_at_import_too():
    """Cùng lý do với chốt DNS: lời gọi lúc THU THẬP xảy ra trước mọi hook, và
    gRPC là đường chốt socket không thấy."""
    root = pathlib.Path(__file__).resolve().parents[1]
    r = subprocess.run(
        [sys.executable, "-c",
         "import sys; sys.path.insert(0, 'tests'); import conftest;\n"
         "import google.generativeai as genai;\n"
         "genai.GenerativeModel('gemini-2.5-flash').generate_content('x')"],
        cwd=root, capture_output=True, text=True, timeout=180,
    )
    assert r.returncode != 0 and "Gemini THẬT" in r.stderr, r.stderr[-600:]


def test_livenet_opens_the_network_but_not_the_paid_providers():
    """`livenet` nói "tôi cần Supabase thật", KHÔNG nói "tôi được tiêu tiền"."""
    src = (pathlib.Path(__file__).resolve().parents[1] / "tests" / "conftest.py").read_text()
    assert '_set_gemini(blocked=item.get_closest_marker("smoke") is None)' in src, (
        "gộp hai quyền làm một là để một test RLS vô tình gọi API tính tiền"
    )


def test_the_marker_help_advertises_a_command_that_actually_runs():
    """`pytest --markers` là chỗ người ta ĐỌC để biết cách chạy.

    Bản trước còn một đăng ký thứ hai trong tests/smoke/conftest.py chỉ lệnh
    `pytest tests/smoke -m smoke` — làm đúng theo nó thì test bị bỏ qua và
    pytest vẫn báo XANH, tức là tin rằng đã kiểm bộ chấm thật trong khi nó chưa
    từng chạy (codex #1015).
    """
    root = pathlib.Path(__file__).resolve().parents[1]
    r = subprocess.run([sys.executable, "-m", "pytest", "tests/smoke", "--markers"],
                       cwd=root, capture_output=True, text=True, timeout=120)
    smoke_lines = [l for l in r.stdout.splitlines() if l.startswith("@pytest.mark.smoke")]
    assert len(smoke_lines) == 1, ("marker `smoke` được khai báo ở hai nơi — kiểu "
                                   f"gì cũng có một cái trôi:\n{smoke_lines}")
    assert "--run-smoke" in smoke_lines[0], smoke_lines[0]
    # Nguyên văn câu chỉ dẫn CŨ. Không cấm cụm `-m smoke` nói chung: mô tả hiện
    # tại cố ý nhắc nó để CẢNH BÁO rằng dùng một mình sẽ báo xanh giả.
    assert "opt-in via" not in smoke_lines[0], "câu chỉ dẫn cũ đã quay lại"


def test_every_marker_description_is_a_single_line():
    """`markers` trong pytest.ini là danh sách theo DÒNG.

    Một mô tả xuống dòng biến phần đuôi thành một marker riêng — bản trước của
    tôi làm đúng thế và `pytest --markers` in ra `@pytest.mark.chạy bằng ...`.

    Ghim ở NGUỒN chứ không dò kết xuất của pytest: marker dựng sẵn của pytest có
    dấu cách trong danh sách tham số (`skipif(condition, ..., *, reason=...)`),
    nên mọi phép dò trên dòng in ra đều báo nhầm chúng.
    """
    ini = configparser.ConfigParser()
    ini.read(pathlib.Path(__file__).resolve().parents[1] / "pytest.ini")
    for line in ini["pytest"]["markers"].strip().splitlines():
        name = line.split(":", 1)[0]
        assert name and " " not in name.strip(), (
            f"dòng này không mở đầu bằng `tên_marker:` nên nó thành một marker "
            f"riêng: {line!r}")


def test_the_guard_is_armed_before_any_test_module_is_imported():
    """Chốt phải sống từ lúc IMPORT, không phải từ lúc test chạy.

    Import `main` là dựng `vocab_service`, và nó truy vấn Supabase ngay lúc
    import — tức là trong lúc pytest còn đang thu thập, trước khi mọi fixture
    kịp chạy (codex cục bộ 08/08 vòng 3, P1).
    """
    root = pathlib.Path(__file__).resolve().parents[1]
    r = subprocess.run(
        [sys.executable, "-c",
         "import sys; sys.path.insert(0, 'tests'); import conftest, socket;\n"
         "socket.getaddrinfo('example.com', 80)"],
        cwd=root, capture_output=True, text=True, timeout=120,
    )
    assert r.returncode != 0 and "tra tên miền ra ngoài" in r.stderr, (
        "chỉ cần import conftest là chốt phải dựng xong:\n" + r.stderr[-600:])
