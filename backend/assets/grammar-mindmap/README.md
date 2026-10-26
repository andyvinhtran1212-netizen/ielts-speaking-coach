# Grammar Course — Bộ tài liệu Ngữ pháp Tiếng Anh hoàn chỉnh (A1 → C1)

Bộ tài liệu ngữ pháp tiếng Anh song ngữ Anh–Việt cho học viên tự ôn tập. Bao gồm 5 thành phần bổ trợ lẫn nhau:

| # | Thành phần | File chính | Dùng khi nào |
|---|------------|------------|--------------|
| 1 | **Giáo trình Nền tảng** | `Giáo trình Ngữ pháp Nền tảng (Hoàn chỉnh).docx` | Học từ đầu, hệ thống hoá kiến thức |
| 2 | **Khoá học Online 60 buổi** | `Khoá học Online/` (scripts + slides PPTX) | Học theo lộ trình có giảng giải |
| 3 | **Bài tập Drill** | `Bài tập Ngữ pháp Drill.docx` | Luyện tập theo chủ điểm để nhớ sâu |
| 4 | **Đọc hiểu Ngữ pháp** | `Đọc hiểu Ngữ pháp.docx` | Vận dụng ngữ pháp vào ngữ cảnh thật |
| 5 | **Mindmap & Grammar Checker** ⭐ NEW | `grammar_mindmap.html/.pdf`, `grammar_checker.py` | Ôn tập nhanh, tra cứu, kiểm tra lỗi sai |

Thành phần ⭐ là phần mới được bổ sung trong tài liệu này.

---

## 1. Mindmap tương tác (`grammar_mindmap.html`)

Mở trực tiếp bằng trình duyệt. **90+ điểm ngữ pháp** chia thành 8 mảng chính, kết nối chéo lẫn nhau.

**Tính năng:**
- Click vào tiêu đề từng mảng để mở/đóng.
- Ô tìm kiếm (`/` để focus nhanh) — gõ tiếng Việt hoặc tiếng Anh để lọc + highlight.
- **Lọc theo CEFR** (A1 → C1) bằng chip màu.
- **Cross-link** giữa các điểm liên quan (vd: Tenses ↔ Reported Speech ↔ Conditionals).
- **Quiz nhanh** ở từng node — click để xem đáp án.
- **Progress tracker** — đánh dấu "Đã ôn xong", lưu vào trình duyệt, hiển thị % hoàn thành mỗi mảng.
- **Dark mode** (phím `D` hoặc nút 🌙).
- **Keyboard shortcuts:** `/` tìm · `E/C` mở/đóng tất cả · `1-8` nhảy đến mảng · `D` đổi theme · `Esc` thoát ô tìm.
- **Deep-link** — copy URL có `#node-xxx` để chia sẻ thẳng đến một điểm.
- Tương thích in (Ctrl+P) — tự bung toàn bộ và ẩn thanh công cụ.

## 2. Mindmap PDF in được (`grammar_mindmap.pdf`)

- A3 ngang, 12 trang, lưới 3 cột.
- Có cover, chú giải màu CEFR, mục lục, header/footer + số trang.
- In ra để dán tường hoặc kẹp file học offline.

---

## 3. Grammar Checker (`grammar_checker.py`)

### Cài đặt

```bash
# (1) Thư viện Python
pip install -r requirements.txt

# (2) Java 8+ (LanguageTool dùng Java). Kiểm tra:
java -version
# Nếu chưa có:
#   macOS:   brew install openjdk@17
#   Ubuntu:  sudo apt install default-jdk
#   Windows: https://adoptium.net
```

Lần đầu chạy, `language_tool_python` sẽ tải LanguageTool (~250MB). Nếu không có Java hoặc tải thất bại, script tự fallback sang **LanguageTool Public API** (cần Internet).

### Cách dùng

```bash
python grammar_checker.py                            # CLI tương tác
python grammar_checker.py "She go to school."        # Kiểm tra 1 câu
python grammar_checker.py --gui                       # Giao diện Tkinter
python grammar_checker.py --online "..."             # Bắt buộc dùng API online
python grammar_checker.py --no-color "..."           # Tắt màu ANSI (Windows cmd cũ)
```

### Đầu ra mẫu

```
KẾT QUẢ KIỂM TRA NGỮ PHÁP

Câu bạn nhập:
  He don't goes to school.

Số vấn đề phát hiện: 2

[Lỗi #1] (LOCAL_HE_SHE_IT_DON_T / GRAMMAR)
  → He don't goes to school.
  🎯 Điểm ngữ pháp: Subject-verb agreement (do/does)
  🇻🇳 Ngôi thứ 3 số ít dùng 'doesn't' (NOT 'don't')...
  💡 Gợi ý sửa: He doesn't

[Lỗi #2] (LOCAL_DOESN_T_DON_T... / GRAMMAR)
  → He don't goes to school.
  🎯 Điểm ngữ pháp: Negative present/past (use base form after do/does/did)
  🇻🇳 Sau do/does/did dùng động từ NGUYÊN MẪU...
  💡 Gợi ý sửa: don't go

Câu sau khi áp dụng tất cả gợi ý (chuỗi):
  He doesn't go to school.
```

### Cơ chế hoạt động

`grammar_checker.py` kết hợp **2 lớp** kiểm tra:

1. **Local rules** (~25 regex chính xác cho lỗi đặc thù người Việt): subject-verb agreement, missing 'to be', did + V2, will + V-ed, modal + to, much/many, less/fewer, your/you're, mạo từ kép, past time markers, prepositions (discuss about, marry with, listen music, despite of...), word order trong câu hỏi, plural của uncountable, born + be, agree + be...
2. **LanguageTool** (offline jar hoặc Public API): bắt phần còn lại của ngữ pháp tổng quát, lỗi chính tả, từ nhầm lẫn.

Mỗi lỗi được **ánh xạ tới điểm ngữ pháp tương ứng trên mindmap** + giải thích trọng tâm song ngữ + gợi ý sửa.

**Chained correction:** với câu có nhiều lỗi liên hoàn (vd: "He don't goes" → "He doesn't goes" → "He doesn't go"), checker tự chạy nhiều vòng cho đến khi không còn lỗi.

### Test

```bash
python test_checker.py   # 25 câu sai + 39 câu đúng + chained correction
```

---

## 4. Cấu trúc thư mục

```
Grammar Course/
├── Giáo trình Ngữ pháp Nền tảng (Hoàn chỉnh).docx
├── Giáo trình Ngữ pháp Nền tảng (Hoàn chỉnh — preview).pdf
├── Bài tập Ngữ pháp Drill.docx
├── Bài tập Ngữ pháp Drill (preview).pdf
├── Đọc hiểu Ngữ pháp.docx
├── Đọc hiểu Ngữ pháp (preview).pdf
├── Khoá học Online/                  ← 60 buổi: scripts + slides PPTX
│   ├── Buổi 01 - ...
│   └── ...
│
├── grammar_mindmap.html              ⭐ Mindmap tương tác
├── grammar_mindmap.pdf               ⭐ Mindmap A3 in được
├── grammar_checker.py                ⭐ Script kiểm tra ngữ pháp
├── grammar_data.py                   ⭐ Dữ liệu nguồn (chỉnh nội dung tại đây)
├── build_html_mindmap.py             (tái tạo HTML)
├── build_pdf_mindmap.py              (tái tạo PDF)
├── test_checker.py                   (test cho checker)
├── requirements.txt
└── README.md                         (file này)
```

Nếu chỉnh `grammar_data.py`, chạy lại:
```bash
python build_html_mindmap.py
python build_pdf_mindmap.py
```

---

## 5. Lộ trình ôn tập 14 ngày (gợi ý)

| Ngày | Mảng / Hoạt động | Tài liệu chính |
|------|------------------|----------------|
| 1 | Diagnostic test — viết 1 đoạn ~150 từ và chạy `grammar_checker.py` để xác định mảng yếu | Checker |
| 2 | **Sentence Structure** (Mảng 1) | Mindmap mảng 1 + Drill |
| 3 | **Parts of Speech** (Mảng 2) | Mindmap mảng 2 + Drill |
| 4 | Self-quiz mảng 1-2 (mở quiz trên mindmap) | Mindmap |
| 5 | **Tenses — Present & Past** (Mảng 3, nửa đầu) | Mindmap + Giáo trình |
| 6 | **Tenses — Future & Cross** (Mảng 3, nửa sau) | Mindmap + Giáo trình |
| 7 | Đọc hiểu áp dụng — đọc 2 đoạn, đánh dấu các thì | Đọc hiểu Ngữ pháp |
| 8 | **Clauses** (Mảng 4) | Mindmap + Giáo trình |
| 9 | **Sentence Types & Conditionals** (Mảng 5) | Mindmap + Drill |
| 10 | **Voice & Mood** (Mảng 6) | Mindmap |
| 11 | **Modality & Nuances** (Mảng 7) | Mindmap |
| 12 | **Advanced topics** (Mảng 8) | Mindmap + Đọc hiểu |
| 13 | Viết 1 đoạn 300 từ, chạy lại checker | Checker |
| 14 | So sánh với Ngày 1 — review mảng còn yếu | Tất cả |

**Mẹo:**
- Mỗi nhánh trên mindmap đều có nút "Đã ôn xong" — đánh dấu để theo dõi tiến độ.
- Khi checker bắt lỗi, click vào tên điểm ngữ pháp → mở mindmap để đọc lại lý thuyết.
- Cross-link trên mindmap giúp ôn các điểm liên quan cùng lúc (vd: học Tenses → click "Reported speech" để xem mối liên hệ lùi thì).
- Sau ~2 tuần luyện đều, các lỗi cốt lõi sẽ giảm rõ rệt.

---

## 6. Khắc phục sự cố

| Vấn đề | Cách xử lý |
|--------|-----------|
| Mindmap HTML không hiển thị tiếng Việt | Mở bằng Chrome/Edge/Safari mới, không phải IE. |
| `grammar_checker.py` báo lỗi Java | Cài Java 8+ hoặc dùng `--online`. |
| LanguageTool tải lâu/lỗi | Dùng `--online` để qua Public API. |
| API online báo 429 (rate limit) | Checker tự retry với backoff. Đợi vài giây hoặc dùng offline. |
| GUI Tkinter không mở | Cài `python3-tk` trên Ubuntu hoặc dùng CLI. |
| In PDF bị cắt | PDF đã là A3 ngang. Đảm bảo máy in chọn cỡ giấy A3. |

---

Mọi thắc mắc hoặc gợi ý bổ sung, chỉnh trực tiếp `grammar_data.py` (đã chú thích tiếng Việt) rồi rebuild HTML + PDF.
