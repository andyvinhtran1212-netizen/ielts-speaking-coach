---
content_type: reading_passage_l1
title: The Return of the Wolves
slug: return-of-the-wolves
difficulty_level: intermediate
topic_tags: [environment, animals]
estimated_minutes: 6
word_count: 180
published: true
glossary:
  - term: apex predator
    definition: một loài đứng đầu chuỗi thức ăn, không có kẻ thù tự nhiên nào săn nó
    example: Wolves are apex predators in many northern ecosystems.
  - term: ecosystem
    definition: một cộng đồng các sinh vật sống tương tác với môi trường xung quanh
    example: A healthy ecosystem keeps many species in balance.
  - term: cascade
    definition: một chuỗi tác động lan truyền, khi một thay đổi gây ra nhiều thay đổi khác
    example: Removing one species can trigger a cascade of changes.
questions:
  - q_num: 1
    question_type: true_false_not_given
    prompt: Wolves were absent from Yellowstone before 1995.
    answer: "TRUE"
    alternatives: ["T", "true"]
    skill_tag: detail
    sub_skill: locate-fact
    explanation: The passage says wolves were reintroduced in 1995 after being gone for decades.
    solution:
      solution_steps:
        - action: locate
          instruction_vi: "Tìm mốc 1995: sói được 'reintroduced in 1995 after being gone for decades'."
        - action: parse_syntax
          instruction_vi: "'were reintroduced' là thể bị động (be + V3) — chủ thể hành động (con người) bị ẩn; điều quan trọng là trước 1995 sói KHÔNG có mặt."
          kp_refs:
            - {type: grammar, slug: passive-voice, anchor: passive-voice.structure.be-pp}
        - action: confirm
          instruction_vi: "'absent before 1995' khớp 'gone for decades' → TRUE."
          kp_refs:
            - {type: skill, slug: detail}
  - q_num: 2
    question_type: mcq_single
    prompt: According to the passage, what surprised scientists most?
    options:
      - label: A
        text: How quickly the wolves bred
      - label: B
        text: How far the effects spread through the ecosystem
      - label: C
        text: How little the wolves ate
    answer: "B"
    alternatives: []
    skill_tag: main_idea
    explanation: The whole passage builds to the idea that the effects rippled far beyond the wolves themselves.
    solution:
      solution_steps:
        - action: infer
          instruction_vi: "Cả bài dồn về một ý: tác động của sói lan RỘNG khắp hệ sinh thái, vượt xa bản thân đàn sói → đáp án B."
          kp_refs:
            - {type: skill, slug: main_idea}
      distractor_analysis:
        - option: A
          why_wrong_vi: "Bẫy chi tiết nhỏ: bài không nói sói SINH SẢN nhanh; tốc độ sinh sản không phải điều khiến các nhà khoa học bất ngờ."
        - option: C
          why_wrong_vi: "Bẫy đảo nghĩa: lượng sói ăn không phải trọng tâm; điều gây bất ngờ là hiệu ứng lan toả, không phải sói ăn ít."
  - q_num: 3
    question_type: short_answer
    prompt: "What single word does the passage use for a chain of knock-on effects? (one word)"
    answer: cascade
    alternatives: ["a cascade"]
    skill_tag: vocabulary_in_context
    explanation: The text calls the chain of effects a "cascade".
---
When wolves were reintroduced to Yellowstone National Park in 1995, scientists
expected some changes. After all, the wolves had been absent for nearly seventy
years. But few predicted how far the effects would ripple through the whole
**ecosystem**.

As an **apex predator**, the wolf sits at the top of the food chain. With wolves
hunting again, herds of elk could no longer graze lazily in one place. They began
to move more, and the young trees along the rivers — once eaten to stubs — started
to grow tall again. Birds returned to the new branches, and beavers, which need
those trees, came back too.

This chain of knock-on effects is called a **cascade**. The return of a single
species, it turned out, helped reshape the rivers, the forests, and the lives of
dozens of other animals.
