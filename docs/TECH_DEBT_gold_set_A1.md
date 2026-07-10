# Tech debt: A1 — populate the grading gold set (teacher grading)

*Audit Giai đoạn 2 (#4). **PARKED / tech debt** (quyết định 2026-07-10): hạ tầng
harness đã xong (PR #702, `backend/eval/`), nhưng bước chấm mẫu của **giáo viên**
bị chặn bởi thời gian người-thật → hoãn, quay lại khi có giáo viên. Đây là NÚT
CỔ CHAI mở khoá #2, #8, #10.*

## Vì sao parked

`backend/eval/` chạy được, nhưng nó cần một **gold set** — mẫu do người chấm —
để có gì mà so. Không có dữ liệu tham chiếu, harness chỉ báo `n=0`. Bước tạo dữ
liệu này cần 2+ giáo viên bỏ giờ chấm, không tự động hoá được và không được bịa.

## Các bước khi quay lại (MVP 20 Speaking + 20 Writing)

1. **Lấy ứng viên** — chạy `backend/eval/sampling.sql` trong Supabase SQL editor.
   Nó trả slate **cân bằng** theo band bucket (low/mid/high) + cờ edge-case
   (zero-mistake-low, off-topic, short). Chủ ý giữ band thấp + ranh giới 6/7
   đậm; thêm essay sự cố `0caf5e59`.
2. **2+ giáo viên chấm ĐỘC LẬP** — mỗi người điền band từng tiêu chí cho mọi mẫu
   (Speaking FC/LR/GRA/P/overall; Writing TR/CC/LR/GRA/overall), **không** xem
   điểm AI và không xem của nhau. Chỗ nào lệch > 0.5 → thảo luận, chốt band, gắn
   tag "hard".
3. **Nạp vào `gold_speaking` / `gold_writing`** (migration 144). `rater_bands` =
   mảng JSON điểm từng giáo viên; `ref_*` = giá trị chốt harness so vào. Đặt
   `band_bucket` + `tags`. Audio Speaking → private bucket `gold-audio`.
4. **Chạy harness** — `python -m eval.run --module speaking|writing --source db`.
   Đóng băng report đầu tiên làm baseline.

Chi tiết đầy đủ: `docs/EVAL_HARNESS.md`.

## Mở khoá gì (đã có scaffolding, chỉ chờ dữ liệu)

| Finding | Việc còn lại sau khi có gold set |
|---|---|
| **#2** Azure→P | Fit isotonic từ subset có audio → drop bảng calibration vào chỗ pluggable đã dựng sẵn (`services/pron_calibration.py`), thay `1+s/100×8`. |
| **#8** FC word-timestamps | Bật flag `SPEAKING_WORD_TIMESTAMPS_ENABLED=true` → verify FC MAE giảm qua harness rồi mới mặc định ON. |
| **#10** cross-cal | Chạy cả hai module trên gold set, đối chiếu nghĩa "band 6.5". |
| **#1.5/#1.6/#1.7** speaking prompt | Descriptor kép positive+limitation; bỏ luật trừ cơ học GRA "lặp lỗi 2+ → −1 band"; model answer sát band học viên hơn. Đổi prompt → verify không regress qua harness. |
| **#2.2/#2.3** writing prompt | Đo lại bảng "typical mistake count" (sức ép 2 chiều) bằng gold set; auto-đề-xuất level theo band ước lượng thay vì theo gói mua. |

Các mục prompt (#1.5–1.7, #2.2–2.3) là refinement — CHỈ đổi sau khi harness có
baseline, để đo được có cải thiện hay không (audit: "đừng bay không đồng hồ").

## Resume trigger

Có **≥ 20+20** mẫu đã chấm 2-rater trong `gold_*` → chạy harness → làm #2/#8/#10,
rồi mới tới các refinement prompt. Dù chỉ 20+20 cũng đủ khởi động (con số nhỏ,
kappa chưa ổn định, nhưng đủ bắt lệch lớn + fit mapping thô).
