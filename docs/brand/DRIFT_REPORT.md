# Drift report — Design project (05-09) vs Code (07-24)

> Bước 1, thuần đọc. So `source/tokens.css` trong Claude Design project với `frontend/css/aver-design/tokens.css` hiện tại. **Đã chốt: code là nguồn chân lý.**

## Kết luận một dòng
Đây **không phải** "cùng hệ lệch vài giá trị" — mà là **hai hệ namespace khác hẳn**. Project `source/` là **bản tiền thân** (`--color-*`); code đã **viết lại toàn bộ thành `--av-*`** và tiến hoá thật (thêm 6-kỹ-năng, đổi dark theme, siết spacing, đổi motion). ⇒ reconcile = **thay `source/` bằng bản `--av-*` hiện tại**, không phải vá.

---

## A. Drift namespace (gốc rễ — mọi thứ kế thừa)

| Khái niệm | Project (cũ) | Code (chuẩn) |
|---|---|---|
| Màu chính | `--color-primary-700` | `--av-brand-teal-700` + `--av-primary` |
| Khoảng cách | `--space-4` | `--av-space-4` |
| Bo góc | `--radius-md` | `--av-radius-md` |
| Cỡ chữ | `--text-body` (semantic) | `--av-fs-base` (t-shirt) |
| Nền | `--surface-page` | `--av-surface-page` |
| Chữ | `--text-primary` | `--av-text-primary` |
| Viền | `--border-subtle` | `--av-border-subtle` |
| Đổ bóng | `--shadow-md` | `--av-shadow-md` |
| Chuyển động | `--ease-out` | `--av-easing-default` |
| Z-index | `--z-modal` | `--av-z-modal` |

→ Toàn bộ `preview/`, `redesigned/`, `colors_and_type.css` trong project đều bám namespace cũ ⇒ **tất cả đều lỗi thời theo**, không chỉ `source/tokens.css`.

---

## B. Drift giá trị (cùng khái niệm, số khác) — không chỉ đổi tên

| Token | Project (cũ) | Code (chuẩn) | Ghi chú |
|---|---|---|---|
| **Radius md** (nút) | 10px | **8px** | |
| **Radius lg** (card) | 16px | **12px** | |
| **Radius xl** (modal) | 24px | **16px** | code thêm bậc `2xl`=24 |
| **Duration** | 120 / 200 / 320ms | **150 / 250 / 400ms** | |
| **Easing default** | `ease-out (0.16,1,0.3,1)` | **`(0.4,0,0.2,1)`** | code bỏ hẳn đường cong "fast-out slow-settle" |
| **Easing bounce** | — (README ghi "no bounces") | **có `--av-easing-bounce`** | ⚠ code MÂU THUẪN README cũ |
| **Type scale** | px tuyệt đối, tên semantic (display/h1/h2…) | **rem, tỉ lệ 1.125, tên t-shirt (xs…5xl)** + `fs-hub-title` clamp | cách tổ chức khác hẳn |
| **Accent default** | `#FBBF24` (amber-400, sáng) | **`#F59E0B`** (amber-500, đậm hơn) ở light | |
| **Spacing** | có `--space-5`(20), `--space-10`(40) | **bỏ 5 & 10** (kỷ luật bỏ bậc lẻ) | |
| **Dark — nền** | `#0F1411` / `#161C19` (olive/xanh tối) | **`#0A1628` / `#112236`** (navy) | ⚠ cảm giác dark mode KHÁC HẲN |
| **Dark — focus** | teal `rgba(45,212,191,.28)` | teal `rgba(20,184,166,.40)` | |

---

## C. Code có, project KHÔNG (code mới hơn thật)

| Có trong code, thiếu trong project | Vì sao |
|---|---|
| **Bảng màu 6 kỹ năng**: reading=sky `#0EA5E9`, listening=violet `#8B5CF6`, grammar=indigo `#4F46E5`, vocab=jade `#0B6E59`, speaking=amber, writing=teal | Sinh ra sau pivot 6-kỹ-năng (06-27). Project còn ở thời "Speaking-only". |
| **`--av-vocab-jade-*`** (word-card v2) | Thiết kế thẻ từ vựng mới, project chưa có |
| **Chrome spacing tokens** (`--av-chrome-*`) + **width tokens** (`--av-width-page/read`) | Sinh từ các audit layout 06-29, project chưa có |
| **`--av-fs-hub-title`** (clamp 32→48) | Thống nhất tiêu đề hub 3 thư viện (audit 07-03) |

## D. Project có, code tổ chức khác

| Trong project | Trong code |
|---|---|
| `--vocab-used-well/needs-review/upgrade` (3 category chip) | Chuyển thành hệ `.av-badge-used-well/needs-review` + jade accent |
| Neutral ramp warm-slate `--color-neutral-50…900` | Code dùng `rgba(navy)` cho text/border thay vì ramp trung tính |
| Semantic ramp đủ 50/100/500/600/700 | Code rút còn `--av-success` + `--av-success-soft` (đủ dùng) |

---

## E. 3 điểm cần anh quyết khi reconcile (code lệch README/project — chưa rõ cố ý hay trôi)

1. **Motion — "nảy hay không nảy?"** README cũ tuyên bố *"No bounces. No spring physics."* nhưng code hiện có `--av-easing-bounce (0.34,1.56,0.64,1)`. → Giữ bounce (cập nhật README) hay bỏ (xoá token)? Ảnh hưởng cảm giác cả hệ.
2. **Dark theme — navy hay olive?** Project vẽ dark trên nền olive `#0F1411`; code chạy navy `#0A1628`. Code đang production ⇒ navy thắng, nhưng cần xác nhận đây là chủ đích (README cũ còn ghi "chưa trang nào chạy dark").
3. **Easing default — đổi có chủ đích không?** Project dùng đường cong "fast-out, slow-settle" (0.16,1,0.3,1) rất đặc trưng; code chuyển sang material-standard (0.4,0,0.2,1) — mượt nhưng ít cá tính hơn. Giữ material hay lấy lại đường cong cũ làm nét riêng?

*(3 câu này thuộc thẩm mỹ — không có đáp án "đúng"; nhưng phải chốt trước khi làm brand mới, kẻo mỗi bề mặt một kiểu.)*

---

## F. Đề xuất phạm vi bước 2 (GHI vào project — cần anh duyệt trước khi mình chạy)

Reconcile theo code, làm nhỏ và kiểm soát được:

1. **Thay `source/tokens.css`** = bản `--av-*` hôm nay (copy nguyên từ code). Giữ `source/original-README.md` làm dấu vết lịch sử.
2. **Thay `source/components.css`** = bản hiện tại.
3. **Viết lại `README.md`**: sửa "Speaking tool"→6 kỹ năng, "Inter"→Plus Jakarta, "chưa có dark"→có navy dark, namespace `--color-*`→`--av-*`, thêm bảng màu 6 kỹ năng. Ghi 3 quyết định ở mục E sau khi anh chốt.
4. **Cập nhật foundation preview cards** (`colors-*`, `type-*`, `spacing-*`) sang `--av-*` + giá trị đúng — để mở project ra là thấy đúng hệ hiện tại.
5. **Đánh dấu `redesigned/` là ARCHIVE** (thêm ghi chú "pre-pivot, tham khảo") — không viết lại vội, vì đó là bản redesign trang cũ theo namespace cũ, làm lại là việc riêng rất lớn.

Mỗi bước ghi qua `DesignSync` đều có prompt để anh duyệt. Mình **chưa ghi gì** cho tới khi anh gật.

**Chưa làm ngay ở bước 2:** logo mới + social kit — chỉ bắt đầu SAU khi nền `source/` + foundation đã khớp code (nền sạch rồi mới xây).
