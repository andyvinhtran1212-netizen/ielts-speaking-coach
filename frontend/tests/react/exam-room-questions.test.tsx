// EXAMROOM-0066 T003 (G08-T04), FR-025–FR-027: shared question types.
// The "current player" functions below are copied verbatim from the players on
// staging @ cc6dd4c8 so each shared type can be checked against the exact
// `user_answer` string sent today:
// - Reading: app/(authed-reading-player)/reading/exam/session/reading-exam-session.tsx
// - Listening: app/(authed-listening-player)/listening/test/session/listening-test-session.tsx
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ClaimChoice, CompletionGrid, FeatureMatrix, GapFill, MapLabel, Matching, MultiChoice, QuestionResult,
  QUESTION_STRINGS_EN, QUESTION_STRINGS_VI, ScoreLine, ShortAnswer, SingleChoice, SummaryCompletion,
  listeningOption, optionUsage, readingOption, scoreText, templateSegments, toggleMultiChoice,
  type ExamRoomOption, type MultiChoiceEncoding,
} from '@/components/exam-room/questions';

afterEach(cleanup);

// ---- current players (verbatim logic) ------------------------------------

/** Reading optionValue (reading-exam-session.tsx). */
function readingOptionValueNow(option: any) {
  if (typeof option === 'string') return option;
  return String(option.label ?? option.text ?? '');
}
/** Listening optionValue (listening-test-session.tsx). */
function listeningOptionValueNow(option: any) {
  if (typeof option === 'string') return option;
  return String(option?.letter ?? option?.label ?? option?.value ?? '');
}
/** Reading QuestionControl mcq_multi onChange. */
function readingMultiNow(value: string, answer: string, checked: boolean) {
  const selected = new Set(value.split(',').filter(Boolean));
  const next = new Set(selected);
  if (checked) next.add(answer); else next.delete(answer);
  return [...next].join(',');
}
/** Reading GroupedMcqRun update. */
function readingGroupedNow(slots: string[], options: string[], choose: number, value: string, checked: boolean) {
  const selected = new Set(slots.filter(Boolean));
  const next = new Set(selected);
  if (checked) next.add(value); else next.delete(value);
  const ordered = options.filter((option) => next.has(option)).slice(0, choose);
  return slots.map((_, index) => ordered[index] || '');
}
/** Listening MultiSelectTemplate onChange. */
function listeningMultiNow(slots: string[], value: string, checked: boolean) {
  const selected = slots.filter(Boolean);
  const next = checked ? [...selected, value] : selected.filter((item) => item !== value);
  return slots.map((_, index) => next[index] || '');
}

// ---- harness ---------------------------------------------------------------

function Harness({ initial = {}, render: draw }: {
  initial?: Record<number, string>;
  render(props: { answers: Record<number, string>; onAnswer(q: number, v: string): void }): JSX.Element;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>(initial);
  return <>
    {draw({ answers, onAnswer: (q, v) => setAnswers((prev) => ({ ...prev, [q]: v })) })}
    <output data-testid="answers">{JSON.stringify(answers)}</output>
  </>;
}
const stored = () => JSON.parse(screen.getByTestId('answers').textContent || '{}');

const LETTERS: ExamRoomOption[] = ['A', 'B', 'C', 'D', 'E'].map((l) => ({ value: l, prefix: l, text: `Option ${l}` }));

// ---- answer codec parity --------------------------------------------------

describe('answer codec matches the current players', () => {
  const rawOptions: any[] = [
    'plain',
    { label: 'A', text: 'first' },
    { text: 'no label' },
    { letter: 'B', label: 'ignored', text: 'listening letter' },
    { value: 'C', text: 'value only' },
    { label: 'iv', text: 'roman' },
  ];

  it('Reading option value is label, then text; Listening is letter, then label, then value', () => {
    for (const raw of rawOptions) {
      expect(readingOption(raw).value).toBe(readingOptionValueNow(raw));
      expect(listeningOption(raw).value).toBe(listeningOptionValueNow(raw));
    }
    // They really differ: no shared normalisation (FR-025).
    expect(readingOption(rawOptions[3]).value).toBe('ignored');
    expect(listeningOption(rawOptions[3]).value).toBe('B');
    expect(readingOption(rawOptions[4]).value).toBe('value only');
    expect(listeningOption(rawOptions[4]).value).toBe('C');
  });

  const clicks: Array<[string, boolean]> = [['C', true], ['A', true], ['E', true], ['A', false], ['B', true], ['C', false], ['D', true]];
  const optionValues = ['A', 'B', 'C', 'D', 'E'];

  it('csv (Reading mcq_multi) keeps click order, as today', () => {
    let now = '';
    let shared = '';
    for (const [value, checked] of clicks) {
      now = readingMultiNow(now, value, checked);
      shared = toggleMultiChoice({ encoding: 'csv', slotValues: [shared], value, checked, optionValues, choose: 0 })[0];
      expect(shared).toBe(now);
    }
    expect(shared).toBe('E,B,D');
  });

  it('slots-option-order (Reading grouped MCQ) sorts by the option list, as today', () => {
    let now = ['', '', ''];
    let shared = ['', '', ''];
    for (const [value, checked] of clicks) {
      now = readingGroupedNow(now, optionValues, 3, value, checked);
      shared = toggleMultiChoice({ encoding: 'slots-option-order', slotValues: shared, value, checked, optionValues, choose: 3 });
      expect(shared).toEqual(now);
    }
    expect(shared).toEqual(['B', 'D', 'E']);
  });

  it('slots-click-order (Listening mcq_multi) keeps click order, as today', () => {
    let now = ['', ''];
    let shared = ['', ''];
    for (const [value, checked] of [['D', true], ['B', true], ['D', false], ['A', true]] as Array<[string, boolean]>) {
      now = listeningMultiNow(now, value, checked);
      shared = toggleMultiChoice({ encoding: 'slots-click-order', slotValues: shared, value, checked, optionValues, choose: 2 });
      expect(shared).toEqual(now);
    }
    expect(shared).toEqual(['B', 'A']);
  });

  it('gap markers: Reading {{n}} (trailing ____ is the same blank), Listening {{Qn}}', () => {
    expect(templateSegments('The {{21}} ____ is near the {{22}}.', 'reading')).toEqual(['The ', { q: 21 }, ' is near the ', { q: 22 }, '.']);
    expect(templateSegments('Rent is {{Q3}} a week, paid {{Q4}}', 'listening')).toEqual(['Rent is ', { q: 3 }, ' a week, paid ', { q: 4 }]);
    // Not swapped between surfaces.
    expect(templateSegments('{{Q3}}', 'reading')).toEqual(['{{Q3}}']);
    expect(templateSegments('{{3}}', 'listening')).toEqual(['{{3}}']);
  });

  it('option usage lists the questions using each value; score never shows 0/0', () => {
    expect([...optionUsage([{ q: 7 }, { q: 6 }, { q: 8 }], { 6: 'iv', 7: 'ii', 8: 'iv' })]).toEqual([['iv', [6, 8]], ['ii', [7]]]);
    expect(scoreText({ correct: 9, total: 13 }, QUESTION_STRINGS_VI)).toBe('Đúng 9 trên 13 câu');
    expect(scoreText({ correct: 0, total: 0 }, QUESTION_STRINGS_EN)).toBeNull();
    expect(scoreText({ correct: 5, total: 3 }, QUESTION_STRINGS_EN)).toBeNull();
  });
});

// ---- components -------------------------------------------------------------

describe('SingleChoice and ClaimChoice', () => {
  it('stores the option value and TRUE/FALSE/NOT GIVEN exactly', () => {
    render(<Harness render={(p) => <>
      <SingleChoice {...p} q={1} prompt="Why did the author move?" options={LETTERS.slice(0, 3)} strings={QUESTION_STRINGS_EN} />
      <ClaimChoice {...p} q={2} prompt="The museum opened in 1990." kind="tfng" strings={QUESTION_STRINGS_EN} />
      <ClaimChoice {...p} q={3} prompt="The writer agrees." kind="ynng" strings={QUESTION_STRINGS_EN} />
    </>} />);
    fireEvent.click(screen.getByRole('radio', { name: /Option B/ }));
    fireEvent.click(within(screen.getByRole('group', { name: /Question 2/ })).getByRole('radio', { name: 'NOT GIVEN' }));
    fireEvent.click(screen.getByRole('radio', { name: 'YES' }));
    expect(stored()).toEqual({ 1: 'B', 2: 'NOT GIVEN', 3: 'YES' });
  });

  it('read-only tab: options are disabled', () => {
    render(<SingleChoice q={1} prompt="p" options={LETTERS.slice(0, 2)} answers={{}} onAnswer={() => {}} readOnly strings={QUESTION_STRINGS_EN} />);
    for (const radio of screen.getAllByRole('radio')) expect((radio as HTMLInputElement).disabled).toBe(true);
  });
});

describe('MultiChoice', () => {
  function renderMulti(encoding: MultiChoiceEncoding, qs: number[], choose: number, strings = QUESTION_STRINGS_EN) {
    render(<Harness render={(p) => <MultiChoice {...p} qs={qs} prompt="Which TWO facilities?" options={LETTERS} encoding={encoding} choose={choose} strings={strings} />} />);
  }
  const tick = (letter: string) => fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`Option ${letter}`) }));

  it('always states how many to choose and how many are chosen', () => {
    renderMulti('slots-click-order', [11, 12], 2, QUESTION_STRINGS_VI);
    expect(screen.getByText('Chọn 2 đáp án. Đã chọn 0 trên 2')).toBeTruthy();
    tick('C');
    expect(screen.getByText('Chọn 2 đáp án. Đã chọn 1 trên 2')).toBeTruthy();
  });

  it('Listening slots keep click order and lock the rest at the limit', () => {
    renderMulti('slots-click-order', [11, 12], 2);
    tick('D'); tick('B');
    expect(stored()).toEqual({ 11: 'D', 12: 'B' });
    expect((screen.getByRole('checkbox', { name: /Option A/ }) as HTMLInputElement).disabled).toBe(true);
    tick('D');
    expect(stored()).toEqual({ 11: 'B', 12: '' });
  });

  it('Reading grouped slots are written in option order', () => {
    renderMulti('slots-option-order', [21, 22], 2);
    tick('D'); tick('B');
    expect(stored()).toEqual({ 21: 'B', 22: 'D' });
  });

  it('Reading mcq_multi is one comma list in click order on one question', () => {
    renderMulti('csv', [5], 0);
    tick('E'); tick('A');
    expect(stored()).toEqual({ 5: 'E,A' });
    expect(screen.getByText('Selected 2')).toBeTruthy();
  });
});

describe('GapFill and ShortAnswer', () => {
  it('the gap sits inside the sentence and the answer is kept exactly as typed', () => {
    render(<Harness render={(p) => <GapFill {...p} q={4} prompt="The bridge was built in ____ by the council." wordLimit="NO MORE THAN TWO WORDS" strings={QUESTION_STRINGS_EN} />} />);
    const input = screen.getByRole('textbox', { name: 'Answer 4' });
    expect(input.closest('p')?.textContent).toContain('The bridge was built in');
    fireEvent.change(input, { target: { value: '  the 1890s ' } });
    expect(stored()).toEqual({ 4: '  the 1890s ' });
    expect(screen.getByText('Write NO MORE THAN TWO WORDS.')).toBeTruthy();
  });

  it('short answer without a gap puts the input after the prompt', () => {
    render(<ShortAnswer q={9} prompt="What did the team measure?" answers={{ 9: 'salt' }} onAnswer={() => {}} strings={QUESTION_STRINGS_EN} />);
    expect((screen.getByRole('textbox', { name: 'Answer 9' }) as HTMLInputElement).value).toBe('salt');
  });
});

describe('Matching', () => {
  it('a used option is struck through with a hidden "(used in Q6)"; the select stores the value', () => {
    const headings = ['i', 'ii', 'iii', 'iv'].map((v) => ({ value: v, prefix: v, text: `Heading ${v}` }));
    render(<Harness initial={{ 6: 'iv' }} render={(p) => <Matching {...p} bankTitle="List of Headings" options={headings}
      questions={[{ q: 6, prompt: 'Paragraph B' }, { q: 7, prompt: 'Paragraph C' }]} strings={QUESTION_STRINGS_EN} />} />);
    const bank = screen.getByRole('complementary', { name: 'List of Headings' });
    const used = within(bank).getByText('Heading iv').closest('li')!;
    expect(used.getAttribute('data-used')).toBe('true');
    expect(used.textContent).toContain('(used in Q6)');
    fireEvent.change(screen.getByRole('combobox', { name: 'Question 7. Paragraph C' }), { target: { value: 'ii' } });
    expect(stored()).toEqual({ 6: 'iv', 7: 'ii' });
  });
});

describe('CompletionGrid', () => {
  it('table keeps rows and columns with inputs in the cells', () => {
    render(<Harness render={(p) => <CompletionGrid {...p} kind="table" heading="Tour options" headers={['Tour', 'Price']}
      rows={[[['City walk'], ['£', { q: 1 }]], [['Boat'], [{ q: 2 }, ' per person']]]} strings={QUESTION_STRINGS_EN} />} />);
    const table = screen.getByRole('table', { name: 'Tour options' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    fireEvent.change(within(table).getByRole('textbox', { name: 'Answer 2' }), { target: { value: '12.50' } });
    expect(stored()).toEqual({ 2: '12.50' });
  });

  it('notes keep their line order and roles', () => {
    render(<CompletionGrid kind="notes" lines={[
      { role: 'title', segments: ['Library notes'] },
      { role: 'bullet', segments: ['Open until ', { q: 5 }] },
    ]} answers={{}} onAnswer={() => {}} strings={QUESTION_STRINGS_EN} />);
    expect(screen.getByText('Library notes')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Answer 5' })).toBeTruthy();
  });
});

describe('MapLabel, SummaryCompletion, FeatureMatrix', () => {
  it('map labels store the letter', () => {
    render(<Harness render={(p) => <MapLabel {...p} image={{ src: 'data:image/png;base64,AA==', alt: 'Map for questions 15 to 16' }}
      letters={['A', 'B', 'C']} questions={[{ q: 15, prompt: 'Café' }, { q: 16, prompt: 'Toilets' }]} unavailable="The map is unavailable." strings={QUESTION_STRINGS_EN} />} />);
    expect(screen.getByRole('img', { name: 'Map for questions 15 to 16' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Question 16. Toilets' }), { target: { value: 'C' } });
    expect(stored()).toEqual({ 16: 'C' });
  });

  it('summary with a word bank uses selects of the bank values; without one, text gaps', () => {
    const bank = [{ value: 'A', prefix: 'A', text: 'cheaper' }, { value: 'B', prefix: 'B', text: 'faster' }];
    render(<Harness render={(p) => <>
      <SummaryCompletion {...p} segments={templateSegments('Trains are {{30}} than buses.', 'reading')} bank={bank} bankTitle="Word Bank" strings={QUESTION_STRINGS_EN} />
      <SummaryCompletion {...p} segments={templateSegments('Paid {{Q31}} weekly.', 'listening')} strings={QUESTION_STRINGS_EN} />
    </>} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Answer 30' }), { target: { value: 'B' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Answer 31' }), { target: { value: '£40' } });
    expect(stored()).toEqual({ 30: 'B', 31: '£40' });
    expect(within(screen.getByRole('complementary', { name: 'Word Bank' })).getByText('faster').closest('li')!.getAttribute('data-used')).toBe('true');
  });

  it('feature matrix: one radio per option in each statement row', () => {
    render(<Harness render={(p) => <FeatureMatrix {...p} options={LETTERS.slice(0, 3)} questions={[{ q: 33, prompt: 'Found the first sample' }]} strings={QUESTION_STRINGS_EN} />} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Question 33: C' }));
    expect(stored()).toEqual({ 33: 'C' });
  });
});

describe('QuestionResult and ScoreLine (FR-026)', () => {
  it('right or wrong in words, the correct answer and one line of explanation', () => {
    render(<QuestionResult strings={QUESTION_STRINGS_VI} result={{ q: 7, userAnswer: 'FALSE', expected: 'NOT GIVEN', correct: false, explanation: 'Bài không nói năm mở cửa.' }} />);
    expect(screen.getByText('Câu 7: Sai')).toBeTruthy();
    expect(screen.getByText('NOT GIVEN')).toBeTruthy();
    expect(screen.getByText('Bài không nói năm mở cửa.')).toBeTruthy();
  });

  it('blank answers say "Not answered"; the score line is hidden when there is nothing to count', () => {
    render(<>
      <QuestionResult strings={QUESTION_STRINGS_EN} result={{ q: 2, userAnswer: '', expected: 'B', correct: false }} />
      <ScoreLine correct={9} total={13} strings={QUESTION_STRINGS_EN} />
    </>);
    expect(screen.getByText('Question 2: Not answered')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('9 of 13 correct');
    cleanup();
    const { container } = render(<ScoreLine correct={0} total={0} strings={QUESTION_STRINGS_EN} />);
    expect(container.textContent).toBe('');
  });
});

describe('strings', () => {
  it('English and Vietnamese have the same keys', () => {
    expect(Object.keys(QUESTION_STRINGS_VI).sort()).toEqual(Object.keys(QUESTION_STRINGS_EN).sort());
  });
});
