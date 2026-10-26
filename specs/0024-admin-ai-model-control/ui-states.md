# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| `/admin` AI section — models and control | Skeleton rows with `aria-busy`, rest of dashboard usable | Not applicable (six routed features always listed); "chưa có thay đổi" for the audit list | Table per feature: effective order with models, source badges (DB override / env / mặc định code), selects and Save; audit list | Inline `role="alert"` with "Thử lại"; save errors (422 message, 503 store unavailable) shown on the row, previous canonical values kept | Section only rendered inside the admin access gate; API 401/403 shown as "Không có quyền" | Horizontal scroll under 720 px; native selects and buttons with labels; focus stays on the Save button after save; both themes via admin tokens |
| `/admin` AI section — usage | Placeholder figures with `aria-busy` while a window loads | "Chưa có lượt gọi AI trong khoảng này" | Totals plus per-feature and per-provider tables with tokens (input/output/thinking/cache read/cache write), calls, failed attempts, USD estimate; legacy/unpriced notes | Inline alert with "Thử lại"; the window selector stays usable | As above | Window tablist with arrow/Home/End keys; numbers formatted `vi-VN`; tables scroll on mobile |
| `/admin` AI section — failures | Placeholder with `aria-busy` | "Không có lỗi gọi AI trong khoảng này" | Counts per provider × feature (retry/fallback/final, error types) and latest 50 rows with Saigon time | Inline alert with "Thử lại"; `not_migrated` shows "Chưa áp dụng migration 321" instead of an error | As above | Same window as usage panel; list is a table with caption; times include date |

Canonical data ownership: every value comes from the four `/admin/ai/*`
endpoints. A save never edits local state optimistically: the row shows a
pending state until the PATCH returns the refetched `AdminAiModelsOut`,
which replaces the whole models panel. A full reload must show the same values
as the post-save state. Store status (`ok`, `stale`, `unavailable`, `not_migrated`,
`not_loaded`) is always visible in the models panel header.
