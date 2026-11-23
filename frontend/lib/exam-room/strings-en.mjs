// @ts-check
// EXAMROOM-0066 FR-002: every string of the exam room in `test` mode, English
// only, including errors, aria labels and screen-reader text. Keys match
// strings-vi.mjs (GOI-08 §5.3). The leave dialog copy is FocusShell's
// FOCUS_WORDS.exam.leave (FR-011) and is not repeated here. No string carries an
// HTTP code, a parameter name or an attempt id.

/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => (n === 1 ? one : many);

export const EXAM_ROOM_STRINGS_EN = Object.freeze({
  lang: 'en',

  // Abandon (FR-012, self-chosen tests only)
  abandon: 'Abandon test',
  abandonTitle: 'Abandon this test?',
  abandonBody: 'Your answers will not be marked and this attempt will not appear in your results.',
  abandonKeep: 'Keep working',

  // Time-up choice (FR-020, Writing and Speaking self-chosen)
  timeUpChoiceTitle: 'Time is up',
  timeUpSend: 'Send for marking',
  timeUpDiscard: 'Discard this attempt',

  // Mock self-paced
  sectionDone: 'Section submitted',
  /** @param {string} section */
  nextUp: (section) => `Next: ${section}`,
  selfPacedNotice: 'Once you start, the sections run back to back. You cannot pause between sections.',

  // Timer (FR-018)
  timeRemaining: 'Time remaining',
  fiveLeft: '5 minutes left',
  timeUp: 'Time is up',

  // Save status (FR-013)
  saving: 'Saving…',
  /** @param {string} t */
  savedAt: (t) => `Saved at ${t}`,
  notSaved: 'Not saved. Retrying…',
  retry: 'Retry',

  // Navigator (FR-006, FR-007)
  /** @param {number} n @param {number} total */
  answered: (n, total) => `Answered ${n} of ${total}`,
  flag: 'Flag for review',
  flagged: 'flagged',
  /** @param {number} n */
  qShort: (n) => `Q${n}`,
  /** @param {{ n: number, answered: boolean, flagged: boolean, current: boolean }} q */
  qLabel: ({ n, answered, flagged, current }) =>
    `Question ${n}, ${answered ? 'answered' : 'not answered'}${flagged ? ', flagged for review' : ''}${current ? ', current question' : ''}`,
  sectionKind: Object.freeze({ passage: 'Passage', part: 'Part', task: 'Task' }),
  /** @param {{ kind: string, index: number, answered: number, total: number }} s */
  sectionChip: ({ kind, index, answered, total }) => `${kind} ${index} · ${answered}/${total}`,
  /** @param {{ kind: string, index: number, answered: number, total: number, flagged: number, first: number, last: number }} s */
  sectionCollapsed: ({ kind, index, answered, total, flagged, first, last }) =>
    `${kind} ${index}: ${answered} of ${total} answered, ${flagged} flagged. Show questions ${first}–${last}`,
  /** @param {{ q: number, total: number, section?: string }} p */
  position: ({ q, total, section }) => `Q${q} of ${total}${section ? ` · ${section}` : ''}`,
  review: 'Review',
  previous: 'Previous question',
  next: 'Next question',

  // Submit (FR-010)
  submit: 'Submit test',
  submitTitle: 'Submit test?',
  submitBody: 'You cannot change your answers after submitting.',
  warning: 'Warning',
  /** @param {number} n */
  submitBlankTitle: (n) => `Submit with ${n} unanswered ${plural(n, 'question', 'questions')}?`,
  /** @param {string} list @param {number} n */
  submitBlankBody: (list, n) =>
    `${plural(n, 'Question', 'Questions')} ${list} ${plural(n, 'is', 'are')} blank. You cannot change your answers after submitting.`,
  /** @param {string[]} shown @param {number} more */
  questionList: (shown, more) => {
    const head = shown.map((n) => `Q${n}`);
    if (more > 0) return `${head.join(', ')} and ${more} more`;
    if (head.length <= 1) return head.join('');
    return `${head.slice(0, -1).join(', ')} and ${head[head.length - 1]}`;
  },
  returnToTest: 'Return to test',
  waitingConnection: 'Waiting for connection',
  submitBusySaving: 'Saving your answers…',
  submitBusySubmitting: 'Submitting…',
  submitReadOnly: 'This test is open in another tab',

  // Connection (FR-014)
  /** @param {string | null} t */
  offline: (t) => t
    ? `Connection lost. Your work was saved up to ${t}. You can keep working; it will be saved again when you are back online.`
    : 'Connection lost. You can keep working; your work will be saved when you are back online.',
  online: 'Back online. Your work has been saved.',

  // Session expired (FR-015) and displaced (FR-016)
  sessionExpiredTitle: 'Your session has expired',
  /** @param {string | null} t */
  sessionExpiredBody: (t) => t
    ? `Sign in again to continue. You will return to this page. Your work was saved up to ${t}.`
    : 'Sign in again to continue. You will return to this page.',
  /** @param {string | null} t */
  sessionExpiredNoCopy: (t) => t
    ? `This browser could not keep a copy of your answers. Answers after ${t} may be lost if you leave this page.`
    : 'This browser could not keep a copy of your answers. Recent answers may be lost if you leave this page.',
  signInAgain: 'Sign in again',
  notCurrentDevice: 'This test is open on another device.',
  back: 'Back',

  // Other tab (FR-017)
  otherTab: 'This test is open in another tab.',
  useThisTab: 'Use this tab',
  otherTabStuck: 'The other tab is not responding. Close it, then select Reload.',
  reload: 'Reload',

  // Submission outcome (FR-034)
  submitting: 'Submitting your answers…',
  confirmed: 'Your answers have been saved and submitted.',
  unconfirmed: 'Time is up. We have not confirmed your submission yet. Keep this page open while we try again.',
  /** @param {string | null} t */
  unconfirmedManual: (t) => t
    ? `We could not confirm your submission. Your answers were saved on our server up to ${t}.`
    : 'We could not confirm your submission.',
  tryAgain: 'Try again',
  /** @param {string} closedAt @param {string} [savedUpTo] last time the server confirmed a save */
  closedUnconfirmed: (closedAt, savedUpTo = closedAt) =>
    `This test was closed by our server at ${closedAt}. Answers after ${savedUpTo} may not have been recorded.`,

  // Annotation tools stay English in both modes (FR-002)
  highlight: 'Highlight',
  note: 'Note',
  clear: 'Clear',
});
