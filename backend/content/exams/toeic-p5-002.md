---
content_type: exam
exam_source: toeic_rc
code: AVR-TOEIC-P5-002
title: "TOEIC Part 5 — Incomplete Sentences (Set 2)"
part: part5
time_limit_minutes: 12
status: published
questions:
  - q_num: 1
    question_type: mcq_single
    prompt: "Ms. Tanaka ____ for this firm for over a decade and is now our senior consultant."
    options:
      - {label: A, text: "worked"}
      - {label: B, text: "has worked"}
      - {label: C, text: "is working"}
      - {label: D, text: "had worked"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: present-perfect
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'for over a decade' chỉ khoảng thời gian kéo dài TỚI HIỆN TẠI (vẫn đang làm) → hiện tại hoàn thành."
          kp_refs:
            - {type: grammar, slug: present-perfect, anchor: present-perfect.usage.unfinished-time}
        - action: confirm
          instruction_vi: "have/has + V3 → 'has worked'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'worked' (quá khứ đơn) ngụ ý đã nghỉ — trái với 'is now our senior consultant'."

  - q_num: 2
    question_type: mcq_single
    prompt: "The board ____ the merger proposal at last Tuesday's meeting."
    options:
      - {label: A, text: "approves"}
      - {label: B, text: "has approved"}
      - {label: C, text: "approved"}
      - {label: D, text: "approving"}
    answer: "C"
    kp_focus: grammar
    grammar_slug: past-simple
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'last Tuesday's meeting' là mốc thời gian quá khứ xác định → quá khứ đơn."
          kp_refs:
            - {type: grammar, slug: past-simple, anchor: past-simple.usage.completed-past}
        - action: confirm
          instruction_vi: "Hành động hoàn tất trong quá khứ → 'approved'. Đáp án C."
      distractor_analysis:
        - option: B
          why_wrong_vi: "Hiện tại hoàn thành 'has approved' không đi với mốc thời gian quá khứ xác định."

  - q_num: 3
    question_type: mcq_single
    prompt: "Among the four branches, the downtown office reported the ____ sales this quarter."
    options:
      - {label: A, text: "high"}
      - {label: B, text: "higher"}
      - {label: C, text: "highest"}
      - {label: D, text: "more high"}
    answer: "C"
    kp_focus: grammar
    grammar_slug: comparison
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'Among the four branches' + 'the' → so sánh NHẤT trong một nhóm."
          kp_refs:
            - {type: grammar, slug: comparison, anchor: comparison.superlative.the-est}
        - action: confirm
          instruction_vi: "Tính từ ngắn 'high' → 'the highest'. Đáp án C."
      distractor_analysis:
        - option: B
          why_wrong_vi: "'higher' là so sánh HƠN (2 đối tượng), không dùng với 'the … among'."

  - q_num: 4
    question_type: mcq_single
    prompt: "The proposal ____ we submitted last week has already been approved by the committee."
    options:
      - {label: A, text: "that"}
      - {label: B, text: "what"}
      - {label: C, text: "who"}
      - {label: D, text: "where"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: relative-clauses
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Chỗ trống thay cho 'the proposal' (vật) và làm TÂN NGỮ của 'submitted' → đại từ quan hệ chỉ vật."
          kp_refs:
            - {type: grammar, slug: relative-clauses, anchor: relative-clauses.who-which-that}
        - action: confirm
          instruction_vi: "Vật + mệnh đề xác định → 'that' (hoặc which). Đáp án A."
      distractor_analysis:
        - option: B
          why_wrong_vi: "'what' không dùng làm đại từ quan hệ sau một danh từ đã nêu."

  - q_num: 5
    question_type: mcq_single
    prompt: "The research findings ____ in a peer-reviewed journal early next year."
    options:
      - {label: A, text: "will publish"}
      - {label: B, text: "will be published"}
      - {label: C, text: "are publishing"}
      - {label: D, text: "have published"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: passive-voice
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'The findings' không tự công bố — chúng ĐƯỢC công bố → bị động; 'next year' → tương lai."
          kp_refs:
            - {type: grammar, slug: passive-voice, anchor: passive-voice.usage.formal-academic}
        - action: confirm
          instruction_vi: "will + be + V3 → 'will be published'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'will publish' là chủ động — sai vì findings không thực hiện hành động."

  - q_num: 6
    question_type: mcq_single
    prompt: "If the budget ____ larger, we would hire two additional data analysts."
    options:
      - {label: A, text: "is"}
      - {label: B, text: "was"}
      - {label: C, text: "were"}
      - {label: D, text: "will be"}
    answer: "C"
    kp_focus: grammar
    grammar_slug: conditionals
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Mệnh đề chính dùng 'would hire' → câu điều kiện loại 2 (giả định trái thực tại)."
          kp_refs:
            - {type: grammar, slug: conditionals, anchor: conditionals.type2.second-conditional}
        - action: confirm
          instruction_vi: "Điều kiện loại 2 dùng 'were' cho mọi ngôi → 'were'. Đáp án C."
      distractor_analysis:
        - option: B
          why_wrong_vi: "Trong văn phong chuẩn, câu điều kiện loại 2 dùng 'were' (subjunctive), không phải 'was'."
---

TOEIC Part 5 — Incomplete Sentences (Set 2). Đề tự soạn theo format ETS (không sao chép đề gốc có bản quyền).
