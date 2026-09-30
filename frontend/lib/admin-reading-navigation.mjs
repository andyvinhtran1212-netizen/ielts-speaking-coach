const field = (raw, name) => typeof raw?.getAll === 'function'
  ? (raw.getAll(name).length === 1 ? raw.get(name) : undefined) : raw?.[name];

export function adminReadingContext(raw = {}) {
  const library = field(raw, 'library');
  const requestedPage = String(field(raw, 'page') ?? '1');
  return {
    library: ['l1_vocab', 'l2_skill', 'l3_test'].includes(library) ? library : '',
    page: /^[1-9]\d{0,4}$/.test(requestedPage) ? Number(requestedPage) : 1,
  };
}

export function adminReadingSearch(raw = {}) {
  const context = adminReadingContext(raw);
  const query = new URLSearchParams();
  if (context.library) query.set('library', context.library);
  if (context.page > 1) query.set('page', String(context.page));
  return query.toString();
}

export function adminReadingLibraryHref(raw = {}) {
  const query = adminReadingSearch(raw);
  return `/admin/reading/content${query ? `?${query}` : ''}`;
}

export function adminReadingPreviewReturnHref(raw = {}) {
  return field(raw, 'from') === 'reading-content' ? adminReadingLibraryHref(raw) : '/admin/reading/content';
}
