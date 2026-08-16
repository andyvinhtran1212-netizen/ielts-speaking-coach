'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import { messageOf } from '@/components/admin-directory-ui';
import {
  filterMockExams,
  mockExamStage,
  mockTestsFrame,
  mockTestsHref,
  mockTestsTab,
  normalizeMockExamList,
} from '@/lib/admin-mock-tests-model.mjs';

type Exam = {
  id: string;
  code: string;
  title: string;
  status: string;
  isOpen: boolean;
  activeSection: string;
  examMode: string;
};
type Tab = 'manage' | 'live' | 'review' | 'writing';
type Stage = 'all' | 'draft' | 'live' | 'closed';

const TABS: { id: Tab; label: string; needsExam: boolean; legacy: boolean }[] = [
  { id: 'manage', label: 'Quản lý đề', needsExam: false, legacy: true },
  { id: 'live', label: 'Phòng thi trực tiếp', needsExam: true, legacy: true },
  { id: 'review', label: 'Duyệt bài thi', needsExam: true, legacy: true },
  { id: 'writing', label: 'Chấm Writing', needsExam: false, legacy: false },
];
const STAGES: { id: Stage; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'draft', label: 'Nháp' },
  { id: 'live', label: 'Đang thi' },
  { id: 'closed', label: 'Đã đóng' },
];
const STAGE_LABEL: Record<string, string> = { draft: 'Nháp', live: 'Đang thi', closed: 'Đã đóng' };
const FRAME_TITLE: Record<Tab, string> = {
  manage: 'Quản lý đề Mock Test',
  live: 'Phòng thi Mock Test trực tiếp',
  review: 'Duyệt bài thi Mock Test',
  writing: 'Hàng chờ chấm Writing Mock Test',
};

export function AdminMockTests() {
  const profile = useAdminProfile();
  const params = useSearchParams();
  const initialTab = useMemo(() => mockTestsTab(params?.get('tab')) as Tab, [params]);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [stage, setStage] = useState<Stage>('all');
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const accountRef = useRef(profile.id);
  const requestRef = useRef(0);
  const loadingRef = useRef(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  accountRef.current = profile.id;

  useEffect(() => setTab(initialTab), [initialTab]);

  useEffect(() => {
    let dead = false;
    const account = profile.id;
    setExams([]);
    setSelectedId('');
    setError(null);
    setNotice(null);

    const load = async (silent = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const request = ++requestRef.current;
      if (!silent) setLoading(true);
      try {
        const normalized = normalizeMockExamList(await window.api.get<unknown>('/admin/mock-exams'));
        if (dead || accountRef.current !== account || request !== requestRef.current) return;
        if (!normalized) throw new Error('Danh sách đề thi sai contract.');
        setExams(normalized.rows);
        setSelectedId((current) => normalized.rows.some((row: Exam) => row.id === current)
          ? current
          : normalized.rows[0]?.id || '');
        setNotice(normalized.malformedCount
          ? `${normalized.malformedCount} đề sai contract đã bị loại; danh sách có thể chưa đầy đủ.`
          : null);
        setError(null);
      } catch (caught) {
        if (!dead && accountRef.current === account && request === requestRef.current) {
          setError(messageOf(caught));
        }
      } finally {
        if (request === requestRef.current) loadingRef.current = false;
        if (!dead && accountRef.current === account && request === requestRef.current) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 15_000);
    return () => {
      dead = true;
      window.clearInterval(timer);
      requestRef.current += 1;
      loadingRef.current = false;
    };
  }, [profile.id]);

  const shown = useMemo(() => filterMockExams(exams, stage) as Exam[], [exams, stage]);
  const selected = exams.find((exam) => exam.id === selectedId) || null;
  const selectionHidden = Boolean(selected && !shown.some((exam) => exam.id === selected.id));
  const activeTab = TABS.find((item) => item.id === tab) || TABS[0];
  const liveDraftBlocked = tab === 'live' && selected?.status !== 'published';
  const frame = liveDraftBlocked ? null : mockTestsFrame(tab, selectedId);

  useEffect(() => {
    const node = frameRef.current;
    const syncFrameTheme = () => {
      try {
        const theme = document.documentElement.getAttribute('data-theme') || 'light';
        node?.contentDocument?.documentElement.setAttribute('data-theme', theme);
      } catch { /* Same-origin rollback modules are expected; fail closed if that changes. */ }
    };
    const adoptStoredTheme = (event: StorageEvent) => {
      if (event.key !== 'av-theme') return;
      try {
        const theme = localStorage.getItem('av-theme');
        if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
      } catch { /* Storage can be unavailable in hardened browser contexts. */ }
    };
    const observer = new MutationObserver(syncFrameTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    node?.addEventListener('load', syncFrameTheme);
    window.addEventListener('storage', adoptStoredTheme);
    syncFrameTheme();
    return () => {
      observer.disconnect();
      node?.removeEventListener('load', syncFrameTheme);
      window.removeEventListener('storage', adoptStoredTheme);
    };
  }, [frame]);

  const activateTab = (next: Tab) => {
    setTab(next);
    window.history.replaceState(window.history.state, '', mockTestsHref(next));
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target = -1;
    if (event.key === 'ArrowRight') target = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') target = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = TABS.length - 1;
    if (target < 0) return;
    event.preventDefault();
    document.getElementById(`mts-tab-${TABS[target].id}`)?.focus();
  };

  return (
    <main className="mts-shell">
      <header className="mts-hero">
        <div>
          <p className="mts-eyebrow">Operations · Four-skill assessment</p>
          <h1>Mock Test cockpit</h1>
          <p>Chọn đúng đề trước khi mở phòng thi hoặc duyệt bài; trạng thái lấy trực tiếp từ backend.</p>
        </div>
        <a className="adm-btn-secondary" href="/admin">Tổng quan Admin</a>
      </header>

      {error && <div className="mts-alert is-error" role="alert"><strong>{exams.length ? 'Không làm mới được; đang giữ snapshot cũ.' : 'Không tải được danh sách đề.'}</strong><span>{error}</span></div>}
      {notice && <div className="mts-alert is-warning" role="alert">{notice}</div>}

      <div className="mts-cockpit">
        <aside className="mts-rail" aria-label="Danh sách đề thi">
          <div className="mts-rail__head">
            <div><span>Đề thi</span><small>{shown.length}/{exams.length}</small></div>
            <span className="mts-live-dot" aria-label="Tự làm mới mỗi 15 giây">LIVE</span>
          </div>
          <div className="mts-filters" aria-label="Lọc trạng thái đề">
            {STAGES.map((item) => <button key={item.id} type="button" className={stage === item.id ? 'is-active' : ''} aria-pressed={stage === item.id} onClick={() => setStage(item.id)}>{item.label}</button>)}
          </div>
          {selectionHidden && <div className="mts-alert is-warning" role="status">Đề đang thao tác bị ẩn bởi bộ lọc. Chọn một đề đang hiển thị để đổi phạm vi.</div>}
          {loading && !exams.length
            ? <div className="mts-rail__state" role="status">Đang tải đề thi…</div>
            : !shown.length
              ? <div className="mts-rail__state">{exams.length ? 'Không có đề khớp bộ lọc.' : 'Chưa có đề nào.'}</div>
              : <ul className="mts-list">{shown.map((exam) => {
                const examStage = mockExamStage(exam);
                return <li key={exam.id}><button type="button" className={exam.id === selectedId ? 'is-active' : ''} aria-current={exam.id === selectedId ? 'true' : undefined} onClick={() => setSelectedId(exam.id)}><span className="mts-exam__top"><strong>{exam.code || 'Chưa có mã'}</strong><span className={`mts-stage is-${examStage}`}>{STAGE_LABEL[examStage]}</span></span><span className="mts-exam__title">{exam.title || 'Chưa có tiêu đề'}</span><small>{exam.examMode === 'retake' ? 'Retake theo học viên' : 'Sequential theo lớp'} · {exam.activeSection}</small></button></li>;
              })}</ul>}
        </aside>

        <section className="mts-panel" aria-labelledby={`mts-tab-${tab}`}>
          <nav className="mts-tabs" role="tablist" aria-label="Không gian Mock Test">
            {TABS.map((item, index) => <button key={item.id} id={`mts-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls="mts-panel" tabIndex={tab === item.id ? 0 : -1} data-needs-exam={item.needsExam ? '' : undefined} onKeyDown={(event) => onTabKey(event, index)} onClick={() => activateTab(item.id)}>{item.label}</button>)}
          </nav>
          {activeTab.legacy && <div className="mts-migration-note" role="status"><span>MODULE ROLLBACK</span> Workspace điều phối đã là Next.js; module nghiệp vụ này vẫn chạy bản HTML trong batch hiện tại.</div>}
          {activeTab.needsExam && selected && <div className="mts-context"><span>Đang thao tác trên</span><strong>{selected.code || selected.id}</strong><span>{selected.title}</span></div>}
          <div id="mts-panel" className="mts-frame-wrap" role="tabpanel" aria-labelledby={`mts-tab-${tab}`} tabIndex={0}>
            {!frame
              ? <div className="mts-need-exam"><strong>{liveDraftBlocked ? 'Đề chưa được publish' : 'Chưa chọn đề thi'}</strong><span>{liveDraftBlocked ? 'Publish đề trong tab Quản lý trước khi mở phòng thi trực tiếp.' : `Chọn một đề ở danh sách bên trái để ${tab === 'live' ? 'mở phòng thi trực tiếp' : 'duyệt bài thi'}.`}</span></div>
              : <iframe ref={frameRef} key={frame} className="mts-frame" src={frame} title={FRAME_TITLE[tab]} />}
          </div>
        </section>
      </div>
    </main>
  );
}
