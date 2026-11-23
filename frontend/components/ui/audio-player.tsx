'use client';

import { useEffect, type ReactNode } from 'react';

import styles from './audio-player.module.css';
import { cx } from './cx';
import { Icon } from './icon/icon';
import { formatMediaTime, formatSpeed } from './media-time';

export type AudioPlayerVariant = 'full' | 'compact' | 'phone' | 'once';
export type AudioPlayerState = 'loading' | 'ready' | 'playing' | 'paused' | 'error' | 'locked';
export type AudioPlayerMode = 'practice' | 'exam';
export type AudioLoop = { a?: number; b?: number };
export type AudioPlayerLang = 'vi' | 'en';

export type AudioPlayerProps = {
  /**
   * `full`: practice Listening. `compact`: one line, sticky above questions
   * (the consumer positions it). `phone`: the 390px layout. `once`: a mock
   * exam track that is heard one time and then locked.
   */
  variant?: AudioPlayerVariant;
  state: AudioPlayerState;
  /** Track name, English content ("Booking a room at the sports centre"). */
  title: string;
  /** Seconds. */
  current: number;
  /** Seconds. */
  duration: number;
  /** Current speed, one of `speeds`. */
  speed?: number;
  /** Practice speeds, 0,75× to 1,5× (HocTap §2). */
  speeds?: readonly number[];
  /** A–B loop points in seconds (practice only). */
  loop?: AudioLoop;
  /**
   * `exam` (full test, mini test, assigned mock test) and the `once` variant
   * have no pause, seek, speed or A–B controls.
   */
  mode?: AudioPlayerMode;
  /** Where the track stopped when loading failed, for the error text. */
  stoppedAt?: number;
  /**
   * Locked: what happens next, e.g. "Nộp xong sẽ mở lời thoại và cho nghe
   * lại." Only the page knows, so nothing is promised by default.
   */
  lockedNote?: ReactNode;
  /** Every default label is English when `lang='en'` (an English exam layout, plan 0056 §5.4). */
  lang?: AudioPlayerLang;
  /**
   * Space plays or pauses while focus is not in a field. Practice only: in
   * `exam` mode and the `once` variant the key does nothing, so a stray press
   * never starts a track that is heard one time. Turn it on for one player
   * per page only (full, compact and phone share one state).
   */
  spaceToggles?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (seconds: number) => void;
  onSpeed?: (speed: number) => void;
  onSetA?: () => void;
  onSetB?: () => void;
  onClearLoop?: () => void;
  onRetry?: () => void;
  className?: string;
};

const DEFAULT_SPEEDS = [0.75, 1, 1.25, 1.5] as const;
const SKIP_SECONDS = 5;

type Words = {
  track: string;
  play: string;
  pause: string;
  loading: string;
  loadingNote: string;
  errorHead: string;
  stopped: (at: string) => string;
  kept: string;
  resumeFrom: (at: string) => string;
  retryHint: string;
  retry: string;
  locked: string;
  lockedKeep: string;
  onceHead: string;
  onceBody: (length: string) => string;
  onceStart: string;
  onceResume: (at: string) => string;
  examNote: string;
  noPause: string;
  playingShort: string;
  seek: string;
  of: string;
  back: string;
  forward: string;
  seconds: string;
  loopGroup: string;
  loopName: string;
  setA: string;
  setB: string;
  looping: (a: string, b: string) => string;
  clearLoop: string;
  phoneLoop: (a: string, b: string) => string;
  phoneSetB: (a: string) => string;
  phoneSetA: string;
  speedGroup: string;
  speedName: string;
  speedCycle: (now: string, next: string) => string;
};

const WORDS: Record<AudioPlayerLang, Words> = {
  vi: {
    track: 'Bài nghe · ',
    play: 'Phát',
    pause: 'Tạm dừng',
    loading: 'Đang tải bài nghe…',
    loadingNote: 'Bạn đọc câu hỏi trước trong lúc chờ. Nút Phát mở khi tải xong.',
    errorHead: 'Chưa tải được bài nghe',
    stopped: (at) => `Bài nghe dừng ở phút ${at}. `,
    kept: 'Câu trả lời bạn đã nhập vẫn còn.',
    resumeFrom: (at) => ` Tải lại sẽ phát tiếp từ ${at}.`,
    retryHint: ' Tải lại để nghe tiếp.',
    retry: 'Tải lại bài nghe',
    locked: 'Đã nghe · đã khoá',
    lockedKeep: 'Bạn vẫn sửa được câu trả lời tới khi nộp.',
    onceHead: 'Bài này chỉ được nghe một lần',
    onceBody: (length) => `Dài ${length}. Không tạm dừng, không tua, không đổi tốc độ. Hãy đọc xong câu hỏi rồi mới bắt đầu.`,
    onceStart: 'Bắt đầu nghe',
    onceResume: (at) => `Nghe tiếp từ ${at}`,
    examNote: 'Bài thi: không tạm dừng, không tua, không đổi tốc độ.',
    noPause: 'Đang phát · không tạm dừng được',
    playingShort: 'Đang phát',
    seek: 'Vị trí trong bài nghe',
    of: 'trên',
    back: 'Lùi',
    forward: 'Tới',
    seconds: 'giây',
    loopGroup: 'Lặp đoạn A–B',
    loopName: 'Lặp đoạn',
    setA: 'Đặt A',
    setB: 'Đặt B',
    looping: (a, b) => `Đang lặp ${a}–${b}`,
    clearLoop: 'Bỏ lặp',
    phoneLoop: (a, b) => `Đang lặp ${a}–${b}. Bấm để bỏ lặp`,
    phoneSetB: (a) => `Đã đặt A ở ${a}. Bấm để đặt B`,
    phoneSetA: 'Lặp đoạn: bấm để đặt A',
    speedGroup: 'Tốc độ phát',
    speedName: 'Tốc độ',
    speedCycle: (now, next) => `Tốc độ ${now}. Bấm để đổi sang ${next}`,
  },
  en: {
    track: 'Recording · ',
    play: 'Play',
    pause: 'Pause',
    loading: 'Loading the recording…',
    loadingNote: 'Read the questions while you wait. Play opens when loading ends.',
    errorHead: 'The recording did not load',
    stopped: (at) => `The recording stopped at ${at}. `,
    kept: 'Your answers are kept.',
    resumeFrom: (at) => ` Reload to continue from ${at}.`,
    retryHint: ' Reload to continue.',
    retry: 'Reload the recording',
    locked: 'Played · locked',
    lockedKeep: 'You can change your answers until you submit.',
    onceHead: 'You will hear this recording once only',
    onceBody: (length) => `Length ${length}. No pausing, no skipping, no speed change. Read the questions before you start.`,
    onceStart: 'Start listening',
    onceResume: (at) => `Continue from ${at}`,
    examNote: 'Test: no pausing, no skipping, no speed change.',
    noPause: 'Playing · cannot be paused',
    playingShort: 'Playing',
    seek: 'Position in the recording',
    of: 'of',
    back: 'Back',
    forward: 'Forward',
    seconds: 'seconds',
    loopGroup: 'Loop A–B',
    loopName: 'Loop',
    setA: 'Set A',
    setB: 'Set B',
    looping: (a, b) => `Looping ${a}–${b}`,
    clearLoop: 'Clear loop',
    phoneLoop: (a, b) => `Looping ${a}–${b}. Press to clear`,
    phoneSetB: (a) => `A set at ${a}. Press to set B`,
    phoneSetA: 'Loop: press to set A',
    speedGroup: 'Playback speed',
    speedName: 'Speed',
    speedCycle: (now, next) => `Speed ${now}. Press to change to ${next}`,
  },
};

/**
 * True when the focused element already uses Space itself: fields type a
 * space, buttons and links press themselves. Then the shortcut stays out.
 */
function ownsSpace(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLAnchorElement
  );
}

function TrackName({ title, prefix }: { title: string; prefix: string }) {
  return (
    <p className={styles.name}>
      {prefix}
      <span lang="en" className={styles.title}>{title}</span>
    </p>
  );
}

function Clock({ current, duration, className }: { current: number; duration: number; className?: string }) {
  return (
    <span className={cx(styles.clock, className)}>
      {formatMediaTime(current)} / {formatMediaTime(duration)}
    </span>
  );
}

/** Thin bar to look at only; seeking happens on the full player (HocTap §2). */
function ThinBar({ current, duration, loop }: { current: number; duration: number; loop?: AudioLoop }) {
  const pct = (t: number) => (duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0);
  const looping = loop?.a !== undefined && loop?.b !== undefined;
  return (
    <span aria-hidden="true" className={styles.thin}>
      {looping ? (
        <span className={styles.thinLoop} style={{ left: `${pct(loop!.a!)}%`, width: `${pct(loop!.b!) - pct(loop!.a!)}%` }} />
      ) : null}
      <span className={styles.thinFill} style={{ width: `${pct(current)}%` }} />
    </span>
  );
}

function PlayGlyph({ playing }: { playing: boolean }) {
  return <Icon name={playing ? 'pause' : 'play'} size={20} />;
}

/**
 * Audio player of the "Bản in" UI (UIBASE-0056 #31, ThanhPhanHocTap §2).
 * Presentation only: it never creates an `<audio>` element. The page keeps
 * its existing player lifecycle and drives this through props
 * (frontend/AGENTS.md); the three layouts read one shared state.
 */
export function AudioPlayer({
  variant = 'full',
  state,
  title,
  current,
  duration,
  speed = 1,
  speeds = DEFAULT_SPEEDS,
  loop,
  mode = 'practice',
  stoppedAt,
  lockedNote,
  lang = 'vi',
  spaceToggles = false,
  onPlay,
  onPause,
  onSeek,
  onSpeed,
  onSetA,
  onSetB,
  onClearLoop,
  onRetry,
  className,
}: AudioPlayerProps) {
  const playing = state === 'playing';
  const restricted = mode === 'exam' || variant === 'once';
  const w = WORDS[lang];
  const sec = (n: number) => `${n} ${w.seconds}`;
  const toggle = () => (playing ? (restricted ? undefined : onPause?.()) : onPlay?.());

  useEffect(() => {
    // Restricted tracks never answer the key: starting one must go through
    // its own button (and, for `once`, past the warning), and it cannot pause.
    if (!spaceToggles || restricted || (state !== 'ready' && state !== 'paused' && state !== 'playing')) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat || ownsSpace(event.target)) return;
      event.preventDefault();
      if (playing) onPause?.();
      else onPlay?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [spaceToggles, state, playing, restricted, onPlay, onPause]);

  if (state === 'loading') {
    return (
      <div aria-busy="true" className={cx(styles.player, styles.quiet, className)}>
        {variant === 'compact' ? null : <TrackName title={title} prefix={w.track} />}
        <div className={styles.row}>
          <button type="button" disabled className={cx(styles.play, styles.playOff)}>
            <Icon name="play" size={20} />{w.play}
          </button>
          <span role="status" className={styles.strong}>{w.loading}</span>
          <span className={cx(styles.clock, styles.muted, styles.end)}>--:-- / --:--</span>
        </div>
        {variant === 'compact' ? null : (
          <>
            <span aria-hidden="true" className={styles.thinTrack} />
            <p className={styles.note}>{w.loadingNote}</p>
          </>
        )}
      </div>
    );
  }

  if (state === 'error') {
    const at = stoppedAt !== undefined && stoppedAt > 0 ? formatMediaTime(stoppedAt) : null;
    return (
      <div role="alert" className={cx(styles.player, styles.failed, className)}>
        <p className={styles.alertHead}><Icon name="error" size={20} />{w.errorHead}</p>
        <p className={styles.alertBody}>
          {at ? w.stopped(at) : null}
          {w.kept}
          {at ? w.resumeFrom(at) : w.retryHint}
        </p>
        <button type="button" className={styles.secondary} onClick={onRetry}>{w.retry}</button>
      </div>
    );
  }

  if (state === 'locked') {
    return (
      <div className={cx(styles.player, styles.quiet, className)}>
        {variant === 'once' ? null : <TrackName title={title} prefix={w.track} />}
        <div className={styles.row}>
          <button type="button" disabled className={cx(styles.play, styles.playOff)}>
            <Icon name="lock" size={20} />{w.locked}
          </button>
          <Clock current={duration} duration={duration} className={styles.muted} />
        </div>
        <p className={styles.note}>
          {w.lockedKeep}
          {lockedNote ? <> {lockedNote}</> : null}
        </p>
      </div>
    );
  }

  if (variant === 'once' || (mode === 'exam' && variant !== 'compact')) {
    if (!playing) {
      return (
        <div className={cx(styles.player, variant === 'once' && styles.warned, className)}>
          {variant === 'once' ? (
            <>
              <p className={styles.warnHead}>{w.onceHead}</p>
              <p className={styles.alertBody}>{w.onceBody(formatMediaTime(duration))}</p>
              <button type="button" className={styles.start} onClick={onPlay}>
                {current > 0 ? w.onceResume(formatMediaTime(current)) : w.onceStart}
              </button>
            </>
          ) : (
            <>
              <TrackName title={title} prefix={w.track} />
              <div className={styles.row}>
                <button type="button" className={styles.play} onClick={onPlay}><Icon name="play" size={20} />{w.play}</button>
                <Clock current={current} duration={duration} className={styles.end} />
              </div>
              <p className={styles.note}>{w.examNote}</p>
            </>
          )}
        </div>
      );
    }
    return (
      <div className={cx(styles.player, className)}>
        {variant === 'once' ? null : <TrackName title={title} prefix={w.track} />}
        <div className={styles.spread}>
          <span role="status" className={styles.strong}>{w.noPause}</span>
          <Clock current={current} duration={duration} />
        </div>
        <ThinBar current={current} duration={duration} />
      </div>
    );
  }

  const playLabel = playing ? w.pause : w.play;

  if (variant === 'compact') {
    // Plan 0056 #31: the play button always carries its word. An exam track
    // that is playing says so instead of offering a pause it cannot do.
    const examPlaying = mode === 'exam' && playing;
    return (
      <div className={cx(styles.compact, className)}>
        <button
          type="button"
          aria-label={examPlaying ? w.noPause : undefined}
          className={cx(styles.play, styles.playCompact)}
          onClick={examPlaying ? undefined : toggle}
          aria-disabled={examPlaying ? true : undefined}
        >
          {examPlaying ? w.playingShort : <><PlayGlyph playing={playing} />{playLabel}</>}
        </button>
        <span lang="en" className={cx(styles.title, styles.ellipsis)}>{title}</span>
        <ThinBar current={current} duration={duration} loop={mode === 'practice' ? loop : undefined} />
        <Clock current={current} duration={duration} className={styles.nowrap} />
      </div>
    );
  }

  const hasA = loop?.a !== undefined;
  const hasB = loop?.b !== undefined;
  const looping = hasA && hasB;
  const seekBy = (delta: number) => onSeek?.(Math.min(duration, Math.max(0, current + delta)));
  const pct = (t: number) => (duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0);
  const range = (
    <label className={styles.rangeLabel}>
      <span className={styles.visuallyHidden}>{w.seek}</span>
      <input
        type="range"
        min={0}
        max={Math.max(0, Math.floor(duration))}
        step={1}
        value={Math.min(Math.floor(current), Math.floor(duration))}
        aria-valuetext={`${formatMediaTime(current)} ${w.of} ${formatMediaTime(duration)}`}
        onChange={(event) => onSeek?.(Number(event.currentTarget.value))}
        className={styles.range}
      />
    </label>
  );

  if (variant === 'phone') {
    const nextSpeed = speeds[(Math.max(0, speeds.indexOf(speed)) + 1) % speeds.length];
    const abStep: { label: string; aria: string; act?: () => void } = looping
      ? { label: 'A–B', aria: w.phoneLoop(formatMediaTime(loop!.a!), formatMediaTime(loop!.b!)), act: onClearLoop }
      : hasA
        ? { label: 'B', aria: w.phoneSetB(formatMediaTime(loop!.a!)), act: onSetB }
        : { label: 'A', aria: w.phoneSetA, act: onSetA };
    return (
      <div className={cx(styles.player, styles.phone, className)}>
        <TrackName title={title} prefix={w.track} />
        <div className={styles.row}>
          <button type="button" aria-label={`${w.back} ${sec(SKIP_SECONDS)}`} title={`${w.back} ${sec(SKIP_SECONDS)}`} className={styles.square} onClick={() => seekBy(-SKIP_SECONDS)}>
            <Icon name="back-10" size={20} />
          </button>
          <button type="button" className={cx(styles.play, styles.playPhone)} onClick={toggle}>
            <PlayGlyph playing={playing} />{playLabel}
          </button>
          <button type="button" aria-label={`${w.forward} ${sec(SKIP_SECONDS)}`} title={`${w.forward} ${sec(SKIP_SECONDS)}`} className={styles.square} onClick={() => seekBy(SKIP_SECONDS)}>
            <Icon name="fwd-10" size={20} />
          </button>
          <button type="button" aria-label={abStep.aria} className={cx(styles.cycle, looping && styles.cycleOn)} onClick={abStep.act}>
            {abStep.label}
          </button>
          <button
            type="button"
            aria-label={w.speedCycle(formatSpeed(speed), formatSpeed(nextSpeed))}
            className={cx(styles.cycle, styles.end)}
            onClick={() => onSpeed?.(nextSpeed)}
          >
            {formatSpeed(speed)}
          </button>
        </div>
        {range}
        <p className={styles.spreadClock}>
          <span>{formatMediaTime(current)}</span>
          <span className={styles.muted}>{formatMediaTime(duration)}</span>
        </p>
      </div>
    );
  }

  return (
    <div className={cx(styles.player, className)}>
      <TrackName title={title} prefix={w.track} />
      <div className={styles.row}>
        <button type="button" aria-label={`${w.back} ${sec(SKIP_SECONDS)}`} className={styles.skip} onClick={() => seekBy(-SKIP_SECONDS)}>
          <Icon name="back-10" size={20} />{sec(SKIP_SECONDS)}
        </button>
        <button type="button" className={cx(styles.play, styles.playWide)} onClick={toggle}>
          <PlayGlyph playing={playing} />{playLabel}
        </button>
        <button type="button" aria-label={`${w.forward} ${sec(SKIP_SECONDS)}`} className={styles.skip} onClick={() => seekBy(SKIP_SECONDS)}>
          {sec(SKIP_SECONDS)}<Icon name="fwd-10" size={20} />
        </button>
        <Clock current={current} duration={duration} className={cx(styles.end, styles.clockLg)} />
      </div>
      {range}
      <span aria-hidden="true" className={styles.marks}>
        <span className={styles.marksTrack} />
        {hasA ? (
          <>
            <span className={styles.marksLoop} style={{ left: `${pct(loop!.a!)}%`, width: `${hasB ? pct(loop!.b!) - pct(loop!.a!) : 0}%` }} />
            <span className={styles.markLetter} style={{ left: `${pct(loop!.a!)}%` }}>A</span>
          </>
        ) : null}
        {hasB ? <span className={styles.markLetter} style={{ left: `${pct(loop!.b!)}%` }}>B</span> : null}
      </span>
      <LoopGroup w={w} loop={loop} onSetA={onSetA} onSetB={onSetB} onClearLoop={onClearLoop} />
      <div role="group" aria-label={w.speedGroup} className={styles.group}>
        <span className={styles.groupName}>{w.speedName}</span>
        {speeds.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === speed}
            className={cx(styles.speed, s === speed && styles.speedOn)}
            onClick={() => onSpeed?.(s)}
          >
            {formatSpeed(s)}
          </button>
        ))}
      </div>
    </div>
  );
}

function LoopGroup({ w, loop, onSetA, onSetB, onClearLoop }: { w: Words } & Pick<AudioPlayerProps, 'loop' | 'onSetA' | 'onSetB' | 'onClearLoop'>): ReactNode {
  const hasA = loop?.a !== undefined;
  const hasB = loop?.b !== undefined;
  return (
    <div role="group" aria-label={w.loopGroup} className={styles.group}>
      <span className={styles.groupName}>{w.loopName}</span>
      <button type="button" aria-pressed={hasA} className={styles.loopButton} onClick={onSetA}>
        {hasA ? `A · ${formatMediaTime(loop!.a!)}` : w.setA}
      </button>
      <button type="button" aria-pressed={hasB} disabled={!hasA} className={styles.loopButton} onClick={onSetB}>
        {hasB ? `B · ${formatMediaTime(loop!.b!)}` : w.setB}
      </button>
      {hasA && hasB ? (
        <span role="status" className={styles.looping}>
          <Icon name="repeat" size={16} />{w.looping(formatMediaTime(loop!.a!), formatMediaTime(loop!.b!))}
        </span>
      ) : null}
      {hasA || hasB ? (
        <button type="button" className={styles.clear} onClick={onClearLoop}>{w.clearLoop}</button>
      ) : null}
    </div>
  );
}
