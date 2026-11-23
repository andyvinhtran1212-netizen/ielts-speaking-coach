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
   * Space plays or pauses while focus is not in a field. Turn it on for one
   * player per page only (full, compact and phone share one state).
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

function TrackName({ title, prefix = true }: { title: string; prefix?: boolean }) {
  return (
    <p className={styles.name}>
      {prefix ? 'Bài nghe · ' : null}
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
  const toggle = () => (playing ? (restricted ? undefined : onPause?.()) : onPlay?.());

  useEffect(() => {
    if (!spaceToggles || (state !== 'ready' && state !== 'paused' && state !== 'playing')) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat || ownsSpace(event.target)) return;
      if (playing && restricted) return;
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
        {variant === 'compact' ? null : <TrackName title={title} />}
        <div className={styles.row}>
          <button type="button" disabled className={cx(styles.play, styles.playOff)}>
            <Icon name="play" size={20} />Phát
          </button>
          <span role="status" className={styles.strong}>Đang tải bài nghe…</span>
          <span className={cx(styles.clock, styles.muted, styles.end)}>--:-- / --:--</span>
        </div>
        {variant === 'compact' ? null : (
          <>
            <span aria-hidden="true" className={styles.thinTrack} />
            <p className={styles.note}>Bạn đọc câu hỏi trước trong lúc chờ. Nút Phát mở khi tải xong.</p>
          </>
        )}
      </div>
    );
  }

  if (state === 'error') {
    const at = stoppedAt !== undefined && stoppedAt > 0 ? formatMediaTime(stoppedAt) : null;
    return (
      <div role="alert" className={cx(styles.player, styles.failed, className)}>
        <p className={styles.alertHead}><Icon name="error" size={20} />Chưa tải được bài nghe</p>
        <p className={styles.alertBody}>
          {at ? `Mạng bị ngắt ở phút ${at}. ` : null}
          Câu trả lời bạn đã nhập vẫn còn.
          {at ? ` Tải lại sẽ phát tiếp từ ${at}.` : ' Tải lại để nghe tiếp.'}
        </p>
        <button type="button" className={styles.secondary} onClick={onRetry}>Tải lại bài nghe</button>
      </div>
    );
  }

  if (state === 'locked') {
    return (
      <div className={cx(styles.player, styles.quiet, className)}>
        {variant === 'once' ? null : <TrackName title={title} />}
        <div className={styles.row}>
          <button type="button" disabled className={cx(styles.play, styles.playOff)}>
            <Icon name="lock" size={20} />Đã nghe · đã khoá
          </button>
          <Clock current={duration} duration={duration} className={styles.muted} />
        </div>
        <p className={styles.note}>Bạn vẫn sửa được câu trả lời tới khi nộp. Nộp xong sẽ mở lời thoại và cho nghe lại.</p>
      </div>
    );
  }

  if (variant === 'once' || (mode === 'exam' && variant !== 'compact')) {
    if (!playing) {
      return (
        <div className={cx(styles.player, variant === 'once' && styles.warned, className)}>
          {variant === 'once' ? (
            <>
              <p className={styles.warnHead}>Bài này chỉ được nghe một lần</p>
              <p className={styles.alertBody}>
                Dài {formatMediaTime(duration)}. Không tạm dừng, không tua, không đổi tốc độ. Hãy đọc xong câu hỏi rồi mới bắt đầu.
              </p>
              <button type="button" className={styles.start} onClick={onPlay}>
                {current > 0 ? `Nghe tiếp từ ${formatMediaTime(current)}` : 'Bắt đầu nghe'}
              </button>
            </>
          ) : (
            <>
              <TrackName title={title} />
              <div className={styles.row}>
                <button type="button" className={styles.play} onClick={onPlay}><Icon name="play" size={20} />Phát</button>
                <Clock current={current} duration={duration} className={styles.end} />
              </div>
              <p className={styles.note}>Bài thi: không tạm dừng, không tua, không đổi tốc độ.</p>
            </>
          )}
        </div>
      );
    }
    return (
      <div className={cx(styles.player, className)}>
        {variant === 'once' ? null : <TrackName title={title} />}
        <div className={styles.spread}>
          <span role="status" className={styles.strong}>Đang phát · không tạm dừng được</span>
          <Clock current={current} duration={duration} />
        </div>
        <ThinBar current={current} duration={duration} />
      </div>
    );
  }

  const playLabel = playing ? 'Tạm dừng' : 'Phát';

  if (variant === 'compact') {
    return (
      <div className={cx(styles.compact, className)}>
        <button
          type="button"
          aria-label={playLabel}
          title={playLabel}
          className={cx(styles.play, styles.playSquare)}
          onClick={mode === 'exam' && playing ? undefined : toggle}
          aria-disabled={mode === 'exam' && playing ? true : undefined}
        >
          <PlayGlyph playing={playing} />
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
      <span className={styles.visuallyHidden}>Vị trí trong bài nghe</span>
      <input
        type="range"
        min={0}
        max={Math.max(0, Math.floor(duration))}
        step={1}
        value={Math.min(Math.floor(current), Math.floor(duration))}
        aria-valuetext={`${formatMediaTime(current)} trên ${formatMediaTime(duration)}`}
        onChange={(event) => onSeek?.(Number(event.currentTarget.value))}
        className={styles.range}
      />
    </label>
  );

  if (variant === 'phone') {
    const nextSpeed = speeds[(Math.max(0, speeds.indexOf(speed)) + 1) % speeds.length];
    const abStep: { label: string; aria: string; act?: () => void } = looping
      ? { label: 'A–B', aria: `Đang lặp ${formatMediaTime(loop!.a!)}–${formatMediaTime(loop!.b!)}. Bấm để bỏ lặp`, act: onClearLoop }
      : hasA
        ? { label: 'B', aria: `Đã đặt A ở ${formatMediaTime(loop!.a!)}. Bấm để đặt B`, act: onSetB }
        : { label: 'A', aria: 'Lặp đoạn: bấm để đặt A', act: onSetA };
    return (
      <div className={cx(styles.player, styles.phone, className)}>
        <TrackName title={title} />
        <div className={styles.row}>
          <button type="button" aria-label={`Lùi ${SKIP_SECONDS} giây`} title={`Lùi ${SKIP_SECONDS} giây`} className={styles.square} onClick={() => seekBy(-SKIP_SECONDS)}>
            <Icon name="back-10" size={20} />
          </button>
          <button type="button" className={cx(styles.play, styles.playPhone)} onClick={toggle}>
            <PlayGlyph playing={playing} />{playLabel}
          </button>
          <button type="button" aria-label={`Tới ${SKIP_SECONDS} giây`} title={`Tới ${SKIP_SECONDS} giây`} className={styles.square} onClick={() => seekBy(SKIP_SECONDS)}>
            <Icon name="fwd-10" size={20} />
          </button>
          <button type="button" aria-label={abStep.aria} className={cx(styles.cycle, looping && styles.cycleOn)} onClick={abStep.act}>
            {abStep.label}
          </button>
          <button
            type="button"
            aria-label={`Tốc độ ${formatSpeed(speed)}. Bấm để đổi sang ${formatSpeed(nextSpeed)}`}
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
      <TrackName title={title} />
      <div className={styles.row}>
        <button type="button" aria-label={`Lùi ${SKIP_SECONDS} giây`} className={styles.skip} onClick={() => seekBy(-SKIP_SECONDS)}>
          <Icon name="back-10" size={20} />{SKIP_SECONDS} giây
        </button>
        <button type="button" className={cx(styles.play, styles.playWide)} onClick={toggle}>
          <PlayGlyph playing={playing} />{playLabel}
        </button>
        <button type="button" aria-label={`Tới ${SKIP_SECONDS} giây`} className={styles.skip} onClick={() => seekBy(SKIP_SECONDS)}>
          {SKIP_SECONDS} giây<Icon name="fwd-10" size={20} />
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
      <LoopGroup loop={loop} onSetA={onSetA} onSetB={onSetB} onClearLoop={onClearLoop} />
      <div role="group" aria-label="Tốc độ phát" className={styles.group}>
        <span className={styles.groupName}>Tốc độ</span>
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

function LoopGroup({ loop, onSetA, onSetB, onClearLoop }: Pick<AudioPlayerProps, 'loop' | 'onSetA' | 'onSetB' | 'onClearLoop'>): ReactNode {
  const hasA = loop?.a !== undefined;
  const hasB = loop?.b !== undefined;
  return (
    <div role="group" aria-label="Lặp đoạn A–B" className={styles.group}>
      <span className={styles.groupName}>Lặp đoạn</span>
      <button type="button" aria-pressed={hasA} className={styles.loopButton} onClick={onSetA}>
        {hasA ? `A · ${formatMediaTime(loop!.a!)}` : 'Đặt A'}
      </button>
      <button type="button" aria-pressed={hasB} disabled={!hasA} className={styles.loopButton} onClick={onSetB}>
        {hasB ? `B · ${formatMediaTime(loop!.b!)}` : 'Đặt B'}
      </button>
      {hasA && hasB ? (
        <span role="status" className={styles.looping}>
          <Icon name="repeat" size={16} />Đang lặp {formatMediaTime(loop!.a!)}–{formatMediaTime(loop!.b!)}
        </span>
      ) : null}
      {hasA || hasB ? (
        <button type="button" className={styles.clear} onClick={onClearLoop}>Bỏ lặp</button>
      ) : null}
    </div>
  );
}
