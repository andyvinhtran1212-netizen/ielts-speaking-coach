# Thiết kế lại khu Lớp học — 06/08/2026

Phạm vi: `admin/classes/index.html` + `admin-classes.js` (giáo viên, laptop) và
`my-class.html` (học viên, điện thoại).

---

## I · Audit — đo được, không phải cảm tính

| # | Phát hiện | Bằng chứng | Mức |
|---|---|---|---|
| A1 | **Điều hướng ba tầng + 19 chỗ modal.** Mở bài của một em là đi bốn tầng, không có đường quay lại rõ ràng. | tab Lớp/Học viên → chi tiết lớp → 5 tab con (`roster`·`lessons`·`homework`·`progress`·`marking`); `grep` đếm 19 `modal`/`dialog` | Cao |
| A2 | **Bảng 7–8 cột.** Tiến độ 4 kỹ năng có 7 cột; bảng Học viên có 8 và **lẫn tiêu đề tiếng Anh**: `Code, Name, Lớp, Target, Current, Date, Actions`. | `admin/classes/index.html` | Cao |
| A3 | **Trang học viên gần như không đáp ứng** — đúng **1** `@media` trong 296 dòng, trong khi học viên chủ yếu dùng điện thoại. | `my-class.html` | Cao |
| A4 | **Amber mang HAI vai xung khắc.** `tokens.css` ghi rõ `speaking = --av-accent`, nhưng quy ước sản phẩm lại giữ amber cho **một con số quan trọng nhất mỗi màn**. Trên bảng tiến độ 4 kỹ năng, cột Speaking và con số "chưa nộp hôm nay" tranh nhau cùng một màu — và màu ấy mất hết sức nhấn. | `aver-design/tokens.css:249` | **Cao** |
| A5 | Hệ quả của A4: `--av-accent` còn gán cho trạng thái `awaiting_writing`. Ba thứ khác loại, một màu. | `index.html:149` | Trung bình |

| ✔ | **Kỷ luật token sạch**: 0 mã màu thô, gần như không style nội tuyến. Việc cần làm là kiến trúc thông tin, không phải dọn vệ sinh. | | — |

> A4 là chỗ tôi đọc sai lần đầu: tôi ghi là "thiếu 2 màu kỹ năng". Thực ra chú
> thích trong `tokens.css` đã **cố ý** ánh xạ speaking→accent, writing→primary.
> Không thiếu token — mà là một ánh xạ cũ nay xung khắc với quy ước amber.
>
> Trang học viên thì đã tôn trọng quy ước sẵn: `my-class.html:162` có hẳn chú
> thích *"KHÔNG dùng --av-accent: màu nhấn để dành cho ĐÚNG MỘT con số"*. Chỗ
> phạm nằm ở màn admin.

---

## II · Luận điểm

> Giáo viên **không bao giờ** nghĩ theo tab. Họ nghĩ theo **học viên**.

Ba việc của giáo viên — *sáng nay ai chưa nộp*, *em nào đang tụt*, *mở bài một em
để chấm* — không phải ba màn hình khác nhau. Chúng là **ba ống kính nhìn cùng một
danh sách lớp**.

Nên bỏ 5 tab con, thay bằng **một sổ điểm danh duy nhất** + một **bộ đổi ống kính**
đổi phần cột bên phải. Hàng học viên đứng yên; chỉ dữ liệu đổi. Bốn tầng điều
hướng co còn một.

Đây cũng là chỗ tiêu "độ bạo" của thiết kế: cả màn đọc như một **quyển sổ giấy** —
kẻ mảnh, không hộp lồng hộp, số liệu chữ đơn cách.

---

## III · Token

Dùng nguyên hệ có sẵn. **Một token mới**, để gỡ đúng chỗ xung khắc ở A4 — cho
Speaking màu riêng, trả amber về vai duy nhất của nó:

```css
/* aver-design/tokens.css — cạnh --av-skill-grammar/listening/reading */
--av-skill-speaking / -soft / -border      /* KHÔNG còn dùng chung --av-accent */
```

Writing giữ `--av-primary` (teal): teal đã là màu hành động, nhưng nó không bị
giới hạn "một chỗ mỗi màn" như amber, nên dùng chung không làm mất sức nhấn.

Bảng dùng, không thêm gì khác:

| Vai | Token |
|---|---|
| Nền trang · thẻ · lõm | `--av-surface-page` · `--av-surface-card` · `--av-surface-sunken` |
| Chữ | `--av-text-primary` · `--av-text-secondary` · `--av-text-muted` |
| Kẻ | `--av-border-subtle` (kẻ hàng) · `--av-border-default` (kẻ nhóm) |
| Hành động, thương hiệu | `--av-primary` + `-soft` `-hover` |
| **Con số quan trọng nhất** | `--av-accent` — **đúng một chỗ mỗi màn** |
| Trạng thái | `--av-success` · `--av-warning` · `--av-error` · `--av-info` (+ `-soft`) |
| Số liệu | `--av-font-mono` |
| Giãn cách | `--av-space-1/2/3/4/6/8/12/16` — **thang không có số 5** |

`--av-font-serif` (Lora) **không dùng ở đây**.

**Sửa A4+A5:** Speaking lấy token riêng; `awaiting_writing` chuyển sang
**`--av-info`** — *không phải* `--av-warning`, vì `--av-warning` đã là màu của
"Đang làm", và gộp hai trạng thái vào một màu còn tệ hơn chỗ cũ.

Năm trạng thái, năm màu — cột này đọc bằng màu trước rồi mới đọc chữ:

| Trạng thái | Token |
|---|---|
| Bỏ dở | `--av-error` |
| Đang làm | `--av-warning` |
| Chưa nộp tự luận | `--av-info` |
| Xong | `--av-text-muted` |
| Chưa mở | `--av-text-faint` |

Sau đó amber chỉ còn đúng một chỗ mỗi màn: con số "chưa nộp hôm nay" ở đầu sổ
giáo viên, và **đồng hồ đếm ngược tới 19:00** ở trang học viên.

> Ban đầu tôi định cho amber vào con số "bài cần nộp hôm nay". Nhưng mã đang chạy
> đã chọn đồng hồ đếm ngược, kèm lý do đúng hơn: *"một em mở trang lúc 18:20 cần
> 'còn 40 phút', không cần một ngày tháng."* Giữ quyết định của mã.

---

## IV · Màn giáo viên — Sổ điểm danh

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Lớp IELTS 6.5 — Tối 2·4·6          14 học viên      [＋ Giao bài]        │
│  ─────────────────────────────────────────────────────────────────────   │
│                                                                          │
│      7          hôm nay chưa nộp          ← con số amber DUY NHẤT        │
│      ─────────────────────────────────────────────────                   │
│                                                                          │
│  ống kính:  [ Hôm nay ]  Tiến độ   Bài tập                               │
│                                                                          │
│  ┌─ tên (dính) ─┬──────────── cột theo ống kính ───────────────────────┐ │
│  │ Nguyễn An    │ ▓▓░░░░░░  Grammar 1   19:00   ○ chưa mở              │ │
│  │ Trần Bình    │ ▓▓▓▓▓▓▓▓  Grammar 1   19:00   ● xong    9/10         │ │
│  │ Lê Chi       │ ▓▓▓▓░░░░  Grammar 1   19:00   ◐ đang làm  4/9 chặng  │ │
│  │ Phạm Dung    │ ▓▓▓▓▓▓▓░  Grammar 1   19:00   ◑ thiếu tự luận        │ │
│  │ …            │                                                      │ │
│  └──────────────┴──────────────────────────────────────────────────────┘ │
│                                          ↑ bấm một hàng → ngăn kéo phải  │
└──────────────────────────────────────────────────────────────────────────┘
```

Bấm một hàng mở **ngăn kéo bên phải ngay trong trang** — hàng vẫn sáng, sổ vẫn
đó. Không rời trang, không modal, không mất chỗ đứng.

```
                                   ┌────────────────────────────┐
│ Lê Chi        │ ▓▓▓▓░░░░  ← sáng │  Lê Chi                 ✕  │
│ Phạm Dung     │ ▓▓▓▓▓▓▓░          │  ────────────────────────  │
│ …             │                   │  Grammar 1 · 4/9 chặng     │
                                    │  ▓▓▓▓░░░░  40%  ngưỡng 75% │
                                    │                            │
                                    │  Trục yếu nhất             │
                                    │  tìm ô V có chia của câu   │
                                    │  sai 6/8 câu               │
                                    │                            │
                                    │  [ Nghe bài nói ]          │
                                    │  [ Xem từng câu ]          │
                                    └────────────────────────────┘
```

### Ba ống kính — cùng hàng, khác cột

| Ống kính | Trả lời | Cột |
|---|---|---|
| **Hôm nay** | ai chưa nộp | dải ô · bài giao · hạn · trạng thái |
| **Tiến độ** | em nào đang tụt | 4 dải kỹ năng · nộp đúng hạn · hoạt động gần nhất |
| **Bài tập** | ai làm tới đâu | một cột mỗi bài giao, ô = trạng thái |

### Bảng 7–8 cột sống thế nào (A2)

Ba nước, không nước nào là "thu nhỏ chữ":

1. **Cột tên DÍNH.** Cuộn ngang bao nhiêu vẫn thấy đang đọc về ai. Mất tên là mất
   toàn bộ ý nghĩa của hàng.
2. **Số thành DẢI Ô.** Bốn cột band số (`6.5 · 6.0 · — · 5.5`) thành bốn dải ô;
   ô tô kín = chỗ cần chú ý. Trục yếu hiện thành một vệt đậm, đọc trong ba giây
   mà không phải đọc chữ nào. **Dùng lại đúng quy ước `course-report.js` đã có** —
   học viên và giáo viên chỉ phải học nó một lần.
3. **Cột "Thao tác" biến mất.** Cả hàng là nút. Một cột chứa toàn nút giống hệt
   nhau không mang thông tin gì.

Bảng Học viên: dịch hết sang tiếng Việt (`Mã · Họ tên · Lớp · Mục tiêu · Hiện tại
· Ngày · —`) và bỏ cột thao tác theo nước 3 ⇒ **8 cột còn 6**.

---

## V · Màn học viên — 360px

**Không có bảng nào.** Một cột, xếp theo hạn nộp, hôm nay ghim trên cùng.

```
┌──────────────────────────┐  360px
│  Lớp IELTS 6.5           │
│                          │
│      40:12               │  ← amber, con số duy nhất
│      còn lại tới 19:00   │
│  ──────────────────────  │
│                          │
│  HÔM NAY · hạn 19:00     │
│  ┌──────────────────────┐│
│  │ Grammar 1            ││
│  │ ▓▓▓▓░░░░  4/9 chặng  ││
│  │ [ Làm tiếp ]         ││
│  └──────────────────────┘│
│  ┌──────────────────────┐│
│  │ Speaking Part 2      ││
│  │ chưa mở              ││
│  │ [ Bắt đầu ]          ││
│  └──────────────────────┘│
│                          │
│  ĐÃ XONG                 │
│  ✓ Listening 3   9/10    │
│  ✓ Reading 2     8/10    │
└──────────────────────────┘
```

Quy tắc:
- **Một hành động mỗi thẻ.** Tên nút nói đúng việc sẽ xảy ra: *Làm tiếp* khi đang
  dở, *Bắt đầu* khi chưa mở. Không dùng "Xem".
- **Hạn là mốc tuyệt đối** (19:00), không phải "còn 3 giờ" — đồng hồ máy học viên
  có thể lệch, và đếm ngược làm người ta hoảng.
- **Đã xong xếp dưới, một dòng.** Chúng là phần thưởng, không phải việc.
- `homework_stale`: một dòng mảnh nền `--av-info-soft`, **không** biểu tượng cảnh
  báo, **không** nút Tải lại — *"Bài bạn vừa nộp có thể chưa hiện ở đây. Nếu đã
  làm xong, không cần làm lại."* Chữ trung lập kỹ năng (đã sửa ở PR #961).

---

## VI · Chữ nghĩa

| Chỗ | Cũ | Mới | Vì sao |
|---|---|---|---|
| Nút mở bài một em | *Xem* | **Nghe bài nói** / **Xem từng câu** | nói đúng việc sẽ xảy ra |
| Bảng học viên | `Code, Name, Target…` | Mã · Họ tên · Mục tiêu… | người dùng là người Việt |
| Trạng thái | `awaiting_writing` | **Thiếu phần tự luận** | tên theo thứ còn thiếu, không theo cột trong bảng |
| Rỗng | *Không có dữ liệu* | **Chưa em nào mở bài này. Nhắc lớp?** | màn rỗng là lời mời làm việc |

Năm trạng thái giữ nguyên nghĩa, đổi cách đọc: **Chưa mở · Đang làm · Thiếu phần
tự luận · Bỏ dở · Xong**.

---

## VII · Thứ tự làm

| Bước | Việc | Rủi ro |
|---|---|---|
| 1 | Token màu riêng cho Speaking (A4) | Không — chỉ thêm |
| 2 | Trả amber về đúng vai: gỡ khỏi Speaking và `awaiting_writing` (A4+A5) | Thấp — đổi màu hiển thị |
| 3 | Việt hoá + bỏ cột thao tác ở bảng Học viên (A2) | Thấp |
| 4 | Trang học viên 360px (A3) — **XONG**: ô số 2 cột, kẻ dọc không cụt, nút ≥44px | Thấp, tách riêng khỏi phần admin |
| 5 | Cột tên dính + dải ô (A2) — **XONG**: dính từ 900px, dải 8 lượt gần nhất, "yếu" so với mục tiêu của CHÍNH em ấy | Trung bình |
| 6 | Sổ điểm danh + ống kính + ngăn kéo, gỡ 5 tab và modal (A1) | **Cao** — đụng `admin-classes.js` 2806 dòng |

Bước 1–4 làm được ngay và độc lập. Bước 6 nên đi riêng một PR, có ảnh trước/sau.
