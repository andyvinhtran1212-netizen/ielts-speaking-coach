const TASK_TYPES = new Set(['task1_academic', 'task1_general', 'task2']);
const DIFFICULTIES = new Set(['beginner', 'intermediate', 'advanced']);
const ANALYSIS_STATUSES = new Set(['pending', 'ready', 'failed']);
const CHART_TYPES = new Set(['line', 'bar', 'pie', 'table', 'map', 'process', 'mixed']);

const objectOf = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const stringOf = (value) => typeof value === 'string' ? value : '';
const nullableString = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const validDate = (value) => {
  const text = nullableString(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
};

export function normalizePromptAnalysis(raw) {
  const data = objectOf(raw);
  if (!data) return null;
  const overview = stringOf(data.overview).trim();
  if (!overview) return null;
  const chartType = CHART_TYPES.has(data.chart_type) ? data.chart_type : 'mixed';
  const keyFeatures = Array.isArray(data.key_features)
    ? data.key_features.map((value) => stringOf(value).trim()).filter(Boolean).slice(0, 12)
    : [];
  const notableData = Array.isArray(data.notable_data)
    ? data.notable_data.map((value) => {
      const row = objectOf(value);
      if (!row) return null;
      const label = stringOf(row.label).trim();
      const datum = stringOf(row.value).trim();
      if (!label || !datum) return null;
      return { label, value: datum, unit: nullableString(row.unit) };
    }).filter(Boolean).slice(0, 40)
    : [];
  return {
    chartType,
    overview,
    keyFeatures,
    notableData,
    axesOrCategories: nullableString(data.axes_or_categories),
    gradingNote: nullableString(data.grading_note),
  };
}

export function normalizeWritingPrompt(raw) {
  const row = objectOf(raw);
  if (!row) return null;
  const id = stringOf(row.id).trim();
  const taskType = stringOf(row.task_type).trim();
  const title = stringOf(row.title).trim();
  const promptText = stringOf(row.prompt_text).trim();
  if (!id || !TASK_TYPES.has(taskType) || title.length < 2 || promptText.length < 10) return null;
  const difficulty = row.difficulty == null ? null : stringOf(row.difficulty).trim();
  if (difficulty != null && !DIFFICULTIES.has(difficulty)) return null;
  if (!Array.isArray(row.tags) || row.tags.some((tag) => typeof tag !== 'string')) return null;
  const imageUrl = nullableString(row.prompt_image_url);
  const imagePublicId = nullableString(row.prompt_image_public_id);
  if (Boolean(imageUrl) !== Boolean(imagePublicId)) return null;
  if (taskType !== 'task1_academic' && imageUrl) return null;
  const analysisStatus = row.prompt_image_analysis_status == null
    ? null
    : stringOf(row.prompt_image_analysis_status).trim();
  if (analysisStatus != null && !ANALYSIS_STATUSES.has(analysisStatus)) return null;
  const rawAnalysis = row.prompt_image_analysis == null ? null : normalizePromptAnalysis(row.prompt_image_analysis);
  let malformedOptional = 0;
  if (row.prompt_image_analysis != null && !rawAnalysis) malformedOptional += 1;
  const analyzedImagePublicId = nullableString(row.prompt_image_analysis_public_id);
  const reviewed = row.prompt_image_analysis_reviewed === true;
  if (reviewed && (!rawAnalysis || analysisStatus !== 'ready' || analyzedImagePublicId !== imagePublicId)) malformedOptional += 1;
  return {
    id,
    taskType,
    title,
    promptText,
    difficulty,
    tags: row.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
    isActive: row.is_active !== false,
    examOnly: row.exam_only === true,
    imageUrl,
    imagePublicId,
    analysis: rawAnalysis,
    analysisStatus,
    analysisReviewed: reviewed && malformedOptional === 0,
    analysisModel: nullableString(row.prompt_image_analysis_model),
    analyzedImagePublicId,
    analysisError: nullableString(row.prompt_image_analysis_error),
    analysisAt: validDate(row.prompt_image_analysis_at),
    createdAt: validDate(row.created_at),
    updatedAt: validDate(row.updated_at),
    malformedOptional,
  };
}

export function normalizeWritingPromptList(raw) {
  const data = objectOf(raw);
  if (!data || !Array.isArray(data.prompts)) return null;
  const rows = [];
  let malformedCount = 0;
  for (const value of data.prompts) {
    const row = normalizeWritingPrompt(value);
    if (row) rows.push(row); else malformedCount += 1;
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return null;
  return { rows, malformedCount };
}

export function normalizePromptWrite(raw, expectedId = '') {
  const row = normalizeWritingPrompt(raw);
  return row && (!expectedId || row.id === expectedId) ? row : null;
}

export function normalizePromptDeactivate(raw, expectedId) {
  const data = objectOf(raw);
  return data && stringOf(data.prompt_id) === expectedId && stringOf(data.message).toLowerCase().includes('deactivated')
    ? { promptId: expectedId }
    : null;
}

export function normalizePromptUpload(raw) {
  const data = objectOf(raw);
  const url = data && nullableString(data.url);
  const publicId = data && nullableString(data.public_id);
  return url && publicId ? { url, publicId } : null;
}

export function normalizePromptReanalysis(raw, expectedId) {
  const data = objectOf(raw);
  return data && data.status === 'pending' && stringOf(data.prompt_id) === expectedId
    ? { promptId: expectedId, status: 'pending' }
    : null;
}

export function promptsQuery(filters) {
  const params = new URLSearchParams();
  const taskType = stringOf(filters?.taskType).trim();
  const difficulty = stringOf(filters?.difficulty).trim();
  const lifecycle = filters?.lifecycle === 'archived' ? 'archived' : 'active';
  if (TASK_TYPES.has(taskType)) params.set('task_type', taskType);
  if (DIFFICULTIES.has(difficulty)) params.set('difficulty', difficulty);
  params.set('is_active', lifecycle === 'active' ? 'true' : 'false');
  params.set('limit', '500');
  return params.toString();
}

export function promptsPageHref(filters) {
  const params = new URLSearchParams();
  const taskType = stringOf(filters?.taskType).trim();
  const difficulty = stringOf(filters?.difficulty).trim();
  const lifecycle = filters?.lifecycle === 'archived' ? 'archived' : 'active';
  const visibility = filters?.visibility === 'student' || filters?.visibility === 'exam' ? filters.visibility : 'all';
  const q = stringOf(filters?.q).trim();
  if (taskType) params.set('task_type', taskType);
  if (difficulty) params.set('difficulty', difficulty);
  if (lifecycle !== 'active') params.set('status', lifecycle);
  if (visibility !== 'all') params.set('visibility', visibility);
  if (q) params.set('q', q);
  const query = params.toString();
  return `/admin/writing/prompts${query ? `?${query}` : ''}`;
}

export function promptMatches(row, filters) {
  if (!row) return false;
  if (filters?.visibility === 'student' && row.examOnly) return false;
  if (filters?.visibility === 'exam' && !row.examOnly) return false;
  const q = stringOf(filters?.q).trim().toLocaleLowerCase('vi');
  return !q || `${row.title} ${row.promptText} ${row.tags.join(' ')}`.toLocaleLowerCase('vi').includes(q);
}

export function promptAnalysisState(row) {
  if (!row || row.taskType !== 'task1_academic') return { key: 'not-applicable', label: 'Không cần đáp án hình' };
  if (!row.imageUrl) return { key: 'no-image', label: 'Chưa có hình' };
  if (row.analysisReviewed) return { key: 'reviewed', label: 'Đã duyệt' };
  if (row.analysisStatus === 'pending') return { key: 'pending', label: 'Đang phân tích' };
  if (row.analysisStatus === 'failed') return { key: 'failed', label: 'Phân tích lỗi' };
  if (row.analysisStatus === 'ready') return { key: 'ready', label: 'Chờ duyệt' };
  return { key: 'missing', label: 'Chưa phân tích' };
}
