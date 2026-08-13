'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Dialog, Field, messageOf, StatusBanner } from '@/components/admin-directory-ui';
import { useAdminProfile } from '@/components/admin-access-gate';
import {
  normalizeBulkCreate,
  normalizeBulkTopicResult,
  normalizeGenerateResult,
  normalizeQuestionWrite,
  normalizeSpeakingQuestionList,
  normalizeSpeakingTopicList,
  normalizeTopicWrite,
  speakingTopicsQuery,
  topicMatches,
} from '@/lib/admin-speaking-topics-model.mjs';

import type { QuestionDraft, QuestionSnapshot, SpeakingQuestion, SpeakingTopic, TopicAction, TopicDraft } from './admin-speaking-topics-types';

const PART_COPY = {
  1: { title: 'Part 1', subtitle: 'Interview', note: 'Câu hỏi cá nhân ngắn, thường 7 câu mỗi topic.' },
  2: { title: 'Part 2', subtitle: 'Cue card + follow-up', note: 'Một cue card Part 2 có thể đi cùng câu hỏi follow-up Part 3.' },
  3: { title: 'Part 3', subtitle: 'Discussion', note: 'Câu hỏi phân tích, quan điểm và mở rộng.' },
} as const;

const EMPTY_TOPIC: TopicDraft = { title: '', part: 1, category: '' };
const EMPTY_QUESTION: QuestionDraft = { text: '', part: 1, questionType: '', orderNum: '0', bullets: '', reflection: '' };

function formatTime(value: string | null) {
  if (!value) return 'Chưa có';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Không rõ' : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function topicStatus(topic: SpeakingTopic) {
  if (!topic.isActive) return { label: 'Đang tắt', tone: 'is-archived' };
  if (topic.questionMetadataLookupFailed || topic.questionCount == null) return { label: 'Không rõ số câu', tone: 'is-warning' };
  if (topic.questionCount === 0) return { label: 'Chưa có câu', tone: 'is-warning' };
  return { label: `${topic.questionCount} câu`, tone: 'is-active' };
}

function questionDraft(question: SpeakingQuestion | null, topic: SpeakingTopic): QuestionDraft {
  if (!question) return { ...EMPTY_QUESTION, part: topic.part };
  return {
    text: question.text,
    part: question.part,
    questionType: question.questionType,
    orderNum: String(question.orderNum),
    bullets: question.cueCardBullets.join('\n'),
    reflection: question.cueCardReflection,
  };
}

function actionCopy(action: TopicAction | null) {
  if (!action) return { title: '', description: '', button: '', danger: false };
  if (action.kind === 'toggle') return {
    title: action.topic.isActive ? 'Tắt topic này?' : 'Bật topic này?',
    description: action.topic.isActive ? 'Topic sẽ không còn được dùng để giao câu mới, nhưng dữ liệu câu hỏi vẫn được giữ.' : 'Topic sẽ trở lại pool giao câu cho học viên.',
    button: action.topic.isActive ? 'Tắt topic' : 'Bật topic', danger: action.topic.isActive,
  };
  if (action.kind === 'generate') return action.mode === 'missing_only'
    ? { title: 'Sinh câu hỏi khi topic đang trống?', description: 'Hệ thống chỉ tạo khi topic chưa có câu hỏi. Nếu đã có, dữ liệu hiện tại được giữ nguyên.', button: 'Sinh khi trống', danger: false }
    : { title: 'Thay toàn bộ bộ câu hỏi?', description: 'AI sẽ tạo bộ mới và thay thế toàn bộ câu hỏi hiện tại của topic. Audio cũ không còn dùng được.', button: 'Thay toàn bộ', danger: true };
  if (action.kind === 'bulk-generate') return action.mode === 'missing_only'
    ? { title: `Sinh câu hỏi cho ${action.topics.length} topic đang trống?`, description: 'Topic đã có câu hỏi sẽ được báo riêng và không bị ghi đè.', button: 'Sinh khi trống', danger: false }
    : { title: `Thay câu hỏi của ${action.topics.length} topic?`, description: 'Toàn bộ câu hỏi hiện tại của từng topic được chọn sẽ bị thay bằng bộ AI mới.', button: 'Thay toàn bộ', danger: true };
  if (action.kind === 'delete-question') return { title: 'Xoá câu hỏi này?', description: 'Câu hỏi sẽ bị xoá khỏi thư viện. Thao tác không thể hoàn tác.', button: 'Xoá câu hỏi', danger: true };
  const count = action.kind === 'bulk-delete' ? action.topics.length : 1;
  return { title: count > 1 ? `Xoá ${count} topic?` : 'Xoá topic này?', description: 'Topic và toàn bộ câu hỏi liên quan sẽ bị xoá vĩnh viễn.', button: count > 1 ? 'Xoá các topic' : 'Xoá topic', danger: true };
}

export function AdminSpeakingTopics() {
  const profile = useAdminProfile();
  const router = useRouter();
  const params = useSearchParams();
  const parsedPart = Number(params?.get('part'));
  const part = (parsedPart === 2 || parsedPart === 3 ? parsedPart : 1) as 1 | 2 | 3;
  const search = params?.get('q')?.trim() || '';
  const selectedId = params?.get('topic')?.trim() || null;
  const [searchDraft, setSearchDraft] = useState(search);
  const [snapshot, setSnapshot] = useState<{ account: string; rows: SpeakingTopic[]; malformed: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionSnapshot | null>(null);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [topicEditor, setTopicEditor] = useState<SpeakingTopic | 'new' | null>(null);
  const [topicDraft, setTopicDraft] = useState<TopicDraft>(EMPTY_TOPIC);
  const [topicFormError, setTopicFormError] = useState<string | null>(null);
  const [questionEditor, setQuestionEditor] = useState<SpeakingQuestion | 'new' | null>(null);
  const [questionForm, setQuestionForm] = useState<QuestionDraft>(EMPTY_QUESTION);
  const [questionFormError, setQuestionFormError] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkLines, setBulkLines] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TopicAction | null>(null);
  const [busy, setBusy] = useState(false);
  const listSequence = useRef(0);
  const questionSequence = useRef(0);
  const mutationLock = useRef(false);
  const profileRef = useRef(profile.id); profileRef.current = profile.id;
  const rows = snapshot?.account === profile.id ? snapshot.rows : [];
  const visibleRows = useMemo(() => rows.filter((row) => topicMatches(row, part, search)), [rows, part, search]);
  const selectedTopic = rows.find((row) => row.id === selectedId) || null;
  const selectedRows = visibleRows.filter((row) => selected.has(row.id));
  const visibleSelected = visibleRows.length > 0 && visibleRows.every((row) => selected.has(row.id));

  const navigate = useCallback((nextPart: 1 | 2 | 3, nextSearch = search, topicId: string | null = selectedId) => {
    router.replace(`/admin/speaking/topics?${speakingTopicsQuery(nextPart, nextSearch, topicId)}`, { scroll: false });
  }, [router, search, selectedId]);

  const changePart = (nextPart: 1 | 2 | 3) => {
    setSelected(new Set());
    navigate(nextPart, '', null);
  };

  const readTopics = useCallback(async () => {
    const normalized = normalizeSpeakingTopicList(await window.api.get<unknown>('/admin/topics')) as { rows: SpeakingTopic[]; malformedCount: number } | null;
    if (!normalized) throw new Error('Danh sách topic không đúng định dạng.');
    return normalized;
  }, []);

  const loadTopics = useCallback(async (preserve = true) => {
    const account = profile.id;
    const requestId = ++listSequence.current;
    setLoading(true); setListError(null);
    try {
      const normalized = await readTopics();
      if (requestId !== listSequence.current || profileRef.current !== account) return null;
      setSnapshot({ account, rows: normalized.rows, malformed: normalized.malformedCount });
      setSelected((current) => new Set([...current].filter((id) => normalized.rows.some((row) => row.id === id))));
      return normalized;
    } catch (caught) {
      if (requestId === listSequence.current && profileRef.current === account) {
        setListError(`${preserve && snapshot?.account === account ? 'Không thể làm mới — đang giữ snapshot trước. ' : ''}${messageOf(caught)}`);
      }
      return null;
    } finally {
      if (requestId === listSequence.current && profileRef.current === account) setLoading(false);
    }
  }, [profile.id, readTopics, snapshot]);

  const readQuestions = useCallback(async (topicId: string) => {
    const normalized = normalizeSpeakingQuestionList(await window.api.get<unknown>(`/admin/topics/${encodeURIComponent(topicId)}/questions`), topicId) as { rows: SpeakingQuestion[]; malformedCount: number } | null;
    if (!normalized) throw new Error('Danh sách câu hỏi không đúng định dạng.');
    return normalized;
  }, []);

  const loadQuestions = useCallback(async (topicId: string) => {
    const account = profile.id;
    const requestId = ++questionSequence.current;
    setQuestionsLoading(true); setQuestionsError(null);
    try {
      const normalized = await readQuestions(topicId);
      if (requestId !== questionSequence.current || profileRef.current !== account) return null;
      setQuestions({ account, topicId, rows: normalized.rows, malformed: normalized.malformedCount });
      return normalized;
    } catch (caught) {
      if (requestId === questionSequence.current && profileRef.current === account) setQuestionsError(messageOf(caught));
      return null;
    } finally {
      if (requestId === questionSequence.current && profileRef.current === account) setQuestionsLoading(false);
    }
  }, [profile.id, readQuestions]);

  useEffect(() => {
    setSearchDraft(search); setBanner(null); setSelected(new Set()); void loadTopics(false);
    return () => { listSequence.current += 1; };
  }, [profile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setQuestions(null); setQuestionsError(null);
    if (selectedId) void loadQuestions(selectedId); else questionSequence.current += 1;
    return () => { questionSequence.current += 1; };
  }, [selectedId, profile.id, loadQuestions]);

  const applySearch = () => navigate(part, searchDraft, selectedId);
  const openTopicEditor = (topic: SpeakingTopic | null) => {
    setTopicEditor(topic || 'new');
    setTopicDraft(topic ? { title: topic.title, part: topic.part, category: topic.category } : { ...EMPTY_TOPIC, part });
    setTopicFormError(null);
  };
  const openQuestionEditor = (question: SpeakingQuestion | null) => {
    if (!selectedTopic) return;
    setQuestionEditor(question || 'new'); setQuestionForm(questionDraft(question, selectedTopic)); setQuestionFormError(null);
  };

  const saveTopic = async () => {
    if (mutationLock.current) return;
    const title = topicDraft.title.trim();
    if (!title) { setTopicFormError('Tên topic không được để trống.'); return; }
    mutationLock.current = true; setBusy(true); setTopicFormError(null);
    const account = profile.id;
    try {
      const body = { title, part: topicDraft.part, category: topicDraft.category.trim() };
      const editing = topicEditor !== 'new' && topicEditor;
      const raw = editing
        ? await window.api.patch<unknown>(`/admin/topics/${encodeURIComponent(editing.id)}`, body)
        : await window.api.post<unknown>('/admin/topics', body);
      const acknowledged = normalizeTopicWrite(raw, editing ? editing.id : '') as SpeakingTopic | null;
      if (!acknowledged) throw new Error('Máy chủ không xác nhận đúng topic vừa lưu.');
      const canonical = await readTopics();
      const saved = canonical.rows.find((row) => row.id === acknowledged.id);
      if (!saved || saved.title !== title || saved.part !== topicDraft.part || saved.category !== body.category) throw new Error('Đọc lại không khớp topic vừa lưu.');
      if (profileRef.current !== account) return;
      setSnapshot({ account, rows: canonical.rows, malformed: canonical.malformedCount });
      setListError(null);
      setTopicEditor(null); setBanner({ kind: 'success', text: `${editing ? 'Đã cập nhật' : 'Đã tạo'} topic và đối chiếu lại từ máy chủ.` });
      navigate(saved.part, search, saved.id);
    } catch (caught) { if (profileRef.current === account) setTopicFormError(messageOf(caught)); }
    finally { mutationLock.current = false; setBusy(false); }
  };

  const saveQuestion = async () => {
    if (!selectedTopic || mutationLock.current) return;
    const text = questionForm.text.trim();
    const orderNum = Number(questionForm.orderNum);
    const editing = questionEditor !== 'new' && questionEditor;
    if (!text) { setQuestionFormError('Câu hỏi không được để trống.'); return; }
    if (!Number.isInteger(orderNum) || orderNum < 0) { setQuestionFormError('Thứ tự phải là số nguyên từ 0 trở lên.'); return; }
    if (editing && orderNum === 0) { setQuestionFormError('Thứ tự 0 chỉ dùng để tự xếp khi tạo câu hỏi mới.'); return; }
    const bullets = questionForm.part === 2 ? questionForm.bullets.split('\n').map((line) => line.trim()).filter(Boolean) : [];
    const reflection = questionForm.part === 2 ? questionForm.reflection.trim() : '';
    const questionType = questionForm.questionType.trim();
    const body: {
      part: 1 | 2 | 3;
      question_text?: string;
      question_type: string;
      order_num: number;
      cue_card_bullets: string[] | null;
      cue_card_reflection: string | null;
    } = {
      part: questionForm.part,
      question_type: questionType,
      order_num: orderNum,
      cue_card_bullets: bullets.length ? bullets : null,
      cue_card_reflection: reflection || null,
    };
    if (!editing || editing.text !== text) body.question_text = text;
    mutationLock.current = true; setBusy(true); setQuestionFormError(null);
    const account = profile.id;
    try {
      const raw = editing
        ? await window.api.patch<unknown>(`/admin/topics/${encodeURIComponent(selectedTopic.id)}/questions/${encodeURIComponent(editing.id)}`, body)
        : await window.api.post<unknown>(`/admin/topics/${encodeURIComponent(selectedTopic.id)}/questions`, body);
      const acknowledged = normalizeQuestionWrite(raw, selectedTopic.id, editing ? editing.id : '') as SpeakingQuestion | null;
      if (!acknowledged) throw new Error('Máy chủ không xác nhận đúng câu hỏi vừa lưu.');
      const canonical = await readQuestions(selectedTopic.id);
      const saved = canonical.rows.find((row) => row.id === acknowledged.id);
      const expectedOrder = orderNum === 0 && !editing ? saved?.orderNum : orderNum;
      if (!saved
        || saved.text !== text
        || saved.part !== questionForm.part
        || saved.questionType !== questionType
        || saved.orderNum !== expectedOrder
        || saved.cueCardReflection !== reflection
        || saved.cueCardBullets.length !== bullets.length
        || saved.cueCardBullets.some((bullet, index) => bullet !== bullets[index])
        || (!editing && orderNum === 0 && saved.orderNum <= 0)
        || (editing && editing.text === text && saved.audioReady !== editing.audioReady)
        || (editing && editing.text !== text && saved.audioReady)) {
        throw new Error('Đọc lại không khớp câu hỏi vừa lưu.');
      }
      const topicsCanonical = await readTopics();
      if (profileRef.current !== account) return;
      setQuestions({ account, topicId: selectedTopic.id, rows: canonical.rows, malformed: canonical.malformedCount });
      setSnapshot({ account, rows: topicsCanonical.rows, malformed: topicsCanonical.malformedCount });
      setQuestionsError(null); setListError(null);
      setQuestionEditor(null);
      setBanner({ kind: 'success', text: `${editing ? 'Đã cập nhật' : 'Đã thêm'} câu hỏi và đối chiếu lại từ máy chủ.${editing && editing.text !== text ? ' Audio cũ đã được gỡ để tránh đọc sai đề.' : ''}` });
    } catch (caught) { if (profileRef.current === account) setQuestionFormError(messageOf(caught)); }
    finally { mutationLock.current = false; setBusy(false); }
  };

  const createBulk = async () => {
    if (mutationLock.current) return;
    const lines = bulkLines.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) { setBulkError('Nhập ít nhất một topic, mỗi dòng một tên.'); return; }
    mutationLock.current = true; setBusy(true); setBulkError(null);
    const account = profile.id;
    try {
      const acknowledged = normalizeBulkCreate(await window.api.post<unknown>('/admin/topics/bulk', { part, lines: lines.join('\n') })) as { count: number; topics: SpeakingTopic[] } | null;
      if (!acknowledged || acknowledged.count !== lines.length) throw new Error('Máy chủ không xác nhận đủ topic vừa tạo.');
      const canonical = await readTopics();
      if (acknowledged.topics.some((created) => {
        const saved = canonical.rows.find((row) => row.id === created.id);
        return !saved || saved.title !== created.title || saved.part !== part || saved.category !== created.category;
      })) throw new Error('Một số topic không khớp khi đọc lại.');
      if (profileRef.current !== account) return;
      setSnapshot({ account, rows: canonical.rows, malformed: canonical.malformedCount });
      setListError(null);
      setBulkOpen(false); setBulkLines(''); setBanner({ kind: 'success', text: `Đã tạo ${acknowledged.count} topic Part ${part} và đối chiếu lại từ máy chủ.` });
    } catch (caught) { if (profileRef.current === account) setBulkError(messageOf(caught)); }
    finally { mutationLock.current = false; setBusy(false); }
  };

  const executeAction = async () => {
    const action = confirming;
    if (!action || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setBanner(null);
    const account = profile.id;
    try {
      let text = '';
      let partialFailure: string | null = null;
      let deletedIds: string[] = [];
      let toggleExpectation: { id: string; isActive: boolean } | null = null;
      let generatedExpectation: { topicId: string; ids: string[] } | null = null;
      let bulkGeneratedIds: string[] = [];
      if (action.kind === 'toggle') {
        const desired = !action.topic.isActive;
        const ack = normalizeTopicWrite(await window.api.patch<unknown>(`/admin/topics/${encodeURIComponent(action.topic.id)}`, { is_active: desired }), action.topic.id) as SpeakingTopic | null;
        if (!ack || ack.isActive !== desired) throw new Error('Máy chủ không xác nhận đúng trạng thái topic.');
        toggleExpectation = { id: action.topic.id, isActive: desired };
        text = `Đã ${desired ? 'bật' : 'tắt'} topic.`;
      } else if (action.kind === 'generate') {
        const ack = normalizeGenerateResult(await window.api.post<unknown>(`/admin/topics/${encodeURIComponent(action.topic.id)}/generate-questions`, { mode: action.mode }), action.topic.id, action.mode);
        if (!ack) throw new Error('Máy chủ không xác nhận đúng bộ câu hỏi AI.');
        generatedExpectation = { topicId: action.topic.id, ids: ack.questions.map((question) => question.id) };
        text = action.mode === 'missing_only' ? 'Đã sinh câu hỏi cho topic đang trống.' : 'Đã thay toàn bộ bộ câu hỏi.';
      } else if (action.kind === 'delete-question') {
        await window.api.delete(`/admin/topics/${encodeURIComponent(action.topic.id)}/questions/${encodeURIComponent(action.question.id)}`);
        const canonicalQuestions = await readQuestions(action.topic.id);
        if (canonicalQuestions.rows.some((row) => row.id === action.question.id)) throw new Error('Câu hỏi vẫn còn sau khi xoá.');
        text = 'Đã xoá câu hỏi.';
      } else if (action.kind === 'delete') {
        await window.api.delete(`/admin/topics/${encodeURIComponent(action.topic.id)}`);
        deletedIds = [action.topic.id];
        text = 'Đã xoá topic và câu hỏi liên quan.';
      } else if (action.kind === 'bulk-delete') {
        const ids = action.topics.map((topic) => topic.id);
        const ack = normalizeBulkTopicResult(await window.api.post<unknown>('/admin/topics/bulk-delete', { topic_ids: ids }), ids, 'deleted_ids');
        if (!ack) throw new Error('Máy chủ không xác nhận đầy đủ kết quả xoá hàng loạt.');
        deletedIds = ack.successIds;
        text = `Đã xoá ${ack.successIds.length}/${ids.length} topic.`;
        if (ack.failedIds.length) partialFailure = `${ack.failedIds.length} topic không xoá được; trạng thái còn lại đã được đồng bộ từ máy chủ.`;
      } else {
        const ids = action.topics.map((topic) => topic.id);
        const ack = normalizeBulkTopicResult(await window.api.post<unknown>('/admin/topics/bulk-generate-questions', { topic_ids: ids, mode: action.mode }), ids);
        if (!ack) throw new Error('Máy chủ không xác nhận đầy đủ kết quả AI hàng loạt.');
        bulkGeneratedIds = ack.successIds;
        text = `AI hoàn tất ${ack.successIds.length}/${ids.length} topic.`;
        if (ack.failedIds.length) partialFailure = `${ack.failedIds.length} topic được giữ nguyên hoặc gặp lỗi; hãy xem lại trước khi tiếp tục.`;
      }
      const canonical = await readTopics();
      if (deletedIds.some((id) => canonical.rows.some((row) => row.id === id))) throw new Error('Đọc lại cho thấy một topic vẫn chưa được xoá.');
      if (toggleExpectation && canonical.rows.find((row) => row.id === toggleExpectation.id)?.isActive !== toggleExpectation.isActive) throw new Error('Đọc lại không khớp trạng thái bật/tắt vừa lưu.');
      let canonicalQuestions = null;
      const refreshTopicId = action.kind === 'delete-question' || action.kind === 'generate' ? action.topic.id : selectedId;
      if (refreshTopicId && canonical.rows.some((row) => row.id === refreshTopicId)) canonicalQuestions = await readQuestions(refreshTopicId);
      if (generatedExpectation && (!canonicalQuestions
        || canonicalQuestions.rows.length !== generatedExpectation.ids.length
        || generatedExpectation.ids.some((id) => !canonicalQuestions?.rows.some((row) => row.id === id)))) {
        throw new Error('Đọc lại không khớp bộ câu hỏi AI vừa tạo.');
      }
      if (bulkGeneratedIds.length) {
        const generatedCanonical = await Promise.all(bulkGeneratedIds.map(async (topicId) => ({ topicId, snapshot: await readQuestions(topicId) })));
        if (generatedCanonical.some(({ snapshot }) => snapshot.rows.length === 0)) throw new Error('Đọc lại cho thấy một topic chưa có bộ câu hỏi AI vừa tạo.');
      }
      if (profileRef.current !== account) return;
      setSnapshot({ account, rows: canonical.rows, malformed: canonical.malformedCount });
      if (canonicalQuestions && refreshTopicId) setQuestions({ account, topicId: refreshTopicId, rows: canonicalQuestions.rows, malformed: canonicalQuestions.malformedCount });
      setListError(null);
      if (canonicalQuestions) setQuestionsError(null);
      setSelected(new Set());
      setBanner(partialFailure
        ? { kind: 'error', text: `${text} ${partialFailure}` }
        : { kind: 'success', text: `${text} Đã đồng bộ trạng thái canonical.` });
      if (selectedId && !canonical.rows.some((row) => row.id === selectedId)) navigate(part, search, null);
    } catch (caught) { if (profileRef.current === account) setBanner({ kind: 'error', text: `Không hoàn tất thao tác: ${messageOf(caught)}` }); }
    finally { mutationLock.current = false; setBusy(false); setConfirming(null); }
  };

  const copy = actionCopy(confirming);
  const displayedQuestions = questions?.account === profile.id && questions.topicId === selectedId ? questions.rows : [];
  const metadataFailure = rows.some((row) => row.questionMetadataLookupFailed);

  return <main className="ast-shell">
    <header className="ast-header"><div><p className="acd-eyebrow">Speaking · Content operations</p><h1>Topics & questions</h1><p>Quản lý thư viện câu hỏi theo Part, kiểm soát AI và giữ mọi trạng thái khớp dữ liệu máy chủ.</p></div><a className="adm-btn-secondary" href="/admin/speaking">← Speaking workspace</a></header>

    <section className="ast-overview" aria-label="Tổng quan thư viện">
      <div><span>Tổng topic</span><strong>{rows.length}</strong><small>{rows.filter((row) => row.isActive).length} đang bật</small></div>
      <div><span>Part hiện tại</span><strong>{PART_COPY[part].title}</strong><small>{visibleRows.length} kết quả</small></div>
      <div><span>Topic đã chọn</span><strong>{selectedRows.length}</strong><small>Dùng cho thao tác hàng loạt</small></div>
    </section>

    <nav className="ast-tabs" role="tablist" aria-label="Speaking Part">
      {([1, 2, 3] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={part === value} className={part === value ? 'is-active' : ''} onClick={() => changePart(value)}><strong>{PART_COPY[value].title}</strong><span>{PART_COPY[value].subtitle}</span></button>)}
    </nav>

    <StatusBanner banner={banner} />
    {listError && <div className="ast-warning" role="alert"><strong>Không đọc được thư viện mới nhất.</strong><span>{listError}</span><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void loadTopics()}>Thử lại</button></div>}
    {metadataFailure && <div className="ast-warning" role="alert"><strong>Không đọc được metadata câu hỏi.</strong><span>Số câu và trạng thái “đang trống” được để ở trạng thái chưa biết; AI sinh khi trống bị khoá để tránh ghi đè ngoài ý muốn.</span></div>}
    {snapshot?.account === profile.id && snapshot.malformed > 0 && <div className="ast-warning" role="alert"><strong>Dữ liệu sai định dạng.</strong><span>{snapshot.malformed} topic không an toàn đã bị loại khỏi danh sách.</span></div>}

    <section className="ast-toolbar" aria-label="Tìm kiếm và thao tác">
      <form onSubmit={(event) => { event.preventDefault(); applySearch(); }}><label htmlFor="ast-search">Tìm topic</label><div><input id="ast-search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Tên hoặc category…" /><button className="adm-btn-secondary" type="submit">Tìm</button>{search && <button className="adm-btn-secondary" type="button" onClick={() => { setSearchDraft(''); navigate(part, '', selectedId); }}>Xoá lọc</button>}</div></form>
      <div className="ast-toolbar__actions"><button className="adm-btn-secondary" type="button" onClick={() => setBulkOpen(true)}>Thêm hàng loạt</button><button className="adm-btn-primary" type="button" onClick={() => openTopicEditor(null)}>+ Thêm topic</button></div>
    </section>

    {selectedRows.length > 0 && <section className="ast-bulkbar" aria-label="Thao tác hàng loạt"><span><strong>{selectedRows.length}</strong> topic đã chọn</span><div><button className="adm-btn-secondary adm-btn-sm" disabled={busy || selectedRows.some((row) => row.questionMetadataLookupFailed)} type="button" onClick={() => setConfirming({ kind: 'bulk-generate', topics: selectedRows, mode: 'missing_only' })}>AI sinh khi trống</button><button className="adm-btn-danger adm-btn-sm" disabled={busy} type="button" onClick={() => setConfirming({ kind: 'bulk-generate', topics: selectedRows, mode: 'replace_all' })}>AI thay toàn bộ</button><button className="adm-btn-danger adm-btn-sm" disabled={busy} type="button" onClick={() => setConfirming({ kind: 'bulk-delete', topics: selectedRows })}>Xoá</button><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setSelected(new Set())}>Bỏ chọn</button></div></section>}

    <div className={`ast-workspace${selectedTopic ? ' has-detail' : ''}`}>
      <section className="ast-library" aria-labelledby="ast-library-title"><header><div><p className="acd-eyebrow">{PART_COPY[part].subtitle}</p><h2 id="ast-library-title">Thư viện {PART_COPY[part].title}</h2><p>{PART_COPY[part].note}</p></div><button className="adm-btn-secondary adm-btn-sm" type="button" disabled={loading} onClick={() => void loadTopics()}>{loading ? 'Đang tải…' : 'Làm mới'}</button></header>
        {loading && !snapshot && <div className="acd-state" aria-live="polite"><strong>Đang tải topic…</strong><span>Đọc dữ liệu canonical từ máy chủ.</span></div>}
        {!loading && !listError && visibleRows.length === 0 && <div className="acd-state"><strong>Không có topic phù hợp</strong><span>{search ? 'Thử từ khoá khác hoặc xoá bộ lọc.' : `Thêm topic đầu tiên cho Part ${part}.`}</span></div>}
        {visibleRows.length > 0 && <div className="ast-table-wrap"><table className="ast-table"><thead><tr><th className="ast-check"><input type="checkbox" aria-label="Chọn tất cả topic đang hiển thị" checked={visibleSelected} onChange={() => setSelected(visibleSelected ? new Set([...selected].filter((id) => !visibleRows.some((row) => row.id === id))) : new Set([...selected, ...visibleRows.map((row) => row.id)]))} /></th><th>Topic</th><th>Trạng thái</th><th>Cập nhật</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{visibleRows.map((topic) => {
          const status = topicStatus(topic); const active = selectedId === topic.id;
          return <tr key={topic.id} className={`${active ? 'is-open ' : ''}${!topic.isActive ? 'is-inactive' : ''}`}><td className="ast-check" data-label="Chọn"><input type="checkbox" aria-label={`Chọn ${topic.title}`} checked={selected.has(topic.id)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(topic.id) ? next.delete(topic.id) : next.add(topic.id); return next; })} /></td><td data-label="Topic"><button className="ast-topic-link" type="button" onClick={() => navigate(part, search, topic.id)}><strong>{topic.title}</strong><span>{topic.category || 'Chưa phân loại'} · Part {topic.part}</span></button></td><td data-label="Trạng thái"><span className={`adm-status-pill ${status.tone}`}>{status.label}</span></td><td data-label="Cập nhật"><time dateTime={topic.lastUpdatedAt || undefined}>{formatTime(topic.lastUpdatedAt)}</time></td><td data-label="Thao tác"><div className="ast-row-actions"><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => openTopicEditor(topic)}>Sửa</button><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => setConfirming({ kind: 'toggle', topic })}>{topic.isActive ? 'Tắt' : 'Bật'}</button><button className="adm-btn-secondary adm-btn-sm" type="button" disabled={topic.questionMetadataLookupFailed} onClick={() => setConfirming({ kind: 'generate', topic, mode: 'missing_only' })}>AI khi trống</button><button className="adm-btn-danger adm-btn-sm" type="button" onClick={() => setConfirming({ kind: 'delete', topic })}>Xoá</button></div></td></tr>;
        })}</tbody></table></div>}
      </section>

      {selectedTopic && <aside className="ast-detail" aria-labelledby="ast-detail-title"><header><div><p className="acd-eyebrow">Part {selectedTopic.part} · Question library</p><h2 id="ast-detail-title">{selectedTopic.title}</h2><p>{selectedTopic.category || 'Chưa phân loại'}</p></div><button className="acd-icon-button" type="button" aria-label="Đóng chi tiết topic" onClick={() => navigate(part, search, null)}>×</button></header>
        <div className="ast-detail__actions"><button className="adm-btn-primary" type="button" onClick={() => openQuestionEditor(null)}>+ Thêm câu hỏi</button><button className="adm-btn-secondary" type="button" disabled={busy || selectedTopic.questionMetadataLookupFailed} onClick={() => setConfirming({ kind: 'generate', topic: selectedTopic, mode: 'missing_only' })}>AI sinh khi trống</button><button className="adm-btn-danger" type="button" disabled={busy} onClick={() => setConfirming({ kind: 'generate', topic: selectedTopic, mode: 'replace_all' })}>AI thay toàn bộ</button></div>
        {questionsError && <div className="ast-warning" role="alert"><strong>Không tải được câu hỏi.</strong><span>{questionsError}</span><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => void loadQuestions(selectedTopic.id)}>Thử lại</button></div>}
        {questionsLoading && !questions && <div className="acd-state"><strong>Đang tải câu hỏi…</strong><span>Không giả dữ liệu lỗi thành danh sách trống.</span></div>}
        {questions?.account === profile.id && questions.topicId === selectedTopic.id && questions.malformed > 0 && <div className="ast-warning" role="alert"><strong>Có câu hỏi sai định dạng.</strong><span>{questions.malformed} bản ghi đã bị loại.</span></div>}
        {!questionsLoading && !questionsError && questions?.account === profile.id && questions.topicId === selectedTopic.id && displayedQuestions.length === 0 && <div className="acd-state"><strong>Topic chưa có câu hỏi</strong><span>Thêm thủ công hoặc dùng “AI sinh khi trống”.</span></div>}
        <div className="ast-question-list">{displayedQuestions.map((question) => <article className="ast-question" key={question.id}><header><span>Part {question.part} · #{question.orderNum || 'auto'}</span>{question.questionType && <span>{question.questionType}</span>}{question.audioReady && <span>Audio sẵn sàng</span>}</header><h3>{question.text}</h3>{question.cueCardBullets.length > 0 && <ul>{question.cueCardBullets.map((bullet, index) => <li key={index}>{bullet}</li>)}</ul>}{question.cueCardReflection && <p className="ast-reflection"><strong>Reflection:</strong> {question.cueCardReflection}</p>}<footer><button className="adm-btn-secondary adm-btn-sm" type="button" onClick={() => openQuestionEditor(question)}>Sửa</button><button className="adm-btn-danger adm-btn-sm" type="button" onClick={() => setConfirming({ kind: 'delete-question', topic: selectedTopic, question })}>Xoá</button></footer></article>)}</div>
      </aside>}
    </div>

    <Dialog open={topicEditor !== null} title={topicEditor === 'new' ? 'Thêm topic' : 'Sửa topic'} description="Topic là nhóm nội dung; câu hỏi có Part riêng và được quản lý trong panel chi tiết." onClose={() => setTopicEditor(null)} busy={busy} actions={<><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setTopicEditor(null)}>Hủy</button><button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void saveTopic()}>{busy ? 'Đang lưu…' : 'Lưu topic'}</button></>}>
      <div className="ast-form"><Field label="Tên topic"><input autoFocus value={topicDraft.title} onChange={(event) => setTopicDraft({ ...topicDraft, title: event.target.value })} placeholder="Travel and tourism" /></Field><Field label="Part"><select value={topicDraft.part} onChange={(event) => setTopicDraft({ ...topicDraft, part: Number(event.target.value) as 1 | 2 | 3 })}><option value="1">Part 1</option><option value="2">Part 2</option><option value="3">Part 3</option></select></Field><Field label="Category" hint="Tuỳ chọn; dùng để tìm và nhóm nội dung."><input value={topicDraft.category} onChange={(event) => setTopicDraft({ ...topicDraft, category: event.target.value })} placeholder="Lifestyle" /></Field>{topicFormError && <div className="acd-banner is-error" role="alert">{topicFormError}</div>}</div>
    </Dialog>

    <Dialog open={questionEditor !== null} title={questionEditor === 'new' ? 'Thêm câu hỏi' : 'Sửa câu hỏi'} description={questionEditor !== 'new' && questionEditor?.audioReady ? 'Đổi nội dung câu hỏi sẽ gỡ audio hiện tại; cần render lại trước khi giao.' : 'Part 2 dùng cue-card; topic Part 2 vẫn có thể chứa follow-up Part 3.'} onClose={() => setQuestionEditor(null)} busy={busy} panelClassName="ast-dialog-wide" actions={<><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setQuestionEditor(null)}>Hủy</button><button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void saveQuestion()}>{busy ? 'Đang lưu…' : 'Lưu câu hỏi'}</button></>}>
      <div className="ast-form"><Field label="Nội dung câu hỏi"><textarea autoFocus rows={4} value={questionForm.text} onChange={(event) => setQuestionForm({ ...questionForm, text: event.target.value })} /></Field><div className="ast-form-grid"><Field label="Part thực tế"><select value={questionForm.part} onChange={(event) => setQuestionForm({ ...questionForm, part: Number(event.target.value) as 1 | 2 | 3 })}><option value="1">Part 1</option><option value="2">Part 2</option><option value="3">Part 3</option></select></Field><Field label="Loại câu hỏi"><input value={questionForm.questionType} onChange={(event) => setQuestionForm({ ...questionForm, questionType: event.target.value })} placeholder="personal / cuecard / opinion" /></Field><Field label="Thứ tự" hint="0 = máy chủ tự xếp khi tạo mới."><input type="number" min="0" step="1" value={questionForm.orderNum} onChange={(event) => setQuestionForm({ ...questionForm, orderNum: event.target.value })} /></Field></div>{questionForm.part === 2 && <><Field label="Cue-card bullets" hint="Mỗi dòng một gợi ý."><textarea rows={5} value={questionForm.bullets} onChange={(event) => setQuestionForm({ ...questionForm, bullets: event.target.value })} /></Field><Field label="Reflection prompt"><textarea rows={2} value={questionForm.reflection} onChange={(event) => setQuestionForm({ ...questionForm, reflection: event.target.value })} /></Field></>}{questionFormError && <div className="acd-banner is-error" role="alert">{questionFormError}</div>}</div>
    </Dialog>

    <Dialog open={bulkOpen} title={`Thêm nhiều topic · Part ${part}`} description="Mỗi dòng tạo một topic mới trong Part đang mở." onClose={() => setBulkOpen(false)} busy={busy} actions={<><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setBulkOpen(false)}>Hủy</button><button className="adm-btn-primary" type="button" disabled={busy} onClick={() => void createBulk()}>{busy ? 'Đang tạo…' : 'Tạo topic'}</button></>}><div className="ast-form"><Field label="Danh sách topic"><textarea autoFocus rows={9} value={bulkLines} onChange={(event) => setBulkLines(event.target.value)} placeholder={'Travel and tourism\nPublic transport\nWeekend activities'} /></Field><small className="ast-count">{bulkLines.split('\n').filter((line) => line.trim()).length} dòng hợp lệ</small>{bulkError && <div className="acd-banner is-error" role="alert">{bulkError}</div>}</div></Dialog>

    <Dialog open={confirming !== null} title={copy.title} description={copy.description} onClose={() => setConfirming(null)} busy={busy} actions={<><button className="adm-btn-secondary" type="button" disabled={busy} onClick={() => setConfirming(null)}>Hủy</button><button className={copy.danger ? 'adm-btn-danger' : 'adm-btn-primary'} type="button" disabled={busy} onClick={() => void executeAction()}>{busy ? 'Đang xử lý…' : copy.button}</button></>} />
  </main>;
}
