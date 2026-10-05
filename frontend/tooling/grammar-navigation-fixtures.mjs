// Supplemental synthetic IDs for the Grammar context journey. Keep the
// existing present-simple and Vocabulary gate fixtures under their old owner.
export const noun = { category: 'parts-of-speech', slug: 'ux-nouns', title: 'Fixture Nouns', status: 'complete', level: 'beginner' };
export const verb = { ...noun, slug: 'ux-verbs', title: 'Fixture Verbs' };
export const related = { ...noun, slug: 'ux-adjectives', title: 'Fixture Adjectives' };
export const grammarNavigationHome = {
  total_articles: 4,
  featured_articles: [noun, { category: 'tenses', slug: 'present-simple', title: 'Present Simple', status: 'complete', level: 'A2' }],
  categories: [],
};

export function grammarNavigationArticle(category, slug) {
  if (category !== noun.category || ![noun.slug, verb.slug, related.slug].includes(slug)) return null;
  return {
    ...(slug === verb.slug ? verb : slug === related.slug ? related : noun),
    html: '<h2 id="overview">Overview</h2><p>A synthetic grammar reading passage.</p>',
    toc: [{ id: 'overview', name: 'Overview', depth: 0 }], reading_time: 1, word_count: 30,
    related_pages: [related], next_articles: [verb], compare_with: [],
    prev_article: slug === verb.slug ? noun : null, next_article: slug === noun.slug ? verb : null,
    anchors: [], learning_blocks: [], prerequisites: [], common_error_tags: [], pathways: [],
    tags: ['parts-of-speech'], band_relevance: [], summary: 'Synthetic navigation fixture.',
  };
}
