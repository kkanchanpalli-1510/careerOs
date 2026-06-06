-- Voice profiles — user-level, persists across sessions
-- Voice is the person, not the session.

CREATE TABLE voice_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,

  -- Character signals (preserve these in outputs)
  character JSONB DEFAULT '{}',
  -- { sentence_length, leads_with, pronoun_usage, signature_constructions[], collaboration_style }

  -- Habit signals (elevate these toward best-day voice)
  habits JSONB DEFAULT '{}',
  -- { ownership_pattern, adjective_density, hedging_tendency, observed_habits[] }

  -- Gap between resume voice and natural voice
  gap JSONB DEFAULT '{}',
  -- { detected, resume_register, natural_register, gap_note, gap_surfaced, weighting }

  -- Synthesized ghostwriter instructions (rebuilt as confidence grows)
  voice_note TEXT,
  best_day_note TEXT,
  voice_note_version INTEGER DEFAULT 0,

  -- Per-task adjustments from explicit feedback
  task_adjustments JSONB DEFAULT '{}',
  -- { 'linkedin_summary': 'less formal', 'short_bio': '...' }

  -- Signal accumulation counters
  sample_count INTEGER DEFAULT 0,
  total_words_observed INTEGER DEFAULT 0,
  confidence FLOAT DEFAULT 0.0,

  -- Vocabulary drift tracking
  vocabulary_preferred JSONB DEFAULT '[]',
  vocabulary_rejected JSONB DEFAULT '[]',

  -- Feedback history for pattern detection
  feedback_log JSONB DEFAULT '[]',

  -- Copy-protection: tracks which outputs have been copied
  copied_outputs JSONB DEFAULT '{}',
  -- { 'session_id:linkedin_summary': { copied_at, version } }

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_voice_profiles_user ON voice_profiles(user_id);

-- RLS: users can only access their own voice profile
ALTER TABLE voice_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_profiles_owner" ON voice_profiles
  FOR ALL USING (user_id = auth.uid());
