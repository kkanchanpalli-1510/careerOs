# Career OS — Claude Code Quickstart

## How to Start

```bash
npm install -g @anthropic-ai/claude-code
mkdir career-os-backend
cd career-os-backend
claude
```

Place all files from `career-os-docs/` in the project root before starting.

---

## First Message to Claude Code

Paste this verbatim as your opening message:

---

Read all markdown files in the `career-os-docs/` directory before writing any code. They contain the full product spec, data model, context assembler design, privacy principles, and backend architecture.

We are building the backend for Career OS — a personal career knowledge graph product. 

**Tech stack:**
- Node.js + TypeScript + Express
- Supabase (Postgres + Auth)
- Anthropic API (claude-sonnet-4-6)
- Railway for hosting

**Build in this order:**

**Step 1 — Database**
Create `supabase/migrations/001_initial_schema.sql` with:
- `users` table
- `career_sessions` table (with JSONB fields for graph_data, node_positions, answers, insights, card_states, career_summary, behavioral_pattern)
- `node_conversations` table
- `usage_logs` table
- Row Level Security policies on all tables (users can only access their own data)

**Step 2 — Career Summary (pure function)**
Create `src/assembler/summary.ts` with:
- `buildDeterministicSkeleton(graph, insights, selectedBranch)` — pure function, no I/O
- `buildCareerSummary(session)` — combines skeleton + stored behavioral_pattern

**Step 3 — Context Assembler**
Create `src/assembler/index.ts` with `assembleContext(input)` that handles all 8 task types. Start with `node_chat` — it has the most complex windowing logic (6-message window, conversation summary for older messages).

**Hard rules to enforce everywhere:**
- `user_id` always from verified JWT — never from request body
- Every DB query includes `WHERE user_id = $user_id`
- No PII (email, name) ever appears in a Claude prompt
- Raw resume text is never stored after graph extraction
- The assembler is a pure function — no DB writes, no Claude calls

**Step 4 — API Routes**
Create `src/routes/claude.ts` starting with the `/claude/node-chat` route, wired to the assembler.

Start with Step 1 and show me the SQL before running it.

---

## Key Design Decisions Already Made

**Do not re-debate these — they are decided:**

1. **Postgres JSONB not a graph DB** — sufficient for MVP, migrate to Neo4j in Phase 2
2. **Career summary is hybrid** — deterministic skeleton (always current, free) + LLM behavioral pattern (generated once after final synthesis, stored)
3. **Context assembler is a pure function** — no side effects, reads DB, returns prompt package
4. **Token ceilings per task** — see `03-context-assembler.md` for exact limits
5. **Identity separated from career data** — `users` table never joined into career queries
6. **Supabase RLS** — enforced at DB level, not just application level
7. **Resume text not stored** — discarded after graph extraction

## Reference Files

- `01-product-vision.md` — what we're building and why
- `02-data-model.md` — graph schema + Postgres schema + design decisions
- `03-context-assembler.md` — full spec for all 8 task types + career summary hybrid model
- `04-privacy-principles.md` — 7 principles + code-level enforcement examples
- `05-backend-architecture.md` — full stack, API surface, file structure, build order
- `06-frontend-status.md` — what's built in frontend + what needs to change for backend wiring

## Useful Commands

```bash
# Install dependencies
npm init -y
npm install express typescript @supabase/supabase-js @anthropic-ai/sdk
npm install -D ts-node @types/express @types/node nodemon

# Run locally
npx ts-node src/index.ts

# Supabase CLI
npm install -g supabase
supabase login
supabase init
supabase db push

# Deploy to Railway
npm install -g @railway/cli
railway login
railway init
railway up
```

## What the Frontend Demo Files Look Like

The `career-os-interactive.html` file is the complete frontend. It currently:
- Makes direct Anthropic API calls from the browser (remove this)
- Uses localStorage for persistence (replace with DB calls)
- Has an API key input field in the header (replace with auth UI)

See `06-frontend-status.md` for the exact changes needed to wire it to the backend.
