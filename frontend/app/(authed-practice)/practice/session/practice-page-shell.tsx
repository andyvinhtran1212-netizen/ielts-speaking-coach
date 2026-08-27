'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from 'react';

type PlayerStateStore = {
  getStateSnapshot(): null | string;
  getViewSnapshot(): any;
  subscribeState(listener: () => void): () => void;
  subscribeView(listener: () => void): () => void;
  updateView(section: string, patch: Record<string, unknown>): boolean;
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
  | 'sheetListen'
  | 'sheetReview'
  | 'sheetRetrySubmission'
  | 'sheetToggleRecording'
  | 'startP2Prep'
  | 'startP2SpeakingEarly'
  | 'startRecording'
  | 'stopP2SpeakingEarly'
  | 'stopRecording'
  | 'submitSheet'
  | 'submitRecording'
  | 'trackGrammarResource';

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

function ScorePills({ bands }: { bands: any[] }) {
  if (!bands?.length) return null;
  return <>{bands.map((band) => (
    <div
      key={band.label}
      data-criterion={band.label}
      title={band.title || undefined}
      className={`ds-band-pill ds-band-pill-${band.tone || 'fc'}`}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', borderRadius: 10, padding: '6px 14px', margin: '0 3px' }}
    >
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2, opacity: .6 }}>{band.label}</span>
      <span style={{ fontSize: 20, fontWeight: 700 }}>{band.display}</span>
    </div>
  ))}</>;
}

function ReliabilityNote({ note, id }: { note: any; id?: string }) {
  if (!note) return null;
  const low = note.tone === 'low';
  return (
    <div
      id={id}
      style={{
        background: low ? 'rgba(248,113,113,0.06)' : 'rgba(251,191,36,0.06)',
        border: `1px solid ${low ? 'rgba(248,113,113,0.22)' : 'rgba(251,191,36,0.22)'}`,
        borderLeft: `3px solid ${low ? '#f87171' : '#fbbf24'}`,
        borderRadius: 10,
        padding: '11px 14px',
        marginBottom: 14,
        fontSize: 12.5,
        lineHeight: 1.6,
        color: 'var(--ds-muted)',
      }}
    >{note.message}</div>
  );
}

function FeedbackWarnings({ warnings }: { warnings: any[] }) {
  if (!warnings?.length) return null;
  return (
    <div className="ds-result-warnings">
      {warnings.map((warning, index) => (
        <div className="ds-warning-banner" role="alert" aria-label="Cảnh báo kết quả" key={`${index}:${warning.message}`}>
          <span className="ds-warning-icon" aria-hidden="true">{warning.icon}</span>
          <p className="ds-warning-message">{warning.message}</p>
        </div>
      ))}
    </div>
  );
}

function FeedbackList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 6px' }}>{title}</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((item, index) => <li key={`${index}:${item}`} style={{ fontSize: 13, color: 'var(--ds-text)', marginBottom: 5 }}><span style={{ color, marginRight: 6 }}>›</span>{item}</li>)}
      </ul>
    </div>
  );
}

function GrammarIssues({ issues }: { issues: any[] }) {
  if (!issues?.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 6px' }}>Grammar Issues</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {issues.map((issue, index) => (
          <li key={`${index}:${issue.text}`} style={{ fontSize: 13, color: 'var(--ds-text)', marginBottom: 5 }}>
            <span style={{ color: '#f87171', marginRight: 6 }}>›</span>{issue.text}
            {issue.recommendation ? <>{' '}<a
              href={issue.recommendation.href}
              target="_blank"
              rel="noopener"
              style={{ fontSize: 11, color: '#14b8a6', textDecoration: 'none', whiteSpace: 'nowrap' }}
              onClick={() => callPractice('trackGrammarResource', issue.recommendation.recId, issue.recommendation.slug)}
            >→ Học bài: {issue.recommendation.title}</a></> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VocabRecommendations({ recommendations }: { recommendations: any[] }) {
  if (!recommendations?.length) return null;
  return (
    <section aria-label="Bài học từ lỗi từ vựng" style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--av-primary)', textTransform: 'uppercase', letterSpacing: '.06em', margin: 0 }}>Học từ lỗi vừa nói</p>
      {recommendations.map((item) => <a href={item.href} target="_blank" rel="noopener" key={item.recId || item.slug} style={{ display: 'block', padding: '11px 12px', border: '1px solid rgba(20,184,166,.28)', borderRadius: 10, background: 'rgba(20,184,166,.07)', color: 'var(--ds-text)', textDecoration: 'none' }}><strong style={{ display: 'block', fontSize: 13, color: 'var(--av-primary)' }}>{item.title}</strong>{item.evidence && item.corrected ? <span style={{ display: 'grid', gap: 2, fontSize: 12, marginTop: 4 }}><span><span style={{ color: 'var(--ds-muted)' }}>Bạn đã nói: </span><s>{item.evidence}</s></span><span><span style={{ color: 'var(--ds-muted)' }}>Nên nói: </span>{item.corrected}</span></span> : null}{item.reason ? <span style={{ display: 'block', fontSize: 12, color: 'var(--ds-muted)', marginTop: 4 }}>{item.reason}</span> : null}<span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--av-primary)', marginTop: 6 }}>Mở bài học →</span></a>)}
    </section>
  );
}

function GrammarCheck({ groups, moreCount }: { groups: any[]; moreCount: number }) {
  if (!groups?.length) return null;
  return (
    <div className="ds-grammar-section">
      <p className="ds-grammar-section-head">Grammar Issues (LanguageTool)</p>
      {groups.map((group) => (
        <div className="ds-grammar-category" key={group.category}>
          <p className="ds-grammar-category-title">{group.label}</p>
          <ul className="ds-grammar-error-list">
            {group.errors.map((error: any, index: number) => (
              <li className="ds-grammar-error-item" data-error-id={error.id} key={`${error.id}:${index}`}>
                <div className="ds-grammar-error-pair"><span className="ds-grammar-error-original">{error.original}</span><span className="ds-grammar-error-arrow" aria-hidden="true">→</span><span className="ds-grammar-error-suggestion">{error.suggestion}</span></div>
                {error.explanation ? <p className="ds-grammar-error-explanation">{error.explanation}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {moreCount > 0 ? <p className="ds-grammar-more-info">+{moreCount} lỗi khác đã được phát hiện.</p> : null}
    </div>
  );
}

function Corrections({ corrections }: { corrections: any[] }) {
  if (!corrections?.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#fb923c', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 8px' }}>Corrections</p>
      {corrections.map((correction, index) => <div key={`${index}:${correction.original}`} style={{ marginBottom: 10, padding: '10px 12px', background: 'var(--ds-surface)', borderRadius: 8 }}><div style={{ fontSize: 12, color: '#f87171', marginBottom: 3 }}><span style={{ opacity: .6 }}>❌ </span>{correction.original}</div><div style={{ fontSize: 12, color: '#4ade80', marginBottom: 4 }}><span style={{ opacity: .6 }}>✓ </span>{correction.corrected}</div><div style={{ fontSize: 12, color: 'var(--ds-muted)', fontStyle: 'italic' }}>{correction.explanation}</div></div>)}
    </div>
  );
}

function SampleBlock({ sample }: { sample: any }) {
  if (!sample) return null;
  const unavailable = sample.unavailable;
  return (
    <div style={{ marginTop: 16, background: unavailable ? 'rgba(148,163,184,0.10)' : 'rgba(20,184,166,0.08)', borderLeft: `3px solid ${unavailable ? '#94a3b8' : '#14b8a6'}`, borderRadius: '0 6px 6px 0', padding: '12px 14px' }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: unavailable ? '#94a3b8' : '#14b8a6', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 7px' }}>{sample.title}</p>
      <p style={{ fontSize: 13, lineHeight: 1.7, color: unavailable ? 'var(--ds-text-secondary,#94a3b8)' : 'var(--ds-text)', margin: 0 }}>{unavailable ? 'Chưa tạo được mẫu câu trả lời phù hợp cho phần này. Bạn có thể thử lại để nhận mẫu sát với câu trả lời của mình hơn.' : sample.text}</p>
    </div>
  );
}

function FeedbackDetails({ feedback, confidenceId }: { feedback: any; confidenceId?: string }) {
  return (
    <>
      <FeedbackWarnings warnings={feedback.warnings} />
      {feedback.kind === 'stub' ? feedback.stub?.aiUnavailable ? (
        <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 10, padding: '12px 14px' }}><p style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24', margin: '0 0 4px' }}>AI chấm điểm tạm thời không khả dụng</p><p style={{ fontSize: 13, color: 'var(--ds-muted)', margin: 0 }}>Bản ghi âm và văn bản của bạn đã được lưu thành công. Chấm điểm sẽ khả dụng khi dịch vụ AI được khôi phục.</p></div>
      ) : <p style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ds-faint)' }}>Câu trả lời đã được ghi lại nhưng chưa thể chấm điểm ngay lúc này.{feedback.stub?.error ? ` (${feedback.stub.error})` : ''}</p> : null}
      {feedback.kind === 'practice' || feedback.kind === 'formal' ? <ReliabilityNote note={feedback.reliability} id={confidenceId} /> : null}
      {feedback.kind === 'formal' ? feedback.criteria.map((criterion: any) => <div style={{ marginBottom: 14 }} key={criterion.title}><p style={{ fontSize: 11, fontWeight: 700, color: '#14b8a6', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 5px' }}>{criterion.title}</p><p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ds-text)', margin: 0 }}>{criterion.text}</p></div>) : null}
      {feedback.kind === 'practice' ? <FeedbackList title="Strengths" items={feedback.strengths} color="#4ade80" /> : null}
      {feedback.kind === 'formal' ? <FeedbackList title="Điểm mạnh" items={feedback.strengths} color="#4ade80" /> : null}
      <GrammarIssues issues={feedback.grammarIssues} />
      <GrammarCheck groups={feedback.grammarGroups} moreCount={feedback.grammarMoreCount} />
      {feedback.kind === 'practice' ? <FeedbackList title="Vocabulary Issues" items={feedback.vocabularyIssues} color="#fb923c" /> : null}
      {feedback.kind === 'practice' ? <VocabRecommendations recommendations={feedback.vocabRecommendations} /> : null}
      {feedback.kind === 'formal' ? <FeedbackList title="Cần cải thiện" items={feedback.improvements} color="#fb923c" /> : null}
      <Corrections corrections={feedback.corrections} />
      <SampleBlock sample={feedback.sample} />
      {feedback.kind === 'empty' ? <p style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--ds-faint)' }}>Không có nhận xét.</p> : null}
    </>
  );
}

function Transcript({ segments }: { segments: any[] }) {
  return <>{segments.map((segment, index) => segment.type === 'error' ? <mark
    className="ds-grammar-highlight"
    data-error-id={segment.id}
    data-tooltip={segment.tooltip}
    tabIndex={0}
    role="button"
    aria-label={`Lỗi ngữ pháp: ${segment.text} — gợi ý: ${segment.suggestion}`}
    key={`${segment.id}:${index}`}
  >{segment.text}</mark> : <span key={`text:${index}`}>{segment.text}</span>)}</>;
}

function GrammarResource({ resource }: { resource: any }) {
  if (!resource) return null;
  return <a href={resource.href} target="_blank" rel="noopener" onClick={() => callPractice('trackGrammarResource', resource.recId, resource.slug)} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', background: 'rgba(20,184,166,0.07)', border: '1px solid rgba(20,184,166,0.28)', borderLeft: '3px solid #14b8a6', borderRadius: 14, textDecoration: 'none' }}><div style={{ flex: 1, minWidth: 0 }}><p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)', margin: '0 0 3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{resource.title}</p><p style={{ fontSize: 12, color: 'var(--ds-muted)', margin: '0 0 6px', lineHeight: 1.4 }}>{resource.summary}</p><p style={{ fontSize: 11, color: 'rgba(20,184,166,0.7)', margin: 0 }}>{resource.reason}</p></div><span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#14b8a6', background: 'rgba(20,184,166,0.14)', borderRadius: 8, padding: '5px 10px', whiteSpace: 'nowrap', alignSelf: 'center' }}>Học ngay →</span></a>;
}

function PronScoreChip({ score }: { score: any }) {
  const value = score.value;
  const color = value == null ? 'var(--ds-faint)' : value >= 75 ? '#4ade80' : value >= 55 ? '#14b8a6' : '#fb923c';
  return <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '6px 10px', minWidth: 64 }}><span style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{value == null ? '—' : value}</span><span style={{ fontSize: 9, color: 'var(--ds-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 3 }}>{score.label}</span></div>;
}

function PronunciationAccordion({ weakWords }: { weakWords: any[] }) {
  if (!weakWords?.length) return null;
  const references = typeof window === 'undefined' ? {} : ((window as any).PronunciationDrilldown?.PHONEME_REF || {});
  return <div className="ds-accordion" data-drilldown-content><p className="ds-accordion__hint">Bấm vào mỗi từ để xem chi tiết âm cần luyện.</p>{weakWords.map((entry, occurrenceIndex) => {
    const phonemes = [...(entry.phonemes || [])].sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
    const weak = phonemes.filter((phoneme) => phoneme.score != null && phoneme.score < 70).length;
    return <details className="ds-accordion__item" data-drilldown-word={entry.word} data-drilldown-index={occurrenceIndex} open={weakWords.length <= 1 || undefined} key={`${entry.word}:${occurrenceIndex}`}><summary className="ds-accordion__head"><span className="ds-accordion__word">{entry.word}</span><span className="ds-accordion__count">{weak > 0 ? `${weak} âm cần luyện` : `${phonemes.length} âm`}</span></summary><div className="ds-accordion__body">{phonemes.length ? phonemes.map((phoneme: any, index: number) => {
      const reference = (references as any)[phoneme.symbol];
      const score = phoneme.score;
      const tier = score == null || score < 60 ? 'low' : score < 80 ? 'mid' : 'high';
      const percentage = Math.max(0, Math.min(100, score == null ? 0 : score));
      return <div className="ds-phoneme" key={`${phoneme.symbol}:${index}`}><div className="ds-phoneme__row"><span className="ds-phoneme__sym">{phoneme.symbol}{reference ? <span className="ds-phoneme__ipa"> /{reference.ipa}/</span> : null}</span><span className={`ds-phoneme__score ds-phoneme__score--${tier}`}>{score == null ? '—' : Math.round(score)}/100</span></div><div className="ds-phoneme__bar"><div className={`ds-phoneme__bar-fill ds-phoneme__bar-fill--${tier}`} style={{ width: `${percentage}%` }} /></div>{reference ? <><p className="ds-phoneme__examples">Ví dụ: {reference.examples.map((example: string, exampleIndex: number) => <span key={example}>{exampleIndex ? ', ' : ''}<b>{example}</b></span>)}</p><p className="ds-phoneme__tip">{reference.tip_vn}</p></> : <p className="ds-phoneme__tip">Hướng dẫn cho âm này đang được cập nhật.</p>}</div>;
    }) : <p className="ds-phoneme__tip">Không có dữ liệu âm vị cho từ này.</p>}</div></details>;
  })}</div>;
}

function PronunciationPanel({ pronunciation }: { pronunciation: any }) {
  if (!pronunciation?.visible) return null;
  if (pronunciation.status !== 'completed') return <p style={{ fontSize: 12, color: 'var(--ds-faint)', lineHeight: 1.6, fontStyle: 'italic' }}>{pronunciation.message}</p>;
  return <div style={{ padding: '14px 16px', background: 'rgba(20,184,166,0.05)', border: '1px solid rgba(20,184,166,0.2)', borderRadius: 12 }}><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>{pronunciation.scores.map((score: any) => <PronScoreChip score={score} key={score.label} />)}</div><p style={{ fontSize: 10, color: 'var(--ds-muted)', margin: '-4px 0 10px' }}>Điểm phát âm theo thang Azure 0–100 (khác thang band 0–9).</p>{pronunciation.summary?.length ? <ul style={{ fontSize: 12, color: 'var(--ds-text)', paddingLeft: 16, margin: '0 0 4px', lineHeight: 1.7 }}>{pronunciation.summary.map((item: string, index: number) => <li style={{ marginBottom: 4 }} key={`${index}:${item}`}>{item}</li>)}</ul> : null}{pronunciation.weakWords?.length ? <><p style={{ fontSize: 11, color: 'var(--ds-muted)', margin: '10px 0 4px' }}>Từ cần chú ý:</p><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{pronunciation.weakWords.map((entry: any, index: number) => entry.phonemes?.length ? <button type="button" className="ds-pron-weak-word" data-pron-idx={index} title="Xem âm cần luyện" style={{ background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.3)', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: '#fb923c', cursor: 'pointer' }} key={`${index}:${entry.word}`}>{entry.word} ⓘ</button> : <span style={{ background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.3)', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: '#fb923c' }} key={`${index}:${entry.word}`}>{entry.word}</span>)}</div><PronunciationAccordion weakWords={pronunciation.weakWords} /></> : null}</div>;
}

function TestResultCard({ card }: { card: any }) {
  const value = card.overallBand == null ? null : Number(card.overallBand);
  const color = value == null ? 'var(--av-text-muted)' : value >= 7 ? 'var(--av-success)' : value >= 6 ? 'var(--av-primary)' : value >= 5 ? 'var(--av-warning)' : 'var(--av-error)';
  return <div style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 14, padding: '14px 16px' }}><div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}><div style={{ flex: 1, minWidth: 0 }}><p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ds-faint)', textTransform: 'uppercase', letterSpacing: '.07em', margin: '0 0 4px' }}>Part {card.part} · Câu {card.questionNumber}</p><p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)', margin: 0, lineHeight: 1.45 }}>{card.questionText}</p></div><div style={{ textAlign: 'center', flexShrink: 0 }}><div style={{ fontSize: 28, fontWeight: 800, color }}>{card.overallBand ?? '—'}</div><div style={{ fontSize: 9, color: 'var(--ds-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>band</div></div></div>{card.bands?.length ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}><ScorePills bands={card.bands} /></div> : null}<div style={{ marginTop: 12, borderTop: '1px solid var(--ds-border)', paddingTop: 12 }}><FeedbackDetails feedback={card} /></div>{card.transcriptVisible ? <p style={{ fontSize: 12, color: 'var(--ds-muted)', margin: '8px 0 0', borderTop: '1px solid var(--ds-border)', paddingTop: 8, lineHeight: 1.5 }}><Transcript segments={card.transcriptSegments} /></p> : null}</div>;
}

function FullPronunciationPanel({ model }: { model: any }) {
  if (!model?.visible) return null;
  if (model.status === 'loading') return <div style={{ border: '1px solid rgba(20,184,166,0.15)', borderRadius: 14, padding: '20px 16px', textAlign: 'center' }}><div className="spinner" style={{ width: 22, height: 22, borderWidth: 2, margin: '0 auto 10px' }} /><p style={{ fontSize: 12, color: 'var(--ds-muted)', margin: 0 }}>Đang tổng hợp phân tích phát âm cho toàn bài...</p></div>;
  if (model.status === 'error') return <div style={{ border: '1px solid var(--ds-border)', borderRadius: 14, padding: '14px 16px' }}><p style={{ fontSize: 12, color: 'var(--ds-faint)', margin: 0, lineHeight: 1.6, fontStyle: 'italic' }}>{model.message}</p></div>;
  const overall = model.overallScore == null ? null : Math.round(model.overallScore);
  const color = overall == null ? 'var(--ds-muted)' : overall >= 75 ? '#4ade80' : overall >= 55 ? '#14b8a6' : '#fb923c';
  return <><div style={{ border: '1px solid rgba(20,184,166,0.25)', borderRadius: 14, overflow: 'hidden' }}><div style={{ background: 'rgba(20,184,166,0.08)', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><div><p style={{ fontSize: 11, fontWeight: 700, color: '#14b8a6', textTransform: 'uppercase', letterSpacing: '.08em', margin: '0 0 2px' }}>Phân tích phát âm chuyên sâu</p><p style={{ fontSize: 10, color: 'var(--ds-muted)', margin: 0 }}>{model.subtitle}</p></div><div style={{ textAlign: 'center' }}><div style={{ fontSize: 32, fontWeight: 900, color, lineHeight: 1 }}>{overall ?? '—'}</div><div style={{ fontSize: 9, color: 'var(--ds-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>/100</div></div></div><div style={{ padding: '14px 16px' }}>{model.parts.map((part: any) => part.available ? <div style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }} key={part.key}><div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}><div style={{ flex: 1, minWidth: 0 }}><p style={{ fontSize: 11, fontWeight: 700, color: '#14b8a6', margin: '0 0 2px' }}>{part.label}</p><p style={{ fontSize: 10, color: 'var(--ds-muted)', margin: 0, lineHeight: 1.4 }}>{part.selectionReason}</p>{part.segment ? <p style={{ fontSize: 10, color: 'var(--ds-faint)', margin: '2px 0 0' }}>{part.segment}</p> : null}</div><div style={{ textAlign: 'center', flexShrink: 0 }}><div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{part.pronunciationScore == null ? '—' : Math.round(part.pronunciationScore)}</div><div style={{ fontSize: 8, color: 'var(--ds-faint)', textTransform: 'uppercase' }}>/ 100</div></div></div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>{part.scores.map((score: any) => <PronScoreChip score={score} key={score.label} />)}</div>{part.lowConfidence ? <p style={{ fontSize: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 6, padding: '4px 8px', color: '#fbbf24', margin: '6px 0 0' }}>⚠ Phần trả lời khá ngắn — nhận xét mang tính tham khảo, bạn nên luyện nói dài hơn để được đánh giá chính xác hơn</p> : null}{part.weakWords?.length ? <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>{part.weakWords.map((word: string) => <span style={{ background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.25)', borderRadius: 5, padding: '1px 7px', fontSize: 10, color: '#fb923c' }} key={word}>{word}</span>)}</div> : null}</div> : <div style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }} key={part.key}><p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ds-muted)', margin: '0 0 4px' }}>{part.label}</p><p style={{ fontSize: 11, color: 'var(--ds-faint)', margin: 0, fontStyle: 'italic' }}>Không có dữ liệu</p></div>)}</div></div><ReliabilityNote note={model.reliability} /></>;
}

export function PracticePageShell({ player }: { player: PlayerStateStore }) {
  const listenAudioRef = useRef<HTMLAudioElement>(null);
  const p2RetryAudioRef = useRef<HTMLAudioElement>(null);
  const subscribe = useCallback(
    (listener: () => void) => player.subscribeState(listener),
    [player],
  );
  const getSnapshot = useCallback(() => player.getStateSnapshot(), [player]);
  const activeState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot) || 'loading';
  const subscribeView = useCallback(
    (listener: () => void) => player.subscribeView(listener),
    [player],
  );
  const getViewSnapshot = useCallback(() => player.getViewSnapshot(), [player]);
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  const stateClass = (name: string, className: string) =>
    `${className}${activeState === name ? ' active' : ''}`;
  const returnHref = typeof view.frame.returnHref === 'string' && view.frame.returnHref.startsWith('/')
    ? view.frame.returnHref : '/speaking';
  const returnLabel = typeof view.frame.returnLabel === 'string' && view.frame.returnLabel
    ? view.frame.returnLabel : 'Quay lại';
  const contextLabel = typeof view.frame.contextLabel === 'string' && view.frame.contextLabel
    ? view.frame.contextLabel : 'Speaking';
  const guardUnsentRecording = (event: MouseEvent<HTMLAnchorElement>) => {
    if ((window as any).PracticeApp?.canLeave?.() === false) event.preventDefault();
  };

  useEffect(() => {
    if (view.prep.listenOnly && view.prep.listenAudioUrl) return;
    const audio = listenAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
  }, [view.prep.listenAudioUrl, view.prep.listenOnly]);

  useEffect(() => {
    if (view.part2.retryPlaybackUrl) return;
    const audio = p2RetryAudioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
  }, [view.part2.retryPlaybackUrl]);

  return (
    <>
      <header className="practice-header practice-context-bar sticky top-0 z-30 px-5 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={returnHref} className="practice-back-link" onClick={guardUnsentRecording}><Icon name="chevron-left" />{returnLabel}</Link>
          <p className="eyebrow" style={{ margin: 0 }}>{contextLabel}</p>
        </div>
        <div className="flex items-center gap-3 min-w-0">
          <span id="hdr-info" className={`${view.header.visible ? '' : 'hidden '}text-xs font-medium truncate practice-hdr-info`}>{view.header.info}</span>
          <span id="hdr-progress" className={`${view.header.visible ? '' : 'hidden '}ds-badge ds-badge-teal`} style={{ whiteSpace: 'nowrap' }}>{view.header.progress}</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <div id="test-mode-banner" className="practice-test-banner" style={{ display: view.frame.testModeBannerVisible ? '' : 'none' }}>
          <span className="practice-test-banner__label"><Icon name="alert-triangle" />TEST MODE — KHÔNG ĐƯỢC DỪNG GIỮA CHỪNG</span>
        </div>
        <div id="progress-bar-wrap" className="practice-progress-wrap" style={{ display: view.header.progressBarVisible ? '' : 'none' }}>
          <div id="progress-bar-label" className="practice-progress-label">{view.header.progressBarLabel}</div>
          <div className="practice-progress-rail"><div id="progress-bar-fill" className="practice-progress-fill" style={{ width: `${view.header.progressBarPercent}%` }} /></div>
        </div>

        <div id="state-loading" className={stateClass('loading', 'state flex-1 items-center justify-center flex-col gap-4')}>
          <div className="spinner" />
          <p id="loading-msg" className="practice-loading-msg text-sm">{view.frame.loadingMessage}</p>
        </div>

        <div id="state-error" className={stateClass('error', 'state flex-1 items-center justify-center flex-col gap-4 px-6')}>
          <div className="practice-error-icon"><Icon name="alert-triangle" /></div>
          <h2 className="text-lg font-bold">Đã xảy ra lỗi</h2>
          <p id="error-msg" className="practice-error-msg text-sm text-center max-w-xs">{view.frame.errorMessage}</p>
          <Link href={returnHref} className="btn-ghost px-5 py-2.5 text-sm font-semibold inline-block" onClick={guardUnsentRecording}>{returnLabel}</Link>
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
          <div id="prep-fallback-warning" className="ds-callout practice-warning-callout" style={{ display: view.prep.fallbackWarningVisible ? '' : 'none' }}>
            <Icon name="alert-triangle" /><span>AI chưa sẵn sàng — đang dùng câu hỏi dự phòng. Chất lượng có thể thấp hơn bình thường.</span>
          </div>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span id="prep-part-badge" className="ds-badge ds-badge-teal">{view.prep.partBadge}</span>
            <span id="prep-topic" className="practice-prep-topic text-sm font-medium">{view.prep.topic}</span>
            <span id="prep-q-counter" className="practice-prep-counter ml-auto text-xs font-semibold">{view.prep.counter}</span>
          </div>
          <div id="prep-mode-toggle" className="practice-mode-toggle flex gap-1 mb-4 p-1 rounded-xl" style={{ display: view.prep.modeToggleVisible ? '' : 'none' }}>
            <button id="prep-mode-visual" type="button" className="practice-mode-toggle__btn flex-1 py-1.5 text-xs font-semibold rounded-lg" onClick={() => callPractice('setQMode', 'visual')}><Icon name="eye" />Visual</button>
            <button id="prep-mode-listening" type="button" className="practice-mode-toggle__btn flex-1 py-1.5 text-xs font-semibold rounded-lg" onClick={() => callPractice('setQMode', 'listening')}><Icon name="volume-2" />Listening</button>
          </div>
          <div id="prep-listen-bar" style={{ display: view.prep.listeningBarVisible ? '' : 'none' }} className="mb-4 flex items-center justify-center">
            <button id="prep-play-btn" type="button" className="btn-primary practice-icon-btn px-7 py-2.5 text-sm font-bold" onClick={() => callPractice('playQuestion')}>{view.prep.playIsReplay ? '↺ ' : <Icon name="volume-2" />}{view.prep.playLabel}</button>
          </div>
          <div id="prep-q-card" className={`${view.prep.listenOnly ? 'hidden ' : ''}ds-question-card mb-5 ds-fadein`} style={{ transition: 'opacity 0.2s', opacity: view.prep.qCardOpacity }}>
            <div className="ds-q-label">Câu hỏi</div>
            <div id="prep-text-reveal" style={{ display: view.prep.revealTextVisible ? '' : 'none' }}><p id="prep-q-text" className="ds-q-text">{view.prep.questionText}</p></div>
            <button id="prep-reveal-btn" type="button" className="practice-reveal-btn w-full text-xs py-2 px-4 rounded-lg font-medium transition" style={{ display: view.prep.revealButtonVisible ? '' : 'none' }} onClick={() => callPractice('revealQuestionText')}><Icon name="eye" />Hiện câu hỏi</button>
          </div>
          <div id="prep-listen" className={`${view.prep.listenOnly ? '' : 'hidden '}ds-question-card mb-5`}>
            <div className="ds-q-label">Nghe câu hỏi</div>
            <p className="prep-listen__hint">Nghe rồi trả lời. Không có bản chữ — như trong phòng thi.</p>
            <audio ref={listenAudioRef} id="prep-listen-audio" src={view.prep.listenAudioUrl || undefined} preload="auto" controls className="prep-listen__audio" onError={() => player.updateView('prep', { listenError: 'Chưa tải được câu hỏi. Kiểm tra kết nối rồi bấm phát lại.' })} />
            <p id="prep-listen-error" className={`${view.prep.listenError ? '' : 'hidden '}prep-listen__error`}>{view.prep.listenError}</p>
          </div>
          <div id="prep-cue" className={`${view.prep.cueVisible ? '' : 'hidden '}ds-cue-card mb-6`}>
            <p className="practice-cue-card__label text-xs font-bold uppercase tracking-wider mb-3"><Icon name="clipboard-list" />Cue Card — Hãy nói về:</p>
            <div id="prep-cue-bullets" className="mb-3">{view.prep.cueBullets.map((bullet: string, index: number) => <div className="ds-cue-bullet" key={`${index}:${bullet}`}>{bullet}</div>)}</div>
            <p id="prep-cue-reflection" className="practice-cue-card__reflection text-sm italic">{view.prep.cueReflection}</p>
          </div>
          <p id="prep-instruction" className="practice-prep-instruction text-xs text-center mb-6">{view.prep.instruction}</p>
          <button id="prep-start-btn" type="button" className="btn-primary practice-icon-btn w-full py-4 text-base" style={{ display: view.prep.startButtonVisible ? '' : 'none' }} onClick={() => callPractice('goToRecording')}><Icon name="mic" />Bắt đầu ghi âm</button>
          <div id="inline-rec-section" style={{ display: view.prep.inlineRecordingVisible ? '' : 'none', marginTop: 16 }}>
            <div id="rec-error" className="ds-callout practice-error-callout" style={{ display: view.recording.errorVisible ? '' : 'none' }}>{view.recording.error}</div>
            <div id="rec-idle" style={{ display: view.recording.substate === 'idle' ? '' : 'none' }}>
              <div className="text-center py-4"><div className="ds-rec-ring practice-rec-ring--idle mb-3"><Icon name="mic" className="practice-rec-ring__icon" /></div><p className="practice-rec-idle-label text-sm font-medium mb-1">Sẵn sàng ghi âm</p></div>
              <button type="button" className="btn-primary practice-icon-btn w-full py-4 text-base" onClick={() => callPractice('startRecording')}><Icon name="mic" />Bắt đầu ghi âm</button>
            </div>
            <div id="rec-recording" style={{ display: view.recording.substate === 'recording' ? '' : 'none' }}>
              <div className="text-center mb-4"><div className="flex items-center justify-center gap-3 mb-2"><span className="practice-rec-dot" /><span id="rec-timer" className="practice-rec-timer text-5xl font-extrabold tabular-nums">{view.recording.timer}</span></div><p className="practice-rec-hint text-xs">Đang ghi âm — nói rõ ràng vào microphone</p></div>
              <canvas id="rec-canvas" width="600" height="56" className="practice-rec-canvas" />
              <button type="button" className="btn-danger practice-icon-btn w-full py-4 text-sm font-bold" onClick={() => callPractice('stopRecording')}><Icon name="square" />Dừng ghi âm</button>
            </div>
            <div id="rec-recorded" style={{ display: view.recording.substate === 'recorded' ? '' : 'none' }}>
              <div className="text-center py-4"><div className="practice-rec-success"><Icon name="check-circle" /></div><p className="practice-rec-success-label text-sm font-semibold mb-1">Đã ghi âm xong!</p><p id="rec-duration-display" className="practice-rec-duration text-xs">{view.recording.duration}</p></div>
              <audio id="rec-playback" src={view.recording.playbackUrl || undefined} controls preload="metadata" className="practice-rec-playback" style={{ display: view.recording.playbackUrl ? '' : 'none', width: '100%', margin: '0 0 12px' }} />
              <p id="rec-length-hint" className="practice-rec-length-hint text-xs" style={{ display: view.recording.lengthHintVisible ? '' : 'none', textAlign: 'center', marginBottom: 12 }}>{view.recording.lengthHint}</p>
              <div className="flex gap-3">
                <button type="button" className="btn-ghost practice-icon-btn py-3 text-sm font-semibold" style={{ flex: 1 }} onClick={() => callPractice('resetRecording')}><Icon name="rotate-ccw" />Ghi lại</button>
                <button id="rec-submit-btn" type="button" disabled={view.recording.submitDisabled} aria-disabled={view.recording.submitDisabled || undefined} className="btn-primary practice-icon-btn py-3 text-sm font-bold" style={{ flex: 2 }} onClick={() => callPractice('submitRecording')}><Icon name="upload" />Nộp để chấm điểm</button>
              </div>
            </div>
          </div>
        </div>

        <div id="state-sheet" className={stateClass('sheet', 'state block-state flex-1 av-w-read py-8')}>
          <div className="av-sheet__meter" id="sheet-meter" hidden={!view.sheet.meterVisible}>
            <div className="av-sheet__ticks" id="sheet-ticks" aria-hidden="true">
              {view.sheet.slots.map((slot: any) => <i data-state={slot.state} key={`meter:${slot.key}`} />)}
            </div>
            <p className="av-sheet__meter-count" id="sheet-meter-count" role="status">Đã lưu <strong>{view.sheet.done}/{view.sheet.total}</strong></p>
          </div>
          <div className="av-sheet" id="sheet-slots">
            {view.sheet.slots.map((slot: any) => (
              <section className="av-slot" data-state={slot.state} data-idx={slot.index} key={slot.key}>
                <span className="av-slot__spine" aria-hidden="true" />
                <div className="av-slot__body">
                  <div className="av-slot__head"><span className="av-slot__no">Câu {slot.index + 1}</span><span className="av-slot__status">{slot.status}</span></div>
                  {slot.isCueCard ? (
                    <div className="av-slot__cue">
                      <p className="av-slot__cue-question">{slot.questionText}</p>
                      <p className="av-slot__cue-label">You should say:</p>
                      <ul>{slot.cueBullets.map((bullet: string, index: number) => <li key={`${index}:${bullet}`}>{bullet}</li>)}</ul>
                      {slot.cueReflection ? <p className="av-slot__cue-reflection">{slot.cueReflection}</p> : null}
                    </div>
                  ) : (
                    <button type="button" className="av-slot__listen" disabled={!slot.audioAvailable} onClick={() => callPractice('sheetListen', slot.index)}>
                      <span className="av-slot__listen-icon" aria-hidden="true">▶</span>
                      <span>{slot.audioAvailable ? 'Nghe câu hỏi' : 'Chưa có bản đọc đề'}</span>
                      {slot.replays > 0 ? <span className="av-slot__replays">đã nghe {slot.replays} lần</span> : null}
                    </button>
                  )}
                  <div className="av-slot__actions">
                    {!view.sheet.locked ? <button type="button" className={`btn ${slot.recording ? 'btn-danger' : 'btn-secondary'}`} disabled={slot.busy} onClick={() => callPractice('sheetToggleRecording', slot.index)}>{slot.recordLabel}</button> : null}
                    {slot.canRetry ? <button type="button" className="btn btn-primary" disabled={slot.busy} onClick={() => callPractice('sheetRetrySubmission', slot.index)}>Gửi lại bản ghi</button> : null}
                    {slot.canReview ? <button type="button" className="btn btn-ghost" onClick={() => callPractice('sheetReview', slot.index)}>Xem nhận xét</button> : null}
                    {slot.band !== null ? <span className="av-slot__band">{Number(slot.band).toFixed(1)}</span> : null}
                  </div>
                  {slot.note ? <p className="av-slot__note" data-tone={slot.noteTone || undefined}>{slot.note}</p> : null}
                </div>
              </section>
            ))}
          </div>
          <div className="av-sheet__submit" id="sheet-submit" data-ready={String(view.sheet.ready)}><span className="av-sheet__submit-note" id="sheet-submit-note">{view.sheet.submitNote}</span><button className="btn btn-primary" id="btn-sheet-submit" type="button" disabled={!view.sheet.ready || view.sheet.submitting} onClick={() => callPractice('submitSheet')}>{view.sheet.submitting ? 'Đang nộp…' : view.sheet.submitLabel}</button></div>
        </div>

        <div id="state-p2a" className={stateClass('p2a', 'state block-state flex-1 av-w-read py-6 practice-stage practice-stage--part2')}>
          <div className="flex items-center gap-2 mb-5"><span className="ds-badge ds-badge-teal">Part 2</span><span id="p2a-topic" className="practice-p2a-topic text-sm">{view.part2.topic}</span></div>
          <div className="card practice-card--cue p-5 mb-5"><p className="practice-cue-card__label text-xs font-bold uppercase tracking-wider mb-3">Cue Card</p><p id="p2a-question" className="practice-p2a-question text-base font-semibold mb-4">{view.part2.question}</p><ul id="p2a-bullets" className="space-y-2 mb-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{view.part2.bullets.map((bullet: string, index: number) => <li className="ds-cue-bullet" key={`${index}:${bullet}`}>{bullet}</li>)}</ul><p id="p2a-reflection" className="practice-p2a-reflection text-sm">{view.part2.reflection}</p></div>
          <p className="practice-prep-instruction text-xs text-center mb-5">Đọc cue card kỹ, sau đó nhấn nút để bắt đầu 1 phút chuẩn bị.</p>
          <div id="p2a-submit-retry" className="ds-callout practice-error-callout mb-4" style={{ display: view.part2.retryVisible ? '' : 'none' }}><p id="p2a-submit-retry-msg" className="text-sm mb-3">{view.part2.retryMessage}</p><audio ref={p2RetryAudioRef} id="p2a-submit-retry-audio" src={view.part2.retryPlaybackUrl || undefined} controls preload="metadata" style={{ width: '100%', marginBottom: 12 }} /><div className="flex gap-3"><button type="button" className="btn-ghost py-3 text-sm font-semibold" style={{ flex: 1 }} onClick={() => callPractice('discardP2SubmissionRetry')}>Ghi lại</button><button type="button" className="btn-primary py-3 text-sm font-bold" style={{ flex: 2 }} onClick={() => callPractice('retryP2Submission')}>Gửi lại bản ghi</button></div></div>
          <button id="p2a-start-btn" type="button" className="btn-primary practice-icon-btn w-full py-4 text-sm font-bold" style={{ display: view.part2.startVisible ? '' : 'none' }} onClick={() => callPractice('startP2Prep')}><Icon name="play" />Bắt đầu 1 phút chuẩn bị</button>
        </div>

        <div id="state-p2b" className={stateClass('p2b', 'state block-state flex-1 av-w-read py-6 practice-stage practice-stage--part2')}>
          <p className="practice-prep-eyebrow text-xs font-bold uppercase tracking-wider text-center mb-3">Thời gian chuẩn bị</p><p id="p2b-timer" className="practice-prep-timer text-6xl font-extrabold tabular-nums text-center mb-6" style={{ color: view.part2.prepUrgent ? '#ef4444' : '#f97316' }}>{view.part2.prepTimer}</p>
          <div className="card p-4 mb-4"><p className="practice-card-eyebrow text-xs font-bold uppercase tracking-wider mb-2">Câu hỏi</p><p id="p2b-question" className="practice-p2b-question text-sm">{view.part2.prepQuestion}</p></div>
          <div className="card p-4 mb-5"><p className="practice-card-eyebrow text-xs font-bold uppercase tracking-wider mb-2">Ghi chú của bạn</p><textarea key={view.part2.notesRevision} id="p2b-notes" rows={4} className="practice-p2b-notes" placeholder="Ghi nhanh ý chính, từ vựng quan trọng..." /></div>
          <button type="button" className="btn-ghost w-full py-3 text-sm font-semibold" onClick={() => callPractice('startP2SpeakingEarly')}>Bỏ qua → Bắt đầu nói ngay</button>
        </div>

        <div id="state-p2c" className={stateClass('p2c', 'state block-state flex-1 av-w-read py-6 practice-stage practice-stage--part2')}>
          <div className="text-center mb-6"><div className="flex items-center justify-center gap-3 mb-2"><span className="practice-rec-dot" /><span id="p2c-timer" className="practice-rec-timer text-5xl font-extrabold tabular-nums" style={{ color: view.part2.speakUrgent ? '#ef4444' : '#fff' }}>{view.part2.speakTimer}</span></div><p className="practice-rec-hint text-xs">Đang ghi âm — nói về chủ đề trên cue card</p></div>
          <canvas id="p2c-canvas" width="600" height="56" className="practice-rec-canvas practice-rec-canvas--p2c" />
          <button type="button" className="btn-danger practice-icon-btn w-full py-4 text-sm font-bold" onClick={() => callPractice('stopP2SpeakingEarly')}><Icon name="square" />Dừng sớm</button>
        </div>

        <div id="state-processing" className={stateClass('processing', 'state flex-1 items-center justify-center flex-col gap-6 px-6 text-center')}><div className="spinner" /><div><p id="processing-text" className="practice-processing-text text-base font-semibold">{view.processing.text}</p><p className="practice-processing-sub text-xs mt-2">Vui lòng không đóng trang này</p></div></div>

        <div id="state-feedback" className={stateClass('feedback', 'state block-state flex-1 av-w-read py-8 ds-fadein practice-stage practice-stage--feedback')}>
          {view.feedback.partialVisible ? <div className="ds-warning-banner" role="alert"><span className="ds-warning-icon" aria-hidden="true">⚠️</span><p className="ds-warning-message">Kết quả chỉ lưu được MỘT PHẦN — một số dữ liệu chấm chi tiết đã không lưu. Phần chấm bên dưới vẫn xem được; nếu cần đầy đủ, hãy chấm lại câu này.</p></div> : null}
          <header className="practice-feedback-header"><p className="practice-feedback-header__eyebrow">Phản hồi tức thì</p><h2>Kết quả câu trả lời</h2><p>Ưu tiên một điểm mạnh để giữ lại và một thay đổi nhỏ cho lượt nói tiếp theo.</p></header>
          <div className="practice-feedback-overview"><div id="feedback-band-wrapper" style={{ display: view.feedback.overallBand == null ? 'none' : 'block', marginBottom: 16 }}><div className="ds-band-hero"><div className="ds-section-head" style={{ marginBottom: 6 }}>Band Score</div><div id="feedback-band" className="ds-band-value">{view.feedback.overallBand}</div></div></div>
          <div id="feedback-bands-row" style={{ display: view.feedback.bands.length ? 'flex' : 'none', justifyContent: 'center', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}><ScorePills bands={view.feedback.bands} /></div>
          <div className="card p-5 mb-4"><p className="practice-card-eyebrow text-xs font-bold uppercase tracking-wider mb-3">Nhận xét</p><div id="feedback-comments"><FeedbackDetails feedback={view.feedback} confidenceId="score-confidence-note" /></div></div></div>
          <div className="practice-feedback-evidence"><div id="feedback-transcript" className="card p-4 mb-4" style={{ display: view.feedback.transcriptVisible ? '' : 'none' }}><p className="practice-card-eyebrow practice-card-eyebrow--faint text-xs font-bold uppercase tracking-wider mb-2">Văn bản nhận dạng</p><p id="feedback-transcript-text" className="practice-transcript-text text-xs leading-relaxed"><Transcript segments={view.feedback.transcriptSegments} /></p></div>
          <div id="feedback-audio-section" className="practice-feedback-audio" style={{ display: view.feedback.audioVisible ? '' : 'none' }}><p className="practice-card-eyebrow practice-card-eyebrow--faint text-xs font-bold uppercase tracking-wider mb-2">Bài nói của bạn</p><div className="flex gap-2"><button type="button" className="btn-ghost practice-icon-btn py-2.5 text-xs font-semibold" style={{ flex: 1 }} onClick={() => callPractice('replayAudio')}><Icon name="volume-2" />Nghe lại</button><button type="button" className="btn-ghost practice-icon-btn py-2.5 text-xs font-semibold" style={{ flex: 1 }} onClick={() => callPractice('downloadAudio')}><Icon name="download" />Tải audio</button></div></div></div>
          <div id="grammar-resources" className="practice-feedback-divider" style={{ display: view.feedback.grammarResource ? '' : 'none' }}><div className="practice-feedback-divider__inner"><p className="practice-feedback-eyebrow text-xs font-bold uppercase tracking-wider mb-1">Quick Grammar Tip</p><p className="practice-feedback-sub text-xs mb-3">Dựa trên lỗi ngữ pháp trong câu trả lời vừa rồi</p><div id="grammar-resources-cards" className="flex flex-col gap-2.5"><GrammarResource resource={view.feedback.grammarResource} /></div></div></div>
          <div id="pronunciation-section" className="practice-feedback-divider" style={{ display: view.feedback.pronunciation.visible ? '' : 'none' }}><div className="practice-feedback-divider__inner"><p className="practice-feedback-eyebrow practice-feedback-eyebrow--xs">Phân tích phát âm chuyên sâu</p><p className="practice-feedback-sub practice-feedback-sub--xs">Ngoài nhận xét chung ở trên, hệ thống cũng phân tích kỹ hơn phần phát âm để bạn biết nên luyện thêm ở đâu.</p><div id="pron-loading-block" className="practice-pron-loading" style={{ display: 'none' }}><div className="spinner practice-pron-loading__spinner" /><p className="practice-pron-loading__text">Đang phân tích bài nói của bạn...</p></div><div id="pron-result-block" style={{ display: view.feedback.pronunciation.visible ? '' : 'none' }}><PronunciationPanel pronunciation={view.feedback.pronunciation} /></div></div></div>
          <div className="practice-feedback-actions flex flex-col gap-3"><button id="btn-back-sheet" type="button" className="btn-primary practice-icon-btn w-full py-3.5 text-sm" style={{ display: view.feedback.backToSheetVisible ? '' : 'none' }} onClick={() => callPractice('backToSheet')}><Icon name="arrow-left" />Quay lại phiếu làm bài</button><button id="btn-next-q" type="button" className="btn-primary practice-icon-btn w-full py-3.5 text-sm" style={{ display: view.feedback.nextVisible ? '' : 'none' }} onClick={() => callPractice('nextQuestion')}>Câu tiếp theo<Icon name="arrow-right" /></button><button id="btn-finish" type="button" className="btn-primary practice-icon-btn w-full py-3.5 text-sm" style={{ display: view.feedback.finishVisible ? '' : 'none' }} onClick={() => callPractice('finishSession')}><Icon name="check" />{view.feedback.finishLabel}</button></div>
        </div>

        <div id="state-completion" className={stateClass('completion', 'state flex-1 items-center justify-center flex-col gap-0 px-6 text-center practice-stage practice-stage--completion')}>
          <div className="practice-completion-check"><Icon name="check" /></div><p className="practice-completion-eyebrow">Đã ghi nhận đủ 3 Part</p><h2 id="completion-title" className="practice-completion-title">{view.completion.title}</h2><p id="completion-desc" className="practice-completion-desc">{view.completion.description}</p>
          <div id="completion-submit-status" className={`practice-completion-submit-status is-${view.completion.statusTone}`} role="status" aria-live="polite">{view.completion.statusText}</div>
          <button id="completion-retry-btn" type="button" disabled={view.completion.retryDisabled} className="btn-primary practice-icon-btn practice-completion-retry" style={{ display: view.completion.retryVisible ? '' : 'none' }} onClick={() => callPractice('retryFullTestSubmissions')}>{view.completion.retryLabel}</button>
          <div id="completion-info" className="practice-completion-info" style={{ display: view.completion.infoVisible ? '' : 'none' }}><div className="practice-completion-info__row"><div className="practice-completion-info__icon"><Icon name="clock" /></div><div><p className="practice-completion-info__title">Kết quả sẽ có trong ít phút</p><p className="practice-completion-info__desc">Thường trong vòng 10–15 phút, band score và nhận xét đầy đủ sẽ xuất hiện tại <strong>Lịch sử sessions</strong> trên Dashboard.</p></div></div><div className="practice-completion-info__row"><div className="practice-completion-info__icon"><Icon name="check-circle-2" /></div><div><p className="practice-completion-info__title">Bạn không cần ngồi chờ ở đây</p><p className="practice-completion-info__desc">Hệ thống sẽ xử lý phần còn lại. Bạn có thể quay lại hoặc luyện thêm ngay bây giờ.</p></div></div></div>
          <div id="completion-ctas" className="practice-completion-ctas" style={{ display: view.completion.ctasVisible ? '' : 'none' }}><a href="/speaking" className="practice-completion-cta practice-completion-cta--primary">Quay lại</a><a href="/speaking#history" className="practice-completion-cta practice-completion-cta--ghost">Xem Lịch sử sessions</a></div>
        </div>

        <div id="state-test-results" className={stateClass('test-results', 'state block-state flex-1 av-w-read py-8 practice-stage practice-stage--summary')}>
          <header className="practice-feedback-header"><p className="practice-feedback-header__eyebrow">Tổng kết phiên</p><h2>Kết quả bài Test</h2><p className="practice-test-results-sub">Tổng hợp tất cả câu trả lời trong buổi test</p></header>
          <div id="test-overall-wrap" className="card practice-overall-wrap p-6 mb-6 text-center"><p className="practice-overall-eyebrow text-xs font-semibold uppercase tracking-wider mb-2">Overall Band (trung bình)</p><div id="test-overall-band" className="practice-overall-band text-6xl font-bold">{view.testResults.overallBand}</div></div>
          <div id="test-results-list" className="flex flex-col gap-4 mb-6">{view.testResults.cards.map((card: any) => <TestResultCard card={card} key={card.key} />)}</div>
          <div id="full-pron-section" className="practice-full-pron-section" style={{ display: view.testResults.fullPronunciation.visible ? '' : 'none' }}><p className="practice-feedback-eyebrow practice-feedback-eyebrow--xs">Phân tích phát âm chuyên sâu</p><p className="practice-feedback-sub practice-feedback-sub--xs">Dựa trên các bài nói của bạn trong cả ba phần, hệ thống tổng hợp nhận xét phát âm để bạn thấy rõ điểm cần luyện thêm.</p><div id="full-pron-block"><FullPronunciationPanel model={view.testResults.fullPronunciation} /></div></div>
          <button id="btn-export-pdf" type="button" onClick={(event) => callPractice('downloadPDFs', event.currentTarget)} className="practice-pdf-btn practice-icon-btn w-full py-3 rounded-2xl font-bold text-sm mb-3"><Icon name="file-down" />Tải xuống báo cáo PDF</button>
          <button type="button" onClick={() => callPractice('finishSession')} className="practice-finish-btn practice-icon-btn w-full py-3 rounded-2xl font-bold text-sm">Quay lại<Icon name="arrow-right" /></button>
        </div>
      </main>
    </>
  );
}
