-- Migration 002: Fix schema mismatches found during E2E testing
-- Run this in the Supabase dashboard → SQL Editor

-- ── 1. Rename session_label → name ───────────────────────────────────────────
--    The backend code and frontend both expect a `name` column.
ALTER TABLE career_sessions RENAME COLUMN session_label TO name;

-- ── 2. Drop the old unique constraint (was unique per label per user) ─────────
--    The app supports multiple sessions per user (A/B slots), so this must go.
ALTER TABLE career_sessions
  DROP CONSTRAINT IF EXISTS career_sessions_user_id_session_label_key;

-- ── 3. Trigger: auto-create public.users row when Supabase auth user signs up ─
--    career_sessions.user_id FK references public.users(id).
--    Without this, every session INSERT fails with a FK violation because
--    new auth users exist only in auth.users, not public.users.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ── 4. Back-fill any existing auth users who are missing from public.users ─────
INSERT INTO public.users (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;
