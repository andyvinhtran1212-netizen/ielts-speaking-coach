import { writingTopFixes } from '@/lib/writing-result-model.mjs';

type TopFix = { kind: 'mistake' | 'area'; title: string; detail: string; example?: string; count: number };

// R3 — "N việc cần sửa trước" (CM-TEXT 30/10). Band-free on purpose, so it
// also renders when the instructor hides scores.
export function WritingTopFixes({ feedbackJson, mistakesTabLabel }: { feedbackJson: unknown; mistakesTabLabel: string }) {
  const fixes = writingTopFixes(feedbackJson) as TopFix[];
  if (!fixes.length) return null;
  return (
    <section id="top-fixes" className="top-fixes" aria-labelledby="top-fixes-title">
      <h2 id="top-fixes-title">{fixes.length} việc cần sửa trước</h2>
      <p className="top-fixes__hint">Ưu tiên sửa những điểm này ở bài tiếp theo. Xem chi tiết ở tab {mistakesTabLabel}.</p>
      <ol className="top-fixes__list">
        {fixes.map((fix, index) => (
          <li className="top-fixes__item" key={index}>
            <p className="top-fixes__kind">{fix.kind === 'mistake' ? 'Lỗi cần sửa' : 'Cần cải thiện'}</p>
            <p className="top-fixes__title">
              {fix.title}
              {fix.count > 1 ? <span className="top-fixes__count"> ({fix.count} chỗ)</span> : null}
            </p>
            {fix.detail ? <p className="top-fixes__detail">{fix.detail}</p> : null}
            {fix.example ? <p className="top-fixes__example"><q>{fix.example}</q></p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
