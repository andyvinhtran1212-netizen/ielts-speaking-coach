'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type { ApiGetJson } from '@/lib/openapi-contract';

type Report = ApiGetJson<'/api/grammar/diagnostics/sessions/{session_id}/report'>;
type Priority = Report['priorities'][number];

export function ReviewRoute() {
  const routeId = String(useParams()?.routeId || '');
  const session = useSearchParams()?.get('session') || '';
  const [priority, setPriority] = useState<Priority | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!session) { setError('Thiếu phiên báo cáo để mở tuyến ôn.'); return; }
    let active = true;
    void window.api.get<Report>(`/api/grammar/diagnostics/sessions/${encodeURIComponent(session)}/report`).then((report) => {
      if (!active) return;
      const found = report.priorities.find((row) => row.route_id === routeId);
      if (!found) setError('Tuyến ôn này không thuộc báo cáo hiện tại.'); else setPriority(found);
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { active = false; };
  }, [routeId, session]);
  if (error) return <main className="gd-shell"><div className="gd-empty gd-error" role="alert">{error}</div></main>;
  if (!priority) return <main className="gd-shell"><div className="gd-empty">Đang mở tuyến ôn…</div></main>;
  const lessons = priority.lesson_sources.split(',').map((value) => value.trim()).filter(Boolean);
  return <main className="gd-shell"><a className="gd-back" href={`/grammar-checkup?session=${encodeURIComponent(session)}&view=report`}>← Quay lại báo cáo</a><header className="gd-report-hero"><p className="gd-eyebrow">{routeId} · {priority.attribute_id}</p><h1>{priority.title}</h1><p>{priority.observed_pattern}</p></header><section className="gd-report-grid"><div><p className="gd-kicker">Vì sao cần ôn</p><h2>Rủi ro quan sát được</h2><p>{priority.risk}</p>{priority.contrast_example && <code>{priority.contrast_example}</code>}</div><div><p className="gd-kicker">Bước tiếp theo</p><h2>Cách thực hiện</h2><p>{priority.next_action}</p></div></section><section className="gd-setup"><p className="gd-kicker">Nội dung đề xuất</p><h2>Ôn theo tuyến, không học lại cả khóa</h2><div className="gd-tags">{lessons.map((lesson) => <span key={lesson}>MASTER30 · {lesson}</span>)}</div><div className="gd-note"><strong>Điều kiện rời tuyến:</strong> {priority.exit_condition}</div><a className="av-button av-button-primary" href="/grammar">Mở Grammar Wiki để ôn</a></section></main>;
}
