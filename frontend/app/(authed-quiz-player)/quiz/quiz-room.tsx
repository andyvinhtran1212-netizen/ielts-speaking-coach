'use client';

// EXAMDRILL-0073 T001 (G08-T20): Quick Check inside the shared practice room,
// behind examRoomEnabled('drill'). Drawing only: the engine, outbox, session,
// reset and finish calls stay in quiz-player.tsx and come in through props
// (FR-001). Practice mode, Vietnamese, no timer, no submit (FR-002).
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

// Tokens, base.css and fonts come from LegacyRoomRoot (lazyLegacyRoom in the player).
import { ExamRoomShell } from '@/components/exam-room/exam-room-shell';
import { trackExamRoomEvent } from '@/components/exam-room/track';
import type { ExamRoomSaveStatus, ExamRoomSession } from '@/components/exam-room/types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { VocabularyAudioButton } from '@/components/vocabulary-audio-button';
import {
  displayItemKey,
  displayPointLabel,
  quizAdmissionAllowed,
  quizCounterText,
  safeQuizLink,
  stripAudioToken,
} from '@/lib/quiz-player-model.mjs';

import styles from './quiz-room.module.css';

type AnyRow = Record<string, any>;
type Phase = 'loading' | 'error' | 'gate' | 'play' | 'finishing' | 'summary';

export interface QuizRoomFeedback {
  correct: boolean;
  corrected?: string | null;
  provisional?: boolean;
  value: unknown;
  correctText: string;
  explain: string;
  articleUrl: string | null;
  cardKey: string | null;
}

export interface QuizRoomProps {
  phase: Phase;
  ownerKey: string;
  sessionKey: string;
  message: string;
  retryable: boolean;
  bank: AnyRow | null;
  area: AnyRow;
  question: AnyRow | null;
  itemKey: string;
  answerOrder: number[];
  options: unknown[];
  feedback: QuizRoomFeedback | null;
  textAnswer: string;
  questionNo: number;
  progress: { mastered: number; total: number; remaining: number };
  result: AnyRow | null;
  reviewRows: AnyRow[];
  review: boolean;
  masteryRetained: boolean;
  saveUnconfirmed: boolean;
  saveStatus: ExamRoomSaveStatus;
  session: ExamRoomSession;
  startBusy: boolean;
  resetBusy: boolean;
  instruction: string;
  renderText(value: unknown): ReactNode;
  formatDuration(seconds: number): string;
  stringList(value: unknown): string[];
  onText(value: string): void;
  onAnswer(value: unknown): void;
  onTextEnter(): void;
  onNext(): void;
  onReopen(): void;
  onContinueLegacy(): void;
  onReview(): void;
  onReset(): Promise<void> | void;
  flush(): Promise<{ unsaved: number }>;
  nextButtonRef: RefObject<HTMLButtonElement | null>;
  reopenButtonRef: RefObject<HTMLButtonElement | null>;
  textInputRef: RefObject<HTMLInputElement | null>;
  promptRef: RefObject<HTMLParagraphElement | null>;
  summaryHeadingRef: RefObject<HTMLHeadingElement | null>;
}

const trackDrill = (name: string, props: Record<string, string | number | boolean> = {}) =>
  trackExamRoomEvent(name, { ...props, kind: 'quiz' });

export function QuizRoom(props: QuizRoomProps) {
  const {
    phase, bank, area, question, feedback, progress, result, renderText: T,
  } = props;
  const [resetOpen, setResetOpen] = useState(false);
  const [cardKey, setCardKey] = useState<string | null>(null);
  const [wrongOnly, setWrongOnly] = useState(true);
  const cardReturn = useRef<HTMLElement | null>(null);

  const title = bank?.bank?.title || 'Quick Check';
  const { reopenButtonRef } = props;
  // The player's focus effect can run before this lazily loaded room has drawn
  // the error box; the room moves focus to "Mở lại bài" once it is on screen.
  useEffect(() => { if (phase === 'error') reopenButtonRef.current?.focus(); }, [phase, reopenButtonRef]);
  const counter = phase === 'play' ? quizCounterText(props.questionNo, progress, area.grammar) : undefined;
  const label = (key: string) => (area.grammar ? displayPointLabel(bank, key) : displayItemKey(key, false));
  const openCard = (key: string, target: HTMLElement) => { cardReturn.current = target; setCardKey(key); };
  const selectedCard = cardKey ? bank?.word_cards?.[cardKey] : null;
  const visibleReviews = wrongOnly ? props.reviewRows.filter((row) => row.wrongCount > 0) : props.reviewRows;
  const legacy = Boolean(bank?.managed && !bank.managed.isCurrent);

  const confirmReset = async () => {
    setResetOpen(false);
    await props.onReset();
  };

  let body: ReactNode = null;
  if (phase === 'loading') {
    body = <p className={styles.muted} role="status">Đang tải câu…</p>;
  } else if (phase === 'error') {
    body = (
      <Notice kind="error" title="Chưa mở được bài." action={props.retryable ? <Button ref={props.reopenButtonRef} variant="secondary" onClick={props.onReopen}>Mở lại bài</Button> : undefined}>
        {props.message}
      </Notice>
    );
  } else if (phase === 'gate') {
    body = (
      <section className={styles.panel} aria-labelledby="qr-gate-title">
        {bank?.managed?.isCurrent ? <p className={styles.muted}>Bản đã sửa</p> : null}
        <h1 id="qr-gate-title" className={styles.heading}>
          {legacy ? 'Bài Grammar trước khi sửa' : progress.remaining > 0 ? 'Bài đang tạm dừng lượt mới' : area.grammar ? 'Bạn đã nắm hết các điểm ngữ pháp của bài này.' : 'Bạn đã thuộc hết bộ từ này.'}
        </h1>
        <p>{legacy ? 'Phần đã làm và tiến độ của bản này được giữ nguyên. Bạn có thể tiếp tục phần còn lại hoặc mở bản đã sửa như một lượt học riêng.' : progress.remaining > 0 ? 'Tiến độ đã có vẫn được giữ. Bạn có thể mở lại bài để kiểm tra khi lượt mới hoạt động trở lại.' : 'Ôn tập lại để củng cố, hoặc làm lại từ đầu nếu muốn kiểm tra lại toàn bộ bài.'}</p>
        <div className={styles.actions}>
          {legacy && bank?.grammar?.can_continue_legacy && progress.remaining > 0
            ? <Button loading={props.startBusy} loadingLabel="Đang tạo phiên…" disabled={props.resetBusy} onClick={props.onContinueLegacy}>Tiếp tục bản trước</Button> : null}
          {progress.remaining === 0
            ? <Button loading={props.startBusy} loadingLabel="Đang tạo phiên…" disabled={props.resetBusy || !quizAdmissionAllowed(bank, true)} onClick={props.onReview}>Ôn tập lại</Button> : null}
          {progress.remaining === 0 && !legacy
            ? <Button variant="secondary" loading={props.resetBusy} loadingLabel="Đang xác nhận…" disabled={props.startBusy || Boolean(bank?.managed && !bank.grammar?.new_starts_enabled)} aria-haspopup="dialog" onClick={() => setResetOpen(true)}>Làm lại từ đầu</Button> : null}
          {legacy ? <Button variant="secondary" href={`/quiz?bank=${encodeURIComponent(bank!.managed.currentBankId)}`}>Mở bản đã sửa</Button> : null}
          {progress.remaining > 0 && bank?.managed?.isCurrent ? <Button variant="secondary" onClick={props.onReopen}>Mở lại bài</Button> : null}
        </div>
        {props.message ? <Notice kind="error" action={<Button variant="secondary" onClick={() => setResetOpen(true)}>Thử lại</Button>}>{props.message}</Notice> : null}
      </section>
    );
  } else if (phase === 'play' && question) {
    const choice = question.input === 'choice' || question.input === 'syllable';
    body = (
      <section className={styles.panel} aria-label={title}>
        {bank?.managed?.isCurrent ? <p className={styles.muted}>Bản đã sửa</p> : null}
        {props.review && bank?.managed ? <p role="status" className={styles.muted}>Ôn tập: các câu trả lời trong lượt này không thay đổi tiến độ đã lưu.</p> : null}
        {legacy ? <p className={styles.muted}>Bạn đang tiếp tục bản trước. Tiến độ được giữ riêng với bản đã sửa. <Button variant="text" href={`/quiz?bank=${encodeURIComponent(bank!.managed.currentBankId)}`}>Mở bản đã sửa</Button></p> : null}
        {props.masteryRetained ? <p role="status" className={styles.muted}>Các câu trả lời của lượt này được ghi vào lịch sử. Tiến độ đã hoàn tất từ lượt khác được giữ nguyên; số đếm ở đây là phần bạn đang làm trong lượt này.</p> : null}
        {props.saveUnconfirmed ? <Notice kind="warning">Chưa lưu được phần vừa làm. Bạn vẫn làm tiếp được; bài sẽ thử lưu lại.</Notice> : null}
        <article className={styles.question}>
          {question.audio_url || String(question.prompt || '').includes('{{audio}}')
            ? <VocabularyAudioButton key={props.itemKey} url={safeQuizLink(question.audio_url)} say={props.itemKey} label="Nghe" className="av-button av-button-secondary av-button-sm qz-audio">Nghe</VocabularyAudioButton> : null}
          <p ref={props.promptRef} tabIndex={-1} className={styles.prompt}>{T(stripAudioToken(question.prompt))}</p>
          {question.hint ? <p className={styles.muted}>Gợi ý: {T(question.hint)}</p> : null}
          <p className={styles.instruction}>{props.instruction}</p>
          {choice ? (
            <div className={question.input === 'choice' ? 'qz-options' : 'qz-chips'}>
              {props.answerOrder.map((index) => {
                const isCorrect = feedback && index === question.answer;
                const isWrong = feedback && feedback.value === index && !feedback.correct;
                return (
                  <button key={`${question.qid}:${index}`} type="button" className={`qz-opt${question.input === 'syllable' ? ' qz-chip' : ''}${isCorrect ? ' is-correct' : ''}${isWrong ? ' is-wrong' : ''}`} disabled={Boolean(feedback)} onClick={() => props.onAnswer(index)}>
                    <span>{T(props.options[index])}</span><span className="qz-opt__mark" aria-hidden="true">{isCorrect ? '✓' : isWrong ? '✗' : ''}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {question.input === 'boolean' ? (
            <div className="qz-bool">
              {([['Đúng', true], ['Sai', false]] as const).map(([word, value]) => {
                const correctValue = question.answer === 1 || question.answer === true;
                const isCorrect = feedback && value === correctValue;
                const isWrong = feedback && feedback.value === value && !feedback.correct;
                return <button key={word} type="button" className={`qz-opt${isCorrect ? ' is-correct' : ''}${isWrong ? ' is-wrong' : ''}`} disabled={Boolean(feedback)} onClick={() => props.onAnswer(value)}><span>{word}</span><span className="qz-opt__mark" aria-hidden="true">{isCorrect ? '✓' : isWrong ? '✗' : ''}</span></button>;
              })}
            </div>
          ) : null}
          {question.input === 'text' ? (
            <div className="qz-text-answer">
              <input ref={props.textInputRef} aria-label="Đáp án của bạn" className={`qz-input${feedback ? feedback.correct ? ' is-correct' : ' is-wrong' : ''}`} type="text" autoComplete="off" value={props.textAnswer} disabled={Boolean(feedback)} onChange={(event) => props.onText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && props.textAnswer.trim() && !feedback) props.onTextEnter(); }} />
              <Button disabled={!props.textAnswer.trim() || Boolean(feedback)} onClick={() => props.onAnswer(props.textAnswer)}>Kiểm tra</Button>
            </div>
          ) : null}
          <div aria-live="polite" className={styles.feedbackSlot}>
            {feedback ? (
              <div className={`qz-feedback ${feedback.correct ? 'ok' : 'no'}`}>
                <strong>{feedback.correct ? 'Đúng.' : 'Sai.'}</strong>
                {!feedback.correct && feedback.correctText ? <p>Đáp án đúng: <b>{T(feedback.correctText)}</b></p> : null}
                {feedback.correct && feedback.corrected ? <p>Đáp án chuẩn: <b>{T(feedback.corrected)}</b></p> : null}
                {feedback.explain ? <p>{T(feedback.explain)}</p> : null}
                {feedback.correct && feedback.provisional ? <p>Đã ghi nhận. Trả lời đúng thêm 1 câu dạng khác của {area.grammar ? 'điểm này' : 'từ này'} để được tính vào tiến độ.</p> : null}
                {!feedback.correct && feedback.articleUrl ? <p><a href={feedback.articleUrl} target="_blank" rel="noopener noreferrer">Ôn lại bài</a></p> : null}
                {feedback.cardKey ? <Button variant="text" aria-haspopup="dialog" onClick={(event) => openCard(feedback.cardKey!, event.currentTarget)}>Xem nhanh thẻ từ</Button> : null}
              </div>
            ) : null}
          </div>
          {feedback ? <div className={styles.actions}><Button ref={props.nextButtonRef} onClick={props.onNext}>Câu tiếp theo</Button></div> : null}
        </article>
      </section>
    );
  } else if (phase === 'finishing') {
    body = <p className={styles.muted} role="status">Đang lưu phần tiến độ cuối và tổng kết phiên…</p>;
  } else if (phase === 'summary' && result) {
    body = (
      <section className={styles.panel} aria-labelledby="qr-summary-title">
        <h1 ref={props.summaryHeadingRef} tabIndex={-1} id="qr-summary-title" className={styles.heading}>Xong phiên</h1>
        <dl className={styles.tiles}>
          <div><dt>Thời gian</dt><dd>{props.formatDuration(result.durationSeconds)}</dd></div>
          <div><dt>Số câu đã làm</dt><dd>{result.totalQuestions}</dd></div>
          <div><dt>{area.masteredNoun}</dt><dd>{result.mastered}/{result.total}</dd></div>
          <div><dt>Độ chính xác</dt><dd>{result.accuracy}%</dd></div>
        </dl>
        <p>Đúng {result.totalCorrect} câu, sai {result.totalWrong} câu.</p>
        {result.hardest?.key && result.hardest.attempts > 1 ? <p>{area.hardestNoun}: <b>{label(result.hardest.key)}</b> ({result.hardest.attempts} lần)</p> : null}
        {result.carriedKeys.length ? (
          <div>
            <h2 className={styles.subheading}>Cần ôn lại ({result.carriedKeys.length})</h2>
            <ul className={styles.chips}>
              {result.carriedKeys.map((key: string) => {
                const normalized = key.toLowerCase();
                return (
                  <li key={key}>
                    {!area.grammar && bank?.word_cards?.[normalized]
                      ? <button type="button" className="qz-chip qz-res-chip" aria-haspopup="dialog" onClick={(event) => openCard(normalized, event.currentTarget)}>{label(key)}</button>
                      : <span className="qz-chip">{label(key)}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {props.reviewRows.length ? (
          <div>
            <div className={styles.reviewHead}>
              <h2 className={styles.subheading}>Xem lại bài làm</h2>
              <Button variant="secondary" onClick={() => setWrongOnly((value) => !value)}>{wrongOnly ? `Hiện tất cả (${props.reviewRows.length})` : `Chỉ câu sai (${props.reviewRows.filter((row) => row.wrongCount > 0).length})`}</Button>
            </div>
            {visibleReviews.length ? visibleReviews.map((row, index) => (
              <div className={`qz-review-item ${!row.correct ? 'is-wrong' : row.wrongCount ? 'is-fixed' : 'is-right'}`} key={`${index}:${row.prompt}`}>
                <strong>{T(row.prompt)}</strong>
                {row.wrongCount > 0 && row.correct && row.wrongGiven != null ? <p>Từng trả lời sai: <b className="is-error">{T(row.wrongGiven)}</b>{row.wrongCount > 1 ? ` (sai ${row.wrongCount} lần)` : ''}</p> : null}
                <p>{row.wrongCount > 0 && row.correct ? 'Sau đó trả lời đúng' : 'Bạn trả lời'}: <b className={row.correct ? 'is-success' : 'is-error'}>{T(row.given)}</b> ({row.correct ? 'đúng' : 'sai'})</p>
                {!row.correct && row.correctText ? <p>Đáp án đúng: <b className="is-success">{T(row.correctText)}</b></p> : null}
                {row.explain ? <p>{T(row.explain)}</p> : null}
                {safeQuizLink(row.article_url) ? <p><a href={safeQuizLink(row.article_url)!} target="_blank" rel="noopener noreferrer">Ôn lại bài</a></p> : null}
              </div>
            )) : <p className={styles.muted}>Không sai câu nào trong phiên này.</p>}
          </div>
        ) : null}
        {!result.saved ? <Notice kind="warning" title="Chưa xác nhận lưu hết tiến độ.">Một phần tiến độ chưa được máy chủ xác nhận. Bạn tải lại trang thống kê trước khi làm lại.</Notice> : null}
        <div className={styles.actions}>
          <Button href={area.backHref}>{area.grammar ? 'Về Grammar' : 'Về Luyện tập'}</Button>
          <Button variant="secondary" href={area.statsHref}>Thống kê của tôi</Button>
        </div>
      </section>
    );
  }

  const unsaved = props.saveStatus.state === 'retrying' || props.saveStatus.state === 'failed' ? props.saveStatus.unsaved : 0;
  return (
    <>
      <ExamRoomShell
        mode="practice"
        surface="drill"
        attemptKey={props.sessionKey}
        title={title}
        subtitle={counter}
        saveStatus={props.saveStatus}
        layout={{ kind: 'single', body: <div className={styles.body}>{body}</div> }}
        exit={{ href: area.backHref, flush: props.flush, losesWork: () => unsaved > 0 }}
        ownerKey={props.ownerKey}
        session={props.session}
        // No copy on this device: Quick Check keeps its unsent answers in the page's outbox.
        onSessionExpired={{ saveLocalCopy: () => false, returnUrl: typeof window === 'undefined' ? '/quiz' : `${window.location.pathname}${window.location.search}` }}
        track={trackDrill}
      />
      <ConfirmDialog
        open={resetOpen}
        tone="warning"
        title="Xoá tiến độ của bài này?"
        body="Toàn bộ tiến độ đã thuộc của bài này sẽ bị xoá và bạn làm lại từ đầu."
        confirmLabel="Xoá và làm lại"
        cancelLabel="Giữ tiến độ"
        onConfirm={() => { void confirmReset(); }}
        onCancel={() => setResetOpen(false)}
      />
      <Dialog
        open={Boolean(selectedCard)}
        onClose={() => { setCardKey(null); cardReturn.current?.focus(); }}
        title={selectedCard?.headword || cardKey || ''}
        size="md"
      >
        {selectedCard ? (
          <div className={styles.card}>
            {selectedCard.pronunciation || selectedCard.syllables ? <p className={styles.muted}>{selectedCard.pronunciation || selectedCard.syllables}</p> : null}
            <p className={styles.muted}>{[selectedCard.part_of_speech, selectedCard.level, selectedCard.register].filter(Boolean).join(' · ')}</p>
            {selectedCard.definition_vi || selectedCard.gloss_vi ? <p>{T(selectedCard.definition_vi || selectedCard.gloss_vi)}</p> : null}
            {selectedCard.definition_en ? <p lang="en">{T(selectedCard.definition_en)}</p> : null}
            <VocabularyAudioButton url={safeQuizLink(selectedCard.audio_headword)} say={selectedCard.headword || cardKey} label="Nghe phát âm" className="av-button av-button-secondary av-button-sm">Nghe phát âm</VocabularyAudioButton>
            {selectedCard.example ? <div><h3 className={styles.subheading}>Ví dụ</h3><p lang="en">{T(selectedCard.example)}</p></div> : null}
            {([['Cụm từ thường gặp', selectedCard.collocations], ['Đồng nghĩa', selectedCard.synonyms], ['Trái nghĩa', selectedCard.antonyms], ['Họ từ', selectedCard.word_family], ['Từ liên quan', selectedCard.related_words]] as const).map(([heading, value]) => {
              const rows = props.stringList(value);
              return rows.length ? <div key={heading}><h3 className={styles.subheading}>{heading}</h3><ul className={styles.chips}>{rows.map((row) => <li key={row}><span className="qz-chip">{row}</span></li>)}</ul></div> : null;
            })}
            {selectedCard.common_error ? <Notice kind="warning" title="Lỗi thường gặp." live="none">{T(selectedCard.common_error)}</Notice> : null}
            {selectedCard.memory_hook ? <Notice kind="info" title="Mẹo ghi nhớ." live="none">{T(selectedCard.memory_hook)}</Notice> : null}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
