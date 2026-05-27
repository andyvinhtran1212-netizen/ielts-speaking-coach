# Writing Content Format — v1

**Status:** active contract (Sprint 19.1C)
**Audience:** the external AI agent that generates Writing-Coach content, and the humans reviewing its output.
**Platform target:** the writing tips library (`writing_tips` table) surfaced in the student **"Mẹo viết"** tab and authored via **Admin → Writing → Mẹo viết → Import từ file**.

> Give this whole document to your content-generation agent. Each file it produces must follow the schema below exactly. Upload the `.md` file at the Import section; the platform parses it, shows a preview + any validation errors, and commits on confirm.

---

## 1. Purpose

This is the **contract** between three parties:

1. **Andy / content author** — describes what content is wanted.
2. **External AI agent** — produces one `.md` file per content item, conforming to this schema.
3. **Web platform** — parses the file, validates it, and publishes it to students.

A file that follows this contract imports cleanly. A file that doesn't surfaces specific validation errors in the preview (it is **never** silently accepted).

---

## 2. File naming convention

One file = one content item. Suggested name:

```
<content_type>-<slug>.md      e.g.  sample-tech-and-society.md
```

The filename itself is **not** parsed — identity comes from the `slug` field (see §7). Naming is purely for the author's convenience.

---

## 3. File structure

Every file is **YAML frontmatter** (between two `---` fences) followed by a **Markdown body**:

```markdown
---
content_type: tip
title: Cách paraphrase đề bài
task_type: task_2
published: true
---
Phần thân bài viết bằng **Markdown** ở đây…
```

- The opening `---` must be the **first line** of the file.
- Everything between the two `---` fences is parsed as YAML.
- Everything after the closing `---` is the Markdown body (`body_markdown`).

---

## 4. Common frontmatter fields (all content types)

| Field | Required | Type | Notes |
|---|---|---|---|
| `content_type` | ✅ | string | One of: `tip`, `knowledge`, `sample`, `outline` |
| `title` | ✅ | string | 2–200 chars |
| `task_type` | ✅ | string | One of: `task_1`, `task_2`, `both` |
| `slug` | optional | string | Auto-generated from `title` if omitted. Lowercase a–z, 0–9, hyphens. See §7. |
| `category` | optional | string | Free-form, ≤ 80 chars (e.g. `grammar`, `vocabulary`, `structure`) |
| `published` | optional | bool | Default `false`. `true` = students see it immediately. |
| `display_order` | optional | int | Default `0`. Lower sorts first. |

The Markdown **body is required** for every type (non-empty).

---

## 5. Type-specific frontmatter fields

These keys live **flat** in the frontmatter (alongside the common fields). The platform routes them into a `type_data` store automatically.

### `tip`
No extra fields. The body is the tip.

### `knowledge`
No extra fields. Semantically a knowledge article; rendered with the same UI as `tip`, distinguished by its badge.

### `sample`
| Field | Required | Type | Notes |
|---|---|---|---|
| `target_band` | ✅ | number | 0–9, one decimal (e.g. `7.5`) |
| `word_count` | ✅ | integer | > 0 (e.g. `268`) |
| `prompt_id` | optional | string (UUID) | Links to a `writing_prompts` row if the sample answers a library prompt. |

The body is the sample essay text.

### `outline`
| Field | Required | Type | Notes |
|---|---|---|---|
| `structure` | ✅ | list | Each item: `{ heading: string, points: [string, …] }` |

The body is optional commentary shown below the structure.

---

## 6. Body Markdown rules

**Supported:** headings (`#`–`####`), **bold**, *italic*, ordered/unordered lists, `inline code`, fenced code blocks, > blockquotes, [links](https://…), tables, horizontal rules, images via **external URL only** (`![alt](https://…)`).

**Stripped / not allowed:**
- **Raw HTML** — the platform sanitizes every render with DOMPurify, so `<script>`, `<iframe>`, inline event handlers, etc. are removed. Do not rely on raw HTML.
- **Uploaded images** — there is no image upload in v1. Reference images by external URL only.

---

## 7. Slug & upsert semantics

- **Slug is the identity.** Two files with the same `slug` refer to the **same** content item.
- **Import is idempotent by slug:**
  - New slug → **creates** a new content item.
  - Existing slug → **updates** the existing item in place (its creation date is preserved; everything else is overwritten from the file).
- If `slug` is omitted, it is generated from `title` (Vietnamese diacritics folded to ASCII; e.g. `Cách viết mở bài` → `cach-viet-mo-bai`).
- Slug format: lowercase `a–z`, `0–9`, and hyphens only.

> This means re-uploading a corrected file with the same slug **fixes** the published item — no duplicate, no manual delete.

---

## 8. Full examples (copy-pasteable)

### Example — `tip`

```markdown
---
content_type: tip
title: Paraphrase đề bài trong mở bài
task_type: task_2
category: structure
published: true
display_order: 1
---
## Vì sao cần paraphrase

Mở bài nên **viết lại đề bài bằng từ của em**, không chép nguyên văn. Giám khảo
muốn thấy khả năng dùng từ đồng nghĩa và đổi cấu trúc câu.

- Đổi từ loại: *increase* (động từ) → *an increase* (danh từ)
- Dùng từ đồng nghĩa: *children* → *youngsters*
- Đổi thể câu: chủ động ↔ bị động

> Tránh paraphrase máy móc làm sai nghĩa gốc.
```

### Example — `knowledge`

```markdown
---
content_type: knowledge
title: Các loại câu hỏi Task 2
task_type: task_2
category: overview
published: true
---
IELTS Writing Task 2 có 5 dạng đề chính:

1. **Opinion** (agree/disagree)
2. **Discussion** (discuss both views)
3. **Advantages & Disadvantages**
4. **Problem & Solution**
5. **Two-part question**

Mỗi dạng có cấu trúc thân bài riêng — nhận diện đúng dạng là bước đầu tiên.
```

### Example — `sample`

```markdown
---
content_type: sample
title: Band 7.5 — Technology isolates people
task_type: task_2
category: technology
published: true
target_band: 7.5
word_count: 268
prompt_id: 00000000-0000-0000-0000-000000000000
---
Some people argue that technology has made people more isolated, while others
believe it has brought them closer together. In my view, …

*(toàn bộ bài mẫu ~268 từ)*
```

### Example — `outline`

```markdown
---
content_type: outline
title: Dàn bài Discussion — cả hai quan điểm
task_type: task_2
category: structure
published: true
structure:
  - heading: Mở bài
    points:
      - Paraphrase đề bài
      - Nêu cả hai quan điểm sẽ thảo luận
  - heading: Thân bài 1
    points:
      - Quan điểm A + lý do
      - Ví dụ minh hoạ
  - heading: Thân bài 2
    points:
      - Quan điểm B + lý do
      - Ý kiến cá nhân
  - heading: Kết bài
    points:
      - Tóm tắt + khẳng định quan điểm
---
Dàn bài này áp dụng cho mọi đề "Discuss both views and give your opinion".
```

---

## 9. Validation rules (summary)

A file is rejected (with a specific error) when:

- `content_type` missing or not in `{tip, knowledge, sample, outline}`.
- `title` missing or shorter than 2 chars.
- `task_type` missing or not in `{task_1, task_2, both}`.
- `body_markdown` empty.
- `slug` present but contains characters outside `a–z 0–9 -`.
- **`sample`** missing `target_band` (0–9) or `word_count` (> 0); `prompt_id` present but not a valid UUID.
- **`outline`** missing `structure`, or a structure item missing `heading` / `points`.

Errors are returned as a list of `{ field, message }` and shown in the import preview. Fix the file and re-upload.

---

## 10. Versioning

This is **v1** (`content_format_v1.md`). The frontmatter `content_type` enum and the type-specific fields above are stable for v1. A future **breaking** change (new required field, renamed key, removed type) ships as `content_format_v2.md` with a migration note; additive optional fields do **not** bump the version.
