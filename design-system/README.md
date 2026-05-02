# Aver Learning Design System v1.0

**Một nền tảng học tiếng Anh tử tế, dành cho người Việt.**

> Phase 1 · Tháng 4, 2026  
> "Notion gặp Linear, có thêm hơi thở của Cambridge"

---

## Triết lý thiết kế

Mỗi quyết định thị giác trong Aver phải trả lời được ba câu hỏi:
1. Có học thuật không?
2. Có thân thiện không?
3. Có giúp người học tập trung không?

### 3 Nguyên tắc

**HỌC THUẬT** — Đáng tin, không khô khan
> Typography rõ ràng, palette đậm, hierarchy mạnh — gợi nhớ Cambridge English nhưng không bụi bặm.

**THÂN THIỆN** — Khích lệ, không trẻ con
> Microcopy ấm áp, accent amber cho streaks và achievements, empty states có giọng nói. Không emoji rỗng, không mascot.

**HIỆN ĐẠI** — Sạch sẽ, có chỗ thở
> Whitespace nhiều, motion tinh tế, icon line-based. Information density vừa đủ — không overwhelm người học mới.

---

## Files

- **tokens.css** — Design tokens (colors, spacing, typography, radius, shadows)
- **components.css** — Component patterns (buttons, cards, badges, forms, modals)
- **showcase.html** — Visual reference document (full design system documentation)
- **patterns/** — Page-specific patterns (added as pages designed)

---

## Theme support

- **Sáng** (light mode) — default
- **Tối** (dark mode) — toggle via `[data-theme="dark"]`

---

## Color philosophy

- **Primary: Deep Teal** — Trustworthy, academic (`--color-primary-700`)
- **Accent: Warm Amber** — Encouraging, achievements (`--color-accent-400`)
- **Neutrals** — Slate scale 50-900 for text + backgrounds
- **Semantic** — Success (green), Warning (amber), Error (red), Info (blue)

---

## Sections covered

1. Nền tảng (Foundation)
2. Màu sắc (Colors)
3. Typography
4. Spacing & Radii
5. Elevation (Shadows)
6. Vietnamese typography
7. Components
8. Vocabulary system patterns
9. Preview

See `showcase.html` cho visual examples.

---

## Canonical source

- **Cloud:** "Averlearning" project trong Claude Design (claude.ai/design)
- **Local:** Folder này (design-system/)
- **Sync:** Khi update trong Claude Design, download zip và update local

---

## Usage

### Trong page mới

```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <link rel="stylesheet" href="/design-system/tokens.css">
  <link rel="stylesheet" href="/design-system/components.css">
</head>
<body>
  <!-- Use design system classes -->
</body>
</html>
```

### KHÔNG được làm

- ❌ Tạo local copy của tokens.css
- ❌ Override tokens trong page
- ❌ Inline styles thay vì component classes
- ❌ Custom colors ngoài design system

### Phải làm

- ✅ Reference design-system/tokens.css + components.css
- ✅ Reuse existing component classes
- ✅ Check showcase.html cho component patterns
- ✅ Đề xuất update tokens.css nếu cần new pattern (qua CHANGELOG)

---

## Migration status

Repo đang migrate từ legacy `frontend/css/ds.css` sang `design-system/`.

| Page | Legacy | Migrated |
|------|--------|----------|
| index.html (Login) | ds.css | 🟡 pending |
| dashboard.html | ds.css | 🟡 pending |
| my-vocabulary.html | ds.css | 🟡 pending |
| flashcards.html | ds.css | 🟡 pending |
| flashcard-study.html | ds.css | 🟡 pending |
| practice.html | ds.css | 🟡 pending |
| result.html | ds.css | 🟡 pending |
| exercises.html | ds.css | 🟡 pending |
| profile.html | ds.css | 🟡 pending |
| grammar-* (4 pages) | ds.css | 🟡 pending |

→ Strategy: Migrate gradually mỗi page redesign.

---

## See also

- `CHANGELOG.md` — Version history
- `CONTRIBUTING.md` — How to update design system
- `showcase.html` — Visual reference
