import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VocabularyAudioButton } from '@/components/vocabulary-audio-button';

const instances: FakeAudio[] = [];
class FakeAudio {
  static nextPlay: Promise<void> | null = null;
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  constructor(public src: string) {
    if (FakeAudio.nextPlay) { const pending = FakeAudio.nextPlay; this.play.mockImplementation(() => pending); FakeAudio.nextPlay = null; }
    instances.push(this);
  }
}
beforeEach(() => { instances.length = 0; FakeAudio.nextPlay = null; vi.stubGlobal('Audio', FakeAudio); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('stops the example before playing the word without flipping the card', async () => {
  const flip = vi.fn();
  render(<div onClick={flip}><VocabularyAudioButton url="https://audio/example.mp3" label="Ví dụ" /><VocabularyAudioButton url="https://audio/word.mp3" label="Từ" /></div>);
  fireEvent.click(screen.getByRole('button', { name: 'Ví dụ' }));
  await waitFor(() => expect(instances[0].paused).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Từ' }));
  expect(instances[0].paused).toBe(true);
  expect(instances[1].paused).toBe(false);
  expect(screen.getByRole('button', { name: 'Ví dụ' }).getAttribute('aria-pressed')).toBe('false');
  expect(flip).not.toHaveBeenCalled();
});

it('stops pronunciation on card change and route unmount', async () => {
  const view = render(<VocabularyAudioButton url="https://audio/first.mp3" label="Từ" />);
  fireEvent.click(screen.getByRole('button')); await act(async () => {});
  view.rerender(<VocabularyAudioButton url="https://audio/second.mp3" label="Từ" />);
  expect(instances[0].paused).toBe(true);
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button')); await act(async () => {});
  view.unmount(); expect(instances[1].paused).toBe(true);
});

it('ignores a late playback rejection from the previous card', async () => {
  let reject!: (error: Error) => void;
  render(<><VocabularyAudioButton url="https://audio/old.mp3" label="Cũ" /><VocabularyAudioButton url="https://audio/new.mp3" label="Mới" /></>);
  const pending = new Promise<void>((_, no) => { reject = no; });
  FakeAudio.nextPlay = pending;
  // A browser may reject play() after the user has already selected another clip.
  fireEvent.click(screen.getByRole('button', { name: 'Cũ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mới' }));
  await act(async () => { reject(new Error('stale media')); });
  expect(instances.at(-1)?.paused).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('shows a recoverable error when a recording fails without changing voices', async () => {
  render(<VocabularyAudioButton url="https://audio/broken.mp3" label="Nghe" />);
  fireEvent.click(screen.getByRole('button')); await act(async () => {});
  act(() => instances[0].onerror?.());
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button')); await act(async () => {});
  expect(instances).toHaveLength(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps missing recordings unavailable without synthesizing a different voice', () => {
  const speak = vi.fn(); vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
  render(<VocabularyAudioButton say="A newly added word" label="Nghe" />);
  expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('Audio đang được chuẩn bị.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button'));
  expect(instances).toHaveLength(0); expect(speak).not.toHaveBeenCalled();
});

it('never falls back to browser speech on a failed recording and stops on pagehide', async () => {
  const speak = vi.fn(); vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
  render(<VocabularyAudioButton url="https://audio/word.mp3" say="Word" label="Nghe" />);
  fireEvent.click(screen.getByRole('button')); await act(async () => {});
  act(() => instances[0].onerror?.());
  await screen.findByRole('alert'); expect(speak).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button')); await act(async () => {});
  act(() => window.dispatchEvent(new Event('pagehide')));
  expect(instances[1].paused).toBe(true);
});
