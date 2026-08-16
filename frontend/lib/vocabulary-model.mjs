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
      const article = objectOf(rawArticle);
      const articleSlug = textOf(article?.slug);
      const articleCategory = textOf(article?.category);
      const headword = textOf(article?.headword);
      if (!article || !articleSlug || articleCategory !== slug || !headword) {
        throw new Error(`invalid-vocabulary-summary:${categoryIndex}:${articleIndex}`);
      }
      const key = vocabularyKey(articleCategory, articleSlug);
      if (seen.has(key)) throw new Error(`duplicate-vocabulary-summary:${key}`);
      seen.add(key);
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
    });
    const count = category.article_count;
    if (count != null && (!Number.isInteger(count) || count !== articles.length)) {
      throw new Error(`invalid-vocabulary-category-count:${categoryIndex}`);
    }
    return { slug, title, articleCount: articles.length, articles };
  });
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
