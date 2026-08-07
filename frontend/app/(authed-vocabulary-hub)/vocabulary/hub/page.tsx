// Trang "Từ vựng" (hub học viên) trên Next — `/vocabulary/hub`.
//
// CỐ Ý KHÔNG LẤY TÊN `/vocabulary`. Hôm nay có HAI trang khác nhau cùng mang
// tên đó: `/vocabulary.html` (Vocabulary Wiki công khai, 88 dòng — thanh điều
// hướng đang trỏ vào đây) và `/pages/vocabulary.html` (hub học viên, trang này).
// Không có rewrite nào nối chúng, và `docs/ROUTE_LEDGER.md` tự ghi bản gốc "cần
// rà soát". Port vào `/vocabulary` là âm thầm đổi nơi học viên đáp xuống — một
// quyết định sản phẩm, không phải việc của một lượt port. Khi chủ dự án chốt
// trang nào sở hữu `/vocabulary`, đổi route ở đây là xong.
//
// MARKUP DÙNG NGUYÊN VĂN, không gõ lại thành JSX. Thân trang là 167 dòng markup
// TĨNH, và trong đó có 5 icon phải khớp lucide TỪNG BYTE. Gõ tay sang JSX thì:
//   · JSX xoá khoảng trắng có xuống dòng giữa các phần tử — đúng lỗi đã làm G1
//     đỏ ở `/grammar/exercises`;
//   · và mỗi thuộc tính phải đổi tên bằng tay, mỗi chỗ là một cơ hội sai.
// Dùng markup nguyên văn thì cổng parity so được đúng cái nó cần so. Nội dung là
// markup tĩnh trong repo, không có dữ liệu người dùng.
//
// 5 ICON LUCIDE ĐƯỢC NHÚNG THẲNG, và SVG là ĐO TỪ TRANG ĐANG CHẠY chứ không tự
// vẽ. Đã GỠ thuộc tính `data-lucide` khỏi SVG nhúng: giữ lại thì `createIcons()`
// vẫn coi chúng là chỗ cần thay và đổi lần nữa — đúng cuộc đua đang muốn tránh.
// Có chốt riêng cấm `data-lucide` trong cây React, và nó bắt được đúng chỗ này. Lý do không để `<i data-lucide>` + `createIcons()` như legacy: lucide
// 1.17 tự đổi các thẻ đó ngay khi nạp, đua với hydrate của React và ném lỗi
// React #418. `suppressHydrationWarning` và "gọi sau khi mount" đều KHÔNG giải
// quyết được — chỉ nhúng sẵn SVG mới hết đua.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  // Byte-faithful với <title> của bản legacy
  title: 'Từ vựng — Aver Learning',
  robots: { index: false, follow: false },
};

const BODY = "  <aver-chrome active=\"vocabulary\"></aver-chrome>\n\n  <div class=\"shell\">\n\n    <!-- ── Header ────────────────────────────────────────────────── -->\n    <header class=\"vocab-header\">\n      <p class=\"eyebrow\">Vocabulary</p>\n      <h1>Từ vựng <span class=\"accent\">của bạn</span></h1>\n      <p class=\"subtitle\">\n        Quản lý vốn từ, ôn tập flashcards theo lịch tự động, và luyện tập từ vựng — tất cả trong một trang.\n      </p>\n    </header>\n\n    <!-- ── Stats strip ───────────────────────────────────────────────\n         Audit 2026-07-28 — all three tiles used to read the personal\n         flashcard wallet, which is behind a default-deny feature flag:\n         every learner who practises via Quick-Check saw \"0 từ / 0 thẻ / —\".\n         They now read the Quick-Check facets (words_learned is the UNION of\n         wallet + quiz mastery; the other two are quiz-side), so the numbers\n         reflect the practice the learner actually does. The \"cần ôn\" tile\n         deep-links to the mistakes review, which is the action it implies. -->\n    <div class=\"vocab-stats\" aria-label=\"Tổng quan từ vựng\">\n      <div class=\"stat\">\n        <span class=\"label\">Từ đã thuộc</span>\n        <span class=\"value\">\n          <span id=\"stat-words-count\" class=\"skeleton-num\"></span>\n          <span class=\"unit\">từ</span>\n        </span>\n      </div>\n      <div class=\"stat heat\">\n        <span class=\"label\">Từ từng trả lời sai</span>\n        <span class=\"value\">\n          <span id=\"stat-words-missed\" class=\"skeleton-num\"></span>\n          <span class=\"unit\">từ</span>\n        </span>\n      </div>\n      <div class=\"stat\">\n        <span class=\"label\">Phiên đã luyện</span>\n        <span class=\"value\">\n          <span id=\"stat-quiz-sessions\" class=\"skeleton-num\"></span>\n          <span class=\"unit\">phiên</span>\n        </span>\n      </div>\n    </div>\n\n    <!-- ── Mode-card grid (Sprint 8.2) ──────────────────────────── -->\n    <!-- Sprint 8.2 — the ARIA tablist row was retired in favor of a\n         mode-card grid (same pattern as Sprint 8.1 speaking.html). The\n         dashboard view is now the page's default landing state; the\n         `.tab-panel` sections below stay hidden until a mode-card click\n         or a #hash deep-link activates one of them. activateTab() in\n         /js/vocab-landing.js still owns the panel toggle + module\n         mount; hash deep-linking (#vocab-topics / #flashcards /\n         #exercises) is preserved per Phase B Q5. -->\n    <section class=\"vocab-modes\" aria-labelledby=\"modes-heading\">\n      <h2 id=\"modes-heading\">Bắt đầu học từ vựng</h2>\n      <div class=\"modes-grid\">\n        <!-- Clicking opens an inline topic-picker panel; selecting a topic\n             navigates to /vocabulary.html?cat=<slug> (the public wiki). -->\n        <a href=\"#\" class=\"mode-card\" data-mode=\"vocab-topics\" aria-label=\"Duyệt từ vựng theo chủ đề\">\n          <div class=\"head\">\n            <div class=\"icon\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" class=\"lucide lucide-library\"><path d=\"m16 6 4 14\"></path><path d=\"M12 6v14\"></path><path d=\"M8 8v12\"></path><path d=\"M4 4v16\"></path></svg></div>\n            <span class=\"arrow\" aria-hidden=\"true\">→</span>\n          </div>\n          <h3>Từ vựng</h3>\n          <p class=\"lede\">Duyệt từ vựng IELTS theo chủ đề.</p>\n        </a>\n        <!-- Quick-Check practice. Audit 2026-07-28 §C5: this was the only vocab\n             surface every learner can actually use, yet it was reachable only from\n             a small button inside a topic card — while the two flag-gated cards\n             below sat at the top level and dead-ended for 67 of 68 users. -->\n        <a href=\"/pages/vocab-practice.html\" class=\"mode-card\" aria-label=\"Mở Luyện tập từ vựng\">\n          <div class=\"head\">\n            <div class=\"icon\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" class=\"lucide lucide-pen-line\"><path d=\"M13 21h8\"></path><path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"></path></svg></div>\n            <span class=\"arrow\" aria-hidden=\"true\">→</span>\n          </div>\n          <h3>Luyện tập</h3>\n          <p class=\"lede\">Kiểm tra tới khi thuộc trọn cả list từ.</p>\n        </a>\n        <!-- data-flag: vocab-landing.js REVEALS these two only when /auth/me says\n             the learner's feature flag is on, and REMOVES them from the DOM\n             otherwise (default-deny, same rule the modules themselves apply).\n             Without that they rendered for everyone and led straight to\n             \"Tính năng chưa được bật\". They ship `hidden` because the flag\n             lookup is a network round-trip: rendering them visible until it\n             answers let a default-denied learner click through in the gap\n             (Codex review, PR #876). -->\n        <a href=\"#\" class=\"mode-card\" data-mode=\"flashcards\" data-flag=\"flashcard_enabled\"\n           hidden aria-label=\"Mở Flashcards\">\n          <div class=\"head\">\n            <div class=\"icon\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" class=\"lucide lucide-layers\"><path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\"></path><path d=\"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12\"></path><path d=\"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17\"></path></svg></div>\n            <span class=\"arrow\" aria-hidden=\"true\">→</span>\n          </div>\n          <h3>Flashcards</h3>\n          <p class=\"lede\">Học từ với hệ thống lặp khoảng cách.</p>\n        </a>\n        <a href=\"#\" class=\"mode-card\" data-mode=\"exercises\" data-flag=\"d1_enabled,flashcard_enabled\"\n           hidden aria-label=\"Mở Exercises\">\n          <div class=\"head\">\n            <div class=\"icon\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" class=\"lucide lucide-dumbbell\"><path d=\"M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z\"></path><path d=\"m2.5 21.5 1.4-1.4\"></path><path d=\"m20.1 3.9 1.4-1.4\"></path><path d=\"M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z\"></path><path d=\"m9.6 14.4 4.8-4.8\"></path></svg></div>\n            <span class=\"arrow\" aria-hidden=\"true\">→</span>\n          </div>\n          <h3>Exercises</h3>\n          <p class=\"lede\">Luyện tập đa dạng dạng bài.</p>\n        </a>\n        <!-- Exam-prep vocab (AWL / TOEIC / THPT). NO data-mode → this is a real\n             link (not an SPA panel); vocab-landing's .mode-card[data-mode]\n             delegation skips it and the browser navigates to the exam page. -->\n        <a href=\"/vocabulary/exam\" class=\"mode-card\" aria-label=\"Mở Từ vựng luyện thi\">\n          <div class=\"head\">\n            <div class=\"icon\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" class=\"lucide lucide-graduation-cap\"><path d=\"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z\"></path><path d=\"M22 10v6\"></path><path d=\"M6 12.5V16a6 3 0 0 0 12 0v-3.5\"></path></svg></div>\n            <span class=\"arrow\" aria-hidden=\"true\">→</span>\n          </div>\n          <h3>Luyện thi</h3>\n          <p class=\"lede\">Từ vựng AWL, TOEIC, THPT theo danh sách đề.</p>\n        </a>\n      </div>\n    </section>\n\n    <!-- ── Tab panels ────────────────────────────────────────────── -->\n    <!--\n      Sprint 6.10 preserves the Sprint 6.0 iframe contract byte-identical\n      (DEBT-2026-05-09-B remains deferred — no un-defer triggers fired).\n      The iframe children (my-vocabulary.html, flashcards.html, etc.) are\n      still legacy dark-only pages; Sprint 6.11 will migrate them and\n      propagate theme via same-origin localStorage. Until then the panels\n      render in legacy dark navy regardless of the parent's active theme.\n    -->\n\n    <!-- Sprint 8.2 — all 4 panels start hidden; dashboard view above is\n         the default landing state. aria-labelledby points at the mode-card\n         heading so screen readers still anchor each panel to its trigger. -->\n\n    <!-- B3 — the word-library browse panel was retired; the \"Từ vựng\" mode-card\n         now links to the public wiki master-detail (/vocabulary.html), the single\n         browse surface. The hub keeps only the login-gated \"của bạn\" tools below. -->\n\n    <section class=\"tab-panel\" data-panel=\"flashcards\" id=\"panel-flashcards\"\n             role=\"tabpanel\" aria-labelledby=\"modes-heading\" hidden>\n      <!-- Sprint 7.4 — flashcards tab migrated to ES-module mount,\n           matching the Sprint 7.3 my-vocab pattern. vocab-landing.js\n           dynamic-imports /js/vocab-modules/flashcards.js and calls\n           mount(container, { embedded: true }). Exercises tab below\n           still uses the iframe path until Sprint 7.5. -->\n      <div class=\"tab-mount\" id=\"mount-flashcards\"></div>\n    </section>\n\n    <section class=\"tab-panel\" data-panel=\"exercises\" id=\"panel-exercises\"\n             role=\"tabpanel\" aria-labelledby=\"modes-heading\" hidden>\n      <!-- Sprint 7.5 — exercises tab migrated to ES-module mount, matching\n           Sprint 7.3 / 7.4 patterns. vocab-landing.js dynamic-imports\n           /js/vocab-modules/exercises.js and calls mount(container,\n           { embedded: true }). Milestone: zero iframe paths remain in\n           vocabulary.html — all 3 vocab children on module pattern.\n           Sprint 7.6 retires embedded-mode.css + the legacy iframe\n           branch in activateTab(). -->\n      <div class=\"tab-mount\" id=\"mount-exercises\"></div>\n    </section>\n\n    <section class=\"tab-panel\" data-panel=\"vocab-topics\" id=\"panel-vocab-topics\"\n             role=\"tabpanel\" aria-labelledby=\"modes-heading\" hidden>\n      <div class=\"tab-mount\" id=\"mount-vocab-topics\"></div>\n    </section>\n\n  </div>\n\n  <!-- Scripts: supabase → api.js → page logic. Same pattern as home.html. -->";

// `vocab-landing.js` là script THƯỜNG, TỰ CHẠY ngay khi nạp. Đặt nó bằng thẻ
// `<script src>` tĩnh thì nó chạy TRƯỚC khi `AuthedShell` kịp dựng phiên
// Supabase, gọi API không kèm token và ăn 401 → bị đá về `/login.html`. G1 bắt
// đúng chuyện đó: 401 ở `/auth/me` + `/api/student/home-summary`, và H1 biến mất.
//
// Bản legacy không gặp vì nó gọi `initSupabase(...)` NGAY TRƯỚC thẻ script đó.
// Nên ở đây phải chờ phiên rồi mới nạp — vẫn là CHÍNH tệp legacy, chỉ đổi thời
// điểm nạp cho khớp thứ tự bản legacy.
const BOOT = `
const ready = () => typeof window.getSupabase === 'function' && !!window.getSupabase();
const load = () => {
  const s = document.createElement('script');
  s.src = '/js/vocab-landing.js';
  document.body.appendChild(s);
};
if (ready()) load();
else {
  let n = 0;
  const iv = setInterval(() => {
    if (ready()) { clearInterval(iv); load(); }
    else if (++n > 500) {  // 500 x 20ms = 10s
      clearInterval(iv);
      console.error('[vocabulary-hub] Supabase khong san sang sau 10s');
    }
  }, 20);
}
`.trim();

export default function VocabularyHubPage() {
  return (
    <>
      {/* @ts-ignore */}
      <aver-chrome active="vocabulary" />
      <div dangerouslySetInnerHTML={{ __html: BODY }} />
      <script type="module" dangerouslySetInnerHTML={{ __html: BOOT }} />
    </>
  );
}
