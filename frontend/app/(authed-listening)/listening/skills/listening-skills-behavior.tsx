'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

const SKILLS = [
  { key: 'form', icon: 'clipboard-list', label: 'Điền vào form', lede: 'Nghe và điền thông tin vào biểu mẫu (tên, ngày, số…).' },
  { key: 'note', icon: 'notebook-pen', label: 'Điền ghi chú', lede: 'Hoàn thành ghi chú theo bài nói.' },
  { key: 'table', icon: 'table', label: 'Điền bảng', lede: 'Điền các ô còn trống trong bảng.' },
  { key: 'flowchart', icon: 'git-branch', label: 'Sơ đồ quy trình', lede: 'Hoàn thành sơ đồ các bước theo thứ tự.' },
  { key: 'sentence', icon: 'text-cursor-input', label: 'Hoàn thành câu', lede: 'Điền từ còn thiếu vào câu.' },
  { key: 'summary', icon: 'file-text', label: 'Hoàn thành đoạn tóm tắt', lede: 'Điền từ vào đoạn văn tóm tắt.' },
  { key: 'short_answer', icon: 'pencil', label: 'Trả lời ngắn', lede: 'Trả lời câu hỏi bằng 1–3 từ.' },
  { key: 'mcq', icon: 'list-checks', label: 'Trắc nghiệm (1 đáp án)', lede: 'Chọn A, B hoặc C.' },
  { key: 'mcq_multi', icon: 'check-check', label: 'Trắc nghiệm (chọn nhiều)', lede: 'Chọn 2–3 đáp án đúng.' },
  { key: 'matching', icon: 'arrow-left-right', label: 'Nối thông tin', lede: 'Nối mỗi câu với đáp án từ danh sách.' },
  { key: 'map', icon: 'map', label: 'Bản đồ / sơ đồ', lede: 'Gắn nhãn vị trí trên bản đồ hoặc sơ đồ.' },
] as const;

interface RawDrill {
  id?: unknown;
  test_id?: unknown;
  title?: unknown;
  drill_type?: unknown;
  level?: unknown;
  task?: unknown;
  user_best_score?: unknown;
  user_attempt_count?: unknown;
}

interface Drill {
  key: string;
  id: string;
  testId: string;
  title: string;
  drillType: string;
  level: string | null;
  task: string | null;
  bestScore: string | null;
  attemptCount: number;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; drills: Drill[] }
  | { status: 'error'; message: string };

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function displayValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return String(value);
}

function nonNegativeInteger(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function normalizeDrills(items: unknown[]): Drill[] {
  return items.flatMap((value, index) => {
    const raw: RawDrill = value && typeof value === 'object' ? value : {};
    const id = textValue(raw.id);
    if (!id) return [];
    const testId = textValue(raw.test_id);
    return [{
      key: `${id}-${index}`,
      id,
      testId,
      title: textValue(raw.title) || testId || 'Skill drill',
      drillType: textValue(raw.drill_type),
      level: textValue(raw.level) || null,
      task: textValue(raw.task) || null,
      bestScore: raw.user_best_score == null ? null : displayValue(raw.user_best_score),
      attemptCount: nonNegativeInteger(raw.user_attempt_count),
    }];
  });
}

function ladderNumber(value: string | null, prefix: 'L' | 'T'): number {
  const match = new RegExp(`${prefix}(\\d+)`, 'i').exec(value || '');
  return match ? Number(match[1]) : 99;
}

function drillSort(a: Drill, b: Drill): number {
  const level = ladderNumber(a.level, 'L') - ladderNumber(b.level, 'L');
  if (level) return level;
  const task = ladderNumber(a.task, 'T') - ladderNumber(b.task, 'T');
  if (task) return task;
  return a.testId.localeCompare(b.testId);
}

async function fetchAllDrills(signal: AbortSignal): Promise<unknown[]> {
  const all: unknown[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await window.api.getWith<unknown>(
      `/api/listening/tests?test_type=drill&limit=${PAGE_LIMIT}&offset=${offset}`,
      undefined,
      { signal },
    );
    const items = payload && typeof payload === 'object'
      ? (payload as { items?: unknown }).items
      : null;
    const pageItems = Array.isArray(items) ? items : [];
    all.push(...pageItems);
    if (pageItems.length < PAGE_LIMIT) return all;
    offset += PAGE_LIMIT;
  }
  throw new Error(
    `Danh sách vượt ${MAX_PAGES * PAGE_LIMIT} mục — chưa tải hết, `
    + 'cần phân trang trên giao diện thay vì tải một lượt.',
  );
}

function errorMessage(caught: unknown): string {
  if (caught instanceof Error && caught.message) return caught.message;
  return caught == null ? '' : String(caught);
}

function SkillIcon({ name }: { name: string }) {
  let paths: ReactNode;
  switch (name) {
    case 'clipboard-list':
      paths = <><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></>;
      break;
    case 'notebook-pen':
      paths = <><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" /><path d="M2 6h4" /><path d="M2 10h4" /><path d="M2 14h4" /><path d="M2 18h4" /><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" /></>;
      break;
    case 'table':
      paths = <><path d="M12 3v18" /><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /></>;
      break;
    case 'git-branch':
      paths = <><line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></>;
      break;
    case 'text-cursor-input':
      paths = <><path d="M5 4h1a3 3 0 0 1 3 3 3 3 0 0 1 3-3h1" /><path d="M13 20h-1a3 3 0 0 1-3-3 3 3 0 0 1-3 3H5" /><path d="M5 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1" /><path d="M13 8h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-7" /><path d="M9 7v10" /></>;
      break;
    case 'file-text':
      paths = <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></>;
      break;
    case 'pencil':
      paths = <><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></>;
      break;
    case 'list-checks':
      paths = <><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></>;
      break;
    case 'check-check':
      paths = <><path d="M18 6 7 17l-5-5" /><path d="m22 10-7.5 7.5L13 16" /></>;
      break;
    case 'arrow-left-right':
      paths = <><path d="M8 3 4 7l4 4" /><path d="M4 7h16" /><path d="m16 21 4-4-4-4" /><path d="M20 17H4" /></>;
      break;
    default:
      paths = <><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" /><path d="M15 5.764v15" /><path d="M9 3.236v15" /></>;
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`lucide lucide-${name}`}>
      {paths}
    </svg>
  );
}

export function ListeningSkillsBehavior() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
  }, [status]);

  if (status !== 'signed-in' || !user?.id) {
    return <div className="empty-state" id="state-loading">Đang tải danh sách bài luyện…</div>;
  }

  return <ListeningSkillsLibrary accountKey={user.id} key={user.id} />;
}

function ListeningSkillsLibrary({ accountKey }: { accountKey: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setState({ status: 'loading' });

    (async () => {
      const ready = await whenGlobalReady(
        () => !!window.api?.getWith,
        'window.api (listening skills)',
      );
      if (!ready || disposed) {
        if (!disposed) setState({ status: 'error', message: '' });
        return;
      }

      try {
        const items = await fetchAllDrills(controller.signal);
        if (disposed) return;
        setState({ status: 'ready', drills: normalizeDrills(items) });
      } catch (caught: unknown) {
        if (disposed || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setState({ status: 'error', message: errorMessage(caught) });
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [accountKey]);

  if (state.status === 'loading') {
    return <div className="empty-state" id="state-loading">Đang tải danh sách bài luyện…</div>;
  }
  if (state.status === 'error') {
    return (
      <div className="error-banner" id="state-error">
        Không tải được danh sách bài luyện: {state.message}
      </div>
    );
  }
  if (!state.drills.length) {
    return (
      <div className="empty-state" id="state-empty">
        <p><strong>Chưa có bài luyện nào sẵn sàng.</strong></p>
        <p>Hãy quay lại sau khi admin xuất bản skill drill mới.</p>
      </div>
    );
  }

  return (
    <section id="ls-groups">
      {SKILLS.map((skill) => {
        const drills = state.drills
          .filter((drill) => drill.drillType === skill.key)
          .slice()
          .sort(drillSort);
        const available = drills.length > 0;
        return (
          <section className={`ls-group${available ? '' : ' is-empty'}`} key={skill.key}>
            <div className="ls-group-head">
              <div className="ls-group-icon"><SkillIcon name={skill.icon} /></div>
              <div>
                <h2 className="ls-group-title">
                  {skill.label}
                  {available ? <>{' '}<span className="ls-group-count">{drills.length}</span></> : null}
                </h2>
                <p className="ls-group-lede">{skill.lede}</p>
              </div>
            </div>
            {available ? (
              <div className="ls-drill-list">
                {drills.map((drill) => {
                  const attempted = drill.attemptCount > 0;
                  return (
                    <div className="ls-drill" key={drill.key}>
                      <a className="ls-drill-main" href={`/pages/listening-test.html?id=${encodeURIComponent(drill.id)}`}>
                        {drill.level ? (
                          <span className="ls-drill-level">{drill.level}{drill.task ? <>·{drill.task}</> : null}</span>
                        ) : null}
                        <span className="ls-drill-title">{drill.title}</span>
                        {drill.bestScore != null ? (
                          <span className="ls-drill-stat">Tốt nhất {drill.bestScore}</span>
                        ) : attempted ? (
                          <span className="ls-drill-stat">Đã làm</span>
                        ) : null}
                        <span className="ls-drill-cta">{attempted ? 'Làm lại' : 'Luyện'} →</span>
                      </a>
                      <a
                        className="ls-drill-dict"
                        href={`/pages/listening-test-dictation.html?test_id=${encodeURIComponent(drill.id)}`}
                        title="Chép chính tả"
                        aria-label="Chép chính tả"
                      >
                        ✍️
                      </a>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="ls-group-soon">Sắp có</p>
            )}
          </section>
        );
      })}
    </section>
  );
}
