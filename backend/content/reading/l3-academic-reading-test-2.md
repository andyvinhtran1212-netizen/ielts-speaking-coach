---
# Sprint 20.14b — AVR-READ-002 functional sample.
#
# Purpose: exercise the 7 Phase B reading question types unlocked in
# Sprint 20.14b (mcq_multi, matching_information, matching_features,
# matching_sentence_endings, summary_completion-with-word-bank,
# flow_chart_completion, diagram_label_completion) end-to-end:
# importer validation → grader → §2A frontend renderers.
#
# The passages + questions are FUNCTIONAL, not production-grade IELTS
# content. Andy's `Production_Standards.md` pipeline supplies the
# proper passages later; this seed exists so the new renderers have a
# real test_id to dogfood against.
#
# Distribution (40 questions across 3 passages):
#   Passage 1 (Qs 1–13):  matching_information ×3, mcq_multi ×4,
#                         yes_no_not_given ×6
#   Passage 2 (Qs 14–26): matching_features ×5, matching_sentence_endings ×5,
#                         short_answer ×3
#   Passage 3 (Qs 27–40): summary_completion (word-bank) ×6,
#                         flow_chart_completion ×5, diagram_label_completion ×3

content_type: reading_full_test
test_id: AVR-READ-002
title: "Academic Reading — Test 2 (Phase B types sample)"
module: academic
time_limit_minutes: 60
passage_count: 3
total_questions: 40
band_target: 7.0
published: true
passages:
  # ── Passage 1 — Qs 1–13 ─────────────────────────────────────────
  - passage_order: 1
    slug: l3-t2-p1-deep-sea-mining
    title: "Deep-Sea Mining: Promise and Risk"
    word_count: 230
    topic_tags: [environment, technology]
    body_markdown: |
      A The deep ocean covers more than half of the planet, yet less than
      five percent of its floor has been mapped in detail. Below 3,000
      metres lies a quiet, dark world that until recently held little
      commercial interest. That is now changing fast.

      B What has changed is the cost of the metals used in batteries.
      Cobalt, nickel and manganese have risen sharply in price as
      electric vehicle production has grown. Nodules rich in these
      metals carpet large areas of the abyssal plain, and a number of
      companies argue that mining them would be cheaper and less
      damaging than opening new land mines.

      C Critics disagree. Biologists who have spent decades studying
      these depths point out that the nodules themselves are habitat:
      delicate communities of sponges, anemones and worms grow on them
      and could not survive their removal. Sediment plumes raised by
      the mining machines would drift for hundreds of kilometres and
      could smother filter-feeders far beyond the mining site itself.

      D Regulators have moved slowly. The International Seabed Authority
      has been drafting rules for over a decade, and a moratorium until
      2030 is now widely supported. Industry groups argue that delay
      simply hands the metals market to terrestrial miners with worse
      environmental records. The debate is unlikely to be settled soon.
    questions:
      # Qs 1–3 — matching_information (pick paragraph letter A–D)
      - q_num: 1
        question_type: matching_information
        prompt: "a comparison between two sources of metals"
        solution:
          solution_steps:
            - action: locate
              instruction_vi: "Đề yêu cầu tìm đoạn có SỰ SO SÁNH giữa hai nguồn kim loại — quét từng đoạn tìm tín hiệu đối chiếu (than/quặng trên cạn vs đáy biển)."
              kp_refs:
                - {type: skill, slug: scanning}
            - action: parse_syntax
              instruction_vi: "Nhận diện cấu trúc so sánh (than… so với… / nhiều hơn / thay vì) để chắc đoạn đang ĐỐI CHIẾU hai nguồn, không chỉ nhắc tới một nguồn."
              kp_refs:
                - {type: grammar, slug: comparison, anchor: comparison.overview}
              microcheck:
                prompt: "Dấu hiệu nào cho biết một đoạn đang SO SÁNH hai nguồn kim loại?"
                options:
                  - "cấu trúc đối chiếu: 'compared with / more than / instead of'"
                  - "chỉ cần nhắc tên một nguồn là đủ"
                  - "có nhiều con số trong đoạn"
                answer: "A"
            - action: confirm
              instruction_vi: "Đoạn B là nơi so sánh hai nguồn kim loại → đáp án B."
        template: { paragraph_labels: [A, B, C, D] }
        answer: "B"
        skill_tag: scanning
        explanation: "Paragraph B compares ocean nodule mining to opening new land mines."
      - q_num: 2
        question_type: matching_information
        prompt: "a mention of how poorly the deep ocean has been surveyed"
        template: { paragraph_labels: [A, B, C, D] }
        answer: "A"
        skill_tag: scanning
        solution:
          solution_steps:
          - action: decode_vocab
            instruction_vi: 'Phân tích câu hỏi: ''a mention of how poorly the deep ocean has been surveyed'' yêu cầu tìm đoạn văn đề cập đến việc đại dương sâu đã được khảo sát/lập bản đồ một cách sơ sài, kém cỏi như thế nào.'
          - action: locate
            instruction_vi: 'Rà soát các đoạn văn để tìm thông tin liên quan đến việc khảo sát. Đoạn A có câu: ''less than five percent of its floor has been mapped in detail''.'
          - action: confirm
            instruction_vi: Cụm từ 'less than five percent ... has been mapped in detail' (chưa đến năm phần trăm ... được lập bản đồ chi tiết) trực tiếp cho thấy mức độ khảo sát rất kém ('poorly surveyed'). Do đó, đoạn A chứa thông tin cần tìm.
        explanation: "Paragraph A: 'less than five percent of its floor has been mapped'."
      - q_num: 3
        question_type: matching_information
        prompt: "a description of organisms that would be directly destroyed"
        template: { paragraph_labels: [A, B, C, D] }
        answer: "C"
        skill_tag: scanning
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Phân tích câu hỏi "a description of organisms that would be directly destroyed" (mô tả về các sinh vật sẽ bị phá hủy trực tiếp). Ta cần tìm một đoạn văn mô tả cụ thể tên các loài sinh vật và cách chúng bị hủy diệt một cách trực tiếp bởi hoạt động khai thác.
          - action: confirm
            instruction_vi: 'Đọc lướt các đoạn, ta thấy đoạn C chứa thông tin này. Đoạn văn liệt kê tên các sinh vật: "delicate communities of sponges, anemones and worms" (những quần xã mỏng manh của bọt biển, hải quỳ và giun). Nó cũng giải thích cách chúng bị phá hủy trực tiếp: chúng "grow on them" (sống trên các khối quặng) và "could not survive their removal" (không thể sống sót nếu các khối quặng này bị loại bỏ). Đây chính là sự phá hủy trực tiếp được mô tả trong câu hỏi.'
        explanation: "Paragraph C: 'sponges, anemones and worms grow on them and could not survive'."
      # Qs 4–7 — mcq_multi (Choose TWO from A–E)
      - q_num: 4
        question_type: mcq_multi
        prompt: "Which TWO arguments are made in favour of deep-sea mining?"
        options:
          - { label: A, text: "It would reduce battery prices for consumers." }
          - { label: B, text: "It would be cheaper than opening new land mines." }
          - { label: C, text: "It would be less environmentally damaging than land mines." }
          - { label: D, text: "It would create well-paid jobs in coastal nations." }
          - { label: E, text: "It would diversify the global supply of metals." }
        template: { choose: 2 }
        answer: [B, C]
        alternatives: []
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc câu hỏi để xác định từ khoá: "arguments in favour" (lập luận ủng hộ). Sau đó, tìm trong đoạn văn phần trình bày quan điểm của những người ủng hộ khai thác biển sâu. Đoạn B có cụm "a number of companies argue that...", đây chính là nơi chứa các lập luận cần tìm.'
          - action: confirm
            instruction_vi: 'Trong câu của Đoạn B, tìm thấy lập luận đầu tiên: "...mining them would be cheaper...than opening new land mines". Lập luận này khớp hoàn toàn với phương án B.'
          - action: confirm
            instruction_vi: 'Cũng trong câu đó của Đoạn B, tìm thấy lập luận thứ hai: "...and less damaging than opening new land mines". Lập luận này tương ứng chính xác với phương án C.'
          distractor_analysis:
          - option: A
            why_wrong_vi: Đoạn B chỉ nói rằng giá của các kim loại như cobalt, nickel đã "risen sharply in price" (tăng mạnh về giá). Đoạn văn không hề đề cập đến việc khai thác dưới biển sâu sẽ làm giảm giá pin cho người tiêu dùng.
          - option: D
            why_wrong_vi: Toàn bộ đoạn văn không chứa bất kỳ thông tin nào về việc tạo ra "well-paid jobs" (việc làm lương cao) hay lợi ích cho "coastal nations" (các quốc gia ven biển).
          - option: E
            why_wrong_vi: Đoạn văn không đề cập đến việc "diversify the global supply of metals" (đa dạng hóa nguồn cung kim loại toàn cầu). Lập luận của các công ty chỉ tập trung vào việc so sánh chi phí và tác động môi trường với khai thác trên đất liền.
        explanation: "Paragraph B states both: 'cheaper and less damaging than opening new land mines'."
      - q_num: 5
        question_type: mcq_multi
        prompt: "Which TWO concerns do critics of deep-sea mining raise?"
        options:
          - { label: A, text: "The nodules are themselves a living habitat." }
          - { label: B, text: "Sediment plumes can travel far beyond the mining site." }
          - { label: C, text: "Mining vessels release excessive carbon dioxide." }
          - { label: D, text: "Mining areas are claimed by multiple countries." }
          - { label: E, text: "Mined metals are no cheaper than recycled metals." }
        template: { choose: 2 }
        answer: [A, B]
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Xác định vị trí thông tin trong bài đọc. Câu hỏi yêu cầu tìm hai mối quan ngại của "critics" (những người chỉ trích). Đoạn C bắt đầu bằng "Critics disagree", cho thấy đây là đoạn chứa câu trả lời.
          - action: confirm
            instruction_vi: 'Đối chiếu mối quan ngại thứ nhất. Đoạn C nêu rõ: "the nodules themselves are habitat" (bản thân các khối quặng là môi trường sống). Điều này khớp chính xác với phương án A.'
          - action: confirm
            instruction_vi: 'Đối chiếu mối quan ngại thứ hai. Đoạn C tiếp tục mô tả: "Sediment plumes raised by the mining machines would drift for hundreds of kilometres and could smother filter-feeders far beyond the mining site itself" (Các đám bụi trầm tích... sẽ trôi đi hàng trăm km... vượt xa khu vực khai thác). Điều này khớp với nội dung của phương án B.'
          distractor_analysis:
          - option: C
            why_wrong_vi: Đoạn văn không đề cập đến việc tàu khai thác thải ra khí carbon dioxide. Các mối lo ngại về môi trường được nêu là phá hủy môi trường sống và các đám bụi trầm tích, không phải khí thải.
          - option: D
            why_wrong_vi: Đoạn văn có nhắc đến "International Seabed Authority" (Cơ quan Quản lý Đáy biển Quốc tế) nhưng không hề nói rằng các khu vực khai thác bị nhiều quốc gia tranh chấp hay tuyên bố chủ quyền.
          - option: E
            why_wrong_vi: Đoạn văn so sánh chi phí khai thác dưới biển sâu với "opening new land mines" (mở các mỏ mới trên đất liền), chứ không so sánh với kim loại tái chế. Chủ đề tái chế không được đề cập.
        explanation: "Paragraph C raises both habitat loss and far-travelling sediment plumes."
      - q_num: 6
        question_type: mcq_multi
        prompt: "Which TWO metals are listed as drivers of new commercial interest?"
        options:
          - { label: A, text: "iron" }
          - { label: B, text: "cobalt" }
          - { label: C, text: "lithium" }
          - { label: D, text: "nickel" }
          - { label: E, text: "copper" }
        template: { choose: 2 }
        answer: [B, D]
        skill_tag: scanning
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc lướt đoạn văn để tìm từ khóa "metals" (kim loại) và "commercial interest" (mối quan tâm thương mại). Đoạn B nói về sự thay đổi này: ''What has changed is the cost of the metals used in batteries.'''
          - action: confirm
            instruction_vi: 'Xác định các kim loại cụ thể được liệt kê trong câu tiếp theo. Đoạn văn nêu rõ: ''Cobalt, nickel and manganese have risen sharply in price...''. Đối chiếu danh sách này với các phương án, ta thấy ''cobalt'' và ''nickel'' là hai kim loại được nhắc đến.'
          distractor_analysis:
          - option: A
            why_wrong_vi: Phương án này sai vì 'iron' (sắt) không hề được nhắc đến trong danh sách các kim loại mà đoạn văn đề cập.
          - option: C
            why_wrong_vi: Phương án này sai vì 'lithium' không xuất hiện trong đoạn văn. Đoạn văn chỉ liệt kê 'Cobalt, nickel and manganese' là các kim loại có giá tăng cao.
          - option: E
            why_wrong_vi: Phương án này sai vì 'copper' (đồng) không có trong danh sách các kim loại được đề cập trong bài đọc.
        explanation: "Paragraph B lists cobalt, nickel and manganese — answer requires any two of these."
        alternatives: []
      - q_num: 7
        question_type: mcq_multi
        prompt: "Which TWO statements about regulators are correct?"
        options:
          - { label: A, text: "The International Seabed Authority has finalised its rules." }
          - { label: B, text: "A moratorium until 2030 has support." }
          - { label: C, text: "Drafting rules has taken over a decade." }
          - { label: D, text: "Most coastal nations oppose any moratorium." }
          - { label: E, text: "The debate is expected to be settled this year." }
        template: { choose: 2 }
        answer: [B, C]
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Xác định từ khóa trong câu hỏi là 'regulators' (các nhà quản lý). Quét nhanh đoạn văn và tìm thấy thông tin liên quan tập trung hoàn toàn ở đoạn D, bắt đầu bằng câu 'Regulators have moved slowly'.
          - action: confirm
            instruction_vi: Kiểm tra phương án C. Câu trong bài 'The International Seabed Authority has been drafting rules for over a decade' (Cơ quan Quản lý Đáy biển Quốc tế đã soạn thảo các quy tắc trong hơn một thập kỷ) hoàn toàn trùng khớp với nội dung 'Drafting rules has taken over a decade'. Do đó, C đúng.
          - action: confirm
            instruction_vi: Kiểm tra phương án B. Câu trong bài '...and a moratorium until 2030 is now widely supported' (...và một lệnh cấm tạm thời đến năm 2030 hiện đang được ủng hộ rộng rãi) khẳng định rằng lệnh cấm này 'has support' (có sự ủng hộ). Do đó, B đúng.
          distractor_analysis:
          - option: A
            why_wrong_vi: Đoạn văn dùng động từ 'has been drafting' (vẫn đang soạn thảo), cho thấy quá trình này chưa kết thúc. Do đó, việc nói rằng các quy tắc đã được 'finalised' (hoàn tất) là sai.
          - option: D
            why_wrong_vi: Đoạn văn không hề đề cập đến 'coastal nations' (các quốc gia ven biển) hay quan điểm của họ. Thông tin này không được đưa ra trong bài.
          - option: E
            why_wrong_vi: Đoạn văn kết luận rằng 'The debate is unlikely to be settled soon' (Cuộc tranh luận không có khả năng được giải quyết sớm), điều này mâu thuẫn trực tiếp với phương án E là 'expected to be settled this year' (dự kiến được giải quyết trong năm nay).
        explanation: "Paragraph D: '…drafting rules for over a decade, and a moratorium until 2030 is now widely supported'."
      # Qs 8–13 — yes_no_not_given (served type filler)
      - q_num: 8
        question_type: yes_no_not_given
        prompt: "The writer believes that deep-sea mining will inevitably proceed."
        answer: "NOT GIVEN"
        skill_tag: writer_view_TFNG
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Tìm trong bài đọc các cụm từ thể hiện quan điểm cá nhân của tác giả ('I think', 'I believe',...) hoặc những từ ngữ cho thấy sự chắc chắn về tương lai.
          - action: infer
            instruction_vi: 'Bài văn chỉ trình bày hai luồng quan điểm đối lập: các công ty ủng hộ (đoạn B) và các nhà phê bình/sinh vật học phản đối (đoạn C).'
          - action: confirm
            instruction_vi: Câu cuối cùng của tác giả, 'The debate is unlikely to be settled soon' (Cuộc tranh cãi này không có khả năng sớm được giải quyết), cho thấy một tương lai không chắc chắn, chứ không hề khẳng định rằng việc khai thác là 'không thể tránh khỏi' (inevitably). Do đó, không có thông tin nào cho biết tác giả tin vào điều này.
          distractor_analysis:
          - option: 'YES'
            why_wrong_vi: Lựa chọn này sai vì bài viết không chỉ đưa ra lý do ủng hộ việc khai thác mà còn trình bày rất rõ các lập luận phản đối mạnh mẽ từ các nhà sinh vật học (đoạn C) và sự chậm trễ về mặt pháp lý (đoạn D). Tác giả không đứng về phía nào và kết luận rằng cuộc tranh luận vẫn chưa ngã ngũ.
          - option: 'NO'
            why_wrong_vi: Lựa chọn này sai vì mặc dù có nhiều ý kiến phản đối và lệnh cấm tạm thời, tác giả không hề nói rằng việc khai thác sẽ không bao giờ xảy ra. Câu 'The debate is unlikely to be settled soon' chỉ có nghĩa là vấn đề còn đang được tranh cãi, chứ không phải là đã bị ngăn chặn hoàn toàn.
        explanation: "The writer reports the debate but does not predict the outcome."
      - q_num: 9
        question_type: yes_no_not_given
        prompt: "Industry groups suggest that delay favours land miners with worse records."
        answer: "YES"
        skill_tag: writer_view_TFNG
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Xác định vị trí thông tin về quan điểm của 'Industry groups' (các nhóm ngành công nghiệp) liên quan đến sự 'delay' (trì hoãn). Thông tin này nằm ở câu cuối của đoạn D.
          - action: confirm
            instruction_vi: 'Đối chiếu câu hỏi với câu trong bài: ''Industry groups argue that delay simply hands the metals market to terrestrial miners with worse environmental records.'' Ta thấy: ''suggest'' tương đương với ''argue'' (lập luận); ''delay'' khớp với ''delay''; ''favours'' (tạo lợi thế cho) được diễn giải bằng ''hands the metals market to'' (giao thị trường kim loại cho); ''land miners'' là ''terrestrial miners''; và ''worse records'' là ''worse environmental records''. Thông tin hoàn toàn trùng khớp.'
          distractor_analysis:
          - option: 'NO'
            why_wrong_vi: Phương án 'NO' sai vì đoạn văn không hề đưa ra thông tin trái ngược. Ngược lại, đoạn D trực tiếp khẳng định rằng các nhóm ngành công nghiệp lập luận rằng sự trì hoãn sẽ tạo lợi thế cho các công ty khai thác trên cạn có hồ sơ môi trường tệ hơn.
          - option: NOT GIVEN
            why_wrong_vi: Phương án 'NOT GIVEN' sai vì thông tin để trả lời câu hỏi có tồn tại một cách rõ ràng và trực tiếp trong đoạn văn. Câu cuối đoạn D đã nêu chính xác quan điểm của các nhóm ngành công nghiệp về vấn đề này.
        explanation: "Paragraph D states this directly."
      - q_num: 10
        question_type: yes_no_not_given
        prompt: "All companies interested in deep-sea mining are based in Europe."
        answer: "NOT GIVEN"
        skill_tag: writer_view_TFNG
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Tìm trong đoạn văn thông tin về các công ty quan tâm đến việc khai thác biển sâu. Đoạn B đề cập đến "a number of companies" (một số công ty).
          - action: confirm
            instruction_vi: Kiểm tra xem vị trí của các công ty này có được nêu ra không. Cụm từ "a number of companies" chỉ nói về số lượng chứ không hề đề cập đến việc họ có trụ sở ở Châu Âu hay bất kỳ nơi nào khác. Toàn bộ đoạn văn không chứa thông tin về vị trí địa lý của các công ty này.
          - action: infer
            instruction_vi: Vì đoạn văn không xác nhận cũng không phủ nhận việc tất cả các công ty có trụ sở tại Châu Âu, nên không có đủ thông tin để trả lời YES hoặc NO. Do đó, đáp án là NOT GIVEN.
          distractor_analysis:
          - option: 'YES'
            why_wrong_vi: Để chọn YES, đoạn văn phải khẳng định rõ ràng rằng TẤT CẢ các công ty quan tâm đến việc khai thác biển sâu đều có trụ sở tại Châu Âu. Đoạn văn không hề cung cấp thông tin này.
          - option: 'NO'
            why_wrong_vi: Để chọn NO, đoạn văn phải đưa ra thông tin trái ngược, ví dụ như đề cập đến một công ty có trụ sở ở châu lục khác, hoặc nói rằng "không phải tất cả các công ty đều ở Châu Âu". Đoạn văn hoàn toàn không đề cập đến vị trí của bất kỳ công ty nào, vì vậy không thể phủ định câu hỏi.
        explanation: "Company nationality is not discussed."
      - q_num: 11
        question_type: yes_no_not_given
        prompt: "The nodule communities can regrow within a few months after mining."
        answer: "NO"
        skill_tag: writer_view_TFNG
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Xác định vị trí thông tin về số phận của các cộng đồng sinh vật trên khối kết (nodule communities) sau khi khai thác. Đoạn C đề cập đến các nhà sinh vật học và quan điểm của họ về vấn đề này.
          - action: confirm
            instruction_vi: 'Phân tích câu trong đoạn C: ''delicate communities of sponges, anemones and worms grow on them and could not survive their removal''. Câu này khẳng định các cộng đồng sinh vật ''không thể sống sót sau khi bị loại bỏ'' (removal = mining).'
          - action: infer
            instruction_vi: So sánh thông tin trong bài với câu hỏi. Câu hỏi cho rằng các cộng đồng có thể 'mọc lại trong vài tháng' (regrow within a few months). Đoạn văn lại nói chúng 'không thể sống sót' (could not survive). Nếu không thể sống sót, chúng chắc chắn không thể mọc lại. Do đó, thông tin trong bài mâu thuẫn trực tiếp với câu hỏi.
          distractor_analysis:
          - option: 'YES'
            why_wrong_vi: Phương án này sai vì đoạn văn khẳng định điều ngược lại. Đoạn C nói rằng các cộng đồng sinh vật này 'could not survive their removal' (không thể sống sót sau khi bị loại bỏ), chứ không phải là có thể mọc lại.
          - option: NOT GIVEN
            why_wrong_vi: Phương án này sai vì đoạn văn có cung cấp thông tin về khả năng sống sót của các cộng đồng sinh vật. Thông tin rằng chúng 'could not survive' cho phép chúng ta kết luận một cách chắc chắn rằng chúng không thể mọc lại, do đó câu hỏi được trả lời (là NO) chứ không phải là không có thông tin.
        explanation: "Paragraph C says the communities 'could not survive their removal'."
      - q_num: 12
        question_type: yes_no_not_given
        prompt: "Sediment plumes could affect organisms outside the mining area."
        answer: "YES"
        skill_tag: writer_view_TFNG
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Đầu tiên, tìm các từ khóa của câu hỏi ('Sediment plumes', 'affect organisms', 'outside the mining area') trong đoạn văn. Các từ khóa này xuất hiện ở đoạn C.
          - action: confirm
            instruction_vi: 'Đối chiếu thông tin trong đoạn C với câu hỏi. Đoạn văn viết: ''Sediment plumes raised by the mining machines would drift for hundreds of kilometres and could smother filter-feeders far beyond the mining site itself.'' Cụm từ ''smother filter-feeders'' (làm ngạt các sinh vật ăn lọc) chính là một cách ''affect organisms'' (ảnh hưởng đến sinh vật), và cụm từ ''far beyond the mining site itself'' (rất xa bên ngoài khu vực khai thác) hoàn toàn trùng khớp với ''outside the mining area''. Vì vậy, thông tin được xác nhận là đúng.'
          distractor_analysis:
          - option: 'NO'
            why_wrong_vi: Phương án 'NO' sai vì nó mâu thuẫn trực tiếp với thông tin trong bài. Đoạn C khẳng định rằng những đám mây trầm tích 'could smother filter-feeders far beyond the mining site itself', tức là chúng CÓ ảnh hưởng đến sinh vật bên ngoài khu vực khai thác.
          - option: NOT GIVEN
            why_wrong_vi: Phương án 'NOT GIVEN' sai vì đoạn văn CUNG CẤP thông tin cụ thể để trả lời câu hỏi. Bài đọc đã nêu rõ tác động tiềm tàng ('could smother filter-feeders') và phạm vi của tác động đó ('far beyond the mining site itself'). Do đó, có đủ cơ sở để kết luận là YES.
        explanation: "Paragraph C says plumes could 'smother filter-feeders far beyond the mining site'."
      - q_num: 13
        question_type: yes_no_not_given
        prompt: "Battery prices have fallen sharply in the last decade."
        answer: "NO"
        skill_tag: writer_view_TFNG
        explanation: "Paragraph B states that battery-metal prices have risen sharply."

  # ── Passage 2 — Qs 14–26 ────────────────────────────────────────
  - passage_order: 2
    slug: l3-t2-p2-soundscape-ecology
    title: "Soundscape Ecology"
    word_count: 240
    topic_tags: [biology, environment]
    body_markdown: |
      Soundscape ecology studies the sounds of a landscape as a window
      onto its biological health. Three researchers have shaped the
      field's modern phase. Bernie Krause, a former musician turned
      field recordist, has spent decades cataloguing dawn choruses
      across more than a thousand sites and has argued that listening
      can detect decline years before counting can. Almo Farina, an
      Italian ecologist, has built statistical indices that compress a
      forest's full sound spectrum into a single number, allowing
      year-on-year comparison. Bryan Pijanowski, who founded the
      Center for Global Soundscapes at Purdue University, focuses on
      automated recorders left in remote sites for months on end and
      has campaigned for an open archive of the world's acoustic
      heritage. Each has answered a slightly different question. Krause
      asks whether a place still sounds whole; Farina asks how to
      compare two recordings objectively; Pijanowski asks who else
      should be able to hear the answer.

      The technique now matters because much of the world's biodiversity
      decline goes unrecorded. Visual surveys can miss what is happening
      under the canopy; trapping is laborious and damaging; satellite
      imagery sees only structure. Sound, by contrast, leaks past
      leaves and rocks alike. A recorder the size of a paperback can
      capture the same hour for months and reveal patterns no human
      observer would notice.
    questions:
      # Qs 14–18 — matching_features (A–E researcher bank)
      - q_num: 14
        question_type: matching_features
        prompt: "argues that listening can detect decline before counting can"
        options:
          - { label: A, text: "Bernie Krause" }
          - { label: B, text: "Almo Farina" }
          - { label: C, text: "Bryan Pijanowski" }
          - { label: D, text: "all three researchers" }
          - { label: E, text: "none of the named researchers" }
        answer: "A"
        skill_tag: scanning
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Tìm tên ''Bernie Krause'' trong đoạn văn. Thông tin về ông được mô tả trong câu: ''Bernie Krause, a former musician turned field recordist, has spent decades cataloguing dawn choruses across more than a thousand sites and has argued that listening can detect decline years before counting can.'''
          - action: confirm
            instruction_vi: Đối chiếu mệnh đề 'has argued that listening can detect decline years before counting can' trong đoạn văn với nội dung của câu hỏi 'argues that listening can detect decline before counting can'. Hai nội dung này trùng khớp hoàn toàn, xác nhận Bernie Krause là người đưa ra lập luận này.
          distractor_analysis:
          - option: B
            why_wrong_vi: Đoạn văn nói rằng Almo Farina 'has built statistical indices that compress a forest's full sound spectrum into a single number' (đã xây dựng các chỉ số thống kê để nén toàn bộ phổ âm thanh của một khu rừng thành một con số duy nhất). Ông tập trung vào việc so sánh khách quan các bản ghi âm, không phải so sánh hiệu quả giữa việc nghe và đếm.
          - option: C
            why_wrong_vi: Theo đoạn văn, Bryan Pijanowski 'focuses on automated recorders... and has campaigned for an open archive' (tập trung vào các máy ghi âm tự động... và đã vận động cho một kho lưu trữ mở). Đóng góp của ông liên quan đến công nghệ thu thập và khả năng tiếp cận dữ liệu, không phải là lập luận về việc phát hiện sự suy giảm.
          - option: D
            why_wrong_vi: Phương án này sai vì chỉ có Bernie Krause được đoạn văn mô tả là người đưa ra lập luận trong câu hỏi. Hai nhà nghiên cứu còn lại có những mối quan tâm và phương pháp khác biệt.
          - option: E
            why_wrong_vi: Phương án này sai vì đoạn văn đã chỉ rõ Bernie Krause chính là người 'has argued that listening can detect decline years before counting can', cung cấp một sự tương ứng trực tiếp với câu hỏi.
        explanation: "Stated about Krause directly."
      - q_num: 15
        question_type: matching_features
        prompt: "developed numerical indices for forest soundscapes"
        options:
          - { label: A, text: "Bernie Krause" }
          - { label: B, text: "Almo Farina" }
          - { label: C, text: "Bryan Pijanowski" }
          - { label: D, text: "all three researchers" }
          - { label: E, text: "none of the named researchers" }
        answer: "B"
        skill_tag: scanning
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc lướt đoạn văn để tìm các từ khóa trong câu hỏi: ''numerical indices'' (chỉ số bằng số) hoặc các từ đồng nghĩa như ''statistical indices'', ''number''.'
          - action: confirm
            instruction_vi: 'Xác định câu văn mô tả về Almo Farina: ''Almo Farina, an Italian ecologist, has built statistical indices that compress a forest''s full sound spectrum into a single number...''. Cụm từ ''built statistical indices'' (đã xây dựng các chỉ số thống kê) và ''a single number'' (một con số duy nhất) khớp chính xác với yêu cầu ''developed numerical indices'' của câu hỏi.'
          distractor_analysis:
          - option: A
            why_wrong_vi: Đoạn văn nói Bernie Krause 'has spent decades cataloguing dawn choruses' (đã dành nhiều thập kỷ để lập danh mục các bản hợp xướng bình minh). Công việc của ông là ghi âm và lập luận, không phải phát triển các chỉ số bằng số.
          - option: C
            why_wrong_vi: Đoạn văn cho biết Bryan Pijanowski 'focuses on automated recorders' (tập trung vào máy ghi âm tự động) và 'an open archive' (một kho lưu trữ mở). Đóng góp của ông liên quan đến công nghệ ghi âm và chia sẻ dữ liệu, không phải tạo ra các chỉ số.
          - option: D
            why_wrong_vi: Phương án này sai vì đoạn văn mô tả những đóng góp riêng biệt của từng nhà nghiên cứu. Chỉ có Almo Farina được nhắc đến là người đã tạo ra các chỉ số.
          - option: E
            why_wrong_vi: Phương án này không đúng vì đoạn văn đã chỉ rõ Almo Farina là người đã 'built statistical indices', khớp với yêu cầu câu hỏi.
        explanation: "Farina builds 'statistical indices that compress a forest's full sound spectrum'."
      - q_num: 16
        question_type: matching_features
        prompt: "has campaigned for public access to recordings"
        options:
          - { label: A, text: "Bernie Krause" }
          - { label: B, text: "Almo Farina" }
          - { label: C, text: "Bryan Pijanowski" }
          - { label: D, text: "all three researchers" }
          - { label: E, text: "none of the named researchers" }
        answer: "C"
        skill_tag: scanning
        solution:
          solution_steps:
          - action: decode_vocab
            instruction_vi: 'Đọc và hiểu yêu cầu của câu hỏi: ''has campaigned for public access to recordings'', nghĩa là đã vận động/đấu tranh để công chúng có thể truy cập vào các bản ghi âm.'
          - action: locate
            instruction_vi: Tìm tên của các nhà nghiên cứu trong đoạn văn và đọc kỹ phần mô tả về từng người. Phần mô tả về Bryan Pijanowski có chứa thông tin liên quan.
          - action: confirm
            instruction_vi: Xác nhận sự tương đồng giữa câu hỏi và thông tin trong bài. Đoạn văn viết Bryan Pijanowski 'has campaigned for an open archive of the world's acoustic heritage'. Cụm từ 'an open archive' (một kho lưu trữ mở) đồng nghĩa với 'public access to recordings' (công chúng truy cập các bản ghi âm).
          distractor_analysis:
          - option: A
            why_wrong_vi: Đoạn văn chỉ đề cập đến Bernie Krause là người 'cataloguing dawn choruses' (lập danh mục các bản hợp xướng lúc bình minh) và cho rằng việc lắng nghe có thể phát hiện sự suy giảm sớm. Không có thông tin nào nói ông vận động cho việc truy cập công khai.
          - option: B
            why_wrong_vi: Theo đoạn văn, Almo Farina tập trung vào việc 'built statistical indices' (xây dựng các chỉ số thống kê) để so sánh các bản ghi âm một cách khách quan. Không có thông tin nào về việc ông vận động cho truy cập công cộng.
          - option: D
            why_wrong_vi: Phương án này sai vì chỉ có Bryan Pijanowski được mô tả là 'campaigned for an open archive'. Công việc của Krause và Farina được mô tả với những mục tiêu khác, không liên quan đến việc truy cập công khai.
          - option: E
            why_wrong_vi: Phương án này sai vì đoạn văn đã nêu rõ ràng rằng Bryan Pijanowski 'has campaigned for an open archive of the world's acoustic heritage', khớp chính xác với yêu cầu của câu hỏi.
        explanation: "Pijanowski wants 'an open archive of the world's acoustic heritage'."
      - q_num: 17
        question_type: matching_features
        prompt: "specialises in long unattended recordings"
        options:
          - { label: A, text: "Bernie Krause" }
          - { label: B, text: "Almo Farina" }
          - { label: C, text: "Bryan Pijanowski" }
          - { label: D, text: "all three researchers" }
          - { label: E, text: "none of the named researchers" }
        answer: "C"
        skill_tag: scanning
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc lướt đoạn văn để tìm các từ khóa trong câu hỏi: ''long'' (dài), ''unattended'' (không giám sát), ''recordings'' (ghi âm). Chú ý đến phần mô tả công việc của từng nhà nghiên cứu.'
          - action: confirm
            instruction_vi: Xác nhận thông tin về Bryan Pijanowski. Đoạn văn viết rằng ông ấy 'focuses on automated recorders left in remote sites for months on end' (tập trung vào các máy ghi âm tự động được để lại ở những nơi xa xôi trong nhiều tháng liền). Cụm từ này khớp chính xác với 'long unattended recordings'.
          distractor_analysis:
          - option: A
            why_wrong_vi: Đoạn văn nói Bernie Krause 'has spent decades cataloguing dawn choruses' (dành nhiều thập kỷ để lập danh mục các bản hợp xướng lúc bình minh), nhưng không hề đề cập đến việc ông sử dụng phương pháp ghi âm dài ngày không cần giám sát.
          - option: B
            why_wrong_vi: Chuyên môn của Almo Farina là 'built statistical indices' (xây dựng các chỉ số thống kê) để so sánh các bản ghi âm một cách khách quan, chứ không phải là phương pháp thu thập các bản ghi âm đó.
          - option: D
            why_wrong_vi: Phương án này không đúng vì chỉ có Bryan Pijanowski được mô tả là chuyên về lĩnh vực này. Công việc của hai nhà nghiên cứu còn lại được mô tả với những trọng tâm khác biệt.
          - option: E
            why_wrong_vi: Phương án này sai vì đoạn văn đã chỉ rõ Bryan Pijanowski là người có chuyên môn được hỏi đến.
        explanation: "Pijanowski focuses on 'automated recorders left in remote sites for months'."
      - q_num: 18
        question_type: matching_features
        prompt: "asks whether a place still sounds whole"
        options:
          - { label: A, text: "Bernie Krause" }
          - { label: B, text: "Almo Farina" }
          - { label: C, text: "Bryan Pijanowski" }
          - { label: D, text: "all three researchers" }
          - { label: E, text: "none of the named researchers" }
        answer: "A"
        skill_tag: scanning
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Định vị câu cuối của đoạn 1, nơi tóm tắt câu hỏi của từng nhà nghiên cứu: ''Each has answered a slightly different question.'''
          - action: confirm
            instruction_vi: 'Xác nhận rằng vế câu tiếp theo trực tiếp nối tên ''Krause'' với câu hỏi trong đề bài: ''Krause asks whether a place still sounds whole''.'
          distractor_analysis:
          - option: B
            why_wrong_vi: Đoạn văn nêu rõ câu hỏi của Almo Farina là 'how to compare two recordings objectively' (làm thế nào để so sánh hai bản ghi một cách khách quan), không phải là nơi đó còn 'nguyên vẹn' hay không.
          - option: C
            why_wrong_vi: Đoạn văn chỉ ra câu hỏi của Bryan Pijanowski là 'who else should be able to hear the answer' (ai khác nên có thể nghe được câu trả lời), liên quan đến việc chia sẻ dữ liệu, không phải về sự 'nguyên vẹn' của âm thanh.
          - option: D
            why_wrong_vi: Đoạn văn khẳng định 'Each has answered a slightly different question' (Mỗi người đã trả lời một câu hỏi hơi khác nhau), cho thấy họ không cùng chung một câu hỏi.
          - option: E
            why_wrong_vi: Phương án này sai vì câu hỏi trong đề bài được gán trực tiếp cho một nhà nghiên cứu có tên trong bài, đó là Krause.
        explanation: "Stated of Krause in the synthesis sentence."
      # Qs 19–23 — matching_sentence_endings (A–G bank)
      - q_num: 19
        question_type: matching_sentence_endings
        prompt: "Soundscape ecology treats the sounds of a place as …"
        options:
          - { label: A, text: "a measure of the system's biological health." }
          - { label: B, text: "a way of comparing recordings on a single number." }
          - { label: C, text: "an alternative when satellite imagery is too costly." }
          - { label: D, text: "a tool that can monitor remote sites continuously." }
          - { label: E, text: "evidence that visual surveys are no longer needed." }
          - { label: F, text: "a record of declines that visual surveys may miss." }
          - { label: G, text: "the cheapest method available for inventories." }
        answer: "A"
        skill_tag: main_idea
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Xác định vị trí định nghĩa của ''Soundscape ecology'' trong câu đầu tiên của đoạn văn: ''Soundscape ecology studies the sounds of a landscape as a window onto its biological health.'''
          - action: confirm
            instruction_vi: Đối chiếu cụm từ 'a window onto its biological health' (một cửa sổ nhìn vào sức khỏe sinh học của nó) với phương án A 'a measure of the system's biological health' (một thước đo sức khỏe sinh học của hệ thống). Hai cách diễn đạt này có ý nghĩa tương đương, đều chỉ ra rằng âm thanh được dùng để đánh giá tình trạng sinh học.
          distractor_analysis:
          - option: B
            why_wrong_vi: Đây là công việc cụ thể của nhà nghiên cứu Almo Farina ('compress a forest's full sound spectrum into a single number'), không phải là định nghĩa chung của toàn bộ lĩnh vực 'soundscape ecology'.
          - option: C
            why_wrong_vi: Đoạn văn có đề cập 'satellite imagery' nhưng chỉ nói rằng nó 'sees only structure' (chỉ nhìn thấy cấu trúc). Không có thông tin nào cho rằng chi phí (costly) là lý do để dùng phương pháp âm thanh thay thế.
          - option: D
            why_wrong_vi: Đây là trọng tâm nghiên cứu của Bryan Pijanowski ('focuses on automated recorders left in remote sites for months on end'), không phải là định nghĩa tổng quát cho toàn bộ lĩnh vực được hỏi.
          - option: E
            why_wrong_vi: Đoạn văn chỉ nói rằng 'Visual surveys can miss what is happening...' (khảo sát trực quan có thể bỏ sót...), ngụ ý phương pháp này có hạn chế, chứ không hề khẳng định nó 'no longer needed' (không còn cần thiết nữa).
          - option: F
            why_wrong_vi: Mặc dù đúng là phương pháp này có thể ghi nhận sự suy giảm mà khảo sát trực quan bỏ lỡ, đây là một lợi ích hoặc một ứng dụng của lĩnh vực, không phải là định nghĩa cốt lõi. Phương án A cung cấp định nghĩa tổng quát hơn được nêu ngay trong câu đầu tiên.
          - option: G
            why_wrong_vi: Đoạn văn không chứa bất kỳ thông tin nào về chi phí của các phương pháp. Từ 'cheapest' (rẻ nhất) là một sự suy diễn không có cơ sở trong bài.
        explanation: "Opening sentence: 'a window onto its biological health'."
      - q_num: 20
        question_type: matching_sentence_endings
        prompt: "Farina's contribution allows researchers to …"
        options:
          - { label: A, text: "a measure of the system's biological health." }
          - { label: B, text: "a way of comparing recordings on a single number." }
          - { label: C, text: "an alternative when satellite imagery is too costly." }
          - { label: D, text: "a tool that can monitor remote sites continuously." }
          - { label: E, text: "evidence that visual surveys are no longer needed." }
          - { label: F, text: "a record of declines that visual surveys may miss." }
          - { label: G, text: "the cheapest method available for inventories." }
        answer: "B"
        skill_tag: scanning
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Xác định vị trí thông tin về ''Farina'' trong đoạn văn. Câu văn liên quan là: "Almo Farina, an Italian ecologist, has built statistical indices that compress a forest''s full sound spectrum into a single number, allowing year-on-year comparison."'
          - action: parse_syntax
            instruction_vi: Phân tích câu văn vừa tìm được. Cụm từ "compress a forest's full sound spectrum into a single number" (nén toàn bộ phổ âm thanh của một khu rừng thành một con số duy nhất) và "allowing year-on-year comparison" (cho phép so sánh giữa các năm) mô tả đóng góp của Farina.
          - action: confirm
            instruction_vi: Đối chiếu ý nghĩa này với các phương án. Phương án B, "a way of comparing recordings on a single number" (một cách so sánh các bản ghi âm dựa trên một con số duy nhất), hoàn toàn trùng khớp với thông tin trong bài về việc nén dữ liệu thành "a single number" để "comparison" (so sánh).
          distractor_analysis:
          - option: A
            why_wrong_vi: Phương án này mô tả mục tiêu chung của toàn bộ lĩnh vực "Soundscape ecology" (đo lường sức khỏe sinh học của hệ thống), như được nêu ở câu đầu tiên, chứ không phải là đóng góp cụ thể của riêng Farina.
          - option: C
            why_wrong_vi: Đoạn văn có nhắc đến "satellite imagery" (ảnh vệ tinh) nhưng không hề đề cập đến chi phí ("costly") của nó. Thông tin này không có trong bài.
          - option: D
            why_wrong_vi: Đây là đóng góp của Bryan Pijanowski, không phải của Farina. Đoạn văn ghi rõ Pijanowski "focuses on automated recorders left in remote sites for months on end" (tập trung vào các máy ghi âm tự động đặt ở các địa điểm xa xôi trong nhiều tháng).
          - option: E
            why_wrong_vi: Đoạn văn chỉ nói rằng khảo sát bằng hình ảnh "can miss what is happening" (có thể bỏ sót những gì đang xảy ra), ngụ ý nó có hạn chế, chứ không hề nói rằng nó "are no longer needed" (không còn cần thiết nữa). Đây là một suy diễn quá mức.
          - option: F
            why_wrong_vi: Việc ghi lại sự suy giảm mà khảo sát hình ảnh có thể bỏ lỡ là một lợi ích chung của việc ghi âm, và được liên kết chặt chẽ hơn với Bernie Krause, người cho rằng "listening can detect decline years before counting can".
          - option: G
            why_wrong_vi: Đoạn văn không chứa bất kỳ thông tin nào về chi phí của các phương pháp. Từ "cheapest" (rẻ nhất) không được đề cập.
        explanation: "Indices 'allowing year-on-year comparison'."
      - q_num: 21
        question_type: matching_sentence_endings
        prompt: "Long-term recorders give field biologists …"
        options:
          - { label: A, text: "a measure of the system's biological health." }
          - { label: B, text: "a way of comparing recordings on a single number." }
          - { label: C, text: "an alternative when satellite imagery is too costly." }
          - { label: D, text: "a tool that can monitor remote sites continuously." }
          - { label: E, text: "evidence that visual surveys are no longer needed." }
          - { label: F, text: "a record of declines that visual surveys may miss." }
          - { label: G, text: "the cheapest method available for inventories." }
        answer: "D"
        skill_tag: inference
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc câu hỏi và xác định từ khóa: ''Long-term recorders'' (máy ghi âm dài hạn). Tìm thông tin tương ứng trong đoạn văn. Đoạn văn đề cập đến Bryan Pijanowski, người ''focuses on automated recorders left in remote sites for months on end'' (tập trung vào các máy ghi âm tự động được để lại ở những nơi xa xôi hàng tháng trời).'
          - action: confirm
            instruction_vi: 'Đối chiếu thông tin vừa tìm được với các phương án. Cụm từ ''recorders left in remote sites for months on end'' có nghĩa tương đương với phương án D: ''a tool that can monitor remote sites continuously'' (một công cụ có thể giám sát các địa điểm xa xôi một cách liên tục).'
          distractor_analysis:
          - option: A
            why_wrong_vi: Phương án này mô tả mục tiêu chung của cả lĩnh vực 'soundscape ecology' được nêu ở câu đầu tiên ('studies the sounds of a landscape as a window onto its biological health'), chứ không phải chức năng cụ thể của 'long-term recorders'.
          - option: B
            why_wrong_vi: Việc so sánh các bản ghi âm bằng một con số duy nhất ('compare two recordings objectively... into a single number') là đóng góp của nhà nghiên cứu Almo Farina, không phải là chức năng của bản thân 'long-term recorders'.
          - option: C
            why_wrong_vi: Đoạn văn có đề cập đến hình ảnh vệ tinh ('satellite imagery sees only structure') nhưng không hề nói đến chi phí ('costly'). Do đó, không có cơ sở để chọn phương án này.
          - option: E
            why_wrong_vi: Đoạn văn chỉ nói rằng khảo sát bằng hình ảnh có những hạn chế ('Visual surveys can miss...'), chứ không hề khẳng định chúng 'không còn cần thiết nữa' ('no longer needed'). Đây là một suy diễn quá mức.
          - option: F
            why_wrong_vi: 'Mặc dù việc ghi âm có thể phát hiện sự suy giảm mà khảo sát hình ảnh bỏ lỡ, phương án D mô tả chính xác và trực tiếp hơn chức năng của ''long-term recorders'' được gắn với công trình của Pijanowski: khả năng giám sát các địa điểm xa xôi trong thời gian dài (''remote sites for months on end''). F là một kết quả có thể có, nhưng D mô tả chức năng cốt lõi của công cụ.'
          - option: G
            why_wrong_vi: Đoạn văn không cung cấp bất kỳ thông tin nào về chi phí của các phương pháp khảo sát, vì vậy không thể kết luận rằng đây là 'phương pháp rẻ nhất' ('the cheapest method').
        explanation: "Recorders 'capture the same hour for months' = continuous monitoring."
      - q_num: 22
        question_type: matching_sentence_endings
        prompt: "Sound recordings can sometimes provide …"
        options:
          - { label: A, text: "a measure of the system's biological health." }
          - { label: B, text: "a way of comparing recordings on a single number." }
          - { label: C, text: "an alternative when satellite imagery is too costly." }
          - { label: D, text: "a tool that can monitor remote sites continuously." }
          - { label: E, text: "evidence that visual surveys are no longer needed." }
          - { label: F, text: "a record of declines that visual surveys may miss." }
          - { label: G, text: "the cheapest method available for inventories." }
        answer: "F"
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc câu hỏi và xác định từ khóa: ''Sound recordings can sometimes provide...''. Ta cần tìm trong bài đọc xem việc ghi âm có thể cung cấp điều gì. Đoạn văn thứ hai tập trung vào việc so sánh phương pháp ghi âm với các phương pháp khác.'
          - action: confirm
            instruction_vi: 'Đối chiếu với phương án F. Đoạn 2 nêu rõ: ''Visual surveys can miss what is happening under the canopy'' (Khảo sát trực quan có thể bỏ lỡ những gì đang xảy ra dưới tán lá). Đoạn văn cũng nói rằng ''much of the world''s biodiversity decline goes unrecorded'' (phần lớn sự suy giảm đa dạng sinh học không được ghi nhận). Việc ghi âm giúp giải quyết vấn đề này. Do đó, ghi âm có thể cung cấp ''a record of declines that visual surveys may miss'' (một bản ghi về sự suy giảm mà khảo sát trực quan có thể bỏ lỡ), hoàn toàn trùng khớp với thông tin trong bài.'
          distractor_analysis:
          - option: A
            why_wrong_vi: Phương án này quá chung chung. Mặc dù câu đầu tiên có nói âm thanh là 'a window onto its biological health' (một cửa sổ nhìn vào sức khỏe sinh học), nhưng phương án F cung cấp một lợi ích CỤ THỂ và được nhấn mạnh hơn khi so sánh trực tiếp với các phương pháp khác trong đoạn 2.
          - option: B
            why_wrong_vi: Thông tin này chỉ liên quan đến công trình của một nhà nghiên cứu cụ thể là Almo Farina, người 'has built statistical indices that compress a forest's full sound spectrum into a single number'. Đây không phải là một chức năng tổng quát của tất cả các bản ghi âm được đề cập trong bài.
          - option: C
            why_wrong_vi: Đoạn văn có đề cập đến 'satellite imagery' (hình ảnh vệ tinh) nhưng chỉ phê bình rằng nó 'sees only structure' (chỉ nhìn thấy cấu trúc). Không có thông tin nào nói rằng phương pháp này 'too costly' (quá tốn kém).
          - option: D
            why_wrong_vi: Đây là lĩnh vực tập trung của một nhà nghiên cứu cụ thể là Bryan Pijanowski, người 'focuses on automated recorders left in remote sites for months on end'. Tương tự phương án B, đây không phải là lợi ích chung được nêu bật cho toàn bộ kỹ thuật ghi âm.
          - option: E
            why_wrong_vi: Đoạn văn chỉ nói rằng khảo sát trực quan 'can miss' (có thể bỏ lỡ) thông tin, chứ không hề khẳng định chúng 'are no longer needed' (không còn cần thiết nữa). Đây là một suy diễn quá mức và không được hỗ trợ bởi văn bản.
          - option: G
            why_wrong_vi: Đoạn văn không hề đề cập đến chi phí của bất kỳ phương pháp nào. Do đó, không có cơ sở để kết luận rằng ghi âm là phương pháp 'cheapest' (rẻ nhất).
        explanation: "Sound 'leaks past leaves and rocks' so it captures what visual surveys miss."
      - q_num: 23
        question_type: matching_sentence_endings
        prompt: "Krause's central question is whether …"
        options:
          - { label: A, text: "a measure of the system's biological health." }
          - { label: B, text: "a way of comparing recordings on a single number." }
          - { label: C, text: "an alternative when satellite imagery is too costly." }
          - { label: D, text: "a tool that can monitor remote sites continuously." }
          - { label: E, text: "evidence that visual surveys are no longer needed." }
          - { label: F, text: "a record of declines that visual surveys may miss." }
          - { label: G, text: "the cheapest method available for inventories." }
        answer: "A"
        skill_tag: main_idea
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Xác định vị trí thông tin về câu hỏi của Krause trong đoạn văn. Câu cuối của đoạn 1 nêu rõ: ''Krause asks whether a place still sounds whole'' (Krause hỏi liệu một nơi nào đó có còn ''nghe trọn vẹn'' không).'
          - action: infer
            instruction_vi: Suy luận ý nghĩa của cụm từ 'sounds whole'. Câu đầu tiên của đoạn văn định nghĩa lĩnh vực này là nghiên cứu âm thanh 'as a window onto its biological health' (như một cửa sổ nhìn vào sức khỏe sinh học của nó). Do đó, câu hỏi liệu một nơi có 'sounds whole' hay không chính là câu hỏi về 'sức khỏe sinh học' của hệ thống đó. Phương án A diễn giải chính xác ý này.
          distractor_analysis:
          - option: B
            why_wrong_vi: 'Phương án này mô tả công việc của Almo Farina, không phải của Krause. Đoạn văn nêu rõ: ''Almo Farina... has built statistical indices that compress a forest''s full sound spectrum into a single number'' (Almo Farina... đã xây dựng các chỉ số thống kê nén toàn bộ phổ âm thanh của một khu rừng thành một con số duy nhất).'
          - option: C
            why_wrong_vi: Đoạn văn có đề cập đến 'satellite imagery' (hình ảnh vệ tinh) nhưng không hề so sánh hay nói về chi phí của nó. Thông tin này không có trong bài.
          - option: D
            why_wrong_vi: 'Đây là trọng tâm công việc của Bryan Pijanowski, không phải Krause. Đoạn văn viết: ''Bryan Pijanowski... focuses on automated recorders left in remote sites for months on end'' (Bryan Pijanowski... tập trung vào các máy ghi âm tự động được để lại ở những nơi xa xôi hàng tháng trời).'
          - option: E
            why_wrong_vi: Đoạn văn chỉ nói rằng 'Visual surveys can miss what is happening' (Khảo sát trực quan có thể bỏ lỡ những gì đang xảy ra), tức là chúng có hạn chế, chứ không khẳng định chúng 'no longer needed' (không còn cần thiết nữa). Đây là một suy diễn quá đà.
          - option: F
            why_wrong_vi: Mặc dù phương pháp của Krause có thể ghi lại sự suy giảm mà khảo sát trực quan bỏ lỡ ('can detect decline... visual surveys may miss'), câu hỏi trọng tâm của ông được nêu rõ là 'whether a place still sounds whole'. Điều này liên quan trực tiếp đến việc đánh giá 'sức khỏe sinh học' (phương án A), một khái niệm bao quát hơn là chỉ ghi lại sự suy giảm.
          - option: G
            why_wrong_vi: Đoạn văn không cung cấp bất kỳ thông tin nào về chi phí của các phương pháp, do đó không thể kết luận đây là 'the cheapest method' (phương pháp rẻ nhất).
        explanation: "Krause asks 'whether a place still sounds whole' — a health question."
      # Qs 24–26 — short_answer (served type filler)
      - q_num: 24
        question_type: short_answer
        prompt: "What instrument did Bernie Krause start his career with?"
        answer: "music"
        alternatives: [musician]
        skill_tag: detail
        explanation: "The passage calls him 'a former musician turned field recordist'."
      - q_num: 25
        question_type: short_answer
        prompt: "Roughly how large is the long-deployment recorder described in the text?"
        answer: "paperback"
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Đọc lướt đoạn văn để tìm từ khoá 'recorder' (máy ghi âm) và các từ/cụm từ mô tả kích thước của nó. Thông tin này nằm ở đoạn văn thứ hai.
          - action: confirm
            instruction_vi: 'Xác định câu văn chứa thông tin trực tiếp trả lời cho câu hỏi ''how large'' (lớn chừng nào). Câu đó là: ''A recorder the size of a paperback can capture the same hour for months...''.'
          - action: infer
            instruction_vi: Đối chiếu câu hỏi 'Roughly how large is the... recorder...?' với cụm từ 'the size of a paperback' (có kích thước bằng một cuốn sách bìa mềm). Từ mô tả kích thước cần điền là 'paperback'.
        explanation: "Stated: 'a recorder the size of a paperback'."
      - q_num: 26
        question_type: short_answer
        prompt: "At which university did Pijanowski found his centre?"
        answer: "Purdue"
        alternatives: ["Purdue University"]
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Tìm từ khóa trong câu hỏi là ''Pijanowski'' và ''centre'' trong đoạn văn. Ta thấy câu: ''Bryan Pijanowski, who founded the Center for Global Soundscapes at Purdue University...'''
          - action: confirm
            instruction_vi: Câu hỏi yêu cầu tìm tên trường đại học (university) nơi Pijanowski thành lập trung tâm của mình. Cụm từ 'at Purdue University' trong câu văn đã tìm được trực tiếp cung cấp câu trả lời.
        explanation: "Stated: 'founded the Center for Global Soundscapes at Purdue University'."

  # ── Passage 3 — Qs 27–40 ────────────────────────────────────────
  - passage_order: 3
    slug: l3-t2-p3-vertical-farming
    title: "Vertical Farming Comes of Age"
    word_count: 260
    topic_tags: [agriculture, technology]
    body_markdown: |
      Vertical farms grow crops in stacked layers, usually indoors,
      under LED light. The idea is not new — Roman emperors are said to
      have grown cucumbers on movable carts in cold months — but the
      modern industry only became feasible after LEDs became efficient
      enough that the electricity cost no longer outweighed the gain in
      yield per square metre. A typical commercial facility can produce
      around twenty harvests of leafy greens per year on a footprint
      a hundred times smaller than a conventional farm of equivalent
      output. Water use drops by more than ninety percent because most
      of it recirculates through the hydroponic loop.

      The process inside one of these buildings is tightly choreographed.
      Seeds arrive pre-graded and are placed into rockwool plugs, which
      sit on trays. Trays move automatically through a germination
      chamber kept near twenty-four degrees Celsius. After five days
      the seedlings move to the grow racks, where the lighting recipe
      is tuned by species: lettuce thrives on a heavy blue spectrum,
      basil prefers more red. Sensors track humidity, nutrient
      concentration and root temperature minute by minute, and a
      central controller nudges each variable back to its target. At
      harvest, the trays move to a cutting station, are weighed,
      packed, and shipped — typically reaching supermarket shelves
      within twelve hours of being cut.

      The remaining bottleneck is staple crops. Wheat, rice and maize
      need so much light that the electricity cost still exceeds the
      market price. Until that gap closes, vertical farming will stay
      a salad-and-herb business.
    questions:
      # Qs 27–32 — summary_completion (word bank A–J), flowing variant
      # Sprint 20.14e — Standards §2A.11: the bank lives in `options:` on
      # the FIRST Q of the run, alongside `template.summary_text` carrying
      # the flowing prose with `{{N}}` gap markers. The renderer absorbs
      # all 6 Qs into ONE box; the bank renders as a sticky
      # `.exam-word-bank-box` above. Each `{{N}}` becomes a
      # `<select>` of labels; per-Q answers grade as before.
      - q_num: 27
        question_type: summary_completion
        prompt: "(see summary above)"
        template:
          summary_text: |
            A modern commercial vertical farm produces around {{27}}
            harvests of leafy greens each year on a much smaller
            footprint than conventional farming. Seeds are placed into
            {{28}} plugs on trays before germination begins; the
            germination chamber is kept near {{29}} degrees Celsius.
            After {{30}} days the seedlings are moved to the grow
            racks. On the racks, {{31}} is grown under a heavy blue
            light recipe. Packed greens typically reach supermarket
            shelves within {{32}} hours of harvest.
        options:
          - { label: A, text: "five" }
          - { label: B, text: "ten" }
          - { label: C, text: "twenty" }
          - { label: D, text: "fifty" }
          - { label: E, text: "rockwool" }
          - { label: F, text: "twenty-four" }
          - { label: G, text: "five" }
          - { label: H, text: "lettuce" }
          - { label: I, text: "basil" }
          - { label: J, text: "twelve" }
        answer: "C"
        skill_tag: scanning
        explanation: "Stated: 'around twenty harvests of leafy greens per year'."
      - q_num: 28
        question_type: summary_completion
        prompt: "(see summary above)"
        answer: "E"
        skill_tag: detail
        explanation: "Stated: 'placed into rockwool plugs, which sit on trays'."
      - q_num: 29
        question_type: summary_completion
        prompt: "(see summary above)"
        answer: "F"
        skill_tag: detail
        explanation: "Stated: 'kept near twenty-four degrees Celsius'."
      - q_num: 30
        question_type: summary_completion
        prompt: "(see summary above)"
        answer: "G"
        skill_tag: detail
        explanation: "Stated: 'after five days the seedlings move to the grow racks'."
      - q_num: 31
        question_type: summary_completion
        prompt: "(see summary above)"
        answer: "H"
        skill_tag: detail
        explanation: "Stated: 'lettuce thrives on a heavy blue spectrum'."
      - q_num: 32
        question_type: summary_completion
        prompt: "(see summary above)"
        answer: "J"
        skill_tag: detail
        explanation: "Stated: 'within twelve hours of being cut'."
      # Qs 33–37 — flow_chart_completion (vertical chain of boxes)
      # Each stem references the next-step gap. The renderer wraps these
      # in .exam-gap-box--mono (mono font + pre-wrap) so the chain reads
      # as a connected sequence.
      - q_num: 33
        question_type: flow_chart_completion
        prompt: "Step 1 — Pre-graded ____ arrive at the facility."
        answer: "seeds"
        skill_tag: scanning
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Tìm trong đoạn văn phần mô tả quy trình (''process''). Câu hỏi đề cập đến ''Step 1'' và có từ khóa ''Pre-graded''. Đoạn văn thứ hai bắt đầu bằng ''The process...'', và câu thứ hai trong đoạn này chứa chính xác cụm từ cần tìm: ''Seeds arrive pre-graded...'''
          - action: confirm
            instruction_vi: Đối chiếu câu hỏi 'Pre-graded ____ arrive at the facility' với câu trong bài 'Seeds arrive pre-graded...'. Cấu trúc câu cho thấy đối tượng được 'pre-graded' (phân loại trước) và 'arrive' (đến nơi) chính là 'Seeds' (hạt giống). Vì vậy, từ cần điền là 'seeds'.
        explanation: "Stated: 'Seeds arrive pre-graded'."
      - q_num: 34
        question_type: flow_chart_completion
        prompt: "Step 2 — Seeds are placed in rockwool plugs on ____."
        answer: "trays"
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đầu tiên, xác định các từ khóa trong câu hỏi là ''Seeds'' (hạt giống) và ''rockwool plugs''. Tìm các từ này trong đoạn văn, ta sẽ thấy chúng xuất hiện ở đầu đoạn thứ hai, trong câu: ''Seeds arrive pre-graded and are placed into rockwool plugs, which sit on trays.'''
          - action: confirm
            instruction_vi: Câu hỏi yêu cầu tìm danh từ chỉ vật mà 'rockwool plugs' được đặt LÊN TRÊN ('on ____'). Câu văn trong bài '...rockwool plugs, which sit on trays' có nghĩa là '...các bầu xơ len đá, thứ mà nằm trên các cái khay'. Điều này trực tiếp trả lời câu hỏi. Vì vậy, từ cần điền là 'trays'.
        explanation: "Stated: 'placed into rockwool plugs, which sit on trays'."
      - q_num: 35
        question_type: flow_chart_completion
        prompt: "Step 3 — Trays pass through a ____ chamber for five days."
        answer: "germination"
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Xác định các từ khóa trong câu hỏi: ''Trays'' (khay), ''pass through'' (đi qua), ''chamber'' (buồng/phòng) và ''five days'' (năm ngày). Sau đó, tìm những từ này hoặc từ đồng nghĩa trong đoạn văn để xác định vị trí thông tin liên quan.'
          - action: confirm
            instruction_vi: 'Đoạn văn nêu rõ quy trình: ''Trays move automatically through a germination chamber... After five days the seedlings move to the grow racks...''. Thông tin này khớp chính xác với cấu trúc câu hỏi ''Trays pass through a ____ chamber for five days''. Từ đứng trước ''chamber'' trong đoạn văn là ''germination'', do đó đây là đáp án cần điền.'
        explanation: "Stated: 'a germination chamber kept near twenty-four degrees'."
      - q_num: 36
        question_type: flow_chart_completion
        prompt: "Step 4 — Seedlings transfer to grow racks under species-tuned ____."
        answer: "lighting"
        alternatives: [light]
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc lướt đoạn văn để tìm các từ khóa trong câu hỏi như ''seedlings'' (cây con) và ''grow racks'' (giá trồng). Đoạn văn thứ hai chứa câu: ''After five days the seedlings move to the grow racks...'''
          - action: parse_syntax
            instruction_vi: 'Phân tích vế câu ngay sau đó để tìm yếu tố được ''species-tuned'' (điều chỉnh theo loài). Câu văn viết: ''...where the lighting recipe is tuned by species''. Cụm từ ''tuned by species'' trong bài là cách diễn đạt khác của ''species-tuned'' trong câu hỏi.'
          - action: confirm
            instruction_vi: Từ đứng trước 'recipe is tuned by species' là 'lighting'. Do đó, 'lighting' (sự chiếu sáng/ánh sáng) là từ cần điền vào chỗ trống để hoàn thành câu hỏi một cách chính xác.
        explanation: "Stated: 'the lighting recipe is tuned by species'."
      - q_num: 37
        question_type: flow_chart_completion
        prompt: "Step 5 — At harvest, trays move to a cutting station, are weighed and ____."
        answer: "packed"
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Sử dụng các từ khóa trong câu hỏi như 'At harvest' (Vào lúc thu hoạch), 'cutting station' (trạm cắt), và 'weighed' (được cân) để xác định vị trí thông tin trong đoạn văn. Các từ khóa này xuất hiện ở cuối đoạn văn thứ hai.
          - action: confirm
            instruction_vi: 'Đoạn văn viết: ''At harvest, the trays move to a cutting station, are weighed, packed, and shipped''. Câu hỏi là một chuỗi liệt kê các hành động: ''...are weighed and ____''. So sánh trực tiếp, từ đứng ngay sau ''weighed'' trong danh sách này là ''packed''.'
        explanation: "Stated: 'are weighed, packed, and shipped'."
      # Qs 38–40 — diagram_label_completion (callouts on a labeled diagram)
      - q_num: 38
        question_type: diagram_label_completion
        prompt: "Label 1 (input side): pre-graded ____"
        answer: "seeds"
        skill_tag: scanning
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc câu hỏi và xác định từ khóa là ''pre-graded''. Tìm từ này trong đoạn văn. Ta thấy câu thứ hai của đoạn hai có chứa cụm từ này: ''Seeds arrive pre-graded and are placed into rockwool plugs...'''
          - action: confirm
            instruction_vi: 'Nhãn trong sơ đồ là ''pre-graded ___'' (phía đầu vào). Đối chiếu đoạn văn: ''Seeds arrive pre-graded'' — hạt giống được chuyển đến ở trạng thái đã phân loại sẵn. Vì vậy chỗ trống sau ''pre-graded'' trong nhãn điền ''seeds'' → ''pre-graded seeds''.'
        explanation: "Same opening step as the flow-chart."
      - q_num: 39
        question_type: diagram_label_completion
        prompt: "Label 2 (central rack): controlled by sensors tracking nutrient concentration, humidity and root ____"
        answer: "temperature"
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Tìm trong đoạn văn các từ khoá trong câu hỏi: ''sensors'', ''tracking'', ''nutrient concentration'', ''humidity''. Các từ này xuất hiện ở đoạn 2 trong câu: ''Sensors track humidity, nutrient concentration and root temperature minute by minute...'''
          - action: confirm
            instruction_vi: 'Đối chiếu câu trong bài với câu hỏi: ''...sensors tracking nutrient concentration, humidity and root ____''. Ta thấy câu trong bài liệt kê ba yếu tố được theo dõi: ''humidity'', ''nutrient concentration'' và ''root temperature''. Do đó, từ còn thiếu đứng sau ''root'' chính là ''temperature''.'
        explanation: "Stated: 'sensors track humidity, nutrient concentration and root temperature'."
      - q_num: 40
        question_type: diagram_label_completion
        prompt: "Label 3 (output side): packed crops shipped to ____ shelves"
        answer: "supermarket"
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Xác định vị trí thông tin bằng cách tìm các từ khóa trong câu hỏi như ''packed'' (đóng gói) và ''shipped'' (vận chuyển). Các từ này xuất hiện ở câu cuối cùng của đoạn văn thứ hai: ''At harvest, the trays move to a cutting station, are weighed, packed, and shipped — typically reaching supermarket shelves within twelve hours of being cut.'''
          - action: confirm
            instruction_vi: Đối chiếu cụm từ tìm được với chỗ trống trong câu hỏi 'packed crops shipped to ____ shelves'. Đoạn văn nêu rõ rằng nông sản sau khi đóng gói và vận chuyển sẽ đến được 'supermarket shelves' (các kệ hàng siêu thị). Vì vậy, từ cần điền vào chỗ trống là 'supermarket'.
        explanation: "Stated: 'reaching supermarket shelves within twelve hours'."
---
