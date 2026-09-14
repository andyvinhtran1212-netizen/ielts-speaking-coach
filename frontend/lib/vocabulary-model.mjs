function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value) {
  return typeof value === 'string' ? value : '';
}

function textList(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('invalid-vocabulary-payload');
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

export function vocabularyKey(category, slug) {
  return `${category}\u0000${slug}`;
}

function normalizeVocabularySummary(rawArticle, expectedCategory, label) {
  const article = objectOf(rawArticle);
  const articleSlug = textOf(article?.slug);
  const articleCategory = textOf(article?.category);
  const headword = textOf(article?.headword);
  if (!article || !articleSlug || !articleCategory || !headword
    || (expectedCategory && articleCategory !== expectedCategory)) {
    throw new Error(`invalid-vocabulary-summary:${label}`);
  }
  return {
    slug: articleSlug,
    category: articleCategory,
    headword,
    level: optionalText(article.level),
    partOfSpeech: optionalText(article.part_of_speech),
    pronunciation: optionalText(article.pronunciation),
    glossVi: optionalText(article.gloss_vi),
    audioHeadword: optionalText(article.audio_headword),
  };
}

export function resolveVocabularySelection(words, requestedCategory, requestedSlug) {
  if (!Array.isArray(words)) throw new Error('invalid-vocabulary-selection');
  if (requestedSlug) {
    const matches = words.filter((word) => word?.slug === requestedSlug
      && (!requestedCategory || word?.category === requestedCategory));
    // A slug-only legacy link is safe only when it identifies exactly one
    // article. Canonical links always provide the compound identity.
    return matches.length === 1 ? matches[0] : null;
  }
  return words.find((word) => !requestedCategory || word?.category === requestedCategory) || null;
}

export function normalizeVocabularyCategories(value) {
  if (!Array.isArray(value)) throw new Error('invalid-vocabulary-categories');
  const seen = new Set();
  return value.map((rawCategory, categoryIndex) => {
    const category = objectOf(rawCategory);
    const slug = textOf(category?.slug);
    const title = textOf(category?.title);
    if (!category || !slug || !title || !Array.isArray(category.articles)) {
      throw new Error(`invalid-vocabulary-category:${categoryIndex}`);
    }
    const articles = category.articles.map((rawArticle, articleIndex) => {
      const summary = normalizeVocabularySummary(rawArticle, slug, `${categoryIndex}:${articleIndex}`);
      const key = vocabularyKey(summary.category, summary.slug);
      if (seen.has(key)) throw new Error(`duplicate-vocabulary-summary:${key}`);
      seen.add(key);
      return summary;
    });
    const count = category.article_count;
    if (count != null && (!Number.isInteger(count) || count !== articles.length)) {
      throw new Error(`invalid-vocabulary-category-count:${categoryIndex}`);
    }
    return { slug, title, articleCount: articles.length, articles };
  });
}

export function normalizeVocabularyDirectory(value) {
  const raw = objectOf(value);
  if (!raw || !Array.isArray(raw.categories) || !Array.isArray(raw.items)) {
    throw new Error('invalid-vocabulary-directory');
  }
  const categories = raw.categories.map((rawCategory, index) => {
    const category = objectOf(rawCategory);
    const slug = textOf(category?.slug);
    const title = textOf(category?.title);
    const articleCount = category?.article_count;
    if (!category || !slug || !title || !Number.isInteger(articleCount) || articleCount < 0) {
      throw new Error(`invalid-vocabulary-directory-category:${index}`);
    }
    return { slug, title, articleCount };
  });
  const categorySlugs = new Set();
  for (const category of categories) {
    if (categorySlugs.has(category.slug)) {
      throw new Error(`duplicate-vocabulary-directory-category:${category.slug}`);
    }
    categorySlugs.add(category.slug);
  }
  const items = raw.items.map((item, index) => normalizeVocabularySummary(item, '', `directory:${index}`));
  const total = raw.total;
  const offset = raw.offset;
  const limit = raw.limit;
  if (![total, offset, limit].every(Number.isInteger)
    || total < 0 || offset < 0 || limit < 1 || items.length > limit
    || (offset < total && offset + items.length > total)
    || (offset >= total && items.length > 0)) {
    throw new Error('invalid-vocabulary-directory-page');
  }
  const keys = new Set();
  for (const item of items) {
    if (!categorySlugs.has(item.category)) throw new Error('invalid-vocabulary-directory-owner');
    const key = vocabularyKey(item.category, item.slug);
    if (keys.has(key)) throw new Error(`duplicate-vocabulary-directory-item:${key}`);
    keys.add(key);
  }
  return { categories, items, total, offset, limit };
}

export function normalizeVocabularyArticle(value, expectedCategory, expectedSlug) {
  const raw = objectOf(value);
  const slug = textOf(raw?.slug);
  const category = textOf(raw?.category);
  const headword = textOf(raw?.headword);
  if (!raw || !slug || !category || !headword || category !== expectedCategory || slug !== expectedSlug) {
    throw new Error('invalid-vocabulary-article');
  }
  const relatedWords = raw.related_words == null ? [] : raw.related_words;
  if (!Array.isArray(relatedWords)) throw new Error('invalid-vocabulary-article');
  return {
    slug,
    category,
    headword,
    level: optionalText(raw.level),
    partOfSpeech: optionalText(raw.part_of_speech),
    pronunciation: optionalText(raw.pronunciation),
    syllables: optionalText(raw.syllables),
    audioHeadword: optionalText(raw.audio_headword),
    audioExample: optionalText(raw.audio_example),
    definitionEn: optionalText(raw.definition_en),
    definitionVi: optionalText(raw.definition_vi),
    glossVi: optionalText(raw.gloss_vi),
    example: optionalText(raw.example),
    collocations: textList(raw.collocations),
    synonyms: textList(raw.synonyms),
    antonyms: textList(raw.antonyms),
    relatedWords: relatedWords.map((item, index) => {
      if (typeof item === 'string' && item.trim()) return item.trim();
      const related = objectOf(item);
      const relatedHeadword = textOf(related?.headword);
      if (!related || !relatedHeadword) throw new Error(`invalid-vocabulary-related:${index}`);
      return relatedHeadword;
    }),
    wordFamily: textList(raw.word_family),
    commonError: optionalText(raw.common_error),
    memoryHook: optionalText(raw.memory_hook),
    register: optionalText(raw.register),
    source: optionalText(raw.source),
    html: optionalText(raw.html),
  };
}
