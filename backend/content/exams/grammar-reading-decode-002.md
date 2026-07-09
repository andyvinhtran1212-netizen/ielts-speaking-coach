---
content_type: exam
exam_source: grammar_reading
code: AVR-GRDR-DECODE-002
title: "Ngữ pháp Đọc hiểu — Giải mã câu (Bộ 2)"
part: decode
time_limit_minutes: 12
status: published
questions:
  - q_num: 1
    question_type: mcq_single
    prompt: "'The results were not dissimilar to earlier findings' is closest in meaning to ____."
    options:
      - {label: A, text: "The results were similar to earlier findings."}
      - {label: B, text: "The results were completely different."}
      - {label: C, text: "There were no results."}
      - {label: D, text: "Earlier findings were wrong."}
    answer: "A"
    kp_focus: grammar
    grammar_slug: paraphrase-patterns
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'not dissimilar' là phủ định kép: 'not' + 'dissimilar' (khác) = 'similar' (giống). Diễn đạt lại qua phủ định kép là bẫy hay gặp."
          kp_refs:
            - {type: grammar, slug: paraphrase-patterns, anchor: paraphrase-patterns.negation}
          microcheck:
            prompt: "'not dissimilar' nghĩa là gì?"
            options:
              - "khá giống nhau"
              - "hoàn toàn khác"
              - "không liên quan"
            answer: "A"
        - action: confirm
          instruction_vi: "Phủ định kép 'not dissimilar' = 'similar'. Đáp án A."
      distractor_analysis:
        - option: B
          why_wrong_vi: "Chọn 'completely different' là hiểu sai phủ định kép — bỏ sót chữ 'not' trước 'dissimilar'."
          kp_refs:
            - {type: grammar, slug: paraphrase-patterns, anchor: paraphrase-patterns.pitfall}

  - q_num: 2
    question_type: mcq_single
    prompt: "The theory was elegant and widely cited; ____, it failed to predict several key outcomes."
    options:
      - {label: A, text: "therefore"}
      - {label: B, text: "nevertheless"}
      - {label: C, text: "moreover"}
      - {label: D, text: "for example"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: logical-connectors-in-reading
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Hai vế trái chiều: 'elegant / widely cited' (tích cực) ↔ 'failed to predict' (tiêu cực). Từ nối phải báo hiệu TƯƠNG PHẢN → 'nevertheless'."
          kp_refs:
            - {type: grammar, slug: logical-connectors-in-reading, anchor: logical-connectors-in-reading.predict}
          microcheck:
            prompt: "Quan hệ giữa hai vế của câu là gì?"
            options:
              - "tương phản"
              - "nguyên nhân – kết quả"
              - "bổ sung thêm ý"
            answer: "A"
        - action: confirm
          instruction_vi: "Quan hệ tương phản → 'nevertheless'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'therefore' chỉ kết quả/hệ quả — sai vì hai vế trái ngược, không phải nhân–quả."
          kp_refs:
            - {type: grammar, slug: logical-connectors-in-reading, anchor: logical-connectors-in-reading.pitfall}

  - q_num: 3
    question_type: mcq_single
    prompt: "'The findings suggest that the drug may reduce symptoms in some patients.' The author's claim is best described as ____."
    options:
      - {label: A, text: "tentative / hedged"}
      - {label: B, text: "absolutely certain"}
      - {label: C, text: "denying any effect"}
      - {label: D, text: "a proven fact"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: hedging-and-certainty-in-reading
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'suggest', 'may', 'some' đều là ngôn ngữ rào đón (hedging) → tác giả KHÔNG khẳng định chắc chắn, chỉ nêu khả năng."
          kp_refs:
            - {type: grammar, slug: hedging-and-certainty-in-reading, anchor: hedging-and-certainty-in-reading.tfng}
          microcheck:
            prompt: "Các từ 'suggest', 'may', 'some' thể hiện điều gì?"
            options:
              - "mức chắc chắn thấp (rào đón)"
              - "sự chắc chắn tuyệt đối"
              - "sự phủ định"
            answer: "A"
        - action: confirm
          instruction_vi: "Ngôn ngữ rào đón → nhận định dè dặt. Đáp án A."
      distractor_analysis:
        - option: D
          why_wrong_vi: "Coi đây là 'proven fact' bỏ qua các từ rào đón — đúng kiểu bẫy khiến chọn TRUE trong khi câu chỉ nêu khả năng (thường là NOT GIVEN/FALSE)."
          kp_refs:
            - {type: grammar, slug: hedging-and-certainty-in-reading, anchor: hedging-and-certainty-in-reading.pitfall}

  - q_num: 4
    question_type: mcq_single
    prompt: "Some researchers support the new model; others do not. Here, 'do not' stands for ____."
    options:
      - {label: A, text: "do not support the new model"}
      - {label: B, text: "do not exist"}
      - {label: C, text: "are not researchers"}
      - {label: D, text: "do not do research"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: ellipsis-and-substitution
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'do' là phép THAY THẾ (substitution) cho cụm động từ đã nêu 'support the new model'; 'not' phủ định cụm đó. Người đọc phải khôi phục lại phần bị lược."
          kp_refs:
            - {type: grammar, slug: ellipsis-and-substitution, anchor: ellipsis-and-substitution.substitution}
          microcheck:
            prompt: "'others do not' — 'do' thay cho cụm động từ nào?"
            options:
              - "support the new model"
              - "do research"
              - "exist"
            answer: "A"
        - action: confirm
          instruction_vi: "'do not' = 'do not support the new model'. Đáp án A."
      distractor_analysis:
        - option: D
          why_wrong_vi: "Hiểu 'do' theo nghĩa đen 'làm nghiên cứu' là sai — 'do' ở đây thay cho động từ đã xuất hiện phía trước ('support')."
          kp_refs:
            - {type: grammar, slug: ellipsis-and-substitution, anchor: ellipsis-and-substitution.pitfall}

  - q_num: 5
    question_type: mcq_single
    prompt: "In 'Marie Curie, the first person to win two Nobel Prizes, transformed modern physics,' the phrase between the commas ____."
    options:
      - {label: A, text: "renames and describes Marie Curie"}
      - {label: B, text: "is the main verb of the sentence"}
      - {label: C, text: "is a separate sentence"}
      - {label: D, text: "shows a contrast"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: appositives-and-parentheticals
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Cụm chêm giữa hai dấu phẩy 'the first person to win two Nobel Prizes' là ĐỒNG VỊ NGỮ (appositive) — định danh và miêu tả lại 'Marie Curie'. Có thể lược mà câu chính vẫn đủ."
          kp_refs:
            - {type: grammar, slug: appositives-and-parentheticals, anchor: appositives-and-parentheticals.function}
          microcheck:
            prompt: "Bỏ 'the first person to win two Nobel Prizes' đi, câu chính còn lại là gì?"
            options:
              - "Marie Curie transformed modern physics"
              - "câu sẽ sai ngữ pháp"
              - "câu không còn động từ"
            answer: "A"
        - action: confirm
          instruction_vi: "Đồng vị ngữ miêu tả lại chủ ngữ. Đáp án A."
      distractor_analysis:
        - option: D
          why_wrong_vi: "Đồng vị ngữ BỔ SUNG thông tin, không tạo tương phản; không có từ nối trái chiều nào ở đây."
          kp_refs:
            - {type: grammar, slug: appositives-and-parentheticals, anchor: appositives-and-parentheticals.pitfall}

  - q_num: 6
    question_type: mcq_single
    prompt: "'The experiment failed for one reason: the equipment was faulty.' The colon signals that what follows is ____."
    options:
      - {label: A, text: "an explanation of the reason"}
      - {label: B, text: "a contrasting idea"}
      - {label: C, text: "an unrelated list of items"}
      - {label: D, text: "a direct quotation"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: punctuation-as-meaning-signals
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Dấu hai chấm (:) báo hiệu phần sau GIẢI THÍCH/cụ thể hoá phần trước: 'one reason' → 'the equipment was faulty'."
          kp_refs:
            - {type: grammar, slug: punctuation-as-meaning-signals, anchor: punctuation-as-meaning-signals.colon-semicolon}
          microcheck:
            prompt: "Dấu ':' ở đây dẫn tới điều gì?"
            options:
              - "lời giải thích cho 'one reason'"
              - "một ý trái ngược"
              - "một câu hỏi"
            answer: "A"
        - action: confirm
          instruction_vi: "Dấu hai chấm mở ra lời giải thích. Đáp án A."
      distractor_analysis:
        - option: B
          why_wrong_vi: "Ý tương phản thường do 'but'/dấu gạch ngang báo hiệu; dấu hai chấm ở đây dẫn vào lời giải thích, không phải tương phản."
          kp_refs:
            - {type: grammar, slug: punctuation-as-meaning-signals, anchor: punctuation-as-meaning-signals.pitfall}

  - q_num: 7
    question_type: mcq_single
    prompt: "'The newer method is far less time-consuming than the traditional one.' This means the newer method takes ____ time."
    options:
      - {label: A, text: "less"}
      - {label: B, text: "more"}
      - {label: C, text: "the same"}
      - {label: D, text: "no"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: comparison-structures-in-reading
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'less ... than' chỉ hướng so sánh GIẢM: 'less time-consuming' = tốn ÍT thời gian hơn. 'far' chỉ nhấn mạnh mức chênh lệch, không đổi hướng."
          kp_refs:
            - {type: grammar, slug: comparison-structures-in-reading, anchor: comparison-structures-in-reading.direction}
          microcheck:
            prompt: "'far less time-consuming' nghĩa là tốn thời gian như thế nào?"
            options:
              - "ít hơn nhiều"
              - "nhiều hơn"
              - "bằng nhau"
            answer: "A"
        - action: confirm
          instruction_vi: "'less ... than' = ít hơn. Đáp án A."
      distractor_analysis:
        - option: B
          why_wrong_vi: "Chọn 'more' là đảo hướng so sánh — 'less' bị hiểu nhầm thành 'more'."
          kp_refs:
            - {type: grammar, slug: comparison-structures-in-reading, anchor: comparison-structures-in-reading.pitfall}
---

Bộ đề "Ngữ pháp Đọc hiểu — Giải mã câu" tự soạn (copyright-safe). Mỗi câu kiểm tra một cấu trúc cản trở việc giải mã câu trong bài đọc học thuật; phần chữa có stepper + micro-check ghi bằng chứng KP.
