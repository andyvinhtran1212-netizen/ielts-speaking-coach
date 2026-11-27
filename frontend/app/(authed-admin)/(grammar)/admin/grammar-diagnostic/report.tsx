'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ApiGetJson } from '@/lib/openapi-contract';

type Report = ApiGetJson<'/admin/grammar-diagnostic/sessions/{session_id}/report'>;

export function GrammarDiagnosticReport() {
  const session = useSearchParams()?.get('session') || '';
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!session) { setError('Thiếu mã phiên Grammar Diagnostic.'); return; }
    let active = true;
    void window.api.get<Report>(`/admin/grammar-diagnostic/sessions/${encodeURIComponent(session)}/report`)
      .then((value) => { if (active) setReport(value); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { active = false; };
  }, [session]);
  if (error) return <main className="agdr-shell"><div className="agdr-empty" role="alert">{error}</div></main>;
  if (!report) return <main className="agdr-shell"><div className="agdr-empty">Đang tải báo cáo…</div></main>;
  return <main className="agdr-shell"><a className="agdr-back" href="/admin/grammar">← Grammar workspace</a><header className="agdr-hero"><div><p>MASTER30 · EDUCATOR VIEW</p><h1>Grammar Readiness Profile</h1><span>{report.test_length} · {report.mode} · {report.module}</span></div><div className="agdr-count"><strong>{report.objective_items}</strong><span>câu objective</span></div></header><div className="agdr-warning">{report.calibration_note}</div><section><h2>Ưu tiên đã phát hiện</h2><div className="agdr-cards">{report.priorities.map((row) => <article key={row.attribute_id}><span>{row.attribute_id} · {row.state}</span><h3>{row.title}</h3><p>{row.observed_pattern}</p><p><strong>Can thiệp:</strong> {row.next_action}</p>{row.route_id && <code>{row.route_id}</code>}</article>)}</div></section><section><h2>Bằng chứng theo 14 năng lực</h2><div className="agdr-table-wrap" tabIndex={0}><table><thead><tr><th>Năng lực</th><th>Trạng thái</th><th>Mẫu độc lập</th><th>Đúng</th><th>Sai</th><th>Loại do hỗ trợ</th></tr></thead><tbody>{Object.entries(report.attribute_evidence).map(([attribute, value]) => <tr key={attribute}><td><strong>{attribute}</strong></td><td>{value.state}</td><td>{value.independent_items}</td><td>{value.correct}</td><td>{value.incorrect}</td><td>{value.assisted_evidence_excluded}</td></tr>)}</tbody></table></div></section></main>;
}
