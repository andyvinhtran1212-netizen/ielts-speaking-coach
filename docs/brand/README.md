# Aver Learning — Brand redesign (2026-07-24)

Bộ tài liệu + tài sản của đợt thiết kế lại bộ nhận diện, làm bằng **Claude Design**
(project "Aver Learning Design System", id `019de70a-8d73-7550-b19b-6743c83c6c3f`).

> **Trạng thái:** hoàn tất phần thiết kế trong Claude Design project + artifact.
> **CHƯA áp vào web production** — việc đó đụng code, xếp lịch ở `TECH_DEBT.md` →
> **DEBT-2026-07-24-I** (chờ sau soak Pilot-1 + sau khi migrate Next ổn định).
> Nhánh này lưu để tham chiếu; **không merge vào main trong lúc soak còn chạy**.

## Quyết định chốt
- **Hướng đi:** tiến hoá (evolve), KHÔNG rebrand. Giữ hệ màu teal `#0F766E` + amber
  `#F59E0B`, font Plus Jakarta Sans, namespace token `--av-*`.
- **Logo:** Hướng 3 — **"Mũi lên"** (mark = mũi nhọn đi lên + chấm amber; ẩn ý chữ A
  không thanh ngang = tiến bộ / lên band).
- **Wordmark:** **"Aver Learning"** (Aver đậm + Learning teal, sentence-case). Dẹp
  `averlearning` (liền) và `Aver.Learning` (có chấm).

## File
| File | Là gì |
|---|---|
| `GUIDE_claude-design.md` | Hướng dẫn làm việc với Claude Design: những gì cần thiết kế, 10 quyết định cần thống nhất, prompt mẫu |
| `DRIFT_REPORT.md` | Đối chiếu design project (05-09) vs code (07-24): namespace `--color-*`→`--av-*`, giá trị token, 3 điểm thẩm mỹ |
| `CONTEXT_PACK.md` | Gói bối cảnh dán vào Prompt 0 (⚠ một phần viết khi tưởng project trống — đọc kèm DRIFT_REPORT) |
| `logo-current-state.html` | So sánh 3 bộ nhận diện CŨ đang lẫn (nút play / A-trong-ô / Aver.Learning) |
| `logo-directions.html` | 3 hướng logo đề xuất (Đỉnh A / Nhịp tiến / Mũi lên) |
| `brand-sheet.html` | Brand sheet bản chốt Hướng 3: lockup, mark các cỡ, màu, clear space, bản 1 màu, quy tắc dùng |
| `social-kit.html` | Starter kit fan page: avatar, ảnh bìa FB, post mẹo ngữ pháp, post band score, story từ vựng |
| `foundations-av.html` | Card foundation `--av-*` (màu/type/spacing/radius/motion, light+dark) |
| `assets/*.svg` | **Bộ logo chốt** — nguồn để DEBT-2026-07-24-I áp vào `frontend/public/` |

## assets/
| File | Dùng khi |
|---|---|
| `logo-wordmark.svg` | Lockup ngang, nền sáng |
| `logo-wordmark-dark.svg` | Lockup ngang, nền tối |
| `logo-mark-light.svg` | Mark vuông — top bar app, avatar |
| `favicon.svg` | Favicon (nét dày hơn cho 16px) |
| `logo-mono.svg` | 1 màu (`currentColor`) — in / khắc |

## Liên quan
- Tokens/components chuẩn: `frontend/css/aver-design/tokens.css` + `components.css` (namespace `--av-*`).
- Bản reconciled của các file này cũng đã ghi vào Claude Design project (`source/`, `README.md`, `preview/`, `assets/`, `social/`).
