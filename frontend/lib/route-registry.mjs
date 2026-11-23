// frontend/lib/route-registry.mjs — the one page catalogue (UIBASE-0056 FR-012, G03-T11).
//
// Every App Router `page.tsx` has exactly one entry here, plus `planned`
// entries for hubs and pages later packages create (G05 public courses,
// G07 learner hubs). The registry knows what the scattered route tables do
// not: which navigation section a page belongs to, its parent page, and which
// query parameters it cannot open without (and where it sends the visitor
// when one is missing — `parentOnMissing`, the G02-T11 RedirectNotice target).
//
// The learner shell (G03-T14) highlights its active item from `sectionFor`;
// the navigation bridge (G03-T12) uses `isV2Route` to force a full reload
// between the legacy tree and the new one.
//
// Not merged with docs/ROUTE_LEDGER.md, PUBLIC_BY_DESIGN, proxy.ts or
// robots.ts (spec open question 6: those stay parallel until G10).
//
// Field notes:
//   requires   query parameters the page needs. 'a|b' means one of a or b.
//   section    learner sections are the five shell items plus 'account';
//              admin pages use 'admin:<group>' after the current
//              aver-admin-chrome NAV_GROUPS (overview, content, people,
//              system, pilot) until G09 supplies its 8 groups.
//   kind       'nav' = reachable from a menu; 'child' = reached from its
//              parent; 'focus' = runs in the focus bar (player, exam room);
//              'deep-link-only' = opened only from a link, no menu path.
//   note       why an entry looks unusual (orphans, prefix clashes).

/** @typedef {{
 *  route: string,
 *  owner: string | null,
 *  status: 'live' | 'planned' | 'redirect',
 *  audience: 'public' | 'learner' | 'instructor' | 'admin' | 'diagnostic',
 *  kind: 'nav' | 'child' | 'deep-link-only' | 'focus' | 'redirect' | 'diagnostic',
 *  section: string | null,
 *  parent: string | null,
 *  requires: string[],
 *  parentOnMissing: string | null,
 *  ui: 'v1' | 'v2',
 *  note?: string,
 * }} RouteEntry */

export const LEARNER_SECTIONS = Object.freeze(['home', 'course', 'practice', 'tests', 'library']);

/** @type {readonly RouteEntry[]} */
export const ROUTES = Object.freeze([
  { route: '/', owner: 'app/(marketing)/page.tsx', status: 'live', audience: 'public', kind: 'nav', section: 'public', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/about', owner: 'app/(public-v2)/about/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'public', parent: '/', requires: [], parentOnMissing: null, ui: 'v2' },
  { route: '/contact', owner: 'app/(public-v2)/contact/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'public', parent: '/', requires: [], parentOnMissing: null, ui: 'v2' },
  { route: '/privacy', owner: 'app/(public-v2)/privacy/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'public', parent: '/', requires: [], parentOnMissing: null, ui: 'v2' },
  { route: '/terms', owner: 'app/(public-v2)/terms/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'public', parent: '/', requires: [], parentOnMissing: null, ui: 'v2' },
  { route: '/pricing', owner: 'app/(marketing)/pricing/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'public', parent: '/', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/login', owner: 'app/(public-auth)/login/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'public', parent: '/', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/courses', owner: null, status: 'planned', audience: 'public', kind: 'child', section: 'public', parent: '/', requires: [], parentOnMissing: null, ui: 'v1', note: 'G05: trang khoá học công khai' },
  { route: '/courses/[slug]', owner: null, status: 'planned', audience: 'public', kind: 'child', section: 'public', parent: '/courses', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/home', owner: 'app/(authed-home)/home/page.tsx', status: 'live', audience: 'learner', kind: 'nav', section: 'home', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/course', owner: null, status: 'planned', audience: 'learner', kind: 'nav', section: 'course', parent: null, requires: [], parentOnMissing: null, ui: 'v1', note: 'G07 hub Lộ trình' },
  { route: '/practice', owner: null, status: 'planned', audience: 'learner', kind: 'nav', section: 'practice', parent: null, requires: [], parentOnMissing: null, ui: 'v1', note: 'G07 hub Luyện tập; cùng tiền tố với /practice/session (trình luyện Speaking đang chạy)' },
  { route: '/tests', owner: null, status: 'planned', audience: 'learner', kind: 'nav', section: 'tests', parent: null, requires: [], parentOnMissing: null, ui: 'v1', note: 'G07 hub Thi thử' },
  { route: '/library', owner: 'app/(public-library)/library/page.tsx', status: 'live', audience: 'public', kind: 'nav', section: 'library', parent: null, requires: [], parentOnMissing: null, ui: 'v2', note: 'LIBRARY-0061 T008 hub Thư viện, công khai; G07 không tạo route /library thứ hai. Khung: PublicShell (G03-T13); LearnerShell cho người đã đăng nhập khi G03-T14 xong' },
  { route: '/library/writing-samples', owner: null, status: 'planned', audience: 'public', kind: 'child', section: 'library', parent: '/library', requires: [], parentOnMissing: null, ui: 'v2', note: 'LIBRARY-0061 T009' },
  { route: '/library/writing-guides', owner: null, status: 'planned', audience: 'public', kind: 'child', section: 'library', parent: '/library', requires: [], parentOnMissing: null, ui: 'v2', note: 'LIBRARY-0061 T011' },
  { route: '/library/speaking', owner: null, status: 'planned', audience: 'public', kind: 'child', section: 'library', parent: '/library', requires: [], parentOnMissing: null, ui: 'v2', note: 'LIBRARY-0061 T013' },
  { route: '/account', owner: null, status: 'planned', audience: 'learner', kind: 'nav', section: 'account', parent: null, requires: [], parentOnMissing: null, ui: 'v1', note: 'G07 trang Tài khoản' },
  { route: '/progress', owner: null, status: 'planned', audience: 'learner', kind: 'child', section: 'account', parent: '/account', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/help', owner: null, status: 'planned', audience: 'learner', kind: 'child', section: 'account', parent: '/account', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/enroll/[orderCode]', owner: null, status: 'planned', audience: 'learner', kind: 'deep-link-only', section: 'account', parent: '/account', requires: [], parentOnMissing: null, ui: 'v1', note: 'G05: trang đơn đăng ký, mở từ liên kết đơn' },
  { route: '/onboarding', owner: 'app/(authed-onboarding)/onboarding/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'home', parent: '/home', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/profile', owner: 'app/(authed)/profile/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'account', parent: '/account', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/my-class', owner: 'app/(authed-my-class)/my-class/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'course', parent: '/course', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/course-exercises', owner: 'app/(authed)/course-exercises/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'course', parent: '/my-class', requires: ['bank'], parentOnMissing: '/my-class', ui: 'v1' },
  { route: '/grammar-lessons/assigned', owner: 'app/(authed)/grammar-lessons/assigned/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'course', parent: '/my-class', requires: ['assignment_item'], parentOnMissing: '/my-class', ui: 'v1' },
  { route: '/listening/exercise-book', owner: 'app/(authed-listening-player)/listening/exercise-book/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'course', parent: '/my-class', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/exercise-book/tests/[testId]', owner: 'app/(authed-listening-player)/listening/exercise-book/tests/[testId]/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'course', parent: '/listening/exercise-book', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/exercise-book/attempts/[attemptId]/review', owner: 'app/(authed-listening-player)/listening/exercise-book/attempts/[attemptId]/review/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'course', parent: '/listening/exercise-book', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/exercises', owner: 'app/(authed-exercises)/exercises/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'course', parent: '/my-class', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/d1-exercise', owner: 'app/(authed-d1-exercise)/d1-exercise/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'course', parent: '/my-class', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/speaking', owner: 'app/(authed-speaking)/speaking/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/practice', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/practice/session', owner: 'app/(authed-practice)/practice/session/page.tsx', status: 'live', audience: 'learner', kind: 'focus', section: 'practice', parent: '/speaking', requires: ['session_id'], parentOnMissing: '/speaking', ui: 'v1' },
  { route: '/result', owner: 'app/(authed-session-result)/result/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/speaking', requires: ['session_id|id'], parentOnMissing: '/speaking', ui: 'v1' },
  { route: '/speaking/result', owner: 'app/(authed-speaking-result)/speaking/result/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'tests', parent: '/full-test', requires: ['sitting'], parentOnMissing: '/speaking', ui: 'v1', note: 'kết quả Speaking của lượt thi thử; code đưa về /speaking khi thiếu sitting' },
  { route: '/writing/dashboard', owner: 'app/(authed-writing)/writing/dashboard/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/practice', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/writing/result', owner: 'app/(authed-writing-result)/writing/result/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/writing/dashboard', requires: ['essay_id|id'], parentOnMissing: '/writing/dashboard', ui: 'v1' },
  { route: '/reading', owner: 'app/(authed-reading)/reading/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/practice', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/reading/skill', owner: 'app/(authed-reading)/reading/skill/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/reading', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/reading/vocab', owner: 'app/(authed-reading)/reading/vocab/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/reading', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/reading/mini-test', owner: 'app/(authed-reading)/reading/mini-test/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/reading', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/reading/test', owner: 'app/(authed-reading)/reading/test/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/reading', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/reading/skill/[slug]', owner: 'app/(authed-reading)/reading/skill/[slug]/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/reading/skill', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/reading/vocab/[slug]', owner: 'app/(authed-reading)/reading/vocab/[slug]/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/reading/vocab', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/reading/exam/session', owner: 'app/(authed-reading-player)/reading/exam/session/page.tsx', status: 'live', audience: 'learner', kind: 'focus', section: 'practice', parent: '/reading/test', requires: ['test_id|share'], parentOnMissing: '/reading/test', ui: 'v1' },
  { route: '/reading/review', owner: 'app/(reading-review)/reading/review/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/reading/test', requires: ['attempt_id|admin_test_id'], parentOnMissing: '/reading/test', ui: 'v1', note: 'công khai theo thiết kế (lượt ẩn danh ?anon)' },
  { route: '/listening', owner: 'app/(authed-listening)/listening/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/practice', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/analytics', owner: 'app/(authed-listening)/listening/analytics/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/browse', owner: 'app/(authed-listening)/listening/browse/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/dictation', owner: 'app/(authed-listening)/listening/(standalone-exercises)/dictation/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/general', owner: 'app/(authed-listening)/listening/general/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/gist', owner: 'app/(authed-listening)/listening/(standalone-exercises)/gist/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/ielts', owner: 'app/(authed-listening)/listening/ielts/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/mcq', owner: 'app/(authed-listening)/listening/(standalone-exercises)/mcq/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/mini-test', owner: 'app/(authed-listening)/listening/mini-test/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/practice', owner: 'app/(authed-listening)/listening/practice/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/skills', owner: 'app/(authed-listening)/listening/skills/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/tests', owner: 'app/(authed-listening)/listening/tests/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/tf', owner: 'app/(authed-listening)/listening/(standalone-exercises)/tf/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/general/[lessonId]', owner: 'app/(authed-listening)/listening/general/[lessonId]/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening/general', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/ielts/[lessonId]', owner: 'app/(authed-listening)/listening/ielts/[lessonId]/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening/ielts', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/ielts/80-days', owner: 'app/(authed-listening)/listening/ielts/80-days/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening/ielts', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/ielts/80-days/[day]', owner: 'app/(authed-listening)/listening/ielts/80-days/[day]/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening/ielts/80-days', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/listening/lessons/[lessonId]', owner: 'app/(authed-listening)/listening/lessons/[lessonId]/page.tsx', status: 'live', audience: 'learner', kind: 'deep-link-only', section: 'practice', parent: null, requires: [], parentOnMissing: null, ui: 'v1', note: 'mồ côi theo báo cáo 12: không có mục điều hướng nào trỏ tới' },
  { route: '/listening/dictation/session', owner: 'app/(authed-listening-dictation)/listening/dictation/session/page.tsx', status: 'live', audience: 'learner', kind: 'focus', section: 'practice', parent: '/listening/dictation', requires: ['test_id|session_id'], parentOnMissing: '/listening', ui: 'v1' },
  { route: '/listening/practice-run', owner: 'app/(authed-listening-practice-run)/listening/practice-run/page.tsx', status: 'live', audience: 'learner', kind: 'focus', section: 'practice', parent: '/listening/practice', requires: ['id'], parentOnMissing: '/listening/practice', ui: 'v1' },
  { route: '/listening/test/session', owner: 'app/(authed-listening-player)/listening/test/session/page.tsx', status: 'live', audience: 'learner', kind: 'focus', section: 'practice', parent: '/listening/tests', requires: ['id'], parentOnMissing: '/listening', ui: 'v1' },
  { route: '/listening/review', owner: 'app/(authed-listening-review)/listening/review/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/listening', requires: ['attempt_id|admin_test_id'], parentOnMissing: '/listening', ui: 'v1' },
  { route: '/listening/programmes/form/[testId]', owner: 'app/(authed-listening-player)/listening/programmes/form/[testId]/page.tsx', status: 'live', audience: 'learner', kind: 'deep-link-only', section: 'practice', parent: null, requires: [], parentOnMissing: null, ui: 'v1', note: 'mở từ liên kết chương trình nghe' },
  { route: '/listening/programmes/result/[attemptId]', owner: 'app/(authed-listening-review)/listening/programmes/result/[attemptId]/page.tsx', status: 'live', audience: 'learner', kind: 'deep-link-only', section: 'practice', parent: null, requires: [], parentOnMissing: null, ui: 'v1', note: 'mở từ liên kết chương trình nghe' },
  { route: '/vocabulary/hub', owner: 'app/(authed-vocabulary-hub)/vocabulary/hub/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/practice', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/vocabulary/exam', owner: 'app/(authed-vocab-exam)/vocabulary/exam/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/vocabulary/hub', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/vocabulary/learn', owner: 'app/(authed-vocab-curated)/vocabulary/learn/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/vocabulary/hub', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/vocabulary/practice', owner: 'app/(authed-vocab-practice)/vocabulary/practice/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/vocabulary/hub', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/flashcards', owner: 'app/(authed-flashcards)/flashcards/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/vocabulary/hub', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/flashcard-study', owner: 'app/(flashcard-study)/flashcard-study/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/vocabulary/hub', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/vocabulary/learn/[unitSlug]', owner: 'app/(authed-vocab-curated)/vocabulary/learn/[unitSlug]/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/vocabulary/learn', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/vocabulary/sets/[setId]', owner: 'app/(authed-vocabulary-hub)/vocabulary/sets/[setId]/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/vocabulary/hub', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/vocabulary/study/[sessionId]', owner: 'app/(authed-vocabulary-hub)/vocabulary/study/[sessionId]/page.tsx', status: 'live', audience: 'learner', kind: 'focus', section: 'practice', parent: '/vocabulary/hub', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/advanced-vocabulary', owner: 'app/(authed-advanced-vocab)/advanced-vocabulary/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/vocabulary/hub', requires: ['bank','item'], parentOnMissing: '/vocabulary/hub', ui: 'v1' },
  { route: '/quiz', owner: 'app/(authed-quiz-player)/quiz/page.tsx', status: 'live', audience: 'learner', kind: 'focus', section: 'practice', parent: '/grammar/exercises', requires: ['bank|skill_area'], parentOnMissing: '/grammar/exercises', ui: 'v1', note: 'skill_area=vocab đưa về /vocabulary/hub' },
  { route: '/quiz/progress', owner: 'app/(authed-quiz-progress)/quiz/progress/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/grammar/exercises', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/grammar-checkup', owner: 'app/(authed)/grammar-checkup/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/practice', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/grammar-checkup/review/[routeId]', owner: 'app/(authed)/grammar-checkup/review/[routeId]/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'practice', parent: '/grammar-checkup', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/full-test', owner: 'app/(authed-full-test)/full-test/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'tests', parent: '/tests', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/full-test-result', owner: 'app/(authed-full-test-result)/full-test-result/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'tests', parent: '/full-test', requires: ['session_id'], parentOnMissing: '/speaking', ui: 'v1', note: 'code đưa về /speaking khi thiếu session_id' },
  { route: '/mock-exam', owner: 'app/(authed-mock-exam)/mock-exam/page.tsx', status: 'live', audience: 'learner', kind: 'focus', section: 'tests', parent: '/full-test', requires: ['code|sitting'], parentOnMissing: '/full-test', ui: 'v1' },
  { route: '/mock/result', owner: 'app/(authed-mock-result)/mock/result/page.tsx', status: 'live', audience: 'learner', kind: 'child', section: 'tests', parent: '/full-test', requires: ['sitting'], parentOnMissing: '/full-test', ui: 'v1' },
  { route: '/exam', owner: 'app/(authed-exam)/exam/page.tsx', status: 'live', audience: 'learner', kind: 'deep-link-only', section: 'tests', parent: null, requires: [], parentOnMissing: null, ui: 'v1', note: 'mồ côi theo báo cáo 12: không có mục điều hướng nào trỏ tới' },
  { route: '/grammar', owner: 'app/(public-content)/grammar/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'library', parent: '/library', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/grammar/[category]/[slug]', owner: 'app/(public-content)/grammar/[category]/[slug]/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'library', parent: '/grammar', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/grammar/exercises', owner: 'app/(public-content)/grammar/exercises/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'library', parent: '/grammar', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/grammar/roadmap', owner: 'app/(public-content)/grammar/roadmap/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'library', parent: '/grammar', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/grammar/search', owner: 'app/(public-content)/grammar/search/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'library', parent: '/grammar', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/grammar/compare', owner: 'app/(public-content)/grammar/compare/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'library', parent: '/grammar', requires: ['slug'], parentOnMissing: '/grammar', ui: 'v1' },
  { route: '/vocabulary', owner: 'app/(public-content)/vocabulary/page.tsx', status: 'live', audience: 'public', kind: 'child', section: 'library', parent: '/library', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/instructor', owner: 'app/(authed-instructor)/instructor/page.tsx', status: 'live', audience: 'instructor', kind: 'nav', section: 'instructor', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/instructor/grade', owner: 'app/(authed-instructor-grade)/instructor/grade/page.tsx', status: 'live', audience: 'instructor', kind: 'child', section: 'instructor', parent: '/instructor', requires: ['essay_id'], parentOnMissing: '/instructor', ui: 'v1' },
  { route: '/instructor/compare', owner: 'app/(authed-instructor-compare)/instructor/compare/page.tsx', status: 'live', audience: 'instructor', kind: 'child', section: 'instructor', parent: '/instructor', requires: ['essay_id'], parentOnMissing: '/instructor', ui: 'v1' },
  { route: '/next-probe', owner: 'app/next-probe/page.tsx', status: 'live', audience: 'diagnostic', kind: 'diagnostic', section: null, parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/recorder-spike', owner: 'app/(spike)/recorder-spike/page.tsx', status: 'live', audience: 'diagnostic', kind: 'diagnostic', section: null, parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/profile/v2-pilot', owner: 'app/(authed-v2-pilot)/profile/v2-pilot/page.tsx', status: 'live', audience: 'diagnostic', kind: 'diagnostic', section: null, parent: null, requires: [], parentOnMissing: null, ui: 'v2', note: 'G03-T12 trang thử ranh giới v1/v2; cùng cổng với /ui-library; gỡ ở G03-T14' },
  { route: '/ui-library', owner: 'app/(ui-library)/ui-library/page.tsx', status: 'live', audience: 'diagnostic', kind: 'diagnostic', section: null, parent: null, requires: [], parentOnMissing: null, ui: 'v2', note: 'G03 thư viện giao diện; 404 trừ khi bật AVER_ENABLE_UI_LIBRARY hoặc cờ diagnostic' },
  { route: '/admin', owner: 'app/(authed-admin)/(overview)/admin/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:overview', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/classes', owner: 'app/(authed-admin)/(classes)/admin/classes/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:people', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/classes/[cohortId]', owner: 'app/(authed-admin)/(classes)/admin/classes/[cohortId]/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:people', parent: '/admin/classes', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/classes/[cohortId]/exercise-book', owner: 'app/(authed-admin)/(classes)/admin/classes/[cohortId]/exercise-book/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:people', parent: '/admin/classes/[cohortId]', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/classes/[cohortId]/exercise-book/grants', owner: 'app/(authed-admin)/(classes)/admin/classes/[cohortId]/exercise-book/grants/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:people', parent: '/admin/classes/[cohortId]/exercise-book', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/dashboard/reading-attempts', owner: 'app/(authed-admin)/(reading-attempts)/admin/dashboard/reading-attempts/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:overview', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/error-logs', owner: 'app/(authed-admin)/(error-logs)/admin/error-logs/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:system', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/feedback', owner: 'app/(authed-admin)/(feedback)/admin/feedback/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:system', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/foot-traffic', owner: 'app/(authed-admin)/(foot-traffic)/admin/foot-traffic/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:overview', parent: '/admin', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/grammar', owner: 'app/(authed-admin)/(grammar)/admin/grammar/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/grammar-diagnostic', owner: 'app/(authed-admin)/(grammar)/admin/grammar-diagnostic/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:people', parent: '/admin/classes', requires: ['session'], parentOnMissing: '/admin/classes', ui: 'v1' },
  { route: '/admin/grammar-lessons', owner: 'app/(authed-admin)/(grammar)/admin/grammar-lessons/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:people', parent: '/admin/classes', requires: ['attempt'], parentOnMissing: '/admin/classes', ui: 'v1' },
  { route: '/admin/grammar/analytics', owner: 'app/(authed-admin)/(grammar-analytics)/admin/grammar/analytics/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/grammar/articles', owner: 'app/(authed-admin)/(grammar-articles)/admin/grammar/articles/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/grammar/recommend-test', owner: 'app/(authed-admin)/(grammar-recommend)/admin/grammar/recommend-test/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:pilot', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/instructors', owner: 'app/(authed-admin)/(instructors)/admin/instructors/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:people', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening', owner: 'app/(authed-admin-listening)/admin/listening/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/attempts', owner: 'app/(authed-admin-listening)/admin/listening/attempts/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/audit', owner: 'app/(authed-admin-listening)/admin/listening/audit/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/audit-detail', owner: 'app/(authed-admin-listening)/admin/listening/audit-detail/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/content/[contentId]', owner: 'app/(authed-admin-listening)/admin/listening/content/[contentId]/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/content/[contentId]/edit', owner: 'app/(authed-admin-listening)/admin/listening/content/[contentId]/edit/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/listening/content/[contentId]', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/dictation', owner: 'app/(authed-admin-listening)/admin/listening/dictation/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/gist', owner: 'app/(authed-admin-listening)/admin/listening/gist/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/import-drills', owner: 'app/(authed-admin-listening)/admin/listening/import-drills/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/import-fulltest', owner: 'app/(authed-admin-listening)/admin/listening/import-fulltest/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/mcq', owner: 'app/(authed-admin-listening)/admin/listening/mcq/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/segments', owner: 'app/(authed-admin-listening)/admin/listening/segments/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/tests', owner: 'app/(authed-admin-listening)/admin/listening/tests/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/tests/[testId]', owner: 'app/(authed-admin-listening)/admin/listening/tests/[testId]/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/listening/tests', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/listening/tf', owner: 'app/(authed-admin-listening)/admin/listening/tf/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/listening', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/mfa', owner: 'app/(authed-admin-mfa)/admin/mfa/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:overview', parent: '/admin', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/mock-exams', owner: 'app/(authed-admin)/(mock-exams)/admin/mock-exams/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/mock-exams/corrections', owner: 'app/(authed-admin)/(mock-exams)/admin/mock-exams/corrections/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/mock-exams', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/mock-live', owner: 'app/(authed-admin)/(mock-live)/admin/mock-live/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/mock-tests', requires: [], parentOnMissing: null, ui: 'v1', note: 'exam_id tuỳ chọn: thiếu thì hiện bộ chọn kỳ thi, không chuyển trang' },
  { route: '/admin/mock-pacing', owner: 'app/(authed-admin)/(mock-live)/admin/mock-pacing/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/mock-tests', requires: ['sitting'], parentOnMissing: '/admin/mock-tests', ui: 'v1', note: 'G02-T12: → /admin/mock-tests?tab=live' },
  { route: '/admin/mock-reviews', owner: 'app/(authed-admin)/(mock-reviews)/admin/mock-reviews/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/mock-tests', requires: ['mock_exam_id'], parentOnMissing: '/admin/mock-tests', ui: 'v1', note: 'G02-T10: thiếu kỳ thi → /admin/mock-tests?tab=review; khung nhúng embed=1 không chuyển trang' },
  { route: '/admin/mock-reviews/report', owner: 'app/(authed-admin)/(mock-reviews)/admin/mock-reviews/report/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/mock-reviews', requires: ['review_id'], parentOnMissing: '/admin/mock-tests', ui: 'v1', note: 'G02-T12: → /admin/mock-tests?tab=review (giữ exam_id khi có mock_exam_id)' },
  { route: '/admin/mock-tests', owner: 'app/(authed-admin)/(mock-tests)/admin/mock-tests/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/reading', owner: 'app/(authed-admin)/(reading)/admin/reading/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/reading/content', owner: 'app/(authed-admin-reading-content)/admin/reading/content/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/reading/preview', owner: 'app/(authed-admin-reading-preview)/admin/reading/preview/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/reading/content', requires: ['test_id'], parentOnMissing: '/admin/reading/content', ui: 'v1', note: 'G02-T12: adminReadingPreviewReturnHref giữ bộ lọc thư viện khi from=reading-content' },
  { route: '/admin/speaking', owner: 'app/(authed-admin)/(speaking)/admin/speaking/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/speaking/sessions', owner: 'app/(authed-admin)/(speaking-sessions)/admin/speaking/sessions/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/speaking/topics', owner: 'app/(authed-admin)/(speaking-topics)/admin/speaking/topics/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/students', owner: 'app/(authed-admin)/(students)/admin/students/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:people', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/system', owner: 'app/(authed-admin-system)/admin/system/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:system', parent: '/admin', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/system/ai-usage', owner: 'app/(authed-admin-system)/admin/system/ai-usage/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:system', parent: '/admin/system', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/system/alerts', owner: 'app/(authed-admin-system)/admin/system/alerts/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:system', parent: '/admin/system', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/usage', owner: 'app/(authed-admin)/(usage)/admin/usage/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:overview', parent: '/admin', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/users', owner: 'app/(authed-admin)/(users)/admin/users/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:people', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab', owner: 'app/(authed-admin)/(vocab)/admin/vocab/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab/content', owner: 'app/(authed-admin)/(vocab)/admin/vocab/content/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab/curated', owner: 'app/(authed-admin)/(vocab)/admin/vocab/curated/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:pilot', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab/d1-curation', owner: 'app/(authed-admin)/(vocab)/admin/vocab/d1-curation/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:pilot', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab/exercises', owner: 'app/(authed-admin)/(vocab)/admin/vocab/exercises/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:pilot', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab/lemmas', owner: 'app/(authed-admin)/(vocab)/admin/vocab/lemmas/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:pilot', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab/pilot-metrics', owner: 'app/(authed-admin)/(vocab)/admin/vocab/pilot-metrics/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:pilot', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab/quiz', owner: 'app/(authed-admin)/(vocab)/admin/vocab/quiz/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab/quiz-analytics', owner: 'app/(authed-admin)/(vocab)/admin/vocab/quiz-analytics/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab/sets', owner: 'app/(authed-admin)/(vocab)/admin/vocab/sets/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab/sets/[setId]', owner: 'app/(authed-admin)/(vocab)/admin/vocab/sets/[setId]/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/vocab/sets', requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab/stats', owner: 'app/(authed-admin)/(vocab)/admin/vocab/stats/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/vocab/topics', owner: 'app/(authed-admin)/(vocab)/admin/vocab/topics/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/writing', owner: 'app/(authed-admin)/(writing)/admin/writing/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/writing/assignments', owner: 'app/(authed-admin-writing-assignments)/admin/writing/assignments/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/writing/cohorts', owner: 'app/(authed-admin-writing-cohorts)/admin/writing/cohorts/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/writing/grade', owner: 'app/(authed-admin-writing-grade)/admin/writing/grade/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/writing/queue', requires: ['id|essay_id'], parentOnMissing: '/admin/writing/queue', ui: 'v1', note: 'G02-T12: về hàng chờ đã mở trang (writingNavigationHref): queue hoặc instructor-queue, giữ bộ lọc' },
  { route: '/admin/writing/instructor-queue', owner: 'app/(authed-admin-writing-instructor-queue)/admin/writing/instructor-queue/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/writing/new', owner: 'app/(authed-admin)/(writing-new)/admin/writing/new/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/writing/prompts', owner: 'app/(authed-admin-writing-prompts)/admin/writing/prompts/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/writing/queue', owner: 'app/(authed-admin-writing-queue)/admin/writing/queue/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/writing/regrade-requests', owner: 'app/(authed-admin-writing-regrade)/admin/writing/regrade-requests/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
  { route: '/admin/writing/status', owner: 'app/(authed-admin-writing-status)/admin/writing/status/page.tsx', status: 'live', audience: 'admin', kind: 'child', section: 'admin:content', parent: '/admin/writing/queue', requires: ['essay_id|id'], parentOnMissing: '/admin/writing/queue', ui: 'v1', note: 'G02-T12: về hàng chờ đã mở trang (writingStatusHref); mặc định /admin/writing/queue?status=grading' },
  { route: '/admin/writing/tips', owner: 'app/(authed-admin-writing-tips)/admin/writing/tips/page.tsx', status: 'live', audience: 'admin', kind: 'nav', section: 'admin:content', parent: null, requires: [], parentOnMissing: null, ui: 'v1' },
].map((entry) => Object.freeze({ ...entry, requires: Object.freeze([...entry.requires]) })));

const segmentPattern = (segment) => {
  if (/^\[\[\.\.\..+\]\]$/.test(segment)) return '(?:/.*)?';
  if (/^\[\.\.\..+\]$/.test(segment)) return '/.+';
  if (/^\[.+\]$/.test(segment)) return '/[^/]+';
  return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
};

const MATCHERS = ROUTES.map((entry) => {
  const segments = entry.route === '/' ? [] : entry.route.slice(1).split('/');
  const dynamic = segments.filter((s) => s.startsWith('[')).length;
  return {
    entry,
    dynamic,
    length: segments.length,
    regex: new RegExp(`^${segments.map(segmentPattern).join('') || ''}/?$`),
  };
}).sort((a, b) => a.dynamic - b.dynamic || b.length - a.length);

function normalize(pathname) {
  const raw = String(pathname ?? '').split(/[?#]/, 1)[0];
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * The entry for a concrete pathname, matching dynamic segments. Static
 * entries win over dynamic ones (`/grammar/compare` beats `/grammar/[x]`).
 * @param {string} pathname @returns {RouteEntry | null}
 */
export function routeFor(pathname) {
  const path = normalize(pathname);
  for (const m of MATCHERS) if (m.regex.test(path)) return m.entry;
  return null;
}

/** The navigation section of a pathname, or null when unknown. */
export function sectionFor(pathname) {
  return routeFor(pathname)?.section ?? null;
}

/** True when the pathname is served by the new "Bản in" UI tree. */
export function isV2Route(pathname) {
  return routeFor(pathname)?.ui === 'v2';
}
