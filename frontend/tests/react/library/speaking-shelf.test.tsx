// LIBRARY-0061 T013: Speaking shelf (FR-030 filters, FR-032 no autoplay,
// FR-033 active line + seek + broken media, FR-034 marks, FR-036 voice label).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpeakingAnswer } from '@/app/(public-library)/library/speaking/[slug]/speaking-answer';
import { speakingSections } from '@/app/(public-library)/library/speaking/[slug]/speaking-sections';
import type { SpeakingDetail, TranscriptLine } from '@/app/(public-library)/library/speaking/speaking-data';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const LINES: TranscriptLine[] = [
  { start_ms: 0, text: 'My hometown is a small city by the sea.', marks: [{ kind: 'vocab', start: 23, end: 38, note: 'ven biển' }] },
  { start_ms: 2500, text: 'As for why I like it, life is slow.', marks: [{ kind: 'structure', start: 0, end: 10, note: 'mở ý' }] },
  { start_ms: 5000, text: 'I go back every summer.', marks: [] },
];

const sections = {
  playerSection: { id: 'tra-loi-mau', n: '2', label: 'Câu trả lời mẫu' },
  transcriptSection: { id: 'loi-thoai', n: '3', label: 'Lời thoại và ghi chú' },
};

function renderAudio(transcript = LINES, timed = true) {
  return render(
    <SpeakingAnswer
      slug="hometown-part-1"
      title="Hometown"
      source={{ kind: 'audio', url: 'https://api.example/api/library/media/speaking-sample/hometown-part-1/audio' }}
      durationS={8}
      transcript={transcript}
      timed={timed}
      {...sections}
    />,
  );
}

let play: ReturnType<typeof vi.fn>;

beforeEach(() => {
  play = vi.fn(() => Promise.resolve());
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: vi.fn() });
  replace.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SpeakingAnswer', () => {
  it('never plays by itself and always prints the synthetic-voice label', () => {
    renderAudio();
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByText('Giọng đọc tổng hợp')).toBeTruthy();
    expect(document.querySelector('audio')?.getAttribute('preload')).toBe('none');
  });

  it('highlights the line with the largest start not after the time, and a press seeks and plays', () => {
    renderAudio();
    const audio = document.querySelector('audio') as HTMLAudioElement;
    act(() => {
      audio.currentTime = 3;
      fireEvent.timeUpdate(audio);
    });
    const current = document.querySelector('li[aria-current="true"]');
    expect(current?.textContent).toContain('As for why');
    expect(screen.getByText(/Đang ở 0:03 · câu 2/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Tua tới 0:05/ }));
    expect(audio.currentTime).toBe(5);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('a media error turns the times into plain text with a notice', () => {
    renderAudio();
    expect(screen.getAllByRole('button', { name: /Tua tới/ })).toHaveLength(3);
    act(() => { fireEvent.error(document.querySelector('audio') as HTMLAudioElement); });
    expect(screen.queryAllByRole('button', { name: /Tua tới/ })).toHaveLength(0);
    expect(screen.getByText(/tạm tắt tua theo câu/)).toBeTruthy();
    expect(screen.getByText('0:02')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thử phát lại' })).toBeTruthy();
  });

  it('marks carry a number and a word label in the margin, numbered across the page', () => {
    renderAudio();
    const marks = document.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe('city by the sea1');
    expect(marks[1].textContent).toBe('As for why2');
    expect(screen.getByText('Từ vựng đáng học')).toBeTruthy();
    expect(screen.getByText('Cấu trúc đáng học')).toBeTruthy();
  });

  it('without media: no player section and no seek buttons, transcript is in the server HTML', () => {
    const untimed = LINES.map((l) => ({ ...l, start_ms: null }));
    const html = renderToStaticMarkup(
      <SpeakingAnswer slug="t" title="T" source={null} durationS={null} transcript={untimed} timed={false}
        playerSection={null} transcriptSection={sections.transcriptSection} />,
    );
    expect(html).toContain('I go back every summer.');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Câu trả lời mẫu');
  });
});

describe('speakingSections', () => {
  const base = {
    part: 1, answer_kind: 'text', cue_card: { questions: ['Q?'] }, outline: [], vocabulary: [], related_part3: [],
  } as unknown as SpeakingDetail;

  it('leaves out empty sections so the numbers have no gaps', () => {
    expect(speakingSections(base, false).map((s) => s.label)).toEqual(['Câu hỏi', 'Lời thoại và ghi chú', 'Luyện nói đề này']);
    const part2 = { ...base, part: 2, answer_kind: 'video', cue_card: { prompt: 'Describe…' }, outline: ['a'], related_part3: ['b'] } as unknown as SpeakingDetail;
    expect(speakingSections(part2, true).map((s) => s.label)).toEqual([
      'Thẻ đề', 'Video trả lời mẫu', 'Lời thoại và ghi chú', 'Dàn ý trả lời', 'Câu hỏi Part 3 liên quan', 'Luyện nói đề này',
    ]);
  });
});

describe('SpeakingFilters (FR-030)', () => {
  async function setup(filters = { part: '2', chude: null, video: false, q: '' }) {
    const { SpeakingFilters } = await import('@/app/(public-library)/library/speaking/speaking-filters');
    render(<SpeakingFilters filters={filters} />);
  }

  it('part links keep the other filters; the video switch replaces the URL', async () => {
    await setup({ part: '2', chude: 'places', video: false, q: 'city' });
    expect(screen.getByRole('link', { name: 'Part 3' }).getAttribute('href')).toBe('/library/speaking?part=3&chude=places&q=city');
    expect(screen.getByRole('link', { name: 'Part 2' }).getAttribute('aria-current')).toBe('true');
    const toggle = screen.getByRole('switch', { name: 'Chỉ đề có video trả lời mẫu' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(replace).toHaveBeenCalledWith('/library/speaking?part=2&chude=places&video=1&q=city', { scroll: false });
  });

  it('search replaces the URL 300 ms after typing stops', async () => {
    vi.useFakeTimers();
    await setup();
    fireEvent.change(screen.getByLabelText('Tìm đề'), { target: { value: 'zo' } });
    fireEvent.change(screen.getByLabelText('Tìm đề'), { target: { value: 'zoo' } });
    act(() => { vi.advanceTimersByTime(299); });
    expect(replace).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/library/speaking?part=2&q=zoo', { scroll: false });
  });
});
