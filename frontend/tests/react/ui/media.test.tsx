// UIBASE-0056 G03-T10 (FR-005): AudioPlayer (#31) and VideoFrame (#32), ThanhPhanHocTap §2–3.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AudioPlayer, formatMediaTime, formatSpeed, safeYoutubeEmbed, VideoFrame } from '@/components/ui';

afterEach(cleanup);

const TRACK = 'Booking a room at the sports centre';

describe('formatMediaTime / formatSpeed', () => {
  it('writes minutes:seconds, pads for video, adds hours, reads bad input as 0', () => {
    expect(formatMediaTime(72)).toBe('1:12');
    expect(formatMediaTime(372, { padMinutes: true })).toBe('06:12');
    expect(formatMediaTime(3725)).toBe('1:02:05');
    expect(formatMediaTime(-3)).toBe('0:00');
    expect(formatMediaTime(Number.NaN)).toBe('0:00');
    expect(formatSpeed(0.75)).toBe('0,75×');
    expect(formatSpeed(1)).toBe('1×');
  });
});

describe('AudioPlayer — practice, full', () => {
  it('Play always carries its word; seek ±5 s clamps to the track', () => {
    const onPlay = vi.fn();
    const onSeek = vi.fn();
    render(<AudioPlayer state="paused" title={TRACK} current={3} duration={222} onPlay={onPlay} onSeek={onSeek} />);
    fireEvent.click(screen.getByRole('button', { name: 'Phát' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Lùi 5 giây' }));
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Tới 5 giây' }));
    expect(onSeek).toHaveBeenLastCalledWith(8);
    expect(screen.getByText('0:03 / 3:42')).toBeTruthy();
    expect(screen.getByText(TRACK).getAttribute('lang')).toBe('en');
  });

  it('playing shows "Tạm dừng"; the range is named and reports position in words', () => {
    const onPause = vi.fn();
    const onSeek = vi.fn();
    render(<AudioPlayer state="playing" title={TRACK} current={72} duration={222} onPause={onPause} onSeek={onSeek} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    expect(onPause).toHaveBeenCalledTimes(1);
    const range = screen.getByRole('slider', { name: 'Vị trí trong bài nghe' });
    expect(range.getAttribute('aria-valuetext')).toBe('1:12 trên 3:42');
    fireEvent.change(range, { target: { value: '100' } });
    expect(onSeek).toHaveBeenLastCalledWith(100);
  });

  it('speed buttons are pressed toggles; A–B group sets, shows and clears the loop', () => {
    const onSpeed = vi.fn();
    const onSetB = vi.fn();
    const onClearLoop = vi.fn();
    const { rerender } = render(
      <AudioPlayer state="paused" title={TRACK} current={50} duration={222} speed={1} onSpeed={onSpeed} />,
    );
    const speeds = within(screen.getByRole('group', { name: 'Tốc độ phát' })).getAllByRole('button');
    expect(speeds.map((b) => b.textContent)).toEqual(['0,75×', '1×', '1,25×', '1,5×']);
    expect(speeds.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
    fireEvent.click(speeds[3]);
    expect(onSpeed).toHaveBeenCalledWith(1.5);

    const loopGroup = () => screen.getByRole('group', { name: 'Lặp đoạn A–B' });
    expect((within(loopGroup()).getByRole('button', { name: 'Đặt B' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(loopGroup()).queryByRole('button', { name: 'Bỏ lặp' })).toBeNull();

    rerender(<AudioPlayer state="paused" title={TRACK} current={50} duration={222} loop={{ a: 42 }} onSetB={onSetB} onClearLoop={onClearLoop} />);
    fireEvent.click(within(loopGroup()).getByRole('button', { name: 'Đặt B' }));
    expect(onSetB).toHaveBeenCalledTimes(1);

    rerender(<AudioPlayer state="paused" title={TRACK} current={50} duration={222} loop={{ a: 42, b: 65 }} onClearLoop={onClearLoop} />);
    expect(within(loopGroup()).getByRole('status').textContent).toBe('Đang lặp 0:42–1:05');
    fireEvent.click(within(loopGroup()).getByRole('button', { name: 'Bỏ lặp' }));
    expect(onClearLoop).toHaveBeenCalledTimes(1);
  });

  it('Space toggles only when asked, and never while typing in a field', () => {
    const onPlay = vi.fn();
    render(
      <>
        <input aria-label="Câu 1" />
        <AudioPlayer state="paused" title={TRACK} current={0} duration={222} onPlay={onPlay} spaceToggles />
      </>,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Câu 1' }), { key: ' ' });
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('without spaceToggles the page Space key is left alone', () => {
    const onPlay = vi.fn();
    render(<AudioPlayer state="paused" title={TRACK} current={0} duration={222} onPlay={onPlay} />);
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(onPlay).not.toHaveBeenCalled();
  });
});

describe('AudioPlayer — phone and compact', () => {
  it('phone: skip buttons are icon-only but named; A–B and speed cycle in one button each', () => {
    const onSetA = vi.fn();
    const onSpeed = vi.fn();
    const onClearLoop = vi.fn();
    const { rerender } = render(
      <AudioPlayer variant="phone" state="paused" title="Booking a room" current={10} duration={222} speed={1.5} onSetA={onSetA} onSpeed={onSpeed} />,
    );
    expect(screen.getByRole('button', { name: 'Lùi 5 giây' }).textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Phát' }).textContent).toBe('Phát');
    fireEvent.click(screen.getByRole('button', { name: 'Lặp đoạn: bấm để đặt A' }));
    expect(onSetA).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tốc độ 1,5×. Bấm để đổi sang 0,75×' }));
    expect(onSpeed).toHaveBeenCalledWith(0.75);
    rerender(
      <AudioPlayer variant="phone" state="paused" title="Booking a room" current={10} duration={222} loop={{ a: 42, b: 65 }} onClearLoop={onClearLoop} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Đang lặp 0:42–1:05. Bấm để bỏ lặp' }));
    expect(onClearLoop).toHaveBeenCalledTimes(1);
  });

  it('compact: one named play button, no seek control', () => {
    const onPause = vi.fn();
    render(<AudioPlayer variant="compact" state="playing" title={TRACK} current={72} duration={222} onPause={onPause} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tạm dừng' }));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('AudioPlayer — exam, once, loading, error, locked', () => {
  it('exam mode has no pause, seek, speed or A–B', () => {
    render(<AudioPlayer mode="exam" state="playing" title={TRACK} current={72} duration={222} />);
    expect(screen.getByRole('status').textContent).toBe('Đang phát · không tạm dừng được');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('Space never pauses an exam track', () => {
    const onPause = vi.fn();
    render(<AudioPlayer mode="exam" state="playing" title={TRACK} current={72} duration={222} onPause={onPause} spaceToggles />);
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(onPause).not.toHaveBeenCalled();
  });

  it('once: says it plays one time before starting, then locks with the word "đã khoá"', () => {
    const onPlay = vi.fn();
    const { rerender } = render(<AudioPlayer variant="once" state="ready" title={TRACK} current={0} duration={222} onPlay={onPlay} />);
    expect(screen.getByText('Bài này chỉ được nghe một lần')).toBeTruthy();
    expect(screen.getByText(/Dài 3:42\. Không tạm dừng/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu nghe' }));
    expect(onPlay).toHaveBeenCalledTimes(1);

    rerender(<AudioPlayer variant="once" state="locked" title={TRACK} current={222} duration={222} />);
    const locked = screen.getByRole('button', { name: 'Đã nghe · đã khoá' }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    expect(screen.getByText('3:42 / 3:42')).toBeTruthy();
  });

  it('loading keeps Play disabled and says so', () => {
    render(<AudioPlayer state="loading" title={TRACK} current={0} duration={0} />);
    expect((screen.getByRole('button', { name: 'Phát' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Đang tải bài nghe…');
    expect(screen.getByText('--:-- / --:--')).toBeTruthy();
  });

  it('error says answers are kept and where it resumes; retry calls back', () => {
    const onRetry = vi.fn();
    render(<AudioPlayer state="error" title={TRACK} current={72} duration={222} stoppedAt={72} onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Câu trả lời bạn đã nhập vẫn còn.');
    expect(alert.textContent).toContain('Tải lại sẽ phát tiếp từ 1:12.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Tải lại bài nghe' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('never creates an <audio> element (presentation only)', () => {
    const { container } = render(<AudioPlayer state="playing" title={TRACK} current={1} duration={2} />);
    expect(container.querySelector('audio')).toBeNull();
  });
});

describe('VideoFrame', () => {
  it('safeYoutubeEmbed keeps only https no-cookie embeds and drops autoplay', () => {
    expect(safeYoutubeEmbed('https://www.youtube-nocookie.com/embed/abc?autoplay=1&rel=0')).toBe(
      'https://www.youtube-nocookie.com/embed/abc?rel=0',
    );
    expect(safeYoutubeEmbed('https://www.youtube.com/embed/abc')).toBeNull();
    expect(safeYoutubeEmbed('http://www.youtube-nocookie.com/embed/abc')).toBeNull();
    expect(safeYoutubeEmbed('https://www.youtube-nocookie.com/watch?v=abc')).toBeNull();
    expect(safeYoutubeEmbed('not a url')).toBeNull();
    expect(safeYoutubeEmbed(undefined)).toBeNull();
  });

  it('YouTube: the iframe is titled, has no autoplay, and links out in a new tab', () => {
    render(
      <VideoFrame
        source="youtube"
        state="idle"
        title="Bài 14 · Hoà hợp chủ ngữ và động từ"
        embedUrl="https://www.youtube-nocookie.com/embed/abc?autoplay=1"
        watchUrl="https://www.youtube.com/watch?v=abc"
      />,
    );
    expect(screen.getByText('Video · YouTube')).toBeTruthy();
    const frame = screen.getByTitle('Bài 14 · Hoà hợp chủ ngữ và động từ');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc');
    const out = screen.getByRole('link', { name: 'Xem trên YouTube' });
    expect(out.getAttribute('target')).toBe('_blank');
    expect(out.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('YouTube with a cookie URL falls back to the placeholder, never an iframe', () => {
    const { container } = render(
      <VideoFrame source="youtube" state="idle" title="Bài 14" embedUrl="https://www.youtube.com/embed/abc" />,
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('[TRÌNH PHÁT YOUTUBE NHÚNG]')).toBeTruthy();
  });

  it('self, idle with a saved position: resume or restart, in words', () => {
    const onPlay = vi.fn();
    const onRestart = vi.fn();
    render(<VideoFrame source="self" state="idle" title="Bài 14" resumeAt={372} onPlay={onPlay} onRestart={onRestart} transcriptHref="/t" />);
    expect(screen.getByText('Video · Aver Learning')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xem tiếp từ 06:12' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xem từ đầu' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Đọc bản chữ của video' }).getAttribute('href')).toBe('/t');
  });

  it('self, playing renders the page player; never creates its own <video>', () => {
    const { container, rerender } = render(<VideoFrame source="self" state="playing" title="Bài 14" />);
    expect(container.querySelector('video')).toBeNull();
    rerender(<VideoFrame source="self" state="playing" title="Bài 14"><div data-testid="page-player" /></VideoFrame>);
    expect(screen.getByTestId('page-player')).toBeTruthy();
  });

  it('loading, error and locked say their state in words', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<VideoFrame source="self" state="loading" title="Bài 15" />);
    expect(screen.getByRole('status').textContent).toBe('Đang tải video…');

    rerender(<VideoFrame source="self" state="error" title="Bài 15" resumeAt={372} onRetry={onRetry} />);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Thử phát lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Vị trí 06:12 vẫn được giữ.')).toBeTruthy();

    rerender(<VideoFrame source="self" state="locked" title="Bài 22" lockedCourse="Writing 6.5" lockedHref="/courses/w65" />);
    expect(screen.getByText(/Đã khoá · video thuộc khoá Writing 6\.5/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Xem khoá Writing 6.5' }).getAttribute('href')).toBe('/courses/w65');
  });

  it('locked without a course name prints XXX, never a made-up name', () => {
    render(<VideoFrame source="self" state="locked" title="Bài 22" />);
    expect(screen.getByText('XXX')).toBeTruthy();
  });
});
