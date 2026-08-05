// Phần THUẦN của trang Speaking — hằng số nội dung + quy tắc quyết định.
//
// VÌ SAO LÀ `.mjs` RIÊNG: `node --test` không nạp được `.tsx`, nên logic nằm
// trong component sẽ chỉ chặn được bằng regex trên mã nguồn — cách chốt yếu mà
// một vòng review trước đã bác. Cùng khuôn `lib/when-global-ready.mjs` và
// `lib/home-metrics.mjs`.
//
// Những giá trị dưới đây port SÁT NGHĨA khối script nội tuyến của
// `public/pages/speaking.html`. Lệch một chữ là cổng parity báo `line-missing`,
// nên `tests/speaking-copy.test.mjs` so TRỰC TIẾP với bản legacy.

/** Chủ đề mặc định khi người dùng không chọn (Test / Full Test bỏ qua modal). */
export const DEFAULT_TOPICS = {
  1: 'Daily Life & Personal Interests',
  2: 'Describing a Person or Experience',
  3: 'Society, Technology & Modern Issues',
};

/** Quyền mặc định AN TOÀN cho tới khi `/auth/me` trả về. */
export const DEFAULT_PERMISSIONS = ['practice_single', 'practice_part', 'practice_full'];

/** Ba tab luyện tập và scope quyền tương ứng. */
export const TAB_DEFS = [
  { tab: 'practice', scope: 'practice_single', label: 'Luyện tập' },
  { tab: 'partbpart', scope: 'practice_part', label: 'Luyện từng Part' },
  { tab: 'fulltest', scope: 'practice_full', label: 'Full Test' },
];

export const CUE_CARD_LENGTH_WARN_CHARS = 200;
export const CUE_CARD_LENGTH_WARN_WORDS = 30;

export const CUE_CARD_PLACEHOLDER_DEFAULT =
  'Ví dụ:\nDo you enjoy spending time outdoors?\n'
  + 'How has technology changed your daily life?\n'
  + 'Describe a memorable experience.';

export const CUE_CARD_PLACEHOLDER_PART2 =
  'Ví dụ:\nDescribe a traditional festival you attended.\n\n'
  + 'Chỉ cần 1 dòng đầu — web sẽ tự tạo phần "You should say..." và bullets.';

export const CUE_CARD_HINT_DEFAULT_HTML =
  'Part 1 / 3: mỗi dòng một câu (tối đa 10). '
  + 'Part 2: paste cue card đầy đủ, hoặc nhập 1 dòng để AI tạo cue card.';

export const CUE_CARD_HINT_PART2_HTML =
  '<strong>Part 2 (Cue card):</strong> chỉ nhập <em>1 dòng đầu</em> như '
  + '"Describe a person you admire." — web tự tạo phần '
  + '"You should say..." và bullets.';

/** `all` là quyền bao trùm — giữ nguyên ngữ nghĩa của bản legacy. */
export function hasPermission(perms, scope) {
  const list = Array.isArray(perms) ? perms : [];
  return list.indexOf('all') !== -1 || list.indexOf(scope) !== -1;
}

/**
 * Tên hiển thị trên lời chào.
 *
 * KHÔNG dùng phần tử-cuối kiểu ES2022 (`.at(-1)`): API đó cần Safari 15.4, sàn
 * của dự án là iOS 15.0. Bản legacy đã dính đúng lỗi này (DEBT-2026-07-29-K,
 * review #882) và ghi chú lại — giữ nguyên cách viết an toàn.
 */
export function greetingName(user) {
  const email = user && user.email;
  const display = (user && (user.display_name || user.full_name))
    || (email ? String(email).split('@')[0] : '')
    || 'Bạn';
  const parts = String(display).split(' ');
  return { display, short: parts[parts.length - 1] };
}

/**
 * Cảnh báo độ dài cue card CHỈ áp dụng cho Part 2 — Part 1/3 cố ý nhận nhiều
 * dòng nên cảnh báo ở đó là nhiễu.
 *
 * Trả về ĐÚNG hình dạng bản legacy ghi vào DOM: `state` đi vào `data-state`
 * (`'visible' | 'hidden'` — KHÔNG phải `'warn'`, tôi đã đoán sai một lần rồi
 * đối chiếu lại), và `html` là nội dung cảnh báo KÈM SỐ ĐẾM. Màu sắc do
 * `ds.css` quyết định theo `data-state` (Pattern #26); không hardcode ở JS.
 *
 * Số ký tự / số từ nằm TRONG câu cảnh báo, nên đây là chữ người dùng đọc được
 * ⇒ cổng parity sẽ so nó. Lệch là gãy.
 */
export function cueCardLengthWarning(text, partNum) {
  const HIDDEN = { state: 'hidden', html: '' };
  if (partNum !== 2) return HIDDEN;
  const s = String(text || '').trim();
  const charCount = s.length;
  const wordCount = s ? s.split(/\s+/).filter(Boolean).length : 0;
  if (charCount <= CUE_CARD_LENGTH_WARN_CHARS && wordCount <= CUE_CARD_LENGTH_WARN_WORDS) {
    return HIDDEN;
  }
  return {
    state: 'visible',
    html:
      '<span class="ds-cuecard-length-warning-icon" aria-hidden="true">⚠️</span>'
      + '<p class="ds-cuecard-length-warning-message">'
      + 'Part 2 chỉ cần 1 dòng đầu (ví dụ: "Describe..."). '
      + 'Web sẽ tự tạo phần còn lại. Nội dung dài hơn ('
      + charCount + ' ký tự / ' + wordCount + ' từ) sẽ bị bỏ qua.'
      + '</p>',
  };
}
