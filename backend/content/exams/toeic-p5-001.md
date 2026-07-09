---
content_type: exam
exam_source: toeic_rc
code: AVR-TOEIC-P5-001
title: "TOEIC Part 5 — Incomplete Sentences (Set 1)"
part: part5
time_limit_minutes: 12
status: published
questions:
  - q_num: 1
    question_type: mcq_single
    prompt: "The quarterly report, along with the updated budget forecasts, ____ ready for tomorrow's board meeting."
    options:
      - {label: A, text: "are"}
      - {label: B, text: "is"}
      - {label: C, text: "were"}
      - {label: D, text: "being"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: subject-verb-agreement
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Chủ ngữ chính là 'The quarterly report' (số ít); 'along with the updated budget forecasts' chỉ là thành phần chêm, KHÔNG đổi số của động từ."
          kp_refs:
            - {type: grammar, slug: subject-verb-agreement, anchor: subject-verb-agreement.overview}
          microcheck:
            prompt: "Chủ ngữ chính (head noun) của câu là gì?"
            options:
              - "The quarterly report"
              - "the updated budget forecasts"
              - "tomorrow's board meeting"
            answer: "A"
        - action: confirm
          instruction_vi: "Chủ ngữ số ít → động từ 'is'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'are' dùng cho chủ ngữ số nhiều — bẫy vì cụm 'the budget forecasts' đứng ngay trước."

  - q_num: 2
    question_type: mcq_single
    prompt: "All visitors must obtain ____ identification badge from the reception desk before entering the facility."
    options:
      - {label: A, text: "a"}
      - {label: B, text: "an"}
      - {label: C, text: "the"}
      - {label: D, text: "some"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: articles
    solution:
      solution_steps:
        - action: decode_vocab
          instruction_vi: "'identification' bắt đầu bằng ÂM nguyên âm /ɪ/ khi đọc — chọn mạo từ theo âm, không theo chữ cái."
          kp_refs:
            - {type: grammar, slug: articles, anchor: articles.indefinite.when-to-use}
          microcheck:
            prompt: "'identification' khi đọc lên bắt đầu bằng âm gì?"
            options:
              - "âm nguyên âm /ɪ/"
              - "âm phụ âm"
              - "âm câm (không phát âm)"
            answer: "A"
        - action: confirm
          instruction_vi: "Danh từ đếm được số ít, âm mở đầu là nguyên âm → 'an'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'a' đứng trước âm phụ âm; ở đây âm mở đầu là nguyên âm nên phải dùng 'an'."

  - q_num: 3
    question_type: mcq_single
    prompt: "The new assembly line ____ last month to increase the factory's production capacity."
    options:
      - {label: A, text: "installed"}
      - {label: B, text: "was installed"}
      - {label: C, text: "has installed"}
      - {label: D, text: "installing"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: passive-voice
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'The assembly line' KHÔNG tự lắp đặt — nó ĐƯỢC lắp đặt → cần thể bị động be + V3."
          kp_refs:
            - {type: grammar, slug: passive-voice, anchor: passive-voice.structure.be-pp}
          microcheck:
            prompt: "'The new assembly line' tự lắp đặt hay được lắp đặt?"
            options:
              - "được lắp đặt (bị động)"
              - "tự lắp đặt (chủ động)"
              - "đang tự lắp đặt"
            answer: "A"
        - action: confirm
          instruction_vi: "'last month' là quá khứ → 'was installed'. Đáp án B."
      distractor_analysis:
        - option: C
          why_wrong_vi: "'has installed' là chủ động hoàn thành — sai nghĩa (dây chuyền không thực hiện hành động)."

  - q_num: 4
    question_type: mcq_single
    prompt: "This year's marketing campaign was far ____ than the one we ran last spring."
    options:
      - {label: A, text: "successful"}
      - {label: B, text: "success"}
      - {label: C, text: "more successful"}
      - {label: D, text: "most successful"}
    answer: "C"
    kp_focus: grammar
    grammar_slug: comparison
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Có 'than' → đây là so sánh HƠN giữa hai chiến dịch."
          kp_refs:
            - {type: grammar, slug: comparison, anchor: comparison.comparative.more-than}
          microcheck:
            prompt: "Từ 'than' trong câu báo hiệu loại so sánh nào?"
            options:
              - "so sánh hơn"
              - "so sánh nhất"
              - "so sánh bằng"
            answer: "A"
        - action: confirm
          instruction_vi: "Tính từ dài 'successful' → 'more successful … than'. Đáp án C."
      distractor_analysis:
        - option: D
          why_wrong_vi: "'most successful' là so sánh NHẤT (dùng với 'the'), không đi với 'than'."

  - q_num: 5
    question_type: mcq_single
    prompt: "The consultant ____ presented the proposal will join us for the follow-up call on Friday."
    options:
      - {label: A, text: "which"}
      - {label: B, text: "who"}
      - {label: C, text: "whose"}
      - {label: D, text: "where"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: relative-clauses
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Chỗ trống thay cho 'the consultant' (người) và làm CHỦ NGỮ cho 'presented' → đại từ quan hệ chỉ người."
          kp_refs:
            - {type: grammar, slug: relative-clauses, anchor: relative-clauses.who-which-that}
          microcheck:
            prompt: "Chỗ trống thay cho 'the consultant' (người) và làm chức năng gì trong mệnh đề quan hệ?"
            options:
              - "chủ ngữ của 'presented'"
              - "tân ngữ của 'presented'"
              - "chỉ sở hữu"
            answer: "A"
        - action: confirm
          instruction_vi: "Người + chủ ngữ → 'who'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'which' chỉ vật, không dùng cho người."

  - q_num: 6
    question_type: mcq_single
    prompt: "If the shipment ____ delayed, we will notify the client immediately."
    options:
      - {label: A, text: "will be"}
      - {label: B, text: "is"}
      - {label: C, text: "was"}
      - {label: D, text: "would be"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: conditionals
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Mệnh đề chính dùng 'will notify' → đây là câu điều kiện loại 1 (có thật ở tương lai)."
          kp_refs:
            - {type: grammar, slug: conditionals, anchor: conditionals.type1.first-conditional}
          microcheck:
            prompt: "Mệnh đề chính 'we will notify' cho biết đây là câu điều kiện loại mấy?"
            options:
              - "loại 1 (có thật, ở tương lai)"
              - "loại 2 (giả định trái thực tại)"
              - "loại 3 (quá khứ không thật)"
            answer: "A"
        - action: confirm
          instruction_vi: "Điều kiện loại 1: mệnh đề 'if' dùng HIỆN TẠI đơn → 'is'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "Không dùng 'will' trong mệnh đề 'if' của câu điều kiện loại 1."
---

TOEIC Part 5 — Incomplete Sentences. Đề tự soạn theo format ETS (không sao chép đề gốc có bản quyền).
