import { renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useListeningDrillPlayback } from '@/lib/listening-drill-playback';

afterEach(() => { vi.restoreAllMocks(); });

test('counts actual starts and omits pauses, seeks and buffering from assignment playback', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const postWith = vi.fn().mockResolvedValue(null);
  const api = window.api;
  window.api = { ...api, postWith };
  const audio = Object.assign(new EventTarget(), {
    paused: true, currentTime: 0, readyState: 4, playbackRate: 1, seeking: false,
  });
  const { result, unmount } = renderHook(() => useListeningDrillPlayback(
    'assigned-attempt', 'listening', true, () => audio as unknown as HTMLMediaElement,
  ));
  const emit = (type: string) => audio.dispatchEvent(new Event(type));
  try {
    emit('play');
    await result.current.current();
    expect(postWith.mock.lastCall?.[1]).toMatchObject({ plays: 0, played_ms: 0 });

    audio.paused = false;
    emit('playing');
    now = 2000; audio.currentTime = 2;
    emit('timeupdate');
    emit('waiting');
    now = 5000;
    emit('playing');
    now = 6000; audio.currentTime = 3;
    emit('timeupdate');
    audio.seeking = true;
    emit('seeking');
    audio.currentTime = 20;
    audio.seeking = false;
    emit('seeked');
    now = 7000; audio.currentTime = 21;
    audio.paused = true;
    emit('pause');
    now = 10000;
    audio.paused = false;
    emit('playing');
    now = 11000; audio.currentTime = 22;
    await result.current.current();

    expect(postWith.mock.lastCall?.[0]).toBe('/api/listening/skill-drill-playback/assigned-attempt');
    expect(postWith.mock.lastCall?.[1]).toMatchObject({ stage: 'listening', plays: 2, played_ms: 5000 });
    expect(postWith.mock.lastCall?.[1].page_id).toBe(postWith.mock.calls[0][1].page_id);
  } finally {
    unmount();
    window.api = api;
  }
});
