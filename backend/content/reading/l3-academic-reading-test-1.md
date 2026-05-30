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
      - q_num: 6
        question_type: true_false_not_given
        prompt: "Hand-made goods are usually cheaper than mass-produced equivalents."
        answer: "FALSE"
        alternatives: ["F", "false"]
        skill_tag: detail
      - q_num: 7
        question_type: true_false_not_given
        prompt: "Online videos of makers at work have attracted large audiences."
        answer: "TRUE"
        alternatives: ["T", "true"]
        skill_tag: detail
      - q_num: 8
        question_type: true_false_not_given
        prompt: "Most hand-made craft sales are tracked in official retail data."
        answer: "FALSE"
        alternatives: ["F", "false"]
        skill_tag: detail
      - q_num: 9
        question_type: true_false_not_given
        prompt: "A specific 2024 government policy is mentioned as a cause of the trend."
        answer: "NOT GIVEN"
        alternatives: ["NG", "not given"]
        skill_tag: writer_view_TFNG
      - q_num: 10
        question_type: short_answer
        prompt: "Which industry is the 150,000 craft figure compared with? (ONE word)"
        answer: coal
        alternatives: []
        skill_tag: scanning
      - q_num: 11
        question_type: short_answer
        prompt: "How many times more expensive can a hand-thrown mug be? (ONE word)"
        answer: ten
        alternatives: ["10"]
        skill_tag: scanning
      - q_num: 12
        question_type: short_answer
        prompt: "What do defenders say each piece is a record of? (TWO words)"
        answer: "maker's choices"
        alternatives: ["maker choices"]
        skill_tag: detail
      - q_num: 13
        question_type: short_answer
        prompt: "Where does the writer say the movement has carved out a niche? (TWO words)"
        answer: "higher end"
        alternatives: ["the higher end"]
        skill_tag: scanning

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
      - q_num: 23
        question_type: sentence_completion
        prompt: "Cities have asphalt and dark roofs that absorb sunlight and release it slowly through the ____."
        answer: night
        alternatives: []
        skill_tag: detail
      - q_num: 24
        question_type: sentence_completion
        prompt: "Trees cool the air through a process called ____."
        answer: evapotranspiration
        alternatives: []
        skill_tag: vocabulary_in_context
      - q_num: 25
        question_type: sentence_completion
        prompt: "Blue corridors use the high ____ of water to absorb daytime warmth."
        answer: "heat capacity"
        alternatives: []
        skill_tag: detail
      - q_num: 26
        question_type: sentence_completion
        prompt: "Two cities that build water channels into redevelopments are Singapore and ____."
        answer: Copenhagen
        alternatives: []
        skill_tag: scanning

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
      - q_num: 28
        question_type: yes_no_not_given
        prompt: "Animal studies are presented as the only useful source of evidence."
        answer: "NO"
        alternatives: ["N", "no"]
        skill_tag: writer_view_TFNG
      - q_num: 29
        question_type: yes_no_not_given
        prompt: "Slow-wave sleep is more important than REM for the storage of factual material."
        answer: "YES"
        alternatives: ["Y", "yes"]
        skill_tag: inference
      - q_num: 30
        question_type: yes_no_not_given
        prompt: "Caffeine is the most reliable substitute for a full night's sleep."
        answer: "NO"
        alternatives: ["N", "no"]
        skill_tag: writer_view_TFNG
      - q_num: 31
        question_type: yes_no_not_given
        prompt: "Sleep's effect on long-term skill development is now fully understood."
        answer: "NO"
        alternatives: ["N", "no"]
        skill_tag: writer_view_TFNG
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
