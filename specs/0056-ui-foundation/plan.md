# Implementation plan

## Architecture impact

Chỉ frontend. Cây giao diện mới nằm ở `frontend/styles/av2/`, `frontend/components/ui/` (component, icon, shell),
`frontend/lib/route-registry.mjs` và trang chẩn đoán `/ui-library`. `AuthedShell` thêm chế độ `design="v2"` nhưng không
dời dòng nào của cascade cũ (00 mục 4 điểm 11). Ranh giới giữa cây cũ và mới là tải lại trang đầy đủ. Không đổi backend,
dữ liệu hay route công khai đang có.

Ràng buộc riêng của gói (mục 8):

- Không đổi giao diện hay `<head>` của bất kỳ trang cũ nào (bằng chứng: so `<head>` ở T12).
- Token mới chỉ tiền tố `--av2-`; không sửa giá trị `--av-*`.
- Không emoji; chữ giao diện tiếng Việt; component có `lang` thì toàn tiếng Anh khi `lang='en'`.
- Không thêm dependency npm mới nếu chưa có quyết định của anh (mục 10, câu 4).
- Mọi giá, tên khoá, số lượt AI trong `/ui-library` là `XXX`.
- Dữ liệu mẫu trong `/ui-library` là tên giả (như trong tờ), không lấy học viên thật.

## Data and contracts

Không có dữ liệu lưu mới, không API mới. Hợp đồng là API component, token và danh mục trang — mục 5 của gói, chép nguyên:

### 5.1 Vị trí file

```
frontend/styles/av2/tokens.css        # token --av2-* trên :root (chỉ khai biến)
frontend/styles/av2/base.css          # luật phần tử, tất cả nằm dưới .av2-root
frontend/styles/av2/fonts.ts          # next/font: Source_Serif_4, Source_Sans_3
frontend/components/ui/<ten>.tsx      # mỗi component một file (kebab-case)
frontend/components/ui/<ten>.module.css
frontend/components/ui/icon/          # icon.tsx + icon-set.ts
frontend/components/ui/shell/         # public-shell, learner-shell, focus-shell, staff-shell + phần con
frontend/components/ui/index.ts       # export công khai
frontend/lib/route-registry.mjs       # danh mục trang
frontend/app/(ui-library)/ui-library/page.tsx
frontend/tests/react/ui/*.test.tsx    # test hành vi component
frontend/tests/route-registry.test.mjs
frontend/tests/visual/ui-library.spec.mjs   # Playwright ảnh chụp
frontend/tests/visual/__screenshots__/      # ảnh mốc (Linux)
frontend/playwright.visual.config.js
```

Lý do không đặt CSS mới vào `public/css`: mọi file ở đó bị nạp bằng `<link>` theo cascade cũ và bị các test quản trị quét theo luật cũ; CSS Module tự có phạm vi (tên class băm) nên không đụng luật toàn cục của `home.css`/`ds.css`.

### 5.2 Token v2 (`frontend/styles/av2/tokens.css`)

Giá trị lấy từ lớp `.pal-navy` có trong mọi tờ thiết kế và cỡ chữ/khoảng cách đo trong 6 tờ Thành phần.

| Nhóm | Token | Giá trị |
|---|---|---|
| Màu | `--av2-paper` `--av2-surface` `--av2-ink` `--av2-muted` `--av2-rule` `--av2-accent` `--av2-accent-hover` `--av2-link` `--av2-mark` `--av2-danger` `--av2-ok` `--av2-tint` `--av2-off` `--av2-on-dark` | `#FAF6EF` `#FFFFFF` `#1B1A17` `#5E5A52` `#D8D0C0` `#1A3561` `#11254A` `#1A3561` `#8A1C1C` `#9B1C1C` `#1F6B3A` `#EEF0F5` `#E8E2D5` `#FFFFFF` |
| Viền điều khiển | `--av2-control-border` | `var(--av2-muted)` — `--av2-rule` chỉ đạt 1,42:1 trên giấy, không đủ 3:1 cho viền ô nhập/ô chọn (WCAG 1.4.11); `--av2-rule` chỉ dùng làm đường phân cách |
| Họ chữ | `--av2-font-serif` `--av2-font-sans` | `var(--av2-ff-serif), Georgia, serif` · `var(--av2-ff-sans), system-ui, sans-serif` (biến `--av2-ff-*` do `next/font` sinh). Hai token này khai trên `.av2-root`, **không** trên `:root`: `--av2-ff-*` chỉ có trên phần tử gắn `av2FontClass` (5.7), mà biến tham chiếu được giải ở phần tử khai báo nó, nên khai ở `:root` sẽ rơi về font dự phòng. Kiểm: trên `/ui-library`, `getComputedStyle` của H1 và đoạn văn ra Source Serif 4 / Source Sans 3 |
| Cỡ chữ | `--av2-fs-12` … | 12, 13, 14, 15, 16, 18, 20, 24, 40 px; `--av2-fs-band-row` 18, `--av2-fs-band-md` 40, `--av2-fs-band-lg` 96, `--av2-fs-band-phone` 72 |
| Độ đậm | `--av2-fw-regular` `--av2-fw-strong` | 400, 600 |
| Dòng | `--av2-lh-body` `--av2-lh-tight` | 1.5 (theo tờ), 1.15 (H1). Kiểm dấu chồng ở 13–14px; nếu dấu bị cắt, nâng `--av2-lh-body` lên 1.55 và ghi trong PR |
| Khoảng cách | `--av2-space-1` … | 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 56 px |
| Bo, kẻ, bóng | `--av2-radius` `--av2-rule-w` `--av2-rule-strong-w` | 2px · 1px · 2px; **không có token bóng** (tờ: "không đổ bóng") |
| Focus | `--av2-focus` | `outline: 3px solid var(--av2-ink); outline-offset: 2px` |
| Điều khiển | `--av2-control-lg/md/sm` · `--av2-row` `--av2-row-dense` | 48 / 44 / 36 · 52 / 40 |
| Khung | `--av2-topbar-h` `--av2-bottombar-h` `--av2-account-menu-w` `--av2-sidebar-row` | 64 · 64 · 288 · 36 (44 trên điện thoại) |
| Lớp | `--av2-z-sticky` `--av2-z-overlay` `--av2-z-toast` | 10 · 100 · 200 |
| Điểm gãy | (hằng số trong comment + `frontend/components/ui/breakpoints.ts`) | 768, 1024, 1200 (sidebar admin chỉ icon) — biến CSS không dùng được trong `@media` |

Tương phản đã tính: muted/giấy 6,37:1; accent/giấy 11,3:1; mark/giấy 8,61:1; ok/giấy 6,05:1; trắng/accent 12,17:1; trắng/mark 9,28:1; ink/giấy 16,15:1.

`base.css`: `.av2-root { background: var(--av2-paper); color: var(--av2-ink); font: var(--av2-fw-regular) var(--av2-fs-16)/var(--av2-lh-body) var(--av2-font-sans); }`, H1–H3 dưới `.av2-root` dùng `--av2-font-serif` 600, `a` dùng `--av2-link`, `:focus-visible` dùng `--av2-focus`, `.av2-ipa { font-family: var(--av2-font-sans) }`. Không luật nào ngoài `.av2-root`, trừ `:root` khai biến (riêng `--av2-font-serif`, `--av2-font-sans` khai trên `.av2-root`, xem 5.2).

### 5.3 Font (`frontend/styles/av2/fonts.ts`)

```ts
import { Source_Sans_3, Source_Serif_4 } from 'next/font/google';
export const av2Serif = Source_Serif_4({ subsets: ['latin', 'latin-ext', 'vietnamese'], weight: ['400', '600'], display: 'swap', variable: '--av2-ff-serif' });
export const av2Sans = Source_Sans_3({ subsets: ['latin', 'latin-ext', 'vietnamese'], weight: ['400', '600'], display: 'swap', variable: '--av2-ff-sans' });
export const av2FontClass = `${av2Serif.variable} ${av2Sans.variable}`;
```

- Chỉ layout của cây mới import file này và gắn `av2FontClass` lên phần tử `.av2-root` (không lên `<html>`), nên trang cũ không tải font. Không sửa `app/layout.tsx`.
- `latin-ext` cần cho IPA (U+0250–02AF). CHƯA KIỂM: tên subset và trục `opsz` mà `next/font` hỗ trợ cho Source Serif 4 trong Next 16 — đọc `node_modules/next/dist/docs/` và danh sách trong `node_modules/next/dist/compiled/@next/font/dist/google/font-data.json`.
- Component không bao giờ import `fonts.ts` (vitest/jsdom không chạy được `next/font`).

### 5.4 Component trong `frontend/components/ui/`

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

Lệch so với dòng 18 (G03-T08, PR #2494): trên điện thoại `DataTable` **không** thành thẻ mà cuộn ngang trong khung bảng, ghim cột chọn, cột đầu (`columns[0]`) và cột "Hành động", theo tờ chuẩn ThanhPhanDuLieu §2 (tờ vẽ khung cuộn). Đảo ngược được (thêm chế độ thẻ sau, không đổi API). Trạng thái: coordinator OK 23/11, chờ anh Andy xác nhận khi duyệt.

`AudioPlayer`/`VideoFrame` chỉ là giao diện điều khiển bằng props; không tự tạo `<audio>`/`<video>`. G07/G08 nối với vòng đời phát hiện có (quy tắc `frontend/AGENTS.md`: giữ nguyên vòng đời trình phát).

### 5.5 Khung trang trong `frontend/components/ui/shell/`

| Khung | Thành phần con | Props | Tờ |
|---|---|---|---|
| `PublicShell` | `PublicTopNav` (Thư viện · Khoá học · "Đăng nhập" liên kết chữ · nút chính "Xem các khoá"; điện thoại: "Đăng nhập" ngoài menu, còn lại trong menu, thêm slot `mobileExtraItem` cho mục "Chấm thử" của G05-T21), `PublicFooter` (Giới thiệu · Khoá học · Thư viện · Điều khoản · Quyền riêng tư · Liên hệ · ©) | `active?: 'library'\|'courses'`, `mobileExtraItem?: {label, href}`, `children` | KhungTrang §4, KhungTrang2 §9 |
| `LearnerShell` | `LearnerTopNav` (5 mục), `TabletMenu` (768–1023px, nút "Menu: {mục}", danh sách đẩy nội dung xuống, dòng 48px), `BottomTabBar` (<768px, 64px, 5 ô, icon 22px, chữ 12px, ẩn khi `focus` hoặc bàn phím ảo mở), `AiCreditsIndicator` (`credits: {remaining: number\|null, low: boolean}`; `null` → `PendingValue`; "Sắp hết · còn N lượt" khi `low`), `OverdueSlot` + `NotificationsSlot` (chỗ đặt thẻ "N quá hạn" và chuông — component thật do G11-T11 dựng và truyền vào; không truyền thì không chiếm chỗ), `QuickLookup` (nút kính lúp + ô tra, từ 768px; nhận `lookup(query) → Promise<{group, items}[]>`), `AccountMenu` (popover 288px máy tính; tấm trượt đáy điện thoại), `CompactFooter` (© · Trợ giúp · Điều khoản · Quyền riêng tư), `RedirectNotice` (dải dưới thanh, như G02 nhưng giao diện mới) | `user: {name, email, initials}`, `canSwitchToAdmin: boolean` (lấy từ hồ sơ máy chủ `/auth/me`, không suy ở client), `credits` (một con số chung; `null` → `PendingValue`), `trialLeft?: number|null` (tài khoản chưa có khoá: "Chấm thử hôm nay còn N bài"), `notificationsSlot?: ReactNode`, `overdueSlot?: ReactNode`, `lookup?`, `children`. Khung không có prop cổng kích hoạt: chạy được với tài khoản `is_active=false` (FR-016). Mục đang ở **không** là prop: suy từ `usePathname()` + `route-registry` | KhungTrang §1–3, KhungTrang2 §9–10 |
| `FocusShell` | `FocusBar` (trái: thoát; giữa: tên bài, cắt "…"; phải: slot đồng hồ/tiến độ/trạng thái lưu), `LeaveConfirm` (dựa trên `ConfirmDialog`) | `mode: 'practice'\|'exam'`, `title`, `exitHref`, `hasUnsavedWork: () => boolean`, `right: ReactNode`, `bottom?: ReactNode` (bảng câu hỏi), `children` | KhungTrang §6 |
| `StaffShell` | `StaffTopBar` (tên · nhãn vai trò "Quản trị"/"Giáo viên" · `EnvBadge` · ô tìm nhanh ⌘K · "Xem như học viên" · `ThemeMenu` Sáng · Tối · Theo thiết bị · nút tài khoản có Đổi vai trò, Đăng xuất), `StaffSidebar` (nhóm gập/mở, mục con thụt 10px trên đường dọc mảnh, số việc chờ màu `--av2-mark`, nhóm thu cộng dồn, dòng 36px; <1200px chỉ icon — gồm 1024px, FR-018), `StaffDrawer` (<768px, dòng 44px, nhãn môi trường thành dải ngang), `QuickSearch` (giao diện; nhận `search(query) → Promise<{group, items}[]>`) | `role: 'admin'\|'instructor'`, `nav: StaffNavGroup[]` (G09 cung cấp; G03 dùng dữ liệu mẫu trong `/ui-library`), `environment: 'production'\|'staging'\|'local'`, `user`, `children` | KhungTrang2 §7–8 |

- `EnvBadge` lấy môi trường từ `window.__AVER_RUNTIME_CONFIG__.environment` (khai ở `public/js/runtime-config.js` dòng 5, sinh bởi `tooling/generate-runtime-config.mjs`). CHƯA KIỂM giá trị chính xác cho staging (`preview`?) — người thực thi đọc `tooling/runtime-origins.mjs` và ánh xạ: `production` → "Production · dữ liệu thật", còn lại → "Staging · dữ liệu thử".
- Đổi vai trò, đăng xuất: dùng lại logic đăng xuất của thanh cũ (đọc `aver-chrome.js` phần `user-menu-logout` và `tests/react/chrome-logout-*.test.tsx`), không viết luồng đăng xuất mới.

### 5.6 Danh mục trang (`frontend/lib/route-registry.mjs`)

```js
/** @typedef {{
 *  route: string,               // '/writing/result', '/grammar/[category]/[slug]'
 *  owner: string | null,        // 'app/(authed-writing-result)/writing/result/page.tsx'; null khi planned
 *  status: 'live' | 'planned' | 'redirect',
 *  audience: 'public' | 'learner' | 'instructor' | 'admin' | 'diagnostic',
 *  kind: 'nav' | 'child' | 'deep-link-only' | 'focus' | 'redirect' | 'diagnostic',
 *  section: 'home'|'course'|'practice'|'tests'|'library'|'account'|'public'|'admin:<nhóm>'|'instructor'|null,
 *  parent: string | null,       // route cha
 *  requires: string[],          // tham số query bắt buộc
 *  parentOnMissing: string | null,
 *  ui: 'v1' | 'v2',
 * }} RouteEntry */
export const ROUTES = Object.freeze([ /* … */ ]);
export function routeFor(pathname) {}      // khớp cả đoạn động
export function sectionFor(pathname) {}    // khung học viên dùng để tô mục đang ở
export function isV2Route(pathname) {}     // cầu điều hướng dùng
```

- Khởi tạo: sinh danh sách 159 route bằng `appPageRoute` của `tooling/app-route-inventory.mjs`, rồi điền tay `section/parent/kind/requires` dựa trên `docs/ROUTE_LEDGER.md` và báo cáo 12 (`S/reports/12-navigation-ia.md` mục 1). Các route chưa có file của G05–G07 (`/course`, `/practice`, `/tests`, `/library`, `/progress`, `/account`, `/help`, `/courses`, `/courses/[slug]`, `/enroll/[orderCode]`) khai `status: 'planned'`.
- Xung đột phải ghi vào mục `note`: `/practice` (planned, hub Luyện tập) cùng tiền tố với `/practice/session` (đang là trình luyện Speaking); `/library` công khai nhưng khi đăng nhập dùng khung học viên.
- Test `frontend/tests/route-registry.test.mjs` (import module, không so chuỗi mã nguồn):
  1. tập route từ cây `app/` = tập mục `status !== 'planned'`;
  2. mỗi `owner` tồn tại; mục `planned` không có file;
  3. mọi mục `nav`/`child` đi theo `parent` tới một mục `nav` trong vòng ≤6 bước, không vòng lặp → không mồ côi;
  4. mục có `requires` phải có `parentOnMissing` trỏ tới mục `live` không có `requires`;
  5. mỗi `section` học viên là một trong 5 mục hoặc `account`;
  6. `isV2Route` khớp đúng tập `ui: 'v2'`.
- Không xoá `docs/ROUTE_LEDGER.md` hay các bảng khác ở gói này (G10 quyết gộp).

### 5.7 Cùng tồn tại (cơ chế)

1. **`AuthedShell` thêm prop `design?: 'v1' | 'v2'` (mặc định `'v1'`).** Với `'v1'` mọi thứ phát ra giữ nguyên byte. Với `'v2'`: không phát năm thẻ `<link>` cũ, không phát `aver-chrome.js`/`aver-admin-chrome.js`; vẫn phát `<meta aver-auth-gated>`, script anti-flash, `SupabaseRuntimeBoundary`, script gắn class `<body>` (với `bodyClass='av2-body'`), `BodyClassBridge`, `AuthProvider`. Vẫn đúng **2** thẻ `<script` nội tuyến. Layout v2 tự `import '@/styles/av2/tokens.css'` và `base.css`, bọc `children` trong `<div className={'av2-root ' + av2FontClass}>` và khung tương ứng.
2. **Route group mới** cho trang v2 đặt tên `(authed-v2-<khu>)` (học viên/admin) để `tests/authed-shell.test.mjs` (lọc `^\(authed`) vẫn ép đi qua `AuthedShell`; mỗi layout có `export const instant = false;` (test `csp-nonce-report-only` đòi). Trang công khai v2: `(public-v2)`, layout riêng không dùng `AuthedShell`, tự có anti-flash như `app/(marketing)/layout.tsx`.
3. **Ranh giới điều hướng cứng.** `ChromeNavigationBridge` (cây cũ): trước `router.push`, nếu `isV2Route(url.pathname) !== isV2Route(location.pathname)` thì không chặn click (để trình duyệt tải trang). Khung v2: liên kết tới route `ui: 'v1'` dùng `<a>` thường, không dùng `next/link`. Lý do: CSS cũ (`home.css`, `ds.css`, class `av-page` trên `<body>`) và CSS mới không được cùng sống trong một tài liệu.
4. **Theme (sửa ngày 17/11/2026).** Cây v2 có HAI chế độ sáng và tối, theo mục 5.9. Token v2 đổi theo `[data-theme]` trên `<html>`, dùng lại khoá `av-theme` và đoạn chống nháy đang có. Khung v2 có điều khiển ba lựa chọn Sáng · Tối · Theo thiết bị.
5. **Không đổi**: thứ tự cascade v1, `app/layout.tsx`, `tokens.css`, hai web component cũ.

### 5.8 Test phải cập nhật

| Test | Vì sao vỡ/đổi | Cách sửa |
|---|---|---|
| `tests/authed-shell.test.mjs` | Thêm nhánh `design` | Giữ nguyên kiểm cascade v1; thêm ca: khi `design==='v2'` không có chuỗi `tokens.css` trong nhánh v2 (đọc nhánh bằng cách dựng component trong test React thì tốt hơn — xem T12) |
| `tests/csp-nonce-report-only.test.mjs`, `tests/csp-nonce-enforce.test.mjs` | Đếm thẻ `<script`; so `proxy.ts` matcher với tiền tố URL của mọi layout có `<AuthedShell`; đòi `instant = false` | Không thêm script; khi G07 thêm tiền tố mới thì sửa `proxy.ts` matcher + `nonceRouteAllowed` cùng PR. G03 chỉ thêm `ui-library` nếu nó dùng `AuthedShell` (không nên — xem T04) |
| `tests/route-ledger-matches-app.test.mjs` | Route mới (`/ui-library`) | Thêm vào `EXEMPT` như `/next-probe` |
| `tests/route-auth-guard-inventory.test.mjs` | Route mới | `/ui-library` vào `DEBUG_GATED`; trang pháp lý v2 giữ `PUBLIC_BY_DESIGN` |
| `tooling/app-route-inventory.mjs` | `NON_PRODUCT_APP_PAGE_ROUTES` | Thêm `/ui-library` |
| `tests/hex-budget.test.mjs` | Chỉ quét `css/` | Thêm gốc quét `styles/` và `components/ui/` (ngân sách 0), miễn đúng một file `styles/av2/tokens.css` |
| `tests/undefined-token-sentinel.test.mjs` | Regex `--(av-…)` không bắt `--av2-` | Thêm khối kiểm `--av2-*`: nguồn `styles/av2/tokens.css`, quét `styles/`, `components/ui/`, `app/(authed-v2-*)`, `app/(public-v2)` |
| `tests/font-system-ratchet.test.mjs`, `tests/next-font-delivery.test.mjs` | Không vỡ (không đụng root, không đụng `css/`) | Chạy để chắc chắn |
| `tests/primitive-families.test.mjs` | Không vỡ (CSS Module ngoài `css/`) | — |
| `tests/react/admin-chrome-navigation.test.tsx` | Cầu điều hướng đổi hành vi ở ranh giới | Thêm ca: click từ trang v1 tới route v2 không gọi `router.push` |
| `tests/workflow-path-coverage.test.mjs`, `tests/next-native-browser-workflow.test.mjs` | Thêm bước/tệp mà workflow đọc | Thêm glob `frontend/tests/visual/**`, `frontend/playwright.visual.config.js`, `frontend/components/ui/**`, `frontend/styles/**` vào bộ lọc đường dẫn của job |

### 5.9 Chế độ tối (thêm ngày 17/11/2026)

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

## UI and interaction

Trạng thái từng component và khung: `ui-states.md` (bảng 5.4, 5.5 và chế độ tối 5.9).

## Rollout and rollback

Không cờ máy chủ. Cây mới chỉ tới người dùng khi một trang chuyển sang `design="v2"`; trang thật đầu tiên là bốn trang
pháp lý (G03-T13, sau G02-T13). Quay lui: revert PR của trang đó, trang về khung cũ; token/component không ảnh hưởng
trang chưa dùng. `/ui-library` chỉ bật khi `AVER_ENABLE_DIAGNOSTIC_ROUTES=1` (đánh giá lúc build).

## Verification strategy

Mục 9 của gói:

- **Local:** bộ đầy đủ ở quy ước mục 5.3; `npx playwright test -c playwright.visual.config.js` trong Docker Linux.
- **CI:** job "Next-native browser regression" xanh gồm bước ảnh chụp.
- **Staging (sau merge, chỉ xem):** `/terms`, `/privacy`, `/contact`, `/about` dùng khung công khai mới; `/home`, `/admin` không đổi gì (so ảnh chụp trước/sau bằng mắt); `/ui-library` trả 404.
- **Kịch bản đầu-cuối:** 7 kịch bản ở mục 4.
- **Bằng chứng anh xem bằng mắt:** ảnh chụp `/ui-library` từng mục ở 1280 và 390 (artifact CI hoặc thư mục `__screenshots__`) đặt cạnh tờ thiết kế.
- **Không làm trên production:** không bật cờ chẩn đoán, không thử đăng xuất/đổi vai trò.
