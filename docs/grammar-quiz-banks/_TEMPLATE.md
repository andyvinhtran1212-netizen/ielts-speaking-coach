---
kind: quiz
code: "G-<category>-<article-slug>"        # vd G-tenses-present-perfect — PHẢI khớp slug bài
title: "Quick Check — <Tên bài>"
skill_area: "grammar"
topic: "<Category Title>"                    # vd Tenses
mode: "adaptive_mastery"
grading: "instant"
correct_to_master: 2
require_distinct_skill: true
require_production_to_master: true
cooldown: 2
shuffle_options: true
words_count: 3                              # = số item_key
source: "authored-<yyyy-mm>"
---

# ===== item_key 1 · <mô tả điểm ngữ pháp con> =====

# --- form (mcq / choice) ---
---
id: "<itemkey>_b1"
type: "mcq"
input: "choice"
headword: "<item-key-slug>"
skill: "form"
subtype: "basic"
prompt: "<đề, dùng ____ cho chỗ trống>"
options: ["<A>", "<B>", "<C>", "<D>"]
answer: 0
grammar_article_slug: "<article-slug>"
explain: "<quy tắc bằng tiếng Việt>"
---

# --- usage (gap_mcq / choice) ---
---
id: "<itemkey>_i1"
type: "gap_mcq"
input: "choice"
headword: "<item-key-slug>"
skill: "usage"
subtype: "intermediate"
prompt: "<đề ngữ cảnh IELTS ____ >"
options: ["<A>", "<B>", "<C>"]
answer: 1
grammar_article_slug: "<article-slug>"
explain: "<vì sao chọn đáp án này>"
---

# --- production (gap_text / text) — BẮT BUỘC có ≥1 câu loại này mỗi item_key ---
---
id: "<itemkey>_i2"
type: "gap_text"
input: "text"
headword: "<item-key-slug>"
skill: "production"
subtype: "intermediate"
prompt: "<đề, học viên tự gõ: ... ____ (verb) ...>"
accept: ["<đáp án 1>", "<biến thể hợp lệ>"]
case_sensitive: false
grammar_article_slug: "<article-slug>"
explain: "<quy tắc>"
---

# --- error_id (boolean) — nên có ≥2 câu cho mã lỗi mục tiêu ---
---
id: "<itemkey>_a1"
type: "boolean"
input: "boolean"
headword: "<item-key-slug>"
skill: "error_id"
subtype: "advanced"
prompt: "Đúng hay Sai: '<câu cần phán đoán>'"
answer: false
grammar_article_slug: "<article-slug>"
explain: "SAI — <lỗi> → sửa: '<câu đúng>'."
---

# ===== item_key 2 · ... (lặp cấu trúc trên) =====
# ===== item_key 3 · ... =====
