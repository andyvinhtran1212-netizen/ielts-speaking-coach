-- Migration 015: Grammar user interaction tables (article views + saved articles)

CREATE TABLE IF NOT EXISTS article_views (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
  article_slug     TEXT NOT NULL,
  article_title    TEXT,
  article_category TEXT,
  viewed_from      TEXT,           -- 'feedback' | 'dashboard' | 'direct' | 'search'
  session_id       UUID,           -- populated when viewed_from = 'feedback'
  view_count       INTEGER         DEFAULT 1,
  last_viewed_at   TIMESTAMPTZ     DEFAULT NOW(),
  created_at       TIMESTAMPTZ     DEFAULT NOW(),
  UNIQUE(user_id, article_slug)
);

CREATE TABLE IF NOT EXISTS saved_articles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  article_slug  TEXT NOT NULL,
  article_title TEXT,
  saved_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, article_slug)
);

CREATE INDEX IF NOT EXISTS idx_article_views_user
  ON article_views(user_id, last_viewed_at DESC);
