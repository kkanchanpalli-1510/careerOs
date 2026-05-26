# Career OS — Data Model

## Graph Schema

The career graph is the atomic unit of the product. Everything else is a query or projection of this structure.

### Node

```typescript
type NodeType = 'role' | 'skill' | 'project' | 'outcome' | 'decision';

interface Node {
  id: string;           // snake_case unique identifier
  type: NodeType;
  label: string;        // 2-4 words, display label
  detail: string;       // one sentence description
  year: string | null;  // "2020" or "2020-2024" or null
  weight: 1 | 2 | 3;   // 3=career-defining, 2=important, 1=supporting
}
```

**Weight semantics:**
- `3` — Career-defining. The decisions and outcomes that make this person who they are professionally. Typically 3-5 nodes in any career graph.
- `2` — Important. Significant capabilities and experiences that shape the graph. Typically 6-10 nodes.
- `1` — Supporting. Real but not distinctive. Fills out the graph.

**Node types:**
- `role` — Jobs held, positions occupied
- `skill` — Capabilities, technical and non-technical
- `project` — Things built, shipped, or led
- `outcome` — Measurable results, impacts, revenue figures
- `decision` — Strategic choices made, architectural bets taken

### Edge

```typescript
type RelationType = 
  | 'USED'        // skill used in role/project
  | 'LED_TO'      // experience led to outcome
  | 'DEMONSTRATED'// role demonstrated skill
  | 'REQUIRED'    // outcome required skill
  | 'INFLUENCED'  // decision influenced direction
  | 'BUILT_ON';   // built on prior experience

interface Edge {
  source: string;       // node id
  target: string;       // node id
  relation: RelationType;
}
```

### Graph

```typescript
interface CareerGraph {
  nodes: Node[];
  edges: Edge[];
}
```

---

## Database Schema (Postgres via Supabase)

### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### career_sessions
```sql
CREATE TABLE career_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_label TEXT DEFAULT 'primary',  -- 'primary', 'partner', or custom

  -- The graph
  graph_data JSONB,           -- { nodes: [], edges: [] }
  node_positions JSONB,       -- { node_id: { x: number, y: number } }

  -- Session inputs
  answers JSONB,              -- [q1_answer, q2_answer, q3_answer, q4_answer]
  enrich_count INTEGER DEFAULT 0,
  step INTEGER DEFAULT 0,

  -- Generated insights (stored, not regenerated each call)
  insights JSONB,             -- { strength: "", branches: [], portrait: {} }
  selected_branch INTEGER,    -- index into branches array

  -- Career summary (hybrid model)
  career_summary TEXT,        -- deterministic skeleton + LLM behavioral pattern
  behavioral_pattern TEXT,    -- LLM-generated once, stored separately
  summary_version INTEGER DEFAULT 0,  -- increments on graph change

  -- UI state (for session restore)
  conv_html TEXT,             -- conversation panel HTML
  scroll_top INTEGER,
  card_states JSONB,          -- { strength: {visible, html}, directions: {}, portrait: {} }

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, session_label)
);

CREATE INDEX idx_career_sessions_user_id ON career_sessions(user_id);
```

### node_conversations
```sql
CREATE TABLE node_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES career_sessions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,

  messages JSONB DEFAULT '[]',    -- full history: [{role, content, timestamp}]
  summary TEXT,                   -- compressed summary of messages beyond last 6
  message_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(session_id, node_id)
);

CREATE INDEX idx_node_conversations_session ON node_conversations(session_id);
CREATE INDEX idx_node_conversations_node ON node_conversations(session_id, node_id);
```

### usage_logs
```sql
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
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
```

---

## Row Level Security (Supabase RLS)

Every table enforces user isolation at the database level — not just the application level.

```sql
-- career_sessions: users can only access their own sessions
ALTER TABLE career_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their sessions" ON career_sessions
  FOR ALL USING (auth.uid() = user_id);

-- node_conversations: users can only access their own conversations
ALTER TABLE node_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their conversations" ON node_conversations
  FOR ALL USING (auth.uid() = user_id);

-- usage_logs: users can read their own, service role writes
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own usage" ON usage_logs
  FOR SELECT USING (auth.uid() = user_id);
```

---

## Key Design Decisions

### Why Postgres JSONB not a graph database

At MVP scale, Postgres JSONB handles the career graph cleanly:
- Graph is stored per-user as a document — no cross-user traversal needed yet
- JSONB is queryable — you can filter nodes by type or weight with SQL operators
- Supabase makes Postgres trivial to run and scale
- Migrate to Neo4j in Phase 2 when cohort intelligence requires cross-user graph traversal

### Why identity and career data are in separate tables

A breach of `career_sessions` exposes career data but not PII (name, email).
A breach of `users` exposes email but not career records.
Logs and analytics reference `user_id` (UUID) — never email or name.

### Why session_label exists

The "You / Partner" dual-session model in the demo becomes two rows in `career_sessions` with the same `user_id` and different `session_label` values. Clean, simple, no shared state between sessions.

### Why node_positions is stored separately from graph_data

Graph topology (nodes + edges) is semantic. Node positions (x, y) are UI state. They change on every drag. Separating them means graph updates don't write position data and vice versa — cleaner change tracking and cheaper writes.

### What is NOT stored

- Raw resume text — discarded after graph extraction completes
- Full Claude prompt text — only token counts are logged
- IP addresses — not captured at application level
- Behavioral analytics — no hover tracking, no session recording
- Other users' data — RLS enforces this at database level
