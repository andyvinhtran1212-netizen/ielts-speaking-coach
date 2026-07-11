---
# Sprint 20.6.6 — converted from the v1-spec NESTED question shape (which the
# importer silently mis-handled — see reading_content_format_v2.md §11/F1) to
# the v2 FLAT author shape (options/answer/alternatives at the question top
# level). Content (passages, questions, answers, alternatives, skill_tags,
# explanations) is unchanged. Importer round-trip is now correct.

content_type: reading_full_test
test_id: AVR-READ-001
title: "Academic Reading — Test 1"
module: academic
time_limit_minutes: 60
passage_count: 3
total_questions: 40
band_target: 7.0
published: true
passages:
  # ── Passage 1 — Qs 1–13 ─────────────────────────────────────────
  - passage_order: 1
    slug: l3-t1-p1-hand-made-goods
    title: "The Return of Hand-Made Goods"
    word_count: 520
    topic_tags: [economy, culture]
    body_markdown: |
      A The high street of any large city used to look the same. A row of
      familiar shop signs, the same goods in every window, the same prices
      to within a few pence. For decades this uniformity was treated as a
      sign of progress: it meant that anyone, anywhere, could buy the same
      reliable item at the same low cost. In the last ten years, however,
      a quieter trend has started to push back. Small workshops, single-
      person studios and weekend markets are once again selling pottery,
      furniture, leather goods and clothing made by hand — often at prices
      well above the mass-produced equivalents.

      B Several factors lie behind the shift. The first is simple
      curiosity. Online platforms have made it easy to see how things are
      actually made; videos of a knife being forged or a chair being
      jointed regularly attract millions of viewers. Watching a skilled
      maker at work, many shoppers feel a connection that an anonymous
      factory product cannot offer. A second factor is concern about
      waste. A hand-made object is rarely thrown away after a single
      season. It is repaired, passed on, and gradually acquires a history
      of its own.

      C Economists have been slower to take the movement seriously,
      partly because it is hard to measure. Most hand-made goods are sold
      outside the conventional retail system, in small batches and
      sometimes for cash. A 2021 survey of British craft makers, however,
      estimated that the sector employed around 150,000 people — more
      than the country's coal industry at its modern peak. The figure is
      modest in national terms, but the trajectory is upward.

      D Critics point out two awkward facts. The first is price. A hand-
      thrown mug typically costs five to ten times more than its
      industrial cousin, putting it out of reach for most buyers. The
      second is consistency: customers used to perfectly identical
      objects sometimes find variations between two "matching" plates
      uncomfortable. Defenders argue that the variation is precisely the
      point — each piece is a record of the maker's choices on a
      particular day.

      E Whether the movement will continue to grow is an open question.
      Hand-made goods will probably never replace mass production for
      most everyday items. But they appear to have carved out a stable
      niche at the higher end of the market, and that niche may yet
      reshape how we think about the objects in our homes.
    questions:
      - q_num: 1
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph A."
        options:
          - { label: i,   text: "A measurable, growing industry" }
          - { label: ii,  text: "Why uniformity once seemed like progress" }
          - { label: iii, text: "Two real difficulties for the movement" }
          - { label: iv,  text: "Two reasons buyers are drawn back to makers" }
          - { label: v,   text: "What the future might look like" }
        answer: "ii"
        alternatives: []
        skill_tag: skimming
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc nửa đầu đoạn A, ta thấy tác giả mô tả tình trạng các con phố trong quá khứ và nhận thức về nó: ''The high street of any large city used to look the same... For decades this uniformity was treated as a sign of progress''.'
          - action: confirm
            instruction_vi: 'Câu văn ngay sau đó giải thích lý do cho nhận thức này: ''it meant that anyone, anywhere, could buy the same reliable item at the same low cost.'' Điều này khớp chính xác với ý của tiêu đề ''Tại sao sự đồng nhất từng có vẻ là một sự tiến bộ''.'
          distractor_analysis:
          - option: i
            why_wrong_vi: Đoạn A không đề cập đến việc đo lường hay quy mô của ngành này. Thông tin về số liệu ('estimated that the sector employed around 150,000 people') và việc đo lường được thảo luận ở Đoạn C.
          - option: iii
            why_wrong_vi: Đoạn A chỉ giới thiệu xu hướng làm đồ thủ công như một sự đối lập với sản xuất hàng loạt, không nêu ra bất kỳ khó khăn nào. Hai khó khăn ('price', 'consistency') được chỉ ra ở Đoạn D.
          - option: iv
            why_wrong_vi: Đoạn A không giải thích lý do người mua quay lại với hàng thủ công. Các lý do này ('curiosity', 'concern about waste') được liệt kê và phân tích chi tiết ở Đoạn B.
          - option: v
            why_wrong_vi: Đoạn A nói về quá khứ ('used to look the same') và một xu hướng gần đây, không phải dự đoán về tương lai. Tương lai của phong trào này ('Whether the movement will continue to grow') là chủ đề của Đoạn E.
        explanation: "Paragraph A sets up uniformity as the older default."
      - q_num: 2
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph B."
        options:
          - { label: i,   text: "A measurable, growing industry" }
          - { label: ii,  text: "Why uniformity once seemed like progress" }
          - { label: iii, text: "Two real difficulties for the movement" }
          - { label: iv,  text: "Two reasons buyers are drawn back to makers" }
          - { label: v,   text: "What the future might look like" }
        answer: "iv"
        alternatives: []
        skill_tag: skimming
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc câu đầu tiên của đoạn B: ''Several factors lie behind the shift'' (Một vài yếu tố nằm sau sự thay đổi này). Câu này cho biết đoạn văn sẽ liệt kê các nguyên nhân hoặc lý do cho một xu hướng.'
          - action: locate
            instruction_vi: 'Xác định yếu tố đầu tiên được giới thiệu bằng cụm từ: ''The first is simple curiosity'' (Thứ nhất là sự tò mò đơn thuần), theo sau là giải thích về việc người mua cảm thấy có sự kết nối.'
          - action: locate
            instruction_vi: 'Xác định yếu tố thứ hai được giới thiệu bằng cụm từ: ''A second factor is concern about waste'' (Yếu tố thứ hai là mối lo ngại về rác thải), theo sau là giải thích về sự bền vững của đồ thủ công.'
          - action: confirm
            instruction_vi: Tổng hợp lại, đoạn B trình bày rõ ràng hai lý do ('The first' và 'A second factor') khiến người mua bị thu hút ('drawn back') bởi sản phẩm thủ công. Do đó, tiêu đề 'Two reasons buyers are drawn back to makers' (Hai lý do người mua quay trở lại với các nhà sản xuất thủ công) là chính xác nhất.
          distractor_analysis:
          - option: i
            why_wrong_vi: Phương án này sai vì đoạn B không đề cập đến các số liệu hay việc đo lường ngành công nghiệp này. Các thông tin về 'hard to measure' (khó đo lường) và '150,000 people' (150.000 người) nằm ở đoạn C.
          - option: ii
            why_wrong_vi: Phương án này sai vì nội dung về sự đồng nhất ('uniformity') từng được xem là tiến bộ ('a sign of progress') được thảo luận ở đoạn A, không phải đoạn B.
          - option: iii
            why_wrong_vi: Phương án này sai vì đoạn B nói về các yếu tố tích cực thu hút người mua, không phải khó khăn. Các khó khăn ('difficulties') như giá cả ('price') và sự thiếu nhất quán ('consistency') được đề cập trong đoạn D.
          - option: v
            why_wrong_vi: Phương án này sai vì đoạn B không dự đoán về tương lai. Chủ đề về tương lai của phong trào này ('Whether the movement will continue to grow') là nội dung chính của đoạn E.
      - q_num: 3
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph C."
        options:
          - { label: i,   text: "A measurable, growing industry" }
          - { label: ii,  text: "Why uniformity once seemed like progress" }
          - { label: iii, text: "Two real difficulties for the movement" }
          - { label: iv,  text: "Two reasons buyers are drawn back to makers" }
          - { label: v,   text: "What the future might look like" }
        answer: "i"
        alternatives: []
        skill_tag: skimming
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc lướt đoạn C, ta thấy dù ban đầu có nói ngành này ''hard to measure'' (khó đo lường), nhưng ngay sau đó đoạn văn đưa ra bằng chứng định lượng cụ thể từ một khảo sát: ''a 2021 survey of British craft makers, however, estimated that the sector employed around 150,000 people''. Điều này cho thấy đây là một ngành có thể đo lường được (''a measurable industry'').'
          - action: confirm
            instruction_vi: 'Đọc câu cuối cùng của đoạn C: ''The figure is modest in national terms, but the trajectory is upward''. Cụm từ ''the trajectory is upward'' (quỹ đạo đang đi lên) khẳng định rằng ngành này đang phát triển (''a growing industry''). Do đó, tiêu đề ''A measurable, growing industry'' tóm tắt chính xác cả hai ý chính của đoạn.'
          distractor_analysis:
          - option: ii
            why_wrong_vi: Phương án này sai vì chủ đề 'uniformity' (sự đồng nhất) và tại sao nó từng được coi là 'progress' (sự tiến bộ) là nội dung chính của đoạn A, không phải đoạn C.
          - option: iii
            why_wrong_vi: Phương án này sai vì 'Two real difficulties' (hai khó khăn thực sự) là chủ đề của đoạn D, nơi bài viết đề cập rõ ràng đến vấn đề giá cả (price) và tính nhất quán (consistency).
          - option: iv
            why_wrong_vi: Phương án này sai vì 'Two reasons buyers are drawn back to makers' (hai lý do người mua bị thu hút trở lại) được trình bày trong đoạn B, đó là sự tò mò (curiosity) và mối quan tâm về rác thải (concern about waste).
          - option: v
            why_wrong_vi: Phương án này sai vì nó mô tả nội dung của đoạn E, vốn bàn về tương lai của phong trào ('Whether the movement will continue to grow is an open question'). Đoạn C tập trung vào việc đo lường quy mô và xu hướng hiện tại của ngành.
      - q_num: 4
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph D."
        options:
          - { label: i,   text: "A measurable, growing industry" }
          - { label: ii,  text: "Why uniformity once seemed like progress" }
          - { label: iii, text: "Two real difficulties for the movement" }
          - { label: iv,  text: "Two reasons buyers are drawn back to makers" }
          - { label: v,   text: "What the future might look like" }
        answer: "iii"
        alternatives: []
        skill_tag: skimming
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc câu đầu tiên của đoạn D: "Critics point out two awkward facts" (Những người chỉ trích chỉ ra hai sự thật khó xử). Câu này báo hiệu rằng nội dung chính của đoạn văn sẽ trình bày về hai vấn đề hoặc hai điểm yếu.'
          - action: confirm
            instruction_vi: Xác định hai vấn đề được liệt kê trong đoạn. Vấn đề thứ nhất là giá cả ("The first is price") và vấn đề thứ hai là sự thiếu nhất quán ("The second is consistency").
          - action: infer
            instruction_vi: So sánh nội dung này với các phương án. Cụm từ "two awkward facts" (hai sự thật khó xử) tương đương với "Two real difficulties" (Hai khó khăn thực sự). Do đó, phương án 'iii' tóm tắt chính xác nhất ý chính của cả đoạn D.
          distractor_analysis:
          - option: i
            why_wrong_vi: Phương án này sai vì nội dung về một ngành công nghiệp có thể đo lường và đang phát triển nằm ở đoạn C, với các chi tiết như "it is hard to measure" (khó đo lường), "A 2021 survey" (một cuộc khảo sát năm 2021) và "the trajectory is upward" (có xu hướng đi lên). Đoạn D không đề cập đến các số liệu hay sự tăng trưởng.
          - option: ii
            why_wrong_vi: 'Phương án này sai vì lý do tại sao sự đồng nhất từng được coi là tiến bộ được giải thích ở đoạn A: "For decades this uniformity was treated as a sign of progress". Đoạn D tập trung vào những khó khăn của hàng thủ công, không phải lợi ích của hàng sản xuất hàng loạt trong quá khứ.'
          - option: iv
            why_wrong_vi: Phương án này sai vì nó mô tả hai lý do người mua quay trở lại với các nhà sản xuất thủ công. Đây là nội dung của đoạn B, nơi đề cập đến "simple curiosity" (sự tò mò đơn thuần) và "concern about waste" (mối lo ngại về rác thải). Đoạn D nói về những lý do khiến người mua e ngại (giá cao, không nhất quán), tức là mặt trái của vấn đề.
          - option: v
            why_wrong_vi: Phương án này sai vì việc dự đoán về tương lai của phong trào này là chủ đề của đoạn E, được thể hiện qua các cụm từ như "Whether the movement will continue to grow" (Liệu phong trào có tiếp tục phát triển hay không) và "What the future might look like" (Tương lai có thể sẽ ra sao). Đoạn D chỉ nói về các vấn đề hiện tại.
      - q_num: 5
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph E."
        options:
          - { label: i,   text: "A measurable, growing industry" }
          - { label: ii,  text: "Why uniformity once seemed like progress" }
          - { label: iii, text: "Two real difficulties for the movement" }
          - { label: iv,  text: "Two reasons buyers are drawn back to makers" }
          - { label: v,   text: "What the future might look like" }
        answer: "v"
        alternatives: []
        skill_tag: skimming
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc câu đầu tiên của đoạn E: ''Whether the movement will continue to grow is an open question'' (Liệu phong trào có tiếp tục phát triển hay không vẫn là một câu hỏi bỏ ngỏ). Câu này ngay lập tức định hướng chủ đề của đoạn văn về tương lai và sự không chắc chắn.'
          - action: infer
            instruction_vi: Phân tích các câu tiếp theo. Các cụm từ như 'will probably never replace' (có lẽ sẽ không bao giờ thay thế) và 'may yet reshape' (vẫn có thể định hình lại) đều là những dự đoán, phỏng đoán về những gì có thể xảy ra trong tương lai. Toàn bộ đoạn văn không nói về hiện tại hay quá khứ, mà là về một viễn cảnh.
          - action: confirm
            instruction_vi: So sánh ý chính vừa rút ra (bàn về tương lai của phong trào) với các phương án. Phương án (v) 'What the future might look like' (Tương lai có thể sẽ ra sao) diễn đạt chính xác nhất chủ đề bao quát của cả đoạn E.
          distractor_analysis:
          - option: i
            why_wrong_vi: Phương án này sai vì đoạn E không hề cung cấp số liệu hay thông tin về việc đo lường ngành công nghiệp này. Các chi tiết về số liệu ('150,000 people') và sự tăng trưởng ('trajectory is upward') được đề cập ở đoạn C.
          - option: ii
            why_wrong_vi: Phương án này sai vì nó mô tả nội dung của đoạn A, nơi giải thích tại sao trong quá khứ 'uniformity was treated as a sign of progress' (sự đồng nhất được coi là một dấu hiệu của sự tiến bộ). Đoạn E tập trung vào tương lai, không phải quá khứ.
          - option: iii
            why_wrong_vi: Phương án này sai vì đoạn E không liệt kê bất kỳ khó khăn nào. Việc đề cập đến 'two awkward facts' (hai sự thật khó xử) là 'price' (giá cả) và 'consistency' (tính nhất quán) là nội dung chính của đoạn D.
          - option: iv
            why_wrong_vi: Phương án này sai vì nó tóm tắt ý chính của đoạn B, nơi nêu ra hai lý do người mua bị thu hút là 'simple curiosity' (sự tò mò) và 'concern about waste' (mối lo ngại về rác thải). Đoạn E không giải thích lý do tại sao phong trào này phổ biến.
      - q_num: 6
        question_type: true_false_not_given
        prompt: "Hand-made goods are usually cheaper than mass-produced equivalents."
        answer: "FALSE"
        alternatives: ["F", "false"]
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đầu tiên, xác định các từ khóa trong câu hỏi: ''Hand-made goods'' (đồ thủ công), ''cheaper'' (rẻ hơn), và ''mass-produced equivalents'' (sản phẩm tương đương sản xuất hàng loạt). Sau đó, tìm những từ này hoặc từ đồng nghĩa trong đoạn văn để định vị thông tin liên quan đến việc so sánh giá cả.'
          - action: confirm
            instruction_vi: Đoạn A so sánh giá trực tiếp, nói rằng đồ thủ công được bán 'often at prices **well above** the mass-produced equivalents' (thường ở mức giá cao hơn nhiều so với các sản phẩm tương đương được sản xuất hàng loạt). Cụm từ 'well above' (cao hơn nhiều) trái ngược hoàn toàn với 'cheaper' (rẻ hơn).
          - action: confirm
            instruction_vi: 'Đoạn D củng cố thêm bằng chứng này khi chỉ ra rằng giá cả là một vấn đề: ''A hand-thrown mug typically costs **five to ten times more than** its industrial cousin'' (Một chiếc cốc nặn tay thường có giá cao hơn từ năm đến mười lần so với sản phẩm công nghiệp tương đương). Thông tin này khẳng định một cách chắc chắn rằng đồ thủ công đắt hơn nhiều. Do đó, câu hỏi là sai.'
          distractor_analysis:
          - option: 'TRUE'
            why_wrong_vi: Phương án này sai vì đoạn văn đưa ra bằng chứng rõ ràng và nhất quán rằng đồ thủ công đắt hơn đáng kể, chứ không rẻ hơn. Cả đoạn A ('prices well above') và đoạn D ('five to ten times more') đều trực tiếp phủ nhận điều này.
          - option: NOT GIVEN
            why_wrong_vi: Phương án này sai vì đoạn văn có cung cấp thông tin trực tiếp và cụ thể để so sánh giá cả giữa đồ thủ công và đồ sản xuất hàng loạt. Vì thông tin so sánh giá được nêu rõ, chúng ta có thể kết luận câu hỏi là đúng hay sai, chứ không phải là không có thông tin.
      - q_num: 7
        question_type: true_false_not_given
        prompt: "Online videos of makers at work have attracted large audiences."
        answer: "TRUE"
        alternatives: ["T", "true"]
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Xác định các từ khóa trong câu hỏi: ''Online videos'', ''makers at work'', ''large audiences''. Tìm các từ/cụm từ này hoặc từ đồng nghĩa trong đoạn văn. Đoạn B chứa thông tin liên quan.'
          - action: confirm
            instruction_vi: 'So sánh thông tin trong câu hỏi với câu trong đoạn B: ''...videos of a knife being forged or a chair being jointed regularly attract millions of viewers.'' Cụm từ ''attract millions of viewers'' (thu hút hàng triệu người xem) có ý nghĩa tương đương với ''attracted large audiences'' (đã thu hút lượng lớn khán giả). Do đó, câu hỏi là một khẳng định đúng dựa trên đoạn văn.'
          distractor_analysis:
          - option: 'FALSE'
            why_wrong_vi: Phương án này sai vì để là FALSE, đoạn văn phải đưa ra thông tin trái ngược, chẳng hạn như các video này không phổ biến hoặc chỉ thu hút một lượng nhỏ khán giả. Tuy nhiên, đoạn văn lại khẳng định chúng 'regularly attract millions of viewers' (thường xuyên thu hút hàng triệu người xem), điều này hoàn toàn ủng hộ câu hỏi.
          - option: NOT GIVEN
            why_wrong_vi: Phương án này sai vì để là NOT GIVEN, đoạn văn sẽ không đề cập đến quy mô khán giả của các video. Trong trường hợp này, bài đọc đã cung cấp thông tin rất cụ thể về số lượng người xem ('millions of viewers'), cho phép chúng ta đưa ra kết luận chắc chắn là TRUE.
      - q_num: 8
        question_type: true_false_not_given
        prompt: "Most hand-made craft sales are tracked in official retail data."
        answer: "FALSE"
        alternatives: ["F", "false"]
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Định vị phần văn bản nói về việc đo lường/theo dõi doanh số bán hàng thủ công. Đoạn C chứa thông tin này, bắt đầu bằng: ''Economists have been slower to take the movement seriously, partly because it is hard to measure.'''
          - action: decode_vocab
            instruction_vi: 'Phân tích lý do tại sao việc đo lường lại khó khăn. Câu tiếp theo giải thích: ''Most hand-made goods are sold outside the conventional retail system, in small batches and sometimes for cash.'' (Hầu hết hàng thủ công được bán bên ngoài hệ thống bán lẻ thông thường, theo lô nhỏ và đôi khi bằng tiền mặt).'
          - action: confirm
            instruction_vi: So sánh thông tin từ đoạn văn với câu hỏi. Câu hỏi nói rằng 'hầu hết doanh số' được 'theo dõi trong dữ liệu bán lẻ chính thức' (tracked in official retail data). Đoạn văn lại khẳng định chúng được bán 'bên ngoài hệ thống bán lẻ thông thường' (sold outside the conventional retail system). Đây là một sự mâu thuẫn trực tiếp. Do đó, đáp án là FALSE.
          distractor_analysis:
          - option: 'TRUE'
            why_wrong_vi: Phương án này sai vì đoạn văn khẳng định điều ngược lại. Cụm từ 'sold outside the conventional retail system' (được bán bên ngoài hệ thống bán lẻ thông thường) trong đoạn C trực tiếp mâu thuẫn với ý rằng doanh số được theo dõi trong dữ liệu bán lẻ chính thức.
          - option: NOT GIVEN
            why_wrong_vi: Phương án này sai vì đoạn văn có cung cấp thông tin rõ ràng để xác định tính đúng sai của câu hỏi. Việc hàng hóa được bán 'bên ngoài hệ thống bán lẻ thông thường' cho phép chúng ta suy luận một cách chắc chắn rằng doanh số của chúng không được theo dõi trong dữ liệu bán lẻ chính thức.
      - q_num: 9
        question_type: true_false_not_given
        prompt: "A specific 2024 government policy is mentioned as a cause of the trend."
        answer: "NOT GIVEN"
        alternatives: ["NG", "not given"]
        skill_tag: writer_view_TFNG
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Xác định phần của đoạn văn nói về NGUYÊN NHÂN (causes) của xu hướng. Đoạn B bắt đầu bằng 'Several factors lie behind the shift' (Nhiều yếu tố nằm sau sự thay đổi này) và tiếp tục liệt kê các nguyên nhân.
          - action: confirm
            instruction_vi: 'Kiểm tra các nguyên nhân được liệt kê trong Đoạn B. Bài viết đề cập đến hai yếu tố: ''simple curiosity'' (sự tò mò đơn thuần) và ''concern about waste'' (mối lo ngại về rác thải). Không có bất kỳ thông tin nào về ''government policy'' (chính sách của chính phủ) hay năm ''2024''.'
          - action: infer
            instruction_vi: Vì đoạn văn có thảo luận về các nguyên nhân nhưng không hề nhắc đến chính sách của chính phủ, chúng ta không thể xác nhận hay phủ nhận thông tin trong câu hỏi. Do đó, câu trả lời phải là NOT GIVEN.
          distractor_analysis:
          - option: 'TRUE'
            why_wrong_vi: Để là TRUE, đoạn văn phải khẳng định rằng một chính sách của chính phủ năm 2024 là một trong những nguyên nhân. Tuy nhiên, các nguyên nhân được liệt kê trong đoạn B là 'simple curiosity' và 'concern about waste', không hề có thông tin nào về chính sách chính phủ.
          - option: 'FALSE'
            why_wrong_vi: Để là FALSE, đoạn văn phải đưa ra thông tin trái ngược, ví dụ như 'xu hướng này phát triển bất chấp việc không có chính sách nào của chính phủ' hoặc 'nguyên nhân không phải là do chính sách'. Đoạn văn chỉ đơn giản là không đề cập đến chủ đề này, vì vậy không có cơ sở để kết luận câu hỏi là sai.
      - q_num: 10
        question_type: short_answer
        prompt: "Which industry is the 150,000 craft figure compared with? (ONE word)"
        answer: coal
        alternatives: []
        skill_tag: scanning
        solution:
          solution_steps:
            - action: locate
              instruction_vi: "Quét (scan) tìm con số '150,000' trong bài — số liệu là 'mỏ neo' dễ định vị nhanh."
              kp_refs:
                - {type: skill, slug: scanning}
            - action: parse_syntax
              instruction_vi: "Bài dùng cấu trúc so sánh 'more than …': '150,000 people — more than the country's coal industry'. Ngành đứng sau 'more than' chính là đáp án."
              kp_refs:
                - {type: grammar, slug: comparison, anchor: comparison.overview}
              microcheck:
                prompt: "Trong '150,000 people — more than the country's coal industry', ngành đứng sau 'more than' đóng vai trò gì?"
                options:
                  - "là ngành được đem ra so sánh (đáp án: coal)"
                  - "là chủ ngữ của câu"
                  - "không liên quan tới đáp án"
                answer: "A"
            - action: confirm
              instruction_vi: "Ngành được đem so sánh là 'coal' → đáp án: coal."
      - q_num: 11
        question_type: short_answer
        prompt: "How many times more expensive can a hand-thrown mug be? (ONE word)"
        answer: ten
        alternatives: ["10"]
        skill_tag: scanning
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đầu tiên, xác định từ khoá trong câu hỏi: ''how many times more expensive'' (đắt hơn bao nhiêu lần) và ''hand-thrown mug'' (cốc nặn tay). Sau đó, quét (scan) đoạn văn để tìm thông tin về giá của sản phẩm này. Đoạn D đề cập trực tiếp đến vấn đề này.'
          - action: confirm
            instruction_vi: Trong đoạn D, câu văn 'A hand-thrown mug typically costs five to ten times more than its industrial cousin...' cho biết một chiếc cốc nặn tay thường có giá đắt hơn 'từ năm đến mười lần'. Câu hỏi 'How many times more expensive CAN a hand-thrown mug be?' (một chiếc cốc nặn tay CÓ THỂ đắt hơn bao nhiêu lần?) hỏi về mức giá tối đa có thể có. Con số tối đa trong khoảng 'five to ten' là 'ten'. Do đó, đáp án là 'ten'.
      - q_num: 12
        question_type: short_answer
        prompt: "What do defenders say each piece is a record of? (TWO words)"
        answer: "maker's choices"
        alternatives: ["maker choices"]
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Xác định vị trí thông tin bằng cách tìm các từ khóa trong câu hỏi như ''defenders'', ''each piece'' và ''record of''. Đoạn D chứa câu trả lời trực tiếp: ''Defenders argue that the variation is precisely the point — each piece is a record of the maker''s choices on a particular day.'''
          - action: confirm
            instruction_vi: Đối chiếu câu văn với câu hỏi. Câu hỏi là 'What do defenders say each piece is a record of?'. Câu trong bài trả lời rằng 'each piece is a record of the maker's choices'. Theo yêu cầu điền TỐI ĐA HAI TỪ, ta lấy cụm danh từ chính là 'maker's choices' làm đáp án.
      - q_num: 13
        question_type: short_answer
        prompt: "Where does the writer say the movement has carved out a niche? (TWO words)"
        answer: "higher end"
        alternatives: ["the higher end"]
        skill_tag: scanning
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Đọc lướt (scan) đoạn văn để tìm các từ khóa trong câu hỏi là 'carved out a niche'. Cụm từ này xuất hiện ở đoạn văn cuối cùng (đoạn E).
          - action: confirm
            instruction_vi: 'Câu văn chứa từ khóa là: ''But they appear to have carved out a stable niche at the higher end of the market...''. Câu hỏi là ''Where'' (Ở đâu?), và câu văn chỉ rõ ''niche'' (thị trường ngách) này được tạo ra ''at the higher end of the market'' (ở phân khúc cao cấp của thị trường). Theo yêu cầu điền HAI TỪ, đáp án chính xác là ''higher end''.'

  # ── Passage 2 — Qs 14–26 ────────────────────────────────────────
  - passage_order: 2
    slug: l3-t1-p2-how-cities-stay-cool
    title: "How Cities Stay Cool"
    word_count: 580
    topic_tags: [urban-planning, environment]
    body_markdown: |
      A In summer, the centre of a large city can be five degrees warmer
      than the countryside around it. The reason is no mystery: dark
      surfaces such as asphalt and roofing tar absorb sunlight, hold the
      heat, and release it slowly through the night. Add the warmth
      generated by traffic, air-conditioning units and millions of human
      bodies, and the result is what climate scientists call the urban
      heat-island effect. It is uncomfortable; in heatwave years, it is
      also dangerous.

      B Until recently most cities accepted the problem as a fact of
      modern life. That has begun to change. Planners now treat heat as
      an engineering challenge no different from flooding or waste — one
      that better building materials, smarter street design and more
      vegetation can measurably reduce. Three approaches have attracted
      particular interest: cool roofs, urban trees, and what some
      researchers call "blue corridors".

      C A cool roof is, in its simplest form, a roof painted white. Light-
      coloured surfaces reflect rather than absorb solar radiation, and
      can run twenty degrees cooler than a dark roof on the same day.
      Long used in hot, dry parts of the Mediterranean, the technique is
      now being adopted in cities as different as Los Angeles, Cairo and
      Ahmedabad. The savings are not only thermal: a cooler roof reduces
      the work done by air-conditioning underneath, lowering energy bills
      and the emissions associated with them.

      D Trees do something more sophisticated. They shade the ground
      directly, but they also cool the air through a process called
      evapotranspiration — releasing water through their leaves as
      vapour. A mature street tree can lower the temperature within its
      canopy by up to three degrees on a hot afternoon, while also
      filtering particulates from the air. The catch is time: a sapling
      planted today will not deliver its full cooling effect for fifteen
      or twenty years.

      E Blue corridors — networks of canals, rivers and ponds threaded
      through built-up areas — work in a similar way, using the high
      heat capacity of water to absorb daytime warmth and release it
      slowly. Singapore has invested heavily in these features, and
      Copenhagen now incorporates new water channels as a standard part
      of large redevelopments. Critics note that such corridors are
      expensive and demand careful maintenance to avoid stagnation and
      mosquito breeding, but the cooling benefits in dense neighbourhoods
      can be substantial.

      F No single intervention is enough on its own. Cities that have
      cooled measurably in recent years — Medellín in Colombia is the
      most-studied example — have done so by combining all three
      strategies and by treating heat as a city-wide planning issue
      rather than a per-building problem.
    questions:
      - q_num: 14
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph A."
        options:
          - { label: i,   text: "Why a single tactic is not enough" }
          - { label: ii,  text: "Painting the roof white" }
          - { label: iii, text: "What heat does to a city" }
          - { label: iv,  text: "The slow gift of urban trees" }
          - { label: v,   text: "From accepted problem to engineering challenge" }
          - { label: vi,  text: "Water as a cooling surface" }
        answer: "iii"
        alternatives: []
        skill_tag: skimming
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc toàn bộ đoạn A để xác định chủ đề chính. Đoạn văn giới thiệu một hiện tượng: ''the centre of a large city can be five degrees warmer than the countryside'' (trung tâm thành phố có thể nóng hơn vùng nông thôn 5 độ).'
          - action: confirm
            instruction_vi: Xác nhận rằng đoạn văn tiếp tục giải thích nguyên nhân ('dark surfaces such as asphalt and roofing tar absorb sunlight') và tác động ('It is uncomfortable; ... it is also dangerous') của hiện tượng này, đặt tên cho nó là 'urban heat-island effect'. Do đó, tiêu đề 'What heat does to a city' (Nhiệt độ gây ra điều gì cho thành phố) tóm tắt chính xác toàn bộ nội dung.
          distractor_analysis:
          - option: i
            why_wrong_vi: Phương án này sai vì đoạn A chỉ mô tả vấn đề (hiệu ứng đảo nhiệt đô thị) chứ không hề đề cập đến bất kỳ 'tactic' (chiến thuật/giải pháp) nào. Việc phân tích các giải pháp và kết luận một giải pháp là không đủ là nội dung của đoạn F.
          - option: ii
            why_wrong_vi: Phương án này sai vì việc 'sơn mái nhà màu trắng' là một giải pháp cụ thể được thảo luận trong đoạn C ('A cool roof is, in its simplest form, a roof painted white'). Đoạn A không nhắc đến giải pháp này.
          - option: iv
            why_wrong_vi: Phương án này sai vì 'cây xanh đô thị' (urban trees) là một giải pháp được trình bày chi tiết trong đoạn D. Đoạn A hoàn toàn không đề cập đến cây cối.
          - option: v
            why_wrong_vi: Phương án này sai vì nó mô tả sự thay đổi trong cách nhìn nhận vấn đề, từ một 'vấn đề được chấp nhận' thành một 'thách thức kỹ thuật'. Đây là nội dung chính của đoạn B ('Until recently most cities accepted the problem... That has begun to change').
          - option: vi
            why_wrong_vi: Phương án này sai vì việc sử dụng 'nước làm bề mặt làm mát' (blue corridors) là một giải pháp được mô tả trong đoạn E. Đoạn A không chứa thông tin này.
      - q_num: 15
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph B."
        options:
          - { label: i,   text: "Why a single tactic is not enough" }
          - { label: ii,  text: "Painting the roof white" }
          - { label: iii, text: "What heat does to a city" }
          - { label: iv,  text: "The slow gift of urban trees" }
          - { label: v,   text: "From accepted problem to engineering challenge" }
          - { label: vi,  text: "Water as a cooling surface" }
        answer: "v"
        alternatives: []
        skill_tag: skimming
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc hai câu đầu của đoạn B: ''Until recently most cities accepted the problem as a fact of modern life. That has begun to change.'' (Cho đến gần đây, hầu hết các thành phố chấp nhận vấn đề này như một sự thật của cuộc sống hiện đại. Điều đó đã bắt đầu thay đổi.) Điều này cho thấy một sự chuyển đổi trong thái độ.'
          - action: parse_syntax
            instruction_vi: 'Phân tích câu thứ ba: ''Planners now treat heat as an engineering challenge...'' (Các nhà quy hoạch bây giờ coi nhiệt độ như một thách thức kỹ thuật...). Câu này xác định rõ bản chất của sự thay đổi: từ một ''vấn đề được chấp nhận'' (accepted problem) trở thành một ''thách thức kỹ thuật'' (engineering challenge).'
          - action: confirm
            instruction_vi: So sánh ý chính này với phương án (v) 'From accepted problem to engineering challenge' (Từ một vấn đề được chấp nhận đến một thách thức kỹ thuật). Phương án này tóm tắt một cách hoàn hảo sự chuyển đổi được mô tả trong đoạn B.
          distractor_analysis:
          - option: i
            why_wrong_vi: Phương án này sai vì ý tưởng 'một chiến thuật đơn lẻ là không đủ' ('a single tactic is not enough') là chủ đề chính của đoạn F ('No single intervention is enough on its own'), không phải đoạn B.
          - option: ii
            why_wrong_vi: Phương án này sai vì 'sơn mái nhà màu trắng' ('Painting the roof white') là một chi tiết cụ thể, là ví dụ đơn giản nhất của 'mái nhà mát' (cool roof) được thảo luận chi tiết ở đoạn C. Đoạn B chỉ liệt kê 'cool roofs' như một trong ba phương pháp.
          - option: iii
            why_wrong_vi: Phương án này sai vì 'tác động của nhiệt độ đối với thành phố' ('What heat does to a city') là chủ đề của đoạn A, nơi mô tả 'hiệu ứng đảo nhiệt đô thị' (urban heat-island effect) và sự nguy hiểm của nó.
          - option: iv
            why_wrong_vi: Phương án này sai vì 'món quà chậm rãi của cây xanh đô thị' ('The slow gift of urban trees') là chủ đề của đoạn D, nơi giải thích cơ chế làm mát của cây và nhược điểm về thời gian ('a sapling planted today will not deliver its full cooling effect for fifteen or twenty years').
          - option: vi
            why_wrong_vi: Phương án này sai vì 'nước như một bề mặt làm mát' ('Water as a cooling surface') là ý chính của đoạn E, nơi mô tả về 'hành lang xanh dương' (blue corridors) như kênh rạch, sông ngòi.
      - q_num: 16
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph C."
        options:
          - { label: i,   text: "Why a single tactic is not enough" }
          - { label: ii,  text: "Painting the roof white" }
          - { label: iii, text: "What heat does to a city" }
          - { label: iv,  text: "The slow gift of urban trees" }
          - { label: v,   text: "From accepted problem to engineering challenge" }
          - { label: vi,  text: "Water as a cooling surface" }
        answer: "ii"
        alternatives: []
        skill_tag: skimming
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc câu đầu tiên của đoạn C để xác định chủ đề chính: ''A cool roof is, in its simplest form, a roof painted white'' (Mái nhà mát, ở dạng đơn giản nhất, là một mái nhà được sơn màu trắng).'
          - action: confirm
            instruction_vi: 'Xác nhận rằng các câu còn lại trong đoạn đều triển khai ý tưởng này: giải thích cách hoạt động (''Light-coloured surfaces reflect rather than absorb solar radiation''), đưa ra ví dụ (Los Angeles, Cairo), và nêu lợi ích (''lowering energy bills''). Do đó, toàn bộ đoạn văn tập trung vào giải pháp ''sơn mái nhà màu trắng''.'
          distractor_analysis:
          - option: i
            why_wrong_vi: 'Phương án này sai vì đoạn C chỉ tập trung mô tả MỘT chiến thuật duy nhất là ''cool roofs''. Ý tưởng ''một chiến thuật là không đủ'' (a single tactic is not enough) là nội dung chính của đoạn F: ''No single intervention is enough on its own''.'
          - option: iii
            why_wrong_vi: Phương án này sai vì đoạn C nói về một giải pháp để *giảm* hơi nóng, chứ không mô tả 'hơi nóng gây ra tác hại gì cho thành phố'. Tác động của hơi nóng được đề cập trong đoạn A, nơi mô tả 'urban heat-island effect' là 'uncomfortable' (khó chịu) và 'dangerous' (nguy hiểm).
          - option: iv
            why_wrong_vi: Phương án này không liên quan. Đoạn C không hề đề cập đến 'urban trees' (cây xanh đô thị). Chủ đề về cây cối được thảo luận chi tiết trong đoạn D.
          - option: v
            why_wrong_vi: Phương án này không phù hợp. Đoạn C không nói về sự thay đổi trong cách nhìn nhận vấn đề. Sự chuyển đổi từ 'vấn đề được chấp nhận' sang 'thách thức kỹ thuật' ('accepted problem to engineering challenge') là ý chính của đoạn B.
          - option: vi
            why_wrong_vi: Phương án này không chính xác. Đoạn C không nói về 'water' (nước). Việc sử dụng nước làm bề mặt làm mát, hay 'blue corridors', là nội dung của đoạn E.
      - q_num: 17
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph D."
        options:
          - { label: i,   text: "Why a single tactic is not enough" }
          - { label: ii,  text: "Painting the roof white" }
          - { label: iii, text: "What heat does to a city" }
          - { label: iv,  text: "The slow gift of urban trees" }
          - { label: v,   text: "From accepted problem to engineering challenge" }
          - { label: vi,  text: "Water as a cooling surface" }
        answer: "iv"
        alternatives: []
        skill_tag: skimming
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Đọc lướt đoạn D để xác định chủ đề chính. Câu đầu tiên 'Trees do something more sophisticated' giới thiệu ngay chủ đề của đoạn là về cây cối (trees) như một giải pháp làm mát.
          - action: infer
            instruction_vi: Phân tích nội dung đoạn để tìm các ý bổ trợ. Đoạn văn mô tả các lợi ích ('gift') của cây như 'lower the temperature' (giảm nhiệt độ) và 'filtering particulates from the air' (lọc các hạt bụi trong không khí).
          - action: confirm
            instruction_vi: 'Xác định chi tiết quan trọng nhất để phân biệt với các phương án khác. Câu cuối cùng nhấn mạnh đến yếu tố thời gian: ''The catch is time: a sapling planted today will not deliver its full cooling effect for fifteen or twenty years''. Cụm từ này trực tiếp chứng minh cho tính từ ''slow'' (chậm) trong phương án (iv), khiến nó trở thành tiêu đề tóm tắt đầy đủ nhất.'
          distractor_analysis:
          - option: i
            why_wrong_vi: 'Phương án ''Why a single tactic is not enough'' (Tại sao một chiến thuật đơn lẻ là không đủ) là ý chính của đoạn F, được thể hiện ngay ở câu đầu tiên: ''No single intervention is enough on its own''. Đoạn D chỉ tập trung vào một chiến thuật duy nhất là cây cối.'
          - option: ii
            why_wrong_vi: Phương án 'Painting the roof white' (Sơn mái nhà màu trắng) là chủ đề chính của đoạn C, nơi mô tả giải pháp 'cool roof' là 'a roof painted white'. Đoạn D không hề nhắc tới việc sơn mái nhà.
          - option: iii
            why_wrong_vi: Phương án 'What heat does to a city' (Nhiệt độ gây ra gì cho thành phố) mô tả vấn đề, không phải giải pháp. Nội dung này thuộc về đoạn A, nơi giải thích về 'urban heat-island effect' (hiệu ứng đảo nhiệt đô thị) và các tác động của nó.
          - option: v
            why_wrong_vi: 'Phương án ''From accepted problem to engineering challenge'' (Từ một vấn đề được chấp nhận đến một thách thức kỹ thuật) là ý chính của đoạn B, nói về sự thay đổi trong cách tiếp cận vấn đề của các nhà quy hoạch: ''Until recently most cities accepted the problem... That has begun to change''.'
          - option: vi
            why_wrong_vi: Phương án 'Water as a cooling surface' (Nước như một bề mặt làm mát) là chủ đề của đoạn E, nơi mô tả các 'Blue corridors' (hành lang xanh dương) sử dụng 'canals, rivers and ponds' (kênh, sông và ao hồ) để làm mát.
      - q_num: 18
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph E."
        options:
          - { label: i,   text: "Why a single tactic is not enough" }
          - { label: ii,  text: "Painting the roof white" }
          - { label: iii, text: "What heat does to a city" }
          - { label: iv,  text: "The slow gift of urban trees" }
          - { label: v,   text: "From accepted problem to engineering challenge" }
          - { label: vi,  text: "Water as a cooling surface" }
        answer: "vi"
        alternatives: []
        skill_tag: skimming
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc câu đầu tiên của đoạn E để xác định chủ đề chính: ''Blue corridors — networks of canals, rivers and ponds threaded through built-up areas — work in a similar way...'' Câu này giới thiệu khái niệm ''Blue corridors'' (hành lang xanh dương) và định nghĩa chúng là mạng lưới các kênh, sông, hồ.'
          - action: infer
            instruction_vi: 'Phân tích cách các ''blue corridors'' này hoạt động, dựa trên vế sau của câu đầu tiên: ''...using the high heat capacity of water to absorb daytime warmth...'' (sử dụng nhiệt dung cao của nước để hấp thụ hơi nóng ban ngày). Điều này cho thấy vai trò cốt lõi của ''water'' (nước) là một phương tiện làm mát.'
          - action: confirm
            instruction_vi: 'So sánh ý chính vừa phân tích (nước được dùng để hấp thụ nhiệt và làm mát) với các phương án. Phương án ''vi: Water as a cooling surface'' (Nước như một bề mặt làm mát) tóm tắt chính xác và trực tiếp nhất toàn bộ nội dung của đoạn E.'
          distractor_analysis:
          - option: i
            why_wrong_vi: Phương án này sai vì ý tưởng 'một chiến thuật đơn lẻ là không đủ' ('a single tactic is not enough') là nội dung chính của đoạn F ('No single intervention is enough on its own'), không phải đoạn E.
          - option: ii
            why_wrong_vi: Phương án này sai vì việc 'sơn mái nhà màu trắng' ('Painting the roof white') là chủ đề của đoạn C, nơi mô tả giải pháp 'cool roof' (mái nhà mát).
          - option: iii
            why_wrong_vi: Phương án này sai vì nó mô tả 'tác động của nhiệt lên thành phố' ('What heat does to a city'), vốn là chủ đề của đoạn A. Đoạn E tập trung vào một giải pháp, không phải vấn đề.
          - option: iv
            why_wrong_vi: Phương án này sai vì chủ đề 'cây xanh trong đô thị' ('urban trees') và tác dụng làm mát từ từ của chúng được thảo luận chi tiết ở đoạn D, không phải đoạn E.
          - option: v
            why_wrong_vi: Phương án này sai vì sự thay đổi trong cách nhìn nhận vấn đề nhiệt độ, từ 'vấn đề phải chấp nhận' sang 'thách thức kỹ thuật' ('engineering challenge'), được đề cập trong đoạn B.
      - q_num: 19
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph F."
        options:
          - { label: i,   text: "Why a single tactic is not enough" }
          - { label: ii,  text: "Painting the roof white" }
          - { label: iii, text: "What heat does to a city" }
          - { label: iv,  text: "The slow gift of urban trees" }
          - { label: v,   text: "From accepted problem to engineering challenge" }
          - { label: vi,  text: "Water as a cooling surface" }
        answer: "i"
        alternatives: []
        skill_tag: skimming
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc câu đầu tiên của đoạn F: ''No single intervention is enough on its own'' (Không một biện pháp riêng lẻ nào là đủ). Câu này trực tiếp nêu ra ý chính của cả đoạn văn.'
          - action: confirm
            instruction_vi: So sánh ý chính này với các phương án, ta thấy phương án (i) 'Why a single tactic is not enough' (Tại sao một chiến thuật đơn lẻ là không đủ) diễn đạt lại một cách chính xác nội dung của câu chủ đề trên. Câu thứ hai của đoạn F củng cố thêm ý này khi nói rằng các thành phố thành công đã 'combining all three strategies' (kết hợp cả ba chiến lược).
          distractor_analysis:
          - option: ii
            why_wrong_vi: Phương án này ('Sơn mái nhà màu trắng') là nội dung chính của đoạn C, nơi mô tả về giải pháp 'cool roof'. Đoạn F không đề cập đến việc sơn mái nhà.
          - option: iii
            why_wrong_vi: Phương án này ('Nhiệt độ gây ra gì cho thành phố') mô tả vấn đề được nêu ở đoạn A (hiệu ứng đảo nhiệt đô thị 'uncomfortable' và 'dangerous'). Đoạn F nói về tính hiệu quả của các giải pháp, không phải về tác động của vấn đề.
          - option: iv
            why_wrong_vi: Phương án này ('Món quà chậm rãi của cây xanh đô thị') là chủ đề của đoạn D, vốn tập trung vào lợi ích và hạn chế của cây xanh. Đoạn F chỉ đề cập đến việc kết hợp các chiến lược nói chung.
          - option: v
            why_wrong_vi: Phương án này ('Từ một vấn đề được chấp nhận đến một thách thức kỹ thuật') tóm tắt sự thay đổi trong quan điểm được mô tả ở đoạn B. Đoạn F không nói về sự thay đổi trong cách tiếp cận này.
          - option: vi
            why_wrong_vi: Phương án này ('Nước như một bề mặt làm mát') là nội dung chính của đoạn E, nơi thảo luận về 'blue corridors' (hành lang xanh dương). Đoạn F không tập trung vào giải pháp sử dụng nước.
      - q_num: 20
        question_type: mcq_single
        prompt: "According to paragraph C, the main NON-thermal benefit of a cool roof is"
        options:
          - { label: A, text: "longer roof life" }
          - { label: B, text: "lower air-conditioning energy use and emissions" }
          - { label: C, text: "cheaper paint materials" }
          - { label: D, text: "easier rooftop maintenance" }
        answer: "B"
        alternatives: []
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Xác định từ khóa trong câu hỏi là 'paragraph C' và 'NON-thermal benefit' (lợi ích phi nhiệt). Tìm câu trong đoạn C đề cập đến lợi ích không chỉ là về nhiệt độ.
          - action: confirm
            instruction_vi: 'Đoạn văn viết: ''The savings are not only thermal: a cooler roof reduces the work done by air-conditioning underneath, lowering energy bills and the emissions associated with them''. Câu này trực tiếp nêu rõ lợi ích phi nhiệt là giảm việc sử dụng điều hòa, từ đó ''giảm hóa đơn tiền điện và lượng khí thải liên quan'', hoàn toàn trùng khớp với phương án B.'
          distractor_analysis:
          - option: A
            why_wrong_vi: Đoạn C không hề đề cập đến tuổi thọ của mái nhà ('longer roof life'). Đây là thông tin không có trong bài đọc.
          - option: C
            why_wrong_vi: Đoạn C chỉ nói mái nhà được sơn trắng ('a roof painted white') chứ không cung cấp thông tin nào về việc vật liệu sơn này rẻ hơn ('cheaper paint materials').
          - option: D
            why_wrong_vi: Việc bảo trì mái nhà ('rooftop maintenance') không được nhắc đến trong đoạn C. Do đó, không có cơ sở để kết luận việc bảo trì dễ dàng hơn.
      - q_num: 21
        question_type: mcq_single
        prompt: "What is the writer's main point about urban trees?"
        options:
          - { label: A, text: "They cool the air mostly by shading buildings." }
          - { label: B, text: "Their benefits are immediate." }
          - { label: C, text: "They both shade and release water vapour, but take years to mature." }
          - { label: D, text: "They are cheaper than cool roofs." }
        answer: "C"
        alternatives: []
        skill_tag: main_idea
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Xác định vị trí thông tin về "urban trees" (cây xanh đô thị) trong bài đọc. Đoạn D là đoạn duy nhất tập trung hoàn toàn vào chủ đề này.
          - action: parse_syntax
            instruction_vi: 'Phân tích nội dung của đoạn D. Đoạn văn mô tả hai cơ chế làm mát của cây: 1) "They shade the ground directly" (Chúng che bóng trực tiếp cho mặt đất) và 2) "they also cool the air through a process called evapotranspiration — releasing water through their leaves as vapour" (chúng cũng làm mát không khí qua quá trình thoát hơi nước - giải phóng nước qua lá dưới dạng hơi).'
          - action: parse_syntax
            instruction_vi: 'Tiếp tục phân tích đoạn D, tìm kiếm nhược điểm hoặc lưu ý quan trọng. Câu cuối cùng chỉ ra: "The catch is time: a sapling planted today will not deliver its full cooling effect for fifteen or twenty years" (Vấn đề là thời gian: một cây non trồng hôm nay sẽ không mang lại hiệu quả làm mát đầy đủ trong mười lăm hoặc hai mươi năm).'
          - action: confirm
            instruction_vi: Đối chiếu các thông tin đã phân tích với phương án C. Phương án này tóm tắt chính xác cả hai cơ chế làm mát ("shade and release water vapour") và nhược điểm về thời gian ("take years to mature"). Do đó, đây là đáp án đúng.
          distractor_analysis:
          - option: A
            why_wrong_vi: Đoạn D nói cây cối "shade the ground directly" (che bóng trực tiếp cho mặt đất), không phải "buildings" (các tòa nhà). Hơn nữa, đoạn văn không nói rằng việc che bóng là cơ chế làm mát "mostly" (chủ yếu); nó chỉ liệt kê việc che bóng VÀ quá trình thoát hơi nước là hai cách cây làm mát.
          - option: B
            why_wrong_vi: 'Đoạn D nói điều ngược lại: "The catch is time: a sapling planted today will not deliver its full cooling effect for fifteen or twenty years" (Vấn đề là thời gian: một cây non trồng hôm nay sẽ không mang lại hiệu quả làm mát đầy đủ trong mười lăm hoặc hai mươi năm). Do đó, lợi ích không phải là "immediate" (ngay lập tức).'
          - option: D
            why_wrong_vi: Đoạn văn không hề so sánh chi phí ("cheaper") giữa cây xanh (đoạn D) và mái nhà mát (đoạn C). Đây là thông tin không được cung cấp trong bài.
      - q_num: 22
        question_type: mcq_single
        prompt: "What does Medellín's example illustrate?"
        options:
          - { label: A, text: "That cool roofs alone can solve the problem." }
          - { label: B, text: "That combining multiple strategies works." }
          - { label: C, text: "That trees are the most effective single tactic." }
          - { label: D, text: "That blue corridors are no longer needed." }
        answer: "B"
        alternatives: []
        skill_tag: main_idea
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Xác định vị trí từ khóa 'Medellín' trong đoạn văn. Từ này xuất hiện ở đoạn cuối cùng (F).
          - action: confirm
            instruction_vi: 'Đọc câu chứa ví dụ về Medellín: "Cities that have cooled measurably in recent years — Medellín in Colombia is the most-studied example — have done so by combining all three strategies...". Cụm từ "by combining all three strategies" (bằng cách kết hợp cả ba chiến lược) trực tiếp khẳng định rằng việc kết hợp nhiều phương pháp đã mang lại hiệu quả.'
          distractor_analysis:
          - option: A
            why_wrong_vi: Phương án này sai vì đoạn F bắt đầu bằng câu "No single intervention is enough on its own" (Không một biện pháp riêng lẻ nào là đủ). Điều này mâu thuẫn trực tiếp với ý tưởng 'cool roofs alone' (chỉ riêng mái nhà mát) có thể giải quyết vấn đề.
          - option: C
            why_wrong_vi: Phương án này sai vì đoạn văn không hề so sánh hiệu quả của các chiến lược hay khẳng định cây xanh là "most effective" (hiệu quả nhất). Ngược lại, ví dụ về Medellín được dùng để minh họa sự thành công của việc *kết hợp* các chiến lược, không phải sự vượt trội của một chiến lược đơn lẻ.
          - option: D
            why_wrong_vi: Phương án này sai vì đoạn văn giới thiệu 'blue corridors' (hành lang xanh dương) là một trong ba chiến lược hiệu quả, và ví dụ về Medellín cho thấy thành phố này đã thành công nhờ "combining all three strategies" (kết hợp cả ba chiến lược), bao gồm cả 'blue corridors'. Không có thông tin nào cho thấy chúng "no longer needed" (không còn cần thiết nữa).
      - q_num: 23
        question_type: sentence_completion
        prompt: "Cities have asphalt and dark roofs that absorb sunlight and release it slowly through the ____."
        answer: night
        alternatives: []
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đầu tiên, ta xác định các từ khóa trong câu hỏi: ''asphalt'', ''dark roofs'' (mái nhà tối màu), ''absorb sunlight'' (hấp thụ ánh nắng) và ''release it slowly'' (thải ra từ từ). Ta quét đoạn văn và tìm thấy các từ khóa này ở ngay đoạn A.'
          - action: confirm
            instruction_vi: 'Câu văn trong đoạn A khớp gần như hoàn toàn với câu hỏi: ''dark surfaces such as asphalt and roofing tar absorb sunlight, hold the heat, and release it slowly through the night''. Cụm từ ''release it slowly through the...'' trong câu hỏi tương ứng trực tiếp với ''release it slowly through the night'' trong đoạn văn. Do đó, từ cần điền là ''night''.'
      - q_num: 24
        question_type: sentence_completion
        prompt: "Trees cool the air through a process called ____."
        answer: evapotranspiration
        alternatives: []
        skill_tag: vocabulary_in_context
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc câu hỏi và xác định các từ khóa chính: ''Trees'' (cây cối) và ''cool the air'' (làm mát không khí). Sau đó, tìm những từ này trong đoạn văn. Đoạn D bắt đầu bằng ''Trees do something more sophisticated...'', cho thấy đây là đoạn văn chứa thông tin cần tìm.'
          - action: confirm
            instruction_vi: 'Trong đoạn D, câu thứ hai viết rằng: ''...they also cool the air through a process called evapotranspiration...''. Câu này khớp hoàn toàn với cấu trúc câu hỏi, cung cấp trực tiếp tên của quá trình cần điền vào chỗ trống.'
      - q_num: 25
        question_type: sentence_completion
        prompt: "Blue corridors use the high ____ of water to absorb daytime warmth."
        answer: "heat capacity"
        alternatives: []
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Xác định vị trí thông tin bằng cách tìm từ khóa chính của câu hỏi là 'Blue corridors'. Từ khóa này xuất hiện ngay ở đầu Đoạn E.
          - action: confirm
            instruction_vi: 'Đọc kỹ câu đầu tiên trong Đoạn E: ''Blue corridors... work in a similar way, using the high heat capacity of water to absorb daytime warmth...''. So sánh trực tiếp với câu hỏi ''Blue corridors use the high ____ of water to absorb daytime warmth'', ta thấy từ còn thiếu chính là ''heat capacity''.'
      - q_num: 26
        question_type: sentence_completion
        prompt: "Two cities that build water channels into redevelopments are Singapore and ____."
        answer: Copenhagen
        alternatives: []
        skill_tag: scanning
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Đọc lướt (scan) bài văn để tìm các từ khóa 'water channels' (kênh nước) và 'redevelopments' (tái phát triển). Ta thấy đoạn E mô tả về 'Blue corridors — networks of canals, rivers and ponds' (Hành lang xanh dương — mạng lưới kênh, sông và ao hồ), đây là một khái niệm tương đương.
          - action: confirm
            instruction_vi: 'Trong đoạn E, câu văn ''Singapore has invested heavily in these features, and Copenhagen now incorporates new water channels as a standard part of large redevelopments'' trực tiếp liệt kê hai thành phố. Câu hỏi đã cho sẵn ''Singapore'', vì vậy thành phố còn lại chính là đáp án cần điền: ''Copenhagen''.'

  # ── Passage 3 — Qs 27–40 ────────────────────────────────────────
  - passage_order: 3
    slug: l3-t1-p3-sleep-and-memory
    title: "What Sleep Does for Memory"
    word_count: 540
    topic_tags: [neuroscience, learning]
    body_markdown: |
      A For most of the twentieth century, sleep was treated by science
      as a kind of off-switch — a period when the brain rested and little
      of interest happened. That view has not survived the past two
      decades. Researchers using both animal models and human imaging
      have found that sleep is a busy time for the brain, and that one
      of its most important functions is the consolidation of memory.

      B The picture is now reasonably clear, although the underlying
      mechanisms are still debated. During the day the brain captures
      information through experience — a face seen on the bus, a fact
      learned in class, the route walked home from work. Much of this
      raw material is held temporarily in a structure called the
      hippocampus. At night, especially during slow-wave (deep) sleep,
      the hippocampus appears to replay these fragments, and slowly
      transfers the most important of them to the cortex for long-term
      storage. People who are deprived of slow-wave sleep, even for one
      night, perform measurably worse the next morning on tasks they
      learned the previous afternoon.

      C REM sleep — the lighter phase associated with vivid dreaming —
      seems to do something different. Rather than archiving facts, it
      appears to help the brain link new information to what it already
      knows. Volunteers asked to solve word-association puzzles after a
      night including normal REM consistently outperform those whose REM
      has been disturbed. One leading theory holds that this is where
      creativity comes from: a half-random sweep through the brain's
      existing knowledge, looking for unexpected connections.

      D Two practical implications follow. The first is that students
      who study late, sleep little and rely on caffeine to function are
      likely to retain less of what they read, not more. The second is
      that short, regular naps after learning can themselves consolidate
      memory — though only if they are long enough to include slow-wave
      sleep, which usually means around ninety minutes. Most workplaces
      do not yet accommodate such naps, but the evidence for their
      effectiveness keeps accumulating.

      E None of this should be read as a final answer. The role of sleep
      in emotional memory, in the forgetting of trivial detail, and in
      the slow restructuring of skill over months remains poorly
      understood. What is no longer debated is that sleep is not the
      opposite of mental activity but one of its essential phases.
    questions:
      - q_num: 27
        question_type: yes_no_not_given
        prompt: "The writer believes the old view of sleep as a rest period is no longer accurate."
        answer: "YES"
        alternatives: ["Y", "yes"]
        skill_tag: writer_view_TFNG
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đầu tiên, tìm trong bài đọc phần mô tả ''quan điểm cũ'' (old view) về giấc ngủ. Đoạn A có câu: ''For most of the twentieth century, sleep was treated by science as a kind of off-switch — a period when the brain rested...'' (Trong phần lớn thế kỷ 20, giấc ngủ được khoa học xem như một loại công tắc tắt — một giai đoạn khi não bộ nghỉ ngơi...).'
          - action: confirm
            instruction_vi: 'Tiếp theo, tìm ý kiến của tác giả về ''quan điểm cũ'' này. Ngay câu sau đó trong đoạn A, tác giả viết: ''That view has not survived the past two decades'' (Quan điểm đó đã không còn tồn tại trong hai thập kỷ qua). Cụm từ ''has not survived'' có nghĩa là quan điểm này không còn được chấp nhận, tức là ''no longer accurate'' (không còn chính xác). Vì vậy, khẳng định trong câu hỏi là đúng với ý của tác giả.'
          distractor_analysis:
          - option: 'NO'
            why_wrong_vi: Phương án 'NO' sẽ đúng nếu tác giả cho rằng quan điểm cũ vẫn còn chính xác. Tuy nhiên, bài viết lại khẳng định điều ngược lại một cách rõ ràng qua cụm từ 'That view has not survived...', cho thấy quan điểm cũ đã lỗi thời.
          - option: NOT GIVEN
            why_wrong_vi: Phương án 'NOT GIVEN' sẽ đúng nếu tác giả không đưa ra ý kiến về việc quan điểm cũ có còn chính xác hay không. Tuy nhiên, tác giả đã trực tiếp bình luận và bác bỏ quan điểm này ngay trong đoạn A, do đó thông tin này có được cung cấp trong bài.
      - q_num: 28
        question_type: yes_no_not_given
        prompt: "Animal studies are presented as the only useful source of evidence."
        answer: "NO"
        alternatives: ["N", "no"]
        skill_tag: writer_view_TFNG
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Xác định vị trí trong bài đọc nói về các nguồn bằng chứng khoa học. Đoạn A đề cập trực tiếp đến các phương pháp nghiên cứu: ''Researchers using both animal models and human imaging have found that...'''
          - action: confirm
            instruction_vi: 'Phân tích cụm từ ''both animal models and human imaging''. Cụm từ này có nghĩa là các nhà nghiên cứu sử dụng ''CẢ hai'' phương pháp: nghiên cứu trên động vật (''animal models'') VÀ chụp ảnh não người (''human imaging''). Việc bài đọc đề cập đến một nguồn bằng chứng khác (''human imaging'') đã trực tiếp mâu thuẫn với từ ''the only'' (duy nhất) trong câu hỏi. Do đó, khẳng định này là sai.'
          distractor_analysis:
          - option: 'YES'
            why_wrong_vi: Phương án 'YES' sai vì bài đọc rõ ràng đề cập đến ít nhất hai nguồn bằng chứng. Đoạn A viết 'both animal models and human imaging' (cả mô hình động vật và hình ảnh chụp não người), chứng tỏ nghiên cứu trên động vật không phải là nguồn 'duy nhất'.
          - option: NOT GIVEN
            why_wrong_vi: Phương án 'NOT GIVEN' sai vì bài đọc cung cấp đầy đủ thông tin để đưa ra câu trả lời dứt khoát. Việc liệt kê 'human imaging' là bằng chứng trực tiếp cho thấy khẳng định 'the only useful source' (nguồn hữu ích duy nhất) là không chính xác. Khi có thể tìm thấy thông tin mâu thuẫn trực tiếp trong bài, đáp án phải là 'NO'.
      - q_num: 29
        question_type: yes_no_not_given
        prompt: "Slow-wave sleep is more important than REM for the storage of factual material."
        answer: "YES"
        alternatives: ["Y", "yes"]
        skill_tag: inference
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Xác định vị trí thông tin về hai loại giấc ngủ được so sánh trong câu hỏi: ''slow-wave sleep'' (giấc ngủ sâu) ở Đoạn B và ''REM sleep'' (giấc ngủ REM) ở Đoạn C.'
          - action: parse_syntax
            instruction_vi: Phân tích chức năng của giấc ngủ sâu (slow-wave sleep) trong Đoạn B. Đoạn văn nêu rõ trong giai đoạn này, não bộ 'transfers the most important of them to the cortex for long-term storage' (chuyển những thông tin quan trọng nhất đến vỏ não để lưu trữ lâu dài). Thông tin này bao gồm 'a fact learned in class' (một sự thật học được ở lớp), tương ứng với 'factual material' trong câu hỏi.
          - action: parse_syntax
            instruction_vi: 'Phân tích chức năng của giấc ngủ REM trong Đoạn C. Đoạn văn bắt đầu bằng việc chỉ ra sự khác biệt và sử dụng cụm từ mang tính tương phản: ''Rather than archiving facts'' (Thay vì lưu trữ các sự kiện). Điều này trực tiếp cho thấy việc lưu trữ dữ liệu thực tế (archiving facts) không phải là chức năng của giấc ngủ REM.'
          - action: confirm
            instruction_vi: 'So sánh hai chức năng: Đoạn B xác nhận giấc ngủ sâu thực hiện việc lưu trữ thông tin thực tế. Đoạn C khẳng định giấc ngủ REM làm việc khác ''thay vì'' lưu trữ thông tin thực tế. Do đó, bài đọc ủng hộ kết luận rằng giấc ngủ sâu quan trọng hơn giấc ngủ REM cho việc lưu trữ tài liệu thực tế. Đáp án là YES.'
          distractor_analysis:
          - option: 'NO'
            why_wrong_vi: Phương án 'NO' sai vì bài đọc không hề phát biểu điều ngược lại. Nó không nói rằng giấc ngủ REM quan trọng hơn, hay cả hai quan trọng như nhau trong việc lưu trữ sự kiện. Thay vào đó, nó phân chia rõ ràng hai chức năng này cho hai loại giấc ngủ khác nhau.
          - option: NOT GIVEN
            why_wrong_vi: Phương án 'NOT GIVEN' sai vì bài đọc CÓ cung cấp đầy đủ thông tin để so sánh. Đoạn B gán chức năng lưu trữ sự kiện cho giấc ngủ sâu, và Đoạn C (với cụm từ 'Rather than archiving facts') đã loại bỏ chức năng đó khỏi giấc ngủ REM. Sự so sánh này hoàn toàn có thể được thực hiện dựa trên thông tin trong bài.
      - q_num: 30
        question_type: yes_no_not_given
        prompt: "Caffeine is the most reliable substitute for a full night's sleep."
        answer: "NO"
        alternatives: ["N", "no"]
        skill_tag: writer_view_TFNG
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Xác định vị trí thông tin liên quan đến "caffeine" trong bài đọc. Thông tin này nằm ở đoạn D, trong câu: "students who study late, sleep little and rely on caffeine to function..."'
          - action: infer
            instruction_vi: Phân tích ý nghĩa của câu văn vừa tìm được. Câu này nói rằng những sinh viên dựa vào caffeine để hoạt động thì "are likely to retain less of what they read, not more" (có khả năng ghi nhớ ÍT HƠN những gì họ đã đọc, chứ không phải nhiều hơn).
          - action: confirm
            instruction_vi: Đối chiếu thông tin từ đoạn văn với câu hỏi. Câu hỏi khẳng định caffeine là "chất thay thế đáng tin cậy nhất" (most reliable substitute) cho giấc ngủ. Tuy nhiên, đoạn văn chỉ ra việc dùng caffeine thay cho ngủ mang lại kết quả tiêu cực (ghi nhớ kém hơn). Điều này trực tiếp mâu thuẫn với nhận định trong câu hỏi. Do đó, câu trả lời là NO.
          distractor_analysis:
          - option: 'YES'
            why_wrong_vi: Phương án này sai vì đoạn văn không những không ủng hộ mà còn đưa ra bằng chứng chống lại nhận định này. Đoạn D nêu rõ việc dùng caffeine thay cho ngủ sẽ khiến việc ghi nhớ kiến thức trở nên kém hiệu quả hơn ("retain less"), hoàn toàn trái ngược với ý nghĩa của một "chất thay thế đáng tin cậy".
          - option: NOT GIVEN
            why_wrong_vi: Phương án này sai vì bài đọc CÓ cung cấp đủ thông tin để trả lời câu hỏi. Đoạn D đã đưa ra một kết luận rõ ràng về tác động tiêu cực của việc dùng caffeine để thay thế giấc ngủ đối với việc học. Vì có thông tin trực tiếp phủ định câu hỏi, đáp án phải là NO chứ không phải NOT GIVEN.
      - q_num: 31
        question_type: yes_no_not_given
        prompt: "Sleep's effect on long-term skill development is now fully understood."
        answer: "NO"
        alternatives: ["N", "no"]
        skill_tag: writer_view_TFNG
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Tìm trong đoạn văn các từ khóa liên quan đến "skill development" (phát triển kỹ năng) và mức độ "understood" (hiểu biết). Đoạn E chứa thông tin trực tiếp về vấn đề này.
          - action: confirm
            instruction_vi: So sánh thông tin tìm được với câu hỏi. Câu hỏi khẳng định hiệu ứng này đã được "fully understood" (hiểu đầy đủ), trong khi đoạn E nói rõ rằng vai trò của giấc ngủ "in the slow restructuring of skill over months remains poorly understood" (trong việc tái cấu trúc kỹ năng chậm trong nhiều tháng vẫn còn được hiểu rất ít). Thông tin trong bài mâu thuẫn trực tiếp với câu hỏi.
          distractor_analysis:
          - option: 'YES'
            why_wrong_vi: Phương án 'YES' sai vì bài đọc nói điều hoàn toàn ngược lại. Đoạn E chỉ rõ rằng sự hiểu biết về vấn đề này còn rất hạn chế ("remains poorly understood"), chứ không phải là đã được hiểu đầy đủ ("fully understood").
          - option: NOT GIVEN
            why_wrong_vi: Phương án 'NOT GIVEN' sai vì bài đọc có cung cấp thông tin rõ ràng về mức độ hiểu biết của khoa học đối với việc phát triển kỹ năng dài hạn. Vì có thông tin để xác định câu hỏi là sai, nên đáp án không thể là NOT GIVEN.
      - q_num: 32
        question_type: mcq_single
        prompt: "According to paragraph B, the hippocampus mainly"
        options:
          - { label: A, text: "stores memories permanently." }
          - { label: B, text: "produces caffeine receptors." }
          - { label: C, text: "holds new information temporarily before transferring it elsewhere." }
          - { label: D, text: "controls the timing of REM sleep." }
        answer: "C"
        alternatives: []
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Đọc câu hỏi và xác định từ khoá chính là 'hippocampus' và khu vực cần tìm thông tin là 'paragraph B'.
          - action: confirm
            instruction_vi: 'Tìm câu trong đoạn B mô tả chức năng của ''hippocampus'' và đối chiếu với các phương án. Đoạn văn viết: ''Much of this raw material is held temporarily in a structure called the hippocampus.'' (Phần lớn dữ liệu thô này được giữ tạm thời trong một cấu trúc gọi là hồi hải mã).'
          - action: infer
            instruction_vi: 'Câu văn này cho thấy ''hippocampus'' giữ thông tin ''tạm thời'' (temporarily). Đoạn văn cũng mô tả sau đó nó ''transfers the most important of them to the cortex'' (chuyển những phần quan trọng nhất đến vỏ não). Điều này khớp hoàn toàn với phương án C: ''holds new information temporarily before transferring it elsewhere'' (giữ thông tin mới một cách tạm thời trước khi chuyển nó đi nơi khác).'
          distractor_analysis:
          - option: A
            why_wrong_vi: Phương án này sai vì đoạn B nói rằng hồi hải mã chỉ giữ thông tin 'tạm thời' (temporarily), còn việc lưu trữ 'lâu dài' (long-term storage) diễn ra ở 'vỏ não' (cortex).
          - option: B
            why_wrong_vi: Phương án này sai vì 'caffeine' chỉ được đề cập trong đoạn D và không có thông tin nào trong toàn bộ bài đọc nói rằng hồi hải mã sản xuất các thụ thể caffeine.
          - option: D
            why_wrong_vi: Phương án này sai vì đoạn B liên kết hoạt động của hồi hải mã với 'giấc ngủ sâu' (slow-wave (deep) sleep), chứ không phải 'giấc ngủ REM' (REM sleep). Giấc ngủ REM được thảo luận ở đoạn C.
      - q_num: 33
        question_type: mcq_single
        prompt: "According to paragraph C, REM sleep helps the brain to"
        options:
          - { label: A, text: "delete useless detail." }
          - { label: B, text: "link new information to existing knowledge." }
          - { label: C, text: "rebuild the hippocampus." }
          - { label: D, text: "produce stress hormones." }
        answer: "B"
        alternatives: []
        skill_tag: detail
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Xác định từ khóa trong câu hỏi là 'REM sleep' và 'paragraph C'. Toàn bộ thông tin cần thiết để trả lời sẽ nằm trong đoạn C.
          - action: confirm
            instruction_vi: 'Đọc câu thứ hai trong đoạn C: ''Rather than archiving facts, it appears to help the brain link new information to what it already knows.'' (Thay vì lưu trữ thông tin, nó dường như giúp bộ não liên kết thông tin mới với những gì nó đã biết). Câu này trực tiếp trả lời câu hỏi.'
          - action: confirm
            instruction_vi: 'Đối chiếu ý của câu vừa tìm được với phương án B: ''link new information to existing knowledge'' (liên kết thông tin mới với kiến thức hiện có). Cụm ''what it already knows'' và ''existing knowledge'' là đồng nghĩa. Do đó, B là đáp án chính xác.'
          distractor_analysis:
          - option: A
            why_wrong_vi: Đoạn E có đề cập đến 'the forgetting of trivial detail' (việc quên đi các chi tiết vụn vặt), nhưng nói rằng vai trò này 'remains poorly understood' (vẫn chưa được hiểu rõ). Đoạn C, là đoạn văn được hỏi, hoàn toàn không nhắc đến việc xóa bỏ thông tin.
          - option: C
            why_wrong_vi: Từ 'hippocampus' được nhắc đến trong đoạn B, liên quan đến giấc ngủ sâu (slow-wave sleep), không phải giấc ngủ REM (chủ đề của đoạn C). Ngoài ra, đoạn văn không hề đề cập đến việc 'rebuild' (xây dựng lại) hippocampus.
          - option: D
            why_wrong_vi: Toàn bộ đoạn văn không chứa bất kỳ thông tin nào về 'stress hormones' (hormone gây căng thẳng). Đây là thông tin không được đề cập.
      - q_num: 34
        question_type: mcq_single
        prompt: "Which of the following best summarises paragraph D?"
        options:
          - { label: A, text: "Naps cannot substitute for night sleep under any circumstances." }
          - { label: B, text: "Students who sleep little retain less; naps long enough to include slow-wave sleep help." }
          - { label: C, text: "Caffeine improves long-term memory." }
          - { label: D, text: "Workplaces already widely allow nap rooms." }
        answer: "B"
        alternatives: []
        skill_tag: main_idea
        solution:
          solution_steps:
          - action: locate
            instruction_vi: 'Đọc câu đầu tiên của đoạn D: ''Two practical implications follow'' (Hai hệ quả thực tế theo sau). Điều này cho thấy đoạn văn sẽ trình bày hai ý chính.'
          - action: locate
            instruction_vi: 'Xác định hệ quả đầu tiên: ''students who study late, sleep little... are likely to retain less of what they read'' (sinh viên học khuya, ngủ ít... có khả năng ghi nhớ ít hơn).'
          - action: locate
            instruction_vi: 'Xác định hệ quả thứ hai: ''short, regular naps after learning can themselves consolidate memory — though only if they are long enough to include slow-wave sleep'' (những giấc ngủ ngắn sau khi học có thể củng cố trí nhớ — nhưng chỉ khi chúng đủ dài để bao gồm giấc ngủ sâu).'
          - action: confirm
            instruction_vi: Đối chiếu hai ý chính này với phương án B. Phương án B 'Students who sleep little retain less; naps long enough to include slow-wave sleep help' (Sinh viên ngủ ít thì ghi nhớ ít hơn; giấc ngủ ngắn đủ dài để có giấc ngủ sâu sẽ hữu ích) đã tóm tắt chính xác và đầy đủ cả hai hệ quả được nêu trong đoạn văn.
          distractor_analysis:
          - option: A
            why_wrong_vi: Đoạn văn không hề so sánh giấc ngủ ngắn với giấc ngủ đêm hay khẳng định rằng chúng 'không thể thay thế trong mọi trường hợp'. Đoạn văn chỉ nêu lợi ích của việc ngủ trưa đủ dài, chứ không nói về giới hạn của nó so với ngủ cả đêm.
          - option: C
            why_wrong_vi: Thông tin này trái ngược với đoạn văn. Đoạn văn đề cập đến việc sinh viên 'rely on caffeine to function' (dựa vào caffeine để hoạt động) như một phần của thói quen xấu (học khuya, ngủ ít) dẫn đến việc 'retain less' (ghi nhớ ít hơn), chứ không nói caffeine cải thiện trí nhớ.
          - option: D
            why_wrong_vi: Thông tin này hoàn toàn trái ngược với đoạn văn, trong đó có câu 'Most workplaces do not yet accommodate such naps' (Hầu hết các nơi làm việc chưa tạo điều kiện cho những giấc ngủ ngắn như vậy).
      - q_num: 35
        question_type: mcq_single
        prompt: "The writer's overall view of sleep is best described as"
        options:
          - { label: A, text: "an unimportant biological cycle." }
          - { label: B, text: "an essential phase of mental activity, not its opposite." }
          - { label: C, text: "interesting but practically irrelevant." }
          - { label: D, text: "fully explained by current science." }
        answer: "B"
        alternatives: []
        skill_tag: main_idea
        solution:
          solution_steps:
          - action: locate
            instruction_vi: Câu hỏi yêu cầu tìm "quan điểm tổng thể" (overall view) của tác giả. Thông tin này thường được tóm tắt ở đoạn cuối cùng của bài đọc. Ta hãy tập trung vào đoạn E.
          - action: confirm
            instruction_vi: 'Đoạn E có câu: "What is no longer debated is that sleep is not the opposite of mental activity but one of its essential phases." (Điều không còn phải bàn cãi là giấc ngủ không phải là sự đối lập của hoạt động trí óc mà là một trong những giai đoạn thiết yếu của nó). Câu này gần như trùng khớp hoàn toàn về mặt ý nghĩa với phương án B.'
          distractor_analysis:
          - option: A
            why_wrong_vi: Phương án này sai vì toàn bộ đoạn văn đều nhấn mạnh tầm quan trọng của giấc ngủ. Đoạn A gọi việc củng cố trí nhớ là một trong những "chức năng quan trọng nhất" (most important functions) của giấc ngủ. Đoạn E gọi nó là một "giai đoạn thiết yếu" (essential phases). Do đó, nói giấc ngủ "không quan trọng" (unimportant) là trái ngược hoàn toàn với nội dung bài.
          - option: C
            why_wrong_vi: Phương án này sai vì đoạn D thảo luận rõ ràng về "Hai hệ quả thực tiễn" (Two practical implications) của việc nghiên cứu giấc ngủ, bao gồm lời khuyên cho sinh viên và lợi ích của việc ngủ trưa. Điều này cho thấy tác giả tin rằng các phát hiện này có liên quan đến thực tế, chứ không phải là "practically irrelevant" (không liên quan đến thực tiễn).
          - option: D
            why_wrong_vi: Phương án này sai vì tác giả nhiều lần chỉ ra rằng khoa học vẫn chưa hiểu hết về giấc ngủ. Đoạn B nói "các cơ chế cơ bản vẫn còn đang được tranh luận" (the underlying mechanisms are still debated). Đoạn E khẳng định rằng vai trò của giấc ngủ trong nhiều lĩnh vực "vẫn chưa được hiểu rõ" (remains poorly understood) và đây không phải là "câu trả lời cuối cùng" (a final answer).
      # Sprint 20.14e — flowing-summary shape (Standards §2A.10). The
      # first Q (Q36) carries `template.summary_text` with `{{N}}` gap
      # markers; the renderer absorbs Qs 37–40 into the same flowing
      # paragraph. Each `{{N}}` maps to its q_num for grading. Prompts
      # are placeholder text — the renderer ignores them when
      # summary_text is present.
      - q_num: 36
        question_type: summary_completion
        prompt: "(see summary above)"
        template:
          summary_text: |
            During slow-wave sleep, the hippocampus appears to {{36}}
            fragments learned earlier. Long-term storage of memories
            happens in the {{37}}. A nap that consolidates memory should
            usually last about {{38}} minutes. REM sleep may be where
            {{39}} originates, by linking unrelated knowledge. What the
            writer says is no longer debated is that sleep is an
            essential {{40}} of mental activity.
        answer: replay
        alternatives: ["replays"]
        skill_tag: detail
      - q_num: 37
        question_type: summary_completion
        prompt: "(see summary above)"
        answer: cortex
        alternatives: ["the cortex"]
        skill_tag: detail
      - q_num: 38
        question_type: summary_completion
        prompt: "(see summary above)"
        answer: ninety
        alternatives: ["90"]
        skill_tag: scanning
      - q_num: 39
        question_type: summary_completion
        prompt: "(see summary above)"
        answer: creativity
        alternatives: []
        skill_tag: inference
      - q_num: 40
        question_type: summary_completion
        prompt: "(see summary above)"
        answer: phase
        alternatives: []
        skill_tag: main_idea
---
<!--
L3 files are YAML-only — all test data lives in the frontmatter above.
-->
