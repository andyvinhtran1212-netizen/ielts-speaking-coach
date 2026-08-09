"""Ghi chú cho thư mục test tốn tiền thật.

LỊCH SỬ: tệp này từng tự đăng ký marker `smoke` kèm câu chỉ dẫn
`pytest tests/smoke -m smoke`. Sau khi cổng chuyển sang cờ `--run-smoke`
(08/08), câu ấy thành SAI theo kiểu nguy hiểm nhất: làm đúng theo nó thì test
bị bỏ qua và pytest vẫn báo XANH — người chạy tin rằng đã kiểm bộ chấm thật
trong khi nó chưa từng chạy (codex #1015).

Nên bỏ hẳn bản đăng ký ấy. Marker nay khai báo ở MỘT chỗ duy nhất là
`backend/pytest.ini`; hai nguồn sự thật cho cùng một câu chỉ dẫn thì kiểu gì
cũng có một cái trôi.

Cổng thật: `pytest_collection_modifyitems` trong `tests/conftest.py`, đòi cờ
`--run-smoke`.
"""
