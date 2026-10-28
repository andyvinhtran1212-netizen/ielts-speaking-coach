# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| `/login` activation dialog | Unchanged (button busy, in-flight lock) | Unchanged ("Vui lòng nhập access code.") | Unchanged (canonical `/auth/me`, redirect) | 429 → "Quá nhiều lần thử kích hoạt. Vui lòng đợi vài phút rồi thử lại."; 503 → "Chưa kiểm tra được lượt kích hoạt. Mã CHƯA được sử dụng — vui lòng thử lại sau ít phút."; the learner retries with the same button; the canonical `/auth/me` reconciliation still runs | Unchanged | Same `lx-error` `role="alert"` line as every other activation error; no layout change |

Canonical data ownership is unchanged: after any activation response the page
refetches `/auth/me` and routes only on its `is_active`.
