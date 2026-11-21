// Sections of the component library page `/ui-library` (UIBASE-0056 FR-013/014).
// One entry per section; the page renders `<section id={id}>` for each and the
// visual test (tests/visual/ui-library.spec.mjs) screenshots each one at 1280px
// and 390px. Component PRs (G03-T05…T18) append their entries here.
export const UI_LIBRARY_SECTIONS = Object.freeze([
  Object.freeze({ id: 'tokens-colour', title: 'Màu' }),
  Object.freeze({ id: 'tokens-type', title: 'Cỡ chữ và độ đậm' }),
  Object.freeze({ id: 'tokens-vietnamese', title: 'Dấu tiếng Việt và IPA' }),
  Object.freeze({ id: 'tokens-space', title: 'Khoảng cách, bo góc, đường kẻ, focus' }),
]);
