function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function requiredText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value) {
  return typeof value === 'string' ? value.trim() : undefined;
}

/**
 * Preserve the canonical API order, but fail closed when the public roadmap
 * contract is malformed. Invalid data must not masquerade as a real empty
 * category because that would hide a publishing/backend regression.
 */
export function normalizePublicRoadmap(value) {
  const raw = objectOf(value);
  const title = requiredText(raw?.title);
  if (!raw || !title || !Array.isArray(raw.articles)) {
    throw new Error('invalid-public-roadmap');
  }

  const articles = raw.articles.map((value, index) => {
    const article = objectOf(value);
    const slug = requiredText(article?.slug);
    const articleTitle = requiredText(article?.title);
    const category = requiredText(article?.category);
    if (!article || !slug || !articleTitle || !category) {
      throw new Error(`invalid-public-roadmap-article:${index}`);
    }

    const normalized = { slug, title: articleTitle, category };
    const level = optionalText(article.level);
    const status = optionalText(article.status);
    const summary = optionalText(article.summary);
    if (level) normalized.level = level;
    if (status) normalized.status = status;
    if (summary) normalized.summary = summary;
    if (Number.isFinite(article.reading_time) && article.reading_time > 0) {
      normalized.reading_time = article.reading_time;
    }
    return normalized;
  });

  return { title, articles };
}
