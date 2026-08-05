// Phần THUẦN của trang chủ học viên — tách khỏi `home-behavior.tsx` có chủ ý.
//
// VÌ SAO LÀ `.mjs` RIÊNG: `node --test` không nạp được `.tsx`, nên logic nằm
// trong component sẽ chỉ được "chặn bằng regex trên mã nguồn" — cách chốt yếu mà
// một vòng review trước đã bác. Đây đúng là khuôn `lib/when-global-ready.mjs`.
//
// Những hàm này port SÁT NGHĨA `public/js/home.js`. Bản legacy phơi chúng ra
// `window.__home` cho `tests/home.test.js`; bản Next phơi qua export. Hai bộ
// test chạy CÙNG bộ ca (`tests/home-metrics.test.mjs`) — lệch nhau là parity
// gãy, nên sửa một bên thì phải sửa cả hai.

export const SKILLS_ORDER = [
  'writing', 'speaking', 'grammar', 'vocabulary', 'reading', 'listening',
];

/** Metadata tĩnh mỗi kỹ năng — chép nguyên từ `home.js`. */
export const SKILL_META = {
  writing: { icon: '✍︎', name: 'Writing', desc: 'Bài luận Task 1 & Task 2 với feedback chi tiết.' },
  speaking: { icon: '🎙', name: 'Speaking', desc: 'Luyện nói 3 phần và nhận điểm band tự động.' },
  grammar: { icon: '✦', name: 'Grammar', desc: '67 bài học ngữ pháp dành cho IELTS.' },
  vocabulary: { icon: '⌗', name: 'Vocabulary', desc: 'Wallet từ vựng cá nhân + flashcard SRS.' },
  reading: { icon: '✸', name: 'Reading', desc: 'Bài đọc IELTS với phân tích cấu trúc đoạn và chiến lược tìm ý chính.' },
  listening: { icon: '◐', name: 'Listening', desc: 'Bài nghe với note-taking pattern và phân tích bẫy đáp án.' },
};

/**
 * Chép nguyên `formatRelativeTime` của legacy, kể cả nhánh `diffDays < 0`
 * (mốc ở tương lai) trả 'Hôm nay' — trông như thừa nhưng lệch giờ máy khách là
 * có thật, và đổi ở đây là làm lệch parity.
 */
export function formatRelativeTime(isoString) {
  if (!isoString) return 'Chưa có hoạt động';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return 'Chưa có hoạt động';
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'Hôm nay';
  if (diffDays === 0) return 'Hôm nay';
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays < 7) return diffDays + ' ngày trước';
  if (diffDays < 30) return Math.floor(diffDays / 7) + ' tuần trước';
  if (diffDays < 365) return Math.floor(diffDays / 30) + ' tháng trước';
  return Math.floor(diffDays / 365) + ' năm trước';
}

/**
 * Một formatter mỗi kỹ năng. Giữ dạng BẢNG như legacy: bật Reading/Listening
 * sang active về sau là thêm một khoá, không phải sửa một câu switch.
 */
export const METRIC_FORMATTERS = {
  writing(s) {
    const band = s.last_band != null ? s.last_band.toFixed(1) : '—';
    const inProgress = s.essays_in_progress || 0;
    return {
      primary: { value: band, unit: 'band' },
      sub: s.essays_count
        ? (s.essays_count + ' bài đã nộp'
            + (inProgress ? ' · <span class="pulse-wrap"><span class="pulse"></span>' + inProgress + ' đang chờ</span>' : ''))
        : 'Chưa có bài nào',
    };
  },
  speaking(s) {
    const band = s.last_band != null ? s.last_band.toFixed(1) : '—';
    return {
      primary: { value: band, unit: 'band' },
      sub: s.sessions_count ? s.sessions_count + ' session đã luyện' : 'Chưa luyện session nào',
    };
  },
  grammar(s) {
    return {
      primary: { value: String(s.lessons_viewed || 0), unit: 'bài đã xem' },
      sub: s.lessons_viewed ? 'Xem lại các bài đã đánh dấu' : 'Khám phá 67 bài học ngữ pháp',
    };
  },
  vocabulary(s) {
    const due = s.flashcards_due || 0;
    // `words_learned` là HỢP của ví cá nhân và phần thuộc qua Quick-Check, nên
    // dòng phụ phải gọi đúng nguồn con số — gọi chung là "Wallet từ vựng cá
    // nhân" từng báo với người chỉ làm quiz rằng ví rỗng của họ có 136 từ
    // (Codex review, PR #876).
    const wallet = s.wallet_words || 0;
    const quiz = s.quiz_words_mastered || 0;
    let sub;
    if (due) sub = '<span class="pulse"></span>' + due + ' thẻ đến hạn';
    else if (wallet && quiz) sub = 'Wallet cá nhân + Quick-Check';
    else if (quiz) sub = 'Đã thuộc qua Quick-Check';
    else if (wallet) sub = 'Wallet từ vựng cá nhân';
    else sub = 'Bắt đầu lưu từ mới';
    return { primary: { value: String(s.words_learned || 0), unit: 'từ' }, sub };
  },
  reading(s) {
    const band = s.last_band != null ? s.last_band.toFixed(1) : '—';
    return {
      primary: { value: band, unit: 'band' },
      sub: s.attempts_count
        ? s.attempts_count + ' bài đã hoàn thành'
        : 'Luyện đọc với bài kiểm tra IELTS thực tế',
    };
  },
  listening(s) {
    if (s.last_band != null) {
      return {
        primary: { value: s.last_band.toFixed(1), unit: 'band' },
        sub: s.attempts_count ? s.attempts_count + ' bài đã hoàn thành' : 'Tiếp tục luyện nghe',
      };
    }
    return {
      primary: { value: String(s.attempts_count || 0), unit: 'bài' },
      sub: s.attempts_count ? 'Tiếp tục luyện nghe' : 'Luyện nghe với dictation và comprehension',
    };
  },
};
