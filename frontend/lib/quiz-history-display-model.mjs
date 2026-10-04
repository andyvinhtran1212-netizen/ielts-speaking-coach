// Display only: these names never select a bank, infer its age/current mapping,
// or replace the title/questions/results stored with a learner's history.
const GRAMMAR_TITLES = Object.freeze({
  'G-parts-of-speech-verbs': 'Quick Check — Verbs',
  'G-sentence-structures-passive-voice': 'Quick Check — Passive Voice',
  'G-tenses-past-continuous': 'Quick Check — Past Continuous',
  'G-tenses-present-continuous': 'Quick Check — Present Continuous',
  'G-tenses-present-perfect-continuous': 'Quick Check — Present Perfect Continuous',
  'G-tenses-present-simple': 'Quick Check — Present Simple',
  'G-grammar-for-reading-participle-clauses': 'Quick Check — Participle Clauses',
  'G-grammar-for-reading-long-sentence-untangling': 'Quick Check — Long Sentence Untangling',
  'G-grammar-for-reading-reduced-relative-clauses': 'Quick Check — Reduced Relative Clauses',
  'G-tenses-past-perfect': 'Quick Check — Past Perfect',
  'G-foundations-phrase-vs-clause': 'Quick Check — Phrase vs. Clause',
  'G-error-clinic-dangling-modifiers': 'Quick Check — Dangling Modifiers',
});

/** @param {string | null | undefined} code @param {string | null | undefined} [title] @param {string | null | undefined} [skillArea] */
export function quizHistoryBankDisplay(code, title, skillArea) {
  const canonical = typeof code === 'string' ? code.replace(/~[a-f0-9]{16}$/, '') : '';
  if ((skillArea == null || skillArea === 'grammar') && Object.hasOwn(GRAMMAR_TITLES, canonical)) {
    return {
      label: typeof title === 'string' && title.trim() ? title : GRAMMAR_TITLES[canonical],
      subtitle: '',
    };
  }
  // Keep unmanaged/Vocabulary code + title presentation unchanged.
  return { label: code || '', subtitle: title || '' };
}
