# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Khung admin, sidebar 8 nhóm, danh bạ `/admin/learners`, hồ sơ 5 thẻ, Việc cần làm, Cài đặt, sự cố, chấm Writing | bảng và số đếm hiện khung chờ, không số giả | danh sách rỗng nói rõ lý do và việc kế tiếp; nhóm không có việc thì không hiện số | dữ liệu gốc của backend; mục đang ở có `aria-current` | nguồn lỗi chỉ đổi dòng đó thành cảnh báo "chưa có" + nút tải lại; `association_lookup_failed` hiện "⚠ lookup failed" | không phải admin → về trang cha kèm một dòng giải thích; giáo viên chỉ thấy lớp mình (API 404) | 1280/1024/390px; <1200 sidebar icon; <768 ngăn kéo; sáng/tối; bàn phím, ⌘K/Ctrl K |

Sau mỗi thao tác ghi, màn đọc lại API (không trạng thái lạc quan). Chữ: "giáo viên", không "giảng viên/thầy", không "đơn hàng/bán/giá".

Component frontend của gói (5.7):

| Component | Props chính | Trạng thái phải có |
|---|---|---|
| `AdminFrame` | `role: 'admin'\|'instructor'`, `environment`, `children` | đang tải quyền, bị từ chối, sẵn sàng; sidebar mở/thu/biểu tượng/ngăn kéo; sáng/tối |
| `AdminSidebar` | `groups`, `match`, `counts` | nhóm thu có badge; mục hiện tại; mục `available:false` |
| `AdminCommandPalette` | `scope` | rỗng, đang tìm, không thấy, lỗi mạng |
| `RecordPage` | `breadcrumb`, `title`, `meta`, `actions`, `tabs` | thẻ qua `?tab=` |
| `DangerZone` | `items: [{label, description, impactText, confirmPhrase?, reasonRequired?, onConfirm}]` | hộp xác nhận, gõ chuỗi, đang gửi, lỗi, cần step-up |
| `LearnerSummary` | `summary`, `actions` | đủ 7 trường; "chưa có bài", "chưa đặt" |
| `AssignDrawer` | `cohortId?`, `lessonId?`, `preselect?: {studentIds?, contentId?}`, `onDone` | chọn lớp; trùng (lớp, bài); bài kiểm tra hiện chế độ trả điểm; đã giao |
| `LegacyClassCreditsDialog` (T43; chưa có tờ thiết kế riêng, dựng từ hộp xác nhận của "Cấp thêm lượt") | `cohortId`, `onDone` | đang tải xem trước; không còn ai cần cấp ("Lớp này đã đo lượt"); nhập số lượt (trống, không hợp lệ); xác nhận; đang gửi; kết quả có danh sách bỏ qua; lỗi; cần step-up |
| `ThresholdsProvider` + `useThreshold(key)` | — | đang tải (không tô "quá hạn" khi chưa có ngưỡng), lỗi |
| `QueueRow` | `label`, `q: Q`, `href` | có việc, "Không có", lỗi nguồn + tải lại riêng, quá hạn |
| `AssignmentResultPage` (5 khối) | `cohortId`, `assignmentId` | chưa ai nộp (chỉ khối 1), mỗi khối một khung chờ, lỗi một khối |
| `ReleaseBoard` | `cohortId`, `assignmentId` | có/không dòng chọn; hộp hỏi lại; hẹn giờ |
| `ExamWizard`, `ExamRecord` (7 thẻ), `ProctorBar`, `ExamAnalysis`, `ExamRelease` | `examId` | theo ghi chú tờ AdminKyThi, AdminKyThiChiTiet |
| `ContentSkillPage` (4 thẻ), `BatchList`, `ReviewQueue`, `HiddenImportBanner` | `skill` | rỗng, đang tải, lỗi từng thẻ |
| `LearnerDirectory`, `LearnerRecord`, `CareNotes`, `EnrollmentQueue`, `EnrollmentDetail`, `CreditLedger`, `CodeLookup`, `IncidentInbox`, `SettingsPage`, `ReportsPage` | — | rỗng, đang tải, lỗi, một phần nguồn lỗi |
