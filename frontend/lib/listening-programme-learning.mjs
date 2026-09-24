// Learner-safe presentation data. Keys, rationales, windows and transcripts stay
// in the post-submit review contract, never in this module or the player payload.
const englishPilot = {
  ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
    const number = index + 1;
    const sourceOptions = [
      { a: 'in', b: 'on', c: 'at' },
      { a: 'at', b: 'in', c: 'on' },
      { a: 'on', b: 'at', c: 'in' },
      { a: 'in', b: 'at', c: 'on' },
      { a: 'at', b: 'on', c: 'in' },
      { a: 'on', b: 'in', c: 'at' },
    ][index];
    return [`manus:A0-38.v0.2.0.sounds.q${String(number).padStart(2, '0')}`, {
      sourcePrompt: `Nghe từ số${number}. Chọn từ tiếng Anh đã nghe.`,
      sourceOptions,
      prompt: `Listen to word ${number}. Choose the English word you hear.`,
    }];
  })),
  'manus:A0.2-018.P1': { sourcePrompt: 'Mai đang rủ cả hai cùng làm hay yêu cầu riêng Ben làm?', sourceOptions: { A: 'Rủ cả hai cùng làm', B: 'Chỉ yêu cầu Ben làm' }, prompt: 'Is Mai inviting both of them to act together, or asking only Ben to act?', options: { A: 'Inviting both to act together', B: 'Asking only Ben to act' } },
  'manus:A0.2-018.P2': { sourcePrompt: 'Mai rủ luyện gì?', sourceOptions: { A: 'Viết tên', B: 'Tiếng Anh' }, prompt: 'What does Mai suggest practising?', options: { A: 'Writing names', B: 'English' } },
  'manus:A0.2-018.P3': { sourcePrompt: 'Ai được yêu cầu đọc tên trong đoạn này?', sourceOptions: { A: 'Giáo viên và học viên cùng đọc tên mình', B: 'Học viên được giáo viên nói với' }, prompt: 'Who is asked to read a name in this clip?', options: { A: 'Teacher and learner both read their names', B: 'The learner addressed by the teacher' } },
  'manus:A0.2-018.P4': { sourcePrompt: 'Ben đề nghị làm gì trước?', sourceOptions: { A: 'Đọc', B: 'Viết tên' }, prompt: 'What does Ben suggest doing first?', options: { A: 'Reading', B: 'Writing names' } },
  'manus:A0.2-018.P5': { sourcePrompt: 'Hai bạn đang nói về việc luyện gì?', sourceOptions: { A: 'Tên', B: 'Câu hỏi' }, prompt: 'What are they talking about practising?', options: { A: 'Names', B: 'Questions' } },
  'manus:A0.2-018.P6': { sourcePrompt: 'Ben có đồng ý không?', sourceOptions: { A: 'Có', B: 'Không' }, prompt: 'Does Ben agree?', options: { A: 'Yes', B: 'No' } },
};

function matchesSource(question, entry) {
  return entry?.sourcePrompt === question.prompt &&
    (!entry.sourceOptions || (
      Object.keys(entry.sourceOptions).length === Object.keys(question.options || {}).length &&
      Object.entries(entry.sourceOptions).every(([key, value]) => question.options?.[key] === value)
    ));
}

function exactOptions(source, candidate) {
  if (!source || typeof source !== 'object' || Array.isArray(source) ||
      !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const keys = Object.keys(source);
  return keys.length === Object.keys(candidate).length &&
    keys.every((key) => candidate[key] === source[key]);
}

function translatedOptionsValid(source, translated) {
  if (!translated || typeof translated !== 'object' || Array.isArray(translated)) return false;
  const keys = Object.keys(source);
  return keys.length === Object.keys(translated).length &&
    keys.every((key) => typeof translated[key] === 'string' && translated[key].trim());
}

function reviewedTranslation(question) {
  if (question.editorial_translation !== undefined) {
    const entry = question.editorial_translation;
    const sourceOptions = question.options || {};
    if (!entry || entry.status !== 'approved' || entry.source_item_id !== question.source_item_id ||
        !['en', 'vi'].includes(entry.source_language) || !['en', 'vi'].includes(entry.target_language) ||
        entry.source_language === entry.target_language || entry.source_prompt !== question.prompt ||
        !exactOptions(sourceOptions, entry.source_options) ||
        typeof entry.prompt !== 'string' || !entry.prompt.trim()) return null;
    const hasOptions = Object.keys(sourceOptions).length > 0;
    if (hasOptions && (entry.unchanged_options_reviewed === true) === (entry.options !== undefined)) return null;
    if (entry.options !== undefined && !translatedOptionsValid(sourceOptions, entry.options)) return null;
    if (!hasOptions && (entry.options !== undefined || entry.unchanged_options_reviewed !== undefined)) return null;
    if (question.visual_url && (
      typeof entry.visual_url !== 'string' || !entry.visual_url ||
      typeof entry.visual_accessibility !== 'string' || !entry.visual_accessibility.trim()
    )) return null;
    return entry;
  }
  const pilot = englishPilot[question.source_item_id];
  if (question.visual_url) return null;
  return matchesSource(question, pilot) ? {
    status: 'approved', source_language: 'vi', target_language: 'en',
    prompt: pilot.prompt, options: pilot.options,
  } : null;
}

export function availableQuestionLanguages(questions) {
  const translated = questions.length > 0 && questions.every((question) => reviewedTranslation(question));
  return translated ? ['vi', 'en'] : [];
}

export function displayQuestion(question, language) {
  const entry = reviewedTranslation(question);
  if (!entry || language !== entry.target_language) return question;
  return {
    ...question,
    prompt: entry.prompt,
    options: entry.options ? { ...entry.options } : question.options,
    visual_url: entry.visual_url || question.visual_url,
    visual_accessibility: entry.visual_accessibility || question.visual_accessibility,
  };
}

export function groupProgrammeQuestions(questions) {
  // One step per question even when six questions share one source recording.
  // Audio remains whole-form because pre-submit answer windows are protected.
  return questions.map((question) => ({ key: `question:${question.q_num}`, questions: [question] }));
}
