-- migration: 003_articles.sql

CREATE TABLE articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES career_sessions(id) ON DELETE CASCADE,

  -- Content
  title TEXT,
  theme TEXT,                    -- the idea/theme that prompted the article
  generated_draft TEXT,          -- what Career OS wrote (never changes)
  current_content TEXT,          -- what the user has now
  published_content TEXT,        -- final published version

  -- Status
  status TEXT DEFAULT 'draft',   -- 'draft' | 'published'
  published_url TEXT,
  published_at TIMESTAMPTZ,
  platform TEXT,                 -- 'linkedin' | 'substack' | 'other'

  -- Voice signal
  word_count INTEGER,
  edit_similarity FLOAT,         -- 1.0 = no edits, 0.0 = complete rewrite
  edit_count INTEGER DEFAULT 0,  -- how many save cycles

  -- Versions
  versions JSONB DEFAULT '[]',
  -- [{ version: 1, content: '...', saved_at: timestamp }]

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_articles_user ON articles(user_id);
CREATE INDEX idx_articles_session ON articles(session_id);
CREATE INDEX idx_articles_status ON articles(status);

-- Content ideas cache on sessions
ALTER TABLE career_sessions
ADD COLUMN IF NOT EXISTS content_ideas JSONB DEFAULT '[]';
ALTER TABLE career_sessions
ADD COLUMN IF NOT EXISTS content_ideas_generated_at TIMESTAMPTZ;
