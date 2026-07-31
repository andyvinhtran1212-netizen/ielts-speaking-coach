/**
 * frontend/js/listening-landing.js
 *
 * Count-driven controller for the Listening landing page.
 *
 * Why this exists: the landing shipped six hard-coded mode cards. Four of
 * them (Chép chính tả / Nghe ý chính / Đúng-Sai / Trắc nghiệm) linked to
 * pages that require a `?content_id=` and render an empty state without
 * one, so clicking them from the landing always dead-ended. Hard-coding is
 * the root cause: the markup asserted content that the database did not
 * have. Cards are now revealed by GET /api/listening/overview and a card
 * with a zero count simply never appears.
 *
 * Contract: every count in /overview is computed with the same filters the
 * corresponding list page uses, so a visible card always opens onto a
 * populated list.
 */

const SUPABASE_URL  = 'https://huwsmtubwulikhlmcirx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_hvevBST9lgIWRd5ITHtUpA_SYjiX6Ao';

(function bootstrapSupabase() {
  if (typeof window !== 'undefined' && window.initSupabase) {
    try { window.initSupabase(SUPABASE_URL, SUPABASE_ANON); } catch { /* swallow */ }
  }
})();

/** Vietnamese labels for the free-practice exercise modes.
 *
 *  These keys MUST stay equal to MODE_LINKS in listening-browse.js: this list
 *  is the promise the landing makes about what the library can open, and the
 *  browse card is what has to honour it. `mini_test` is deliberately absent —
 *  /overview reports it because it is a valid `listening_exercises` type, but
 *  there is no content-level page for it, so advertising it here would be the
 *  original dead-end bug in a new place. Anything the backend reports that is
 *  not in this map is ignored rather than printed, so the lede can never echo
 *  a raw server string. Pinned by listening-landing-counts.test.mjs. */
const MODE_LABELS = {
  dictation:  'Chép chính tả',
  gist:       'Nghe ý chính',
  true_false: 'Đúng / Sai',
  mcq:        'Trắc nghiệm',
};

/** Resolve a dotted path such as "tests.full" against the overview payload. */
export function readCount(overview, key) {
  const n = String(key || '').split('.').reduce(
    (acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined),
    overview,
  );
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Modes with at least one published exercise, as display labels. */
export function availableModeLabels(overview) {
  const modes = (overview && overview.exercise_modes) || {};
  return Object.keys(MODE_LABELS)
    .filter((m) => Number(modes[m]) > 0)
    .map((m) => MODE_LABELS[m]);
}

export function applyOverview(doc, overview) {
  let examShown = 0;

  doc.querySelectorAll('[data-count-key]').forEach((card) => {
    const n = readCount(overview, card.getAttribute('data-count-key'));
    if (n <= 0) {
      card.hidden = true;
      return;
    }
    const slot = card.querySelector('[data-count-slot]');
    if (slot) slot.textContent = `${n} bài`;
    card.hidden = false;
    if (card.closest('#section-library') === null) examShown += 1;
  });

  const library = doc.getElementById('section-library');
  const browseCard = doc.querySelector('[data-mode="browse"]');
  const labels = availableModeLabels(overview);
  // Content rows alone are not something a learner can DO. With no runnable
  // mode, the library opens onto a list where every card reads "chưa có dạng
  // luyện nào" — a dead end one level down, which is the whole thing this page
  // was reorganised to remove. So the card needs both: rows AND a way in.
  if (browseCard && !browseCard.hidden && !labels.length) browseCard.hidden = true;
  if (library) library.hidden = !(browseCard && !browseCard.hidden);

  const lede = doc.getElementById('library-lede');
  if (lede && library && !library.hidden) {
    lede.textContent =
      `Nghe tự do theo chủ đề, giọng và trình độ. Dạng luyện đang có: ${labels.join(' · ')}.`;
  }

  const examEmpty = doc.getElementById('exam-empty');
  if (examEmpty) examEmpty.hidden = examShown > 0;
  return examShown;
}

/** API blip must not leave a blank page. Reveal the exam cards without
 *  counts — those three targets are list pages that render their own empty
 *  state, so the worst case is an honest "chưa có đề nào". The library
 *  section stays hidden: it is the surface whose sub-pages dead-end. */
function revealExamCardsUnverified(doc) {
  doc.querySelectorAll('[data-count-key^="tests."]').forEach((card) => {
    const slot = card.querySelector('[data-count-slot]');
    if (slot) slot.remove();
    card.hidden = false;
  });
  const examEmpty = doc.getElementById('exam-empty');
  if (examEmpty) examEmpty.hidden = true;
}

function paintIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

async function load() {
  const doc = document;
  try {
    const overview = await window.api.get('/api/listening/overview');
    applyOverview(doc, overview);
  } catch (e) {
    revealExamCardsUnverified(doc);
    const banner = doc.getElementById('landing-error');
    if (banner) {
      banner.textContent =
        'Không tải được số lượng bài. Danh sách bên dưới vẫn mở được. '
        + ((e && e.message) ? e.message : '');
      banner.hidden = false;
    }
  } finally {
    paintIcons();
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && window.api) {
  document.addEventListener('DOMContentLoaded', load);
} else if (typeof document !== 'undefined') {
  // api.js is a classic script; if this module evaluated first, wait for load.
  window.addEventListener('load', load);
}
