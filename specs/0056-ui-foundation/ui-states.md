# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| `PublicShell` | khung hiện ngay, không chờ API | không có nội dung trang → `PageState` empty | Thư viện · Khoá học · Đăng nhập · "Xem các khoá"; chân trang đầy đủ | lỗi trang dùng `PageState` error có nút thử lại | không cần đăng nhập | ≥1024 một hàng; <768 menu, slot `mobileExtraItem`; sáng/tối theo 5.9; focus vòng 3px |
| `LearnerShell` | nút tài khoản và `AiCreditsIndicator` hiện khung chờ, không số giả | tài khoản chưa có khoá: vẫn 5 mục, chỗ lượt AI hiện "Chấm thử hôm nay còn N bài" hoặc ẩn | 5 mục, mục đang ở gạch 3px + chữ đậm + `aria-current` | API lượt lỗi → ẩn chỉ báo, không hiện 0 | "Đổi vai trò" chỉ khi máy chủ xác nhận admin, không chừa chỗ trống | ≥1024 một hàng; 768–1023 "Menu: <mục>"; <768 thanh dưới 64px, ẩn khi bàn phím ảo mở |
| `FocusShell` | slot phải hiện trạng thái lưu "Đang lưu…" | — | thanh luyện (giấy, tiếng Việt) hoặc thi (mực, tiếng Anh), không trộn nhãn | thoát khi còn bài chưa lưu → `LeaveConfirm` | — | phòng thi full test luôn sáng (00 điểm 17); không chân trang |
| `StaffShell` | sidebar số đếm hiện khung chờ | nhóm không có việc chờ → không hiện số | nhãn môi trường không bao giờ ẩn, nhãn vai trò "Quản trị"/"Giáo viên" | số đếm lỗi → "—" kèm `title` giải thích, không 0 | khu admin chỉ cho admin (máy chủ quyết) | <1200 sidebar chỉ icon có `aria-label`; <768 ngăn kéo; dòng 36/44px |
| Component `components/ui/*` | `Button` loading, `DataTable` loading, `PageState` loading `role="status"` | `PageState` empty, `DataTable` emptyState | theo cột "Trạng thái phải có" bảng 5.4 | `TextField` error có `aria-describedby`, `Notice` error có nhãn chữ "Lỗi" | `PageState` locked | AA, vùng bấm 44px (admin 36px), bàn phím, sáng/tối |

Bảng trạng thái chi tiết của gói, chép nguyên:

### Component (5.4)

Quy ước chung: mỗi component nhận `className?` để ghép; không nhận `style` tuỳ ý; nhãn là `string` tiếng Việt mặc định, riêng component có chế độ thi nhận `lang: 'vi' | 'en'` và mọi nhãn mặc định đổi theo `lang`. Dữ liệu chưa chốt hiển thị qua `PendingValue` (chữ `XXX`). Màu không bao giờ là tín hiệu duy nhất.

| # | Component | Tờ (mục) | Props chính | Trạng thái phải có |
|---|---|---|---|---|
| 1 | `Button` | ThanhPhan §1 | `variant: 'primary'\|'secondary'\|'text'\|'danger'`, `size: 'lg'\|'md'\|'sm'` (48/44/36), `loading?`, `loadingLabel?` ("Đang nộp…"), `disabled?`, `type`, `iconStart?`, `href?` (thành `<a>`) | mặc định, rê chuột, focus bàn phím, đang xử lý (`aria-disabled`, giữ độ rộng), vô hiệu. `danger` chỉ được dùng trong `ConfirmDialog`/`Notice` cảnh báo (ghi trong JSDoc) |
| 2 | `IconButton` | §1 | `icon`, `label` (bắt buộc, thành `aria-label`), `size` | như Button |
| 3 | `Icon` | — | `name: IconName`, `size: 16\|20\|22\|24`, `title?` (không có → `aria-hidden`) | — |
| 4 | `TextField` | §2 | `label`, `hint?`, `error?`, `readOnlyReason?`, `value`, `onChange`, `type`, `placeholder?` | thường, đang nhập (viền 2px), lỗi (chữ lỗi nói cách sửa, `aria-describedby`), chỉ đọc kèm lý do |
| 5 | `TextArea` | §2 | `label`, `saveStatus?` ("Đã lưu lúc 10:42"), `wordCount?: {count, limit}`, `error?` | như TextField + đếm từ |
| 6 | `Select` | §2 | `label`, `options: {value,label}[]`, `value`, `onChange` | dùng `<select>` gốc, style lại |
| 7 | `SearchField` | §2 | `label` (ẩn bằng mắt, còn cho trình đọc), `onSearch` | rỗng, có chữ (nút xoá) |
| 8 | `ChoiceGroup` | §2 | `mode: 'single'\|'multiple'`, `legend`, `options`, `value`, `onChange` | radio/checkbox gốc trong `<fieldset>` |
| 9 | `StatusBadge` | §3 | `set: 'work'\|'content'\|'access'`, `value` (khoá enum), `detail?` ("2 ngày") | Bộ chữ cố định từ tờ: work = Chưa làm · Đang làm · Đã nộp · chờ chấm · Đã chấm · Đã trả bài · Quá hạn; content = Bản nháp · Đã phát hành · Lưu trữ; access = Đang học · Sắp hết hạn · Hết hạn · Đã khoá |
| 10 | `Notice` | §4 | `kind: 'info'\|'success'\|'warning'\|'error'`, `title?`, `children`, `action?`, `lang?` | cảnh báo/lỗi: viền trái dày, nền nhạt, icon tam giác/tròn, nhãn chữ "Cảnh báo"/"Lỗi" ("Warning"/"Error" khi `lang='en'`) |
| 11 | `Dialog` | ThanhPhanDuLieu §6 | `open`, `title`, `onClose`, `variant: 'modal'\|'drawer'`, `busy?`, `children`, `actions` | dùng `<dialog>` gốc + `showModal()`; Esc, nút đóng, bấm nền; focus vào trong, trả về nút mở (dùng `useDialogFocus`) |
| 12 | `ConfirmDialog` | ThanhPhan §4 | `tone: 'default'\|'warning'`, `lang`, `title` (là câu hỏi), `body`, `confirmLabel` (lặp động từ của câu hỏi), `cancelLabel`, `onConfirm`, `busy?` | cảnh báo: nút xác nhận `danger`; mặc định: nút chính là "ở lại" khi dùng cho thoát |
| 13 | `PageState` | ThanhPhan §5 | `kind: 'empty'\|'error'\|'loading'\|'locked'`, `title`, `body`, `action?` | 4 kiểu như tờ; `loading` có `role="status"` và chữ |
| 14 | `MediaPlaceholder` + `PendingValue` | §5 | `kind: 'illustration'\|'video'\|'chart'`, `ratio`, `caption` · `PendingValue` không props (in `XXX`, có `title="Chưa chốt"`) | — |
| 15 | `Tabs` | §6 | `items: {id,label,count?,href?}[]`, `active`, `onChange?` | `tablist/tab/tabpanel` khi không có `href`; điều hướng thì là `<nav>` liên kết |
| 16 | `Breadcrumb` + `BackLink` | §6, KhungTrang §5 | `items: {label, href?}[]` · `parentLabel`, `href` | ≥768px breadcrumb; <768px chỉ "‹ {trang cha}"; không bao giờ cả hai |
| 17 | `Pagination` | §6 | `page`, `totalPages`, `totalLabel` ("549 đề"), `hrefFor(page)` | trang đầu/cuối vô hiệu nút tương ứng |
| 18 | `DataTable` | DuLieu §1–2 | `columns: {key,label,align?,sortable?}[]`, `rows`, `rowKey`, `density: 'comfortable'\|'dense'` (52/40), `selectable?`, `sort?`, `onSort?`, `filters?` (chip), `bulkActions?`, `emptyState`, `loading?` | trống, đang tải, có chọn nhiều (thanh hành động), điện thoại thành thẻ; số căn phải `font-variant-numeric: tabular-nums`; ô trống ghi "chưa có" |
| 19 | `StatCard` | DuLieu §3 | `value`, `label`, `comparison` (câu chữ, không màu xanh/đỏ) | — |
| 20 | `Chart` | DuLieu §4 | `type: 'bar'\|'line'`, `title` (câu kết luận), `unit`, `source`, `data: {label, value}[]` | SVG tự vẽ (không chart.js), luôn có bảng số liệu ngay dưới |
| 21 | `ProgressBar` | DuLieu §5 | `mode: 'determinate'\|'indeterminate'\|'steps'`, `value?`, `total?`, `label` | luôn có chữ tiến độ |
| 22 | `FileUpload` | DuLieu §7 | `accept`, `maxSizeMb`, `files: {name, status, error?}[]`, `onAdd`, `onRemove` | nói trước định dạng/cỡ; mỗi file một dòng trạng thái bằng chữ |
| 23 | `Stepper` | DuLieu §8 | `steps: {label, status: 'done'\|'current'\|'todo'\|'locked'}[]` | tên bước là động từ |
| 24 | `DateField` / `TimeField` / `DateRangeField` | DuLieu §9 | `label`, `value` (ISO), `onChange`, `min?`, `max?` | gõ tay `dd/mm/yyyy`, giờ `hh:mm` 24h, tuần bắt đầu thứ Hai; điện thoại: tấm trượt đáy, nút "Xong"; không dùng `<input type="date">` |
| 25 | `BandScore` (+ `CriteriaList`, `OverallBlock`) | HocTap §1 | `size: 'lg'\|'md'\|'row'\|'phone'`, `state: 'ready'\|'insufficient'\|'grading'`, `skill`, `band?`, `basis` ("Dựa trên 1 bài, 268 từ"), `previous?: {band, date}`, `criteria?: {name, band, note}[]`; `OverallBlock`: `skills: {name, band \| null}[]`, `missing: string[]` | luôn có dòng "Điểm ước lượng, không phải điểm thi"; `insufficient` không có số; so sánh bằng chữ ("Cao hơn lần trước 0.5 band (6.0, bài ngày 02/11)"); Overall chỉ có số khi đủ 4 kỹ năng |
| 26 | `Timer` | HocTap §4 | `mode: 'countdown'\|'countup'`, `seconds`, `lang`, `thresholds: {at, label}[]` | không nhấp nháy; chữ đổi ở mốc ("5 minutes left", "Còn 15 giây"); `aria-live` đọc đúng một lần mỗi mốc; số đều cột |
| 27 | `QuestionPalette` | HocTap2 §5 | `lang`, `items: {num, state: 'unanswered'\|'answered'\|'flagged'\|'current'\|'correct'\|'wrong'\|'blank'}[]`, `onSelect` | mỗi trạng thái khác nền/viền/biểu tượng + tên đọc đầy đủ; số ghi "Q5" khi `lang='en'` |
| 28 | `VocabEntry` | HocTap2 §6 | `variant: 'full'\|'popover'`, `headword`, `ipa`, `pos`, `defEn`, `defVi`, `example`, `collocations`, `audio?` | thứ tự cố định theo tờ; IPA trong `.av2-ipa` |
| 29 | `AnnotatedText` | HocTap2 §7 | `segments: {text, mark?: 1\|2\|3\|4, note?: number}[]`, `notes: {number, label, body}[]` | 4 kiểu gạch khác nhau + số chú thích + nhãn chữ ở lề; màu là lớp thứ ba |
| 30 | `Figure` | HocTap2 §8 | `children` (SVG), `caption`, `alt` | nét mảnh, viền 1px, chữ trong hình dùng hai họ chữ của trang |
| 31 | `AudioPlayer` (giao diện) | HocTap §2 | `variant: 'full'\|'compact'\|'phone'\|'once'`, `state: 'loading'\|'ready'\|'playing'\|'paused'\|'error'\|'locked'`, `current`, `duration`, `speed`, `loop?: {a,b}`, `onPlay/onPause/onSeek/onSpeed/onSetA/onSetB/onClearLoop/onRetry`, `mode: 'practice'\|'exam'` | nút Phát luôn có chữ; `exam`/`once` không có A–B; `once` có màn "chỉ nghe một lần" và "Đã nghe · đã khoá"; lỗi nói câu trả lời vẫn còn |
| 32 | `VideoFrame` (giao diện) | HocTap §3 | `source: 'youtube'\|'self'`, `title`, `meta`, `state: 'idle'\|'loading'\|'playing'\|'error'\|'locked'`, `resumeAt?`, `embedUrl?`, `transcriptHref?` | YouTube nhúng chế độ không cookie (`youtube-nocookie.com`), không vẽ nút đè; video không tự phát |

Bảng có 32 dòng vì tách nhỏ cho rõ; theo cách gom của tờ (các ô nhập là một họ, ba ô ngày là một họ) là khoảng 25 thành phần.

`AudioPlayer`/`VideoFrame` chỉ là giao diện điều khiển bằng props; không tự tạo `<audio>`/`<video>`. G07/G08 nối với vòng đời phát hiện có (quy tắc `frontend/AGENTS.md`: giữ nguyên vòng đời trình phát).

### Khung trang (5.5)

| Khung | Thành phần con | Props | Tờ |
|---|---|---|---|
| `PublicShell` | `PublicTopNav` (Thư viện · Khoá học · "Đăng nhập" liên kết chữ · nút chính "Xem các khoá"; điện thoại: "Đăng nhập" ngoài menu, còn lại trong menu, thêm slot `mobileExtraItem` cho mục "Chấm thử" của G05-T21), `PublicFooter` (Giới thiệu · Khoá học · Thư viện · Điều khoản · Quyền riêng tư · Liên hệ · ©) | `active?: 'library'\|'courses'`, `mobileExtraItem?: {label, href}`, `children` | KhungTrang §4, KhungTrang2 §9 |
| `LearnerShell` | `LearnerTopNav` (5 mục), `TabletMenu` (768–1023px, nút "Menu: {mục}", danh sách đẩy nội dung xuống, dòng 48px), `BottomTabBar` (<768px, 64px, 5 ô, icon 22px, chữ 12px, ẩn khi `focus` hoặc bàn phím ảo mở), `AiCreditsIndicator` (`credits: {remaining: number\|null, low: boolean}`; `null` → `PendingValue`; "Sắp hết · còn N lượt" khi `low`), `OverdueSlot` + `NotificationsSlot` (chỗ đặt thẻ "N quá hạn" và chuông — component thật do G11-T11 dựng và truyền vào; không truyền thì không chiếm chỗ), `QuickLookup` (nút kính lúp + ô tra, từ 768px; nhận `lookup(query) → Promise<{group, items}[]>`), `AccountMenu` (popover 288px máy tính; tấm trượt đáy điện thoại), `CompactFooter` (© · Trợ giúp · Điều khoản · Quyền riêng tư), `RedirectNotice` (dải dưới thanh, như G02 nhưng giao diện mới) | `user: {name, email, initials}`, `canSwitchToAdmin: boolean` (lấy từ hồ sơ máy chủ `/auth/me`, không suy ở client), `credits` (một con số chung; `null` → `PendingValue`), `trialLeft?: number|null` (tài khoản chưa có khoá: "Chấm thử hôm nay còn N bài"), `notificationsSlot?: ReactNode`, `overdueSlot?: ReactNode`, `lookup?`, `children`. Khung không có prop cổng kích hoạt: chạy được với tài khoản `is_active=false` (FR-016). Mục đang ở **không** là prop: suy từ `usePathname()` + `route-registry` | KhungTrang §1–3, KhungTrang2 §9–10 |
| `FocusShell` | `FocusBar` (trái: thoát; giữa: tên bài, cắt "…"; phải: slot đồng hồ/tiến độ/trạng thái lưu), `LeaveConfirm` (dựa trên `ConfirmDialog`) | `mode: 'practice'\|'exam'`, `title`, `exitHref`, `hasUnsavedWork: () => boolean`, `right: ReactNode`, `bottom?: ReactNode` (bảng câu hỏi), `children` | KhungTrang §6 |
| `StaffShell` | `StaffTopBar` (tên · nhãn vai trò "Quản trị"/"Giáo viên" · `EnvBadge` · ô tìm nhanh ⌘K · "Xem như học viên" · `ThemeMenu` Sáng · Tối · Theo thiết bị · nút tài khoản có Đổi vai trò, Đăng xuất), `StaffSidebar` (nhóm gập/mở, mục con thụt 10px trên đường dọc mảnh, số việc chờ màu `--av2-mark`, nhóm thu cộng dồn, dòng 36px; <1200px chỉ icon — gồm 1024px, FR-018), `StaffDrawer` (<768px, dòng 44px, nhãn môi trường thành dải ngang), `QuickSearch` (giao diện; nhận `search(query) → Promise<{group, items}[]>`) | `role: 'admin'\|'instructor'`, `nav: StaffNavGroup[]` (G09 cung cấp; G03 dùng dữ liệu mẫu trong `/ui-library`), `environment: 'production'\|'staging'\|'local'`, `user`, `children` | KhungTrang2 §7–8 |

- `EnvBadge` lấy môi trường từ `window.__AVER_RUNTIME_CONFIG__.environment` (khai ở `public/js/runtime-config.js` dòng 5, sinh bởi `tooling/generate-runtime-config.mjs`). CHƯA KIỂM giá trị chính xác cho staging (`preview`?) — người thực thi đọc `tooling/runtime-origins.mjs` và ánh xạ: `production` → "Production · dữ liệu thật", còn lại → "Staging · dữ liệu thử".
- Đổi vai trò, đăng xuất: dùng lại logic đăng xuất của thanh cũ (đọc `aver-chrome.js` phần `user-menu-logout` và `tests/react/chrome-logout-*.test.tsx`), không viết luồng đăng xuất mới.

### Chế độ tối (5.9)

Tờ thiết kế: `thiet-ke/CheDoToi.dc.html` (quy cách), `CheDoToiHocVien.dc.html`, `CheDoToiCongKhaiAdmin.dc.html`. Lý do: web hiện tại đã có sáng/tối cho mọi trang (`frontend/public/css/aver-design/tokens.css`, khoá `av-theme`, đoạn chống nháy trong `components/authed-shell.tsx` và ba layout công khai); dựng lại mà chỉ có sáng là làm mất tính năng của người đang dùng.

**Giá trị token** (bảng màu Navy + đỏ mận; tương phản tính theo WCAG, chữ/nền ghi ở cột cuối):

| Token | Sáng | Tối | Tương phản sáng / tối |
|---|---|---|---|
| `--av2-paper` | `#FAF6EF` | `#1C1A16` | ink trên paper 16.15 / 13.97 |
| `--av2-surface` | `#FFFFFF` | `#24211C` | ink trên surface 17.40 / 12.90 |
| `--av2-off` | `#E8E2D5` | `#2F2B25` | muted trên off 5.32 / 6.02 |
| `--av2-ink` | `#1B1A17` | `#EDE6D6` | — |
| `--av2-muted` | `#5E5A52` | `#B2A994` | muted trên paper 6.37 / 7.44 |
| `--av2-rule` | `#D8D0C0` | `#3F3A31` | chỉ trang trí |
| `--av2-accent` | `#1A3561` | `#A3B8DF` | chữ trên accent 12.17 / 8.67 |
| `--av2-accent-hover` | `#11254A` | `#C0D0EC` | 15.14 / 11.15 |
| `--av2-link` | `#1A3561` | `#AFC3E8` | link trên paper 11.30 / 9.76 |
| `--av2-mark` | `#8A1C1C` | `#E8A29A` | mark trên paper 8.61 / 8.33 |
| `--av2-danger` | `#9B1C1C` | `#F2958B` | danger trên surface 8.15 / 7.22 |
| `--av2-ok` | `#1F6B3A` | `#93CBA3` | ok trên surface 6.52 / 8.64 |
| `--av2-tint` | `#EEF0F5` | `#262A33` | ink trên tint 15.26 / 11.56 |
| `--av2-on-accent` (thay `--av2-on-dark`) | `#FFFFFF` | `#1C1A16` | — |
| `--av2-highlight` (mới) | `#F6E3A1` | `#655120` | ink trên highlight 13.61 / 6.14 |
| `--av2-warn-bg` (mới) | `#F7EFEF` | `#3C302B` | mark trên nền 8.19 / 6.10 |
| `--av2-error-bg` (mới) | `#F8EFEF` | `#3D2F29` | danger trên nền 7.21 / 5.77 |
| `--av2-ok-bg` (mới) | `#EFF5F1` | `#31352C` | ok trên nền 5.90 / 6.75 |
| `--av2-qr-bg` / `--av2-qr-ink` (mới) | `#FFFFFF` / `#111111` | giữ nguyên | QR luôn nền trắng |
| `--av2-logo-mark` (mới) | `var(--av2-mark)` | `var(--av2-ink)` | logo một màu ở tối |

Các con số trên do người thiết kế tính; người thực thi phải tính lại bằng test (FR-022) chứ không tin bảng.

**Đã được anh Andy duyệt ngày 17/11/2026:** FR-020 và FR-021 (ba lựa chọn Sáng · Tối · Theo thiết bị thay nút lật hiện nay; lưu trên trình duyệt), FR-024 (các vùng luôn sáng). FR-025: phòng thi full test luôn sáng (phương án A) — đã chốt.

**Yêu cầu:**
- **FR-019** Mọi token màu v2 có giá trị cho `:root[data-theme="light"]`, `:root[data-theme="dark"]`, và khối `@media (prefers-color-scheme: dark) { :root:not([data-theme]) }` (cho lúc JS chưa chạy). Cấu trúc này chép từ `tokens.css` cũ.
- **FR-020** Thứ tự ưu tiên giữ như cũ: giá trị `av-theme` đã lưu (`light` | `dark`) → `prefers-color-scheme` → sáng. "Theo thiết bị" = XOÁ khoá `av-theme` (không thêm giá trị thứ ba), để đoạn chống nháy đang có không phải sửa.
- **FR-021** Component `ThemeMenu` có ba lựa chọn Sáng · Tối · Theo thiết bị; đổi là áp ngay; các tab khác đổi theo qua sự kiện `storage`; khi đang "Theo thiết bị" thì nghe thay đổi của `prefers-color-scheme`. Vị trí: menu tài khoản của `LearnerShell` và trang Tài khoản; nút biểu tượng trên `PublicShell` và `StaffShell`; trong menu trên điện thoại. Dùng lại `frontend/public/js/theme-toggle.js` / `lib/theme-toggle.mjs` (`setStoredTheme(null)` đã có sẵn).
- **FR-022** Test tự động tính tương phản WCAG cho các cặp chữ/nền ở bảng trên, cả sáng và tối: chữ thường ≥ 4.5, chữ lớn và viền thành phần ≥ 3. Test đọc giá trị từ file token, không ghi lại số.
- **FR-023** Trong CSS v2 không có mã màu ngoài file token; không dùng `opacity` để tạo màu phụ. Có test quét (dùng lại cách quét của G03-T11).
- **FR-024** Luôn sáng dù web đang tối: thư email, bản in (`@media print`), vùng mã QR thanh toán, ảnh đề Task 1 (thêm viền). Cách làm: lớp bọc đặt lại bộ biến sáng.
- **FR-025** Phòng thi full test: LUÔN SÁNG (phương án A, đã chốt); viết thành một cờ cấu hình `EXAM_ROOM_FOLLOWS_THEME=false` để đổi sang phương án B không phải sửa mã. Bài kiểm tra của khoá và luyện từng phần theo chế độ của web. Không đụng hộp Settings riêng của phòng thi Reading (khoá `ielts-exam-theme`).
- **FR-026** Thẻ `meta name="theme-color"` có hai giá trị theo chế độ.
- **FR-03-D9** Trang cũ chưa dựng lại vẫn dùng bộ `--av-*` cũ và giữ sáng/tối như hiện nay; hai cây dùng chung `data-theme` nên đổi chế độ áp cho cả hai.
