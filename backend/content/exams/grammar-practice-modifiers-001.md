---
content_type: exam
exam_source: grammar_practice
code: AVR-GRPR-MODIFIERS-001
title: "Luyện Ngữ pháp — Modifiers (Bộ 1)"
part: decode
time_limit_minutes: 12
status: published
questions:
  - q_num: 1
    question_type: mcq_single
    prompt: "The ____ child sat quietly in the corner, watching the other kids play with toys."
    options:
      - {label: A, text: "interested"}
      - {label: B, text: "interesting"}
      - {label: C, text: "having interested"}
      - {label: D, text: "to interest"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: participial-adjectives
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Tính từ phân từ 'interested' mô tả cảm xúc của chủ ngữ (cậu bé). Cậu bé CẢMTHẤY quan tâm. Nếu dùng 'interesting', nghĩa là cậu bé LÀM CHO cái gì thú vị (sai)."
          kp_refs:
            - {type: grammar, slug: participial-adjectives, anchor: participial-adjectives.rule}
          microcheck:
            prompt: "Trong 'an interested child', tính từ 'interested' diễn tả điều gì?"
            options:
              - "cảm xúc của cậu bé"
              - "tính chất làm cho các người khác có cảm xúc"
              - "thời gian quá khứ"
            answer: "A"
        - action: confirm
          instruction_vi: "Bé CẢMTHẤY quan tâm → 'interested'. Đáp án A."
      distractor_analysis:
        - option: B
          why_wrong_vi: "'interesting' có nghĩa là cậu bé làm cho những thứ khác thú vị — đảo ngược quan hệ cảm xúc."
          kp_refs:
            - {type: grammar, slug: participial-adjectives, anchor: participial-adjectives.pitfall}

  - q_num: 2
    question_type: mcq_single
    prompt: "She found the documentary ____ and fell asleep halfway through."
    options:
      - {label: A, text: "bored"}
      - {label: B, text: "boring"}
      - {label: C, text: "boring her"}
      - {label: D, text: "to bore"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: participial-adjectives
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Tính từ phân từ 'boring' mô tả tính chất của vật (documentary) — phim đó LÀM CHO cô ấy chán. 'bored' sai vì chủ ngữ là 'documentary', không phải cô ấy."
          kp_refs:
            - {type: grammar, slug: participial-adjectives, anchor: participial-adjectives.rule}
          microcheck:
            prompt: "'She found the documentary ____' — phim làm cho cô ấy cảmthấy gì?"
            options:
              - "chán"
              - "thích thú"
              - "bối rối"
            answer: "A"
        - action: confirm
          instruction_vi: "Vật LÀM CHO cảm xúc (boring) không phải người CẢMTHẤY (bored). Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'bored' mô tả cảm xúc con người; ở đây chủ từ là 'documentary' (vật), nên phải dùng 'boring'."
          kp_refs:
            - {type: grammar, slug: participial-adjectives, anchor: participial-adjectives.pitfall}

  - q_num: 3
    question_type: mcq_single
    prompt: "She wore a ____ dress to the wedding."
    options:
      - {label: A, text: "long beautiful blue"}
      - {label: B, text: "beautiful long blue"}
      - {label: C, text: "blue long beautiful"}
      - {label: D, text: "long blue beautiful"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: order-of-adjectives
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Thứ tự tính từ chuẩn: Opinion → Size → Colour. 'beautiful' (Opinion) → 'long' (Size) → 'blue' (Colour) = 'beautiful long blue'."
          kp_refs:
            - {type: grammar, slug: order-of-adjectives, anchor: order-of-adjectives.sequence}
          microcheck:
            prompt: "Khi có Size, Colour, Opinion, thứ tự chuẩn là gì?"
            options:
              - "Size → Opinion → Colour"
              - "Opinion → Size → Colour"
              - "Size → Colour → Opinion"
            answer: "B"
        - action: confirm
          instruction_vi: "Opinion → Size → Colour → 'beautiful long blue'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'long beautiful blue' đặt Size (long) trước Opinion (beautiful) — sai; Opinion luôn đứng trước Size."
          kp_refs:
            - {type: grammar, slug: order-of-adjectives, anchor: order-of-adjectives.pitfall}

  - q_num: 4
    question_type: mcq_single
    prompt: "The art gallery displayed several ____ paintings from the Renaissance period."
    options:
      - {label: A, text: "Italian beautiful"}
      - {label: B, text: "beautiful Italian"}
      - {label: C, text: "Italian-beautiful"}
      - {label: D, text: "beautifuly Italian"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: order-of-adjectives
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Thứ tự tính từ: Opinion/Quality trước Nationality/Origin. 'Beautiful' (ý kiến) phải trước 'Italian' (quốc tịch). 'Beautiful Italian' là đúng."
          kp_refs:
            - {type: grammar, slug: order-of-adjectives, anchor: order-of-adjectives.sequence}
          microcheck:
            prompt: "Trong 'beautiful Italian paintings', tính từ nào đứng trước?"
            options:
              - "beautiful"
              - "Italian"
              - "cả hai cùng cấp"
            answer: "A"
        - action: confirm
          instruction_vi: "Opinion → Nationality. 'Beautiful Italian'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'Italian beautiful' sắp xếp sai; Nationality không đi trước Opinion."
          kp_refs:
            - {type: grammar, slug: order-of-adjectives, anchor: order-of-adjectives.pitfall}

  - q_num: 5
    question_type: mcq_single
    prompt: "The kindergarten hired a ____ teacher to lead the morning activities."
    options:
      - {label: A, text: "five year old"}
      - {label: B, text: "five-year-old"}
      - {label: C, text: "five years old"}
      - {label: D, text: "fifth-year-old"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: compound-adjectives
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Tính từ ghép chỉ tuổi đứng trước danh từ cần gạch ngang: 'five-year-old'. Nếu không gạch ngang hoặc chia 'years' sai, câu bị sai."
          kp_refs:
            - {type: grammar, slug: compound-adjectives, anchor: compound-adjectives.patterns}
          microcheck:
            prompt: "Khi nào cần dấu gạch ngang trong 'five-year-old'?"
            options:
              - "khi đứng trước danh từ"
              - "khi đứng sau 'to be'"
              - "luôn luôn"
            answer: "A"
        - action: confirm
          instruction_vi: "Tính từ ghép trước danh từ → gạch ngang. 'Five-year-old teacher'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'five year old' thiếu gạch ngang; không được công nhận là tính từ ghép hợp lệ."
          kp_refs:
            - {type: grammar, slug: compound-adjectives, anchor: compound-adjectives.pitfall}

  - q_num: 6
    question_type: mcq_single
    prompt: "The ____ scientist presented her breakthrough research at the international conference."
    options:
      - {label: A, text: "well-known"}
      - {label: B, text: "well known"}
      - {label: C, text: "well-knowing"}
      - {label: D, text: "well-know"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: compound-adjectives
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Tính từ ghép 'well-known' (nổi tiếng) khi đứng trước danh từ cần gạch ngang. 'Well-known scientist' là tính từ ghép hoàn chỉnh."
          kp_refs:
            - {type: grammar, slug: compound-adjectives, anchor: compound-adjectives.patterns}
          microcheck:
            prompt: "Cách viết đúng khi 'well-known' đứng trước danh từ?"
            options:
              - "well-known (với gạch ngang)"
              - "well known (không gạch ngang)"
              - "cả hai đều được"
            answer: "A"
        - action: confirm
          instruction_vi: "Trước danh từ: 'well-known'. Sau 'to be': 'well known'. Ở đây trước danh từ. Đáp án A."
      distractor_analysis:
        - option: B
          why_wrong_vi: "'well known' (không gạch ngang) được dùng sau 'to be' (predicate), không phải trước danh từ."
          kp_refs:
            - {type: grammar, slug: compound-adjectives, anchor: compound-adjectives.pitfall}

  - q_num: 7
    question_type: mcq_single
    prompt: "The gymnast's routine was ____ perfect; the judges awarded full marks."
    options:
      - {label: A, text: "very"}
      - {label: B, text: "absolutely"}
      - {label: C, text: "slightly"}
      - {label: D, text: "fairly"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: intensifiers-and-mitigators
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'perfect' là tính từ UNGRADABLE (tuyệt đối, không có bậc: không nói 'more perfect'). Ungradable đi với MAXIMIZER 'absolutely/utterly/completely', KHÔNG dùng intensifier gradable 'very/fairly/slightly'."
          kp_refs:
            - {type: grammar, slug: intensifiers-and-mitigators, anchor: intensifiers-and-mitigators.pitfall}
          microcheck:
            prompt: "Tính từ ungradable như 'perfect' đi với loại từ tăng cường nào?"
            options:
              - "maximizer: absolutely / utterly"
              - "intensifier gradable: very / fairly"
              - "không đi với từ nào"
            answer: "A"
        - action: confirm
          instruction_vi: "Ungradable 'perfect' + maximizer → 'absolutely perfect'. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'very perfect' sai — 'perfect' đã mang nghĩa tuyệt đối, không tăng cấp bằng 'very' (dành cho tính từ gradable)."
          kp_refs:
            - {type: grammar, slug: intensifiers-and-mitigators, anchor: intensifiers-and-mitigators.scale}

  - q_num: 8
    question_type: mcq_single
    prompt: "The recipe is ____ useful; I recommend it to all my friends."
    options:
      - {label: A, text: "extremely"}
      - {label: B, text: "slightly"}
      - {label: C, text: "absolutely"}
      - {label: D, text: "fairly"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: intensifiers-and-mitigators
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'Useful' là tính từ GRADABLE → dùng intensifier gradable (very/extremely/really). Bối cảnh mạnh ('recommend to all friends') → 'extremely useful'. KHÔNG dùng 'absolutely' (chỉ dành cho tính từ ungradable như perfect/essential)."
          kp_refs:
            - {type: grammar, slug: intensifiers-and-mitigators, anchor: intensifiers-and-mitigators.gradable}
          microcheck:
            prompt: "'Useful' là loại tính từ nào?"
            options:
              - "gradable (có thể so sánh)"
              - "ungradable (không so sánh)"
              - "verb"
            answer: "A"
        - action: confirm
          instruction_vi: "Gradable + intensifier mạnh 'extremely'. Đáp án A."
      distractor_analysis:
        - option: C
          why_wrong_vi: "'absolutely' chỉ đi với tính từ UNGRADABLE (perfect, essential, freezing); 'useful' là gradable nên 'absolutely useful' sai collocation."
          kp_refs:
            - {type: grammar, slug: intensifiers-and-mitigators, anchor: intensifiers-and-mitigators.scale}
---

Bộ đề "Luyện Ngữ pháp — Modifiers" tự soạn (copyright-safe). Mỗi câu kiểm tra một khía cạnh của tính từ (participial adjectives, thứ tự tính từ, tính từ ghép, intensifiers) trong ngữ cảnh thực tế IELTS; phần chữa có stepper + micro-check ghi bằng chứng KP.
