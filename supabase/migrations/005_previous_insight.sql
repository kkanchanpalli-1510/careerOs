-- supabase/migrations/005_previous_insight.sql
-- Stores the last insight before regeneration so the user can restore it.

ALTER TABLE career_sessions
  ADD COLUMN IF NOT EXISTS previous_insight TEXT;
