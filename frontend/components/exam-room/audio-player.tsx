'use client';

// EXAMROOM-0066 FR-028, FR-029: the exam room's audio is G03's AudioPlayer
// (UIBASE-0056 #31). This file only maps the surface's `policy` onto its props;
// it draws no player and never creates <audio> (the surface keeps its element).
//   practice → mode 'practice' + spaceToggles (one player per page)
//   test     → mode 'exam', English labels (FR-002, open question 9)
//   once     → variant 'once' (warning in the player, no pause/seek/replay)
import { useEffect, useRef } from 'react';

import { AudioPlayer, type AudioPlayerProps } from '../ui/audio-player';

export type ExamRoomAudioPolicy = 'practice' | 'test' | 'once';

export type ExamRoomAudioPlayerProps = Omit<AudioPlayerProps, 'mode' | 'variant' | 'lang' | 'spaceToggles'> & {
  policy: ExamRoomAudioPolicy;
  /** Full, compact and phone draw one shared state; `once` ignores this. */
  layout?: 'full' | 'compact' | 'phone';
  /** `once` in practice is Vietnamese; `test` is always English. */
  lang?: 'vi' | 'en';
  /**
   * The surface records that playback began (e.g. its "heard once" call). Called
   * on the first play of each track (by `title`), before `onPlay`; give the
   * player a `key` when two tracks share a title.
   */
  onPlaybackStart?: () => void;
  /** `once` after a dropped connection: "Nghe tiếp từ [mm:ss]" plays on from here. */
  resumeAt?: number;
  /** False when another `practice` player on the page owns the space key. */
  ownsSpaceKey?: boolean;
};

/** The AudioPlayer props for a policy; exported for tests. */
export function audioPropsForPolicy(policy: ExamRoomAudioPolicy, layout: 'full' | 'compact' | 'phone' = 'full', lang?: 'vi' | 'en', ownsSpaceKey = true) {
  if (policy === 'once') return { variant: 'once' as const, mode: 'exam' as const, lang: lang ?? 'vi', spaceToggles: false };
  if (policy === 'test') return { variant: layout, mode: 'exam' as const, lang: 'en' as const, spaceToggles: false };
  return { variant: layout, mode: 'practice' as const, lang: lang ?? 'vi', spaceToggles: ownsSpaceKey };
}

export function ExamRoomAudioPlayer({ policy, layout = 'full', lang, onPlaybackStart, resumeAt, ownsSpaceKey = true, onPlay, current, state, ...rest }: ExamRoomAudioPlayerProps) {
  const started = useRef(false);
  // A new track in the same player reports its own first play.
  useEffect(() => { started.current = false; }, [rest.title]);
  const mapped = audioPropsForPolicy(policy, layout, lang, ownsSpaceKey);
  const play = () => {
    if (!started.current) {
      started.current = true;
      onPlaybackStart?.();
    }
    onPlay?.();
  };
  // Before playback resumes, `once` shows where it will start from.
  const shownCurrent = policy === 'once' && resumeAt != null && resumeAt > current && state !== 'playing' ? resumeAt : current;
  return (
    <AudioPlayer
      {...rest}
      {...mapped}
      state={state}
      current={shownCurrent}
      // A restricted track never pauses, seeks or changes speed, whatever the surface passes.
      onPause={mapped.mode === 'exam' ? undefined : rest.onPause}
      onSeek={mapped.mode === 'exam' ? undefined : rest.onSeek}
      onSpeed={mapped.mode === 'exam' ? undefined : rest.onSpeed}
      onSetA={mapped.mode === 'exam' ? undefined : rest.onSetA}
      onSetB={mapped.mode === 'exam' ? undefined : rest.onSetB}
      onClearLoop={mapped.mode === 'exam' ? undefined : rest.onClearLoop}
      onPlay={play}
    />
  );
}
