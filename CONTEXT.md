# Bối cảnh dự án Aver Learning

Aver phục vụ học viên luyện bốn kỹ năng IELTS, giáo viên giao và chấm bài, quản trị viên điều phối lớp, khóa học và kỳ thi. Tên GitHub `ielts-speaking-coach` có từ giai đoạn sản phẩm tập trung vào Speaking. [Bản đồ sản phẩm](docs/SITE_OVERVIEW.md)

| Thành phần | Nơi bắt đầu | Cách hệ thống vận hành |
|---|---|---|
| Giao diện | [frontend/app](frontend/app), [hướng dẫn frontend](frontend/AGENTS.md) | Next.js App Router, React và TypeScript trên Vercel. Trình duyệt gọi API qua transport dùng chung và kiểu sinh từ OpenAPI. Một số trang còn dùng controller JavaScript tương thích. |
| API và nghiệp vụ | [backend/main.py](backend/main.py), [routers](backend/routers), [services](backend/services) | FastAPI trên Railway. Router kiểm quyền và nhận yêu cầu. Service xử lý nghiệp vụ như giao bài, tạo lượt thi, lưu kết quả và chấm điểm. |
| Danh tính và dữ liệu | [migration và sổ theo dõi](backend/migrations/README.md) | Supabase Auth cung cấp danh tính, PostgreSQL lưu dữ liệu, Storage giữ tệp. Bản thu Speaking và ảnh đề Writing là dữ liệu riêng tư. Backend xác thực quyền trước khi ký URL. |
| Chấm bài và âm thanh | [backend/config.py](backend/config.py), [định tuyến nhà cung cấp](docs/AI_PROVIDER_ROUTING.md) | Cấu hình và dịch vụ điều phối quyết định mô hình, phương án dự phòng và ghi nhận sử dụng. |
| Đặc tả và phát hành | [specs](specs/README.md), [quy trình staging](docs/STAGING_FIRST_RELEASE_FLOW.md) | Spec đã duyệt xác định hành vi. PR được tích hợp vào staging. Khi promote, đội đối chiếu CI, smoke và quyền áp dụng migration ở đúng commit được chọn. |

Mã ứng dụng và lịch sử review nằm ở repo này. Kho tiến độ riêng lưu bằng chứng theo mảng cho các team dùng máy khác. Khi nhận việc, mở trang của mảng và đối chiếu với PR hiện hành. [Tổng quan tiến độ](https://github.com/andyvinhtran1212-netizen/aver-tien-do)
