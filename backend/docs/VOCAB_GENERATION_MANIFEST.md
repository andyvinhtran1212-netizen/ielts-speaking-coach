# Vocab generation manifest — all remaining batches

This is the **WHAT-to-create** companion to `VOCAB_UPLOAD_FORMAT.md` (the
**HOW-to-shape-a-card** brief). Hand the agent **both files** plus **one batch
block** from below, per run. Everything the agent needs to generate the entire
remaining vocabulary is here.

## Status
- **Done:** AWL Sublist 1 (60) — already in `content_vocab/`.
- **Remaining (this manifest):** AWL Sublists 2–10 (510), `toeic-core` (~300,
  curated), `thpt-core` (~250, curated).

## Source & honesty
- **AWL** (Academic Word List, Averil Coxhead — 570 headwords, 10 sublists) is a
  **published, canonical** list. Sublist membership below is verified against the
  published sublists. This is the authoritative backbone.
- **`toeic-core` / `thpt-core`** are **curated** thematic lists, NOT official
  published word lists (ETS does not publish a TOEIC word list; THPT has no single
  canonical list). Treat them as a strong core you can extend — do not label cards
  as coming from an "official" list.

## One card per unique headword (dedup rule — read before generating)
Generate **exactly one card per unique headword**, even if a word could sit on
several lists.
- The three list groups below are kept **disjoint on purpose**: `toeic-core` /
  `thpt-core` deliberately exclude AWL headwords.
- If a curated word shares a **word family** with an AWL headword already covered
  (e.g. `promotion` ↔ AWL `promote`, `investment` ↔ AWL `invest`), **drop it from
  the curated batch** — the AWL card's `word_family` already covers the derived
  form. When in doubt, prefer the AWL card and add the exam flag there via
  `tested_in` / an extra `lists` entry.
- A word that genuinely belongs to multiple lists → one card, multiple `lists`
  slugs + multiple `tested_in` flags. Never two cards with the same `slug` in the
  same `category`.
- The curated lists below are long enough that a few words may repeat across
  themes — **de-duplicate to a unique set before generating** (target counts are
  approximate).

## Per-batch flow (repeat for each block)
1. Paste `VOCAB_UPLOAD_FORMAT.md` (format + agent brief) + one batch block below.
2. Agent returns one `.md` file (one frontmatter block per headword).
3. Dry-run import → the gate `test_vocab_kp_fields_structurally_valid` rejects any
   bad `lists`/`tested_in`/`related_grammar`. Fix and re-run.
4. Spot-check accuracy of a sample (definitions, examples, `common_error`).
5. Bump the count tripwires in `tests/test_vocab_content*.py` /
   `tests/test_vocab_import.py`, commit.

> All AWL list slugs (`awl-sublist-2` … `awl-sublist-10`) and `toeic-core` /
> `thpt-core` are already registered in `content_vocab/_lists.yaml`, so cards
> stamped with them pass the gate. New `category` topics still need a
> `_categories.yaml` entry.
>
> **Tip:** `toeic-core` (~300) and `thpt-core` (~250) are large — split each into
> ~60-word sub-batches (by theme groups below) so one dry-run import surfaces all
> validation errors at once and a reviewer can spot-check before committing.

---

# Part A — Academic Word List (canonical)

Shared settings for **every** AWL batch:
```
EXAM SOURCES:  ielts_reading   → tested_in: ["ielts_reading"]
               (add "toeic_rc" for business/work words: e.g. corporate, fund,
                invest, purchase, credit, commission, contract, revenue, budget;
                add "thpt_qg" for general/high-frequency words)
DEFAULT LEVEL: B2              (agent adjusts A2–C2 per word; later sublists skew C1)
CATEGORIES:    reuse the 7 topics (environment, technology, education,
               work-career, health, people-society, economy); add a new topic only
               if none fits (+ declare it in _categories.yaml)
OUTPUT:        one .md file per sublist, one frontmatter block per headword
```

### Batch A2 — `awl-sublist-2` (lists: ["awl-sublist-2"], 60)
```
achieve, acquire, administrate, affect, appropriate, aspect, assist, category,
chapter, commission, community, complex, compute, conclude, conduct, consequent,
construct, consume, credit, culture, design, distinct, element, equate, evaluate,
feature, final, focus, impact, injure, institute, invest, item, journal, maintain,
normal, obtain, participate, perceive, positive, potential, previous, primary,
purchase, range, region, regulate, relevant, reside, resource, restrict, secure,
seek, select, site, strategy, survey, text, tradition, transfer
```

### Batch A3 — `awl-sublist-3` (lists: ["awl-sublist-3"], 60)
```
alternative, circumstance, comment, compensate, component, consent, considerable,
constant, constrain, contribute, convention, coordinate, core, corporate,
correspond, criteria, deduce, demonstrate, document, dominate, emphasis, ensure,
exclude, framework, fund, illustrate, immigrate, imply, initial, instance,
interact, justify, layer, link, locate, maximise, minor, negate, outcome, partner,
philosophy, physical, proportion, publish, react, register, rely, remove, scheme,
sequence, sex, shift, specify, sufficient, task, technical, technique, technology,
valid, volume
```
> Review notes: `criteria` = plural of *criterion* (flag in `common_error`);
> `register`/`shift`/`core`/`link` are polysemous — pick the academic sense.

### Batch A4 — `awl-sublist-4` (lists: ["awl-sublist-4"], 60)
```
access, adequate, annual, apparent, approximate, attitude, attribute, civil, code,
commit, communicate, concentrate, confer, contrast, cycle, debate, despite,
dimension, domestic, emerge, error, ethnic, goal, grant, hence, hypothesis,
implement, implicate, impose, integrate, internal, investigate, job, label,
mechanism, obvious, occupy, option, output, overall, parallel, parameter, phase,
predict, principal, prior, professional, project, promote, regime, resolve, retain,
series, statistic, status, stress, subsequent, sum, summary, undertake
```
> Review notes: `principal` ≠ `principle` (AWL S1) — flag the confusion.

### Batch A5 — `awl-sublist-5` (lists: ["awl-sublist-5"], 60)
```
academy, adjust, alter, amend, aware, capacity, challenge, clause, compound,
conflict, consult, contact, decline, discrete, draft, enable, energy, enforce,
entity, equivalent, evolve, expand, expose, external, facilitate, fundamental,
generate, generation, image, liberal, licence, logic, margin, medical, mental,
modify, monitor, network, notion, objective, orient, perspective, precise, prime,
psychology, pursue, ratio, reject, revenue, stable, style, substitute, sustain,
symbol, target, transit, trend, version, welfare, whereas
```
> Review notes: `discrete` ≠ `discreet`; `licence` (noun) vs `license` (verb) — accept both spellings.

### Batch A6 — `awl-sublist-6` (lists: ["awl-sublist-6"], 60)
```
abstract, accurate, acknowledge, aggregate, allocate, assign, attach, author, bond,
brief, capable, cite, cooperate, discriminate, display, diverse, domain, edit,
enhance, estate, exceed, expert, explicit, federal, fee, flexible, furthermore,
gender, ignorant, incentive, incidence, incorporate, index, inhibit, initiate,
input, instruct, intelligent, interval, lecture, migrate, minimum, ministry,
motive, neutral, nevertheless, overseas, precede, presume, rational, recover,
reveal, scope, subsidy, tape, trace, transform, transport, underlie, utilise
```

### Batch A7 — `awl-sublist-7` (lists: ["awl-sublist-7"], 60)
```
adapt, adult, advocate, aid, channel, chemical, classic, comprehensive, comprise,
confirm, contrary, convert, couple, decade, definite, deny, differentiate, dispose,
dynamic, eliminate, empirical, equip, extract, file, finite, foundation, globe,
grade, guarantee, hierarchy, identical, ideology, infer, innovate, insert,
intervene, isolate, media, mode, paradigm, phenomenon, priority, prohibit,
publication, quote, release, reverse, simulate, sole, somewhat, submit, successor,
survive, thesis, topic, transmit, ultimate, unique, visible, voluntary
```

### Batch A8 — `awl-sublist-8` (lists: ["awl-sublist-8"], 60)
```
abandon, accompany, accumulate, ambiguous, append, appreciate, arbitrary, automate,
bias, chart, clarify, commodity, complement, conform, contemporary, contradict,
crucial, currency, denote, detect, deviate, displace, drama, eventual, exhibit,
exploit, fluctuate, guideline, highlight, implicit, induce, inevitable,
infrastructure, inspect, intense, manipulate, minimise, nuclear, offset, paragraph,
plus, practitioner, predominant, prospect, radical, random, reinforce, restore,
revise, schedule, tense, terminate, theme, thereby, uniform, vehicle, via, virtual,
visual, widespread
```
> Review notes: `complement` ≠ `compliment` — flag in `common_error`.

### Batch A9 — `awl-sublist-9` (lists: ["awl-sublist-9"], 60)
```
accommodate, analogy, anticipate, assure, attain, behalf, bulk, cease, coherent,
coincide, commence, compatible, concurrent, confine, controversy, converse, device,
devote, diminish, distort, duration, erode, ethic, format, found, inherent, insight,
integral, intermediate, manual, mature, mediate, medium, military, minimal, mutual,
norm, overlap, passive, portion, preliminary, protocol, qualitative, refine, relax,
restrain, revolution, rigid, route, scenario, sphere, subordinate, supplement,
suspend, team, temporary, trigger, unify, violate, vision
```
> Review notes: `accommodate` — double-c double-m (very common misspelling); flag it.

### Batch A10 — `awl-sublist-10` (lists: ["awl-sublist-10"], 30)
```
adjacent, albeit, assemble, collapse, colleague, compile, conceive, convince,
depress, encounter, enormous, forthcoming, incline, integrity, intrinsic, invoke,
levy, likewise, nonetheless, notwithstanding, odd, ongoing, panel, persist, pose,
reluctance, so-called, straightforward, undergo, whereby
```

---

# Part B — TOEIC core (curated, business/office; non-AWL)

```
TARGET LIST:   toeic-core            → lists: ["toeic-core"]
EXAM SOURCES:  toeic_rc, toeic_lc    → tested_in: ["toeic_rc", "toeic_lc"]
DEFAULT LEVEL: B1                     (workplace English; agent adjusts A2–B2)
CATEGORIES:    mostly work-career + economy; use others where a word fits better
COUNT:         ~300 (one card per unique headword; DROP AWL-family overlaps per dedup rule)
```
Split into ~5 sub-batches by the theme groups below (each ≈ 55–65 words).

**B1 — Employment & HR:** applicant, résumé, recruit, hire, candidate, interview,
salary, wage, payroll, pension, dismiss, resign, resignation, workforce, personnel,
supervisor, supervise, intern, apprentice, overtime, vacancy, workload, employee,
employer, orientation, appraisal, probation, staffing, headhunter, shortlist,
onboarding, reassign, relocate, severance, timesheet, attendance, absence, bonus,
perk, morale, understaffed, headcount

**B1 — Office & admin:** memo, agenda, deadline, appointment, stationery,
photocopier, spreadsheet, folder, invoice, receipt, voucher, supplies, clerk,
workspace, letterhead, envelope, cubicle, filing, printout, shredder, calendar,
reminder, checklist, template, paperwork, correspondence, forward, attachment

**B2 — Meetings & events:** presentation, handout, projector, attendee,
chairperson, adjourn, postpone, reschedule, keynote, minutes, briefing, delegate,
quorum, venue, seminar, webinar, workshop, breakout, follow-up, brainstorm,
teleconference, videoconference, refreshments, badge, catering

**B2 — Finance & accounting:** expense, profit, refund, discount, deposit, mortgage,
loan, audit, taxation, fiscal, accountant, bookkeeping, turnover, reimburse,
overdue, ledger, balance, statement, earnings, dividend, asset, overhead,
expenditure, installment, arrears, remittance, payable, receivable, budget,
quarterly, profitable, solvent

**B3 — Banking & insurance:** account, branch, teller, overdraft, interest, premium,
policyholder, claim, coverage, deductible, underwrite, beneficiary, collateral,
savings, currency, withdrawal, transaction, creditor, debtor, insurer, payout

**B3 — Sales & marketing:** advertisement, brochure, catalogue, campaign, retail,
wholesale, merchandise, warranty, customer, client, vendor, supplier, competitor,
brand, coupon, storefront, showroom, testimonial, endorsement, billboard, flyer,
slogan, markup, clearance, loyalty, subscription, upsell, publicity, sponsorship,
spokesperson

**B4 — Customer service:** complaint, inquiry, feedback, satisfaction, exchange,
replacement, helpline, hotline, representative, courteous, apologize, goodwill, escalate, refundable, dissatisfied

**B4 — Contracts & real estate:** agreement, obligation, liability, breach,
negotiate, renew, tenant, landlord, lease, premises, deed, signatory, binding,
expire, addendum, terms, sublet, occupancy, leaseholder, rental

**B4 — Travel & logistics:** itinerary, reservation, boarding, luggage, customs,
shipment, freight, cargo, delivery, courier, dispatch, warehouse, packaging,
carrier, checkout, layover, terminal, departure, arrival, concierge, round-trip,
tracking, expedite, logistics, baggage, check-in, forwarding, boarding-pass

**B5 — Manufacturing & quality:** assembly, factory, machinery, equipment,
maintenance, defect, faulty, inspection, recall, blueprint, malfunction, production,
conveyor, prototype, durable, flaw, inventory, stockroom, surplus, shortage,
procurement, wholesaler, overhaul, defective

**B5 — Facilities & IT:** renovation, refurbish, utilities, janitor, elevator,
headquarters, parking, lobby, reception, workstation, server, password, software,
hardware, upgrade, backup, helpdesk, outage, downtime, keycard, floor-plan

---

# Part C — THPT core (curated, general B1–B2; non-AWL, non-TOEIC)

```
TARGET LIST:   thpt-core             → lists: ["thpt-core"]
EXAM SOURCES:  thpt_qg               → tested_in: ["thpt_qg"]
DEFAULT LEVEL: B1                     (school-exam English; agent adjusts A2–B2)
CATEGORIES:    spread across education, environment, health, people-society,
               technology as topic fits
COUNT:         ~250 (one card per unique headword; DROP AWL-family overlaps per dedup rule)
```
Split into ~4 sub-batches by the theme groups below (each ≈ 55–65 words).

**C1 — Family & relationships:** household, chore, relative, sibling, upbringing,
breadwinner, nurture, obey, spoil, housework, marriage, engagement, divorce,
in-laws, offspring, toddler, adolescent, elderly, caregiver, affection, quarrel,
reconcile, kinship, guardian, foster, stepmother, nickname, gathering

**C1 — Education & school:** curriculum, tuition, scholarship, graduate,
undergraduate, dormitory, semester, extracurricular, literacy, vocational,
examination, certificate, kindergarten, headmaster, timetable, pupil, tutor,
memorize, enrol, expel, truant, homework, textbook, blackboard, diploma,
distinction, coursework, revision, boarding-school, term

**C2 — Environment:** pollution, deforestation, greenhouse, emission, renewable,
recycle, endangered, habitat, conservation, wildlife, drought, flood, litter,
ecosystem, ozone, extinction, biodiversity, contamination, sewage, pesticide,
landfill, reforestation, carbon, glacier, smog, poaching, overfishing, wetland

**C2 — Weather & nature:** climate, thunderstorm, humidity, hurricane, breeze,
frost, foggy, tropical, temperate, avalanche, earthquake, tsunami, volcano,
drizzle, blizzard, downpour

**C3 — Technology (everyday):** gadget, download, upload, browse, robot, digital,
cyber, smartphone, wireless, software, hardware, offline, password, touchscreen,
keyboard, headset, streaming, video-game, drone, sensor, app, selfie, emoji,
charger, notification

**C3 — Health & lifestyle:** diet, nutrition, obesity, epidemic, vaccine, hygiene,
immune, symptom, remedy, wellbeing, fitness, disease, checkup, therapy, calorie,
allergy, infection, contagious, dehydration, insomnia, posture, workout, vitamin,
sedentary, addiction, overweight, painkiller, bandage, outbreak

**C4 — Society & culture:** custom, heritage, festival, ritual, ancestor,
superstition, minority, urbanization, poverty, charity, volunteer, citizenship,
prejudice, equality, tolerance, generosity, hospitality, etiquette, folklore,
costume, ceremony, worship, lunar, offering, ancestral

**C4 — Careers, media & travel:** unemployment, ambition, qualification, skilled,
freelance, apprenticeship, vocation, workaholic, aspiration, livelihood, broadcast,
headline, celebrity, audience, blockbuster, documentary, cartoon, sitcom, sequel,
soundtrack, rehearsal, applause, spectator, destination, sightseeing, souvenir,
accommodation, backpack, ecotourism, landmark, tourist, scenery, excursion,
homestay, guidebook, breathtaking
