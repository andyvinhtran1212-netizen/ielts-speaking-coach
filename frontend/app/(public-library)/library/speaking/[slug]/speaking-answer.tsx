'use client';

// Sections 2 and 3 of a Speaking question page (LIBRARY-0061 T013; tờ
// DeSpeaking §1 mục 2–3, §2a–2c): the player and the transcript share one
// clock, so they live in one client component. The whole transcript is in the
// server HTML; only the highlight and the seeking need the browser.
//
// FR-033: the line being spoken is the one with the largest start not after
// the current time; pressing a line seeks there and plays; once the media
// cannot play, times turn into plain text (no button). No media: section 2 is
// "Câu trả lời mẫu" with the compact audio, or is left out and the transcript
// is plain paragraphs. FR-034: marked phrases carry a number and a word label
// in the margin, never colour alone.
import { useRef, useState } from 'react';

import { MarginNote } from '@/components/library/margin-note';
import { ReadingBlock } from '@/components/library/reading-layout';
import { VideoPlayer, type PlayerHandle, type PlayerSource } from '@/components/library/video-player';
import { activeCueIndex, formatClock, markSegments, MARK_LABELS } from '@/lib/library-cues.mjs';

import type { TranscriptLine } from '../speaking-data';
import styles from '../speaking.module.css';

export type AnswerSection = { id: string; n: string; label: string };

export type SpeakingAnswerProps = {
  slug: string;
  title: string;
  source: PlayerSource | null;
  durationS: number | null;
  transcript: TranscriptLine[];
  timed: boolean;
  /** Section 2 (player); null when there is no media. */
  playerSection: AnswerSection | null;
  transcriptSection: AnswerSection;
};

type NumberedLine = {
  line: TranscriptLine;
  parts: ReturnType<typeof markSegments>['parts'];
};

function numberLines(transcript: TranscriptLine[]): NumberedLine[] {
  let next = 1;
  return transcript.map((line) => {
    const out = markSegments(line.text, line.marks, next);
    next = out.next;
    return { line, parts: out.parts };
  });
}

function LineText({ parts }: { parts: NumberedLine['parts'] }) {
  return (
    <>
      {parts.map((part, i) => ('kind' in part ? (
        <mark key={i} className={part.kind === 'vocab' ? styles.markVocab : styles.markStructure}>
          {part.text}
          <sup className={styles.markNum}>{part.n}</sup>
        </mark>
      ) : (
        <span key={i}>{part.text}</span>
      )))}
    </>
  );
}

function LineNotes({ parts }: { parts: NumberedLine['parts'] }) {
  const marks = parts.filter((part) => 'kind' in part);
  if (marks.length === 0) return null;
  return (
    <>
      {marks.map((mark) => ('kind' in mark ? (
        <MarginNote key={mark.n} n={mark.n}>
          <span className={styles.noteKind}>{MARK_LABELS[mark.kind as keyof typeof MARK_LABELS] ?? mark.kind}</span>
          {' · '}
          <span lang="en">{mark.text}</span>
          {mark.note ? `: ${mark.note}` : ''}
        </MarginNote>
      ) : null))}
    </>
  );
}

export function SpeakingAnswer({
  slug, title, source, durationS, transcript, timed, playerSection, transcriptSection,
}: SpeakingAnswerProps) {
  const player = useRef<PlayerHandle>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [broken, setBroken] = useState(false);
  const lines = numberLines(transcript);
  const canSeek = timed && source !== null && !broken;
  const active = canSeek && nowMs !== null ? activeCueIndex(transcript.map((l) => l.start_ms), nowMs) : -1;
  const isVideo = source !== null && source.kind !== 'audio';

  return (
    <>
      {playerSection && source ? (
        <ReadingBlock
          notes={(
            <MarginNote n="i">
              Giọng đọc tổng hợp nói trọn câu trả lời; không phải giọng người thật và không tự phát. Câu trả lời là ví dụ
              minh hoạ, không phải bài thi thật và không gắn band.
            </MarginNote>
          )}
        >
          <h2 id={playerSection.id} className={styles.sectionHeading}>
            <span className={styles.sectionNum}>{playerSection.n}</span> {playerSection.label}
          </h2>
          {!isVideo ? <p className={styles.sectionLead}>Đề này chưa có video. Lời thoại bên dưới đi theo bản đọc.</p> : null}
          <VideoPlayer
            ref={player}
            source={source}
            title={title}
            storageKey={slug}
            durationS={durationS}
            onTime={setNowMs}
            onBroken={setBroken}
          />
        </ReadingBlock>
      ) : null}

      <ReadingBlock>
        <h2 id={transcriptSection.id} className={styles.sectionHeading}>
          <span className={styles.sectionNum}>{transcriptSection.n}</span> {transcriptSection.label}
        </h2>
        {canSeek ? (
          <p className={styles.sectionLead} aria-live="off">
            {active >= 0 ? `Đang ở ${formatClock(nowMs)} · câu ${active + 1}. ` : ''}Bấm vào một câu để tua tới câu đó.
          </p>
        ) : null}
        {timed && broken ? (
          <p className={styles.sectionLead} role="status">
            {isVideo ? 'Video' : 'Bản đọc'} chưa phát được nên tạm tắt tua theo câu. Bạn vẫn đọc được toàn bộ lời thoại và ghi chú.
          </p>
        ) : null}
      </ReadingBlock>
      <ol className={styles.transcript} lang="en" data-testid="speaking-transcript">
        {lines.map(({ line, parts }, i) => {
          const clock = timed ? formatClock(line.start_ms) : null;
          const current = i === active;
          return (
            <li key={i} className={current ? `${styles.line} ${styles.lineOn}` : styles.line} aria-current={current ? 'true' : undefined}>
              <ReadingBlock notes={<LineNotes parts={parts} />}>
                {canSeek && line.start_ms !== null ? (
                  <button
                    type="button"
                    className={styles.lineButton}
                    onClick={() => player.current?.seekTo(line.start_ms as number)}
                    aria-label={`Tua tới ${clock}: ${line.text}`}
                  >
                    <span className={styles.lineTime}>{clock}</span>
                    <span className={styles.lineText}><LineText parts={parts} /></span>
                  </button>
                ) : (
                  <p className={styles.linePlain}>
                    {clock ? <span className={styles.lineTime}>{clock}</span> : null}
                    <span className={styles.lineText}><LineText parts={parts} /></span>
                  </p>
                )}
              </ReadingBlock>
            </li>
          );
        })}
      </ol>
    </>
  );
}
