const IELTS_PROGRAMME_ID = 'ielts-listening-practice';

/** @param {string} programmeId */
export function programmeLibraryPath(programmeId) {
  if (programmeId === 'general-listening-practice') return '/listening/general';
  if (programmeId === IELTS_PROGRAMME_ID) return '/listening/ielts';
  if (programmeId === 'ielts-80-days-listening') return '/listening/ielts/80-days';
  return '/listening';
}

/** @param {string} programmeId @param {string} lessonId @param {number | null | undefined} sourceDay */
export function programmeLessonPath(programmeId, lessonId, sourceDay) {
  const library = programmeLibraryPath(programmeId);
  if (programmeId === 'ielts-80-days-listening') {
    return typeof sourceDay === 'number' && Number.isInteger(sourceDay) && sourceDay >= 1 && sourceDay <= 80 ? `${library}/${sourceDay}` : library;
  }
  return library === '/listening' || !lessonId ? library : `${library}/${encodeURIComponent(lessonId)}`;
}

/**
 * The IELTS hub owns both imported report-only forms and the pre-existing
 * Quick, Skills, Mini and Full Test shelves. Its navigation must therefore
 * remain visible even while the imported IELTS package is unpublished.
 *
 * @param {Array<{id?: string}>} programmes
 */
export function needsPermanentIeltsNavigation(programmes) {
  return !programmes.some((programme) => programme?.id === IELTS_PROGRAMME_ID);
}
