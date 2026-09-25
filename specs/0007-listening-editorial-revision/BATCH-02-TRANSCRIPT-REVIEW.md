# Batch 02 — transcript/text pre-review

Status: **text/transcript pre-review only**. Batch 02 remains
`draft_pending_owner_review`; this note does not approve it or authorize a
package build, import, or publication.

Source: `ielts-listening-practice-v1.0.0`, manifest SHA-256
`209cb7e3eedd4f4935e264a57b4904aaa5f7c6ed841b238b4cbe40e5d0f6a7b5`.
The draft has 25 items in five complete forms. Source prompts and option
labels passed the separate local runtime validator against the locked v1.0
package; that runtime branch is not yet merged. This pass also read each draft
translation against the English prompt/options and the corresponding
controlled transcript.

| Form | Items | Text/transcript pre-review |
| --- | ---: | --- |
| Marine biology lecture | 10 | Checked topic, quantity, cause, vent ecology, migration endpoints, oxygen share and conclusion. Clarified that the reported decline concerns the number of coral colonies (not polyps or a population); the Vietnamese uses the biological term `tập đoàn san hô`. Two gap prompts still require the spoken English term/quantity. |
| Photosynthesis process | 2 | `carbon ____` and leaf-pigment gaps preserve the spoken English completions. |
| Travel-plan correction | 1 | Vietnamese question and month labels preserve the accepted final month, rather than the initial plan. |
| Weak forms `from` / `of` | 2 | Vietnamese instructions identify the heard word; the English option words remain unchanged because their sounds are the task. |
| Urban planning lecture | 10 | Checked Howard's proposal, problem, population, green belt, Letchworth, smart-city technologies, car ownership, green-space measure and conclusion. Item 02 now asks what Howard reacted against, rather than what he intended to solve. Three gap prompts still require the spoken English name/number. |

Seven gap items have Vietnamese display prompts but must retain the original
English audio-answer expectation. A note in the separate local runtime branch
explains that changing question language does not translate the answer or its
review rule; it is not yet deployed.

Not covered here: perceptual playback of the 25 audio clips, pronunciation or
prosody, owner approval, theme/mobile UI, and staging learner journeys. Do not
change batch status until those editorial/release decisions are recorded.
