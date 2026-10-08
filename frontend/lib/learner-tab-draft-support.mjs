// Qualified native lifecycle: desktop Chrome 152 and 154 on macOS. Native
// Duplicate→Back-before-guard and same-tab new-document Back were observed on
// 2026-10-02 (152) and 2026-10-06 (154). Other engines/versions keep editable
// input and an unsaved notice;
// API availability alone never admits cloned private session storage.
export function isLearnerTabPersistenceSupported(browser) {
  const ua = browser?.navigator?.userAgent;
  return typeof ua === 'string'
    && /Macintosh; Intel Mac OS X/.test(ua)
    && /\bChrome\/(?:152|154)\.0\.0\.0\b/.test(ua)
    && !/\b(?:Edg|OPR|Firefox|CriOS|HeadlessChrome)\//.test(ua);
}
