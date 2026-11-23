// EXAMROOM-0066 T004 (G08-T05) FR-028, FR-029: the exam room only maps `policy`
// onto G03's AudioPlayer.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { audioPropsForPolicy, ExamRoomAudioPlayer } from '@/components/exam-room/audio-player';

afterEach(() => cleanup());

const VIETNAMESE = /[À-ÿĂăĐđĨĩŨũƠơƯưẠ-ỹ]/;

describe('policy mapping', () => {
  it('practice: practice mode with the space key', () => {
    expect(audioPropsForPolicy('practice')).toEqual({ variant: 'full', mode: 'practice', lang: 'vi', spaceToggles: true });
    expect(audioPropsForPolicy('practice', 'compact', 'vi', false).spaceToggles).toBe(false);
  });
  it('test: exam mode, English, no space key', () => {
    expect(audioPropsForPolicy('test', 'phone', 'vi')).toEqual({ variant: 'phone', mode: 'exam', lang: 'en', spaceToggles: false });
  });
  it('once: the once variant whatever the layout', () => {
    expect(audioPropsForPolicy('once', 'compact')).toEqual({ variant: 'once', mode: 'exam', lang: 'vi', spaceToggles: false });
  });
});

describe('ExamRoomAudioPlayer', () => {
  it('test policy draws no pause, seek or speed and is English only', () => {
    const { container } = render(
      <ExamRoomAudioPlayer policy="test" state="ready" title="Booking a room" current={0} duration={222} onPlay={vi.fn()} onPause={vi.fn()} onSeek={vi.fn()} onSpeed={vi.fn()} />,
    );
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('button', { name: /0,75|1,25|1,5/ })).toBeNull();
    expect(container.textContent).not.toMatch(VIETNAMESE);
  });

  it('practice policy keeps the practice controls', () => {
    render(<ExamRoomAudioPlayer policy="practice" state="paused" title="Track" current={30} duration={222} onPlay={vi.fn()} onSeek={vi.fn()} onSpeed={vi.fn()} />);
    expect(screen.getByRole('slider')).toBeTruthy();
  });

  it('once: warning before playing; playback start is reported once, before onPlay', () => {
    const calls: string[] = [];
    const { rerender } = render(
      <ExamRoomAudioPlayer policy="once" state="ready" title="Track" current={0} duration={222} onPlaybackStart={() => calls.push('start')} onPlay={() => calls.push('play')} />,
    );
    expect(screen.getByText('Bài này chỉ được nghe một lần')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu nghe' }));
    rerender(<ExamRoomAudioPlayer policy="once" state="ready" title="Track" current={0} duration={222} resumeAt={72} onPlaybackStart={() => calls.push('start')} onPlay={() => calls.push('play')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nghe tiếp từ 1:12' }));
    expect(calls).toEqual(['start', 'play', 'play']);
  });

  it('once never shows a pause control while playing', () => {
    render(<ExamRoomAudioPlayer policy="once" state="playing" title="Track" current={40} duration={222} onPlay={vi.fn()} onPause={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Tạm dừng|Pause/ })).toBeNull();
  });
});
