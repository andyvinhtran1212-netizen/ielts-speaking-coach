'use client';

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';

type PlayerStateStore = {
  getStateSnapshot(): null | string;
  subscribeState(listener: () => void): () => void;
};

type PracticeMethod =
  | 'backToSheet'
  | 'chooseModeAndStart'
  | 'discardP2SubmissionRetry'
  | 'downloadAudio'
  | 'downloadPDFs'
  | 'finishSession'
  | 'goToRecording'
  | 'nextQuestion'
  | 'playQuestion'
  | 'replayAudio'
  | 'resetRecording'
  | 'retryFullTestSubmissions'
  | 'retryP2Submission'
  | 'revealQuestionText'
  | 'setQMode'
  | 'startP2Prep'
  | 'startP2SpeakingEarly'
  | 'startRecording'
  | 'stopP2SpeakingEarly'
  | 'stopRecording'
  | 'submitRecording';

function callPractice(method: PracticeMethod, ...args: unknown[]) {
  const app = (window as any).PracticeApp;
  if (!app || typeof app[method] !== 'function') return;
  app[method](...args);
}

function Icon({ name, className = '' }: { name: string; className?: string }) {
  let paths: ReactNode;
  switch (name) {
    case 'chevron-left':
      paths = <path d="m15 18-6-6 6-6" />;
      break;
    case 'alert-triangle':
      paths = <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>;
      break;
    case 'eye':
      paths = <><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></>;
      break;
    case 'volume-2':
      paths = <><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /><path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.364 18.364a9 9 0 0 0 0-12.728" /></>;
      break;
    case 'mic':
      paths = <><path d="M12 19v3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><rect x="9" y="2" width="6" height="13" rx="3" /></>;
      break;
    case 'square':
      paths = <rect width="18" height="18" x="3" y="3" rx="2" />;
      break;
    case 'rotate-ccw':
      paths = <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>;
      break;
    case 'check-circle':
      paths = <><path d="M21.801 10A10 10 0 1 1 17 3.335" /><path d="m9 11 3 3L22 4" /></>;
      break;
    case 'check-circle-2':
      paths = <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>;
      break;
    case 'upload':
      paths = <><path d="M12 3v12" /><path d="m17 8-5-5-5 5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></>;
      break;
    case 'play':
      paths = <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />;
      break;
    case 'arrow-left':
      paths = <><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>;
      break;
    case 'arrow-right':
      paths = <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>;
      break;
    case 'check':
      paths = <path d="M20 6 9 17l-5-5" />;
      break;
    case 'clock':
      paths = <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>;
      break;
    case 'clipboard-list':
      paths = <><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></>;
      break;
    case 'download':
      paths = <><path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /></>;
      break;
    case 'file-down':
      paths = <><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M12 18v-6" /><path d="m9 15 3 3 3-3" /></>;
      break;
    default:
      paths = null;
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`lucide lucide-${name}${className ? ` ${className}` : ''}`}>
      {paths}
    </svg>
  );
}

export function PracticePageShell({ player }: { player: PlayerStateStore }) {
  const subscribe = useCallback(
    (listener: () => void) => player.subscribeState(listener),
    [player],
  );
  const getSnapshot = useCallback(() => player.getStateSnapshot(), [player]);
  const activeState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot) || 'loading';
  const stateClass = (name: string, className: string) =>
    `${className}${activeState === name ? ' active' : ''}`;

  return (
    <>
      <header className="practice-header practice-context-bar sticky top-0 z-30 px-5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a href="/speaking" className="practice-back-link"><Icon name="chevron-left" />Quay lại</a>
          <p className="eyebrow" style={{ margin: 0 }}>Speaking</p>
        </div>
        <div className="flex items-center gap-3 min-w-0">
          <span id="hdr-info" className="hidden text-xs font-medium truncate practice-hdr-info" />
          <span id="hdr-progress" className="hidden ds-badge ds-badge-teal" style={{ whiteSpace: 'nowrap' }} />
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <div id="test-mode-banner" className="practice-test-banner" style={{ display: 'none' }}>
          <span className="practice-test-banner__label"><Icon name="alert-triangle" />TEST MODE — KHÔNG ĐƯỢC DỪNG GIỮA CHỪNG</span>
        </div>
        <div id="progress-bar-wrap" className="practice-progress-wrap" style={{ display: 'none' }}>
          <div id="progress-bar-label" className="practice-progress-label" />
          <div className="practice-progress-rail"><div id="progress-bar-fill" className="practice-progress-fill" style={{ width: '0%' }} /></div>
        </div>

        <div id="state-loading" className={stateClass('loading', 'state flex-1 items-center justify-center flex-col gap-4')}>
          <div className="spinner" />
          <p id="loading-msg" className="practice-loading-msg text-sm">Đang tải...</p>
        </div>

        <div id="state-error" className={stateClass('error', 'state flex-1 items-center justify-center flex-col gap-4 px-6')}>
          <div className="practice-error-icon"><Icon name="alert-triangle" /></div>
          <h2 className="text-lg font-bold">Đã xảy ra lỗi</h2>
          <p id="error-msg" className="practice-error-msg text-sm text-center max-w-xs" />
          <a href="/speaking" className="btn-ghost px-5 py-2.5 text-sm font-semibold inline-block">Quay lại</a>
        </div>

        <div id="state-mode-choice" className={stateClass('mode-choice', 'state block-state flex-1 av-w-read py-12 ds-fadein practice-stage practice-stage--choice')}>
          <div className="text-center mb-8">
            <p className="practice-mode-eyebrow text-xs font-bold uppercase tracking-wider mb-3">Câu hỏi sẽ được trình bày như thế nào?</p>
            <h2 className="text-xl font-bold mb-2">Chọn chế độ câu hỏi</h2>
            <p className="practice-mode-desc text-sm">Lựa chọn này áp dụng cho toàn bộ phiên luyện tập</p>
          </div>
          <div className="flex flex-col gap-4">
            <button type="button" onClick={() => callPractice('chooseModeAndStart', 'visual')} className="practice-mode-card w-full text-left px-6 py-6 rounded-2xl font-bold">
              <span className="practice-mode-card__badge">Linh hoạt</span>
              <div className="practice-mode-card__icon"><Icon name="eye" /></div>
              <div className="practice-mode-card__title">Visual</div>
              <div className="practice-mode-card__desc">Đọc câu hỏi trực tiếp trên màn hình</div>
            </button>
            <button type="button" onClick={() => callPractice('chooseModeAndStart', 'listening')} className="practice-mode-card practice-mode-card--recommended w-full text-left px-6 py-6 rounded-2xl font-bold">
              <span className="practice-mode-card__badge">Gần phòng thi thật</span>
              <div className="practice-mode-card__icon"><Icon name="volume-2" /></div>
              <div className="practice-mode-card__title practice-mode-card__title--accent">Listening</div>
              <div className="practice-mode-card__desc">Nghe câu hỏi phát ra loa — giống phòng thi thật. Câu hỏi sẽ tự phát mỗi lần.</div>
            </button>
          </div>
        </div>

        <div id="state-prep" className={stateClass('prep', 'state block-state flex-1 av-w-read py-8 ds-fadein practice-stage practice-stage--player')}>
          <div id="prep-fallback-warning" className="ds-callout practice-warning-callout" style={{ display: 'none' }}>
            <Icon name="alert-triangle" /><span>AI chưa sẵn sàng — đang dùng câu hỏi dự phòng. Chất lượng có thể thấp hơn bình thường.</span>
          </div>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span id="prep-part-badge" className="ds-badge ds-badge-teal" />
            <span id="prep-topic" className="practice-prep-topic text-sm font-medium" />
            <span id="prep-q-counter" className="practice-prep-counter ml-auto text-xs font-semibold" />
          </div>
          <div id="prep-mode-toggle" className="practice-mode-toggle flex gap-1 mb-4 p-1 rounded-xl">
            <button id="prep-mode-visual" type="button" className="practice-mode-toggle__btn flex-1 py-1.5 text-xs font-semibold rounded-lg" onClick={() => callPractice('setQMode', 'visual')}><Icon name="eye" />Visual</button>
            <button id="prep-mode-listening" type="button" className="practice-mode-toggle__btn flex-1 py-1.5 text-xs font-semibold rounded-lg" onClick={() => callPractice('setQMode', 'listening')}><Icon name="volume-2" />Listening</button>
          </div>
          <div id="prep-listen-bar" style={{ display: 'none' }} className="mb-4 flex items-center justify-center">
            <button id="prep-play-btn" type="button" className="btn-primary practice-icon-btn px-7 py-2.5 text-sm font-bold" onClick={() => callPractice('playQuestion')}><Icon name="volume-2" />Nghe câu hỏi</button>
          </div>
          <div id="prep-q-card" className="ds-question-card mb-5 ds-fadein" style={{ transition: 'opacity 0.2s' }}>
            <div className="ds-q-label">Câu hỏi</div>
            <div id="prep-text-reveal"><p id="prep-q-text" className="ds-q-text" /></div>
            <button id="prep-reveal-btn" type="button" className="practice-reveal-btn w-full text-xs py-2 px-4 rounded-lg font-medium transition" style={{ display: 'none' }} onClick={() => callPractice('revealQuestionText')}><Icon name="eye" />Hiện câu hỏi</button>
          </div>
          <div id="prep-listen" className="ds-question-card mb-5 hidden">
            <div className="ds-q-label">Nghe câu hỏi</div>
            <p className="prep-listen__hint">Nghe rồi trả lời. Không có bản chữ — như trong phòng thi.</p>
            <audio id="prep-listen-audio" preload="auto" controls className="prep-listen__audio" />
            <p id="prep-listen-error" className="prep-listen__error hidden">Chưa tải được câu hỏi. Kiểm tra kết nối rồi bấm phát lại.</p>
          </div>
          <div id="prep-cue" className="hidden ds-cue-card mb-6">
            <p className="practice-cue-card__label text-xs font-bold uppercase tracking-wider mb-3"><Icon name="clipboard-list" />Cue Card — Hãy nói về:</p>
            <div id="prep-cue-bullets" className="mb-3" />
            <p id="prep-cue-reflection" className="practice-cue-card__reflection text-sm italic" />
          </div>
          <p id="prep-instruction" className="practice-prep-instruction text-xs text-center mb-6">Đọc câu hỏi kỹ, sau đó nhấn nút để bắt đầu ghi âm.</p>
          <button id="prep-start-btn" type="button" className="btn-primary practice-icon-btn w-full py-4 text-base" onClick={() => callPractice('goToRecording')}><Icon name="mic" />Bắt đầu ghi âm</button>
          <div id="inline-rec-section" style={{ display: 'none', marginTop: 16 }}>
            <div id="rec-error" className="ds-callout practice-error-callout" style={{ display: 'none' }} />
            <div id="rec-idle" style={{ display: 'none' }}>
              <div className="text-center py-4"><div className="ds-rec-ring practice-rec-ring--idle mb-3"><Icon name="mic" className="practice-rec-ring__icon" /></div><p className="practice-rec-idle-label text-sm font-medium mb-1">Sẵn sàng ghi âm</p></div>
              <button type="button" className="btn-primary practice-icon-btn w-full py-4 text-base" onClick={() => callPractice('startRecording')}><Icon name="mic" />Bắt đầu ghi âm</button>
            </div>
            <div id="rec-recording" style={{ display: 'none' }}>
              <div className="text-center mb-4"><div className="flex items-center justify-center gap-3 mb-2"><span className="practice-rec-dot" /><span id="rec-timer" className="practice-rec-timer text-5xl font-extrabold tabular-nums">0:00</span></div><p className="practice-rec-hint text-xs">Đang ghi âm — nói rõ ràng vào microphone</p></div>
              <canvas id="rec-canvas" width="600" height="56" className="practice-rec-canvas" />
              <button type="button" className="btn-danger practice-icon-btn w-full py-4 text-sm font-bold" onClick={() => callPractice('stopRecording')}><Icon name="square" />Dừng ghi âm</button>
            </div>
            <div id="rec-recorded" style={{ display: 'none' }}>
              <div className="text-center py-4"><div className="practice-rec-success"><Icon name="check-circle" /></div><p className="practice-rec-success-label text-sm font-semibold mb-1">Đã ghi âm xong!</p><p id="rec-duration-display" className="practice-rec-duration text-xs" /></div>
              <audio id="rec-playback" controls preload="metadata" className="practice-rec-playback" style={{ display: 'none', width: '100%', margin: '0 0 12px' }} />
              <p id="rec-length-hint" className="practice-rec-length-hint text-xs" style={{ display: 'none', textAlign: 'center', marginBottom: 12 }} />
              <div className="flex gap-3">
                <button type="button" className="btn-ghost practice-icon-btn py-3 text-sm font-semibold" style={{ flex: 1 }} onClick={() => callPractice('resetRecording')}><Icon name="rotate-ccw" />Ghi lại</button>
                <button id="rec-submit-btn" type="button" className="btn-primary practice-icon-btn py-3 text-sm font-bold" style={{ flex: 2 }} onClick={() => callPractice('submitRecording')}><Icon name="upload" />Nộp để chấm điểm</button>
              </div>
            </div>
          </div>
        </div>

        <div id="state-sheet" className={stateClass('sheet', 'state block-state flex-1 av-w-read py-8')}>
          <div className="av-sheet__meter" id="sheet-meter" hidden><div className="av-sheet__ticks" id="sheet-ticks" aria-hidden="true" /><p className="av-sheet__meter-count" id="sheet-meter-count" role="status" /></div>
          <div className="av-sheet" id="sheet-slots" />
          <div className="av-sheet__submit" id="sheet-submit" data-ready="false"><span className="av-sheet__submit-note" id="sheet-submit-note" /><button className="btn btn-primary" id="btn-sheet-submit" type="button" disabled>Nộp bài</button></div>
        </div>

        <div id="state-p2a" className={stateClass('p2a', 'state block-state flex-1 av-w-read py-6 practice-stage practice-stage--part2')}>
          <div className="flex items-center gap-2 mb-5"><span className="ds-badge ds-badge-teal">Part 2</span><span id="p2a-topic" className="practice-p2a-topic text-sm" /></div>
          <div className="card practice-card--cue p-5 mb-5"><p className="practice-cue-card__label text-xs font-bold uppercase tracking-wider mb-3">Cue Card</p><p id="p2a-question" className="practice-p2a-question text-base font-semibold mb-4" /><ul id="p2a-bullets" className="space-y-2 mb-3" style={{ listStyle: 'none', padding: 0, margin: 0 }} /><p id="p2a-reflection" className="practice-p2a-reflection text-sm" /></div>
          <p className="practice-prep-instruction text-xs text-center mb-5">Đọc cue card kỹ, sau đó nhấn nút để bắt đầu 1 phút chuẩn bị.</p>
          <div id="p2a-submit-retry" className="ds-callout practice-error-callout mb-4" style={{ display: 'none' }}><p id="p2a-submit-retry-msg" className="text-sm mb-3" /><audio id="p2a-submit-retry-audio" controls preload="metadata" style={{ width: '100%', marginBottom: 12 }} /><div className="flex gap-3"><button type="button" className="btn-ghost py-3 text-sm font-semibold" style={{ flex: 1 }} onClick={() => callPractice('discardP2SubmissionRetry')}>Ghi lại</button><button type="button" className="btn-primary py-3 text-sm font-bold" style={{ flex: 2 }} onClick={() => callPractice('retryP2Submission')}>Gửi lại bản ghi</button></div></div>
          <button id="p2a-start-btn" type="button" className="btn-primary practice-icon-btn w-full py-4 text-sm font-bold" onClick={() => callPractice('startP2Prep')}><Icon name="play" />Bắt đầu 1 phút chuẩn bị</button>
        </div>

        <div id="state-p2b" className={stateClass('p2b', 'state block-state flex-1 av-w-read py-6 practice-stage practice-stage--part2')}>
          <p className="practice-prep-eyebrow text-xs font-bold uppercase tracking-wider text-center mb-3">Thời gian chuẩn bị</p><p id="p2b-timer" className="practice-prep-timer text-6xl font-extrabold tabular-nums text-center mb-6">1:00</p>
          <div className="card p-4 mb-4"><p className="practice-card-eyebrow text-xs font-bold uppercase tracking-wider mb-2">Câu hỏi</p><p id="p2b-question" className="practice-p2b-question text-sm" /></div>
          <div className="card p-4 mb-5"><p className="practice-card-eyebrow text-xs font-bold uppercase tracking-wider mb-2">Ghi chú của bạn</p><textarea id="p2b-notes" rows={4} className="practice-p2b-notes" placeholder="Ghi nhanh ý chính, từ vựng quan trọng..." /></div>
          <button type="button" className="btn-ghost w-full py-3 text-sm font-semibold" onClick={() => callPractice('startP2SpeakingEarly')}>Bỏ qua → Bắt đầu nói ngay</button>
        </div>

        <div id="state-p2c" className={stateClass('p2c', 'state block-state flex-1 av-w-read py-6 practice-stage practice-stage--part2')}>
          <div className="text-center mb-6"><div className="flex items-center justify-center gap-3 mb-2"><span className="practice-rec-dot" /><span id="p2c-timer" className="practice-rec-timer text-5xl font-extrabold tabular-nums">2:00</span></div><p className="practice-rec-hint text-xs">Đang ghi âm — nói về chủ đề trên cue card</p></div>
          <canvas id="p2c-canvas" width="600" height="56" className="practice-rec-canvas practice-rec-canvas--p2c" />
          <button type="button" className="btn-danger practice-icon-btn w-full py-4 text-sm font-bold" onClick={() => callPractice('stopP2SpeakingEarly')}><Icon name="square" />Dừng sớm</button>
        </div>

        <div id="state-processing" className={stateClass('processing', 'state flex-1 items-center justify-center flex-col gap-6 px-6 text-center')}><div className="spinner" /><div><p id="processing-text" className="practice-processing-text text-base font-semibold" /><p className="practice-processing-sub text-xs mt-2">Vui lòng không đóng trang này</p></div></div>

        <div id="state-feedback" className={stateClass('feedback', 'state block-state flex-1 av-w-read py-8 ds-fadein practice-stage practice-stage--feedback')}>
          <header className="practice-feedback-header"><p className="practice-feedback-header__eyebrow">Phản hồi tức thì</p><h2>Kết quả câu trả lời</h2><p>Ưu tiên một điểm mạnh để giữ lại và một thay đổi nhỏ cho lượt nói tiếp theo.</p></header>
          <div className="practice-feedback-overview"><div id="feedback-band-wrapper" style={{ display: 'none', marginBottom: 16 }}><div className="ds-band-hero"><div className="ds-section-head" style={{ marginBottom: 6 }}>Band Score</div><div id="feedback-band" className="ds-band-value" /></div></div>
          <div id="feedback-bands-row" style={{ display: 'none', justifyContent: 'center', gap: 4, marginBottom: 20, flexWrap: 'wrap' }} />
          <div className="card p-5 mb-4"><p className="practice-card-eyebrow text-xs font-bold uppercase tracking-wider mb-3">Nhận xét</p><div id="feedback-comments" /></div></div>
          <div className="practice-feedback-evidence"><div id="feedback-transcript" className="card p-4 mb-4" style={{ display: 'none' }}><p className="practice-card-eyebrow practice-card-eyebrow--faint text-xs font-bold uppercase tracking-wider mb-2">Văn bản nhận dạng</p><p id="feedback-transcript-text" className="practice-transcript-text text-xs leading-relaxed" /></div>
          <div id="feedback-audio-section" className="practice-feedback-audio" style={{ display: 'none' }}><p className="practice-card-eyebrow practice-card-eyebrow--faint text-xs font-bold uppercase tracking-wider mb-2">Bài nói của bạn</p><div className="flex gap-2"><button type="button" className="btn-ghost practice-icon-btn py-2.5 text-xs font-semibold" style={{ flex: 1 }} onClick={() => callPractice('replayAudio')}><Icon name="volume-2" />Nghe lại</button><button type="button" className="btn-ghost practice-icon-btn py-2.5 text-xs font-semibold" style={{ flex: 1 }} onClick={() => callPractice('downloadAudio')}><Icon name="download" />Tải audio</button></div></div></div>
          <div id="grammar-resources" className="practice-feedback-divider" style={{ display: 'none' }}><div className="practice-feedback-divider__inner"><p className="practice-feedback-eyebrow text-xs font-bold uppercase tracking-wider mb-1">Quick Grammar Tip</p><p className="practice-feedback-sub text-xs mb-3">Dựa trên lỗi ngữ pháp trong câu trả lời vừa rồi</p><div id="grammar-resources-cards" className="flex flex-col gap-2.5" /></div></div>
          <div id="pronunciation-section" className="practice-feedback-divider" style={{ display: 'none' }}><div className="practice-feedback-divider__inner"><p className="practice-feedback-eyebrow practice-feedback-eyebrow--xs">Phân tích phát âm chuyên sâu</p><p className="practice-feedback-sub practice-feedback-sub--xs">Ngoài nhận xét chung ở trên, hệ thống cũng phân tích kỹ hơn phần phát âm để bạn biết nên luyện thêm ở đâu.</p><div id="pron-loading-block" className="practice-pron-loading" style={{ display: 'none' }}><div className="spinner practice-pron-loading__spinner" /><p className="practice-pron-loading__text">Đang phân tích bài nói của bạn...</p></div><div id="pron-result-block" style={{ display: 'none' }} /></div></div>
          <div className="practice-feedback-actions flex flex-col gap-3"><button id="btn-back-sheet" type="button" className="btn-primary practice-icon-btn w-full py-3.5 text-sm" style={{ display: 'none' }} onClick={() => callPractice('backToSheet')}><Icon name="arrow-left" />Quay lại phiếu làm bài</button><button id="btn-next-q" type="button" className="btn-primary practice-icon-btn w-full py-3.5 text-sm" style={{ display: 'none' }} onClick={() => callPractice('nextQuestion')}>Câu tiếp theo<Icon name="arrow-right" /></button><button id="btn-finish" type="button" className="btn-primary practice-icon-btn w-full py-3.5 text-sm" style={{ display: 'none' }} onClick={() => callPractice('finishSession')}><Icon name="check" />Hoàn thành phiên luyện</button></div>
        </div>

        <div id="state-completion" className={stateClass('completion', 'state flex-1 items-center justify-center flex-col gap-0 px-6 text-center practice-stage practice-stage--completion')}>
          <div className="practice-completion-check"><Icon name="check" /></div><p className="practice-completion-eyebrow">Đã ghi nhận đủ 3 Part</p><h2 id="completion-title" className="practice-completion-title">Bạn đã hoàn thành Full Test!</h2><p id="completion-desc" className="practice-completion-desc">Bài thi đang được phân tích chuyên sâu để tổng hợp band score và nhận xét chi tiết.</p>
          <div id="completion-submit-status" className="practice-completion-submit-status is-pending" role="status" aria-live="polite">Đang kiểm tra và gửi nốt các câu trả lời…</div>
          <button id="completion-retry-btn" type="button" className="btn-primary practice-icon-btn practice-completion-retry" style={{ display: 'none' }} onClick={() => callPractice('retryFullTestSubmissions')}>Gửi lại và chốt bài</button>
          <div id="completion-info" className="practice-completion-info"><div className="practice-completion-info__row"><div className="practice-completion-info__icon"><Icon name="clock" /></div><div><p className="practice-completion-info__title">Kết quả sẽ có trong ít phút</p><p className="practice-completion-info__desc">Thường trong vòng 10–15 phút, band score và nhận xét đầy đủ sẽ xuất hiện tại <strong>Lịch sử sessions</strong> trên Dashboard.</p></div></div><div className="practice-completion-info__row"><div className="practice-completion-info__icon"><Icon name="check-circle-2" /></div><div><p className="practice-completion-info__title">Bạn không cần ngồi chờ ở đây</p><p className="practice-completion-info__desc">Hệ thống sẽ xử lý phần còn lại. Bạn có thể quay lại hoặc luyện thêm ngay bây giờ.</p></div></div></div>
          <div id="completion-ctas" className="practice-completion-ctas"><a href="/speaking" className="practice-completion-cta practice-completion-cta--primary">Quay lại</a><a href="/speaking#history" className="practice-completion-cta practice-completion-cta--ghost">Xem Lịch sử sessions</a></div>
        </div>

        <div id="state-test-results" className={stateClass('test-results', 'state block-state flex-1 av-w-read py-8 practice-stage practice-stage--summary')}>
          <header className="practice-feedback-header"><p className="practice-feedback-header__eyebrow">Tổng kết phiên</p><h2>Kết quả bài Test</h2><p className="practice-test-results-sub">Tổng hợp tất cả câu trả lời trong buổi test</p></header>
          <div id="test-overall-wrap" className="card practice-overall-wrap p-6 mb-6 text-center"><p className="practice-overall-eyebrow text-xs font-semibold uppercase tracking-wider mb-2">Overall Band (trung bình)</p><div id="test-overall-band" className="practice-overall-band text-6xl font-bold">—</div></div>
          <div id="test-results-list" className="flex flex-col gap-4 mb-6" />
          <div id="full-pron-section" className="practice-full-pron-section" style={{ display: 'none' }}><p className="practice-feedback-eyebrow practice-feedback-eyebrow--xs">Phân tích phát âm chuyên sâu</p><p className="practice-feedback-sub practice-feedback-sub--xs">Dựa trên các bài nói của bạn trong cả ba phần, hệ thống tổng hợp nhận xét phát âm để bạn thấy rõ điểm cần luyện thêm.</p><div id="full-pron-block" /></div>
          <button id="btn-export-pdf" type="button" onClick={(event) => callPractice('downloadPDFs', event.currentTarget)} className="practice-pdf-btn practice-icon-btn w-full py-3 rounded-2xl font-bold text-sm mb-3"><Icon name="file-down" />Tải xuống báo cáo PDF</button>
          <button type="button" onClick={() => callPractice('finishSession')} className="practice-finish-btn practice-icon-btn w-full py-3 rounded-2xl font-bold text-sm">Quay lại<Icon name="arrow-right" /></button>
        </div>
      </main>
    </>
  );
}
