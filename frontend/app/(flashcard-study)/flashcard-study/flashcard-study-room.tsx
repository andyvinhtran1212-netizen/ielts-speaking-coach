'use client';

// EXAMDRILL-0073 T001 (G08-T20): the flashcard study run inside the shared
// practice room, behind examRoomEnabled('drill'). Drawing only: loading, the
// SRS review request (same client_review_id), public marks and the keyboard
// stay in flashcard-study-player.tsx (FR-001). Rating opens only after the
// card was turned (FR-003); the card scrolls inside while the flip and rating
// buttons stay on the first screen (FR-004).
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

// Tokens, base.css and fonts come from LegacyRoomRoot (lazyLegacyRoom in the player).
import { ExamRoomShell } from '@/components/exam-room/exam-room-shell';
import { trackExamRoomEvent } from '@/components/exam-room/track';
import type { ExamRoomSaveStatus, ExamRoomSession } from '@/components/exam-room/types';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { VocabularyAudioButton as AudioButton } from '@/components/vocabulary-audio-button';
import { nextIntervalLabel } from '@/lib/flashcard-study-model.mjs';

import styles from './flashcard-study-room.module.css';

type Rating = 'again' | 'hard' | 'good' | 'easy';
type PublicMark = 'review' | 'known';
type Phase = 'loading' | 'active' | 'summary' | 'empty' | 'disabled' | 'error';

export const DRILL_RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];
export const DRILL_RATING_LABEL: Record<Rating, string> = { again: 'Quên', hard: 'Khó', good: 'Tốt', easy: 'Dễ' };
export const DRILL_SOURCE_LABEL: Record<string, string> = {
  used_well: 'Dùng tốt',
  needs_review: 'Cần ôn',
  upgrade_suggested: 'Có thể nâng cấp',
  manual: 'Tự thêm',
};

/** FR-006: only names from the table; an unknown source never shows its code. */
export function drillSourceLabel(sourceType: unknown): string {
  return typeof sourceType === 'string' && Object.hasOwn(DRILL_SOURCE_LABEL, sourceType)
    ? DRILL_SOURCE_LABEL[sourceType]
    : 'Từ vựng cá nhân';
}

export const DRILL_SAVE_ERROR = 'Chưa lưu được đánh giá. Kiểm tra mạng rồi bấm Thử lưu lại.';

export interface FlashcardStudyRoomProps {
  phase: Phase;
  title: string;
  message: string;
  cards: any[];
  index: number;
  flipped: boolean;
  /** The current card was turned at least once (FR-003). */
  revealed: boolean;
  publicMode: boolean;
  busy: boolean;
  saveError: boolean;
  hasPending: boolean;
  storageOkay: boolean;
  previousMark: PublicMark | null;
  breakdown: Record<Rating, number>;
  publicBreakdown: Record<PublicMark, number>;
  returnHref: string;
  ownerKey: string;
  attemptKey: string;
  session: ExamRoomSession;
  onFlip(): void;
  onRate(rating: Rating): void;
  onMark(mark: PublicMark): void;
  onRetrySave(): void;
  onRestart(): void;
  onOpenSource(trigger: HTMLButtonElement): void;
  flush(): Promise<{ unsaved: number }>;
  sourceDialog?: ReactNode;
}

const trackDrill = (name: string, props: Record<string, string | number | boolean> = {}) =>
  trackExamRoomEvent(name, { ...props, kind: 'flashcard' });

function Relation({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className={styles.relation}>
      <h3>{label}</h3>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

/**
 * The page keeps its own header and the site bar for the old branch; the room
 * has its own bar, so it hides them while it is shown and gives them back after.
 */
function useHidePageChrome() {
  useEffect(() => {
    const hidden = Array.from(document.querySelectorAll<HTMLElement>('aver-chrome, header.fcs-header'))
      .filter((element) => !element.hidden);
    hidden.forEach((element) => { element.hidden = true; });
    return () => { hidden.forEach((element) => { element.hidden = false; }); };
  }, []);
}

/**
 * FR-004: the stage takes exactly the height the window leaves after the room's
 * bars, banners and padding, so the flip and rating buttons are on the first
 * screen with no page scroll. Measured rather than guessed, because the bar is
 * taller on a phone and grows when a save row or banner appears.
 */
function useFitStage(active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const stage = ref.current;
    if (!active || !stage) return undefined;
    const fit = () => {
      // Make the stage one window tall first: the page then overflows by exactly
      // what sits around the stage (scrollHeight never reports less than the window).
      const viewport = window.innerHeight;
      stage.style.height = `${viewport}px`;
      const others = document.documentElement.scrollHeight - stage.offsetHeight;
      const height = Math.max(360, Math.floor(viewport - others));
      stage.style.height = `${height}px`;
    };
    fit();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(document.body);
    window.addEventListener('resize', fit);
    return () => { observer?.disconnect(); window.removeEventListener('resize', fit); };
  }, [active]);
  return ref;
}

export function FlashcardStudyRoom(props: FlashcardStudyRoomProps) {
  useHidePageChrome();
  const { phase, cards, index, flipped, revealed, publicMode } = props;
  const card = cards[index] || null;
  const counter = phase === 'active' && cards.length ? `Thẻ ${index + 1} trên ${cards.length}` : undefined;
  const ratingLocked = !revealed || props.busy || props.hasPending;
  const stageRef = useFitStage(phase === 'active' && Boolean(card));

  let body: ReactNode = null;
  if (phase === 'loading') {
    body = <p className={styles.muted} role="status">Đang tải bộ thẻ…</p>;
  } else if (phase === 'error' || phase === 'disabled') {
    body = (
      <Notice kind="error" title="Chưa mở được bộ thẻ." action={<Button variant="secondary" href={props.returnHref}>Chọn bộ khác</Button>}>
        {props.message}
      </Notice>
    );
  } else if (phase === 'empty') {
    body = (
      <section className={styles.panel}>
        <h1 className={styles.heading}>Chưa có thẻ để học</h1>
        <p>Bộ thẻ này đang trống hoặc chưa có thẻ đến hạn.</p>
        <Button href={props.returnHref}>Chọn bộ khác</Button>
      </section>
    );
  } else if (phase === 'summary') {
    body = (
      <section className={styles.panel} aria-labelledby="fsr-summary-title">
        <h1 id="fsr-summary-title" className={styles.heading} tabIndex={-1}>Xong bộ thẻ: {cards.length} thẻ</h1>
        <p>{publicMode
          ? (props.storageOkay ? 'Đánh dấu đã được lưu trên thiết bị này.' : 'Trình duyệt không cho phép lưu; kết quả chỉ còn trong phiên này.')
          : 'Mọi đánh giá trong tổng kết đã được máy chủ xác nhận.'}</p>
        <dl className={styles.breakdown}>
          {publicMode ? (
            <>
              <div><dt>Cần ôn</dt><dd>{props.publicBreakdown.review} thẻ</dd></div>
              <div><dt>Tự đánh giá nhớ</dt><dd>{props.publicBreakdown.known} thẻ</dd></div>
            </>
          ) : DRILL_RATINGS.map((rating) => (
            <div key={rating}><dt>{DRILL_RATING_LABEL[rating]}</dt><dd>{props.breakdown[rating]} thẻ</dd></div>
          ))}
        </dl>
        <div className={styles.actions}>
          <Button onClick={props.onRestart}>Học lại</Button>
          <Button variant="secondary" href={props.returnHref}>Chọn bộ khác</Button>
        </div>
      </section>
    );
  } else if (card) {
    const personalContent = !publicMode && Boolean(card.definitionVi || card.definitionEn || card.example);
    body = (
      <div ref={stageRef} className={styles.stage}>
        <div className={styles.card} data-flipped={flipped ? '' : undefined}>
          {!flipped ? (
            <button type="button" className={styles.front} onClick={props.onFlip} aria-label={`${card.headword}. Lật thẻ để xem nghĩa`}>
              <span className={styles.pill}>{publicMode ? props.title : (card.topic || 'Từ vựng của bạn')}</span>
              {props.previousMark ? <span className={styles.memory}>{props.previousMark === 'known' ? 'Tự đánh giá nhớ' : 'Cần ôn'}</span> : null}
              <span className={styles.word} lang="en">{card.headword}</span>
              {card.pronunciation || card.ipa ? <span className={styles.ipa}>{card.pronunciation || card.ipa}</span> : null}
              <span className={styles.hint}>Bấm vào thẻ hoặc phím cách để lật</span>
            </button>
          ) : (
            <div className={styles.back} tabIndex={0} role="region" aria-label={`Mặt sau của thẻ ${card.headword}`}>
              <div className={styles.backHead}>
                <h2 lang="en">{card.headword}</h2>
                {card.pronunciation || card.ipa ? <span className={styles.ipa}>{card.pronunciation || card.ipa}</span> : null}
                <AudioButton url={card.audioHeadword} say={card.headword} label={`Nghe phát âm ${card.headword}`} />
              </div>
              {publicMode && (card.partOfSpeech || card.level) ? <p className={styles.muted}>{[card.partOfSpeech, card.level].filter(Boolean).join(' · ')}</p> : null}
              {card.definitionVi ? <p className={styles.definition}>{card.definitionVi}</p> : null}
              {card.definitionEn ? <p lang="en">{card.definitionEn}</p> : null}
              {card.example ? (
                <div className={styles.example}>
                  <h3>Ví dụ {publicMode ? <AudioButton url={card.audioExample} say={card.example} label="Nghe câu ví dụ" /> : null}</h3>
                  <p lang="en">{card.example}</p>
                </div>
              ) : null}
              {!publicMode && !personalContent ? <p className={styles.muted}>Chưa có định nghĩa chi tiết. Bạn vẫn có thể xem câu gốc để nhớ ngữ cảnh.</p> : null}
              {publicMode ? <Relation label="Kết hợp thường gặp" items={card.collocations} /> : null}
              {publicMode ? <Relation label="Đồng nghĩa" items={card.synonyms} /> : null}
              {publicMode ? <Relation label="Trái nghĩa" items={card.antonyms} /> : null}
              {publicMode && card.memoryHook ? <Notice kind="info" title="Mẹo nhớ." live="none">{card.memoryHook}</Notice> : null}
              {publicMode && card.commonError ? <Notice kind="warning" title="Lỗi hay gặp." live="none">{card.commonError}</Notice> : null}
              {!publicMode && card.context ? <Button variant="text" aria-haspopup="dialog" onClick={(event) => props.onOpenSource(event.currentTarget as HTMLButtonElement)}>Xem câu gốc</Button> : null}
              {!publicMode ? <p className={styles.muted}>{drillSourceLabel(card.sourceType)} · {card.review ? `Đã ôn ${card.review.reviewCount} lần` : 'Chưa học'}</p> : null}
            </div>
          )}
        </div>
        <div className={styles.controls}>
          <Button variant="secondary" onClick={props.onFlip}>{flipped ? 'Xem mặt từ' : 'Lật thẻ'}</Button>
          <p className={styles.srOnly} aria-live="polite">{flipped ? `Mặt sau của thẻ ${card.headword}` : `Mặt trước của thẻ ${card.headword}`}</p>
          {!revealed ? <p className={styles.lockNote} id="fsr-rate-note">Lật thẻ để chấm mức nhớ.</p> : null}
          <div className={publicMode ? styles.ratingsTwo : styles.ratings} role="group" aria-label="Chấm mức nhớ" aria-describedby={!revealed ? 'fsr-rate-note' : undefined}>
            {publicMode ? (
              <>
                <button type="button" className={styles.rate} disabled={!revealed} onClick={() => props.onMark('review')}><span>Cần ôn</span><kbd aria-hidden="true">1</kbd></button>
                <button type="button" className={styles.rate} disabled={!revealed} onClick={() => props.onMark('known')}><span>Tự đánh giá nhớ</span><kbd aria-hidden="true">2</kbd></button>
              </>
            ) : DRILL_RATINGS.map((rating, ratingIndex) => (
              <button type="button" key={rating} className={styles.rate} data-rating={rating} disabled={ratingLocked} onClick={() => props.onRate(rating)}>
                <span>{DRILL_RATING_LABEL[rating]}</span>
                <small>{nextIntervalLabel(card, rating)}</small>
                <kbd aria-hidden="true">{ratingIndex + 1}</kbd>
              </button>
            ))}
          </div>
          <div aria-live="polite">
            {!publicMode && props.busy ? <p className={styles.muted}>Đang lưu đánh giá…</p> : null}
            {!publicMode && !props.busy && props.saveError ? (
              <Notice kind="error" live="none" action={props.hasPending ? <Button variant="secondary" size="sm" onClick={props.onRetrySave}>Thử lưu lại</Button> : undefined}>
                {DRILL_SAVE_ERROR}
              </Notice>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const unsaved = props.hasPending ? 1 : 0;
  const saveStatus: ExamRoomSaveStatus = props.session === 'expired' && unsaved > 0
    ? { state: 'retrying', unsaved }
    : props.busy ? { state: 'saving' } : { state: 'idle' };
  return (
    <>
      <ExamRoomShell
        mode="practice"
        surface="drill"
        attemptKey={props.attemptKey}
        title={props.title}
        subtitle={counter}
        saveStatus={saveStatus}
        layout={{ kind: 'single', body: <div className={styles.body}>{body}</div> }}
        exit={{ href: props.returnHref, flush: props.flush, losesWork: () => false }}
        ownerKey={props.ownerKey}
        session={props.session}
        // The pending rating stays on the page; nothing is copied to the device.
        onSessionExpired={{ saveLocalCopy: () => false, returnUrl: typeof window === 'undefined' ? '/flashcard-study' : `${window.location.pathname}${window.location.search}` }}
        track={trackDrill}
      />
      {props.sourceDialog}
    </>
  );
}
