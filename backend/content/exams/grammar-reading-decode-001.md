---
content_type: exam
exam_source: grammar_reading
code: AVR-GRDR-DECODE-001
title: "Ngữ pháp Đọc hiểu — Giải mã câu (Bộ 1)"
part: decode
time_limit_minutes: 12
status: published
questions:
  - q_num: 1
    question_type: mcq_single
    prompt: "The artefacts ____ in the tomb are now displayed in the national museum."
    options:
      - {label: A, text: "discovered"}
      - {label: B, text: "discovering"}
      - {label: C, text: "which discovered"}
      - {label: D, text: "discover"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: reduced-relative-clauses
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'discovered in the tomb' là mệnh đề quan hệ rút gọn BỊ ĐỘNG = 'which were discovered in the tomb'. Hiện vật ĐƯỢC phát hiện, nên dùng phân từ quá khứ (V3)."
          kp_refs:
            - {type: grammar, slug: reduced-relative-clauses, anchor: reduced-relative-clauses.passive-v3}
          microcheck:
            prompt: "'The artefacts discovered in the tomb' — 'discovered' rút gọn từ cụm nào?"
            options:
              - "which were discovered"
              - "which discovered"
              - "who discovered"
            answer: "A"
        - action: confirm
          instruction_vi: "Rút gọn bị động → phân từ quá khứ 'discovered'. Đáp án A."
      distractor_analysis:
        - option: B
          why_wrong_vi: "'discovering' (V-ing) là rút gọn CHỦ ĐỘNG — sai nghĩa vì hiện vật không tự phát hiện, mà được phát hiện."
          kp_refs:
            - {type: grammar, slug: reduced-relative-clauses, anchor: reduced-relative-clauses.pitfall}

  - q_num: 2
    question_type: mcq_single
    prompt: "____ by rising ocean temperatures, many coral species have begun to migrate toward cooler waters."
    options:
      - {label: A, text: "Threatening"}
      - {label: B, text: "Threatened"}
      - {label: C, text: "To threaten"}
      - {label: D, text: "Threaten"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: participle-clauses
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Mệnh đề phân từ đầu câu 'Threatened by rising temperatures' mang nghĩa bị động + lý do = 'Because they are threatened by...'. Chủ ngữ 'coral species' BỊ đe doạ."
          kp_refs:
            - {type: grammar, slug: participle-clauses, anchor: participle-clauses.meaning}
          microcheck:
            prompt: "'Threatened by rising temperatures' diễn đạt quan hệ gì với mệnh đề chính?"
            options:
              - "nguyên nhân (ý bị động)"
              - "mục đích"
              - "thời gian tương lai"
            answer: "A"
        - action: confirm
          instruction_vi: "Ý bị động (bị đe doạ) → phân từ quá khứ 'Threatened'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'Threatening' (chủ động) nghĩa là loài san hô đi đe doạ thứ khác — ngược nghĩa. Chúng là đối tượng BỊ đe doạ."
          kp_refs:
            - {type: grammar, slug: participle-clauses, anchor: participle-clauses.pitfall}

  - q_num: 3
    question_type: mcq_single
    prompt: "The rapid decline in the number of pollinating insects across farming regions ____ scientists worldwide."
    options:
      - {label: A, text: "worry"}
      - {label: B, text: "worries"}
      - {label: C, text: "worrying"}
      - {label: D, text: "to worry"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: complex-noun-phrases
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Chủ ngữ là cụm danh từ dài; danh từ chính (head noun) là 'decline' (số ít) — không phải 'insects' hay 'regions' đứng gần động từ. Vậy động từ chia số ít."
          kp_refs:
            - {type: grammar, slug: complex-noun-phrases, anchor: complex-noun-phrases.head-noun}
          microcheck:
            prompt: "Trong 'The rapid decline in the number of pollinating insects', đâu là danh từ chính (head noun)?"
            options:
              - "decline"
              - "insects"
              - "number"
            answer: "A"
        - action: confirm
          instruction_vi: "Head noun 'decline' số ít → 'worries'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'worry' (số nhiều) là bẫy: các danh từ 'insects/regions' đứng ngay trước động từ, nhưng chúng chỉ bổ nghĩa cho 'decline'."
          kp_refs:
            - {type: grammar, slug: complex-noun-phrases, anchor: complex-noun-phrases.pitfall}

  - q_num: 4
    question_type: mcq_single
    prompt: "In academic writing, 'The implementation of the policy led to a reduction in emissions.' The hidden verbs behind 'implementation' and 'reduction' are ____."
    options:
      - {label: A, text: "implement / reduce"}
      - {label: B, text: "implementary / reductive"}
      - {label: C, text: "implementation / reduction"}
      - {label: D, text: "implement / reduction"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: nominalization
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Danh hoá (nominalization) biến động từ thành danh từ: 'implementation' ← implement, 'reduction' ← reduce. Khôi phục động từ ẩn giúp hiểu 'ai làm gì' trong câu học thuật."
          kp_refs:
            - {type: grammar, slug: nominalization, anchor: nominalization.recognise}
          microcheck:
            prompt: "'a reduction in emissions' — danh từ 'reduction' được danh hoá từ động từ nào?"
            options:
              - "reduce"
              - "reductive"
              - "reductionism"
            answer: "A"
        - action: confirm
          instruction_vi: "implementation → implement, reduction → reduce. Đáp án A."
      distractor_analysis:
        - option: D
          why_wrong_vi: "'reduction' vẫn là danh từ, không phải dạng động từ; động từ gốc là 'reduce'."
          kp_refs:
            - {type: grammar, slug: nominalization, anchor: nominalization.pitfall}

  - q_num: 5
    question_type: mcq_single
    prompt: "In 'The samples were analysed using a mass spectrometer,' who actually performed the analysis is ____."
    options:
      - {label: A, text: "the samples"}
      - {label: B, text: "not stated (agentless passive)"}
      - {label: C, text: "a mass spectrometer"}
      - {label: D, text: "the analysis"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: passive-in-academic-texts
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Bị động học thuật thường LƯỢC tác nhân (agentless): 'were analysed' không nêu ai phân tích — tiêu điểm đặt vào quy trình, không vào người."
          kp_refs:
            - {type: grammar, slug: passive-in-academic-texts, anchor: passive-in-academic-texts.agent}
          microcheck:
            prompt: "'The samples were analysed using a mass spectrometer' — tác nhân (người/nhóm thực hiện) là gì?"
            options:
              - "không nêu rõ"
              - "the mass spectrometer"
              - "the samples"
            answer: "A"
        - action: confirm
          instruction_vi: "Không có cụm 'by + tác nhân' → bị động lược tác nhân. Đáp án B."
      distractor_analysis:
        - option: C
          why_wrong_vi: "'a mass spectrometer' là CÔNG CỤ (using...), không phải tác nhân thực hiện hành động."
          kp_refs:
            - {type: grammar, slug: passive-in-academic-texts, anchor: passive-in-academic-texts.pitfall}

  - q_num: 6
    question_type: mcq_single
    prompt: "In 'Although the study, which surveyed over 5,000 participants, was widely praised, its conclusions were later disputed,' the MAIN (independent) clause is ____."
    options:
      - {label: A, text: "the study surveyed over 5,000 participants"}
      - {label: B, text: "its conclusions were later disputed"}
      - {label: C, text: "the study was widely praised"}
      - {label: D, text: "Although the study was widely praised"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: long-sentence-untangling
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Tách bỏ mệnh đề chêm 'which surveyed...' và mệnh đề nhượng bộ 'Although... praised', phần độc lập còn lại là 'its conclusions were later disputed'."
          kp_refs:
            - {type: grammar, slug: long-sentence-untangling, anchor: long-sentence-untangling.find-main}
          microcheck:
            prompt: "Đâu là mệnh đề CHÍNH (độc lập, đứng riêng thành câu được)?"
            options:
              - "its conclusions were later disputed"
              - "the study was widely praised"
              - "which surveyed over 5,000 participants"
            answer: "A"
        - action: confirm
          instruction_vi: "Mệnh đề chính là vế không bị 'Although'/'which' chi phối. Đáp án B."
      distractor_analysis:
        - option: D
          why_wrong_vi: "'Although the study was widely praised' là mệnh đề nhượng bộ (phụ thuộc) — không thể đứng riêng thành câu."
          kp_refs:
            - {type: grammar, slug: long-sentence-untangling, anchor: long-sentence-untangling.pitfall}

  - q_num: 7
    question_type: mcq_single
    prompt: "Governments have invested heavily in renewable energy. ____ shift reflects growing public concern about climate change."
    options:
      - {label: A, text: "This"}
      - {label: B, text: "These"}
      - {label: C, text: "Such"}
      - {label: D, text: "It"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: reference-and-cohesion
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'This + danh từ tổng kết' (This shift) trỏ ngược về cả ý câu trước — việc chính phủ đầu tư vào năng lượng tái tạo. 'shift' số ít nên dùng 'This'."
          kp_refs:
            - {type: grammar, slug: reference-and-cohesion, anchor: reference-and-cohesion.this-such}
          microcheck:
            prompt: "'This shift' trỏ về điều gì ở câu trước?"
            options:
              - "việc chính phủ đầu tư vào năng lượng tái tạo"
              - "biến đổi khí hậu"
              - "công chúng"
            answer: "A"
        - action: confirm
          instruction_vi: "Danh từ số ít 'shift' + trỏ ngược một ý → 'This'. Đáp án A."
      distractor_analysis:
        - option: B
          why_wrong_vi: "'These' cần danh từ số nhiều; ở đây 'shift' số ít nên không hợp."
          kp_refs:
            - {type: grammar, slug: reference-and-cohesion, anchor: reference-and-cohesion.pitfall}
---

Bộ đề "Ngữ pháp Đọc hiểu — Giải mã câu" tự soạn (copyright-safe). Mỗi câu kiểm tra một cấu trúc cản trở việc giải mã câu trong bài đọc học thuật; phần chữa có stepper + micro-check ghi bằng chứng KP.
