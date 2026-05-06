-- Migration: 035_writing_prompts_library.sql
-- Mô tả: Phase 2.3a-1 — Writing prompts library.
--
-- Admin-managed reusable IELTS prompts. Separate from the
-- denormalized `writing_essays.prompt_text` field (which stays
-- as-is for legacy compat + audit trail of what the student
-- actually saw at submit time).
--
-- Phase 2.3a-2 will wire library rows → an assignments table,
-- giving Andy a way to push specific prompts to specific students.
-- Phase 2.3b will let students self-pick from the library directly.
--
-- The shared `update_updated_at_column()` trigger function from
-- migration 033 is reused — no duplicate function declared here.

CREATE TABLE IF NOT EXISTS writing_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Core fields
    task_type   TEXT NOT NULL CHECK (task_type IN ('task1_academic', 'task1_general', 'task2')),
    prompt_text TEXT NOT NULL,
    title       TEXT NOT NULL,                 -- Short label for admin to find easily

    -- Categorization
    difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
    tags       TEXT[] NOT NULL DEFAULT '{}',   -- e.g., {'environment', 'technology', 'opinion'}

    -- Lifecycle
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,  -- soft-delete flag
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Active-rows-by-task-type is the dominant filter from the admin UI.
CREATE INDEX IF NOT EXISTS idx_writing_prompts_task_type_active
    ON writing_prompts(task_type)
    WHERE is_active = TRUE;

-- Cheap fallback for "show inactive" admin views.
CREATE INDEX IF NOT EXISTS idx_writing_prompts_is_active
    ON writing_prompts(is_active);

-- RLS: admin-only, matching the pattern in writing_essays /
-- writing_feedback (migration 033).
ALTER TABLE writing_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS writing_prompts_admin_all ON writing_prompts;
CREATE POLICY writing_prompts_admin_all ON writing_prompts
    FOR ALL TO authenticated
    USING      (public.is_current_user_admin())
    WITH CHECK (public.is_current_user_admin());

-- Auto-update updated_at on every UPDATE — reuses the function
-- declared in migration 033.
DROP TRIGGER IF EXISTS update_writing_prompts_updated_at ON writing_prompts;
CREATE TRIGGER update_writing_prompts_updated_at
    BEFORE UPDATE ON writing_prompts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ─────────────────────────────────────────────────────────────────────
-- Seed data: 22 common IELTS Task 2 prompts across 10 themes
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO writing_prompts (task_type, prompt_text, title, difficulty, tags) VALUES

-- ── Education ───────────────────────────────────────────────────
('task2',
 'Some people believe that the country would benefit a lot from a large number of young people who enter into university; however, others think that the large number of people receiving the education of university would lead to graduate unemployment. Discuss both views and give your opinion.',
 'University education and unemployment',
 'intermediate',
 ARRAY['education', 'opinion']),

('task2',
 'In some countries young people are encouraged to work or travel for a year between finishing high school and starting university studies. Discuss the advantages and disadvantages for young people who decide to do this.',
 'Gap year before university',
 'intermediate',
 ARRAY['education', 'advantages_disadvantages']),

('task2',
 'Some people think that schools should select students according to their academic abilities, while others believe that it is better to have students with different abilities studying together. Discuss both views and give your own opinion.',
 'Academic streaming in schools',
 'intermediate',
 ARRAY['education', 'opinion']),

-- ── Technology ──────────────────────────────────────────────────
('task2',
 'Some people think that computers will eventually replace teachers in the classroom, while others believe technology will only ever be a complement to traditional teaching. Discuss both views and give your own opinion.',
 'Technology replacing teachers',
 'intermediate',
 ARRAY['technology', 'education', 'opinion']),

('task2',
 'Today many children spend a lot of time playing computer games and little time on sports. Why is it? Is it a positive or negative development?',
 'Computer games and sports for children',
 'beginner',
 ARRAY['technology', 'children', 'positive_negative']),

('task2',
 'Some people argue that the internet has brought people closer together, while others believe it has made human relationships more superficial. Discuss both views and give your own opinion.',
 'Internet and human relationships',
 'advanced',
 ARRAY['technology', 'social', 'opinion']),

-- ── Environment ─────────────────────────────────────────────────
('task2',
 'Many believe that climate change is the most pressing issue of our time, while others argue economic development should take priority. Discuss both views and give your opinion.',
 'Climate change vs economic development',
 'advanced',
 ARRAY['environment', 'economy', 'opinion']),

('task2',
 'Some people think that recycling is a waste of time, while others see it as essential for environmental protection. Discuss both views and give your own opinion.',
 'Recycling effectiveness',
 'beginner',
 ARRAY['environment', 'opinion']),

('task2',
 'Governments should ban single-use plastics. To what extent do you agree or disagree?',
 'Banning single-use plastics',
 'intermediate',
 ARRAY['environment', 'agree_disagree']),

-- ── Society & culture ───────────────────────────────────────────
('task2',
 'The restoration of old buildings in major cities in the world costs numerous governments expenditure. This money should be used in new housing and road development. To what extent do you agree or disagree?',
 'Old buildings vs new housing',
 'intermediate',
 ARRAY['society', 'agree_disagree']),

('task2',
 'Some people believe that traditional cultures are being lost due to globalization, while others see globalization as a way to share and enrich cultures. Discuss both views and give your own opinion.',
 'Globalization and traditional culture',
 'advanced',
 ARRAY['society', 'culture', 'opinion']),

('task2',
 'In many countries, people are spending less time with their families. Why is this happening? What are the effects on family relationships?',
 'Family time decline',
 'intermediate',
 ARRAY['society', 'family', 'cause_effect']),

-- ── Health ──────────────────────────────────────────────────────
('task2',
 'Some people argue that fast food should be heavily taxed to discourage consumption, while others see this as government overreach. Discuss both views and give your own opinion.',
 'Fast food taxation',
 'intermediate',
 ARRAY['health', 'government', 'opinion']),

('task2',
 'Many people believe that mental health should be given the same priority as physical health. To what extent do you agree or disagree?',
 'Mental and physical health priority',
 'beginner',
 ARRAY['health', 'agree_disagree']),

-- ── Work & economy ──────────────────────────────────────────────
('task2',
 'Some people believe that working from home will become the norm in the future, while others think traditional office work will remain dominant. Discuss both views and give your opinion.',
 'Future of remote work',
 'intermediate',
 ARRAY['work', 'opinion']),

('task2',
 'Some people think governments should provide unemployed people with money, while others believe this discourages people from finding work. Discuss both views and give your own opinion.',
 'Unemployment benefits',
 'advanced',
 ARRAY['economy', 'government', 'opinion']),

-- ── Travel & transport ──────────────────────────────────────────
('task2',
 'Many cities are expanding rapidly, leading to increased traffic congestion. What are the causes of this problem? What solutions can you suggest?',
 'Urban traffic congestion',
 'intermediate',
 ARRAY['transport', 'urban', 'problem_solution']),

('task2',
 'Some people believe air travel should be discouraged due to its environmental impact, while others see it as essential for global connectivity. Discuss both views and give your opinion.',
 'Air travel and environment',
 'advanced',
 ARRAY['environment', 'transport', 'opinion']),

-- ── Marketing & consumer ────────────────────────────────────────
('task2',
 'People will buy a product if it has quality or fulfil their needs. There is no need for advertisement. To what extent do you agree or disagree?',
 'Product quality vs advertising',
 'intermediate',
 ARRAY['business', 'agree_disagree']),

('task2',
 'Some people argue that celebrities have a negative influence on young people, while others believe they can be positive role models. Discuss both views and give your opinion.',
 'Celebrities as role models',
 'beginner',
 ARRAY['society', 'media', 'opinion']),

-- ── Government & policy ─────────────────────────────────────────
('task2',
 'Some people think that governments should focus on reducing crime, while others believe they should focus on tackling the causes of crime. Discuss both views and give your own opinion.',
 'Crime reduction approach',
 'advanced',
 ARRAY['government', 'crime', 'opinion']),

-- ── Science & space ─────────────────────────────────────────────
('task2',
 'Some people think that space exploration is a waste of money and that the funds should be used to solve problems on Earth. Others believe it is essential for the future of humanity. Discuss both views and give your opinion.',
 'Space exploration funding',
 'intermediate',
 ARRAY['science', 'opinion']);
