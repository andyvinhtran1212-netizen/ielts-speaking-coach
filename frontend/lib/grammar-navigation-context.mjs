// Fixed Grammar destinations only. Query state never grants redirect authority.
const field = (raw, name) => typeof raw?.getAll === 'function'
  ? (raw.getAll(name).length === 1 ? raw.get(name) : undefined) : raw?.[name];

export function grammarMode(raw = {}) {
  return field(raw, 'mode') === 'learning' ? 'learning' : 'reference';
}

export function grammarSource(raw = {}) {
  return field(raw, 'from') === 'learning' ? 'learning' : '';
}

export function grammarModeHref(raw = {}) {
  return grammarMode(raw) === 'learning' ? '/grammar?mode=learning' : '/grammar';
}

export function grammarArticleHref(category, slug, source = '') {
  return `/grammar/${encodeURIComponent(category)}/${encodeURIComponent(slug)}${source === 'learning' ? '?from=learning' : ''}`;
}

export function grammarReturnHref(raw = {}) {
  return grammarSource(raw) === 'learning' ? '/grammar?mode=learning' : null;
}
