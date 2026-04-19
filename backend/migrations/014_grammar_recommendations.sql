-- Migration 014: Grammar article recommendations linked to graded responses
CREATE TABLE IF NOT EXISTS grammar_recommendations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES users(id),
  session_id           UUID REFERENCES sessions(id),
  response_id          UUID REFERENCES responses(id),
  grammar_issue        TEXT,            -- issue text from Claude (Vietnamese)
  recommended_slug     TEXT,            -- slug of the matched grammar wiki article
  recommended_category TEXT,            -- category of the matched article
  recommended_title    TEXT,            -- article title (denormalised for display)
  similarity_score     FLOAT,           -- keyword overlap score 0–1
  was_clicked          BOOLEAN          DEFAULT FALSE,
  clicked_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ      DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grammar_rec_response ON grammar_recommendations(response_id);
CREATE INDEX IF NOT EXISTS idx_grammar_rec_user     ON grammar_recommendations(user_id);
