'use client';
import { useRef, useState } from 'react';
import { formatGrammarMatchScore, normalizeGrammarRecommendPayload } from '@/lib/admin-grammar-recommend-model.mjs';

type Candidate = { slug: string; category: string; title: string; url: string; status: string; score: number; summary: string | null; anchor: string | null };
type Result = { issue: string; outcome: 'matched' | 'below_threshold' | 'draft_suppressed'; match: Candidate | null; candidate: Candidate | null };
const presets = ['nhầm thì quá khứ và hiện tại hoàn thành khi kể câu chuyện', 'dùng giới từ chưa chính xác', 'câu phức và mệnh đề quan hệ', 'thiếu mạo từ trước danh từ'];
function messageOf(value: unknown) { return value instanceof Error ? value.message : String(value || 'Không đọc được kết quả.'); }

export function AdminGrammarRecommend() {
  const [issue, setIssue] = useState(''); const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null); const seq = useRef(0);
  const run = async (raw = issue) => {
    const clean = raw.trim(); if (!clean) { setError('Nhập mô tả lỗi trước khi chạy matcher.'); return; }
    const id = ++seq.current; setLoading(true); setError(null); setResult(null);
    try { const normalized = normalizeGrammarRecommendPayload(await window.api.post('/admin/grammar/recommend-test', { issue: clean }), clean) as Result | null; if (!normalized) throw new Error('Phản hồi matcher không đúng contract.'); if (id === seq.current) setResult(normalized); }
    catch (caught) { if (id === seq.current) setError(messageOf(caught)); }
    finally { if (id === seq.current) setLoading(false); }
  };
  const editIssue = (next: string) => { seq.current += 1; setIssue(next); setResult(null); setError(null); setLoading(false); };
  const clear = () => { seq.current += 1; setIssue(''); setResult(null); setError(null); setLoading(false); };
  const c = result?.candidate;
  return <main className="grt-next-shell">
    <header className="grt-next-header"><div><p className="grt-next-eyebrow">Grammar · Quality control</p><h1>Recommendation lab</h1><p>Chạy đúng matcher và suppression rule mà học viên gặp sau grading.</p></div><a className="btn-secondary" href="/admin/grammar">← Grammar workspace</a></header>
    <section className="grt-next-contract"><span className="adm-status-pill is-readonly">NO PERSISTENCE</span><div><strong>Đây là phép thử, không ghi recommendation</strong><p>Kết quả chỉ preview candidate, anchor và quyết định production. Không tạo dòng trong <code>grammar_recommendations</code>.</p></div></section>
    <form className="grt-next-form" onSubmit={(event) => { event.preventDefault(); void run(); }}><label htmlFor="grt-next-issue">Mô tả lỗi grammar</label><textarea id="grt-next-issue" maxLength={2000} value={issue} onChange={(event) => editIssue(event.target.value)} placeholder="Ví dụ: học viên dùng sai thì khi kể một câu chuyện đã kết thúc" /><div className="grt-next-presets" aria-label="Mẫu kiểm thử">{presets.map((item) => <button type="button" key={item} onClick={() => { editIssue(item); void run(item); }}>{item}</button>)}</div><div className="grt-next-actions"><button className="btn-primary" type="submit" disabled={loading}>{loading ? 'Đang chạy matcher…' : 'Chạy matcher'}</button><button className="btn-secondary" type="button" onClick={clear}>Xóa kết quả</button><span>{issue.length}/2000</span></div></form>
    {error && <div className="grt-next-banner is-error" role="alert"><strong>Không chạy được matcher</strong><span>{error}</span></div>}
    {result?.outcome === 'below_threshold' && <section className="grt-next-outcome is-empty"><p className="grt-next-eyebrow">Production outcome</p><h2>Không phát recommendation</h2><p>Không candidate nào vượt ngưỡng matcher cho issue này. Đây không phải lỗi tải dữ liệu.</p></section>}
    {c && <section className={`grt-next-outcome${result?.outcome === 'draft_suppressed' ? ' is-warning' : ' is-match'}`}><div className="grt-next-outcome-head"><div><p className="grt-next-eyebrow">Production outcome</p><h2>{result?.outcome === 'draft_suppressed' ? 'Candidate bị chặn vì còn draft' : 'Recommendation sẽ được phát'}</h2></div><span className="grt-next-score">{formatGrammarMatchScore(c.score)}</span></div><div className="grt-next-candidate"><div><small>Article</small><strong>{c.title}</strong><code>{c.slug}</code></div><div><small>Category</small><strong>{c.category}</strong></div><div><small>Anchor</small><strong>{c.anchor || 'Không có anchor đủ điểm'}</strong></div><div><small>Editorial status</small><strong>{c.status}</strong></div></div>{c.summary && <p className="grt-next-summary">{c.summary}</p>}<a href={c.url} target="_blank" rel="noopener noreferrer">Mở đúng student destination ↗</a>{result?.outcome === 'draft_suppressed' && <p className="grt-next-note">Production sẽ bỏ candidate này; cần publish article trước khi học viên có thể nhận recommendation.</p>}</section>}
  </main>;
}
