---
# ── L2 Skill Practice example ──────────────────────────────────────────
# Worked example accompanying reading_content_format_v2.md §5.
# Round-trips clean through parse_reading_passage → validate_reading_passage.
#
# Key L2 difference vs L1: skill_focus is REQUIRED (must be in SKILL_TAGS).
# Per-question skill_tag may differ from skill_focus where the question
# genuinely probes a secondary skill — don't force every Q to match.

content_type: reading_skill_exercise
title: "Scanning for Numbers — A Brief History of the Bus"
slug: scan-history-of-the-bus
skill_focus: scanning            # the primary skill this exercise drills
difficulty_level: foundation
topic_tags: [history, transport]
estimated_minutes: 7
word_count: 290
published: true

questions:
  # ── Three scanning Qs first (drilling the primary skill) ──
  - q_num: 1
    question_type: short_answer
    prompt: "In which year did the first horse-drawn omnibus run in Paris? (ONE number)"
    answer: "1828"
    alternatives: []
    skill_tag: scanning
    sub_skill: locate-year
    explanation: Paragraph 1 names 1828 as the Paris first-run year.

  - q_num: 2
    question_type: short_answer
    prompt: "Approximately how many passengers did the first London horse-bus carry per trip? (ONE number)"
    answer: "22"
    alternatives: ["twenty-two", "twenty two"]
    skill_tag: scanning
    sub_skill: locate-number
    explanation: Paragraph 2 gives the figure of 22 passengers in the early London buses.

  - q_num: 3
    question_type: short_answer
    prompt: "In which decade did the first motor bus enter regular service in Britain? (ONE word)"
    answer: "1900s"
    alternatives: ["1900s.", "the 1900s"]
    skill_tag: scanning
    sub_skill: locate-decade
    explanation: Paragraph 3 places the first motor-bus service in the 1900s.

  # ── A matching_headings Q (secondary skill — skimming) ──
  - q_num: 4
    question_type: matching_headings
    prompt: "Choose the best heading for the last paragraph (paragraph 4)."
    options:
      - label: i
        text: Why electric buses cost less than diesel
      - label: ii
        text: From horses to engines to electricity
      - label: iii
        text: A century of mechanical struggle
    answer: "ii"
    alternatives: []
    skill_tag: skimming
    sub_skill: heading-match
    explanation: Paragraph 4 traces the full arc from horse-drawn → motor → electric.

  # ── A T/F/NG Q (drilling detail-checking) — answer is QUOTED ──
  - q_num: 5
    question_type: true_false_not_given
    prompt: "The first motor buses were quieter than the horse-drawn vehicles they replaced."
    answer: "NOT GIVEN"
    alternatives: ["NG", "not given"]
    skill_tag: detail
    sub_skill: check-claim
    explanation: The passage discusses speed and reliability but says nothing about noise.

  # ── A sentence_completion Q (vocabulary-in-context) ──
  - q_num: 6
    question_type: sentence_completion
    prompt: "Modern city fleets are now switching from diesel to ____ buses."
    answer: electric
    alternatives: ["electric ones"]
    skill_tag: vocabulary_in_context
    explanation: Paragraph 4 names "electric" as the current replacement for diesel.
---
The bus is so familiar a part of city life that it is easy to forget how
recent an invention it is. The first regular service ran in Paris in 1828,
when a retired army officer named Stanislas Baudry began running a
horse-drawn carriage between his bathhouse and the city centre — partly so
that more customers could reach his business. Passengers paid a small fixed
fare, regardless of how far they travelled, and the route ran on a published
timetable. The idea was copied within a year by London and New York.

The early London horse-bus was a modest affair: a single deck pulled by two
or three horses, carrying about 22 passengers down rutted streets at a brisk
walking pace. Drivers were paid by the day; conductors took fares with a
canvas bag and a bell. By the 1860s every large European city had a
horse-bus network, and the animals themselves — fed, stabled, replaced — had
become a significant urban expense.

The first motor bus entered regular service in Britain in the 1900s, after
several years of cautious trials. The engines were unreliable at first, and
operators kept stables of horses ready to step back in. Within a generation,
however, the motor bus had won. It was faster, ran in any weather, and could
keep going long after a horse would have needed rest. By the late 1920s the
horse-bus was effectively gone.

A century on, the bus is changing again. Diesel engines, which replaced
horses, are now themselves being replaced by **electric** drives, with their
batteries charged at the depot overnight. Cities from Shenzhen to Bogotá now
operate entirely electric bus fleets, and several European capitals have
committed to following them before 2030. The history of the bus, in short,
has been a history of one motor giving way to the next.
