// Gate F route-replacement inventory.
//
// This is deliberately narrower than the final deletion checklist: it proves
// that every directly renderable Legacy HTML path has a canonical App Router
// destination before redirects or file deletion can be reviewed. Observation,
// replacement-test disposition, asset reachability and redirect installation
// remain separate Gate F evidence.

const EXACT_REPLACEMENTS = Object.freeze({
  '/practice.legacy.html': '/practice/session',
  '/vocabulary.html': '/vocabulary',
  '/pages/vocabulary.html': '/vocabulary/hub',
  '/pages/vocab-article.html': '/vocabulary',
  '/pages/grammar-article.html': '/grammar/[category]/[slug]',
  '/pages/reading-skill-exercise.html': '/reading/skill/[slug]',
  '/pages/reading-vocab-passage.html': '/reading/vocab/[slug]',
  '/pages/reading-exam.html': '/reading/exam/session',
  '/pages/listening-test.html': '/listening/test/session',
  '/pages/listening-test-dictation.html': '/listening/dictation/session',
  '/pages/practice.html': '/practice/session',
  '/pages/quiz-progress.html': '/quiz/progress',
  '/pages/mock-result.html': '/mock/result',
  '/pages/speaking-result.html': '/speaking/result',
  '/pages/vocab-exam.html': '/vocabulary/exam',
  '/pages/vocab-practice.html': '/vocabulary/practice',
  '/pages/writing-dashboard.html': '/writing/dashboard',
  '/pages/writing-result.html': '/writing/result',
  '/pages/admin/listening/content-detail.html': '/admin/listening/content/[contentId]',
  '/pages/admin/listening/content-meta.html': '/admin/listening/content/[contentId]/edit',
  '/pages/admin/listening/dictation-reports.html': '/admin/listening/dictation',
  '/pages/admin/listening/tests-detail.html': '/admin/listening/tests/[testId]',
});

const NESTED_LEGACY_FAMILY = /^\/pages\/(grammar|listening|reading)-(.+)\.html$/;

export function canonicalNextRouteForLegacy(legacyPath) {
  const normalized = String(legacyPath || '').trim();
  if (!normalized.startsWith('/') || !normalized.endsWith('.html')) return null;
  if (EXACT_REPLACEMENTS[normalized]) return EXACT_REPLACEMENTS[normalized];

  const nested = normalized.match(NESTED_LEGACY_FAMILY);
  if (nested) return `/${nested[1]}/${nested[2]}`;

  const withoutPublicPrefix = normalized.startsWith('/pages/')
    ? normalized.slice('/pages'.length)
    : normalized;
  return withoutPublicPrefix
    .replace(/\/index\.html$/, '')
    .replace(/\.html$/, '') || '/';
}

export function replacementOwner(nextPath) {
  const route = String(nextPath || '');
  if (route === '/admin' || route.startsWith('/admin/')) return 'admin-ui';
  if (route === '/grammar' || route.startsWith('/grammar/')) return 'grammar-wiki';
  if (route === '/listening' || route.startsWith('/listening/')) return 'listening';
  if (route === '/reading' || route.startsWith('/reading/')) return 'reading';
  if (route === '/writing' || route.startsWith('/writing/')
      || route === '/instructor' || route.startsWith('/instructor/')) return 'writing';
  if (route === '/mock-exam' || route.startsWith('/mock/')
      || route === '/full-test' || route.startsWith('/full-test')) return 'mock-exam';
  if (route === '/vocabulary' || route.startsWith('/vocabulary/')
      || route === '/flashcards' || route === '/flashcard-study'
      || route === '/exercises' || route === '/d1-exercise'
      || route === '/quiz' || route.startsWith('/quiz/')) return 'vocabulary';
  if (route === '/exam') return 'exam-platform';
  if (route === '/course-exercises') return 'course-exercises';
  if (route === '/speaking' || route.startsWith('/speaking/')
      || route === '/practice/session' || route === '/result') return 'speaking';
  return 'learner-platform';
}

export function buildLegacyReplacementInventory(legacyPaths, appRoutes) {
  const routeSet = new Set(appRoutes || []);
  const entries = [...(legacyPaths || [])].sort().map((legacyPath) => {
    const nextPath = canonicalNextRouteForLegacy(legacyPath);
    const nextRoutePresent = Boolean(nextPath && routeSet.has(nextPath));
    return {
      legacyPath,
      nextPath,
      owner: replacementOwner(nextPath),
      nextRoutePresent,
      redirectState: 'not-installed-gate-f-blocked',
      deletionState: nextRoutePresent
        ? 'blocked-observation-and-deletion-review'
        : 'blocked-missing-next-route',
    };
  });
  const missing = entries.filter((entry) => !entry.nextRoutePresent);
  return {
    total: entries.length,
    nextRoutePresent: entries.length - missing.length,
    missingNextRoutes: missing.map(({ legacyPath, nextPath, owner }) => ({
      legacyPath,
      nextPath,
      owner,
    })),
    entries,
  };
}
