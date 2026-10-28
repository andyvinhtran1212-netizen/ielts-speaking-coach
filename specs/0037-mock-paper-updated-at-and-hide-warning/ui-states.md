# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Admin Mock Test create form, Listening/Reading source picker | No warning while the picker is still loading; existing "Đang tìm trong kho đề…" status | No source selected, or a private source selected: no hide warning | Public source selected: `PUBLIC_SOURCE_HIDE_WARNING` shown under that picker (one per public skill), next to the existing "học viên có thể đã xem đề" note; save behaviour unchanged | Picker load failure keeps the existing error and blocks save; a rejected save keeps the selection and the warning | Admin-only route, unchanged | `role="alert"` so screen readers announce it on selection; Aver warning tokens (`--av-warning`, `--av-warning-soft`) in both themes; wraps inside the picker card on narrow widths |

Canonical data: `is_public` comes from `GET /admin/mock-exams/picker`. A reload
shows the warning again only after the admin re-selects a public source; after
a save the source is private, so it no longer warns.
