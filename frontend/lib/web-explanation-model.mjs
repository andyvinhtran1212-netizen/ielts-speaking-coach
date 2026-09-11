function plain(value) {
  return String(value ?? '').trim();
}

const ERROR_LABELS = {
  answer_form: 'Sai dạng đáp án hoặc cách ghi',
  word_limit: 'Không tuân thủ giới hạn từ',
  grammar_fit: 'Chưa kiểm tra ngữ pháp quanh chỗ trống',
  paraphrase_miss: 'Bỏ lỡ paraphrase',
  author_view_vs_fact: 'Nhầm quan điểm tác giả với sự kiện',
  contradiction_vs_absence: 'Nhầm mâu thuẫn với không có thông tin',
  detail_as_main_idea: 'Chọn chi tiết thay cho ý chính',
  diagram_reference: 'Đọc sai điểm tham chiếu trên sơ đồ',
  distractor_capture: 'Bị phương án nhiễu dẫn hướng',
  first_mention: 'Chốt theo thông tin được nhắc đầu tiên',
  grammar_fit_only: 'Chỉ dựa vào ngữ pháp, chưa kiểm tra nghĩa',
  keyword_matching: 'Ghép từ khóa mà chưa kiểm tra ý',
  logic_relationship: 'Nhầm quan hệ logic',
  mentioned_not_answer: 'Chọn chi tiết được nhắc nhưng không trả lời câu hỏi',
  missed_self_correction: 'Bỏ lỡ chỗ người nói tự sửa',
  number_or_name_decoding: 'Nghe sai số hoặc tên riêng',
  option_load: 'Quá tải khi theo dõi nhiều phương án',
  orientation_loss: 'Mất phương hướng trên bản đồ/sơ đồ',
  over_inference: 'Suy luận vượt quá bằng chứng',
  paragraph_function: 'Hiểu sai chức năng của đoạn',
  partial_match: 'Chỉ khớp một phần thông tin',
  partial_set: 'Chọn thiếu hoặc thừa phương án trong nhóm',
  partial_truth: 'Phương án chỉ đúng một phần',
  plural_or_number_agreement: 'Sai số ít/số nhiều',
  polarity_flip: 'Bỏ lỡ từ phủ định hoặc đảo chiều ý',
  position_tracking: 'Mất vị trí đang nghe',
  reference_chain: 'Theo sai từ tham chiếu',
  repeated_information: 'Nhầm thông tin được lặp lại',
  scope_or_modifier: 'Bỏ sót từ giới hạn phạm vi',
  sequence_tracking: 'Theo sai thứ tự thông tin',
  sound_decoding: 'Không giải mã được cụm âm',
  spatial_language: 'Hiểu sai ngôn ngữ chỉ vị trí',
  spatial_orientation: 'Định hướng sai trên bản đồ',
  speaker_attribution: 'Gán ý cho nhầm người nói',
  word_boundary: 'Tách ranh giới từ sai khi nghe',
  wrong_attribution: 'Gán nguyên nhân hoặc quan điểm sai đối tượng',
  wrong_search_zone: 'Tìm bằng chứng sai vùng',
  inference: 'Suy luận chưa đủ căn cứ',
  spelling: 'Sai chính tả',
  lost_audio_position: 'Mất vị trí trong audio',
  could_not_hear: 'Không nghe rõ cụm quyết định',
  other: 'Chưa xác định rõ nguyên nhân',

  // Canonical Reading taxonomy emitted by the Cambridge importer.
  'R02-SYN': 'Bỏ lỡ paraphrase hoặc từ đồng nghĩa',
  'R04-REFERENCE_CHAIN': 'Theo sai chuỗi từ tham chiếu',
  'R05-REPEATED_INFO': 'Nhầm thông tin được lặp lại',
  'R05-SEARCH_SLOW': 'Mất quá nhiều thời gian định vị bằng chứng',
  'R05-WEAK_ANCHOR': 'Dùng điểm định vị chưa đủ chắc chắn',
  'R05-WRONG_SEARCH_ZONE': 'Tìm bằng chứng sai vùng',
  'R06-DETAIL_AS_GIST': 'Chọn chi tiết thay cho ý chính',
  'R06-KEYWORD_HEADING': 'Ghép heading theo từ khóa bề mặt',
  'R06-WRONG_FUNCTION': 'Hiểu sai chức năng của đoạn',
  'R07-FALSE_VS_NG': 'Nhầm False với Not Given',
  'R07-MISSING_PROOF': 'Chọn khi chưa có đủ bằng chứng',
  'R07-OVER_INFERENCE': 'Suy luận vượt quá bằng chứng',
  'R08-SEQUENCE': 'Theo sai thứ tự hoặc quan hệ logic',
  'R09-MENTION': 'Chọn chi tiết được nhắc nhưng không trả lời câu hỏi',
  'R09-PARTIAL': 'Phương án chỉ khớp một phần',
  'R09-REVERSE': 'Bỏ lỡ ý đảo chiều hoặc phủ định',
  'R09-SCOPE': 'Bỏ sót từ giới hạn phạm vi',
  'R09-SPEAKER': 'Gán ý cho nhầm người hoặc đối tượng',
  'R11-COPY_ERROR': 'Chép sai đáp án từ bài đọc',
  'R11-GRAMMAR_FIT': 'Chưa kiểm tra dạng ngữ pháp quanh chỗ trống',
  'R11-PLURAL': 'Sai số ít hoặc số nhiều',
  'R11-SPELLING': 'Sai chính tả khi chép đáp án',
  'R11-WORD_LIMIT': 'Không tuân thủ giới hạn từ',

  // Canonical Listening taxonomy emitted by the Cambridge importer.
  'L01-WORD_NOT_RECOGNISED': 'Không nhận ra từ hoặc cụm âm',
  'L02-WORD_BOUNDARY': 'Tách sai ranh giới từ khi nghe',
  'L06-LEXICAL': 'Bỏ lỡ cách diễn đạt tương đương',
  'L07-FIRST_MENTION': 'Chốt theo thông tin được nhắc đầu tiên',
  'L07-MISSED_CORRECTION': 'Bỏ lỡ chỗ người nói tự sửa',
  'L07-PARTIAL_MATCH': 'Chọn thông tin chỉ khớp một phần',
  'L07-POLARITY_FLIP': 'Bỏ lỡ từ phủ định hoặc đảo chiều ý',
  'L08-LOST_POSITION': 'Mất vị trí đang nghe',
  'L09-OPTION_OVERLOAD': 'Quá tải khi theo dõi nhiều phương án',
  'L10-SPEAKER_ATTRIBUTION': 'Gán ý cho nhầm người nói',
  'L11-DIRECTION': 'Hiểu sai ngôn ngữ chỉ hướng',
  'L11-ORIENTATION': 'Mất phương hướng trên bản đồ hoặc sơ đồ',
  'L11-PATH_SEQUENCE': 'Theo sai thứ tự đường đi',
  'L12-NAME_SPELLING': 'Nghe hoặc đánh vần sai tên riêng',
  'L13-FINAL_S': 'Bỏ lỡ âm cuối hoặc dạng số nhiều',
  'L13-GRAMMAR_FIT': 'Chưa kiểm tra dạng ngữ pháp của đáp án',
  'L13-SPELLING': 'Sai chính tả khi ghi đáp án',
  'L13-WORD_LIMIT': 'Không tuân thủ giới hạn từ',
};

function first(normalize, ...values) {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) return normalized;
  }
  return '';
}

/**
 * Normalize authored answer options into [submitted value, display text].
 * Object-array packages use either {value, label}, {label, text}, or
 * {letter, text}; the identifier must never fall back to the array index when
 * one of those canonical identifiers is present.
 */
export function answerOptions(object, normalize = plain) {
  const options = object?.item?.options;
  if (options && typeof options === 'object' && !Array.isArray(options)) {
    return Object.entries(options).map(([key, value]) => [normalize(key), normalize(value)]);
  }
  if (!Array.isArray(options)) return [];

  return options.map((value, index) => {
    if (!value || typeof value !== 'object') {
      const normalized = normalize(value);
      return [normalized, normalized];
    }

    const identifier = first(
      normalize,
      value.value,
      value.label,
      value.letter,
      value.id,
      value.key,
      index + 1,
    );
    const display = first(
      normalize,
      value.text,
      value.value != null ? value.label : null,
      value.label,
      value.value,
      value.letter,
      identifier,
    );
    return [identifier, display];
  });
}

/** Keep canonical analytics codes as values while showing learner-safe labels. */
export function candidateErrorOptions(object, normalize = plain) {
  const codes = Array.isArray(object?.remediation?.candidate_error_subtypes)
    ? object.remediation.candidate_error_subtypes.map(normalize).filter(Boolean)
    : [];
  const seen = new Set();
  return [...codes, 'other'].filter((code) => {
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  }).map((code) => [code, ERROR_LABELS[code] || 'Nguyên nhân khác']);
}
