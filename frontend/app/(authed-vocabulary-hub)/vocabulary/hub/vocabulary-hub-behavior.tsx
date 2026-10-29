'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-api';
import { VocabularyAccount, VocabularyNav, VocabError, SetTile, useVocabularyResource } from '@/components/vocabulary-workspace';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

export function VocabularyHubBehavior() {
  return <VocabularyAccount>{key => <Hub key={key} />}</VocabularyAccount>;
}

// PC-J147 — the chrome on this page is `role-source="page"`: it skips its own
// /auth/me and takes the staff role from this read. A failed read leaves the
// staff link unrendered (fail-closed, as the chrome's own lookup does).
function shareRoleWithChrome(role: string | null) {
  void customElements.whenDefined('aver-chrome').then(() => {
    const chrome = document.querySelector('aver-chrome') as (Element & { setRole?: (role: string | null) => void }) | null;
    chrome?.setRole?.(role);
  });
}

function Hub() {
  const params = useSearchParams();
  const router = useRouter();
  const requested = params?.get('view');
  const view = requested === 'sets' || requested === 'review' || requested === 'lookup' ? requested : 'today';
  const catalog = useVocabularyResource('/api/vocabulary-sets', '/api/vocabulary-sets');
  const [course, setCourse] = useState('');
  const [stats, setStats] = useState<{ saved: number; recalled: number; quizzes: number } | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [flags, setFlags] = useState({ flashcards: false, d1: false, curated: false });
  useEffect(() => {
    const legacy = window.location.hash;
    const target = legacy === '#vocab-topics' ? 'lookup' : legacy === '#flashcards' || legacy === '#exercises' ? 'review' : null;
    if (target) router.replace(`/vocabulary/hub?view=${target}`);
  }, [router]);
  useEffect(() => {
    const controller = new AbortController();
    let dead = false;
    // A remount for another account (BL-08) must not keep the previous role.
    shareRoleWithChrome(null);
    (async () => {
      if (!await whenGlobalReady(() => !!window.api?.getWith, 'Vocabulary summary') || dead) return;
      const [summary, profile] = await Promise.allSettled([
        window.api.getWith<{ skills?: { vocabulary?: { wallet_words?: number; quiz_words_mastered?: number; quiz_sessions?: number } } }>('/api/student/home-summary', undefined, { signal: controller.signal }),
        getCurrentUser(controller.signal),
      ]);
      if (dead) return;
      if (summary.status === 'fulfilled' && summary.value.skills?.vocabulary) {
        const v = summary.value.skills.vocabulary;
        setStats({ saved: v.wallet_words || 0, recalled: v.quiz_words_mastered || 0, quizzes: v.quiz_sessions || 0 });
      } else setStatsError(true);
      if (profile.status === 'fulfilled') {
        setFlags({ flashcards: profile.value.flashcard_enabled === true, d1: profile.value.d1_enabled === true, curated: profile.value.vocab_curated_enabled === true });
        shareRoleWithChrome(profile.value.role ?? null);
      }
    })();
    return () => { dead = true; controller.abort(); };
  }, []);
  const data = catalog.data;
  const sets = data?.sets.filter(s => !course || s.library || s.course_ids.includes(course) || s.cohort_ids.some(id => data.cohorts.some(c => c.id === id && c.course_id === course))) || [];
  const available = new Set(data?.sets.map(s => s.id));
  const resumable = data?.sessions?.find(s => !s.completed && available.has(s.set_id));
  const dueSets = data?.sets.filter(s => s.progress?.some(p => p.next_review_at && new Date(p.next_review_at).getTime() <= Date.now())) || [];
  const names = (ids: string[], classes: string[]) => [...(data?.courses.filter(c => ids.includes(c.id)).map(c => c.name) || []), ...(data?.cohorts.filter(c => classes.includes(c.id)).map(c => c.name) || [])];
  return <main className="vs-workspace">
    <header><p className="vs-eyebrow">Vocabulary</p><h1>Học từ vựng</h1><p className="vs-meta">Bộ từ theo lớp, các cách học trong cùng một nơi.</p></header>
    <VocabularyNav active={view} />
    {view === 'today' && <>
      <section className="vs-hero" aria-labelledby="vs-today"><p className="vs-eyebrow">Bước tiếp theo</p><h2 id="vs-today">{resumable ? 'Tiếp tục phiên đang học' : 'Chọn bộ từ để bắt đầu'}</h2>
        <p>{resumable ? `${resumable.title} · đã làm ${resumable.answered}/${resumable.total}` : 'Bộ từ được giáo viên chuẩn bị cho khóa/lớp của bạn. Mở một bộ để chọn cách học.'}</p>
        <Link className="av-button av-button-primary" href={resumable ? `/vocabulary/study/${resumable.id}` : '/vocabulary/hub?view=sets'}>{resumable ? 'Tiếp tục học' : 'Xem bộ từ của lớp'}</Link>
      </section>
      {catalog.error && <VocabError message={catalog.error} retry={catalog.retry} />}
      {!data && !catalog.error && <p role="status">Đang tải bộ từ của bạn…</p>}
      {data && <section className="vs-section"><h2>Bộ từ của bạn</h2>{sets.length ? <div className="vs-grid">{sets.slice(0, 3).map(s => <SetTile key={s.id} set={s} courseNames={names(s.course_ids, s.cohort_ids)} />)}</div> : <p className="vs-empty">Chưa có bộ từ được phân. Bạn vẫn có thể tra cứu và ôn từ đã lưu.</p>}</section>}
      {flags.curated && <Link className="av-button" href="/vocabulary/learn">Học có chủ đích</Link>}
      <section className="vs-stats" aria-label="Lịch sử từ vựng cá nhân"><div><strong>{stats?.saved ?? '—'}</strong>Từ đã lưu</div><div><strong>{stats?.recalled ?? '—'}</strong>Từ đạt Quick Check</div><div><strong>{stats?.quizzes ?? '—'}</strong>Phiên Quick Check</div></section>
      {statsError && <p className="vs-meta" role="status">Chưa tải được lịch sử từ vựng cá nhân.</p>}
    </>}
    {view === 'sets' && <section><h2>Bộ từ theo lớp</h2><p className="vs-meta">Khóa học và lớp học là phạm vi được phân; CEFR trên mỗi từ là độ khó ngôn ngữ.</p>
      <label>Lọc theo khóa học<select value={course} onChange={e => setCourse(e.target.value)}><option value="">Tất cả bộ được phân</option>{data?.courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {catalog.error ? <VocabError message={catalog.error} retry={catalog.retry} /> : !data ? <p role="status">Đang tải bộ từ…</p> : sets.length ? <div className="vs-grid">{sets.map(s => <SetTile key={s.id} set={s} courseNames={names(s.course_ids, s.cohort_ids)} />)}</div> : <p className="vs-empty">Chưa có bộ từ trong lựa chọn này.</p>}
    </section>}
    {view === 'review' && <>
      <section><h2>Đến hạn ôn</h2><p className="vs-meta">Lịch ôn từ bộ lớp lưu theo tài khoản sau mỗi lần học.</p>{catalog.error ? <VocabError message={catalog.error} retry={catalog.retry} /> : !data ? <p role="status">Đang tải lịch ôn…</p> : dueSets.length ? <div className="vs-grid">{dueSets.map(s => <SetTile key={s.id} set={s} courseNames={names(s.course_ids, s.cohort_ids)} />)}</div> : <p className="vs-empty">Chưa có từ trong bộ lớp đến hạn ôn.</p>}</section>
      <section className="vs-panel vs-section"><h2>Từ cá nhân và bài luyện hiện có</h2><p>Từ đã lưu, Quick Check và bài điền từ giữ nguyên lịch sử của bạn.</p><div className="vs-actions">{flags.flashcards && <Link className="av-button" href="/flashcards">Ôn từ đã lưu</Link>}<Link className="av-button" href="/vocabulary/practice">Quick Check theo chủ đề</Link>{flags.d1 && <Link className="av-button" href="/d1-exercise">Điền từ cá nhân</Link>}<Link className="av-button" href="/quiz/progress?skill_area=vocab">Lịch sử Quick Check</Link></div></section>
      <section className="vs-section"><h2>Phiên bộ từ gần đây</h2>{data?.sessions?.length ? <ul className="vs-card-list">{data.sessions?.map(s => <li key={s.id}><div className="vs-word"><Link href={`/vocabulary/study/${s.id}`}>{s.title}</Link><p className="vs-meta">{s.completed ? 'Hoàn tất' : 'Đang học'} · {s.answered}/{s.total} · {s.mode === 'flashcards' ? 'Tự đánh giá thẻ' : s.correct == null ? 'Chưa tổng kết' : `${s.correct} câu đúng`}</p></div><Link className="av-button" href={`/vocabulary/study/${s.id}`}>Mở phiên</Link></li>)}</ul> : <p className="vs-empty">Chưa có phiên học bộ từ.</p>}</section>
    </>}
    {view === 'lookup' && <section><h2>Tra cứu và thư viện mở</h2><p>Đọc nghĩa, phát âm và ví dụ trước khi luyện tập.</p><div className="vs-grid">
      <article className="vs-tile"><p className="vs-eyebrow">Theo chủ đề</p><h3>Wiki từ vựng</h3><p>Tìm từ, nghĩa, ví dụ và cách dùng trong IELTS.</p><Link className="av-button" href="/vocabulary">Tra cứu từ vựng</Link></article>
      <article className="vs-tile"><p className="vs-eyebrow">Theo kỳ thi</p><h3>AWL · TOEIC · THPT</h3><p>Khám phá bộ sưu tập từ vựng và học thẻ theo danh sách.</p><Link className="av-button" href="/vocabulary/exam">Mở thư viện kỳ thi</Link></article>
      <article className="vs-tile"><p className="vs-eyebrow">Luyện tập hiện có</p><h3>Quick Check</h3><p>Ngân hàng câu hỏi theo chủ đề và kết quả đã lưu.</p><Link className="av-button" href="/vocabulary/practice">Chọn chủ đề luyện</Link></article>
    </div><TopicLibrary /></section>}
  </main>;
}

function TopicLibrary() {
  const r = useVocabularyResource('/api/vocabulary/categories', '/api/vocabulary/categories');
  const groups = (Array.isArray(r.data) ? r.data : []).flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const slug = typeof row.slug === 'string' ? row.slug.trim() : '';
    const count = Number(row.article_count ?? (Array.isArray(row.articles) ? row.articles.length : 0));
    if (!slug || !Number.isFinite(count) || count <= 0) return [];
    return [{ slug, title: typeof row.title === 'string' ? row.title : slug, count: Math.trunc(count),
      topic: typeof row.topic_id === 'string' || typeof row.topic_id === 'number' ? String(row.topic_id) : '' }];
  });
  return <section className="vs-section"><h2>Thư viện theo chủ đề</h2><p className="vs-meta">Bộ sưu tập mở. Số từ tra cứu và số câu Quick Check có thể khác nhau.</p>
    {r.error ? <VocabError message={r.error} retry={r.retry} /> : !r.data ? <p role="status">Đang tải chủ đề…</p> : !groups.length ? <p className="vs-empty">Chưa có chủ đề.</p> : <div className="vs-grid">{groups.map(g => {
      const encodedSlug = encodeURIComponent(g.slug);
      const practiceHref = `/quiz?skill_area=vocab${g.topic ? `&topic_id=${encodeURIComponent(g.topic)}` : ''}`;
      return <article className="vs-tile" key={g.slug}><h3>{g.title}</h3><p>{g.count} từ tra cứu</p><div className="vs-actions"><Link className="av-button" href={`/vocabulary?cat=${encodedSlug}`}>Tra cứu chủ đề</Link><Link className="av-button" href={`/flashcard-study?stack=wiki:${encodedSlug}`}>Học thẻ chủ đề</Link>{g.topic && <Link className="av-button" href={practiceHref}>Quick Check</Link>}</div></article>;
    })}</div>}
  </section>;
}
