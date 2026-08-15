'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAdminProfile } from '@/components/admin-access-gate';
import {
  AUDIO_ENGINES,
  AUDIO_SCOPES,
  normalizeAudioAck,
  normalizeBulkDeleteAck,
  normalizeDeleteAck,
  normalizeVocabDetail,
  normalizeVocabImport,
  normalizeVocabList,
  parseJsonList,
  parseStringList,
} from '@/lib/admin-vocab-content-model.mjs';
import { normalizeTopicList } from '@/lib/admin-vocab-topics-quiz-model.mjs';

type Topic = { id: string; slug: string; title: string; titleVi: string; order: number; published: boolean };
type Word = { id: string; slug: string; headword: string; category: string; level: string; partOfSpeech: string; pronunciation: string; glossVi: string; audioHeadword: string; audioExample: string; audioStatus: string; updatedAt: string };
type Detail = { id: string; slug: string; headword: string; category: string; level: string; partOfSpeech: string; pronunciation: string; syllables: string; definitionEn: string; definitionVi: string; glossVi: string; example: string; register: string; commonError: string; memoryHook: string; source: string; group: string; bodyHtml: string; synonyms: unknown[]; antonyms: unknown[]; collocations: unknown[]; relatedWords: unknown[]; wordFamily: unknown[] };
type Draft = { headword: string; category: string; level: string; partOfSpeech: string; pronunciation: string; syllables: string; definitionEn: string; definitionVi: string; glossVi: string; example: string; register: string; commonError: string; memoryHook: string; source: string; group: string; bodyHtml: string; synonyms: string; antonyms: string; collocations: string; relatedWords: string; wordFamilyJson: string };
type ImportResult = { blocks: { index: number; headword: string; slug: string; category: string; errors: { field: string; message: string }[]; action: string; forecastAction: string }[]; errors: { block: number; headword: string; field: string; message: string }[]; committedIds: string[]; duplicateSlugs: string[]; summary: { total: number; created: number; updated: number; errors: number; forecastCreated: number; forecastUpdated: number } };
type Notice = { kind: 'success' | 'warning' | 'error'; message: string };
type ConfirmState = { kind: 'single'; word: Word } | { kind: 'bulk'; words: Word[] } | { kind: 'audio'; ids: string[] };

const PAGE_SIZE = 50;
const messageOf = (value: unknown) => value instanceof Error ? value.message : String(value || 'lỗi không xác định');
const stringList = (items: unknown[]) => items.every((item) => typeof item === 'string') ? (items as string[]).join(', ') : JSON.stringify(items);
const toDraft = (word: Detail): Draft => ({
  headword: word.headword, category: word.category, level: word.level, partOfSpeech: word.partOfSpeech,
  pronunciation: word.pronunciation, syllables: word.syllables, definitionEn: word.definitionEn,
  definitionVi: word.definitionVi, glossVi: word.glossVi, example: word.example, register: word.register,
  commonError: word.commonError, memoryHook: word.memoryHook, source: word.source, group: word.group,
  bodyHtml: word.bodyHtml, synonyms: stringList(word.synonyms), antonyms: stringList(word.antonyms),
  collocations: stringList(word.collocations), relatedWords: stringList(word.relatedWords),
  wordFamilyJson: JSON.stringify(word.wordFamily, null, 2),
});

export function AdminVocabContent() {
  const profile = useAdminProfile();
  const params = useSearchParams();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [words, setWords] = useState<Word[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editWord, setEditWord] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editError, setEditError] = useState('');
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const [audioEngine, setAudioEngine] = useState<'openai' | 'elevenlabs'>('openai');
  const [audioScope, setAudioScope] = useState<'headword' | 'example' | 'both'>('both');
  const [skipAudio, setSkipAudio] = useState(true);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [importError, setImportError] = useState('');
  const [importOpen, setImportOpen] = useState(true);
  const sequence = useRef(0);
  const accountRef = useRef(profile.id);
  const mutationLock = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  accountRef.current = profile.id;

  const setUrl = (nextCategory: string, nextQuery: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete('category'); url.searchParams.delete('q');
    if (nextCategory) url.searchParams.set('category', nextCategory);
    if (nextQuery) url.searchParams.set('q', nextQuery);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const fetchTopics = useCallback(async () => {
    const value = normalizeTopicList(await window.api.get<unknown>('/admin/content-topics?skill_area=vocab'), 'vocab');
    if (!value) throw new Error('Backend trả về danh sách topic không đúng định dạng.');
    return value as Topic[];
  }, []);

  const fetchPage = useCallback(async (targetOffset: number, targetCategory: string, targetQuery: string) => {
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(targetOffset) });
    if (targetCategory) qs.set('category', targetCategory);
    if (targetQuery) qs.set('q', targetQuery);
    const value = normalizeVocabList(await window.api.get<unknown>(`/admin/vocabulary?${qs}`), PAGE_SIZE, targetOffset);
    if (!value) throw new Error('Backend trả về trang từ vựng không đúng định dạng.');
    return value as { words: Word[]; total: number; limit: number; offset: number };
  }, []);

  const loadPage = useCallback(async (targetOffset: number, targetCategory: string, targetQuery: string, clearNotice = true) => {
    const requestId = ++sequence.current; const account = profile.id;
    setLoading(true); if (clearNotice) setNotice(null);
    try {
      const page = await fetchPage(targetOffset, targetCategory, targetQuery);
      if (requestId !== sequence.current || account !== accountRef.current) return null;
      setWords(page.words); setTotal(page.total); setOffset(page.offset); setSelected(new Set());
      return page;
    } catch (caught) {
      if (requestId === sequence.current && account === accountRef.current) {
        setWords([]); setTotal(0); setOffset(targetOffset); setSelected(new Set());
        setNotice({ kind: 'error', message: `Không tải được kho từ: ${messageOf(caught)}` });
      }
      return null;
    } finally { if (requestId === sequence.current && account === accountRef.current) setLoading(false); }
  }, [fetchPage, profile.id]);

  useEffect(() => {
    const requestId = ++sequence.current; const account = profile.id;
    mutationLock.current = false; setBusy(false); setLoading(true); setWords([]); setTopics([]); setSelected(new Set()); setNotice(null);
    setEditWord(null); setDraft(null); setEditError(''); setConfirmState(null); setConfirmError('');
    setImportFiles([]); setImportResults([]); setImportError(''); setImportOpen(true);
    void fetchTopics().then(async (rows) => {
      if (requestId !== sequence.current || account !== accountRef.current) return;
      const requestedCategory = params?.get('category') ?? '';
      const admittedCategory = rows.some((row) => row.slug === requestedCategory) ? requestedCategory : '';
      const requestedQuery = (params?.get('q') ?? '').trim();
      if (requestedCategory && !admittedCategory) setUrl('', requestedQuery);
      setTopics(rows); setCategory(admittedCategory); setQuery(requestedQuery); setSearchInput(requestedQuery);
      const page = await fetchPage(0, admittedCategory, requestedQuery);
      if (requestId !== sequence.current || account !== accountRef.current) return;
      setWords(page.words); setTotal(page.total); setOffset(0);
    }).catch((caught) => {
      if (requestId === sequence.current && account === accountRef.current) setNotice({ kind: 'error', message: `Không mở được Content workspace: ${messageOf(caught)}` });
    }).finally(() => { if (requestId === sequence.current && account === accountRef.current) setLoading(false); });
    return () => { sequence.current += 1; };
  }, [fetchPage, fetchTopics, profile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editWord && !confirmState) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      setEditWord(null); setDraft(null); setConfirmState(null); setEditError(''); setConfirmError('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, confirmState, editWord]);

  const selectedWords = useMemo(() => words.filter((word) => selected.has(word.id)), [selected, words]);
  const audioIds = useMemo(() => selectedWords.filter((word) => {
    if (!skipAudio) return true;
    if (audioScope === 'headword') return !word.audioHeadword;
    if (audioScope === 'example') return !word.audioExample;
    return !(word.audioHeadword && word.audioExample);
  }).map((word) => word.id), [audioScope, selectedWords, skipAudio]);
  const crossFileDuplicates = useMemo(() => {
    const seen = new Map<string, number>();
    importResults.forEach((result) => result.blocks.forEach((block) => {
      if (!block.slug || block.errors.length) return;
      const key = `${block.category}\u0000${block.slug}`; seen.set(key, (seen.get(key) ?? 0) + 1);
    }));
    return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key.replace('\u0000', '/'));
  }, [importResults]);
  const importSummary = useMemo(() => importResults.reduce((acc, item) => ({
    total: acc.total + item.summary.total,
    errors: acc.errors + item.summary.errors,
    created: acc.created + item.summary.forecastCreated,
    updated: acc.updated + item.summary.forecastUpdated,
  }), { total: 0, errors: 0, created: 0, updated: 0 }), [importResults]);
  const importReady = importFiles.length > 0 && importResults.length === importFiles.length
    && importSummary.total > 0 && importSummary.errors === 0 && crossFileDuplicates.length === 0;

  const chooseCategory = (next: string) => {
    if (mutationLock.current || (next && !topics.some((topic) => topic.slug === next))) return;
    setCategory(next); setUrl(next, query); void loadPage(0, next, query);
  };
  const applySearch = () => {
    if (mutationLock.current) return;
    const next = searchInput.trim(); setQuery(next); setUrl(category, next); void loadPage(0, category, next);
  };

  const play = (url: string, text: string) => {
    try { window.speechSynthesis?.cancel(); audioRef.current?.pause(); } catch { /* browser fallback */ }
    const speak = () => { try { const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-GB'; utterance.rate = 0.92; window.speechSynthesis?.speak(utterance); } catch { /* preview is best effort */ } };
    if (!url) { speak(); return; }
    try { const audio = new Audio(url); audioRef.current = audio; void audio.play().catch(speak); } catch { speak(); }
  };

  const openEdit = async (id: string) => {
    if (busy) return;
    const account = profile.id; setBusy(true); setNotice(null); setEditError('');
    try {
      const value = normalizeVocabDetail(await window.api.get<unknown>(`/admin/vocabulary/${encodeURIComponent(id)}`), id);
      if (!value) throw new Error('Backend trả về vocab detail không đúng định dạng.');
      if (account !== accountRef.current) return;
      setEditWord(value as Detail); setDraft(toDraft(value as Detail));
    } catch (caught) { if (account === accountRef.current) setNotice({ kind: 'error', message: `Không mở được từ: ${messageOf(caught)}` }); }
    finally { if (account === accountRef.current) setBusy(false); }
  };

  const saveEdit = async () => {
    if (!editWord || !draft || mutationLock.current) return;
    if (!draft.headword.trim() || !draft.category.trim()) { setEditError('Headword và chủ đề không được để trống.'); return; }
    const wordFamily = parseJsonList(draft.wordFamilyJson);
    if (!wordFamily) { setEditError('Word family phải là một JSON array hợp lệ.'); return; }
    mutationLock.current = true; setBusy(true); setEditError(''); const account = profile.id; let writeAttempted = false; let writeAcked = false;
    try {
      const body = {
        headword: draft.headword.trim(), category: draft.category.trim(), level: draft.level.trim(), part_of_speech: draft.partOfSpeech.trim(),
        pronunciation: draft.pronunciation.trim(), syllables: draft.syllables.trim(), definition_en: draft.definitionEn.trim(), definition_vi: draft.definitionVi.trim(),
        gloss_vi: draft.glossVi.trim(), example: draft.example.trim(), register: draft.register.trim(), common_error: draft.commonError.trim(), memory_hook: draft.memoryHook.trim(),
        source: draft.source.trim(), group: draft.group.trim(), body_html: draft.bodyHtml, synonyms: parseStringList(draft.synonyms), antonyms: parseStringList(draft.antonyms),
        collocations: parseStringList(draft.collocations), related_words: parseStringList(draft.relatedWords), word_family: wordFamily,
      };
      writeAttempted = true;
      const ack = normalizeVocabDetail(await window.api.patch<unknown>(`/admin/vocabulary/${encodeURIComponent(editWord.id)}`, body), editWord.id);
      if (!ack) throw new Error('Backend không ACK đúng vocab card đã cập nhật.');
      writeAcked = true;
      const canonical = normalizeVocabDetail(await window.api.get<unknown>(`/admin/vocabulary/${encodeURIComponent(editWord.id)}`), editWord.id);
      if (!canonical || canonical.headword !== body.headword || canonical.category !== body.category) throw new Error('Canonical detail chưa phản ánh thay đổi vừa lưu.');
      if (account !== accountRef.current) return;
      setEditWord(null); setDraft(null);
      const page = await loadPage(offset, category, query, false);
      if (!page) { setNotice({ kind: 'error', message: 'Backend đã ACK và detail đã được đọc lại, nhưng trang danh sách chưa refresh được. Hãy tải lại kho; không cần gửi PATCH lần nữa.' }); return; }
      setNotice({ kind: 'success', message: 'Đã lưu và đọc lại vocab card chuẩn từ backend.' });
    } catch (caught) {
      if (account !== accountRef.current) return;
      if (writeAttempted) { setEditWord(null); setDraft(null); setNotice({ kind: 'error', message: `${writeAcked ? 'Backend đã ACK write nhưng canonical readback chưa hoàn tất' : 'Không xác định PATCH đã tới backend hay chưa'}: ${messageOf(caught)} Hãy tải lại kho; không gửi PATCH lần nữa trước khi kiểm tra.` }); }
      else setEditError(`Không xác nhận được thay đổi: ${messageOf(caught)}`);
    }
    finally { mutationLock.current = false; if (account === accountRef.current) setBusy(false); }
  };

  const runDelete = async () => {
    if (!confirmState || confirmState.kind === 'audio' || mutationLock.current) return;
    const target = confirmState; const account = profile.id; setConfirmError(''); setBusy(true); mutationLock.current = true;
    let partialDeleteCount = 0;
    try {
      if (target.kind === 'single') {
        const ack = await window.api.delete<unknown>(`/admin/vocabulary/${encodeURIComponent(target.word.id)}`);
        if (!normalizeDeleteAck(ack, target.word.id)) throw new Error('Backend không ACK đúng vocab card đã xoá.');
      } else {
        const ids = target.words.map((word) => word.id);
        const ack = normalizeBulkDeleteAck(await window.api.post<unknown>('/admin/vocabulary/bulk-delete', { ids }), ids);
        if (!ack) throw new Error('Backend không ACK đầy đủ batch delete.');
        partialDeleteCount = ack.notFound.length;
      }
      if (account !== accountRef.current) return;
      const nextOffset = target.kind === 'bulk' && offset > 0 ? 0 : offset;
      let page = await loadPage(nextOffset, category, query, false); setConfirmState(null);
      if (!page) { setNotice({ kind: 'error', message: 'Backend đã ACK thao tác xoá nhưng trang canonical chưa tải lại được. Hãy reload kho trước khi thao tác tiếp; không gửi lại DELETE.' }); return; }
      if (nextOffset > 0 && page.words.length === 0 && page.total <= nextOffset) {
        page = await loadPage(Math.max(0, nextOffset - PAGE_SIZE), category, query, false);
        if (!page) { setNotice({ kind: 'error', message: 'Backend đã ACK thao tác xoá nhưng trang trước chưa tải lại được. Hãy reload kho; không gửi lại DELETE.' }); return; }
      }
      setNotice(partialDeleteCount ? {
        kind: 'warning',
        message: `Đã xoá ${target.kind === 'bulk' ? target.words.length - partialDeleteCount : 1} từ và đọc lại trang chuẩn từ backend; ${partialDeleteCount} card đã được thay đổi hoặc xoá trước thao tác này.`,
      } : { kind: 'success', message: `Đã xoá ${target.kind === 'single' ? `“${target.word.headword}”` : `${target.words.length} từ`} và đọc lại trang chuẩn từ backend.` });
    } catch (caught) {
      if (account === accountRef.current) { setConfirmState(null); setNotice({ kind: 'error', message: `Không xác nhận được thao tác xoá: ${messageOf(caught)} Hãy tải lại kho trước khi thử lại để tránh gửi DELETE hai lần.` }); }
    }
    finally { mutationLock.current = false; if (account === accountRef.current) setBusy(false); }
  };

  const runAudio = async (ids = audioIds) => {
    if (!ids.length || mutationLock.current) return;
    const account = profile.id; mutationLock.current = true; setBusy(true); setConfirmError(''); setNotice(null);
    try {
      const ack = normalizeAudioAck(await window.api.post<unknown>('/admin/vocabulary/generate-audio', { ids, engine: audioEngine, scope: audioScope, skip_existing_audio: skipAudio }), audioEngine, audioScope, ids.length);
      if (!ack) throw new Error('Backend không xác nhận đúng audio job vừa tạo.');
      if (account !== accountRef.current) return;
      setConfirmState(null); setNotice({ kind: 'success', message: `Đã xếp hàng ${ack.queuedCount} từ qua ${ack.engine}. Đây là background job; tải lại sau ít phút để kiểm tra audio canonical.` });
    } catch (caught) {
      if (account === accountRef.current) {
        setConfirmState(null);
        setNotice({ kind: 'error', message: `Không xác nhận được audio job: ${messageOf(caught)} Không tự động retry write có chi phí này; kiểm tra audio/status trước khi gửi lại.` });
      }
    } finally { mutationLock.current = false; if (account === accountRef.current) setBusy(false); }
  };

  const requestAudio = () => {
    if (!audioIds.length) { setNotice({ kind: 'error', message: 'Không có từ phù hợp để tạo audio trong selection hiện tại.' }); return; }
    if (audioEngine === 'elevenlabs') { setConfirmError(''); setConfirmState({ kind: 'audio', ids: audioIds }); return; }
    void runAudio(audioIds);
  };

  const dryRunFiles = async (files: File[]) => {
    const valid = files.filter((file) => /\.(md|markdown)$/i.test(file.name));
    if (!valid.length || valid.length !== files.length) { setImportError('Chỉ chấp nhận file .md hoặc .markdown.'); return; }
    if (mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setImportError(''); setImportResults([]); setImportFiles(valid); setImportOpen(true); const account = profile.id;
    try {
      const results = await Promise.all(valid.map(async (file) => {
        const form = new FormData(); form.append('file', file);
        const value = normalizeVocabImport(await window.api.upload<unknown>('/admin/vocabulary/import?dry_run=true', form), true);
        if (!value) throw new Error(`${file.name}: dry-run sai contract.`);
        return value as ImportResult;
      }));
      if (account === accountRef.current) setImportResults(results);
    } catch (caught) { if (account === accountRef.current) setImportError(`Không phân tích được file: ${messageOf(caught)}`); }
    finally { mutationLock.current = false; if (account === accountRef.current) setBusy(false); }
  };

  const commitImport = async () => {
    if (!importReady || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setImportError(''); const account = profile.id; let writeAttempted = false; let writeAcked = false;
    try {
      const texts = await Promise.all(importFiles.map((file) => file.text()));
      const form = new FormData(); form.append('file', new File([texts.join('\n\n')], 'combined.md', { type: 'text/markdown' }));
      writeAttempted = true;
      const ack = normalizeVocabImport(await window.api.upload<unknown>('/admin/vocabulary/import?dry_run=false', form), false);
      if (!ack || ack.errors.length || ack.committedIds.length !== ack.summary.total) throw new Error('Backend không xác nhận trọn vẹn import commit.');
      writeAcked = true;
      if (account !== accountRef.current) return;
      setImportFiles([]); setImportResults([]);
      const [topicRows, page] = await Promise.all([fetchTopics(), loadPage(0, category, query, false)]);
      if (!page) throw new Error('Trang danh sách canonical chưa tải lại được.');
      if (account !== accountRef.current) return;
      setTopics(topicRows);
      setNotice({ kind: 'success', message: `Đã lưu ${ack.summary.created} từ mới và cập nhật ${ack.summary.updated} từ; trang danh sách đã được đọc lại từ backend.` });
    } catch (caught) {
      if (account !== accountRef.current) return;
      if (writeAttempted) { setImportFiles([]); setImportResults([]); setNotice({ kind: 'error', message: `${writeAcked ? 'Backend đã ACK import nhưng reconciliation chưa hoàn tất' : 'Không xác định import đã tới backend hay chưa'}: ${messageOf(caught)} Hãy tải lại kho; không upload lại file trước khi kiểm tra.` }); }
      else setImportError(`Không xác nhận được import commit: ${messageOf(caught)} Không tự động retry write này; hãy chạy dry-run lại sau khi kiểm tra kho.`);
    } finally { mutationLock.current = false; if (account === accountRef.current) setBusy(false); }
  };

  const toggleWord = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const togglePage = () => setSelected(selected.size === words.length ? new Set() : new Set(words.map((word) => word.id)));
  const patchDraft = (value: Partial<Draft>) => setDraft((current) => current ? { ...current, ...value } : current);
  const pageFrom = total ? offset + 1 : 0; const pageTo = Math.min(offset + PAGE_SIZE, total);

  return <main className="avv-shell avv-console-shell avv-content-console">
    <header className="avv-stats-hero">
      <div><a href="/admin/vocab">← Vocabulary workspace</a><p className="avv-eyebrow">Nguồn nội dung chuẩn</p><h1>Kho từ vựng</h1><p>Import, hiệu chỉnh, nghe thử và quản lý vòng đời vocab card. Mọi mutation đều được ACK và tải lại từ backend trước khi báo hoàn tất.</p></div>
      <a className="btn-secondary" href="/admin/vocab/topics">Quản lý chủ đề →</a>
    </header>

    {notice ? <p className={`avv-banner is-${notice.kind}`} role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.message}</p> : null}

    <details className="avv-content-import" open={importOpen} onToggle={(event) => setImportOpen(event.currentTarget.open)}>
      <summary><span><strong>Import Markdown</strong><small>Dry-run toàn bộ trước một lần commit</small></span><span className="avv-chip is-teal">ALL-OR-NOTHING</span></summary>
      <div className="avv-content-import__body">
        <label className="avv-file-field">Chọn một hoặc nhiều file<input type="file" accept=".md,.markdown,text/markdown" multiple disabled={busy} onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length) void dryRunFiles(files); }} /><span>{importFiles.length ? `${importFiles.length} file: ${importFiles.map((file) => file.name).join(', ')}` : 'Chọn file .md/.markdown để chạy dry-run'}</span></label>
        {importError ? <p className="avv-banner is-error" role="alert">{importError}</p> : null}
        {importResults.length ? <div className="avv-import-preview">
          <div className="avv-preview-stats"><div><span>Từ</span><strong>{importSummary.total}</strong></div><div><span>Thêm mới</span><strong>{importSummary.created}</strong></div><div><span>Cập nhật</span><strong>{importSummary.updated}</strong></div><div className={importSummary.errors || crossFileDuplicates.length ? 'is-error' : ''}><span>Lỗi</span><strong>{importSummary.errors + crossFileDuplicates.length}</strong></div></div>
          {crossFileDuplicates.length ? <div className="avv-import-errors"><strong>Trùng cùng category/slug giữa các file</strong><p>{crossFileDuplicates.join(', ')}</p></div> : null}
          <div className="avv-content-preview-list">{importResults.flatMap((result, fileIndex) => result.blocks.map((block) => <article key={`${fileIndex}-${block.index}`} className={block.errors.length ? 'is-error' : ''}><div><strong>#{block.index + 1} · {block.headword || '(thiếu headword)'}</strong><small>{block.category}/{block.slug || '—'}</small></div><span className={`avv-chip is-${block.errors.length ? 'warning' : 'teal'}`}>{block.errors.length ? `${block.errors.length} lỗi` : block.forecastAction === 'updated' ? 'cập nhật' : 'thêm mới'}</span>{block.errors.length ? <ul>{block.errors.map((error) => <li key={`${error.field}-${error.message}`}><b>{error.field}</b>: {error.message}</li>)}</ul> : null}</article>))}</div>
        </div> : null}
        <div className="avv-import-actions"><button className="btn-secondary" type="button" disabled={busy || !importFiles.length} onClick={() => { setImportFiles([]); setImportResults([]); setImportError(''); }}>Xoá preview</button><button className="btn-primary" type="button" disabled={busy || !importReady} onClick={() => void commitImport()}>{busy ? 'Đang xác minh…' : 'Lưu vào thư viện'}</button></div>
      </div>
    </details>

    <section className="avv-content-catalog">
      <div className="avv-filterbar avv-content-filters">
        <label>Chủ đề<select value={category} disabled={busy} onChange={(event) => chooseCategory(event.target.value)}><option value="">Tất cả chủ đề</option>{topics.map((topic) => <option key={topic.id} value={topic.slug}>{topic.titleVi || topic.title} · {topic.slug}</option>)}</select></label>
        <form className="avv-searchbar" onSubmit={(event) => { event.preventDefault(); applySearch(); }}><label><span className="sr-only">Tìm headword</span><input type="search" value={searchInput} disabled={busy} placeholder="Tìm theo headword…" onChange={(event) => setSearchInput(event.target.value)} /></label><button className="btn-primary" type="submit" disabled={busy}>Tìm</button><button className="btn-secondary" type="button" disabled={busy || (!category && !query)} onClick={() => { setSearchInput(''); setQuery(''); setCategory(''); setUrl('', ''); void loadPage(0, '', ''); }}>Đặt lại</button></form>
        <span className="avv-console-count">{total} từ</span>
      </div>

      <div className="avv-content-bulk">
        <label className="avv-check"><input type="checkbox" checked={words.length > 0 && selected.size === words.length} ref={(node) => { if (node) node.indeterminate = selected.size > 0 && selected.size < words.length; }} disabled={busy || !words.length} onChange={togglePage} />Chọn trang này</label>
        <span>{selected.size ? `Đã chọn ${selected.size} từ` : 'Chưa chọn từ nào'}</span>
        <div className="avv-content-audio-controls"><select aria-label="Engine audio" value={audioEngine} disabled={busy || !selected.size} onChange={(event) => { const next = event.target.value; if (AUDIO_ENGINES.includes(next)) setAudioEngine(next as 'openai' | 'elevenlabs'); }}><option value="openai">OpenAI</option><option value="elevenlabs">ElevenLabs</option></select><select aria-label="Phạm vi audio" value={audioScope} disabled={busy || !selected.size} onChange={(event) => { const next = event.target.value; if (AUDIO_SCOPES.includes(next)) setAudioScope(next as 'headword' | 'example' | 'both'); }}><option value="headword">Headword</option><option value="example">Ví dụ</option><option value="both">Cả hai</option></select><label className="avv-check"><input type="checkbox" checked={skipAudio} disabled={busy || !selected.size} onChange={(event) => setSkipAudio(event.target.checked)} />Bỏ qua audio sẵn có</label><button className="btn-secondary" type="button" disabled={busy || !audioIds.length} onClick={requestAudio}>Tạo audio ({audioIds.length})</button><button className="btn-danger" type="button" disabled={busy || !selectedWords.length} onClick={() => { setConfirmError(''); setConfirmState({ kind: 'bulk', words: selectedWords }); }}>Xoá ({selectedWords.length})</button></div>
      </div>

      {loading ? <div className="avv-state">Đang tải trang dữ liệu chuẩn…</div> : words.length === 0 ? <div className="avv-state">Không có từ nào khớp bộ lọc.</div> : <div className="avv-table-wrap"><table className="avv-table avv-content-table"><thead><tr><th><span className="sr-only">Chọn</span></th><th>Từ</th><th>Chủ đề</th><th>Nội dung</th><th>Audio</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{words.map((word) => <tr key={word.id}><td data-label="Chọn"><input type="checkbox" aria-label={`Chọn ${word.headword}`} checked={selected.has(word.id)} disabled={busy} onChange={() => toggleWord(word.id)} /></td><td data-label="Từ"><strong>{word.headword}</strong><small>{word.slug}{word.pronunciation ? ` · ${word.pronunciation}` : ''}</small></td><td data-label="Chủ đề"><span className="avv-chip is-muted">{word.category}</span><small>{[word.level, word.partOfSpeech].filter(Boolean).join(' · ') || 'Chưa phân loại'}</small></td><td data-label="Nội dung">{word.glossVi || 'Chưa có nghĩa tiếng Việt'}</td><td data-label="Audio"><span className={`avv-chip is-${word.audioStatus === 'final' ? 'teal' : 'muted'}`}>{word.audioStatus || 'pending'}</span><div className="avv-audio-actions"><button className="btn-secondary" type="button" onClick={() => play(word.audioHeadword, word.headword)}>▶ Từ</button>{word.audioExample ? <button className="btn-secondary" type="button" onClick={() => play(word.audioExample, word.headword)}>▶ Ví dụ</button> : null}</div></td><td className="avv-row-actions"><button className="btn-secondary" type="button" disabled={busy} onClick={() => void openEdit(word.id)}>Sửa</button><button className="btn-danger" type="button" disabled={busy} onClick={() => { setConfirmError(''); setConfirmState({ kind: 'single', word }); }}>Xoá</button></td></tr>)}</tbody></table></div>}
      <div className="avv-pagination"><button className="btn-secondary" type="button" disabled={busy || loading || offset === 0} onClick={() => void loadPage(Math.max(0, offset - PAGE_SIZE), category, query)}>← Trước</button><span>{pageFrom}–{pageTo} / {total}</span><button className="btn-secondary" type="button" disabled={busy || loading || offset + PAGE_SIZE >= total} onClick={() => void loadPage(offset + PAGE_SIZE, category, query)}>Sau →</button></div>
    </section>

    {editWord && draft ? <div className="av-modal-backdrop avv-dialog" role="dialog" aria-modal="true" aria-labelledby="avv-edit-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setEditWord(null); setDraft(null); } }}><div className="av-modal avv-dialog-card avv-content-editor"><div className="av-modal-header"><div><p className="avv-eyebrow">{editWord.slug}</p><h2 id="avv-edit-title" className="av-modal-title">Hiệu chỉnh vocab card</h2></div></div><div className="av-modal-body avv-content-editor__body">
      <div className="avv-content-form"><label>Headword<input value={draft.headword} onChange={(event) => patchDraft({ headword: event.target.value })} /></label><label>Slug (URL ổn định)<input value={editWord.slug} disabled /></label><label>Chủ đề<input value={draft.category} onChange={(event) => patchDraft({ category: event.target.value })} /></label><label>Cấp độ<input value={draft.level} onChange={(event) => patchDraft({ level: event.target.value })} /></label><label>Loại từ<input value={draft.partOfSpeech} onChange={(event) => patchDraft({ partOfSpeech: event.target.value })} /></label><label>IPA<input value={draft.pronunciation} onChange={(event) => patchDraft({ pronunciation: event.target.value })} /></label><label>Âm tiết<input value={draft.syllables} onChange={(event) => patchDraft({ syllables: event.target.value })} /></label><label>Register<input value={draft.register} onChange={(event) => patchDraft({ register: event.target.value })} /></label><label>Nguồn<input value={draft.source} onChange={(event) => patchDraft({ source: event.target.value })} /></label><label>Nhóm<input value={draft.group} onChange={(event) => patchDraft({ group: event.target.value })} /></label><label className="is-wide">Định nghĩa tiếng Việt<textarea value={draft.definitionVi} onChange={(event) => patchDraft({ definitionVi: event.target.value })} /></label><label className="is-wide">Gloss tiếng Việt<textarea value={draft.glossVi} onChange={(event) => patchDraft({ glossVi: event.target.value })} /></label><label className="is-wide">Định nghĩa tiếng Anh<textarea value={draft.definitionEn} onChange={(event) => patchDraft({ definitionEn: event.target.value })} /></label><label className="is-wide">Ví dụ<textarea value={draft.example} onChange={(event) => patchDraft({ example: event.target.value })} /></label><label>Collocations (phẩy)<input value={draft.collocations} onChange={(event) => patchDraft({ collocations: event.target.value })} /></label><label>Từ liên quan (phẩy)<input value={draft.relatedWords} onChange={(event) => patchDraft({ relatedWords: event.target.value })} /></label><label>Đồng nghĩa (phẩy)<input value={draft.synonyms} onChange={(event) => patchDraft({ synonyms: event.target.value })} /></label><label>Trái nghĩa (phẩy)<input value={draft.antonyms} onChange={(event) => patchDraft({ antonyms: event.target.value })} /></label><label className="is-wide">Word family (JSON array)<textarea className="is-code" value={draft.wordFamilyJson} onChange={(event) => patchDraft({ wordFamilyJson: event.target.value })} /></label><label className="is-wide">Hay nhầm<textarea value={draft.commonError} onChange={(event) => patchDraft({ commonError: event.target.value })} /></label><label className="is-wide">Mẹo nhớ<textarea value={draft.memoryHook} onChange={(event) => patchDraft({ memoryHook: event.target.value })} /></label><label className="is-wide">Body HTML<textarea className="is-code" value={draft.bodyHtml} onChange={(event) => patchDraft({ bodyHtml: event.target.value })} /></label></div>
      {editError ? <p className="avv-banner is-error" role="alert">{editError}</p> : null}
    </div><div className="av-modal-footer"><button className="btn-secondary" type="button" disabled={busy} onClick={() => { setEditWord(null); setDraft(null); setEditError(''); }}>Hủy</button><button className="btn-primary" type="button" disabled={busy} onClick={() => void saveEdit()}>{busy ? 'Đang xác minh…' : 'Lưu thay đổi'}</button></div></div></div> : null}

    {confirmState ? <div className="av-modal-backdrop avv-dialog" role="dialog" aria-modal="true" aria-labelledby="avv-confirm-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmState(null); }}><div className="av-modal avv-dialog-card"><p className="avv-eyebrow">{confirmState.kind === 'audio' ? 'Chi phí bên thứ ba' : 'Xoá vĩnh viễn'}</p><h2 id="avv-confirm-title" className="av-modal-title">{confirmState.kind === 'single' ? `Xoá “${confirmState.word.headword}”?` : confirmState.kind === 'bulk' ? `Xoá ${confirmState.words.length} từ đã chọn?` : `Tạo ${confirmState.ids.length} audio bằng ElevenLabs?`}</h2><p>{confirmState.kind === 'audio' ? 'Thao tác này dùng ElevenLabs credit. Backend sẽ chạy nền và không thể hoàn tác phần chi phí đã sử dụng.' : `Các vocab card sẽ bị hard-delete ${category ? `khỏi chủ đề “${category}”` : 'khỏi toàn bộ thư viện'}. Seed content có thể xuất hiện lại nếu chạy migrate-in.`}</p>{confirmState.kind === 'bulk' ? <div className="avv-confirm-list">{confirmState.words.slice(0, 8).map((word) => <span key={word.id}>{word.headword}</span>)}{confirmState.words.length > 8 ? <span>+{confirmState.words.length - 8} từ khác</span> : null}</div> : null}{confirmError ? <p className="avv-banner is-error" role="alert">{confirmError}</p> : null}<div className="av-modal-footer"><button className="btn-secondary" type="button" disabled={busy} onClick={() => { setConfirmState(null); setConfirmError(''); }}>Hủy</button><button className={confirmState.kind === 'audio' ? 'btn-primary' : 'btn-danger'} type="button" disabled={busy} onClick={() => confirmState.kind === 'audio' ? void runAudio(confirmState.ids) : void runDelete()}>{busy ? 'Đang xác minh…' : 'Xác nhận'}</button></div></div></div> : null}
  </main>;
}
