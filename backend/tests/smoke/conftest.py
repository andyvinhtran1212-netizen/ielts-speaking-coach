"""Marker registration for smoke tests.

LỊCH SỬ: bản đầu ghi rằng smoke bị loại "via the developer's invocation
(e.g. `pytest tests/ --ignore=tests/smoke`)" — tức là trông vào việc người chạy
NHỚ gõ thêm cờ. Không ai nhớ, và ngày 08/08 nó chạy ~24 lượt trong một ngày.

Nay cổng thật nằm ở `pytest_collection_modifyitems` trong tests/conftest.py và
đòi cờ `--run-smoke`; marker vẫn khai báo ở pytest.ini. Tệp này giữ lại phần
đăng ký marker cho ca chạy thẳng thư mục con.
"""


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "smoke: live API tests; cost real money; opt-in via "
        "`pytest tests/smoke -m smoke`",
    )
