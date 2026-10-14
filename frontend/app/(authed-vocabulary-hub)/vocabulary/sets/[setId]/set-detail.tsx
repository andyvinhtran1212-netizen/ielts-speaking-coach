'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { postBrowserJsonAt } from '@/lib/browser-api';
import { VocabularyAccount, VocabularyNav, useVocabularyResource, useAlive, VocabError, modeLabels, messageOf, type StudyMode } from '@/components/vocabulary-workspace';
import type { components } from '@/types/api';

export function VocabularySetDetail({ setId }: { setId: string }) {
  return <VocabularyAccount>{key => <Detail key={`${key}:${setId}`} setId={setId} account={key} />}</VocabularyAccount>;
}

function Detail({ setId, account }: { setId: string; account: string }) {
  const resource = useVocabularyResource('/api/vocabulary-sets/{set_id}', `/api/vocabulary-sets/${encodeURIComponent(setId)}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<components['schemas']['SessionStart'] | null>(null);
  const alive = useAlive();
  const router = useRouter();
  const key = `vocab-set-start:${account}:${setId}`;
  async function start(mode: StudyMode, review = false) {
    if (busy) return;
    setError(''); setBusy(true);
    try {
      if (!pending.current) {
        try { const raw = sessionStorage.getItem(key); if (raw) pending.current = JSON.parse(raw); } catch { /* backend still owns sessions */ }
      }
      pending.current ||= { client_id: crypto.randomUUID(), mode, review_only: review };
      try { sessionStorage.setItem(key, JSON.stringify(pending.current)); } catch { /* same-turn retries retain ref */ }
      const result = await postBrowserJsonAt('/api/vocabulary-sets/{set_id}/sessions', `/api/vocabulary-sets/${setId}/sessions`, pending.current);
      if (alive.current) { try { sessionStorage.removeItem(key); } catch {} pending.current = null; router.push(`/vocabulary/study/${result.id}`); }
    } catch (e) { if (alive.current) setError(messageOf(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  const set = resource.data;
  const due = set?.progress?.filter(p => p.next_review_at && new Date(p.next_review_at).getTime() <= Date.now()).length || 0;
  return <main className="vs-workspace"><VocabularyNav active="sets" /><Link href="/vocabulary/hub?view=sets">← Bộ từ của bạn</Link>
    {resource.error ? <VocabError message={resource.error} retry={resource.retry} /> : !set ? <p role="status">Đang tải bộ từ…</p> : <>
      <header className="vs-section"><p className="vs-eyebrow">{set.library ? 'Thư viện chung' : 'Bộ từ được phân cho lớp'}</p><h1>{set.title}</h1><p>{set.description}</p><p className="vs-meta">{set.card_ids.length} từ · bản xuất bản {set.published_revision}</p></header>
      {error && <VocabError message={error} retry={() => { if (pending.current) void start(pending.current.mode, pending.current.review_only); else resource.retry(); }} />}
      <section aria-labelledby="vs-modes"><h2 id="vs-modes">Chọn cách học</h2><div className="vs-mode-grid">{(Object.keys(modeLabels) as StudyMode[]).map(mode => {
        const count = set.mode_counts?.[mode] || 0;
        return <article className="vs-mode" key={mode}><h3>{modeLabels[mode]}</h3><p className="vs-meta">{mode === 'flashcards' ? 'Lật thẻ, nghe phát âm và tự đánh giá độ nhớ.' : mode === 'learn' ? 'Nhớ từ từ nghĩa, nhận sửa sau mỗi câu.' : mode === 'cloze' ? 'Điền từ vào ví dụ đã có trong bộ.' : 'Trả lời toàn bộ rồi nhận kết quả đã lưu.'}</p><p>{count} {mode === 'flashcards' ? 'thẻ' : 'câu'}{count < set.card_ids.length ? ` / ${set.card_ids.length} từ đủ nội dung` : ''}</p><button className={mode === 'flashcards' ? 'av-button-primary' : ''} disabled={busy || !count || !!error} onClick={() => void start(mode)}>{busy ? 'Đang mở phiên…' : count ? `Bắt đầu ${modeLabels[mode].toLowerCase()}` : 'Chưa đủ nội dung'}</button></article>;
      })}</div></section>
      <section className="vs-stats" aria-label="Tiến độ của bộ"><div><strong>{set.progress?.filter(p => p.familiar).length || 0}</strong>Tự đánh giá nhớ</div><div><strong>{set.progress?.filter(p => p.recall_correct > 0).length || 0}</strong>Từ đã trả lời đúng</div><div><strong>{due}</strong>Từ đến hạn ôn</div></section>
      {due > 0 && <button disabled={busy || !!error} onClick={() => void start('flashcards', true)}>Ôn {due} từ đến hạn</button>}
      <section className="vs-section"><h2>Các từ trong bộ</h2><ul className="vs-card-list">{set.cards?.map(c => <li key={c.id}><div className="vs-word"><strong>{c.headword}</strong> <span className="vs-meta">{c.pronunciation} · {c.part_of_speech}{c.level ? ` · CEFR ${c.level}` : ''}</span><p>{c.gloss_vi || c.definition_en}</p>{c.example && <p className="vs-meta">{c.example}</p>}</div><Link href={`/vocabulary?cat=${encodeURIComponent(c.category)}&slug=${encodeURIComponent(c.slug)}`}>Tra cứu</Link></li>)}</ul></section>
    </>}
  </main>;
}
