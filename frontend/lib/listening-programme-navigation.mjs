const IELTS_PROGRAMME_ID = 'ielts-listening-practice';

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
