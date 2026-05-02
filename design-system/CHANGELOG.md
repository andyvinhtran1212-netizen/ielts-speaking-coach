# Design System Changelog

All notable changes to the Aver Learning design system documented here.

Format: Based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.0.0] — 2026-04-27

### Phase 1 baseline

**Added:**
- Initial design system tokens (light-mode-first)
- Color scales 50-900 for primary, accent, neutrals
- Typography hierarchy (Inter font family)
- Spacing system (4px base, 8px-256px scale)
- Border radius tokens (sm, md, lg, full)
- Shadow tokens (1-5 elevation levels)
- Vietnamese-specific typography considerations
- Component library:
  - Buttons (primary, secondary, ghost, destructive)
  - Cards (base, hover, interactive)
  - Badges (status, count, label)
  - Forms (input, textarea, select, checkbox)
  - Modals (dialog, drawer)
  - Navigation (tabs, breadcrumb)
- Theme support (sáng/tối) via `[data-theme]` attribute
- Vocabulary system specific patterns

**Source:** Imported from Claude Design "Averlearning" project (5 days work, 2026-04-22 → 2026-04-27)

**Foundation philosophy:** "Notion gặp Linear, có thêm hơi thở của Cambridge"

---

## Future versions

- [1.1.0] — Add page-specific patterns (Login, Dashboard, etc.) khi pages designed
- [1.2.0] — Add Phase 3 features patterns (chatbot, mock test, reading/listening)
- [2.0.0] — Major refresh nếu brand evolves
