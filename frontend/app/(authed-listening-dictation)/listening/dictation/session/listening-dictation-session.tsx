'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import type { components } from '@/types/api';

import { useAuth } from '@/lib/auth/auth-provider';
import { DictationComparison } from '@/components/dictation-evidence';
import { coreOperationHeaders, coreOperationRequest } from '@/lib/core-operation-intent.mjs';
import {
  dictationParams,
  dictationReceiptKey,
  dictationRendererHref,
  dictationRequestId,
  dictationPolicyAcknowledgement,
  dictationPolicyLabel,
  dictationStartPolicy,
  dictationErrorMessage,
  LEGACY_DICTATION_POLICY,
  LEXICAL_DICTATION_POLICY,
  formatDictationTime,
  isDictationCanonicalMismatch,
  isMissingReceipt,
  normalizeDictationBundle,
  normalizeDictationAttempt,
  normalizeDictationGrade,
  normalizeDictationReceipt,
  normalizeDictationReceiptReport,
  normalizeDictationStoredReport,
  reconcileDictationReceiptWithAttempt,
  topDictationWords,
} from '@/lib/listening-dictation-controller.mjs';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';

type Phase = 'loading' | 'error' | 'picker' | 'ready' | 'complete';
type AudioPlayerElement = HTMLElement & { pause?: () => void };
type Result = {
  score: number | null; is_correct: boolean | null; correct_words: number | null; total_words: number | null;
  diff: any[]; user_text: string; listen_count: number | null; time_seconds: number | null;
  grading_version?: string; reference_sha256?: string | null; reference?: string;
};
type SaveState = 'idle' | 'saving' | 'saved' | 'pending';

function percentage(value: unknown) {
  if (value == null) return '—';
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function cue(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return '';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function clientReport(results: Array<Result | null>, totalTime: number | null) {
  // Only live graded results can form a completion preview. Stored legacy
  // absence remains visible and never enters a fabricated numerical summary.
  const completed = results.filter(Boolean) as Array<Result & { score: number; correct_words: number; total_words: number }>;
  if (completed.some((result) => result.score == null || result.correct_words == null || result.total_words == null)) throw new Error('invalid-dictation-grade-counts');
  const totalWords = completed.reduce((sum, result) => sum + result.total_words, 0);
  const correctWords = completed.reduce((sum, result) => sum + result.correct_words, 0);
  const opCounts = { miss: 0, wrong: 0, extra: 0 };
  const missed: Record<string, number> = {};
  const wrong: Record<string, number> = {};
  for (const result of completed) for (const operation of result.diff || []) {
    if (operation.filler || !Object.prototype.hasOwnProperty.call(opCounts, operation.op)) continue;
    opCounts[operation.op as keyof typeof opCounts] += 1;
    const expected = String(operation.expected || '').toLowerCase().replace(/[.,!?;:'"…]+$/, '').trim();
    if (expected && operation.op === 'miss') missed[expected] = (missed[expected] || 0) + 1;
    if (expected && operation.op === 'wrong') wrong[expected] = (wrong[expected] || 0) + 1;
  }
  return {
    total_sentences: completed.length,
    correct_count: completed.filter((result) => result.score >= 1).length,
    accuracy: completed.length ? completed.reduce((sum, result) => sum + result.score, 0) / completed.length : 0,
    total_words: totalWords,
    correct_words: correctWords,
    total_time_seconds: totalTime,
    error_trends: { op_counts: opCounts, missed, wrong },
  };
}

function resultsFromReport(canonical: any, expectedLength: number): Array<Result | null> {
  const restored = new Array(expectedLength).fill(null);
  for (const row of canonical.results || []) {
    const index = Number(row?.sentence_idx);
    if (!Number.isInteger(index) || index < 0 || index >= expectedLength) continue;
    restored[index] = {
      ...row,
      score: row.score, is_correct: row.score == null ? null : row.score >= 1,
      correct_words: row.correct_words, total_words: row.total_words,
      diff: Array.isArray(row.diff) ? row.diff : [], user_text: String(row.user_text || ''),
      listen_count: row.listen_count ?? null, time_seconds: row.time_seconds ?? null,
    };
  }
  return restored;
}

function retainReportUrl(sessionId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('session_id', sessionId);
  window.history.replaceState(null, '', url);
}

function reportSection(selected: any, canonical: any) {
  const references = new Array(canonical.total_sentences).fill(null);
  for (const row of canonical.results) references[row.sentence_idx] = typeof row.reference === 'string' ? row.reference : null;
  return { ...selected, sentences: references };
}

export function ListeningDictationSession() {
  const searchParams = useSearchParams();
  const { status, user } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [bundle, setBundle] = useState<any>(null);
  const [section, setSection] = useState<any>(null);
  const [attempt, setAttempt] = useState<any>(null);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [results, setResults] = useState<Array<Result | null>>([]);
  const [grading, setGrading] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [report, setReport] = useState<any>(null);
  const [pendingReceipt, setPendingReceipt] = useState<any>(null);
  const [flagIndex, setFlagIndex] = useState<number | null>(null);
  const [flagCategory, setFlagCategory] = useState('');
  const [flagNote, setFlagNote] = useState('');
  const [flagError, setFlagError] = useState('');
  const [flagging, setFlagging] = useState(false);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const audioRef = useRef<AudioPlayerElement | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const sentenceStartedAtRef = useRef<number | null>(null);
  const listenCountRef = useRef(0);
  const bootKeyRef = useRef('');
  const bootSequenceRef = useRef(0);
  const sectionRunRef = useRef(0);
  const accountRef = useRef(user?.id || '');
  accountRef.current = user?.id || '';

  const params = useMemo(() => {
    try { return dictationParams(`?${searchParams?.toString() || ''}`); }
    catch { return null; }
  }, [searchParams]);

  const receiptIdentity = useCallback((selected: any) => ({
    accountId: user?.id || '', testId: params?.testId || '', sectionNum: selected.section_num,
  }), [params?.testId, user?.id]);

  const readReceipt = useCallback((selected: any) => {
    if (!user?.id || !params) return null;
    const identity = receiptIdentity(selected);
    try {
      const key = dictationReceiptKey(identity.accountId, identity.testId, identity.sectionNum);
      const stored = localStorage.getItem(key);
      if (!stored) return null;
      const receipt = normalizeDictationReceipt(JSON.parse(stored), identity);
      if (!receipt) localStorage.removeItem(key);
      return receipt;
    } catch { return null; }
  }, [params, receiptIdentity, user?.id]);

  const clearReceipt = useCallback((selected: any) => {
    if (!user?.id || !params) return;
    try { localStorage.removeItem(dictationReceiptKey(user.id, params.testId, selected.section_num)); }
    catch {}
  }, [params, user?.id]);

  const persistReceipt = useCallback((receipt: any, selected: any) => {
    const key = dictationReceiptKey(receipt.accountId, receipt.testId, selected.section_num);
    const serialized = JSON.stringify(receipt);
    const existingRaw = localStorage.getItem(key);
    if (existingRaw) {
      const existing = normalizeDictationReceipt(JSON.parse(existingRaw), receiptIdentity(selected));
      if (existing && existing.requestId !== receipt.requestId) {
        throw new Error('another-pending-receipt');
      }
    }
    localStorage.setItem(key, serialized);
    if (localStorage.getItem(key) !== serialized) throw new Error('receipt-readback-failed');
  }, [receiptIdentity]);

  const clearConfirmedReceipt = useCallback((receipt: any) => {
    try {
      const key = dictationReceiptKey(receipt.accountId, receipt.testId, receipt.sectionNum);
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const current = normalizeDictationReceipt(JSON.parse(raw), receipt);
      if (current?.requestId === receipt.requestId) localStorage.removeItem(key);
    } catch {}
  }, []);

  const confirmReceipt = useCallback(async (receipt: any, selected: any, run: number) => {
    const canonical = normalizeDictationReceiptReport(
      await window.api.get(`/api/listening/tests/dictation/session/by-request/${encodeURIComponent(receipt.requestId)}`),
      receipt,
    );
    clearConfirmedReceipt(receipt);
    if (accountRef.current !== receipt.accountId || sectionRunRef.current !== run) return canonical;
    setSection(reportSection(selected, canonical));
    setReport(canonical); setResults(resultsFromReport(canonical, canonical.total_sentences));
    setSaveState('saved'); setPendingReceipt(null);
    retainReportUrl(canonical.session_id);
    return canonical;
  }, [clearConfirmedReceipt]);

  const confirmAttemptReport = useCallback((payload: any, receipt: any, selected: any, run: number) => {
    const canonical = normalizeDictationReceiptReport(payload, receipt, false);
    clearConfirmedReceipt(receipt);
    if (accountRef.current !== receipt.accountId || sectionRunRef.current !== run) return canonical;
    setSection(reportSection(selected, canonical));
    setReport(canonical); setResults(resultsFromReport(canonical, canonical.total_sentences));
    setSaveState('saved'); setPendingReceipt(null);
    retainReportUrl(canonical.session_id);
    return canonical;
  }, [clearConfirmedReceipt]);

  const recoverReceiptFromCanonicalAttempt = useCallback(async (receipt: any, selected: any, run: number) => {
    const submission = receipt?.submission;
    const testId = String(submission?.test_id || '');
    const sectionNum = Number(submission?.section_num);
    if (!testId || !Number.isInteger(sectionNum) || sectionNum < 1) {
      throw new Error('Không đủ thông tin để khôi phục kết quả đã lưu.');
    }
    const query = `section_num=${encodeURIComponent(sectionNum)}`;
    const canonicalAttempt = normalizeDictationAttempt(await window.api.get(
      `/api/listening/tests/${encodeURIComponent(testId)}/dictation/attempts/in-progress?${query}`,
    ));
    if (sectionRunRef.current !== run || accountRef.current !== receipt.accountId) throw new Error('dictation-reconciliation-scope-ended');
    const recovered = reconcileDictationReceiptWithAttempt(receipt, canonicalAttempt);
    if (!recovered) throw new Error('Dữ liệu đã lưu trên máy chủ chưa đủ để xác nhận kết quả.');
    persistReceipt(recovered, selected);
    setPendingReceipt(recovered);
    return recovered;
  }, [persistReceipt]);

  const reconcile = useCallback(async (receipt: any, selected: any) => {
    const run = sectionRunRef.current;
    const currentScope = () => sectionRunRef.current === run && accountRef.current === receipt.accountId;
    if (!currentScope()) return;
    setSaveState('saving'); setPendingReceipt(receipt);
    try {
      let activeReceipt = receipt;
      try { await confirmReceipt(receipt, selected, run); return; }
      catch (caught) { if (!currentScope()) return; if (!isMissingReceipt(caught)) throw caught; }
      try {
        const posted = await window.api.postWith('/api/listening/tests/dictation/session', receipt.submission, coreOperationHeaders(receipt.requestId));
        if (!currentScope()) return;
        confirmAttemptReport(posted, receipt, selected, run);
        return;
      } catch (postError) {
        if (!currentScope()) return;
        if (isDictationCanonicalMismatch(postError)) {
          activeReceipt = await recoverReceiptFromCanonicalAttempt(receipt, selected, run);
          if (!currentScope()) return;
          try {
            const posted = await window.api.postWith('/api/listening/tests/dictation/session', activeReceipt.submission, coreOperationHeaders(activeReceipt.requestId));
            if (!currentScope()) return;
            confirmAttemptReport(posted, activeReceipt, selected, run);
            return;
          } catch (recoveryPostError) {
            if (!currentScope()) return;
            try { await confirmReceipt(activeReceipt, selected, run); return; }
            catch { throw recoveryPostError; }
          }
        } else {
          // The request may have committed while its HTTP acknowledgement was
          // lost. Read by durable receipt before declaring the save pending.
          try { await confirmReceipt(receipt, selected, run); return; }
          catch { throw postError; }
        }
      }
    } catch (caught: any) {
      if (accountRef.current !== receipt.accountId || sectionRunRef.current !== run) return;
      setSaveState('pending'); setError(`Kết quả chưa được máy chủ xác nhận. ${dictationErrorMessage(caught)}`);
    }
  }, [confirmAttemptReport, confirmReceipt, recoverReceiptFromCanonicalAttempt]);

  const selectSection = useCallback(async (selected: any) => {
    sectionRunRef.current += 1;
    const run = sectionRunRef.current;
    audioRef.current?.pause?.();
    setSection(selected); setSentenceIndex(0); setAnswer(''); setGrading(false);
    setAttempt(null);
    setResults(new Array(selected.sentences.length).fill(null));
    setReport(null); setError(''); setInlineError(''); setSaveState('idle');
    setPendingReceipt(null); setFlagged(new Set());
    setFlagIndex(null); setFlagCategory(''); setFlagNote(''); setFlagError(''); setFlagging(false);
    startedAtRef.current = Date.now(); sentenceStartedAtRef.current = Date.now(); listenCountRef.current = 0;
    setPhase('ready');
    const receipt = readReceipt(selected);
    if (receipt) {
      setSection({ ...selected, sentences: selected.sentences.map(() => null) });
      if (receipt.localResults.length === selected.sentences.length) {
        setResults(receipt.localResults.map((result: Result | null, index: number) => (
          result ? {
            ...result,
            user_text: String(receipt.submission?.sentences?.[index]?.user_transcript || ''),
          } : null
        )));
      }
      if (receipt.localReport) setReport(receipt.localReport);
      setPhase('complete');
      void reconcile(receipt, selected);
      return;
    }
    setPhase('loading');
    try {
      const testId = params?.testId;
      if (!testId) throw new Error('Thiếu mã bài chép chính tả.');
      const query = `section_num=${encodeURIComponent(selected.section_num)}`;
      const inProgress = normalizeDictationAttempt(await window.api.get(
        `/api/listening/tests/${encodeURIComponent(testId)}/dictation/attempts/in-progress?${query}`,
      ));
      const startPath = `/api/listening/tests/${encodeURIComponent(testId)}/dictation/attempts?${query}`;
      // An owned active attempt determines policy. Capabilities are consulted
      // only for fresh admission, including after the new-start flag is off.
      let startVersion = LEGACY_DICTATION_POLICY;
      let startCapabilitiesAvailable = false;
      if (!inProgress) {
        try {
          startVersion = dictationStartPolicy(await window.api.get<components['schemas']['DictationCapabilities']>('/api/listening/tests/dictation/capabilities'));
          startCapabilitiesAvailable = true;
        }
        catch (caught) { if (!isMissingReceipt(caught)) throw caught; }
      }
      if (sectionRunRef.current !== run || accountRef.current !== user?.id) return;
      const startBody = { renderer_affinity_protocol: 'claim-v1', grading_version: startVersion };
      const validateStart = (reply: any) => {
        if ((startCapabilitiesAvailable || Object.prototype.hasOwnProperty.call(reply || {}, 'created'))
            && typeof reply?.created !== 'boolean') throw new Error('Máy chủ chưa xác nhận lượt mới hay lượt đã có.');
        const normalized = normalizeDictationAttempt(reply);
        if (!startCapabilitiesAvailable && reply?.created === undefined
            && normalized?.grading_version !== LEGACY_DICTATION_POLICY) throw new Error('Máy chủ chưa xác nhận khả năng dùng chính sách mới.');
        if (reply.created === true && normalized?.grading_version !== startVersion) throw new Error('Lượt mới không dùng chính sách đã yêu cầu.');
        if (normalized && (normalized.test_id !== testId || normalized.section_num !== selected.section_num)) throw new Error('Lượt làm bài không đúng bài và section.');
        return normalized;
      };
      const canonicalAttempt = inProgress || validateStart(await coreOperationRequest({
        accountId: user?.id, method: 'POST', path: startPath, input: startBody,
        acknowledged: (reply: any) => !!validateStart(reply),
      }, (headers: Record<string, string>) => window.api.postWith(startPath, startBody, headers)));
      if (!canonicalAttempt) throw new Error('Máy chủ không trả về lượt làm bài.');
      if (canonicalAttempt.test_id !== testId || canonicalAttempt.section_num !== selected.section_num) throw new Error('Tiến độ không đúng bài và section.');
      if (sectionRunRef.current !== run || accountRef.current !== user?.id) return;
      const claim: any = await window.api.post(
        `/api/listening/tests/dictation/attempts/${encodeURIComponent(canonicalAttempt.attempt_id)}/renderer-affinity`,
        { renderer_affinity: 'next' },
      );
      if (sectionRunRef.current !== run || accountRef.current !== user?.id) return;
      const affinity = String(claim?.renderer_affinity || '');
      if (!['legacy', 'next'].includes(affinity)) throw new Error('Renderer của lượt làm bài không hợp lệ.');
      if (affinity !== 'next') {
        if (canonicalAttempt.grading_version === LEXICAL_DICTATION_POLICY) throw new Error('Phiên chấm v2 cần giao diện tương thích; chưa xác nhận renderer.');
        window.location.replace(dictationRendererHref(affinity, `?test_id=${encodeURIComponent(testId)}&section=${selected.section_num}`));
        return;
      }
      const pinnedSection = {
        ...selected,
        sentences: canonicalAttempt.units.map((unit: any) => unit.text),
        timings: canonicalAttempt.units.map((unit: any) => unit.timing),
        hints: canonicalAttempt.units.map((unit: any) => unit.hints),
      };
      const restored = new Array(pinnedSection.sentences.length).fill(null);
      for (const saved of canonicalAttempt.answers) {
        if (saved.sentence_idx < restored.length) restored[saved.sentence_idx] = saved;
      }
      const firstOpen = restored.findIndex((item) => !item);
      const selectedIndex = firstOpen < 0 ? restored.length - 1 : firstOpen;
      setSection(pinnedSection);
      setAttempt({ ...canonicalAttempt, renderer_affinity: affinity });
      setResults(restored); setSentenceIndex(selectedIndex);
      setAnswer(restored[selectedIndex]?.user_text || '');
      startedAtRef.current = canonicalAttempt.started_at
        ? Date.parse(canonicalAttempt.started_at) : Date.now();
      sentenceStartedAtRef.current = Date.now(); listenCountRef.current = 0;
      setPhase('ready');
    } catch (caught: any) {
      if (sectionRunRef.current !== run || accountRef.current !== user?.id) return;
      setError(`Không khôi phục được tiến độ chép chính tả. ${dictationErrorMessage(caught)}`);
      setPhase('error');
    }
  }, [params?.testId, readReceipt, reconcile, user?.id]);

  const boot = useCallback(async (sequence: number, accountId: string) => {
    if (!params) throw new Error('Đường dẫn bài hoặc báo cáo không hợp lệ: mã thiếu, sai hoặc bị lặp.');
    const ready = await whenGlobalReady(() => !!window.api?.get, 'window.api (Listening Dictation)');
    if (!ready) throw new Error('Không thể kết nối lớp dữ liệu.');
    if (params.sessionId) {
      const stored = normalizeDictationStoredReport(await window.api.get<components['schemas']['DictationStoredSessionResponse']>(
        `/api/listening/tests/dictation/session/${encodeURIComponent(params.sessionId)}`,
      ), params.sessionId);
      if (bootSequenceRef.current !== sequence || accountRef.current !== accountId) return;
      const length = stored.total_sentences ?? (stored.results.length ? Math.max(...stored.results.map((row: any) => row.sentence_idx)) + 1 : 0);
      const references = new Array(length).fill(null);
      for (const row of stored.results) references[row.sentence_idx] = row.reference ?? null;
      setAttempt(null); setPendingReceipt(null); setReport(stored);
      setBundle({ title: stored.test_title || stored.test_id_external || 'Báo cáo đã lưu', sections: [] });
      setSection({ title: stored.section_title || `Section ${stored.section_num ?? '?'}`, section_num: stored.section_num, sentences: references });
      setResults(resultsFromReport(stored, length)); setSaveState('saved'); setPhase('complete');
      return;
    }
    const normalized = normalizeDictationBundle(await window.api.get(
      `/api/listening/tests/${encodeURIComponent(params.testId)}/dictation`,
    ));
    if (bootSequenceRef.current !== sequence || accountRef.current !== accountId) return;
    setBundle(normalized);
    const wanted = params.section == null ? null : normalized.sections.find((item: any) => item.section_num === params.section);
    if (params.section != null && !wanted) throw new Error('Section được chọn không có transcript.');
    if (wanted || normalized.sections.length === 1) await selectSection(wanted || normalized.sections[0]);
    else setPhase('picker');
  }, [params, selectSection]);

  useEffect(() => {
    if (status === 'initial-loading') return;
    if (status === 'signed-out') { window.location.replace('/login'); return; }
    if (!user?.id) return;
    const key = `${user.id}:${searchParams?.toString() || ''}`;
    if (bootKeyRef.current === key) return;
    // Every query/account boot invalidates work from the previous live or
    // stored scope, including late grade/receipt ACKs in this same component.
    sectionRunRef.current += 1;
    setFlagIndex(null); setFlagCategory(''); setFlagNote(''); setFlagError(''); setFlagging(false); setFlagged(new Set());
    bootKeyRef.current = key; setPhase('loading'); setError('');
    const sequence = ++bootSequenceRef.current;
    void boot(sequence, user.id).catch((caught: any) => {
      if (bootSequenceRef.current !== sequence || accountRef.current !== user.id) return;
      setError(`Không tải được bài chép chính tả. ${dictationErrorMessage(caught)}`); setPhase('error');
    });
    return () => {
      sectionRunRef.current += 1;
      bootSequenceRef.current += 1;
      bootKeyRef.current = '';
    };
  }, [boot, searchParams, status, user?.id]);

  useEffect(() => {
    const player = audioRef.current;
    if (!player) return undefined;
    const played = () => { listenCountRef.current += 1; };
    player.addEventListener('av-audio-play', played);
    return () => player.removeEventListener('av-audio-play', played);
  }, [section, sentenceIndex, phase]);

  useEffect(() => {
    if (flagIndex == null) return undefined;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setFlagIndex(null);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [flagIndex]);

  const currentResult = results[sentenceIndex];
  const timing = section?.timings?.[sentenceIndex] || null;
  const hints = section?.hints?.[sentenceIndex] || [];

  const grade = useCallback(async () => {
    if (!section || !attempt || grading || currentResult) return;
    if (!answer.trim()) { setInlineError('Hãy gõ câu trả lời trước khi kiểm tra.'); return; }
    const run = sectionRunRef.current;
    setGrading(true); setInlineError('');
    try {
      const listenCount = listenCountRef.current;
      const timeSeconds = Math.max(0, Math.round(
        (Date.now() - (sentenceStartedAtRef.current || Date.now())) / 1000,
      ));
      const path = `/api/listening/tests/dictation/attempts/${encodeURIComponent(attempt.attempt_id)}/sentences/${sentenceIndex}`;
      const policy = dictationPolicyAcknowledgement(attempt);
      const body = { user_transcript: answer, listen_count: listenCount, time_seconds: timeSeconds, ...policy };
      const validateGrade = (reply: any) => {
        if (policy.grading_version === LEXICAL_DICTATION_POLICY && (reply.attempt_id !== attempt.attempt_id || reply.sentence_idx !== sentenceIndex)) throw new Error('Kết quả chấm không thuộc câu đang làm.');
        return normalizeDictationGrade(reply, policy, { reference: section.sentences[sentenceIndex], user_text: answer });
      };
      const canonical = validateGrade(await coreOperationRequest({
        accountId: user?.id, method: 'POST', path, input: body,
        acknowledged: (reply: any) => !!validateGrade(reply),
      }, (headers: Record<string, string>) => window.api.postWith(path, body, headers)));
      if (sectionRunRef.current !== run || accountRef.current !== user?.id) return;
      const next = [...results];
      next[sentenceIndex] = {
        ...canonical, diff: [...canonical.diff], user_text: answer,
        listen_count: listenCount,
        time_seconds: timeSeconds,
      };
      setResults(next);
    } catch (caught: any) { if (sectionRunRef.current === run) setInlineError(`Không chấm được câu trả lời. ${dictationErrorMessage(caught)}`); }
    finally { if (sectionRunRef.current === run) setGrading(false); }
  }, [answer, attempt, currentResult, grading, results, section, sentenceIndex, user?.id]);

  const resetCurrent = useCallback(() => {
    const next = [...results]; next[sentenceIndex] = null; setResults(next); setInlineError('');
  }, [results, sentenceIndex]);

  const complete = useCallback(async () => {
    if (!section || !attempt || !user?.id || !params) return;
    const totalTime = startedAtRef.current ? Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)) : null;
    const requestId = dictationRequestId();
    const submission = {
      client_request_id: requestId, attempt_id: attempt.attempt_id,
      test_id: params.testId, section_num: section.section_num,
      started_at: startedAtRef.current ? new Date(startedAtRef.current).toISOString() : null,
      total_time_seconds: totalTime,
      ...dictationPolicyAcknowledgement(attempt),
      sentences: results.map((result, index) => ({
        sentence_idx: index, user_transcript: result?.user_text || '',
        listen_count: result?.listen_count || 0, time_seconds: result?.time_seconds || 0,
      })),
    };
    const local = { ...clientReport(results, totalTime), ...dictationPolicyAcknowledgement(attempt) };
    const compactResults = results.map((result) => result ? {
      score: result.score, is_correct: result.is_correct,
      correct_words: result.correct_words, total_words: result.total_words,
      listen_count: result.listen_count, time_seconds: result.time_seconds,
      diff: [], user_text: '',
      ...dictationPolicyAcknowledgement(attempt),
    } : null);
    const receipt = {
      requestId, accountId: user.id, testId: params.testId,
      sectionNum: section.section_num, createdAt: new Date().toISOString(), submission,
      localResults: compactResults, localReport: local,
    };
    setPendingReceipt(receipt); setPhase('complete'); setReport(local);
    try {
      persistReceipt(receipt, section);
    } catch {
      setSaveState('pending');
      setError('Không thể tạo receipt bền vững (có thể một tab khác đang chờ lưu). Kết quả chưa được gửi; hãy đóng tab trùng hoặc kiểm tra bộ nhớ trình duyệt rồi bấm lại.');
      return;
    }
    await reconcile(receipt, section);
  }, [attempt, params, persistReceipt, reconcile, results, section, user?.id]);

  const advance = useCallback(() => {
    if (!section || !currentResult) return;
    if (sentenceIndex + 1 >= section.sentences.length) { void complete(); return; }
    const nextIndex = sentenceIndex + 1;
    setSentenceIndex(nextIndex); setAnswer(results[nextIndex]?.user_text || ''); setInlineError('');
    sentenceStartedAtRef.current = Date.now(); listenCountRef.current = 0; audioRef.current?.pause?.();
  }, [complete, currentResult, results, section, sentenceIndex]);

  const onAnswerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault(); if (currentResult) advance(); else void grade();
    }
  };

  const flagContext = useCallback((index: number) => {
    const row = results[index] as any;
    if (saveState !== 'saved' || !params?.sessionId || report?.session_id !== params.sessionId
        || typeof report.test_id !== 'string' || !report.test_id.length
        || !Number.isInteger(report.section_num) || report.section_num < 1
        || row?.sentence_idx !== index || typeof row.reference !== 'string') return null;
    return { test_id: report.test_id, section_num: report.section_num, sentence_idx: row.sentence_idx, reference: row.reference };
  }, [params?.sessionId, report, results, saveState]);

  const submitFlag = useCallback(async () => {
    if (flagging) return;
    const target = flagIndex == null ? null : flagContext(flagIndex);
    if (!target) { setFlagError('Bản lưu thiếu thông tin nguồn để gửi báo lỗi cho câu này.'); return; }
    if (!flagCategory && !flagNote.trim()) {
      setFlagError('Chọn loại lỗi hoặc nhập mô tả.'); return;
    }
    const run = sectionRunRef.current;
    const accountId = user?.id;
    setFlagging(true); setFlagError('');
    try {
      await window.api.post('/api/listening/tests/dictation/flag', {
        test_id: target.test_id, section_num: target.section_num, sentence_idx: target.sentence_idx,
        category: flagCategory || null, note: flagNote.trim() || null,
      });
      if (sectionRunRef.current !== run || accountRef.current !== accountId) return;
      setFlagged((previous) => new Set(previous).add(target.sentence_idx)); setFlagIndex(null);
    } catch (caught: any) { if (sectionRunRef.current === run && accountRef.current === accountId) setFlagError(`Không gửi được báo lỗi. ${dictationErrorMessage(caught)}`); }
    finally { if (sectionRunRef.current === run && accountRef.current === accountId) setFlagging(false); }
  }, [flagCategory, flagContext, flagIndex, flagNote, flagging, user?.id]);

  if (phase === 'loading') return <main className="dict-next-shell"><p className="dict-next-state">Đang tải bài chép chính tả…</p></main>;
  if (phase === 'error') return <main className="dict-next-shell"><section className="dict-next-state is-error"><h1>Không mở được bài</h1><p>{error}</p><button type="button" onClick={() => { bootKeyRef.current = ''; if (user?.id) { const sequence = ++bootSequenceRef.current; setPhase('loading'); void boot(sequence, user.id).catch((caught: any) => { if (bootSequenceRef.current === sequence) { setError(dictationErrorMessage(caught) || 'Không xác minh được dữ liệu.'); setPhase('error'); } }); } }}>Thử lại</button></section></main>;

  const visibleReport = report || clientReport(results, startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : null);
  const opCounts = visibleReport.error_trends?.op_counts || {};
  const canRestartSection = saveState === 'saved';
  const policyVersion = report?.grading_version || attempt?.grading_version || pendingReceipt?.submission?.grading_version || LEGACY_DICTATION_POLICY;

  return <main className="dict-next-shell">
    <header className="dict-next-hero">
      <a href="/listening">← Quay lại Listening</a><p className="dict-next-eyebrow">LUYỆN NGHE CHỦ ĐỘNG</p>
      <h1>Chép chính tả <span>·</span> {bundle?.title || 'Bài nghe'}</h1>
      <p>Nghe và gõ lại từng câu, sau đó đối chiếu từng từ với transcript. Bạn có thể tua và nghe lại tự do.</p>
      {phase !== 'picker' ? <p data-dictation-policy={policyVersion}>{dictationPolicyLabel(policyVersion)}</p> : null}
      <ol aria-label="Ba bước luyện tập"><li>1 · Nghe</li><li>2 · Gõ lại</li><li>3 · Đối chiếu</li></ol>
    </header>

    {phase === 'picker' ? <section className="dict-next-picker" aria-labelledby="pick-title"><h2 id="pick-title">Chọn section</h2><p>Mỗi section được lưu thành một phiên riêng.</p><div>{bundle.sections.map((item: any) => <button type="button" key={item.section_num} onClick={() => selectSection(item)}><strong>{item.title}</strong><span>{item.sentences.length} câu{item.cue_start != null ? ` · từ ${cue(item.cue_start)}` : ''}</span></button>)}</div></section> : null}

    {phase === 'ready' && section ? <section className="dict-next-workspace" aria-label="Không gian chép chính tả">
      <div className="dict-next-progress"><div><strong>{section.title}</strong><span>Câu {sentenceIndex + 1} / {section.sentences.length}</span></div><div className="dict-next-dots" role="list" aria-label="Tiến độ câu">{section.sentences.map((_: string, index: number) => <span role="listitem" aria-label={`Câu ${index + 1}`} className={`${index === sentenceIndex ? 'is-current' : ''} ${results[index] ? ((results[index]!.score ?? -1) >= 1 ? 'is-perfect' : (results[index]!.score ?? -1) >= .5 ? 'is-partial' : 'is-low') : ''}`} key={index} />)}</div></div>
      <div className="dict-next-stage is-listen"><div className="dict-next-stage-head"><b>1</b><div><h2>Nghe câu</h2><p>{timing ? 'Audio tự lặp đúng đoạn của câu hiện tại.' : section.cue_start != null ? `Section bắt đầu khoảng ${cue(section.cue_start)}.` : 'Dùng thanh audio để tua và nghe lại.'}</p></div></div>
        <audio-player ref={audioRef as any} src={bundle.audio_url} duration-hint={bundle.audio_duration_seconds} segment-start={timing?.start} segment-end={timing?.end} auto-loop={timing ? 'true' : undefined} />
        {hints.length ? <div className="dict-next-hints"><span>Tên riêng</span>{hints.map((hint: string) => <b key={hint}>{hint}</b>)}</div> : null}
      </div>
      <div className="dict-next-stage"><div className="dict-next-stage-head"><b>2</b><div><h2>Gõ lại</h2><p>Viết đúng những gì bạn nghe được.</p></div></div>
        <textarea aria-label={`Câu trả lời câu ${sentenceIndex + 1}`} value={answer} disabled={!!currentResult || grading} onChange={(event) => { setAnswer(event.target.value); setInlineError(''); }} onKeyDown={onAnswerKey} placeholder="Gõ câu bạn nghe được…" />
        {inlineError ? <p className="dict-next-inline-error" role="alert">{inlineError}</p> : null}
        {currentResult ? <div className="dict-next-result"><strong>{percentage(currentResult.score)} · {currentResult.correct_words ?? '—'}/{currentResult.total_words ?? '—'} {policyVersion === LEXICAL_DICTATION_POLICY ? 'từ được chấm' : 'token theo cách chấm cũ'}</strong><p>Đối chiếu với transcript</p><DictationComparison grade={currentResult} /></div> : null}
        <div className="dict-next-actions">{!currentResult ? <button className="is-primary" type="button" disabled={grading} onClick={() => void grade()}>{grading ? 'Đang chấm…' : 'Kiểm tra câu'}</button> : <><button type="button" onClick={resetCurrent}>Thử lại</button><button className="is-primary" type="button" onClick={advance}>{sentenceIndex + 1 < section.sentences.length ? 'Câu tiếp theo →' : 'Xem tổng kết'}</button></>}</div>
      </div>
      {bundle.sections.length > 1 ? <button className="dict-next-section-link" type="button" onClick={() => { audioRef.current?.pause?.(); setPhase('picker'); }}>Chọn section khác</button> : null}
    </section> : null}

    {phase === 'complete' && section ? <section className="dict-next-complete" aria-live="polite">
      <div className="dict-next-complete-head"><div><p className="dict-next-eyebrow">TỔNG KẾT PHIÊN</p><h2>{section.title}</h2></div><span className={`dict-next-save is-${saveState}`}>{saveState === 'saved' ? '✓ Đã lưu & xác nhận' : saveState === 'saving' ? 'Đang xác nhận…' : '⚠ Chưa xác nhận lưu'}</span></div>
      {saveState === 'pending' ? <div className="dict-next-recovery" role="alert"><strong>Kết quả chưa được xác nhận.</strong><p>{error || 'Receipt bền vững vẫn được giữ và có thể gửi lại an toàn, không tạo phiên trùng.'}</p><button type="button" onClick={() => { if (!pendingReceipt) return; try { persistReceipt(pendingReceipt, section); setError(''); void reconcile(pendingReceipt, section); } catch { setError('Vẫn chưa tạo được receipt bền vững; chưa gửi POST. Hãy đóng tab trùng hoặc giải phóng bộ nhớ trình duyệt.'); } }}>Gửi lại và xác nhận</button></div> : null}
      <div className="dict-next-stats"><article><span>Độ chính xác</span><strong>{percentage(visibleReport.accuracy)}</strong></article><article><span>Câu đúng hoàn toàn</span><strong>{visibleReport.correct_count ?? '—'}/{visibleReport.total_sentences ?? '—'}</strong></article><article><span>{policyVersion === LEXICAL_DICTATION_POLICY ? 'Từ đúng' : 'Token đúng theo cách chấm cũ'}</span><strong>{visibleReport.correct_words ?? '—'}/{visibleReport.total_words ?? '—'}</strong></article><article><span>Thời gian</span><strong>{formatDictationTime(visibleReport.total_time_seconds)}</strong></article></div>
      <div className="dict-next-trends"><h3>Mẫu lỗi</h3><div><span>Thiếu <b>{opCounts.miss ?? '—'}</b></span><span>Sai <b>{opCounts.wrong ?? '—'}</b></span><span>Thừa <b>{opCounts.extra ?? '—'}</b></span></div>{topDictationWords(visibleReport.error_trends?.missed).length ? <p>Từ hay thiếu: {topDictationWords(visibleReport.error_trends.missed).map((item: any) => `${item.word} (${item.count})`).join(', ')}</p> : null}</div>
      <div className="dict-next-review"><h3>Đối chiếu từng câu</h3>{section.sentences.map((sentence: string, index: number) => { const result = results[index] as any; return <article key={index}><header><strong>Câu {index + 1}</strong><span>{result ? `${percentage(result.score)} · ${result.correct_words ?? '—'}/${result.total_words ?? '—'}` : params?.sessionId ? 'Không có bằng chứng câu trong bản lưu' : 'Đang khôi phục từ máy chủ'}</span><button type="button" disabled={!flagContext(index) || flagged.has(index)} title={!flagContext(index) ? "Bản lưu thiếu thông tin nguồn để gửi báo lỗi cho câu này." : undefined} onClick={() => { setFlagIndex(index); setFlagCategory(''); setFlagNote(''); setFlagError(''); }}>{flagged.has(index) ? '✓ Đã báo lỗi' : '⚑ Báo lỗi'}</button></header>{result?.grading_version === LEXICAL_DICTATION_POLICY ? result.reference_segments ? <DictationComparison grade={result} /> : <p>Đang xác nhận nguyên văn và đối chiếu đã lưu từ máy chủ.</p> : <><p className="dict-next-reference"><span>Transcript</span>{sentence ?? 'Nguyên văn transcript không có trong bản lưu.'}</p>{result ? <><p className="dict-next-user-answer"><span>Bạn đã gõ</span>{result.user_text || '—'}</p><DictationComparison grade={result} /></> : null}</>}</article>; })}</div>
      <div className="dict-next-actions"><button type="button" disabled={!canRestartSection || (!params?.testId && !report?.test_id)} onClick={() => { if (!canRestartSection) return; clearReceipt(section); if (params?.sessionId) { const url = new URL(window.location.href); url.searchParams.delete('session_id'); if (report?.test_id) url.searchParams.set('test_id', report.test_id); if (section.section_num) url.searchParams.set('section', String(section.section_num)); window.location.assign(url); } else selectSection(section); }}>Làm lại section</button>{bundle.sections.length > 1 ? <button type="button" onClick={() => setPhase('picker')}>Chọn section khác</button> : null}<a href="/listening">Về Listening</a></div>
    </section> : null}

    {flagIndex != null ? <div className="dict-next-modal" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setFlagIndex(null); }}><section role="dialog" aria-modal="true" aria-labelledby="flag-title"><h2 id="flag-title">Báo lỗi — câu {flagIndex + 1}</h2><p>Chọn loại lỗi hoặc mô tả cụ thể để đội nội dung kiểm tra.</p><p className="dict-next-reference"><span>Transcript đã lưu</span>{flagContext(flagIndex)?.reference}</p><div className="dict-next-flag-options">{[['audio_unclear', 'Audio khó nghe'], ['transcript_wrong', 'Transcript sai'], ['timing_wrong', 'Cắt đoạn sai']].map(([value, label]) => <button className={flagCategory === value ? 'is-selected' : ''} type="button" onClick={() => setFlagCategory(value)} key={value}>{label}</button>)}</div><textarea autoFocus aria-label="Mô tả lỗi" value={flagNote} onChange={(event) => setFlagNote(event.target.value)} placeholder="Mô tả thêm…" />{flagError ? <p role="alert" className="dict-next-inline-error">{flagError}</p> : null}<div className="dict-next-actions"><button type="button" onClick={() => setFlagIndex(null)}>Hủy</button><button className="is-primary" type="button" disabled={flagging} onClick={() => void submitFlag()}>{flagging ? 'Đang gửi…' : 'Gửi báo lỗi'}</button></div></section></div> : null}
  </main>;
}
