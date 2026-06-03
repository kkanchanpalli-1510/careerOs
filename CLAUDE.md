# Career OS — Project Context for Claude Code

## What this is
Career OS is a career intelligence tool. It extracts a career graph from a resume,
runs a structured interview (4 questions), then generates a Core Strength insight,
Career Directions, and a Career Portrait. Backend is Express + TypeScript on Railway,
frontend is a single-page HTML file served as a static asset, database is Supabase.

**Live URL:** https://ideal-grace-production-3e9f.up.railway.app
**GitHub:** https://github.com/kkanchanpalli-1510/careerOs

## Deploy commands
```bash
# Deploy backend + frontend to Railway
/opt/homebrew/bin/railway up --detach

# Sync frontend source to backend static dir (always run before deploy)
cp /Users/swapnaannojwala/Documents/careerOs/files/career-os-interactive.html \
   /Users/swapnaannojwala/Documents/careerOs/career-os-backend/frontend/index.html
```

## Key file locations
| File | Purpose |
|---|---|
| `frontend/index.html` | The entire frontend (single-page app). Edit the source at `../files/career-os-interactive.html`, then sync. |
| `src/index.ts` | Express app entry point — router registration |
| `src/routes/claude.ts` | All AI generation endpoints |
| `src/routes/sessions.ts` | Session CRUD + stage-calibrated questions |
| `src/routes/events.ts` | Copy tracking (fire-and-forget) |
| `src/routes/pdf.ts` | Resume PDF generation |
| `src/assembler/index.ts` | Context assembler — all task orchestration |
| `src/assembler/types.ts` | TaskType enum + CareerGraph, Node, Edge types |
| `src/assembler/summary.ts` | Career stage detection + skeleton builder |
| `src/assembler/tasks/` | One file per Claude task |
| `src/db/client.ts` | Supabase admin client |
| `src/db/usage.ts` | Token usage logging + rate limits |
| `src/db/sessions.ts` | validateSessionOwnership + updateSession helpers |
| `supabase/migrations/` | SQL migrations — run manually in Supabase SQL Editor |

## Architecture decisions
- **No framework**: Single HTML file for frontend. No React, no build step.
- **State**: Session state is stored in `localStorage` as `cardStates` (rendered HTML) + raw data. Two slots (A/B) for two parallel sessions.
- **Auth**: Supabase email+password. `_authToken` cached in memory. `_getToken()` for API calls.
- **Career stage**: `detectStageProfile(graph)` in `summary.ts` — returns `{ stage: 'ic'|'leader'|'executive', isTransitioning, transitionDirection, titleCapabilityGap }`.
- **Assembler pattern**: Every AI task has an assembler function in `index.ts` + a prompt builder in `tasks/`. Route handlers call `assembleContext()` then `callClaude()`.
- **Copy tracking**: Always fire-and-forget. `logCopyEvent(...).catch(() => {})` pattern throughout.
- **Frontend sync rule**: The source of truth for the frontend is `../files/career-os-interactive.html`. Sync to `frontend/index.html` before every deploy.

## API surface
```
POST /api/v1/claude/extract                 — graph extraction from resume
POST /api/v1/claude/insight                 — core strength insight
POST /api/v1/claude/insight/regenerate      — regenerate with different pattern
POST /api/v1/claude/branches                — career direction branches
POST /api/v1/claude/enrich                  — gap enrichment from Q&A answers
POST /api/v1/claude/synthesis               — career portrait (final step)
POST /api/v1/claude/career-chat             — ongoing career chat
POST /api/v1/claude/node-chat               — node-specific chat
POST /api/v1/claude/project                 — resume projection for a job description
POST /api/v1/claude/linkedin-summary        — LinkedIn profile summary
POST /api/v1/claude/short-bio               — short third-person bio (100-150 words)
POST /api/v1/events/copy                    — copy event tracking (always 200)
GET  /api/v1/sessions                       — list sessions
POST /api/v1/sessions                       — create session
GET  /api/v1/sessions/:id/questions         — stage-calibrated enrichment questions
DELETE /api/v1/sessions/:id                 — delete session
POST /api/v1/pdf/resume                     — generate PDF resume
```

## Database schema summary
```
users               — id, email, name
career_sessions     — id, user_id, graph_data (JSONB), insights (JSONB),
                       answers (JSONB), selected_branch, career_summary,
                       behavioral_pattern, summary_version, previous_insight,
                       enrich_count, step
node_conversations  — id, session_id, node_id, messages (JSONB), summary
usage_logs          — id, user_id, session_id, task_type, prompt/completion tokens
copy_events         — id, user_id, session_id, event_name, metadata (JSONB)
resume_versions     — (migration 003 — see PENDING MIGRATIONS below)
```

`insights` JSONB shape:
```json
{
  "strength":    { "insight", "strength_label", "pattern_nodes", "pattern_type", "identity_reframe" },
  "branches":    [{ "title", "description", "timeline", "type" }],
  "portrait":    { "identity", "celebration", "rare_factor", "next_action", "gap" },
  "projection":  { "positioning_statement", "achievement_bullets", "gap_analysis", "selected_node_ids" },
  "linkedin_summary": "string",
  "linkedin_summary_generated_at": "ISO timestamp",
  "short_bio": "string",
  "short_bio_generated_at": "ISO timestamp"
}
```

## ⚠️ PENDING MIGRATIONS — run these in Supabase SQL Editor
These files exist in `supabase/migrations/` but have NOT been applied to the live DB yet.
Run them in order:

1. **`003_resume_versions.sql`** — creates `resume_versions` table (PDF versioning). PDF save/list/rename/delete calls will fail until this runs.
2. **`004_copy_events.sql`** — creates `copy_events` table (copy tracking). Copy events will silently fail until this runs.
3. **`005_previous_insight.sql`** — adds `previous_insight TEXT` to `career_sessions`. Regenerate-insight restore will fail until this runs.

## What has been built (spec docs in `docs/`)
- **Doc 08** — Career stage detection (`detectCareerStage`, `detectStageProfile`) — COMPLETE
  - Three stages: `ic`, `leader`, `executive`. Word-boundary regexes guard against substring false positives.
  - Stage-calibrated insight prompt (`STAGE_INSTRUCTIONS` in `insightGeneration.ts`)
  - Stage-calibrated enrichment questions (`STAGE_QUESTIONS` in `gapEnrichment.ts`)
  - `GET /sessions/:id/questions` returns the right questions for this graph's stage
- **Doc 09** — Copy tracking, regeneration, LinkedIn summary, short bio, portrait card — COMPLETE
  - `copyWithTracking(text, eventName, metadata, btnEl)` utility — clipboard + visual flash + fire-and-forget tracking
  - Copy buttons on insight pane and portrait pane
  - ↺ Regenerate button in strength card; ← Previous restore after first regeneration
  - LinkedIn Summary tab (3-para first-person, 2600-char counter, stage-calibrated)
  - Short Bio tab (100–150 words, third-person with "They", stage-calibrated, no name invention)
  - Portrait Card modal (dark card, identity + insight quote + skill tags, Copy Text + Download Image via html2canvas)
  - All Share Your Story content persisted in `cardStates.portrait` and restored on session reload

## Rules when adding features
- **Never modify existing route handlers** — add new `router.post(...)` calls only
- **Never modify existing assembler tasks** — add new files in `tasks/`
- **Copy tracking is always fire-and-forget**: `logCopyEvent(...).catch(() => {})`
- **Migrations**: show the SQL file first, don't run it — user applies manually in Supabase
- **Frontend source**: always edit `../files/career-os-interactive.html`, sync to `frontend/index.html`
- **TypeScript**: run `npx tsc --noEmit` before committing. Project uses `strict: true`, `commonjs`, `ES2020`.
- **Node.detail is `string` (not optional)**; `Node.weight` is `1 | 2 | 3`

## Running tests
```bash
# Career stage detection unit tests (30 tests, uses Node assert — no Jest)
npx ts-node src/assembler/__tests__/detectCareerStage.test.ts
```
