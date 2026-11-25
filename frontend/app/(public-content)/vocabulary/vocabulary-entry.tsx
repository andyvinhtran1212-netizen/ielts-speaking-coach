/**
 * One Vocabulary entry (LIBRARY-0061 T015; tờ TuVung màn 2, 3a, 3d), rendered
 * on the server inside the shared Library reading template (T007).
 *
 * A section with no data is left out, with its line in the contents, and the
 * remaining sections are numbered without gaps (FR-054). IPA sits in
 * `.av2-ipa` (Source Sans 3) and is printed exactly as stored, so "ɡ" (U+0261)
 * is kept (FR-052).
 *
 * Not in this task: "Trong bài mẫu Writing" (FR-054, second half) waits for the
 * Writing sample page of T010 so the link has somewhere to open; a second
 * voice waits for data.
 */
import { Fragment, type ReactNode } from 'react';

import { ListenButton } from '@/components/library/listen-button';
import { ReadingBlock, ReadingLayout, type ReadingTocItem } from '@/components/library/reading-layout';
import { SaveWordButton } from '@/components/library/save-word-button';
import type { VocabularyArticle } from '@/lib/vocabulary-types';

import { EntryFlag, EntryViewBeacon } from './vocabulary-entry-client';
import styles from './vocabulary.module.css';

function HighlightedExample({ example, headword }: { example: string; headword: string }) {
  if (!headword) return <>{example}</>;
  const escaped = headword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pieces = example.split(new RegExp(`(${escaped})`, 'ig'));
  return <>{pieces.map((piece, index) => (piece.toLowerCase() === headword.toLowerCase()
    ? <mark className={styles.headwordMark} key={index}>{piece}</mark>
    : <Fragment key={index}>{piece}</Fragment>))}</>;
}

function WordList({ values }: { values: string[] }) {
  return <>{values.map((value, index) => <Fragment key={`${value}-${index}`}>{index ? <span className={styles.sep}> · </span> : null}<b>{value}</b></Fragment>)}</>;
}

type Section = { id: string; label: string; body: ReactNode; notes?: ReactNode };

/** Sections that have data, in reading order. Exported for tests. */
export function entrySections(article: VocabularyArticle): Section[] {
  const definitionVi = article.definitionVi.trim() || article.glossVi.trim();
  const sections: Section[] = [];
  if (article.definitionEn.trim() || definitionVi || article.example.trim()) {
    sections.push({
      id: 'nghia',
      label: 'Nghĩa và ví dụ',
      body: (
        <>
          {article.definitionEn.trim() ? <p className={styles.defEn}>{article.definitionEn}</p> : null}
          {definitionVi ? <p className={styles.defVi}>{definitionVi}</p> : null}
          {article.example.trim() ? (
            <blockquote className={styles.example}>
              <p>“<HighlightedExample example={article.example} headword={article.headword} />”</p>
              <ListenButton url={article.audioExample} label={`Nghe câu ví dụ của ${article.headword}`} small />
            </blockquote>
          ) : null}
        </>
      ),
      notes: article.register.trim() && article.register.trim() !== 'neutral'
        ? <p className={styles.note}><span className={styles.noteLabel}>Văn phong</span> {article.register}</p>
        : undefined,
    });
  }
  if (article.collocations.length) {
    sections.push({
      id: 'ket-hop',
      label: 'Kết hợp từ',
      body: <ul className={styles.chips}>{article.collocations.map((item) => <li key={item}>{item}</li>)}</ul>,
    });
  }
  const network: Array<[string, string[]]> = [
    ['Đồng nghĩa', article.synonyms],
    ['Trái nghĩa', article.antonyms],
    ['Từ liên quan', article.relatedWords],
  ];
  if (network.some(([, values]) => values.length)) {
    sections.push({
      id: 'dong-nghia',
      label: 'Từ đồng nghĩa và liên quan',
      body: (
        <dl className={styles.net}>
          {network.filter(([, values]) => values.length).map(([label, values]) => (
            <Fragment key={label}><dt>{label}</dt><dd><WordList values={values} /></dd></Fragment>
          ))}
        </dl>
      ),
    });
  }
  if (article.wordFamily.length) {
    sections.push({ id: 'ho-tu', label: 'Họ từ', body: <p><WordList values={article.wordFamily} /></p> });
  }
  if (article.commonError.trim()) {
    sections.push({ id: 'loi', label: 'Lỗi người Việt hay mắc', body: <p className={styles.callout}>{article.commonError}</p> });
  }
  if (article.memoryHook.trim()) {
    sections.push({ id: 'meo', label: 'Mẹo nhớ', body: <p className={styles.callout}>{article.memoryHook}</p> });
  }
  const structured = article.example.trim() || article.memoryHook.trim();
  const fallbackHtml = structured ? '' : article.html.replace(/^\s*<p>[\s\S]*?<\/p>\s*/, '').trim();
  if (fallbackHtml) {
    // Markdown-only entries: the backend's rendered body, as the wiki showed it before.
    sections.push({ id: 'ghi-chu', label: 'Ghi chú', body: <div className={styles.html} dangerouslySetInnerHTML={{ __html: fallbackHtml }} /> });
  }
  return sections;
}

function prettyCategory(value: string) {
  return value.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function VocabularyEntry({ article }: { article: VocabularyArticle }) {
  const sections = entrySections(article);
  const toc: ReadingTocItem[] = sections.map((section, index) => ({ id: section.id, label: section.label, n: String(index + 1) }));
  const header = (
    <>
      <p className={styles.eyebrow}>Từ vựng · <a href={`/vocabulary?cat=${encodeURIComponent(article.category)}`}>Chủ đề: {prettyCategory(article.category)}</a></p>
      <h1 className={styles.headword}>{article.headword}</h1>
      <p className={styles.meta}>
        {[article.partOfSpeech, article.level ? `Trình độ ${article.level}` : ''].filter(Boolean).join(' · ')}
      </p>
      {article.pronunciation ? (
        <p className={styles.pron}>
          <span className="av2-ipa">{article.pronunciation}</span>
          <ListenButton url={article.audioHeadword} label={`Nghe ${article.headword}`} />
        </p>
      ) : <p className={styles.pron}><ListenButton url={article.audioHeadword} label={`Nghe ${article.headword}`} /></p>}
      <div className={styles.headerActions}>
        <SaveWordButton target={{
          category: article.category,
          slug: article.slug,
          headword: article.headword,
          definitionVi: article.definitionVi.trim() || article.glossVi,
          example: article.example,
        }} />
        <EntryFlag category={article.category} slug={article.slug} />
      </div>
      <EntryViewBeacon category={article.category} slug={article.slug} />
    </>
  );
  return (
    <ReadingLayout toc={toc} header={header} tocLabel="Trong mục từ này">
      {sections.map((section, index) => (
        <ReadingBlock key={section.id} notes={section.notes}>
          <h2 id={section.id} className={styles.sectionHeading}>{index + 1} · {section.label}</h2>
          {section.body}
        </ReadingBlock>
      ))}
      {!sections.length ? <ReadingBlock><p className={styles.empty}>Mục từ này chưa có phần giải thích.</p></ReadingBlock> : null}
    </ReadingLayout>
  );
}
