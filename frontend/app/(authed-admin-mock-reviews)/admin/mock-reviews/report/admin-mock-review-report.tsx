'use client';

import { useEffect, useRef, useState } from 'react';

import { useAdminProfile } from '@/components/admin-access-gate';
import { messageOf } from '@/components/admin-directory-ui';
import { normalizeReviewDetail, reportSkills } from '@/lib/admin-mock-reviews-model.mjs';

type Detail = {
  review: { id: string; status: string; finalBands: Record<string, number>; retestFlags: Record<string, boolean>; examinerComment: string };
  sitting: { studentName: string };
  requiredSkills: string[];
};
const LABEL: Record<string, string> = { listening: 'Listening', reading: 'Reading', writing: 'Writing', speaking: 'Speaking' };

export function AdminMockReviewReport({ reviewId, examId }: { reviewId: string; examId: string }) {
  const profile = useAdminProfile();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const accountRef = useRef(profile.id);
  accountRef.current = profile.id;

  useEffect(() => {
    let dead = false;
    const account = profile.id;
    setDetail(null); setError(''); setLoading(true);
    if (!reviewId.trim()) { setError('Thiếu review_id; không thể xác định hồ sơ cần in.'); setLoading(false); return () => { dead = true; }; }
    (async () => {
      try {
        const normalized = normalizeReviewDetail(await window.api.get<unknown>(`/admin/mock-reviews/${encodeURIComponent(reviewId)}`)) as Detail | null;
        if (dead || accountRef.current !== account) return;
        if (!normalized || normalized.review.id !== reviewId) throw new Error('Hồ sơ trả về sai contract hoặc sai review_id.');
        setDetail(normalized);
      } catch (caught) {
        if (!dead && accountRef.current === account) setError(`Không tải được phiếu điểm: ${messageOf(caught)}`);
      } finally { if (!dead && accountRef.current === account) setLoading(false); }
    })();
    return () => { dead = true; };
  }, [profile.id, reviewId]);

  const back = examId ? `/admin/mock-reviews?mock_exam_id=${encodeURIComponent(examId)}` : '/admin/mock-tests?tab=review';
  const blocked = detail && (Object.values(detail.review.retestFlags).some(Boolean) || !['reviewed', 'released'].includes(detail.review.status));
  const skills = reportSkills(detail) as string[];
  return <main className="mrr-report-shell">
    <div className="mrr-report-actions"><a className="adm-btn-secondary" href={back}>← Quay lại bàn duyệt</a>{detail && !blocked && <button className="adm-btn-primary" type="button" onClick={() => window.print()}>In phiếu</button>}</div>
    {loading && <div className="mrr-state" role="status">Đang tải dữ liệu canonical…</div>}
    {error && <div className="mrr-state is-error" role="alert">{error}</div>}
    {blocked && <div className="mrr-state is-warning" role="alert">{Object.values(detail.review.retestFlags).some(Boolean) ? 'Học viên còn kỹ năng cần test lại — chưa thể tạo phiếu báo điểm.' : 'Chưa nhập band cuối — chưa thể tạo phiếu báo điểm.'}</div>}
    {detail && !blocked && <article className="mrr-report-card">
      <header><p className="mrr-kicker">Aver Learning · Mock Test</p><h1>Phiếu báo điểm</h1><p>{detail.sitting.studentName}</p></header>
      <div className="mrr-report-grid">
        {skills.map((skill) => <div className="mrr-report-score" key={skill}><span>{LABEL[skill] || skill}</span><strong>{detail.review.finalBands[skill] == null ? '—' : detail.review.finalBands[skill].toFixed(1)}</strong></div>)}
        {detail.review.finalBands.overall != null && <div className="mrr-report-score is-overall"><span>Overall</span><strong>{detail.review.finalBands.overall.toFixed(1)}</strong></div>}
      </div>
      {detail.review.examinerComment && <section className="mrr-report-comment"><h2>Nhận xét của giám khảo</h2><p>{detail.review.examinerComment}</p></section>}
      <footer>Điểm trên phiếu đọc trực tiếp từ hồ sơ đã chốt trên backend.</footer>
    </article>}
  </main>;
}
