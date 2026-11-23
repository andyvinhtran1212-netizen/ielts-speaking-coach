// @ts-check
// EXAMROOM-0066 FR-006–FR-008: what the question navigator shows, computed
// from the test structure (sections with first/last question), the question
// states and the current question. Never hard-codes 13·13·14 or 10×4.

/**
 * @typedef {{ id: string, kind: 'passage' | 'part' | 'task', index: number, firstQ: number, lastQ: number }} ExamRoomSection
 * @typedef {{ q: number, sectionId: string, answered: boolean, flagged: boolean, saveState?: 'pending' | 'retrying' | 'failed' }} ExamRoomQuestion
 * @typedef {'wide' | 'medium' | 'compact' | 'phone'} NavigatorDensity
 */

/** Width bands of FR-008. */
export const NAVIGATOR_BREAKPOINTS = Object.freeze({ wide: 1280, medium: 1024, phone: 480 });

/**
 * FR-008 density for a viewport width.
 * - wide (≥1280): 32×44 cells, "Answered n of N" shown.
 * - medium (1024–1279): no "Answered" text, 28px cells.
 * - compact (<1024): bottom bar with previous/position/next, review sheet of
 *   10 cells a row, 44px cells.
 * - phone (<480, the 390px design): position without the section part, sheet
 *   covers the screen, 6 cells a row.
 * @param {number} width
 * @returns {{ density: NavigatorDensity, cellWidth: number, showAnsweredText: boolean, compactBar: boolean, sheetColumns: number | null, sheetFullScreen: boolean, showSectionInPosition: boolean }}
 */
export function navigatorDensity(width) {
  const w = Number.isFinite(width) ? width : NAVIGATOR_BREAKPOINTS.wide;
  if (w >= NAVIGATOR_BREAKPOINTS.wide) {
    return { density: 'wide', cellWidth: 32, showAnsweredText: true, compactBar: false, sheetColumns: null, sheetFullScreen: false, showSectionInPosition: true };
  }
  if (w >= NAVIGATOR_BREAKPOINTS.medium) {
    return { density: 'medium', cellWidth: 28, showAnsweredText: false, compactBar: false, sheetColumns: null, sheetFullScreen: false, showSectionInPosition: true };
  }
  if (w >= NAVIGATOR_BREAKPOINTS.phone) {
    return { density: 'compact', cellWidth: 44, showAnsweredText: false, compactBar: true, sheetColumns: 10, sheetFullScreen: false, showSectionInPosition: true };
  }
  return { density: 'phone', cellWidth: 44, showAnsweredText: false, compactBar: true, sheetColumns: 6, sheetFullScreen: true, showSectionInPosition: false };
}

/**
 * Sections in display order with their questions, rejecting structures the
 * navigator cannot draw truthfully (overlapping ranges, a question outside its
 * section, duplicate numbers).
 * @param {ExamRoomSection[]} sections
 * @param {ExamRoomQuestion[]} questions
 */
export function groupQuestions(sections, questions) {
  const ordered = [...sections].sort((a, b) => a.index - b.index || a.firstQ - b.firstQ);
  const byId = new Map(ordered.map((s) => [s.id, s]));
  if (byId.size !== ordered.length) throw new Error('exam-room navigator: duplicate section id');
  for (let i = 0; i < ordered.length; i += 1) {
    const s = ordered[i];
    if (!(s.firstQ <= s.lastQ)) throw new Error(`exam-room navigator: section ${s.id} has an empty range`);
    if (i > 0 && s.firstQ <= ordered[i - 1].lastQ) throw new Error(`exam-room navigator: section ${s.id} overlaps the previous section`);
  }
  const seen = new Set();
  /** @type {Map<string, ExamRoomQuestion[]>} */
  const groups = new Map(ordered.map((s) => [s.id, []]));
  for (const q of questions) {
    const s = byId.get(q.sectionId);
    if (!s) throw new Error(`exam-room navigator: question ${q.q} has unknown section ${q.sectionId}`);
    if (q.q < s.firstQ || q.q > s.lastQ) throw new Error(`exam-room navigator: question ${q.q} is outside section ${s.id}`);
    if (seen.has(q.q)) throw new Error(`exam-room navigator: duplicate question ${q.q}`);
    seen.add(q.q);
    /** @type {ExamRoomQuestion[]} */ (groups.get(s.id)).push(q);
  }
  for (const list of groups.values()) list.sort((a, b) => a.q - b.q);
  return ordered.map((section) => ({ section, questions: /** @type {ExamRoomQuestion[]} */ (groups.get(section.id)) }));
}

/**
 * The question to jump to when a collapsed section is opened: its first
 * unanswered question, or its first question when all are answered.
 * @param {ExamRoomSection} section
 * @param {ExamRoomQuestion[]} questions questions of that section, sorted
 */
export function sectionJumpTarget(section, questions) {
  const blank = questions.find((q) => !q.answered);
  return blank ? blank.q : (questions[0]?.q ?? section.firstQ);
}

/**
 * Full navigator model.
 * @param {{
 *   sections: ExamRoomSection[], questions: ExamRoomQuestion[], currentQ?: number | null,
 *   width?: number, strings: any, expandedSectionId?: string | null,
 * }} input
 *   `expandedSectionId` lets the learner open another section without moving the
 *   current question; by default the section holding the current question is open.
 */
export function navigatorModel({ sections, questions, currentQ = null, width = NAVIGATOR_BREAKPOINTS.wide, strings, expandedSectionId = null }) {
  const groups = groupQuestions(sections, questions);
  const density = navigatorDensity(width);
  const currentGroup = groups.find((g) => g.questions.some((q) => q.q === currentQ)) ?? null;
  const openId = (expandedSectionId && groups.some((g) => g.section.id === expandedSectionId))
    ? expandedSectionId
    : (currentGroup?.section.id ?? groups[0]?.section.id ?? null);

  let answeredTotal = 0;
  let total = 0;
  const sectionModels = groups.map(({ section, questions: qs }) => {
    const kind = strings.sectionKind[section.kind] ?? section.kind;
    const answered = qs.filter((q) => q.answered).length;
    const flagged = qs.filter((q) => q.flagged).length;
    answeredTotal += answered;
    total += qs.length;
    const expanded = section.id === openId;
    return {
      id: section.id,
      kind: section.kind,
      index: section.index,
      firstQ: section.firstQ,
      lastQ: section.lastQ,
      expanded,
      answered,
      total: qs.length,
      flagged,
      /** Collapsed sections with a flag get the plum bottom rule (FR-006). */
      flagRule: !expanded && flagged > 0,
      chipLabel: strings.sectionChip({ kind, index: section.index, answered, total: qs.length }),
      ariaLabel: expanded ? null : strings.sectionCollapsed({
        kind, index: section.index, answered, total: qs.length, flagged, first: section.firstQ, last: section.lastQ,
      }),
      jumpTo: sectionJumpTarget(section, qs),
      cells: expanded ? qs.map((q) => ({
        q: q.q,
        label: String(q.q),
        answered: q.answered,
        flagged: q.flagged,
        current: q.q === currentQ,
        unsaved: Boolean(q.saveState),
        saveState: q.saveState ?? null,
        ariaLabel: strings.qLabel({ n: q.q, answered: q.answered, flagged: q.flagged, current: q.q === currentQ }),
      })) : [],
    };
  });

  const ordered = groups.flatMap((g) => g.questions.map((q) => q.q));
  const currentIndex = currentQ == null ? -1 : ordered.indexOf(currentQ);
  const currentSection = currentGroup ? sectionModels.find((s) => s.id === currentGroup.section.id) ?? null : null;
  const sectionPart = currentSection
    ? strings.sectionChip({ kind: strings.sectionKind[currentSection.kind] ?? currentSection.kind, index: currentSection.index, answered: currentSection.answered, total: currentSection.total })
    : undefined;

  return {
    ...density,
    sections: sectionModels,
    answered: answeredTotal,
    total,
    answeredText: strings.answered(answeredTotal, total),
    position: currentIndex >= 0 ? strings.position({
      q: /** @type {number} */ (currentQ), total, section: density.showSectionInPosition ? sectionPart : undefined,
    }) : null,
    previousQ: currentIndex > 0 ? ordered[currentIndex - 1] : null,
    nextQ: currentIndex >= 0 && currentIndex < ordered.length - 1 ? ordered[currentIndex + 1] : null,
  };
}
