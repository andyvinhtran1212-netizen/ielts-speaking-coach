// UIBASE-0056 G03-T09 (FR-005): BandScore (+CriteriaList, OverallBlock), Timer,
// QuestionPalette, VocabEntry, AnnotatedText, Figure. Behaviour only: roles,
// names, text, aria-*; no class selectors.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activeThreshold, AnnotatedText, BAND_DISCLAIMER, BandScore, compareSentence, Figure, formatClock, ieltsOverall, isValidBand, overallStatus, type OverallSkill,
  OverallBlock, paletteSummary, QuestionPalette, questionCellName, Timer, VocabEntry, type QuestionItem,
} from '@/components/ui';

afterEach(cleanup);

/** A drawn band's paragraph by its spoken text ("Band ước lượng · Writing Task 2: 6.0"). */
const bandValue = (spoken: string) => screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === spoken);

describe('BandScore', () => {
  it('a ready band always carries the disclaimer and its basis', () => {
    render(<BandScore skill="Writing Task 2" band={6} basis="Dựa trên 1 bài, 268 từ" />);
    expect(bandValue('Band ước lượng · Writing Task 2: 6.0')).toBeTruthy();
    expect(screen.getByText('6.0', { exact: true, ignore: 'span' })).toBeTruthy();
    expect(screen.getByText(`${BAND_DISCLAIMER}. Dựa trên 1 bài, 268 từ.`)).toBeTruthy();
  });

  it('insufficient and grading never draw a number, even if a band is passed', () => {
    const { container, rerender } = render(<BandScore skill="Listening" state="insufficient" band={6.5} note="đúng 9 trên 13 câu" />);
    expect(screen.getByText('Chưa đủ bài để ước lượng')).toBeTruthy();
    expect(container.textContent).not.toMatch(/6\.5/);
    rerender(<BandScore skill="Speaking" state="grading" band={6.5} />);
    expect(screen.getByRole('status').textContent).toBe('Đang chấm…');
    expect(container.textContent).not.toMatch(/6\.5/);
    expect(container.textContent).not.toContain(BAND_DISCLAIMER);
  });

  it('says the comparison in words with the earlier band and date', () => {
    expect(compareSentence(6.5, { band: 6, date: '02/11' })).toBe('Cao hơn lần trước 0.5 band (6.0, bài ngày 02/11)');
    expect(compareSentence(5.5, { band: 6 })).toBe('Thấp hơn lần trước 0.5 band (6.0)');
    expect(compareSentence(6.5, { band: 6.5 })).toBe('Giữ nguyên so với lần trước (6.5)');
    render(<BandScore skill="Writing Task 2" band={6.5} previous={{ band: 6, date: '02/11' }} />);
    expect(screen.getByText('Cao hơn lần trước 0.5 band (6.0, bài ngày 02/11).')).toBeTruthy();
  });

  it('lists the four criteria with English names', () => {
    render(<BandScore skill="Writing Task 2" band={6} criteria={[{ name: 'Task Response', band: 5.5, note: 'Chưa bàn đủ vế thứ hai.' }]} />);
    const term = screen.getByText('Task Response');
    expect(term.tagName).toBe('DT');
    expect(term.getAttribute('lang')).toBe('en');
    expect(screen.getByText('5.5')).toBeTruthy();
  });
});

describe('OverallBlock', () => {
  const four: OverallSkill[] = [
    { skill: 'listening', band: 6.5 }, { skill: 'reading', band: 7 }, { skill: 'writing', band: 6 }, { skill: 'speaking', band: 6 },
  ];

  it('rounds the mean to the nearest half band, a quarter up', () => {
    expect(ieltsOverall([6.5, 7, 6, 6])).toBe(6.5); // 6.375
    expect(ieltsOverall([6, 6, 6, 6.5])).toBe(6); // 6.125
    expect(ieltsOverall([6, 6, 6.5, 6.5])).toBe(6.5); // 6.25
    expect(ieltsOverall([7, 7, 7, 6])).toBe(7); // 6.75
  });

  it('accepts only finite half bands from 0 to 9', () => {
    expect([0, 4.5, 9].every(isValidBand)).toBe(true);
    expect([NaN, Infinity, -0.5, 9.5, 6.3, 10, '6' as unknown, null].some(isValidBand)).toBe(false);
  });

  it('shows a number only when each of the four skills is present once', () => {
    const { rerender, container } = render(<OverallBlock skills={four} />);
    expect(bandValue('Overall ước lượng: 6.5')).toBeTruthy();
    rerender(<OverallBlock skills={[...four.slice(0, 3), { skill: 'speaking', band: null }]} />);
    expect(screen.queryByText(/Overall ước lượng:/)).toBeNull();
    expect(screen.getByText('Chưa có Overall · Speaking đang chấm')).toBeTruthy();
    expect(container.textContent).toContain(BAND_DISCLAIMER);
    rerender(<OverallBlock skills={four.slice(0, 3)} />);
    expect(screen.queryByText(/Overall ước lượng:/)).toBeNull();
    expect(screen.getByText('Chưa có Overall · chưa có Speaking')).toBeTruthy();
  });

  it('gives no Overall for four rows with a duplicate skill, an unknown code or an invalid band', () => {
    const duplicate: OverallSkill[] = [...four.slice(0, 3), { skill: 'writing', band: 6 }];
    expect(overallStatus(duplicate)).toEqual({ kind: 'invalid' });
    const unknown = [...four.slice(0, 3), { skill: 'Speaking', band: 6 }] as unknown as OverallSkill[];
    expect(overallStatus(unknown)).toEqual({ kind: 'invalid' });
    for (const bad of [NaN, 9.5, -1, 6.3, Infinity]) {
      expect(overallStatus([...four.slice(0, 3), { skill: 'speaking', band: bad }])).toEqual({ kind: 'invalid' });
    }
    expect(overallStatus([...four, { skill: 'speaking', band: 6 }])).toEqual({ kind: 'invalid' });
    render(<OverallBlock skills={duplicate} />);
    expect(screen.queryByText(/Overall ước lượng:/)).toBeNull();
    expect(screen.getByText('Chưa có Overall · dữ liệu điểm chưa hợp lệ')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(4);
  });

  it('lists the four skills in fixed order whatever the input order', () => {
    const { container } = render(<OverallBlock skills={[...four].reverse()} />);
    expect([...container.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(['Listening', 'Reading', 'Writing', 'Speaking']);
    expect(bandValue('Overall ước lượng: 6.5')).toBeTruthy();
  });
});

describe('BandScore validity', () => {
  it('draws no number for an invalid band even when ready', () => {
    const { container } = render(<BandScore skill="Writing" band={Number.NaN} />);
    expect(container.querySelector('[data-state="ready"]')).toBeNull();
    expect(container.textContent).not.toContain('NaN');
  });

  it('calls an invalid band a data error, never "not enough work yet"', () => {
    for (const bad of [Number.NaN, 9.5, 6.3]) {
      const { container, unmount } = render(<BandScore skill="Writing" band={bad} action={<a href="/x">Làm một đề đủ</a>} />);
      expect(screen.getByText('Chưa có band · dữ liệu điểm chưa hợp lệ')).toBeTruthy();
      expect(container.querySelector('[data-state="invalid"]')).toBeTruthy();
      expect(container.textContent).not.toContain('Chưa đủ bài');
      expect(screen.queryByText('Làm một đề đủ')).toBeNull();
      expect(container.textContent).not.toContain(String(bad));
      unmount();
    }
    render(<BandScore skill="Writing" band={null} />);
    expect(screen.getByText('Chưa đủ bài để ước lượng')).toBeTruthy();
  });
});

describe('Timer', () => {
  const marks = [
    { at: 300, label: '5 minutes left', announce: '5 minutes left. The test will submit automatically.' },
    { at: 0, label: 'Time is up' },
  ];

  it('formats mm:ss in the exam room and m:ss in practice', () => {
    expect(formatClock(1930, true)).toBe('32:10');
    expect(formatClock(42, false)).toBe('0:42');
    expect(formatClock(-3, true)).toBe('00:00');
    expect(activeThreshold('countdown', 299, marks)?.label).toBe('5 minutes left');
    expect(activeThreshold('countdown', 0, marks)?.label).toBe('Time is up');
    expect(activeThreshold('countup', 104, [{ at: 105, label: 'Còn 15 giây' }])).toBeNull();
  });

  it('changes the words at a mark and announces each mark exactly once', () => {
    const { rerender, container } = render(<Timer lang="en" label="Time remaining" seconds={301} thresholds={marks} />);
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(screen.getByText('Time remaining')).toBeTruthy();
    expect(live.textContent).toBe('');
    rerender(<Timer lang="en" label="Time remaining" seconds={300} thresholds={marks} />);
    expect(screen.getByText('5 minutes left')).toBeTruthy();
    expect(live.textContent).toBe('5 minutes left. The test will submit automatically.');
    rerender(<Timer lang="en" label="Time remaining" seconds={250} thresholds={marks} />);
    expect(live.textContent).toBe('5 minutes left. The test will submit automatically.');
    rerender(<Timer lang="en" label="Time remaining" seconds={0} thresholds={marks} />);
    expect(live.textContent).toBe('Time is up');
    expect(screen.getByText('00:00')).toBeTruthy();
  });

  it('announces a mark again after the clock is reset for the next part', () => {
    const { rerender, container } = render(<Timer lang="en" label="Time remaining" seconds={300} thresholds={marks} />);
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe('5 minutes left. The test will submit automatically.');
    rerender(<Timer lang="en" label="Time remaining" seconds={0} thresholds={marks} />);
    expect(live.textContent).toBe('Time is up');
    rerender(<Timer lang="en" label="Time remaining" seconds={1800} thresholds={marks} />);
    rerender(<Timer lang="en" label="Time remaining" seconds={300} thresholds={marks} />);
    expect(live.textContent).toBe('5 minutes left. The test will submit automatically.');
  });

  it('clears a single countup warning so the next part can announce it again', () => {
    const threshold = [{ at: 105, label: 'Còn 15 giây' }];
    const timer = (seconds: number) => <Timer mode="countup" label="Đang ghi âm" seconds={seconds} thresholds={threshold} />;
    const { container, rerender } = render(timer(105));
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe('Còn 15 giây');
    rerender(timer(0));
    expect(live.textContent).toBe('');
    rerender(timer(105));
    expect(live.textContent).toBe('Còn 15 giây');
  });

  it('countup shows the limit in the page language', () => {
    render(<Timer mode="countup" label="Đang ghi âm" seconds={65} max={120} />);
    expect(screen.getByText('1:05')).toBeTruthy();
    expect(screen.getByText(/tối đa 2:00/)).toBeTruthy();
  });
});

describe('QuestionPalette', () => {
  const items: QuestionItem[] = [
    { num: 1, state: 'answered' },
    { num: 2, state: 'unanswered', flagged: true },
    { num: 3, state: 'answered', flagged: true, current: true },
    { num: 4, state: 'flagged' },
  ];

  it('names every cell in full, in one language', () => {
    expect(questionCellName(items[2], 'en')).toBe('Question 3, answered, flagged for review, current question');
    expect(questionCellName(items[3], 'vi')).toBe('Câu 4, chưa trả lời, đánh dấu xem lại');
    render(<QuestionPalette lang="en" title="Part 1 · Questions 1–4" items={items} onSelect={() => {}} />);
    const list = screen.getByRole('list', { name: 'Part 1 · Questions 1–4' });
    const cells = within(list).getAllByRole('button');
    expect(cells.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Question 1, answered',
      'Question 2, not answered, flagged for review',
      'Question 3, answered, flagged for review, current question',
      'Question 4, not answered, flagged for review',
    ]);
    expect(cells.map((c) => c.getAttribute('aria-current'))).toEqual([null, null, 'true', null]);
    expect(screen.getByText('Answered 2 of 4')).toBeTruthy();
  });

  it('draws "current" without an outline, so the focus ring stays distinct', () => {
    // CSS modules are not applied in jsdom: read the rule itself.
    const css = readFileSync(join(process.cwd(), 'components/ui/question-palette.module.css'), 'utf8');
    const current = /\.current\s*\{([^}]*)\}/.exec(css)![1];
    expect(current).not.toMatch(/outline/);
    expect(current).toMatch(/box-shadow:\s*inset/);
    expect(css).toMatch(/\.current::after\s*\{/);
    expect(css).not.toMatch(/\.cell[^{]*\{[^}]*outline/);
  });

  it('calls onSelect with the question number', () => {
    const onSelect = vi.fn();
    render(<QuestionPalette items={items} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Câu 2, chưa trả lời, đánh dấu xem lại' }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('after marking says right, wrong and blank in words', () => {
    const graded: QuestionItem[] = [{ num: 1, state: 'correct' }, { num: 2, state: 'wrong' }, { num: 3, state: 'blank' }];
    expect(paletteSummary(graded, 'vi')).toBe('Đúng 1 trên 3 câu · sai 1 · bỏ trống 1');
    render(<QuestionPalette items={graded} />);
    // Graded review without onSelect: plain cells, no buttons that do nothing.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('Câu 2, sai')).toBeTruthy();
    expect(screen.getByText('Câu 3, bỏ trống')).toBeTruthy();
  });
});

describe('VocabEntry', () => {
  it('keeps the fixed order and puts IPA in .av2-ipa', () => {
    render(
      <VocabEntry
        headword="affordable"
        ipa="əˈfɔːdəbl"
        pos="tính từ"
        defEn="cheap enough for most people to pay for"
        defVi="vừa túi tiền"
        example={<>more <strong>affordable</strong> tickets</>}
        collocations={['affordable housing', 'remain affordable']}
      />,
    );
    const entry = screen.getByRole('article', { name: 'affordable' });
    expect(within(entry).getByRole('heading', { name: 'affordable' })).toBeTruthy();
    expect(within(entry).getByText('/əˈfɔːdəbl/').classList.contains('av2-ipa')).toBe(true);
    const terms = within(entry).getAllByRole('term').map((t) => t.textContent);
    expect(terms).toEqual(['Nghĩa tiếng Anh', 'Nghĩa tiếng Việt', 'Ví dụ', 'Collocation']);
    expect(within(entry).getByText('affordable housing · remain affordable')).toBeTruthy();
    const text = entry.textContent!;
    expect(text.indexOf('/əˈfɔːdəbl/')).toBeLessThan(text.indexOf('tính từ'));
  });

  it('popover shows word, pronunciation, part of speech and Vietnamese meaning only', () => {
    const { container } = render(<VocabEntry variant="popover" headword="congestion" ipa="kənˈdʒestʃən" pos="danh từ" defEn="too much traffic" defVi="ùn tắc giao thông" />);
    expect(container.textContent).toContain('ùn tắc giao thông');
    expect(container.textContent).not.toContain('too much traffic');
  });
});

describe('AnnotatedText', () => {
  const segments = [
    { text: 'I ' },
    { text: 'am agree', mark: 1 as const, note: 1 },
    { text: ' with this. ' },
    { text: 'expensive price', mark: 2 as const, note: 2 },
  ];
  const notes = [
    { number: 1, label: 'Ngữ pháp', body: 'Bỏ am.' },
    { number: 2, label: 'Từ vựng', body: 'Bỏ price.' },
  ];

  it('each mark has a note number and its kind for screen readers', () => {
    const { container } = render(<AnnotatedText segments={segments} notes={notes} />);
    expect(container.querySelector('p[lang="en"]')!.textContent).toBe('I am agreeChú thích 1, Ngữ pháp with this. expensive priceChú thích 2, Từ vựng');
    const list = screen.getByRole('list', { name: 'Chú thích' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1Ngữ phápBỏ am.', '2Từ vựngBỏ price.']);
  });

  it('a mark without a note still says its kind', () => {
    const { container } = render(<AnnotatedText segments={[{ text: 'very good', mark: 4 }]} notes={[]} />);
    expect(container.querySelector('p[lang="en"]')!.textContent).toBe('very good (Làm tốt)');
  });

  it('with onSelect the margin numbers are toggle buttons', () => {
    const onSelect = vi.fn();
    render(<AnnotatedText segments={segments} notes={notes} selected={2} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Chú thích 2, Từ vựng' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Chú thích 1, Ngữ pháp' }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

describe('Figure', () => {
  it('the drawing is one image named by alt; number, caption and source follow', () => {
    render(
      <Figure number="Hình 9.1" caption="Mở bài cần ba việc." alt="Ba bước mở bài Task 2" source="Aver Learning biên soạn.">
        <svg><text>1 Viết lại đề</text></svg>
      </Figure>,
    );
    const figure = screen.getByRole('figure');
    expect(within(figure).getByRole('img', { name: 'Ba bước mở bài Task 2' })).toBeTruthy();
    expect(within(figure).queryByText('1 Viết lại đề')?.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(figure.querySelector('figcaption')!.textContent).toBe('Hình 9.1. Mở bài cần ba việc.Nguồn: Aver Learning biên soạn.');
  });

  it('without a drawing it is a labelled placeholder, not an empty image', () => {
    render(<Figure caption="Chú thích viết trước." alt="quy trình tái chế" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('[MINH HOẠ: quy trình tái chế]')).toBeTruthy();
  });
});
