---
content_type: exam
exam_source: grammar_practice
code: AVR-GRPR-WRITING-001
title: "Luyện Ngữ pháp — Grammar for Writing (Bộ 1)"
part: decode
time_limit_minutes: 12
status: published
questions:
  - q_num: 1
    question_type: mcq_single
    prompt: "In Task 2, a student wrote: 'Governments should not only invest in education but also providing scholarships to low-income students.' The structure is ____."
    options:
      - {label: A, text: "parallel and correct"}
      - {label: B, text: "not parallel — should be 'invest...and provide'"}
      - {label: C, text: "correct despite the -ing form"}
      - {label: D, text: "parallel only if we add commas"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: parallel-structure
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Cấu trúc 'not only X but also Y' yêu cầu X và Y có dạng ngữ pháp GIỐNG nhau (parallel). Ở đây: 'invest' (động từ nguyên mẫu) nhưng 'providing' (V-ing) — không song song. Sửa thành 'not only invest in education but also provide scholarships'."
          kp_refs:
            - {type: grammar, slug: parallel-structure, anchor: parallel-structure.correlatives}
          microcheck:
            prompt: "Trong 'not only X but also Y', thành phần X và Y phải ____?"
            options:
              - "có dạng ngữ pháp giống nhau"
              - "bắt đầu bằng cùng một từ"
              - "có số lượng từ bằng nhau"
            answer: "A"
        - action: confirm
          instruction_vi: "Lỗi song song: 'invest' ≠ 'providing'. Sửa thành động từ nguyên mẫu ở cả hai vế. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "Cấu trúc KHÔNG song song; không thể nói 'not parallel and correct' vì điều đó mâu thuẫn."
          kp_refs:
            - {type: grammar, slug: parallel-structure, anchor: parallel-structure.pitfall}
        - option: C
          why_wrong_vi: "V-ing ở vế thứ hai phá vỡ song song; không có ngoại lệ cho correlative conjunctions."
          kp_refs:
            - {type: grammar, slug: parallel-structure, anchor: parallel-structure.correlatives}

  - q_num: 2
    question_type: mcq_single
    prompt: "For an IELTS Task 2 essay, which sentence demonstrates a COMPLEX structure suitable for Band 7+?"
    options:
      - {label: A, text: "Technology is good. Technology helps people. People use it every day."}
      - {label: B, text: "Although technology has revolutionized many aspects of daily life, it simultaneously creates new social challenges that require careful policy intervention."}
      - {label: C, text: "I think technology is helpful because I use my phone."}
      - {label: D, text: "Technology is very important for our modern world."}
    answer: "B"
    kp_focus: grammar
    grammar_slug: complex-sentences-for-task2
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Câu B kết hợp mệnh đề nhượng bộ ('Although...') + mệnh đề phụ thuộc ('that require...') vào cấu trúc chính, tạo tính phức tạp và độc lập cần thiết cho Task 2. Câu A là danh sách đơn giản; C và D thiếu mối liên hệ phức tạp."
          kp_refs:
            - {type: grammar, slug: complex-sentences-for-task2, anchor: complex-sentences-for-task2.types}
          microcheck:
            prompt: "Câu 'Although...simultaneously creates...that require' sử dụng loại cấu trúc nào để thể hiện lập luận Task 2?"
            options:
              - "mệnh đề nhượng bộ + mệnh đề phụ thuộc quan hệ"
              - "hai mệnh đề độc lập nối bằng 'and'"
              - "câu đơn với một danh từ"
            answer: "A"
        - action: confirm
          instruction_vi: "Cấu trúc phức tạp (complex sentences) với liên từ phụ thuộc và mệnh đề quan hệ giúp thể hiện mối nhân quả, thương lượng — đặc trưng Task 2 Band 7+. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "Ba câu đơn cạnh nhau (parataxis) không cho thấy logic phức tạp; sử dụng từ từ ('technology', 'people') lặp lại thay vì tổng hợp ý."
          kp_refs:
            - {type: grammar, slug: complex-sentences-for-task2, anchor: complex-sentences-for-task2.pitfall}
        - option: C
          why_wrong_vi: "Câu đơn 'I think X because Y' không đủ mức độ phức tạp; thiếu các mệnh đề phụ thuộc hay mệnh đề chêm để phát triển luận điểm."
          kp_refs:
            - {type: grammar, slug: complex-sentences-for-task2, anchor: complex-sentences-for-task2.control}

  - q_num: 3
    question_type: mcq_single
    prompt: "In an IELTS essay, a writer used a comma between two independent clauses: 'Education is a fundamental right, all citizens deserve access to quality schools.' This error is called ____."
    options:
      - {label: A, text: "comma splice (mệnh đề nối sai)"}
      - {label: B, text: "semicolon error"}
      - {label: C, text: "fragment"}
      - {label: D, text: "run-on sentence (nối riêng lẻ)"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: punctuation-for-writing
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Hai mệnh đề độc lập ('Education is...' và 'all citizens deserve...') không được nối bằng dấu phẩy đơn độc. Đây là comma splice (mệnh đề nối sai). Cách sửa: dùng dấu chấm phẩy, liên từ, hoặc tách thành hai câu."
          kp_refs:
            - {type: grammar, slug: punctuation-for-writing, anchor: punctuation-for-writing.splice}
          microcheck:
            prompt: "Comma splice xảy ra khi ____?"
            options:
              - "nối hai mệnh đề độc lập bằng dấu phẩy đơn"
              - "quên dấu phẩy giữa danh sách"
              - "dùng dấu phẩy trước 'however'"
            answer: "A"
        - action: confirm
          instruction_vi: "Lỗi này gọi là comma splice. Đáp án A."
      distractor_analysis:
        - option: B
          why_wrong_vi: "Semicolon error là lỗi dùng dấu chấm phẩy KHÔNG phù hợp; ở đây vấn đề là dùng sai dấu (dấu phẩy thay vì dấu chấm phẩy)."
          kp_refs:
            - {type: grammar, slug: punctuation-for-writing, anchor: punctuation-for-writing.pitfall}
        - option: D
          why_wrong_vi: "'Run-on sentence' thường chỉ nối mà không dấu gì; ở đây có dấu phẩy nên được gọi là comma splice cụ thể hơn."
          kp_refs:
            - {type: grammar, slug: punctuation-for-writing, anchor: punctuation-for-writing.splice}

  - q_num: 4
    question_type: mcq_single
    prompt: "Read these two sentences: (1) 'Renewable energy reduces carbon emissions.' (2) 'It creates new jobs in the energy sector.' How would a writer use cohesion devices to link them in a Task 2 essay?"
    options:
      - {label: A, text: "Moreover / Furthermore, renewable energy creates new jobs..."}
      - {label: B, text: "Renewable energy reduces emissions and it creates jobs."}
      - {label: C, text: "Renewable energy is great. It creates jobs."}
      - {label: D, text: "Renewable energy creates jobs because it reduces emissions."}
    answer: "A"
    kp_focus: grammar
    grammar_slug: cohesion-devices-in-writing
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Trong Task 2, khi hai ý cùng HƯỚNG (cùng hỗ trợ một lập luận), dùng linking adverbs như 'Moreover'/'Furthermore' để thể hiện mối liên kết LOGIC. Câu A sử dụng công cụ liên kết rõ ràng."
          kp_refs:
            - {type: grammar, slug: cohesion-devices-in-writing, anchor: cohesion-devices-in-writing.tools}
          microcheck:
            prompt: "'Moreover' trong ngữ cảnh này có tác dụng gì?"
            options:
              - "thêm một lý do hỗ trợ ý chính"
              - "so sánh hai ý khác nhau"
              - "chỉ ra nguyên nhân của câu trước"
            answer: "A"
        - action: confirm
          instruction_vi: "Liên từ adding (Moreover, Furthermore) giúp liên kết các ý bổ sung trong bài luận Task 2. Đáp án A."
      distractor_analysis:
        - option: B
          why_wrong_vi: "Nối 'and it' là cấu trúc bề mặt; không rõ mối quan hệ logic giữa hai ý. 'Moreover' tường minh hơn."
          kp_refs:
            - {type: grammar, slug: cohesion-devices-in-writing, anchor: cohesion-devices-in-writing.pitfall}
        - option: D
          why_wrong_vi: "'because' sai logic: việc tạo việc làm là hệ quả THÊM, chứ không NGUYÊN NHÂN của việc giảm phát thải."
          kp_refs:
            - {type: grammar, slug: cohesion-devices-in-writing, anchor: cohesion-devices-in-writing.tools}

  - q_num: 5
    question_type: mcq_single
    prompt: "In an essay, a writer included: 'Many developing nations, which face severe water scarcity, have implemented new irrigation technologies.' The relative clause here is ____."
    options:
      - {label: A, text: "defining (xác định) — không dấu phẩy thích hợp hơn"}
      - {label: B, text: "non-defining (mô tả thêm) — dấu phẩy là đúng"}
      - {label: C, text: "restrictive — nên bỏ dấu phẩy"}
      - {label: D, text: "incorrect because 'which' chỉ dùng cho non-defining"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: relative-clauses-in-writing
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'which face severe water scarcity' là mệnh đề non-defining (mô tả thêm thông tin về 'developing nations' đã xác định). Non-defining clauses luôn dùng dấu phẩy và 'which' (không 'that'). Nếu bỏ dấu phẩy, nghĩa thay đổi thành 'chỉ những quốc gia thiếu nước'."
          kp_refs:
            - {type: grammar, slug: relative-clauses-in-writing, anchor: relative-clauses-in-writing.comma-rule}
          microcheck:
            prompt: "Nếu bỏ 'which face severe water scarcity' khỏi câu, ý chính 'Many developing nations have implemented technologies' có bị mất thông tin quan trọng không?"
            options:
              - "Không — thông tin đó là thêm vào chứ không cần thiết"
              - "Có — ý chính sẽ bị thay đổi"
              - "Tùy ngữ cảnh"
            answer: "A"
        - action: confirm
          instruction_vi: "Non-defining relative clause mô tả thêm, không xác định. Dấu phẩy + 'which' là đúng. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "Nếu là defining, 'many developing nations THAT face scarcity' sẽ hạn chế đối tượng — chỉ những quốc gia thiếu nước. Câu gốc không hạn chế như vậy."
          kp_refs:
            - {type: grammar, slug: relative-clauses-in-writing, anchor: relative-clauses-in-writing.comma-rule}
        - option: C
          why_wrong_vi: "Restrictive không cần dấu phẩy, nhưng câu này LÀ non-defining (không hạn chế)."
          kp_refs:
            - {type: grammar, slug: relative-clauses-in-writing, anchor: relative-clauses-in-writing.pitfall}

  - q_num: 6
    question_type: mcq_single
    prompt: "Which sentence is appropriate for formal IELTS writing?"
    options:
      - {label: A, text: "Governments can't ignore climate change 'cause it's a threat to everyone."}
      - {label: B, text: "Governments cannot ignore climate change because it constitutes a threat to society."}
      - {label: C, text: "Governments gotta take climate change seriously or else bad things happen."}
      - {label: D, text: "Climate change is like really important for governments to deal with."}
    answer: "B"
    kp_focus: grammar
    grammar_slug: avoiding-informal-grammar
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Viết học thuật từ chối các dấu hiệu informal như: contractions ('can't', 'it's' → 'cannot', 'it is'), slang ('gotta', 'cause'), vague intensifiers ('like', 'really'), colloquial phrasings ('bad things'). Câu B dùng toàn cấu trúc formal."
          kp_refs:
            - {type: grammar, slug: avoiding-informal-grammar, anchor: avoiding-informal-grammar.signals}
          microcheck:
            prompt: "Contraction 'can't' trong viết học thuật nên thay thành ____?"
            options:
              - "cannot"
              - "can not"
              - "could not"
            answer: "A"
        - action: confirm
          instruction_vi: "Loại bỏ contractions, slang, và informal tone. Dùng 'cannot', 'constitutes', 'threat to society' thay vì informal phrases. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "Chứa contraction 'can't' và slang 'cause'; không phù hợp formal writing."
          kp_refs:
            - {type: grammar, slug: avoiding-informal-grammar, anchor: avoiding-informal-grammar.swaps}
        - option: C
          why_wrong_vi: "'gotta' (slang for 'got to') + 'or else' (colloquial) + vague 'bad things' không phù hợp học thuật."
          kp_refs:
            - {type: grammar, slug: avoiding-informal-grammar, anchor: avoiding-informal-grammar.signals}

  - q_num: 7
    question_type: mcq_single
    prompt: "In a Task 2 essay, a student wrote: 'People should invest in education not only because it improves individual prospects but also benefits society as a whole.' The structure is ____."
    options:
      - {label: A, text: "not parallel — 'not only' is followed by a 'because' clause but 'but also' by a bare verb"}
      - {label: B, text: "fully parallel and correct"}
      - {label: C, text: "parallel but too informal for Task 2"}
      - {label: D, text: "wrong because 'not only' cannot introduce a reason"}
    answer: "A"
    kp_focus: grammar
    grammar_slug: parallel-structure
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "'not only ... but also' phải nối HAI thành phần CÙNG loại. Ở đây 'not only' đi với mệnh đề 'because it improves...', còn 'but also' đi với động từ trần 'benefits...' → hai vế KHÔNG cùng dạng nên KHÔNG song song. Sửa: 'not only because it improves... but also because it benefits...' hoặc 'because it not only improves... but also benefits...'."
          kp_refs:
            - {type: grammar, slug: parallel-structure, anchor: parallel-structure.correlatives}
          microcheck:
            prompt: "Vì sao câu này KHÔNG song song?"
            options:
              - "'not only' theo sau là mệnh đề 'because', còn 'but also' theo sau là động từ trần"
              - "vì trong câu có từ 'also'"
              - "vì 'improves' và 'benefits' khác nghĩa"
            answer: "A"
        - action: confirm
          instruction_vi: "Hai vế của 'not only...but also' khác cấu trúc (mệnh đề 'because' vs động từ trần) → lỗi thiếu song song. Đáp án A."
      distractor_analysis:
        - option: B
          why_wrong_vi: "Câu KHÔNG song song: 'not only + because-clause' không cân với 'but also + bare verb'."
          kp_refs:
            - {type: grammar, slug: parallel-structure, anchor: parallel-structure.pitfall}
        - option: D
          why_wrong_vi: "'not only' hoàn toàn có thể mở đầu một lý do; lỗi nằm ở sự thiếu song song giữa hai vế, không phải vị trí 'not only'."
          kp_refs:
            - {type: grammar, slug: parallel-structure, anchor: parallel-structure.correlatives}

  - q_num: 8
    question_type: mcq_single
    prompt: "For a complex Task 2 argument, which linking phrase best bridges a concession and a counter-argument?"
    options:
      - {label: A, text: "Firstly"}
      - {label: B, text: "Although some argue X, the evidence suggests Y is more compelling."}
      - {label: C, text: "For example"}
      - {label: D, text: "In addition to that"}
    answer: "B"
    kp_focus: grammar
    grammar_slug: complex-sentences-for-task2
    solution:
      solution_steps:
        - action: parse_syntax
          instruction_vi: "Cấu trúc 'Although...the evidence suggests' (concession + counter-argument) là cách tiêu chuẩn để thể hiện sự thương lượng và lập luận chống lại một quan điểm khác. Mệnh đề nhượng bộ (Although) + mệnh đề chính phản bác là nền tảng lập luận Task 2 nâng cao."
          kp_refs:
            - {type: grammar, slug: complex-sentences-for-task2, anchor: complex-sentences-for-task2.types}
          microcheck:
            prompt: "'Although some argue X, the evidence suggests Y' — phần 'Although' có tác dụng gì?"
            options:
              - "công nhận quan điểm khác trước khi phản bác"
              - "đưa ra ví dụ"
              - "liệt kê các điểm đầu tiên"
            answer: "A"
        - action: confirm
          instruction_vi: "Concession + counter-argument dùng cấu trúc 'Although...the evidence/however' để thể hiện sự thương lượng logic. Đáp án B."
      distractor_analysis:
        - option: A
          why_wrong_vi: "'Firstly' là linking adverb để bắt đầu danh sách, không để thương lượng hay phản bác."
          kp_refs:
            - {type: grammar, slug: complex-sentences-for-task2, anchor: complex-sentences-for-task2.pitfall}
        - option: D
          why_wrong_vi: "'In addition' là để bổ sung ý, không phải để phản bác hay thương lượng."
          kp_refs:
            - {type: grammar, slug: complex-sentences-for-task2, anchor: complex-sentences-for-task2.control}
---

Bộ đề "Luyện Ngữ pháp — Grammar for Writing" tự soạn (copyright-safe). Mỗi câu kiểm tra một cấu trúc cần thiết để viết Task 2 IELTS: song song, câu phức, dấu câu, liên kết logic, mệnh đề quan hệ, và từ ngữ học thuật. Phần chữa có stepper + micro-check với KP refs chuẩn.
