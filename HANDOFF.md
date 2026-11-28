# Bàn giao điều phối Aver Learning

**Mốc đối chiếu ngày 28/11/2026, giờ Việt Nam.** Staging ở `af3ffd1f`, main ở `b488d4ef`. Git ghép thử hai đầu cho đúng cây staging `98a7606d`. Lúc 18:09 có 75 PR mở, gồm 31 PR vào staging, 34 PR vào nhánh cha và 10 PR vào main. Kiểm lại GitHub trước khi nhận việc. [So sánh hai đầu](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/compare/b488d4ef...af3ffd1f)

| Người nhận | Hành động đầu tiên | Điều kiện kết thúc |
|---|---|---|
| Điều phối chính | Smoke `af3ffd1f` đã hoàn tất với 41 ca đạt và một ca bỏ qua. Kiểm riêng hai PR gốc #2641 và #2627 sau khi #2728 merge. | Chỉ đóng PR gốc sau khi đủ điều kiện trong [DECISIONS.md](DECISIONS.md). [Smoke #2561](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/46135625891) |
| phong_thi_sol | Theo #2728 tại `8a5bf99b`. Hai URL phải còn hoạt động là `/courses/[slug]/enroll` và `/enroll/[orderCode]`. | CI và review đạt, kiểm HOLD rồi merge đúng head vào staging. Ghi merge commit. |
| quan_tri_sol | Theo danh bạ #2576 tại `13dd354e` và hồ sơ #2587 tại `92fb9d5b`. | Đối chiếu biên nhận của ba thao tác ghi, quyền đọc hồ sơ, CI và review. Xin quyết định merge cho đúng SHA. |
| tai_khoan_sol | Theo lượt CI đầy đủ của #2727 và giữ HOLD riêng của #2729. | Báo kết quả CI Ready và các finding còn mở. [CI Ready #2727](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/46137968408) |

Trước khi thao tác, đọc [quy tắc chung](AGENTS.md), [việc đang mở](TASKS.md) và [quyết định đã có](DECISIONS.md). Worktree và dữ liệu kiểm thử trên máy Andy đặt dưới `/Volumes/Kingston SSD/Code`. Đội ở máy khác dùng repo GitHub và [kho tiến độ riêng](https://github.com/andyvinhtran1212-netizen/aver-tien-do). Khi đổi ca, thay mốc bàn giao bằng SHA mới, kết quả đã xác minh, quyết định còn chờ và hành động đầu tiên cho người nhận.
