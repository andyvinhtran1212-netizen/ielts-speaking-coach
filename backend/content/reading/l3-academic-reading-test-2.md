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
        explanation: "Paragraph A: 'less than five percent of its floor has been mapped'."
      - q_num: 3
        question_type: matching_information
        prompt: "a description of organisms that would be directly destroyed"
        template: { paragraph_labels: [A, B, C, D] }
        answer: "C"
        skill_tag: scanning
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
        explanation: "Paragraph D: '…drafting rules for over a decade, and a moratorium until 2030 is now widely supported'."
      # Qs 8–13 — yes_no_not_given (served type filler)
      - q_num: 8
        question_type: yes_no_not_given
        prompt: "The writer believes that deep-sea mining will inevitably proceed."
        answer: "NOT GIVEN"
        skill_tag: writer_view_TFNG
        explanation: "The writer reports the debate but does not predict the outcome."
      - q_num: 9
        question_type: yes_no_not_given
        prompt: "Industry groups suggest that delay favours land miners with worse records."
        answer: "YES"
        skill_tag: writer_view_TFNG
        explanation: "Paragraph D states this directly."
      - q_num: 10
        question_type: yes_no_not_given
        prompt: "All companies interested in deep-sea mining are based in Europe."
        answer: "NOT GIVEN"
        skill_tag: writer_view_TFNG
        explanation: "Company nationality is not discussed."
      - q_num: 11
        question_type: yes_no_not_given
        prompt: "The nodule communities can regrow within a few months after mining."
        answer: "NO"
        skill_tag: writer_view_TFNG
        explanation: "Paragraph C says the communities 'could not survive their removal'."
      - q_num: 12
        question_type: yes_no_not_given
        prompt: "Sediment plumes could affect organisms outside the mining area."
        answer: "YES"
        skill_tag: writer_view_TFNG
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
        explanation: "Stated: 'a recorder the size of a paperback'."
      - q_num: 26
        question_type: short_answer
        prompt: "At which university did Pijanowski found his centre?"
        answer: "Purdue"
        alternatives: ["Purdue University"]
        skill_tag: detail
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
      # Qs 27–32 — summary_completion (word bank A–J)
      # The summary stem uses `____` for the gap; the word bank lives in `options:`.
      - q_num: 27
        question_type: summary_completion
        prompt: "A modern commercial vertical farm produces around ____ harvests of leafy greens each year on a much smaller footprint than conventional farming."
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
        prompt: "Seeds are placed into ____ plugs on trays before germination begins."
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
        answer: "E"
        skill_tag: detail
        explanation: "Stated: 'placed into rockwool plugs, which sit on trays'."
      - q_num: 29
        question_type: summary_completion
        prompt: "The germination chamber is kept near ____ degrees Celsius."
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
        answer: "F"
        skill_tag: detail
        explanation: "Stated: 'kept near twenty-four degrees Celsius'."
      - q_num: 30
        question_type: summary_completion
        prompt: "After ____ days the seedlings are moved from the chamber to the grow racks."
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
        answer: "G"
        skill_tag: detail
        explanation: "Stated: 'after five days the seedlings move to the grow racks'."
      - q_num: 31
        question_type: summary_completion
        prompt: "On the grow racks, ____ is grown under a heavy blue light recipe."
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
        answer: "H"
        skill_tag: detail
        explanation: "Stated: 'lettuce thrives on a heavy blue spectrum'."
      - q_num: 32
        question_type: summary_completion
        prompt: "Packed greens typically reach supermarket shelves within ____ hours of harvest."
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
        explanation: "Stated: 'Seeds arrive pre-graded'."
      - q_num: 34
        question_type: flow_chart_completion
        prompt: "Step 2 — Seeds are placed in rockwool plugs on ____."
        answer: "trays"
        skill_tag: detail
        explanation: "Stated: 'placed into rockwool plugs, which sit on trays'."
      - q_num: 35
        question_type: flow_chart_completion
        prompt: "Step 3 — Trays pass through a ____ chamber for five days."
        answer: "germination"
        skill_tag: detail
        explanation: "Stated: 'a germination chamber kept near twenty-four degrees'."
      - q_num: 36
        question_type: flow_chart_completion
        prompt: "Step 4 — Seedlings transfer to grow racks under species-tuned ____."
        answer: "lighting"
        alternatives: [light]
        skill_tag: detail
        explanation: "Stated: 'the lighting recipe is tuned by species'."
      - q_num: 37
        question_type: flow_chart_completion
        prompt: "Step 5 — At harvest, trays move to a cutting station, are weighed and ____."
        answer: "packed"
        skill_tag: detail
        explanation: "Stated: 'are weighed, packed, and shipped'."
      # Qs 38–40 — diagram_label_completion (callouts on a labeled diagram)
      - q_num: 38
        question_type: diagram_label_completion
        prompt: "Label 1 (input side): pre-graded ____"
        answer: "seeds"
        skill_tag: scanning
        explanation: "Same opening step as the flow-chart."
      - q_num: 39
        question_type: diagram_label_completion
        prompt: "Label 2 (central rack): controlled by sensors tracking nutrient concentration, humidity and root ____"
        answer: "temperature"
        skill_tag: detail
        explanation: "Stated: 'sensors track humidity, nutrient concentration and root temperature'."
      - q_num: 40
        question_type: diagram_label_completion
        prompt: "Label 3 (output side): packed crops shipped to ____ shelves"
        answer: "supermarket"
        skill_tag: detail
        explanation: "Stated: 'reaching supermarket shelves within twelve hours'."
---
