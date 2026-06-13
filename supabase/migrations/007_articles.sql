-- Migration 006: articles table + content_ideas columns on career_sessions
-- Run manually in Supabase SQL editor.

-- Articles table (ghostwritten LinkedIn / Substack drafts)
CREATE TABLE IF NOT EXISTS articles (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id         UUID REFERENCES career_sessions(id) ON DELETE SET NULL,
  title              TEXT,
  theme              TEXT,
  generated_draft    TEXT,
  current_content    TEXT,
  published_content  TEXT,
  published_url      TEXT,
  platform           TEXT,
  status             TEXT NOT NULL DEFAULT 'draft',   -- 'draft' | 'published'
  word_count         INTEGER,
  edit_similarity    FLOAT,
  published_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users access own articles"
  ON articles FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Content ideas stored on the session
ALTER TABLE career_sessions ADD COLUMN IF NOT EXISTS content_ideas             JSONB;
ALTER TABLE career_sessions ADD COLUMN IF NOT EXISTS content_ideas_generated_at TIMESTAMPTZ;
