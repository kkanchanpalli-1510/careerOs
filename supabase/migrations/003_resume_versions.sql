-- supabase/migrations/003_resume_versions.sql

CREATE TABLE IF NOT EXISTS resume_versions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id  UUID        REFERENCES career_sessions(id) ON DELETE SET NULL,
  name        TEXT        NOT NULL DEFAULT 'Resume',
  snapshot    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resume_versions_user ON resume_versions(user_id, created_at DESC);

ALTER TABLE resume_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own resume versions"
  ON resume_versions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
