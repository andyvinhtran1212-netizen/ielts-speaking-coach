# Contributing to Aver Design System

Hướng dẫn cách thêm/sửa design system mà không tạo drift.

---

## When creating new pages

### Phải làm

1. Reference shared CSS:
   - design-system/tokens.css
   - design-system/components.css

2. Reuse component classes:
   - Buttons: .btn, .btn-primary, .btn-secondary, .btn-ghost
   - Cards: .card, .card-hover, .card-interactive
   - Forms: .form-input, .form-textarea, .form-select
   - Badges: .badge, .badge-success, .badge-warning
   - Full list trong showcase.html

3. Use design tokens:
   - Colors: var(--color-primary-700), var(--color-accent-400)
   - Spacing: var(--space-4), var(--space-8)
   - Typography: var(--text-base), var(--text-lg)
   - Radius: var(--radius-md), var(--radius-lg)

4. Check showcase.html FIRST xem có pattern phù hợp không

### Không được làm

1. NEVER tạo local tokens.css - tất cả pages share same source
2. NEVER override tokens trong page CSS
3. NEVER hardcode colors - luôn dùng tokens
4. NEVER inline styles cho design system attributes
5. NEVER copy components thay vì reference

---

## When updating design system

### Workflow

1. Edit design-system/tokens.css OR components.css
2. Update CHANGELOG.md với version + reasons
3. Test trên showcase.html
4. Grep all pages using token (find affected files)
5. Test all affected pages still render correctly
6. Commit với rõ ràng: feat(ds): description

### Versioning

- Patch (1.0.x): Bug fix, typo, minor visual tweak
- Minor (1.x.0): Add new tokens/components, không break existing
- Major (x.0.0): Breaking changes (rename token, remove component)

### Sync với Claude Design

Khi update trong Claude Design canonical:

1. Make changes in "Averlearning" project
2. Download standalone HTML or extract design-system folder
3. Replace local tokens.css + components.css
4. Update CHANGELOG with version + Claude Design link
5. Test trên showcase.html locally
6. Commit

---

## Anti-patterns to avoid

### Drift creation

Bad: Page có local copy của tokens.css với slight variations
Good: All pages reference shared design-system/tokens.css

Bad: "Tôi sẽ tạm hardcode color này, sau update token"
Good: Update token trong design-system/tokens.css FIRST, then use it

### Component duplication

Bad: Copy button styles từ design system rồi customize per page
Good: Add modifier class (vd: .btn-primary--large) trong design system

### Theme breaking

Bad: Hardcoded color: #1a1a1a (only works light mode)
Good: color: var(--color-text-primary) (works both themes)

---

## Review checklist khi PR

Trước khi merge PR có CSS changes:

- No new tokens.css files outside design-system/
- No hardcoded colors/spacing/fonts (use tokens)
- CHANGELOG updated nếu touch design-system/
- All affected pages tested
- Both light + dark theme tested
- Mobile + desktop tested
- showcase.html still accurate

---

## Questions?

Refer to:
- README.md - Overview + philosophy
- showcase.html - Visual examples
- CHANGELOG.md - Version history