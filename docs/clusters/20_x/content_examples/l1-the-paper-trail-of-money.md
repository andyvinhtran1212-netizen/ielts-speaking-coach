---
# ── L1 Vocab Reading example ───────────────────────────────────────────
# Worked example accompanying reading_content_format_v2.md §2.
# Round-trips clean through parse_reading_passage → validate_reading_passage
# (asserted by backend/tests/test_reading_content_format_v2_examples.py).

content_type: reading_passage_l1
title: The Paper Trail of Money
slug: the-paper-trail-of-money
difficulty_level: intermediate
topic_tags: [history, economics]
estimated_minutes: 5
word_count: 210
published: true

# Glossary — popovers attached at render time by case-insensitive string match
# against the passage body. Plain prose; the renderer adds the highlight — do
# not wrap terms with custom Markdown syntax.
glossary:
  - term: ledger
    definition: cuốn sổ ghi lại các giao dịch tài chính, dùng để theo dõi nợ và tài sản
    example: A merchant might keep a ledger of every coin received and spent.
  - term: counterfeit
    definition: làm giả một vật để qua mặt người khác, thường để lừa đảo
    example: Governments use special inks to make banknotes hard to counterfeit.
  - term: legal tender
    definition: tiền được pháp luật công nhận để thanh toán nợ
    example: A shop must accept legal tender for any purchase under the listed price.
  - term: durable
    definition: bền, có thể dùng lâu mà không hỏng
    example: Polymer notes are far more durable than paper ones.

# Light comprehension questions — all four §4 shape rules apply:
#   • options at the question top level (NOT under payload)
#   • answer as a string (NOT a nested dict)
#   • alternatives as a list of strings (or omit)
#   • skill_tag from SKILL_TAGS (D2 enum)
questions:
  # mcq_single — top-level options + single-letter answer string
  - q_num: 1
    question_type: mcq_single
    prompt: "According to the passage, what was the FIRST function of paper money in China?"
    options:
      - label: A
        text: A souvenir for travellers
      - label: B
        text: A receipt for metal coins held in storage
      - label: C
        text: A reward for soldiers
    answer: "B"
    alternatives: []
    skill_tag: detail
    sub_skill: locate-fact
    explanation: The passage says traders left heavy coins with a deposit-keeper and received a paper note as proof — i.e. a receipt.

  # true_false_not_given — note the QUOTED answer (raw FALSE would parse as a boolean)
  - q_num: 2
    question_type: true_false_not_given
    prompt: Paper money was invented in Europe before it appeared in China.
    answer: "FALSE"
    alternatives: ["F", "false"]
    skill_tag: detail
    explanation: The passage credits China with the first use; Europe is centuries later.

  # short_answer — no options, free-typed answer; alternatives accept reasonable variants
  - q_num: 3
    question_type: short_answer
    prompt: "Which single word does the passage use for fake banknotes? (ONE word)"
    answer: counterfeit
    alternatives: ["counterfeits", "counterfeiting"]
    skill_tag: vocabulary_in_context
    explanation: The text introduces the term "counterfeit" when describing the response of mints.

  # sentence_completion — single-string answer; alternatives carry the obvious variants
  - q_num: 4
    question_type: sentence_completion
    prompt: "Modern polymer notes are far more ____ than older paper notes."
    answer: durable
    alternatives: ["more durable"]
    skill_tag: vocabulary_in_context
    explanation: The closing paragraph uses "durable" to describe the advantage of polymer.
---
Most people now treat a banknote as nothing more than a piece of paper with a
number printed on it. Its life story, though, is older and stranger than that.
The first paper money on record appeared in ninth-century China, where heavy
copper coins had become awkward to carry over long distances. Travelling
merchants would leave their coins with a trusted deposit-keeper and receive a
written note in return — a slip of paper that promised to repay the same sum
on demand. In effect, the note was a portable **ledger** entry.

Once those receipts started to circulate between strangers, governments noticed.
A note that everyone trusted was, in practice, money in its own right; and a
government that printed the notes could spend the proceeds before anyone asked
to redeem them. Within a few centuries the practice had spread to Persia, then
to Mongol courts, and finally — far later than is often imagined — to Europe.

The trouble with paper, of course, is that any decent printer can copy it.
Almost as soon as paper money existed, so did the **counterfeit** version, and
mints have been adding watermarks, security threads, microprinting, and now
holograms to stay one step ahead. A century of effort has not stopped fakes;
it has only kept the gap from closing.

Today most countries treat their paper currency as **legal tender**: by law, a
seller must accept it for any debt up to a stated amount. Several have moved
on again — Australia, Canada, and the United Kingdom now print on a plastic
polymer rather than cotton paper, producing notes that are cleaner, harder to
forge, and more **durable**. The story of money, written on paper for a
thousand years, is being quietly rewritten in plastic.
