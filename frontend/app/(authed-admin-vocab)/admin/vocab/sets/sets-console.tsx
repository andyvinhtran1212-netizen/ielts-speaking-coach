'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { postBrowserJsonAt } from '@/lib/browser-api';
import { VocabularyAccount, useVocabularyResource, useAlive, VocabError, messageOf, modeLabels, type VocabSet } from '@/components/vocabulary-workspace';
import type { components } from '@/types/api';
type Card = components['schemas']['SharedCard'];
type Save = components['schemas']['SetSave'];

export function AdminVocabularySetList() {
  return <VocabularyAccount>{key => <SetList key={key} />}</VocabularyAccount>;
}
function SetList() {
  const r = useVocabularyResource('/admin/vocabulary-sets', '/admin/vocabulary-sets');
  return <main className="vs-workspace"><Link href="/admin/vocab">← Vocabulary workspace</Link><header className="vs-section"><p className="vs-eyebrow">Nội dung và phân phối</p><h1>Bộ từ theo lớp</h1><p>Tạo bộ từ từ thư viện chung, sắp xếp và phân theo khóa/lớp.</p><Link className="av-button av-button-primary" href="/admin/vocab/sets/new">Tạo bộ từ</Link></header>
    {r.error ? <VocabError message={r.error} retry={r.retry} /> : !r.data ? <p role="status">Đang tải bộ từ…</p> : r.data.sets.length ? <div className="vs-grid">{r.data.sets.map(s => <article className="vs-tile" key={s.id}><p className="vs-eyebrow">{s.status === 'draft' ? 'Bản nháp' : s.status === 'published' ? 'Đã xuất bản' : 'Đã lưu trữ'} · bản {s.published_revision}</p><h2>{s.title}</h2><p>{s.card_ids.length} từ · {s.library ? 'Thư viện chung' : [...r.data!.courses.filter(c => s.course_ids.includes(c.id)), ...r.data!.cohorts.filter(c => s.cohort_ids.includes(c.id))].map(c => c.name).join(' · ') || 'Chưa phân'}</p><Link className="av-button" href={`/admin/vocab/sets/${s.id}`}>Biên tập và kết quả</Link></article>)}</div> : <p className="vs-empty">Chưa có bộ từ. Tạo bộ đầu tiên để phân cho lớp.</p>}
  </main>;
}

export function AdminVocabularySetEditor({ setId }: { setId: string }) {
  return <VocabularyAccount>{key => <AccountEditor key={`${key}:${setId}`} setId={setId} />}</VocabularyAccount>;
}
function AccountEditor({ setId }: { setId: string }) {
  return setId === 'new' ? <Editor initial={null} /> : <Existing setId={setId} />;
}
function Existing({ setId }: { setId: string }) {
  const r = useVocabularyResource('/admin/vocabulary-sets/{set_id}', `/admin/vocabulary-sets/${encodeURIComponent(setId)}`);
  return r.error ? <main className="vs-workspace"><Link href="/admin/vocab/sets">← Bộ từ</Link><VocabError message={r.error} retry={r.retry} /></main> : !r.data ? <p role="status">Đang tải bản nháp…</p> : <Editor initial={r.data} />;
}
function Editor({ initial }: { initial: VocabSet | null }) {
  const audience = useVocabularyResource('/admin/vocabulary-sets', '/admin/vocabulary-sets');
  const [canonical, setCanonical] = useState(initial);
  const [id, setId] = useState(initial?.id || '');
  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [cards, setCards] = useState<Card[]>(initial?.cards || []);
  const [library, setLibrary] = useState(initial?.library || false);
  const [courses, setCourses] = useState(initial?.course_ids || []);
  const [cohorts, setCohorts] = useState(initial?.cohort_ids || []);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const found = useVocabularyResource('/admin/vocabulary-sets/cards', `/admin/vocabulary-sets/cards?q=${encodeURIComponent(search)}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [word, setWord] = useState({ headword: '', category: '', gloss_vi: '', example: '', level: '' });
  const alive = useAlive();
  const router = useRouter();
  useEffect(() => { if (!id) setId(crypto.randomUUID()); }, [id]);
  function toggle(ids: string[], value: string) { return ids.includes(value) ? ids.filter(i => i !== value) : [...ids, value]; }
  const dirty = !canonical || title !== canonical.title || description !== canonical.description || library !== canonical.library
    || JSON.stringify(cards.map(c => c.id)) !== JSON.stringify(canonical.card_ids) || JSON.stringify(courses) !== JSON.stringify(canonical.course_ids) || JSON.stringify(cohorts) !== JSON.stringify(canonical.cohort_ids);
  async function save(action?: 'publish' | 'archive') {
    if (busy || !id) return;
    setBusy(true); setError(''); setNotice('');
    try {
      let saved = canonical;
      if (dirty && action !== 'archive') {
        const body: Save = { expected_version: saved?.version || 0, title, description, card_ids: cards.map(c => c.id), library, course_ids: courses, cohort_ids: cohorts };
        saved = await postBrowserJsonAt('/admin/vocabulary-sets/{set_id}', `/admin/vocabulary-sets/${id}`, body);
        if (!alive.current) return;
        setCanonical(saved);
      }
      if (action && saved) {
        saved = await postBrowserJsonAt('/admin/vocabulary-sets/{set_id}/publication', `/admin/vocabulary-sets/${id}/publication`, { expected_version: saved.version, action });
        if (!alive.current) return;
        setCanonical(saved);
      }
      if (alive.current && saved) { setNotice(action === 'publish' ? 'Đã xuất bản. Học viên trong phạm vi được phân có thể mở bộ từ.' : action === 'archive' ? 'Đã lưu trữ. Lịch sử các phiên học được giữ lại.' : 'Đã lưu bản nháp.'); if (!initial) router.replace(`/admin/vocab/sets/${id}`); }
    } catch (e) { if (alive.current) setError(messageOf(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function addWord(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError(''); setNotice('');
    try {
      const saved = await postBrowserJsonAt('/admin/vocabulary-sets/cards', '/admin/vocabulary-sets/cards', word);
      if (alive.current) { setCards(c => c.some(w => w.id === saved.id) ? c : [...c, saved]); setShowAdd(false); setWord({ headword: '', category: '', gloss_vi: '', example: '', level: '' }); setNotice('Đã thêm từ vào thư viện; lưu bản nháp để giữ từ trong bộ.'); found.retry(); }
    } catch (e) { if (alive.current) setError(messageOf(e)); }
    finally { if (alive.current) setBusy(false); }
  }
  function move(index: number, offset: number) { setCards(old => { const next = [...old]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; }); }
  return <main className="vs-workspace"><Link href="/admin/vocab/sets">← Tất cả bộ từ</Link><header className="vs-section"><p className="vs-eyebrow">Biên tập bộ từ</p><h1>{initial ? initial.title : 'Bộ từ mới'}</h1><p className="vs-meta">{canonical ? `${canonical.status === 'published' ? 'Đã xuất bản' : canonical.status === 'archived' ? 'Đã lưu trữ' : 'Bản nháp'} · phiên bản lưu ${canonical.version} · bản xuất bản ${canonical.published_revision}` : 'Chưa lưu'}{dirty ? ' · có thay đổi chưa lưu' : ''}</p></header>
    {notice && <p className="vs-notice" role="status">{notice}</p>}{error && <div className="vs-notice vs-error" role="alert"><p>{error}</p><p>Giữ nguyên nội dung đang soạn. Nếu có người vừa sửa bộ, tải lại để lấy phiên bản mới.</p><button onClick={() => window.location.reload()}>Tải lại bản đã lưu</button></div>}
    {canonical?.published && <section className="vs-notice"><h2>Bản xuất bản đang lưu</h2><p><strong>{canonical.published.title}</strong> · bản {canonical.published_revision}</p><p>{canonical.published.library ? 'Thư viện chung' : [...(audience.data?.courses.filter(c => canonical.published!.course_ids.includes(c.id)) || []), ...(audience.data?.cohorts.filter(c => canonical.published!.cohort_ids.includes(c.id)) || [])].map(c => c.name).join(' · ') || 'Đang tải tên khóa/lớp'}</p><p className="vs-meta">{canonical.status === 'archived' ? 'Đã lưu trữ: không mở phiên mới, lịch sử được giữ.' : 'Học viên thấy bản xuất bản này. Thay đổi bản nháp chỉ áp dụng sau khi xuất bản lại.'}</p></section>}
    <div className="vs-actions"><button className="av-button-primary" disabled={busy || !dirty || !title.trim() || !id} onClick={() => void save()}>Lưu bản nháp</button><button disabled={busy || !cards.length || (!library && !courses.length && !cohorts.length)} onClick={() => void save('publish')}>Lưu và xuất bản</button><button disabled={busy || !cards.length} onClick={() => setPreview(v => !v)}>{preview ? 'Đóng xem trước' : 'Xem trước bản nháp'}</button>{canonical && canonical.status !== 'archived' && <button disabled={busy || dirty} onClick={() => void save('archive')}>Lưu trữ bộ</button>}</div>
    {preview && <section className="vs-hero"><h2>{title || 'Bộ từ chưa đặt tên'} · xem trước</h2><p>{description}</p><p>{cards.length} từ · {cards.filter(c => !!c.example).length} từ có ví dụ. Chế độ điền từ chỉ dùng ví dụ có chứa đúng từ đích.</p><ul className="vs-card-list">{cards.map(c => <li key={c.id}><div><strong>{c.headword}</strong><p>{c.gloss_vi || c.definition_en}</p><p className="vs-meta">{c.example || 'Chưa có ví dụ'}</p></div></li>)}</ul></section>}
    <div className="vs-editor"><section className="vs-panel"><h2>Nội dung bộ từ</h2><label>Tên bộ<input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} disabled={busy} /></label><label>Mô tả<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} disabled={busy} /></label>
      <h3>Các từ đã chọn ({cards.length}/200)</h3>{!cards.length && <p className="vs-empty">Tìm từ trong thư viện bên cạnh hoặc thêm từ mới.</p>}<ol className="vs-card-list">{cards.map((c, i) => <li key={c.id}><div className="vs-word"><strong>{i + 1}. {c.headword}</strong><p className="vs-meta">{c.gloss_vi || c.definition_en}</p></div><div className="vs-actions"><button aria-label={`Đưa ${c.headword} lên`} disabled={busy || !i} onClick={() => move(i, -1)}>↑</button><button aria-label={`Đưa ${c.headword} xuống`} disabled={busy || i === cards.length - 1} onClick={() => move(i, 1)}>↓</button><button disabled={busy} onClick={() => setCards(old => old.filter(w => w.id !== c.id))} aria-label={`Bỏ ${c.headword} khỏi bộ`}>Bỏ</button></div></li>)}</ol>
      <fieldset disabled={busy}><legend>Đối tượng được học</legend><p className="vs-meta">Khóa học/lớp được phân tách riêng với CEFR của từ. Chỉ bản xuất bản áp dụng cho học viên.</p><label><input type="checkbox" checked={library} onChange={e => setLibrary(e.target.checked)} />Thư viện chung cho mọi học viên</label>{audience.error ? <VocabError message={audience.error} retry={audience.retry} /> : !audience.data ? <p role="status">Đang tải khóa/lớp…</p> : <><h3>Khóa học</h3>{audience.data.courses.map(c => <label key={c.id}><input type="checkbox" checked={courses.includes(c.id)} onChange={() => setCourses(old => toggle(old, c.id))} />{c.name}</label>)}<h3>Lớp học</h3>{audience.data.cohorts.map(c => <label key={c.id}><input type="checkbox" checked={cohorts.includes(c.id)} onChange={() => setCohorts(old => toggle(old, c.id))} />{c.name}</label>)}</>}</fieldset>
    </section><aside className="vs-panel"><h2>Thư viện từ</h2><form onSubmit={e => { e.preventDefault(); setSearch(query); }}><label>Tìm từ<input value={query} onChange={e => setQuery(e.target.value)} maxLength={120} /></label><button type="submit">Tìm trong thư viện</button></form>
      {found.error ? <VocabError message={found.error} retry={found.retry} /> : !found.data ? <p role="status">Đang tải từ…</p> : !found.data.cards.length ? <p className="vs-empty">Không tìm thấy từ.</p> : <ul className="vs-card-list">{found.data.cards.map(c => <li key={c.id}><div className="vs-word"><strong>{c.headword}</strong><p className="vs-meta">{c.gloss_vi || c.definition_en}{c.level ? ` · CEFR ${c.level}` : ''}</p></div><button disabled={busy || cards.some(w => w.id === c.id) || cards.length >= 200} onClick={() => setCards(old => [...old, c])}>{cards.some(w => w.id === c.id) ? 'Đã chọn' : 'Thêm vào bộ'}</button></li>)}</ul>}
      <div className="vs-actions"><button disabled={busy || cards.length >= 200} onClick={() => setShowAdd(v => !v)}>Thêm từ mới</button><Link href="/admin/vocab/content">Nhập hàng loạt / sửa từ</Link></div>
      {showAdd && <form onSubmit={addWord}><h3>Thêm vào thư viện chung</h3>{([['headword','Từ tiếng Anh'],['category','Chủ đề'],['gloss_vi','Nghĩa tiếng Việt'],['example','Ví dụ tiếng Anh'],['level','Độ khó CEFR (tùy chọn)']] as const).map(([field,label]) => <label key={field}>{label}<input value={word[field]} onChange={e => setWord(old => ({ ...old, [field]: e.target.value }))} required={field === 'headword' || field === 'category' || field === 'gloss_vi'} disabled={busy} /></label>)}<button className="av-button-primary" disabled={busy} type="submit">Lưu từ và chọn vào bộ</button></form>}
    </aside></div>
    {canonical && <Outcomes setId={canonical.id} />}
  </main>;
}

function Outcomes({ setId }: { setId: string }) {
  const r = useVocabularyResource('/admin/vocabulary-sets/{set_id}/outcomes', `/admin/vocabulary-sets/${setId}/outcomes`);
  return <section className="vs-panel"><h2>Kết quả học bộ từ</h2><p className="vs-meta">Chỉ hiển thị phiên đã lưu. Tự đánh giá thẻ không được tính thành điểm kiểm tra.</p>{r.error ? <VocabError message={r.error} retry={r.retry} /> : !r.data ? <p role="status">Đang tải kết quả…</p> : !r.data.learners.length ? <p className="vs-empty">Chưa có học viên học bộ từ này.</p> : r.data.learners.map(l => <details key={l.user_id}><summary>{l.name} · {l.sessions.length} phiên</summary><ul className="vs-card-list">{l.sessions.map(s => <li key={s.id}><div><strong>{modeLabels[s.mode]}</strong><p>{s.completed ? 'Hoàn tất' : 'Đang học'} · đã lưu {s.answered}/{s.total}{s.correct !== null && s.correct !== undefined ? ` · ${s.correct} câu đúng` : s.mode === 'flashcards' ? ' · tự đánh giá thẻ' : ' · chưa tổng kết'}</p><p className="vs-meta">{new Date(s.created_at).toLocaleString('vi-VN')}</p></div></li>)}</ul></details>)}</section>;
}
