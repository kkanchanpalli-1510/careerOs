# Career OS — Backend Architecture and Hosting

## Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | HTML/JS (existing demo) | Already built, zero framework dependency |
| Backend API | Node.js + TypeScript + Express | Lightweight, fast to build, good Supabase SDK |
| Database | Supabase (managed Postgres) | Auth + DB + RLS in one, free tier covers MVP |
| AI inference | Anthropic API (Claude Sonnet 4) | claude-sonnet-4-6 model string |
| Frontend hosting | Vercel | Free tier, deploys from GitHub push, zero config |
| Backend hosting | Railway | Free tier covers early traffic, ~$5/mo at scale |
| File storage | None at MVP | Raw resume text is not stored |

---

## API Surface

All routes are prefixed `/api/v1/`. All routes require `Authorization: Bearer <jwt>` header except `/auth/*`.

### Auth Routes (delegated to Supabase)
```
POST   /auth/signup          — email + password
POST   /auth/signin          — returns JWT
POST   /auth/signout         — invalidates session
POST   /auth/magic-link      — passwordless email login
```

### Session Routes
```
GET    /sessions             — list user's sessions
POST   /sessions             — create new session
GET    /sessions/:id         — get session (graph + insights + state)
PATCH  /sessions/:id         — update session (node positions, step, card states)
DELETE /sessions/:id         — delete session and all associated data
GET    /sessions/:id/export  — download graph as JSON
```

### Graph Routes
```
PATCH  /sessions/:id/graph   — update graph (add/edit/remove nodes or edges)
PATCH  /sessions/:id/positions — update node positions (UI state, cheap write)
```

### Claude Routes (proxied through context assembler)
```
POST   /claude/extract       — graph_extraction task
POST   /claude/insight       — insight_generation task
POST   /claude/branches      — branch_generation task
POST   /claude/enrich        — gap_enrichment task
POST   /claude/synthesis     — final_synthesis task
POST   /claude/node-chat     — node_chat task
POST   /claude/project       — resume_projection task
```

### User Routes
```
GET    /user/me              — get user profile
DELETE /user/me              — delete account and all data
GET    /user/usage           — usage summary (tokens, cost)
```

---

## Request Flow

```
Browser → Vercel (frontend)
             ↓ fetch /api/v1/claude/node-chat
Railway (backend API)
  1. Verify JWT → extract user_id
  2. Validate session_id belongs to user_id
  3. Call assembleContext(user_id, 'node_chat', params)
  4. Log estimated_tokens to usage_logs
  5. Call Anthropic API with prompt package
  6. Log actual tokens to usage_logs
  7. Store result to node_conversations
  8. Return response to frontend
             ↓
Browser receives response, updates UI
```

---

## Context Assembler Integration

The context assembler lives in `/src/assembler/index.ts`. Every Claude route calls it before making any Anthropic API call.

```typescript
// Example: node-chat route
router.post('/claude/node-chat', requireAuth, async (req, res) => {
  const userId = req.user.id;  // from verified JWT, never from body
  const { session_id, node_id, message } = req.body;

  // Validate session ownership
  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  // Assemble context — never touches users table, never sends PII
  const promptPackage = await assembleContext({
    user_id: userId,
    task: 'node_chat',
    params: { session_id, node_id, user_message: message }
  });

  // Log estimated cost before call
  await logUsage({ userId, sessionId: session_id, task: 'node_chat',
    estimatedTokens: promptPackage.estimated_tokens });

  // Call Claude
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: promptPackage.system,
    messages: [
      { role: 'user', content: promptPackage.user_context + '\n\n' + promptPackage.task_prompt }
    ]
  });

  // Log actual cost
  await logUsage({ userId, sessionId: session_id, task: 'node_chat',
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens });

  // Store result
  await storeNodeChatMessage(session_id, node_id, userId, message, response);

  res.json({ content: response.content[0].text });
});
```

---

## Rate Limiting

Per user, per task type, per rolling 24-hour window:

| Task | Limit | Rationale |
|---|---|---|
| graph_extraction | 3/day | Expensive, rarely needed more than once |
| insight_generation | 5/day | Session resets |
| branch_generation | 10/day | Allows experimentation |
| gap_enrichment | 50/day | Core interaction loop |
| final_synthesis | 5/day | Expensive, settled output |
| node_chat | 100/day | Primary engagement mechanic |
| resume_projection | 20/day | Core use case |

Limits enforced via Redis or Supabase (simple counter in DB at MVP).

---

## Environment Variables

```bash
# Backend (.env)
ANTHROPIC_API_KEY=sk-ant-...          # never exposed to frontend
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...         # service role — never exposed to frontend
JWT_SECRET=...                        # for validating Supabase JWTs
PORT=3000
NODE_ENV=production

# Frontend (.env)
NEXT_PUBLIC_SUPABASE_URL=...          # safe to expose — public key only
NEXT_PUBLIC_SUPABASE_ANON_KEY=...     # safe to expose — RLS protects data
NEXT_PUBLIC_API_URL=https://api.careeros.app
```

---

## File Structure

```
career-os/
├── frontend/
│   ├── index.html                    # existing demo, wired to backend
│   └── assets/
│
├── backend/
│   ├── src/
│   │   ├── index.ts                  # Express app entry
│   │   ├── middleware/
│   │   │   ├── auth.ts              # JWT verification
│   │   │   └── rateLimit.ts         # per-user rate limiting
│   │   ├── routes/
│   │   │   ├── sessions.ts          # session CRUD
│   │   │   ├── claude.ts            # Claude proxy routes
│   │   │   └── user.ts             # user management
│   │   ├── assembler/
│   │   │   ├── index.ts             # assembleContext() entry
│   │   │   ├── tasks/
│   │   │   │   ├── graphExtraction.ts
│   │   │   │   ├── insightGeneration.ts
│   │   │   │   ├── branchGeneration.ts
│   │   │   │   ├── gapEnrichment.ts
│   │   │   │   ├── finalSynthesis.ts
│   │   │   │   ├── nodeChat.ts
│   │   │   │   ├── resumeProjection.ts
│   │   │   │   └── careerSummary.ts
│   │   │   ├── summary.ts           # buildCareerSummary() + buildDeterministicSkeleton()
│   │   │   └── nodeSelector.ts      # relevance scoring for resume projection
│   │   ├── db/
│   │   │   ├── client.ts            # Supabase client
│   │   │   ├── sessions.ts          # session queries
│   │   │   ├── conversations.ts     # node conversation queries
│   │   │   └── usage.ts             # usage logging
│   │   └── lib/
│   │       ├── anthropic.ts         # Anthropic client wrapper
│   │       └── validators.ts        # input validation
│   ├── supabase/
│   │   └── migrations/
│   │       └── 001_initial_schema.sql
│   ├── package.json
│   └── tsconfig.json
│
└── career-os-docs/                   # this directory
    ├── 01-product-vision.md
    ├── 02-data-model.md
    ├── 03-context-assembler.md
    ├── 04-privacy-principles.md
    └── 05-backend-architecture.md
```

---

## Build Order

### Week 1 — Foundation
1. Supabase project setup → run `001_initial_schema.sql`
2. Enable RLS, write policies
3. Backend scaffolding — Express + TypeScript + auth middleware
4. `/claude/extract` route with graph_extraction assembler task
5. Deploy to Railway

### Week 2 — Core Loop
6. Session CRUD routes
7. Remaining assembler tasks (insight, branch, enrich, synthesis, node_chat)
8. Frontend wired to backend — remove API key input, add Supabase auth
9. Session persistence through backend (replace localStorage)
10. Deploy frontend to Vercel

### Week 3 — Polish
11. Rate limiting
12. Usage dashboard (internal)
13. Export / delete account flows
14. Waitlist page
15. Invite flow for first 10 users

---

## Cost Projection

### Infrastructure (first 6 months)
- Supabase: $0 (free tier — 500MB DB, 50MB file, 2GB bandwidth)
- Railway: $0–5/mo (500 hours free, then ~$5/mo for hobby plan)
- Vercel: $0 (free tier covers hobby projects)
- **Total infrastructure: ~$5/mo**

### Inference (per user per month, typical usage)
- 1 full onboarding session: ~$0.12
- 20 node chat messages: ~$0.20
- 5 resume projections: ~$0.08
- **Total per active user: ~$0.40/mo**

### At 100 active users
- Infrastructure: $5
- Inference: $40
- **Total: ~$45/mo**
- Revenue at $15/user: $1,500/mo
- **Margin: ~97%**

---

## Deployment Commands

```bash
# Backend — Railway
railway login
railway init
railway up

# Frontend — Vercel
vercel login
vercel --prod

# Database migrations — Supabase
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

---

## First Claude Code Session Prompt

Use this to start the Claude Code implementation session:

```
We are building the backend for Career OS — a personal career knowledge 
graph product. The full product spec and data model are in the career-os-docs/ 
directory. Read all five markdown files before writing any code.

Start with:
1. supabase/migrations/001_initial_schema.sql — create all tables with RLS
2. backend/src/assembler/summary.ts — buildDeterministicSkeleton() pure function
3. backend/src/assembler/tasks/nodeChat.ts — most complex windowing logic
4. backend/src/routes/claude.ts — node-chat route wired to assembler

The context assembler is a pure function — no side effects, no Claude calls, 
no DB writes. The API route handles all of that.

Hard rules to enforce in code:
- user_id always from verified JWT, never from request body
- Every DB query scoped to user_id
- No PII in Claude prompts
- Raw resume text never stored or re-read after extraction
```
