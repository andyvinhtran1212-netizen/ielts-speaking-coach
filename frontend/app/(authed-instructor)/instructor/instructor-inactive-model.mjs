// ADMINAAL2-0032 FR-014 (T011): an instructor API call that answers the
// activation gate's 403 after the page has loaded (the account was suspended
// mid-session) replaces the instructor page with a denied state. The backend
// detail is services/activation_gate.py INACTIVE_DETAIL, matched exactly.

export const INSTRUCTOR_INACTIVE_DETAIL = 'Tài khoản chưa được kích hoạt';
export const INSTRUCTOR_INACTIVE_TITLE = 'Tài khoản chưa được kích hoạt — liên hệ admin';

/** True only for the inactive-account 403, not for ownership or role 403s. */
export function isInstructorInactiveError(caught) {
  return Boolean(caught && typeof caught === 'object'
    && caught.status === 403 && caught.detail === INSTRUCTOR_INACTIVE_DETAIL);
}

/**
 * Text the instructor typed and has not saved, read from the page before the
 * denied state replaces it, so it is not lost. Only free-text fields that
 * differ from their initial value count.
 * @param {ParentNode | null | undefined} root
 * @returns {{ label: string, value: string }[]}
 */
export function collectUnsavedDrafts(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const fields = root.querySelectorAll('textarea, input:not([type]), input[type="text"]');
  const drafts = [];
  for (const field of fields) {
    const value = typeof field.value === 'string' ? field.value : '';
    if (!value.trim() || value === field.defaultValue || field.readOnly) continue;
    const label = field.closest?.('label')?.querySelector?.('span')?.textContent?.trim()
      || field.getAttribute?.('aria-label')
      || field.getAttribute?.('name')
      || 'Nội dung';
    drafts.push({ label, value });
  }
  return drafts;
}
