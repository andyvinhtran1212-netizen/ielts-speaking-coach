// @ts-check
// EXAMROOM-0066 FR-010, FR-013, FR-014: blank questions, the submit dialog's
// copy, why the manual submit button is locked, and the save status line. The
// time-up auto-submit never goes through `submitButtonState` (FR-014, FR-019).

export const SUBMIT_LIST_MAX = 5;

/**
 * Unanswered question numbers in order.
 * @param {{ q: number, answered: boolean }[]} questions
 * @returns {number[]}
 */
export function unansweredQuestions(questions) {
  return questions.filter((q) => !q.answered).map((q) => q.q).sort((a, b) => a - b);
}

/**
 * "Q7, Q12 and 3 more" / "Câu 7, 12 và 3 câu khác": at most five numbers.
 * @param {number[]} numbers
 * @param {any} strings
 * @param {number} [max]
 */
export function formatQuestionList(numbers, strings, max = SUBMIT_LIST_MAX) {
  const shown = numbers.slice(0, max).map(String);
  return strings.questionList(shown, Math.max(0, numbers.length - shown.length));
}

/**
 * The submit dialog (FR-010): a warning dialog while questions are blank, a
 * plain one otherwise. Focus starts on the safe button.
 * @param {{ questions: { q: number, answered: boolean }[], strings: any, costNote?: string | null }} input
 */
export function submitDialogModel({ questions, strings, costNote = null }) {
  const blank = unansweredQuestions(questions);
  const base = {
    confirm: strings.submit,
    cancel: strings.returnToTest,
    initialFocus: /** @type {'cancel'} */ ('cancel'),
    costNote: costNote || null,
    unanswered: blank.length,
  };
  if (!blank.length) {
    return { ...base, kind: /** @type {'plain' | 'warning'} */ ('plain'), badge: null, title: strings.submitTitle, body: strings.submitBody };
  }
  const list = formatQuestionList(blank, strings);
  return {
    ...base,
    kind: /** @type {'plain' | 'warning'} */ ('warning'),
    badge: strings.warning,
    title: strings.submitBlankTitle(blank.length),
    body: strings.submitBlankBody(list, blank.length),
  };
}

/**
 * The manual submit button. Offline wins (the label itself changes, FR-014),
 * then a submit in flight, then a read-only tab, then unsaved answers.
 * @param {{ online: boolean, submitting?: boolean, unsaved?: number, readOnly?: boolean, strings: any, disabledReason?: string | null }} input
 *   `disabledReason` is a surface-specific reason passed through as is.
 * @returns {{ label: string, disabled: boolean, reason: string | null, why: 'offline' | 'submitting' | 'read_only' | 'saving' | 'surface' | null }}
 */
export function submitButtonState({ online, submitting = false, unsaved = 0, readOnly = false, strings, disabledReason = null }) {
  if (!online) return { label: strings.waitingConnection, disabled: true, reason: strings.waitingConnection, why: 'offline' };
  if (submitting) return { label: strings.submit, disabled: true, reason: strings.submitBusySubmitting, why: 'submitting' };
  if (readOnly) return { label: strings.submit, disabled: true, reason: strings.submitReadOnly, why: 'read_only' };
  if (unsaved > 0) return { label: strings.submit, disabled: true, reason: strings.submitBusySaving, why: 'saving' };
  if (disabledReason) return { label: strings.submit, disabled: true, reason: disabledReason, why: 'surface' };
  return { label: strings.submit, disabled: false, reason: null, why: null };
}

/**
 * "10:42": hours and minutes of the learner's clock (FR-013).
 * @param {Date | number | null | undefined} at
 * @returns {string | null}
 */
export function clockTime(at) {
  if (at == null) return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Save status text (FR-013) from the shell's ExamRoomSaveStatus.
 * @param {{ state: 'idle' | 'saving' | 'saved' | 'retrying' | 'failed', lastSavedAt?: Date | number }} status
 * @param {any} strings
 * @returns {{ text: string | null, retry: string | null, tone: 'quiet' | 'busy' | 'warning' }}
 */
export function saveStatusText(status, strings) {
  const t = clockTime(status.lastSavedAt);
  switch (status.state) {
    case 'saving': return { text: strings.saving, retry: null, tone: 'busy' };
    case 'saved': return { text: t ? strings.savedAt(t) : null, retry: null, tone: 'quiet' };
    case 'retrying': return { text: strings.notSaved, retry: null, tone: 'warning' };
    case 'failed': return { text: strings.notSaved, retry: strings.retry, tone: 'warning' };
    default: return { text: t ? strings.savedAt(t) : null, retry: null, tone: 'quiet' };
  }
}

/**
 * Time-up screen copy from the surface's `submit.outcome` (FR-034). The shell
 * never infers `confirmed` itself. `clearCopy` is true when the attempt can no
 * longer be sent (closed by the server, or refused after the grace period:
 * amendment 1 (a)), so the on-device copy is deleted (FR-035). Neither offers
 * a retry, and neither ever says "submitted".
 * @param {{ outcome: 'idle' | 'submitting' | 'confirmed' | 'unconfirmed' | 'unconfirmed_manual' | 'closed_unconfirmed' | 'expired_unsubmitted', savedUpTo?: string | null, closedAt?: string | null, strings: any }} input
 */
export function submitOutcomeModel({ outcome, savedUpTo = null, closedAt = null, strings }) {
  switch (outcome) {
    case 'submitting': return { text: strings.submitting, action: null, inputsLocked: true, clearCopy: false };
    case 'confirmed': return { text: strings.confirmed, action: null, inputsLocked: true, clearCopy: false };
    case 'unconfirmed': return { text: strings.unconfirmed, action: null, inputsLocked: true, clearCopy: false };
    case 'unconfirmed_manual': return { text: strings.unconfirmedManual(savedUpTo), action: /** @type {const} */ ('retry'), inputsLocked: true, clearCopy: false };
    case 'closed_unconfirmed':
      return { text: strings.closedUnconfirmed(closedAt ?? savedUpTo ?? '', savedUpTo ?? closedAt ?? ''), action: /** @type {const} */ ('exit'), inputsLocked: true, clearCopy: true };
    case 'expired_unsubmitted':
      return { text: strings.expiredUnsubmitted(savedUpTo ?? null), action: /** @type {const} */ ('exit'), inputsLocked: true, clearCopy: true };
    default: return { text: null, action: null, inputsLocked: false, clearCopy: false };
  }
}
