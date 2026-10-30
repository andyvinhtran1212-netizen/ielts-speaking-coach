# UI state matrix

No new screen or component. The table lists the existing surfaces that show
the new error bodies through `frontend/public/js/api.js` (`detail.message`).

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Speaking practice submit (`/practice/session`) | Existing "processing" state while the recording uploads | No recording: existing 422 "File âm thanh trống" | Recording stored and graded as today | 413: existing text "File quá lớn (… MB). Giới hạn là 50 MB." shown before transcription; the learner is told why and can re-record or pick a smaller file. 415 cannot occur (types are normalised) unless Storage refuses, then "Định dạng ghi âm không được hỗ trợ." (proposal) | Learner route, unchanged | Existing error line in the practice shell; no layout change |
| Admin image uploads (Writing chart, Reading image, Listening map) | Existing upload spinner | No file chosen: unchanged | Image stored, preview shown as today | 413 "File quá lớn (tối đa 5 MB)." (Listening map: same text, route limit 5 MB); 415 "Chỉ nhận ảnh PNG, JPG hoặc WebP." (proposal); the admin can pick another file, nothing is stored | Admin/staff routes, unchanged | Existing admin error text; no layout change |

Proposed Vietnamese texts are pending Content Manager review (T005).
Canonical data: no client state changes; a reload shows the stored object or
none.
