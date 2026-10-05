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

export function listeningProgrammePath(programmeId) {
  return programmeId === 'general-listening-practice' ? 'general'
    : programmeId === 'ielts-listening-practice' ? 'ielts' : null;
}

function programmeContextQuery(programmeId, raw) {
  const path = listeningProgrammePath(programmeId);
  if (!path || field(raw, 'from') !== path) return '';
  const query = new URLSearchParams({ from: path });
  const filter = listeningLibraryFilter(raw);
  if (filter !== 'all') query.set('filter', filter);
  return `?${query}`;
}

export function listeningProgrammeFormHref(programmeId, formId, raw = {}) {
  return `/listening/programmes/form/${encodeURIComponent(formId)}${programmeContextQuery(programmeId, raw)}`;
}

export function listeningProgrammeResultHref(programmeId, attemptId, raw = {}) {
  return `/listening/programmes/result/${encodeURIComponent(attemptId)}${programmeContextQuery(programmeId, raw)}`;
}

export function listeningProgrammeLessonHref(programmeId, lessonId, raw = {}) {
  const path = listeningProgrammePath(programmeId);
  return path && lessonId
    ? `/listening/${path}/${encodeURIComponent(lessonId)}${programmeContextQuery(programmeId, raw)}` : '/listening';
}

export function listeningProgrammeReturnHref(programmeId, raw = {}) {
  const path = listeningProgrammePath(programmeId);
  return path ? listeningLessonReturnHref(path, raw) : '/listening';
}
