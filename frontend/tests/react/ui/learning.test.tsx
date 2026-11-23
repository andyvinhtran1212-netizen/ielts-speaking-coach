// UIBASE-0056 G03-T09 (FR-005): BandScore (+CriteriaList, OverallBlock), Timer,
// QuestionPalette, VocabEntry, AnnotatedText, Figure. Behaviour only: roles,
// names, text, aria-*; no class selectors.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activeThreshold, AnnotatedText, BAND_DISCLAIMER, BandScore, compareSentence, Figure, formatClock, ieltsOverall,
  OverallBlock, paletteSummary, QuestionPalette, questionCellName, Timer, VocabEntry, type QuestionItem,
} from '@/components/ui';

afterEach(cleanup);

describe('BandScore', () => {
  it('a ready band always carries the disclaimer and its basis', () => {
    render(<BandScore skill="Writing Task 2" band={6} basis="Dựa trên 1 bài, 268 từ" />);
    expect(screen.getByLabelText('Band ước lượng · Writing Task 2: 6.0').textContent).toBe('6.0');
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
  const four = [{ name: 'Listening', band: 6.5 }, { name: 'Reading', band: 7 }, { name: 'Writing', band: 6 }, { name: 'Speaking', band: 6 }];

  it('rounds the mean to the nearest half band, a quarter up', () => {
    expect(ieltsOverall([6.5, 7, 6, 6])).toBe(6.5); // 6.375
    expect(ieltsOverall([6, 6, 6, 6.5])).toBe(6); // 6.125
    expect(ieltsOverall([6, 6, 6.5, 6.5])).toBe(6.5); // 6.25
    expect(ieltsOverall([7, 7, 7, 6])).toBe(7); // 6.75
  });

  it('shows a number only when all four skills are in', () => {
    const { rerender, container } = render(<OverallBlock skills={four} />);
    expect(screen.getByLabelText('Overall ước lượng: 6.5')).toBeTruthy();
    rerender(<OverallBlock skills={[...four.slice(0, 3), { name: 'Speaking', band: null }]} missing={['Speaking']} />);
    expect(screen.queryByLabelText(/Overall ước lượng:/)).toBeNull();
    expect(screen.getByText('Chưa có Overall · Speaking đang chấm')).toBeTruthy();
    expect(container.textContent).toContain(BAND_DISCLAIMER);
    rerender(<OverallBlock skills={four.slice(0, 3)} />);
    expect(screen.queryByLabelText(/Overall ước lượng:/)).toBeNull();
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
    render(<QuestionPalette lang="en" title="Part 1 · Questions 1–4" items={items} />);
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
    expect(screen.getByRole('button', { name: 'Câu 2, sai' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Câu 3, bỏ trống' })).toBeTruthy();
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
