// GOI-11 §5.6 (G11-T29 API) — one source for the course action labels, used by
// /courses, /courses/[slug], the account and course hub, the Grammar Wiki
// "Trong khoá" block and notifications. Created by G05-T02 (PUBLICSITE-0059)
// because G11-T29 has not landed; G11-T29 reuses this file, not a second one.

export const COURSE_ACCESS_ACTIONS = Object.freeze({
  enroll: 'Đăng ký khoá này',
  renew: 'Đăng ký lại',
  continue: 'Vào học',
});

/**
 * @param {unknown} viewerState  `viewer.state` from GET /api/courses*
 * @returns {string | null} null for states that have no single action
 *   (`open_order` continues the payment; the caller draws that button)
 */
export function accessActionLabel(viewerState) {
  switch (viewerState) {
    case 'guest':
    case 'can_enroll':
      return COURSE_ACCESS_ACTIONS.enroll;
    case 'expired':
      return COURSE_ACCESS_ACTIONS.renew;
    case 'enrolled':
      return COURSE_ACCESS_ACTIONS.continue;
    default:
      return null;
  }
}
