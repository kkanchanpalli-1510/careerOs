-- supabase/migrations/001_initial_schema.sql

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE career_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  session_label TEXT NOT NULL DEFAULT 'primary',

  -- graph
  graph_data JSONB,
  node_positions JSONB,

  -- session inputs
  answers JSONB,
  enrich_count INTEGER DEFAULT 0,
  step INTEGER DEFAULT 0,

  -- generated insights
  insights JSONB,
  selected_branch INTEGER,

  -- career summary (hybrid model)
  career_summary TEXT,
  behavioral_pattern TEXT,
  summary_version INTEGER DEFAULT 0,

  -- UI state
  conv_html TEXT,
  scroll_top INTEGER,
  card_states JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, session_label)
);

CREATE INDEX idx_career_sessions_user_id ON career_sessions(user_id);

CREATE TABLE node_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  session_id UUID REFERENCES career_sessions(id) ON DELETE CASCADE NOT NULL,
  node_id TEXT NOT NULL,

  messages JSONB DEFAULT '[]',
  summary TEXT,
  message_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(session_id, node_id)
);

CREATE INDEX idx_node_conversations_session ON node_conversations(session_id);
CREATE INDEX idx_node_conversations_node ON node_conversations(session_id, node_id);

CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  session_id UUID REFERENCES career_sessions(id),
  task_type TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_cents INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_logs_user ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_created ON usage_logs(created_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE career_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their sessions" ON career_sessions
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE node_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their conversations" ON node_conversations
  FOR ALL USING (auth.uid() = user_id);

ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own usage" ON usage_logs
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================================
-- updated_at TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON career_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON node_conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
