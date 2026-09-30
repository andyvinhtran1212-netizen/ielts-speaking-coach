# Bounded academic source and policy selection

This scope binds the independently approved final18 academic source bytes/map selection; technical implementation and canonical publication remain open. Twelve is a maximum explicit allowlist. Every candidate requires its own canonical footprint, independently reviewed raw bytes/map/qid-field diff, and current/legacy cutover proof. No blanket strict Grammar mode.

## Explicit codes and named matching selection

| Canonical code | Questions | Exact qids | Retained legacy text qids |
| --- | --- | --- | --- |
| G-parts-of-speech-verbs | 23 | verb_stat_i2, verb_sva_i2, verb_pp_i2 | verb_link_i2 |
| G-sentence-structures-passive-voice | 20 | pv_form_i2, pv_use_a1, pv_intr_i2, pv_err_i2 | none |
| G-tenses-past-continuous | 26 | pc_form_i2, pc_form_i3, pc_interrupt_i2, pc_interrupt_i3, pc_while_i2, pc_while_i3, pc_stative_i2, pc_stative_i3 | none |
| G-tenses-present-continuous | 27 | pc_form_i2, pc_ing_i2, pc_trend_i2, pc_temp_i2, pc_stative_i2 | none |
| G-tenses-present-perfect-continuous | 27 | ppc_form_i2, ppc_vspp_i2, ppc_stative_i2, ppc_vspc_i2 | ppc_forsince_i2 |
| G-tenses-present-simple | 31 | ps_3s_i2, ps_3s_i3, ps_dd_i2, ps_dd_i3, ps_truth_i2, ps_truth_i3, ps_adv_i2, ps_adv_i3, ps_vspc_i2 | none |
| G-grammar-for-reading-participle-clauses | 16 | pc_ving_i2, pc_v3_i2, pc_having_i2 | pc_meaning_i2 |
| G-grammar-for-reading-long-sentence-untangling | 17 | none | lsu_main_i2, lsu_strip_i2, lsu_pitfall_i3 |
| G-grammar-for-reading-reduced-relative-clauses | 12 | rrc_ving_i2, rrc_v3_i2, rrc_main_i2 | none |
| G-tenses-past-perfect | 23 | pqp_form_i2, pqp_seq_i2, pqp_bytime_i2, pqp_cond3_i2, pqp_reported_i2 | none |
| G-foundations-phrase-vs-clause | 18 | pvc_frag_i2, pvc_dang_i2 | pvc_pc_i2, pvc_run_i2 |
| G-error-clinic-dangling-modifiers | 24 | dm_subj_i2, dm_clause_i2, dm_toinf_i2 | dm_part_i2 |

Totals:12 codes,264 authored questions,58 text questions,49 exact candidates and9 retained legacy. Map contains only named exact entries for this tranche; legacy rows omit entries. Explicit typo_tolerant is contract-supported but does not override existing short/case-sensitive/orthography restrictions. Nonempty typo-only maps still require admission capability. Identical qids in different banks resolve bank-locally.

## Reference raw source hashes before new authoring

These are inspected sources WITHOUT new maps/final wording amendments, not final publication allowlist values. Six F01 sources in aver-ux-grammar-cutover match current REVIEWED_SOURCES; R03 and optional hashes come from independently parsed review inventory. Before copying F01 into the older R03 authoring checkout, verify exact bytes against this manifest and current staging, preserve the existing nine dirty R03 files, and record the copy. No git reset or silent replacement of unrelated work.

| Code | Reference SHA256 |
| --- | --- |
| G-parts-of-speech-verbs | 5ff344a88afc52d6aceb8ebe48e25c28b10651deb452b5f76e6fe6dc166cc999 |
| G-sentence-structures-passive-voice | 2243c9b093b28073fb1cf144b25ab09c3b7499c18bae988c2066d823780fdd51 |
| G-tenses-past-continuous | 835ab7040b48e0718a63b02cd6978d1636f2dd75af3f773e5e228ff102307b06 |
| G-tenses-present-continuous | f8ca14398b299aeb5eb559f3f84e92178a7508dccd87d451469f0f6e19a177da |
| G-tenses-present-perfect-continuous | bac7024bc0b9f70c022ac1ac4485a0d85d886321bc013ecb8e32ddbc97a68549 |
| G-tenses-present-simple | bfa1d0193bd68a2028702016a98eb932052117ec62f22be69a50b7ae2eaed03d |
| G-grammar-for-reading-participle-clauses | 80652e9e6f1bd8e801c0e6c7a24804d6ff2cfebb4a89f65f780343eeff0ca2fa |
| G-grammar-for-reading-long-sentence-untangling | aba98cc47d8c98cdb4683a02e4005f5431be80013daa35c8f3c8ef325f715eb8 |
| G-grammar-for-reading-reduced-relative-clauses | 8b8080b895d1b09114185f6839a9b968c2b5d977a5428a7f8d8b5fd202c3ae2f |
| G-tenses-past-perfect | 37e0a5cdb02c9360f8ab08c787c7e7efb9ecde14540e22dc4c601b5681e80ebe |
| G-foundations-phrase-vs-clause | 48102e8110350374f1e90861e17e6f3f3ab3f0c9dd81761cb82f99ce8b885c1b |
| G-error-clinic-dangling-modifiers | c6a1f410b705ab02b46a47ecce5029a933a876a70d85997d1bee47207c9174fe |

## Academic source corrections

### Six F01 banks

Keep the already independently reviewed F01 correction and its reviewed keys/accepts. Add visible requested tense/form to each selected text item wherever the pool label or open context alone supplies the target: all selected Past Continuous production except the already requested Past Simple want/believe items; selected Present Continuous except requested Present Simple want; PPC/Present Perfect know; selected Present Simple; verbs understand/boil/build as appropriate. Passive pv_intr_i2 explicitly requests Past Simple; pv_err_i2 says REGULAR announce and future passive. Preserve qid/order/pool/mastery/type; keys/options/accepts differ only for the explicitly named final academic exceptions below. These new prompt/map qid changes require an expanded explicit per-code source/field/hash manifest; the old23-change allowlist cannot silently admit them. No new six-article body rewrite is part of this correction.

### Four R03 banks and articles

Retain the37 independently reviewed source corrections plus these bounded amendments:

- pqp_cond3_b1/i1/i2 visibly request Type3; preserve keys/accepts.
- lsu_strip_a2 uses element rather than clause for predicate; all3 LSU typed prompts request S+mainV/core (may include complement), preserve short/full accepts and explain the full main clause separately. Replace gạch bỏ/gạch đi with tạm nhóm where meaning extraction is intended; essential complement/object is retained in full meaning.
- Past Perfect article supplies an explicit past reference for its today/had made example; duration/current relevance/no-backshift qualifications remain.
- Participle/ReducedRelative/Longsentence article edits stay within reviewed no-independent-tense, agent/context, full/reduced and main/core/complement corrections; preserve slug/category/anchors/learning metadata.

Current37 changed qids (source review basis):

- G-grammar-for-reading-participle-clauses: pc_ving_b1, pc_ving_i1, pc_ving_i2, pc_v3_b1, pc_v3_i1, pc_v3_i2, pc_having_b1, pc_having_i1, pc_having_i2, pc_meaning_b1, pc_meaning_a1
- G-grammar-for-reading-long-sentence-untangling: lsu_main_b1, lsu_main_i2, lsu_strip_i2, lsu_strip_a1, lsu_strip_a2, lsu_pitfall_i3
- G-grammar-for-reading-reduced-relative-clauses: rrc_ving_b1, rrc_ving_i1, rrc_v3_b1, rrc_v3_i1, rrc_v3_i2, rrc_main_i2, rrc_main_a1
- G-tenses-past-perfect: pqp_form_b2, pqp_form_i1, pqp_form_i2, pqp_seq_i2, pqp_seq_a2, pqp_bytime_b1, pqp_bytime_i1, pqp_bytime_i2, pqp_bytime_a1, pqp_reported_b1, pqp_reported_i1, pqp_reported_i2, pqp_reported_a1

Article paths: backend/content/grammar-for-reading/participle-clauses.md, long-sentence-untangling.md, reduced-relative-clauses.md; backend/content/tenses/past-perfect.md. Their existing reviewed bodies are preserved and amended only as above.

### Two optional banks and related articles

All42 questions were independently adjudicated; preserve integer keys/qids/order/pools/mastery/types. Author only named defects and related unsupported categorical explanations:

| Qid | Bounded target correction |
| --- | --- |
| pvc_pc_b1 | Ask FINITE clause with expressed subject; no modern nonfinite-clause ambiguity. |
| pvc_pc_a1 | Assert finite/independent clause criterion, preserve FALSE; do not deny all nonfinite clauses. |
| pvc_frag_i1 | Require retaining Because/dependent cause clause; preserve keyed add-main choice. |
| pvc_frag_i2 | Explicit Present Simple remain; same remains accept; exact map. |
| pvc_run_i2 | Explicitly request semicolon; same ; accept; punctuation-only raw comparison/legacy. |
| pvc_dang_i2 | Require she+PastSimple celebrate; revised accept only she celebrated, not celebrated; exact map. |
| dm_part_b2 | Explicit human proofreading meaning; preserve FALSE without claiming a printer can never finish printing a report. |
| dm_part_i2 | Provide the exact four allowed actor choices visibly; same accepted actors; retained legacy. |
| dm_subj_i2 | Provide exact four actor choices +PastSimple rush cue; same accepted phrases; exact map. |
| dm_subj_a2 | Explicitly name city council; preserve keyed option and explain referential it is not universally impossible. |
| dm_clause_b2 | TRUE objective: identify expressed you/finite sign in Before you sign..., the terms...; no categorical ban on original generic passive. |
| dm_clause_i2 | Past sequence +she/live cue; revised accepts she lived/she had lived, omit she has lived; exact map. |
| dm_toinf_b2 | TRUE objective: students is explicit actor in To pass..., students must work hard; no categorical verdict on hard work is needed. |
| dm_toinf_i2 | Provide exact three construction cues (governments must+regulate, consumers should+recycle, everyone must+help), same3accepts; exact map; no unrestricted prose. |
| dm_toinf_a1 | FALSE universal: passive alone always guarantees a clear purpose actor; no categorical verdict on specific programmes sentence. |

Qualify remaining explanations only where the42-row audit identified unsupported universal-human-only/passive-wrong reasoning (e.g. printer action, cheap meaning, subject-versus-predicate edit, best explicit-agent transformation versus blanket sentence ban). pvc_pc_i2 clarifies what is an expressed subject. The actual explain-only qid/field diff must be listed/reviewed before source hash approval; this does not authorize rewriting every control.

Related article paragraphs in backend/content/foundations/phrase-vs-clause.md and backend/content/error-clinic/dangling-modifiers.md may align finite/nonfinite terminology and stated agent/task qualifications, preserving slug/category/anchors/links/progression. Do not expand into a taxonomy or generic passive style rewrite.

## Publication constraints

The two optional accepted-set removals occur only in a separately created revised bank; original accepted forms/raw source/history stay immutable. Existing F01 reviewed answer changes remain the earlier correction; additional corrected-bank keys/options/accepts differ only for the final named academic exceptions below. Final approved manifest records original canonical fingerprint, all new source bytes/maps, per-qid changed fields and current revision identity. Final SHA approval is separate from this behavioral contract and is bound in approval.md. No source-only change closes grading/canonical cutover acceptance.

## Prior frozen authored candidate bundle — historical, not final approval

The source-only handoff is evidence/r03-bounded-source-authoring/HANDOFF.md with
final-source-bundle-manifest.json SHA256 8027272cb3214ce9ea662bfe8eca0274bf2903cf8c97a5357cd4e822b2a93025.
It preserves all264 questions and contains49 exact/9 legacy text candidates,11
nonempty maps. Frozen12 bank raw hashes and6 applicable article hashes are recorded
below and in source-scope.json separately from reference-before-authoring hashes.
These are candidates for independent root/content approval, not publication allowlist
approval.478 content-source tests/84 accepted forms pass; current parser drops maps
and current engine still has5 morphology false positives, so feature gates stay open.

Use the final authored004ce bundle below for the one bounded cutover per code.
No interim6 old hashes may be published first. Actual canonical missing/already-cutover
state and retained question extras/why_wrong on changed keys require read-only
academic preflight; never infer zero or auto-edit extras. An already-managed code
needs a separate approved decision, not a second-cutover bypass.

| Historical source | Prior candidate SHA-256 | Historical status |
| --- | --- | --- |
| backend/content/error-clinic/dangling-modifiers.md | cc455e30d1f802d00e2a82eb819b3b7f35c88dd6a3825c36aa8bb222be71b366 | Historical802; superseded |
| backend/content/foundations/phrase-vs-clause.md | f1d825de14aa54255fd0f8fa9ab538147659c02586b8ed0e0590cb01728b6ec4 | Historical802; superseded |
| backend/content/grammar-for-reading/long-sentence-untangling.md | 6402f4573051114a9cb60d2823ea32fc98eee3e5acda813eb5f394ef0e9c1510 | Historical802; superseded |
| backend/content/grammar-for-reading/participle-clauses.md | 489c669cc69866f728b42440a4802883017a16c6adc3b90cb0b7358a68d85496 | Historical802; superseded |
| backend/content/grammar-for-reading/reduced-relative-clauses.md | 190fd721393ed092ac8587ee630cb999ef682eaa2ce5d2c4c1d9424c03b86541 | Historical802; superseded |
| backend/content/tenses/past-perfect.md | 80d10da32cce3fbf0078724bb8c9d76d985f72dbba80d57e4781efda99911887 | Historical802; superseded |
| docs/grammar-quiz-banks/G-error-clinic-dangling-modifiers.md | 445211eb9960fcc7f85cae81e637dcb3f2d8b833aaccd4f7a2b30ffe62e4bedd | Historical802; superseded |
| docs/grammar-quiz-banks/G-foundations-phrase-vs-clause.md | 316246eb35a935a66073731dcc7adb1949635a6664219642e5db859a70dbb35a | Historical802; superseded |
| docs/grammar-quiz-banks/G-grammar-for-reading-long-sentence-untangling.md | b028a3de1b3188712f1d51db5063fde255588aa98641ad8fdd45a543bead7946 | Historical802; superseded |
| docs/grammar-quiz-banks/G-grammar-for-reading-participle-clauses.md | 9368439539d16264b5abb3b8b39785607fb706dbb996ba64b7908e6a568c71ab | Historical802; superseded |
| docs/grammar-quiz-banks/G-grammar-for-reading-reduced-relative-clauses.md | 9506dace37457438800af8a71d3dd0570a79c58f2132655343f70c43882d7772 | Historical802; superseded |
| docs/grammar-quiz-banks/G-parts-of-speech-verbs.md | 649d784d010aebf11a3863d3cfabb41e602dd8545ee27a9f62848b907759d566 | Historical802; superseded |
| docs/grammar-quiz-banks/G-sentence-structures-passive-voice.md | e3cb46a933e6f39488d6f6536474318da3182cd34c51406baf76e1318065edb2 | Historical802; superseded |
| docs/grammar-quiz-banks/G-tenses-past-continuous.md | d76a156071b016e6f17f55bdeb36222313c6f4b2fd234731cf55664c4c24351f | Historical802; superseded |
| docs/grammar-quiz-banks/G-tenses-past-perfect.md | 297a5ae369e3bc727601e4c39157b32f43b759d2e33872201cc1df8e58222183 | Historical802; superseded |
| docs/grammar-quiz-banks/G-tenses-present-continuous.md | ae97014a3f682fbe5773e18525601c55dc29a3230d7e48a5de545a21509c833b | Historical802; superseded |
| docs/grammar-quiz-banks/G-tenses-present-perfect-continuous.md | 6413b54df61f3d6f0e3f257cd69d69691fc098197396cadd72bfb9cf677f28c8 | Historical802; superseded |
| docs/grammar-quiz-banks/G-tenses-present-simple.md | abce05d55936ab86a63fd11287f4a60bbd9ecd17acbb7ffbe27d61a4eca9f801 | Historical802; superseded |

## Final academic intent and named exceptions

Root independently reviewed75 named question-field proposals (37 Content cases and38 related controls) and five article occurrences, within the same12 banks/264 questions and six articles. They are not75 false keys. The exact before/proposed fields are self-contained in source-scope.json; all other qid/type/order/skill/subtype/pool/mastery/map fields remain unchanged. The final proposal manifest is6692d5e6c188becf1148758cf5483e93930cf807843ac854a90fa2057c7e16df; the decisions SHA is419e47ab0f188e7876870785e180b0ce14bcb6a33fe4d7c687afcdf551f2a0e1.

| Bank | Qid | Exact exceptional change in NEW corrected bank |
| --- | --- | --- |
| G-tenses-present-simple | ps_adv_a1 | FALSE→TRUE with explicitly stressed AM context; no universal-negative substitute |
| G-tenses-present-simple | ps_vspc_a2 | FALSE→TRUE for a current temporary university course and immediate test study |
| G-tenses-past-continuous | pc_interrupt_a1 | FALSE→TRUE for two overlapping ongoing processes |
| G-tenses-past-continuous | pc_while_i1 | Option0 When→Meanwhile; key1 retained; meaningful overlap/conjunction objective |
| G-tenses-present-continuous | pc_temp_a2 | Option3 becomes They work here every weekday. / They worked here last year.; key1 retained |
| G-grammar-for-reading-reduced-relative-clauses | rrc_v3_i2 | Add which were published in journals; retain both previous accepts and fixed-phrase Past Simple be-passive/V3 objective |

These are the only new key/option/accepted-set exceptions to the prior candidate. The two prior optional accepted-set removals remain as specified. Source explanations describe grammar/task meaning, not authoring history or implementation details. Phrase-vs-clause article corrections address three wh-marker overgeneralizations and the two local subject/complement labels while preserving metadata, links and anchors.

Final18 authored bytes and the complete264 diff passed Root and independent Content review as bound below; actual canonical publication remains gated. Canonical production snapshots show all264 why_wrong values NULL, but actual preflight rechecks those extras and source/history fingerprints under guards; snapshot results do not authorize a cutover or replace the bounded cohort proof. Staging predecessors are missing; any separately reviewed staging-fixture preparation is testing provenance, never guessed production history or automatic predecessor creation inside cutover.

## Final authored source binding — academically approved

Final authoring manifest `004ce84fab271f98d2ae9c5d89c2e958b1038890cc2a931129cd529d50125b3e`
binds all 18 source files. Root independently decoded actual final Markdown for all
264 questions and matched exactly 75 approved complete question proposals and 189
unchanged questions: 133 question fields. Root reconstructed the article from the
prior reviewed bytes using exactly five approved substitutions and read their final
surrounding context. All 55 artifact files and both copies of each of the 18 sources
pass byte/hash checks. Source-scope.json retains the prior candidate hashes as
historical inputs and lists these actual final source hashes separately.

Independent Content review passed5,894 controls and36 isolated actual importer calls over all18 bytes,264 source rows and792 wire rows. Content report SHA-256 `cfbe82523e9041328e170ad2dfe93c63a5ff71a4c90ae752ca34b58e21d0ef84`; controls SHA-256 `e93293de2d7312d27ec7b88f97528f4d92b62cd1f615ae6c3c94bd023433aeb0`; Root final source approval SHA-256 `07d4428a19a953c1d26435768d9fd80443a266d2e885932f83648764aab09196`. Current importer drops the
new map and current engine still accepts the five morphology errors and the optional
past/present control. Source authoring does not close grading, admission, persistence,
canonical cutover or release gates. No intermediate old six-source publication is
permitted.

| Final authored source | Approved SHA-256 |
| --- | --- |
| backend/content/error-clinic/dangling-modifiers.md | `cc455e30d1f802d00e2a82eb819b3b7f35c88dd6a3825c36aa8bb222be71b366` |
| backend/content/foundations/phrase-vs-clause.md | `64869b808db7a8cae88724d51ab953ef0415ffdf19c272403a437816d8cd2b30` |
| backend/content/grammar-for-reading/long-sentence-untangling.md | `6402f4573051114a9cb60d2823ea32fc98eee3e5acda813eb5f394ef0e9c1510` |
| backend/content/grammar-for-reading/participle-clauses.md | `489c669cc69866f728b42440a4802883017a16c6adc3b90cb0b7358a68d85496` |
| backend/content/grammar-for-reading/reduced-relative-clauses.md | `190fd721393ed092ac8587ee630cb999ef682eaa2ce5d2c4c1d9424c03b86541` |
| backend/content/tenses/past-perfect.md | `80d10da32cce3fbf0078724bb8c9d76d985f72dbba80d57e4781efda99911887` |
| docs/grammar-quiz-banks/G-error-clinic-dangling-modifiers.md | `8606094f523bdd1a95666ebeb6139a3e71d1efd6f712aecba06e5bfebd20dec4` |
| docs/grammar-quiz-banks/G-foundations-phrase-vs-clause.md | `66dfacf3a82258a91252cb33c3624967183c9313291b958b02ef64648a619dd9` |
| docs/grammar-quiz-banks/G-grammar-for-reading-long-sentence-untangling.md | `f272f1d183cb766746c269510f0d226bf88036606dbdb2c3dfa246b716c6fcf0` |
| docs/grammar-quiz-banks/G-grammar-for-reading-participle-clauses.md | `f63edb03e73d2e657a82d16b4adfff004b01b9bf2e7bb9f2a93b3a6e3eb4a730` |
| docs/grammar-quiz-banks/G-grammar-for-reading-reduced-relative-clauses.md | `f9c0cab2ce4292531dfeda4d8353f6044d5d77d55d38068e8567f83730d3884d` |
| docs/grammar-quiz-banks/G-parts-of-speech-verbs.md | `36e8b94fa47dfb8fc2316a1e1cab6003d79639e1e593f7c42d2d660b258afc9d` |
| docs/grammar-quiz-banks/G-sentence-structures-passive-voice.md | `2299da1f37da6ab306821c0eb34dc5735837156dfac4a7a8a480e3861fe5d866` |
| docs/grammar-quiz-banks/G-tenses-past-continuous.md | `1d75f48d70c9e476423383ec269f2a55fcc9eb8ca01307c45c4050c861bb11a6` |
| docs/grammar-quiz-banks/G-tenses-past-perfect.md | `297a5ae369e3bc727601e4c39157b32f43b759d2e33872201cc1df8e58222183` |
| docs/grammar-quiz-banks/G-tenses-present-continuous.md | `711e42becddee32bfee93f6d0b691a318403b1b4ffef01302d28d2dbed1c037a` |
| docs/grammar-quiz-banks/G-tenses-present-perfect-continuous.md | `67ffbc97e73fdb1d43a88644a77d0ebfbb93b845b8f2dd6c8575dec93d84ef3a` |
| docs/grammar-quiz-banks/G-tenses-present-simple.md | `97d6af8d735ff80ca24c7e499a7443c53218444d804273e28d6c304eb6634670` |
