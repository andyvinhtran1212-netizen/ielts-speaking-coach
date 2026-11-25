// `/library/speaking/[slug]` — one Speaking question with its model answer
// (LIBRARY-0061 T013; tờ DeSpeaking). Public (FR-001).
//
// Sections, numbered without gaps and left out when empty: 1 Thẻ đề / Câu hỏi,
// 2 Video trả lời mẫu (or "Câu trả lời mẫu" with audio; none without media),
// 3 Lời thoại và ghi chú, 4 Dàn ý trả lời, 5 Từ vựng theo chủ đề, 6 Câu hỏi
// Part 3 liên quan, 7 Luyện nói đề này. The answer never carries a band.
// Section 7 holds the page's one way to the courses (FR-003).
//
// Not in this task: the course-aware "Luyện nói đề này" button (needs G04
// access data and the G08 player), "Chấm thử miễn phí" (G05-T21), "Lưu vào sổ
// từ" on the vocabulary list (T015) and links to vocabulary entries.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { MarginNote } from '@/components/library/margin-note';
import { ReadingBlock, ReadingLayout, type ReadingTocItem } from '@/components/library/reading-layout';
import type { PlayerSource } from '@/components/library/video-player';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { PageState } from '@/components/ui/page-state';
import { API_BASE } from '@/lib/backend';
import { formatClock } from '@/lib/library-cues.mjs';

import { getLibrary, speakingHref, SPEAKING_PATH, type SpeakingDetail } from '../speaking-data';
import styles from '../speaking.module.css';
import { SpeakingAnswer, type AnswerSection } from './speaking-answer';
import { speakingSections, type Section } from './speaking-sections';

type Params = Promise<{ slug: string }>;

const SHELF_LABEL = 'Đề Speaking và video trả lời mẫu';
const KIND_WORDS = { video: 'video', audio: 'câu trả lời mẫu dạng audio', text: 'câu trả lời mẫu dạng chữ' } as const;

async function loadDetail(slug: string) {
  return getLibrary<SpeakingDetail>(`/api/library/speaking/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const found = await loadDetail(slug);
  // A missing question: the 404 body and noindex. Under cacheComponents the
  // status is already committed by the shell (HTTP 200), as on the Grammar
  // article route; a hard 404 needs a proxy check (follow-up, like PC-J526).
  if (!found.ok && found.status === 404) notFound();
  if (!found.ok) return { title: 'Đề Speaking | Aver Learning', robots: { index: false, follow: true } };
  const q = found.data;
  return {
    title: `${q.title_en} — IELTS Speaking Part ${q.part}: câu trả lời mẫu | Aver Learning`,
    description: `Câu trả lời mẫu IELTS Speaking Part ${q.part} cho đề “${q.title_en}”: ${KIND_WORDS[q.answer_kind]}, lời thoại, dàn ý và từ vựng. Giọng đọc tổng hợp, miễn phí.`,
    alternates: { canonical: speakingHref(q.slug) },
  };
}

function playerSource(q: SpeakingDetail): PlayerSource | null {
  if (q.media.video_source === 'youtube' && q.media.youtube_id) return { kind: 'youtube', id: q.media.youtube_id };
  if (q.media.video_source === 'self_hosted' && q.media.video_url) return { kind: 'self_hosted', url: q.media.video_url };
  // The media route lives on the backend (no /api rewrite on the site), and the
  // browser fetches it directly, so its per-IP limit sees each reader's own IP.
  if (q.media.audio_url) return { kind: 'audio', url: q.media.audio_url.startsWith('/') ? `${API_BASE}${q.media.audio_url}` : q.media.audio_url };
  return null;
}

function Heading({ section, n }: { section: Section; n: string }) {
  return (
    <h2 id={section.id} className={styles.sectionHeading}>
      <span className={styles.sectionNum}>{n}</span> {section.label}
    </h2>
  );
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

function QuestionPage({ q }: { q: SpeakingDetail }) {
  const source = playerSource(q);
  const sections = speakingSections(q, source !== null);
  const num = new Map(sections.map((s, i) => [s.id, String(i + 1)]));
  const toc: ReadingTocItem[] = sections.map((s) => ({ id: s.id, label: s.label, n: num.get(s.id) }));
  const at = (id: string) => sections.find((s) => s.id === id);
  const answerSection = (id: string): AnswerSection | null => {
    const s = at(id);
    return s ? { ...s, n: num.get(id) ?? '' } : null;
  };
  const updated = formatDate(q.updated_at);
  const clock = q.answer_kind !== 'text' && q.duration_s ? formatClock(q.duration_s * 1000) : null;
  const eyebrow = [
    `Part ${q.part}`,
    q.topic_label_vi,
    q.answer_kind === 'video' ? 'có video trả lời mẫu' : 'chưa có video',
  ].filter(Boolean).join(' · ');
  const cueSection = at('the-de');
  const outline = at('dan-y');
  const vocab = at('tu-vung');
  const part3 = at('part-3');
  const practice = at('luyen-noi');
  const nextPath = speakingHref(q.slug);

  return (
    <ReadingLayout
      tocLabel="Trên trang này"
      toc={toc}
      tocFooter={(
        <dl className={styles.facts}>
          <dt>Part</dt><dd>Part {q.part}</dd>
          {q.topic_label_vi ? <><dt>Chủ đề</dt><dd>{q.topic_label_vi}</dd></> : null}
          <dt>Video</dt><dd>{q.answer_kind === 'video' ? ['Có', clock].filter(Boolean).join(' · ') : 'chưa có'}</dd>
          {updated ? <><dt>Cập nhật</dt><dd>{updated}</dd></> : null}
        </dl>
      )}
      header={(
        <>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1 lang="en" className={styles.title}>{q.title_en}</h1>
          {q.title_vi ? <p className={styles.titleVi}>{q.title_vi}</p> : null}
          <p className={styles.byline}>
            Câu trả lời mẫu và ghi chú: Aver Learning biên soạn, ví dụ minh hoạ, giọng đọc tổng hợp
            {updated ? ` · Cập nhật ${updated}` : ''}
          </p>
        </>
      )}
    >
      {cueSection ? (
        <ReadingBlock
          notes={q.part === 2 ? (
            <MarginNote n="i">
              Ba dòng dưới &ldquo;You should say&rdquo; và dòng &ldquo;explain&rdquo; là bốn ý nên nói, theo thứ tự. Trong phòng thi
              bạn có 1 phút chuẩn bị, giấy và bút để ghi.
            </MarginNote>
          ) : undefined}
        >
          <Heading section={cueSection} n={num.get('the-de') ?? ''} />
          {q.part === 2 && q.cue_card?.prompt ? (
            <div className={styles.cueCard} lang="en">
              <p className={styles.cuePrompt}>{q.cue_card.prompt}</p>
              {q.cue_card.bullets?.length ? (
                <>
                  <p>You should say:</p>
                  <ul>{q.cue_card.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
                </>
              ) : null}
              {q.cue_card.reflection ? <p>{q.cue_card.reflection}</p> : null}
              <p className={styles.cueRule}>
                You will have to talk about the topic for one to two minutes. You have one minute to think about what you
                are going to say. You can make some notes to help you if you wish.
              </p>
            </div>
          ) : (
            <ol className={styles.questions} lang="en">
              {(q.cue_card?.questions ?? []).map((text) => <li key={text}>{text}</li>)}
            </ol>
          )}
        </ReadingBlock>
      ) : null}

      <SpeakingAnswer
        slug={q.slug}
        title={q.title_en}
        source={source}
        durationS={q.duration_s}
        transcript={q.transcript}
        timed={q.timed}
        playerSection={answerSection('tra-loi-mau')}
        transcriptSection={answerSection('loi-thoai') as AnswerSection}
      />

      {outline ? (
        <ReadingBlock>
          <Heading section={outline} n={num.get('dan-y') ?? ''} />
          <ol className={styles.outline}>{q.outline.map((point, i) => <li key={i}>{point}</li>)}</ol>
        </ReadingBlock>
      ) : null}

      {vocab ? (
        <ReadingBlock>
          <Heading section={vocab} n={num.get('tu-vung') ?? ''} />
          <dl className={styles.vocab}>
            {q.vocabulary.map((word) => (
              <div key={word.term} className={styles.vocabRow}>
                <dt lang="en">{word.term}</dt>
                <dd>
                  {word.meaning_vi}
                  {word.note ? <span className={styles.vocabNote}> · {word.note}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </ReadingBlock>
      ) : null}

      {part3 ? (
        <ReadingBlock>
          <Heading section={part3} n={num.get('part-3') ?? ''} />
          <ol className={styles.questions} lang="en">{q.related_part3.map((text) => <li key={text}>{text}</li>)}</ol>
        </ReadingBlock>
      ) : null}

      {practice ? (
        <ReadingBlock>
          <Heading section={practice} n={num.get('luyen-noi') ?? ''} />
          <p>
            Bạn ghi âm câu trả lời của mình theo nhịp thi và AI chấm theo bốn tiêu chí Speaking, trích đúng câu bạn nói để
            chỉ chỗ cần sửa. Việc này cần một khoá học. Video, lời thoại và ghi chú trên trang này luôn mở miễn phí.
          </p>
          <p className={styles.practiceActions}>
            <a href="/" className={styles.primaryLink}>Xem các khoá</a>
            <a href={`/login?next=${encodeURIComponent(nextPath)}`}>Đã có khoá? Đăng nhập</a>
          </p>
        </ReadingBlock>
      ) : null}

      {q.prev || q.next ? (
        <nav aria-label="Đề trước và đề sau" className={styles.neighbours}>
          {q.prev ? (
            <a href={speakingHref(q.prev.slug)} rel="prev">
              <span className={styles.neighbourLabel}>‹ Đề trước</span>
              <span lang="en">{q.prev.title_en}</span>
            </a>
          ) : <span />}
          {q.next ? (
            <a href={speakingHref(q.next.slug)} rel="next" className={styles.neighbourNext}>
              <span className={styles.neighbourLabel}>Đề sau ›</span>
              <span lang="en">{q.next.title_en}</span>
            </a>
          ) : null}
        </nav>
      ) : null}
    </ReadingLayout>
  );
}

async function QuestionBody({ params }: { params: Params }) {
  await connection();
  const { slug } = await params;
  const found = await loadDetail(slug);
  if (!found.ok && found.status === 404) notFound();
  if (!found.ok) {
    return (
      <PageState
        kind="error"
        title="Chưa tải được đề này"
        body="Máy chủ chưa trả lời. Thử tải lại sau ít phút."
        action={<a href={speakingHref(slug)}>Tải lại</a>}
      />
    );
  }
  const q = found.data;
  return (
    <>
      <Breadcrumb
        items={[
          { label: 'Thư viện', href: '/library' },
          { label: SHELF_LABEL, href: SPEAKING_PATH },
          { label: q.title_en },
        ]}
      />
      <QuestionPage q={q} />
    </>
  );
}

export default function SpeakingQuestionPage({ params }: { params: Params }) {
  return (
    <div className={styles.page}>
      <Suspense fallback={<PageState kind="loading" title="Đang tải đề" />}>
        <QuestionBody params={params} />
      </Suspense>
    </div>
  );
}
