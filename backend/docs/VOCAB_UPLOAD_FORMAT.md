# VOCAB_UPLOAD_FORMAT — vocab_cards upload format (authoritative)

One Markdown file = one OR many words (a "lesson"). Each word is a `---` YAML
frontmatter block + a Markdown body. Multi-word files concatenate blocks (the
importer splits on frontmatter fences). Admin upload: `/pages/admin/vocab/content.html`.

This file reflects what the importer ACTUALLY parses + what the card ACTUALLY
renders (kept in sync with `services/vocab_import.py` + `js/vocabulary.js`). If you
add a field here, wire all three layers (parse → column → render) or it is a GHOST.

---

## Frontmatter fields

### Required
| Field | Type | Renders as |
|---|---|---|
| `headword` | text | card title |
| `category` | text (auto-slugified) | eyebrow + grouping (any topic; no whitelist) |
| `part_of_speech` | text | next to the IPA |
| `pronunciation` | text (IPA, e.g. `/məˈtrɒp.əl.ɪs/`) | IPA line + stress specimen |
| `definition_en` | text | English definition line |
| `definition_vi` | text | **curated** Vietnamese line (falls back to the body gloss when empty) |
| `example` | text | "Dùng khi nói" sentence (headword highlighted) |
| `collocations` | list | chips |

### Recommended
| Field | Type | Renders as |
|---|---|---|
| `syllables` | text, hyphen-separated, UPPERCASE = primary stress (e.g. `me-TROP-o-lis`) | orthographic stress specimen (single words; falls back to the IPA parser when absent) |
| `level` | text (e.g. `B2`, `C1`) | level pill |

### Optional
| Field | Type | Renders as |
|---|---|---|
| `synonyms` | list | "Đồng nghĩa" |
| `antonyms` | list | "Trái nghĩa" |
| `related_words` | list | **"Từ liên quan"** (associated words) |
| `word_family` | list (e.g. `["metropolitan (adj)", "metro (n)"]`) | **"Họ từ"** (morphological family — distinct from related_words) |
| `register` | text (e.g. `neutral-formal`) | footer |
| `common_error` | text | "Hay nhầm" callout (amber) |
| `memory_hook` | text | "Mẹo nhớ" callout (jade) |
| `source` | text (e.g. `L09 · Group A`) | footer "nguồn" |
| `group` | text | **internal metadata only — NOT shown on the card** (admin-editable) |

Empty optional fields are hidden (no empty labels).

### Auto / pipeline (do NOT put in frontmatter)
- `slug` — auto from `headword` (override with `slug:` only if you must; must be unique).
- `audio_headword` / `audio_example` / `audio_status` — set by the admin "Generate
  voice" job (OpenAI or ElevenLabs). The ▶ buttons prefer these mp3s, else
  speechSynthesis. `audio_status` shows in the admin console, not on the public card.

### Removed / not supported
- `stress` (legacy integer) — **removed**; use `syllables` instead.

---

## Body

The Markdown body after the frontmatter:
- **First paragraph** → extracted as `gloss_vi` (the VN gloss fallback when
  `definition_vi` is empty). Keep it a clean one-line VN gloss.
- `## Ví dụ …`, `## Ghi nhớ …` etc. → rendered below the card **only** when the
  word has no structured `example`/`memory_hook` (so curated words don't duplicate).

---

## Example

```markdown
---
headword: "Metropolis"
category: "People & Society"
part_of_speech: "noun"
pronunciation: "/məˈtrɒp.əl.ɪs/"
syllables: "me-TROP-o-lis"
level: "C1"
definition_en: "a very large and important city, often a political or cultural centre"
definition_vi: "đô thị lớn, trung tâm chính trị hoặc văn hoá"
example: "Whenever I return to the sprawling metropolis of Saigon, its scale amazes me."
collocations: ["a sprawling metropolis", "a bustling metropolis"]
synonyms: ["megacity", "conurbation"]
antonyms: ["village", "hamlet"]
related_words: ["urbanisation", "downtown"]
word_family: ["metropolitan (adj)", "metro (n)"]
register: "neutral-formal"
common_error: "Số nhiều là 'metropolises', không phải 'metropoli'."
memory_hook: "Hy Lạp mētēr (mẹ) + polis (thành) → 'thành phố mẹ'."
source: "L09 · Group A"
group: "L09-A"
---

Đô thị lớn, trung tâm chính trị hoặc văn hoá.
```
