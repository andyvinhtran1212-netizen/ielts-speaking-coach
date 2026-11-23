'use client';

// Shared learner block (ADMINIA-0074 FR-034; CHUAN-ADMIN mục H): the same seven
// fields at the top of the profile, in the directory's "Xem nhanh" drawer and
// in the teacher area's learner drawer. Nothing is added here.
import type { LearnerSummaryWire } from '@/lib/admin-learners-api';
import { summaryLines } from '@/lib/admin-learners-model.mjs';

export function LearnerSummary({ summary, sourcesFailed = [] }: {
  summary: LearnerSummaryWire;
  sourcesFailed?: string[];
}) {
  const lines = summaryLines(summary);
  return (
    <section className="lsum" aria-label={`Tóm tắt học viên ${summary.name}`}>
      <div className="lsum__head">
        <strong className="lsum__name">{summary.name}</strong>
        <span className="lsum__where">{lines.where}</span>
      </div>
      <p className={`lsum__status${summary.status?.level === 'attention' ? ' is-attention' : ''}`}>{lines.status}</p>
      <dl className="lsum__facts">
        <div><dt>Mục tiêu, ngày thi</dt><dd>{lines.goal}{lines.goalNote ? <small> · {lines.goalNote}</small> : null}</dd></div>
        <div><dt>Bài quá hạn</dt><dd>{lines.overdue}</dd></div>
        <div><dt>Band gần đây</dt><dd>{lines.bandW}<br />{lines.bandS}</dd></div>
        <div><dt>Hoạt động gần nhất</dt><dd>{lines.last}</dd></div>
        <div><dt>Ghi chú mới nhất</dt><dd>{lines.note}</dd></div>
      </dl>
      {sourcesFailed.length ? (
        <p className="lsum__failed" role="status">Chưa đọc được: {sourcesFailed.join(', ')}. Các ô liên quan ghi “chưa có”.</p>
      ) : null}
    </section>
  );
}
