-- supabase/migrations/004_copy_events.sql
-- Instruments every copy action as a validation signal for output quality.

CREATE TABLE IF NOT EXISTS copy_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  session_id  UUID        REFERENCES career_sessions(id) ON DELETE SET NULL,
  event_name  TEXT        NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copy_events_user    ON copy_events(user_id);
CREATE INDEX IF NOT EXISTS idx_copy_events_name    ON copy_events(event_name);
CREATE INDEX IF NOT EXISTS idx_copy_events_created ON copy_events(created_at);

-- Row level security — users can insert their own events; service role reads all for analytics
ALTER TABLE copy_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own copy events"
  ON copy_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read own copy events"
  ON copy_events FOR SELECT
  USING (auth.uid() = user_id);
