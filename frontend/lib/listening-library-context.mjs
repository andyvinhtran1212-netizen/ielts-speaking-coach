const field = (raw, name) => typeof raw?.getAll === 'function'
  ? (raw.getAll(name).length === 1 ? raw.get(name) : undefined) : raw?.[name];

export function listeningLibraryFilter(raw = {}) {
  const filter = field(raw, 'filter');
  return ['new', 'in_progress', 'completed'].includes(filter) ? filter : 'all';
}

export function listeningLibraryHref(programmePath, raw = {}) {
  const path = programmePath === 'general' ? 'general' : 'ielts';
  const filter = listeningLibraryFilter(raw);
  return `/listening/${path}${filter === 'all' ? '' : `?filter=${filter}`}`;
}

export function listeningLessonHref(programmePath, lessonId, raw = {}) {
  const path = programmePath === 'general' ? 'general' : 'ielts';
  const query = new URLSearchParams({ from: path });
  const filter = listeningLibraryFilter(raw);
  if (filter !== 'all') query.set('filter', filter);
  return `/listening/${path}/${encodeURIComponent(lessonId)}?${query}`;
}

export function listeningLessonReturnHref(programmePath, raw = {}) {
  const path = programmePath === 'general' ? 'general' : 'ielts';
  return listeningLibraryHref(path, field(raw, 'from') === path ? raw : {});
}
