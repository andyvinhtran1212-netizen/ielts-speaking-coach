---
# ── L3 Full Test example ───────────────────────────────────────────────
# Worked example accompanying reading_content_format_v2.md §6.
# Round-trips clean through parse_reading_test → validate_reading_test
# (asserted by backend/tests/test_reading_content_format_v2_examples.py).
#
# IMPORTANT FORMAT NOTES — DIFFERENT FROM THE V1 SPEC EXAMPLE:
#   • Questions use FLAT YAML: `options:` at the question top level (NOT
#     `payload: {options: …}`), and `answer:` is a string (NOT a nested
#     `{answer, alternatives}` dict). See spec §4 and §11.
#   • L3 is YAML-only: the entire test (test metadata + 3 passage bodies +
#     all 40 questions) lives in this frontmatter. The Markdown body of
#     this .md file (after the closing `---`) is unused by the L3 parser.

content_type: reading_full_test
test_id: AVR-READ-002
title: "Academic Reading — Test 2"
module: academic
time_limit_minutes: 60
passage_count: 3
total_questions: 40
band_target: 7.0
published: true

passages:
  # ── Passage 1 — Qs 1–13 (matching_headings × 5, true_false_not_given × 4, short_answer × 4)
  - passage_order: 1
    slug: l3-t2-p1-the-quiet-rise-of-the-bicycle
    title: "The Quiet Rise of the Bicycle"
    word_count: 480
    estimated_minutes: 18
    topic_tags: [urban-planning, transport]
    body_markdown: |
      A The bicycle is the oldest piece of personal transport still in daily
      use anywhere in the world. Its basic design has scarcely changed since
      the 1880s — two wheels of equal size, a diamond frame, a chain to the
      rear wheel — and yet for most of the twentieth century it was treated
      as a child's toy or, at best, a tool for the poor. Anyone with money
      bought a car. The bicycle, where it survived in adult life, was a quiet
      embarrassment.

      B That image began to change in the early 2000s, and it changed first
      in places that had once led the rush to the car. Copenhagen had been
      designed in the 1960s around six-lane boulevards; by 2010 its planners
      were quietly reversing the work, narrowing roads, widening pavements,
      and stitching together a network of dedicated cycle lanes. Today the
      city counts more daily bicycle journeys than car journeys, a milestone
      it crossed in 2016 without anyone noticing on the day.

      C Several forces lay behind the shift. The most obvious was congestion:
      a car carrying one person occupies twenty times the road space of a
      bicycle and moves no faster through a jam. Cities looking for a cheap
      way to free up streets discovered that giving over a single lane to
      bikes carried more people, more quickly, than the lane had ever carried
      in cars. A second factor was health. As average life expectancy
      lengthened, the cost of sedentary disease rose, and the half-hour
      commute by bicycle began to look like a free public-health programme.

      D Critics raised three reasonable concerns. The first was weather: in
      cold or wet climates, riding to work was unpleasant. The second was
      safety: a cyclist in city traffic is, statistically, more exposed than
      a driver. The third was equity: cycling networks tended to be built
      first in middle-class districts, leaving poorer neighbourhoods behind.
      Each concern has, in different cities, found its own answer — heated
      cycle shelters in Helsinki, segregated lanes in Bogotá, free bicycles
      in working-class Seville — but none of the answers are universal.

      E What the bicycle's slow return shows is less a triumph than a
      reminder: that the design choices a city locks in over decades are not
      irreversible, and that the simplest tool, dismissed for two
      generations, can still carry a quarter of a city to work if its
      planners decide it should.
    questions:
      # 5 × matching_headings — Qs 1–5
      - q_num: 1
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph A."
        options:
          - label: i
            text: "How three real worries were each answered locally"
          - label: ii
            text: "Why one city quietly reversed its own road plan"
          - label: iii
            text: "A simple, unchanged machine, once dismissed"
          - label: iv
            text: "Two practical pressures pushing the bicycle back"
          - label: v
            text: "What the bicycle's return is really evidence of"
        answer: "iii"
        alternatives: []
        skill_tag: skimming
        explanation: Paragraph A sets up the 19th-century design and its mid-20th-century low status.
      - q_num: 2
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph B."
        options:
          - label: i
            text: "How three real worries were each answered locally"
          - label: ii
            text: "Why one city quietly reversed its own road plan"
          - label: iii
            text: "A simple, unchanged machine, once dismissed"
          - label: iv
            text: "Two practical pressures pushing the bicycle back"
          - label: v
            text: "What the bicycle's return is really evidence of"
        answer: "ii"
        alternatives: []
        skill_tag: skimming
        explanation: Paragraph B is the Copenhagen narrowing-and-stitching story.
      - q_num: 3
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph C."
        options:
          - label: i
            text: "How three real worries were each answered locally"
          - label: ii
            text: "Why one city quietly reversed its own road plan"
          - label: iii
            text: "A simple, unchanged machine, once dismissed"
          - label: iv
            text: "Two practical pressures pushing the bicycle back"
          - label: v
            text: "What the bicycle's return is really evidence of"
        answer: "iv"
        alternatives: []
        skill_tag: skimming
        explanation: Paragraph C names congestion and health as the two drivers.
      - q_num: 4
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph D."
        options:
          - label: i
            text: "How three real worries were each answered locally"
          - label: ii
            text: "Why one city quietly reversed its own road plan"
          - label: iii
            text: "A simple, unchanged machine, once dismissed"
          - label: iv
            text: "Two practical pressures pushing the bicycle back"
          - label: v
            text: "What the bicycle's return is really evidence of"
        answer: "i"
        alternatives: []
        skill_tag: skimming
        explanation: Paragraph D walks through the three critiques and per-city responses.
      - q_num: 5
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph E."
        options:
          - label: i
            text: "How three real worries were each answered locally"
          - label: ii
            text: "Why one city quietly reversed its own road plan"
          - label: iii
            text: "A simple, unchanged machine, once dismissed"
          - label: iv
            text: "Two practical pressures pushing the bicycle back"
          - label: v
            text: "What the bicycle's return is really evidence of"
        answer: "v"
        alternatives: []
        skill_tag: skimming
        explanation: Paragraph E is the meta-conclusion about reversible design choices.

      # 4 × true_false_not_given — Qs 6–9
      - q_num: 6
        question_type: true_false_not_given
        prompt: "The basic design of the bicycle has stayed roughly the same for over a century."
        answer: "TRUE"
        alternatives: ["T", "true"]
        skill_tag: detail
        explanation: Paragraph A says the design "has scarcely changed since the 1880s".
      - q_num: 7
        question_type: true_false_not_given
        prompt: "Copenhagen's planners publicly announced the day its bicycle journeys overtook car journeys."
        answer: "FALSE"
        alternatives: ["F", "false"]
        skill_tag: detail
        explanation: Paragraph B explicitly says the milestone passed "without anyone noticing on the day".
      - q_num: 8
        question_type: true_false_not_given
        prompt: "A car carries more people per lane than a bicycle would."
        answer: "FALSE"
        alternatives: ["F", "false"]
        skill_tag: detail
        explanation: Paragraph C says the opposite — a bike lane carries more people than the car lane it replaced.
      - q_num: 9
        question_type: true_false_not_given
        prompt: "Bogotá has introduced a free-bicycle programme in poorer districts."
        answer: "NOT GIVEN"
        alternatives: ["NG", "not given"]
        skill_tag: writer_view_TFNG
        explanation: Paragraph D names Bogotá for segregated lanes and Seville for free bicycles — not Bogotá for free bicycles.

      # 4 × short_answer — Qs 10–13
      - q_num: 10
        question_type: short_answer
        prompt: "In which decade was Copenhagen first designed around six-lane boulevards? (ONE word)"
        answer: "1960s"
        alternatives: ["the 1960s"]
        skill_tag: scanning
        explanation: Paragraph B places the original car-era plan in the 1960s.
      - q_num: 11
        question_type: short_answer
        prompt: "How many times more road space does a single-occupant car take than a bicycle? (ONE word)"
        answer: twenty
        alternatives: ["20", "twenty times"]
        skill_tag: scanning
        explanation: Paragraph C gives the figure as "twenty times".
      - q_num: 12
        question_type: short_answer
        prompt: "In which city are heated cycle shelters mentioned as a weather response? (ONE word)"
        answer: Helsinki
        alternatives: []
        skill_tag: scanning
        explanation: Paragraph D names Helsinki for heated shelters.
      - q_num: 13
        question_type: short_answer
        prompt: "What fraction of a city's commute can the bicycle still carry, according to the writer? (TWO words)"
        answer: "a quarter"
        alternatives: ["quarter", "one quarter"]
        skill_tag: detail
        explanation: Paragraph E uses "a quarter of a city to work".

  # ── Passage 2 — Qs 14–26 (mcq_single × 4, sentence_completion × 5, matching_headings × 4)
  - passage_order: 2
    slug: l3-t2-p2-the-language-of-bees
    title: "The Language of Bees"
    word_count: 520
    estimated_minutes: 20
    topic_tags: [biology, animals]
    body_markdown: |
      A In the late 1940s the Austrian zoologist Karl von Frisch published a
      result that almost no-one believed. A returning honeybee, he claimed,
      could tell the rest of her hive both the direction and the distance of a
      food source, by performing a small figure-of-eight dance on the comb.
      Direction was encoded by the angle of the dance relative to vertical;
      distance was encoded by the duration of the straight "waggle" segment in
      the middle of each loop. The dance, in other words, was a language.

      B The reaction at the time was sceptical. A bee with a brain smaller
      than a sesame seed was not expected to communicate spatial information
      that complex. Several researchers replicated the experiments but
      proposed that the bees were following smells, not dance signals; the
      so-called "odour-plume hypothesis" lingered for decades. It took the
      development of robotic dancing bees in the 1980s to settle the dispute.
      The robots had no scent at all, yet hivemates flew to the foraging
      coordinates the robots encoded.

      C What does the dance actually convey? Direction is given relative to
      the position of the sun, which the bees track even on cloudy days using
      patterns of polarised light. If the food source is directly toward the
      sun, the waggle run points straight up the vertical comb; if it is to
      the left of the sun, the run tilts proportionally to the left, and so
      on. Distance is conveyed by the length of the waggle run — roughly
      seventy-five milliseconds per hundred metres for the common European
      honeybee, though the constant varies between subspecies.

      D The discovery has consequences that reach beyond bees. It was the
      first widely accepted demonstration that a non-primate animal could
      communicate referential information — information about something
      distant in space, not just about the immediate emotional state of the
      signaller. Researchers studying alarm calls in vervet monkeys, dialects
      in whales, and gesture sequences in great apes have since followed the
      same playbook: design an experiment that decouples the candidate signal
      from any obvious confound (a smell, a posture, a context), then see
      whether the receivers act on the signal alone.

      E There is also a quieter lesson. The dance language was hidden in
      plain sight for as long as humans had kept bees, because no-one looked
      for it. Beekeepers had watched dancing bees for centuries and treated
      the movement as agitation. Von Frisch's finding was less an invention
      than the slow result of taking an obvious behaviour seriously.
    questions:
      # 4 × mcq_single — Qs 14–17
      - q_num: 14
        question_type: mcq_single
        prompt: "Why was von Frisch's 1940s result initially doubted?"
        options:
          - label: A
            text: His experiments had not been replicated.
          - label: B
            text: A bee's brain was thought too small for spatial communication.
          - label: C
            text: The food sources were undocumented.
          - label: D
            text: Honey production was unaffected.
        answer: "B"
        alternatives: []
        skill_tag: detail
        explanation: Paragraph B explicitly cites brain size as the basis for the doubt.
      - q_num: 15
        question_type: mcq_single
        prompt: "How did robotic dancing bees finally settle the dispute?"
        options:
          - label: A
            text: They carried real bees to the food source.
          - label: B
            text: They produced realistic odours.
          - label: C
            text: They had no scent, yet directed hivemates correctly.
          - label: D
            text: They flew faster than real bees.
        answer: "C"
        alternatives: []
        skill_tag: detail
        explanation: Paragraph B says the robots had no scent yet bees flew to the encoded coordinates.
      - q_num: 16
        question_type: mcq_single
        prompt: "According to paragraph C, on cloudy days bees orient themselves using"
        options:
          - label: A
            text: the moon
          - label: B
            text: magnetic fields
          - label: C
            text: polarised light patterns
          - label: D
            text: temperature gradients
        answer: "C"
        alternatives: []
        skill_tag: detail
        explanation: Paragraph C names polarised-light patterns as the cloudy-day cue.
      - q_num: 17
        question_type: mcq_single
        prompt: "What does the writer suggest is the broader significance of the dance discovery?"
        options:
          - label: A
            text: It increased global honey production.
          - label: B
            text: It opened a playbook for studying referential signals in other species.
          - label: C
            text: It made vervet research unnecessary.
          - label: D
            text: It proved that bees are primates.
        answer: "B"
        alternatives: []
        skill_tag: main_idea
        explanation: Paragraph D explicitly frames it as a methodological playbook for non-primate communication research.

      # 5 × sentence_completion — Qs 18–22
      - q_num: 18
        question_type: sentence_completion
        prompt: "A returning bee performs a figure-of-eight ____ on the comb."
        answer: dance
        alternatives: []
        skill_tag: detail
        explanation: Paragraph A names the figure-of-eight movement as the dance.
      - q_num: 19
        question_type: sentence_completion
        prompt: "The duration of the central ____ run encodes distance."
        answer: waggle
        alternatives: []
        skill_tag: detail
        explanation: The "waggle" segment is named in paragraph A and re-used in C.
      - q_num: 20
        question_type: sentence_completion
        prompt: "Direction is encoded relative to the position of the ____."
        answer: sun
        alternatives: ["Sun"]
        skill_tag: detail
        explanation: Paragraph C centres direction on the sun.
      - q_num: 21
        question_type: sentence_completion
        prompt: "Roughly seventy-five milliseconds of waggle corresponds to ____ metres of distance."
        answer: "one hundred"
        alternatives: ["100", "hundred"]
        skill_tag: scanning
        explanation: Paragraph C gives the per-100-metre conversion.
      - q_num: 22
        question_type: sentence_completion
        prompt: "Before von Frisch, beekeepers had treated the dance as ____."
        answer: agitation
        alternatives: []
        skill_tag: vocabulary_in_context
        explanation: Paragraph E uses "agitation" for the pre-discovery interpretation.

      # 4 × matching_headings — Qs 23–26 (a smaller heading bank for the last 4 paragraphs)
      - q_num: 23
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph B."
        options:
          - label: i
            text: "How robots without smell ended an old dispute"
          - label: ii
            text: "What the dance encodes — and how"
          - label: iii
            text: "Why the discovery matters beyond bees"
          - label: iv
            text: "An obvious behaviour, taken seriously at last"
        answer: "i"
        alternatives: []
        skill_tag: skimming
        explanation: Paragraph B is the odour-plume vs robot-resolution narrative.
      - q_num: 24
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph C."
        options:
          - label: i
            text: "How robots without smell ended an old dispute"
          - label: ii
            text: "What the dance encodes — and how"
          - label: iii
            text: "Why the discovery matters beyond bees"
          - label: iv
            text: "An obvious behaviour, taken seriously at last"
        answer: "ii"
        alternatives: []
        skill_tag: skimming
        explanation: Paragraph C details direction-from-sun and distance-from-duration.
      - q_num: 25
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph D."
        options:
          - label: i
            text: "How robots without smell ended an old dispute"
          - label: ii
            text: "What the dance encodes — and how"
          - label: iii
            text: "Why the discovery matters beyond bees"
          - label: iv
            text: "An obvious behaviour, taken seriously at last"
        answer: "iii"
        alternatives: []
        skill_tag: skimming
        explanation: Paragraph D generalises to non-primate communication research.
      - q_num: 26
        question_type: matching_headings
        prompt: "Choose the best heading for paragraph E."
        options:
          - label: i
            text: "How robots without smell ended an old dispute"
          - label: ii
            text: "What the dance encodes — and how"
          - label: iii
            text: "Why the discovery matters beyond bees"
          - label: iv
            text: "An obvious behaviour, taken seriously at last"
        answer: "iv"
        alternatives: []
        skill_tag: skimming
        explanation: Paragraph E reframes the discovery as patience with an obvious behaviour.

  # ── Passage 3 — Qs 27–40 (yes_no_not_given × 5, mcq_single × 4, summary_completion × 5)
  - passage_order: 3
    slug: l3-t2-p3-the-cost-of-keeping-time
    title: "The Cost of Keeping Time"
    word_count: 540
    estimated_minutes: 22
    topic_tags: [history, technology]
    body_markdown: |
      A For most of human history, time was kept by the sun. A village
      sundial, a church bell rung at noon, a workman's shadow on a wall —
      these were quite enough for an agricultural society in which nothing
      ran to a published schedule. Even the first mechanical clocks, fitted
      in church towers in fourteenth-century Italy, were accurate to no
      better than fifteen minutes a day. No-one minded; nothing they
      governed cared about fifteen minutes.

      B What changed was the railway. From the 1830s on, networks running
      trains between towns suddenly needed every station along a line to
      agree on what time it was, because trains crossing on a single track
      had to know which would be where. Local solar time, set village by
      village from the noonday sun, was no longer adequate. Britain's
      Great Western Railway adopted a single "railway time" in 1840;
      within thirty years, almost every developed country had abolished
      local solar time in favour of one or two national standards. Time
      zones — those broad pink and yellow stripes on twentieth-century
      schoolroom maps — were a railway invention.

      C The change was not received without complaint. In the United
      States, where the new continental zones meant that a town's clock
      might jump several minutes in either direction overnight, newspapers
      ran indignant editorials and rural courts continued to use solar
      noon for some decades. There was, in fact, a real cost: by aligning
      one's clock with the railway, every citizen was effectively
      surrendering a small piece of local sovereignty to a national grid.
      What was new was that the gain — being able to catch a train —
      outweighed the loss in practice for so many people that the
      complaint faded within a generation.

      D Modern accuracy is on a different scale altogether. The atomic
      clocks that maintain Coordinated Universal Time vary by no more than
      a billionth of a second per day, and the satellite navigation
      networks that now route every plane, ship and lorry depend on that
      accuracy directly: an error of one microsecond in a satellite clock
      translates into a 300-metre error in the position it broadcasts.
      What began as a railway-station synchronisation has become, in a
      sense, a planet-wide one.

      E Whether this synchronisation will remain free is a quieter
      question. The satellite networks are paid for, today, by the
      governments that operate them, and access is unrestricted. A
      cyber-attack on a navigation network, or a decision by a future
      operator to charge for access, would expose how deeply the modern
      economy now depends on a service most users have stopped noticing.
    questions:
      # 5 × yes_no_not_given — Qs 27–31 (writer-view stance)
      - q_num: 27
        question_type: yes_no_not_given
        prompt: "The writer thinks fifteen-minute clock drift was acceptable for medieval Italy."
        answer: "YES"
        alternatives: ["Y", "yes"]
        skill_tag: writer_view_TFNG
        explanation: Paragraph A explicitly says no-one minded.
      - q_num: 28
        question_type: yes_no_not_given
        prompt: "The writer presents the railway as the main driver behind national time zones."
        answer: "YES"
        alternatives: ["Y", "yes"]
        skill_tag: writer_view_TFNG
        explanation: Paragraph B and the closing line of B make this view explicit.
      - q_num: 29
        question_type: yes_no_not_given
        prompt: "The writer believes the surrender of local time to railway time was costless."
        answer: "NO"
        alternatives: ["N", "no"]
        skill_tag: writer_view_TFNG
        explanation: Paragraph C describes a "real cost" — surrender of local sovereignty.
      - q_num: 30
        question_type: yes_no_not_given
        prompt: "A microsecond error in a satellite clock produces a 30-metre error in position."
        answer: "NO"
        alternatives: ["N", "no"]
        skill_tag: inference
        explanation: Paragraph D gives the figure as 300 metres, not 30.
      - q_num: 31
        question_type: yes_no_not_given
        prompt: "The writer expects satellite-navigation access to remain free indefinitely."
        answer: "NO"
        alternatives: ["N", "no"]
        skill_tag: writer_view_TFNG
        explanation: Paragraph E raises the future-fee and cyber-attack scenarios as open risks.

      # 4 × mcq_single — Qs 32–35
      - q_num: 32
        question_type: mcq_single
        prompt: "According to paragraph A, fourteenth-century mechanical clocks"
        options:
          - label: A
            text: were more accurate than sundials
          - label: B
            text: drifted by about a quarter-hour a day
          - label: C
            text: were synchronised with a national standard
          - label: D
            text: were used to control railway timing
        answer: "B"
        alternatives: []
        skill_tag: detail
        explanation: Fifteen minutes a day is, roughly, a quarter-hour.
      - q_num: 33
        question_type: mcq_single
        prompt: "Britain's Great Western Railway is mentioned as"
        options:
          - label: A
            text: the inventor of the mechanical clock
          - label: B
            text: the operator that adopted a single 'railway time' in 1840
          - label: C
            text: the first to use atomic clocks
          - label: D
            text: a rural court that resisted the change
        answer: "B"
        alternatives: []
        skill_tag: detail
        explanation: Paragraph B names the GWR as the 1840 adopter.
      - q_num: 34
        question_type: mcq_single
        prompt: "What does the writer say modern satellite navigation depends on?"
        options:
          - label: A
            text: solar time set per village
          - label: B
            text: church-bell synchronisation
          - label: C
            text: atomic-clock accuracy at the nanosecond scale
          - label: D
            text: railway-time signals from the 1840s
        answer: "C"
        alternatives: []
        skill_tag: detail
        explanation: Paragraph D ties satellite navigation to atomic-clock accuracy.
      - q_num: 35
        question_type: mcq_single
        prompt: "The closing paragraph (E) is best described as"
        options:
          - label: A
            text: a celebration of unrestricted access
          - label: B
            text: a quiet warning about dependence
          - label: C
            text: a technical correction to paragraph D
          - label: D
            text: a defence of solar time
        answer: "B"
        alternatives: []
        skill_tag: main_idea
        explanation: Paragraph E flags the risks of cyber-attack and future fees.

      # 5 × summary_completion — Qs 36–40
      - q_num: 36
        question_type: summary_completion
        prompt: "Before the railway, time was kept by the ____."
        answer: sun
        alternatives: ["the sun"]
        skill_tag: detail
        explanation: Paragraph A names the sun as the pre-railway time source.
      - q_num: 37
        question_type: summary_completion
        prompt: "Networks running trains needed every ____ along a line to agree on the time."
        answer: station
        alternatives: ["stations"]
        skill_tag: detail
        explanation: Paragraph B locates the synchronisation problem at the level of stations.
      - q_num: 38
        question_type: summary_completion
        prompt: "A 'real cost' of the change was surrendering a piece of local ____."
        answer: sovereignty
        alternatives: []
        skill_tag: vocabulary_in_context
        explanation: Paragraph C uses "sovereignty" for the surrendered local quality.
      - q_num: 39
        question_type: summary_completion
        prompt: "An atomic clock varies by no more than a ____ of a second per day."
        answer: billionth
        alternatives: ["billionth part"]
        skill_tag: scanning
        explanation: Paragraph D gives the billionth-of-a-second drift figure.
      - q_num: 40
        question_type: summary_completion
        prompt: "Modern users tend not to notice the synchronisation service their economy ____ on."
        answer: depends
        alternatives: ["depend"]
        skill_tag: detail
        explanation: Paragraph E uses "depends" for the underlying reliance.
---
<!--
L3 files are YAML-only. Anything below the closing `---` fence is intentionally
unused by parse_reading_test — the entire test (metadata + 3 passage bodies +
all 40 questions) lives in the frontmatter above. This footer exists only so a
human reader who scrolls past the fence does not assume the file is truncated.
-->
