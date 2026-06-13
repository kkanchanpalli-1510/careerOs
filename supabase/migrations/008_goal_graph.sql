-- Migration 008: goal graph + article-gap tracking
-- Run manually in Supabase SQL editor.

-- Career goal fields on sessions
ALTER TABLE career_sessions
  ADD COLUMN IF NOT EXISTS goal_title                TEXT,
  ADD COLUMN IF NOT EXISTS goal_graph_generated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS goal_graph_version        INTEGER DEFAULT 0;

-- Which ghost node an article was written to address
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS target_ghost_node_id TEXT;

-- Enriched node tracking (prevents re-nudging nodes user has already answered)
ALTER TABLE career_sessions
  ADD COLUMN IF NOT EXISTS enriched_node_ids JSONB DEFAULT '[]'::jsonb;
