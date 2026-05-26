# Career OS — Privacy Principles and Data Security

## The One-Paragraph Version

Career OS stores your career graph, your session answers, and the insights generated from them — nothing more. Your data is yours: you can export it as JSON or delete it at any time. Your career content is processed by Claude (Anthropic's API) to build your graph — it is not used to train AI models. Your identity and your career data are stored separately and never combined in our logs or analytics. We do not sell data, run ads, or share your information with third parties. Ever.

---

## Principle 1 — Identity Isolation

Every piece of career data is owned by exactly one user and is never accessible to another. This is not just a permission rule — it is an architectural constraint.

**What this means in practice:**
- Every database row carries a `user_id` foreign key. Every query is filtered by it. There is no query path that returns another user's graph, answers, insights, or chat history.
- The "You / Partner" session model never stores both sessions under a shared identifier. Two sessions with the same `user_id` have different `session_label` values — they are distinct rows.
- Row Level Security is enforced at the Postgres level, not just the application level. Even if the application layer has a bug, the database refuses cross-user reads.
- No career data is ever used to calibrate another user's graph without explicit, informed consent. Phase 2 cohort intelligence uses only anonymized, aggregated signals.

---

## Principle 2 — Minimum Viable Data

We store only what is necessary to deliver the product. If we cannot articulate why a piece of data needs to persist, it does not get stored.

### What we store and why

| Data | Why | Retention |
|---|---|---|
| Email address | Account identity and login | Until account deleted |
| Career graph (nodes + edges) | Core product — the graph is the asset | Until user deletes session |
| Node positions (x, y) | Layout preference — UX continuity | Until user deletes session |
| Session answers (Q1–Q4) | Enriched the graph — context for future sessions | Until user deletes session |
| Generated insights (strength, branches, portrait) | Expensive to regenerate — user's own output | Until user deletes session |
| Node chat history | Conversational context per node | Until user clears it |
| Career summary | Reusable context anchor — derived from graph | Regenerated on graph change |
| Usage logs (token counts, task type, timestamp) | Cost attribution and abuse prevention | 90 days, then purged |

### What we explicitly do NOT store

- **Raw resume text** — discarded after graph extraction completes. The graph is the derived artifact.
- **Full Claude prompt text** — only token counts are logged for cost tracking, not prompt content.
- **IP addresses** — not captured at application level.
- **Behavioral analytics** — no hover tracking, click heatmaps, or session recordings.
- **Employer or colleague information** — if mentioned in answers, it is processed but not extracted as a stored entity.
- **Salary information** — not collected, not stored.
- **Third-party profile data** — we do not scrape LinkedIn or import from external sources without explicit user action.

---

## Principle 3 — Inference Happens, Data Stays Yours

When career narrative is sent to Claude for graph extraction, that data is transmitted to Anthropic's API under Anthropic's data processing terms.

**What this means:**
- We are a data processor, not a data controller, for the inference step.
- Anthropic's API does not use submitted data for model training by default (zero data retention API option available).
- We disclose this clearly at onboarding — one sentence, plain language, before the first API call.
- The context assembler ensures only the minimum necessary data is sent to Claude on each call. Full graphs are never sent wholesale — only the relevant slice for the current task.
- After graph extraction, the raw resume text is not sent to Claude again under any circumstances.

---

## Principle 4 — User Control Is Real

Users can see, export, and delete their data at any time. These are first-class features, not buried settings.

- **Export** — Download your full career graph as JSON at any time. Portable, machine-readable.
- **Delete session** — Remove a specific session (graph, answers, insights, chat history) without deleting the account.
- **Delete account** — Removes all data. Usage logs purged immediately. Remaining data purged within 30 days.
- **No dark patterns** — Deletion is a button, not a support ticket.
- **No re-engagement lock-in** — The exported JSON can be imported back if the user returns.

---

## Principle 5 — Separation of Identity and Career Data

Identity (email, name) and career data (graph, answers, insights) are stored in separate tables. They are never denormalized — no email address appears in the `career_sessions` or `node_conversations` tables.

**Why this matters:**
- A breach of `career_sessions` exposes career data but not PII.
- A breach of `users` exposes emails but not career records.
- Logs, analytics, and debugging tools work against `user_id` (UUID) — never email or name.
- Phase 2 cohort intelligence: anonymization is already baked in. Strip `user_id`, replace with one-way hash before aggregation. Career data and identity never travel together outside the user's own session.

**Implementation constraint:**
The context assembler never reads from the `users` table. It only reads from `career_sessions` and `node_conversations`. This is enforced at the code level, not just policy.

---

## Principle 6 — No Ads, No Data Monetization

Career data is not sold, shared with third parties, or used for advertising targeting — ever.

The business model is the subscription. The data is the user's asset, not ours.

This principle survives any future funding or acquisition. It is in the terms of service. In any future investor agreement it is a covenant, not a preference.

---

## Principle 7 — The Recruiter Layer Requires Explicit Consent

Phase 2 introduces recruiter-side capability discovery. A user's graph becoming discoverable is **opt-in, not opt-out**, with explicit confirmation of what is visible and to whom before any discoverability is enabled.

**Discoverable profiles show only:**
- Capability nodes the user has chosen to surface
- General seniority level
- Location preference

**Discoverable profiles never show:**
- User's name
- Current or past employer
- Salary history
- Verbatim career answers
- Node chat conversations

Users can toggle discoverability off at any time and disappear from recruiter search immediately — no delay, no processing period.

---

## Security Architecture

### Authentication
Supabase Auth — email magic link or Google OAuth. JWT tokens are short-lived and rotated. Never stored in localStorage (httpOnly cookies).

### API Security
All API routes require a valid JWT. The `user_id` is extracted from the verified JWT — never from the request body. A user cannot impersonate another user by passing a different `user_id` in the request.

### Database Security
- Row Level Security enabled on all tables
- Service role key never exposed to frontend
- All reads scoped to authenticated user's `user_id`
- Parameterized queries everywhere — no string interpolation in SQL

### Secrets Management
- Anthropic API key stored as environment variable on backend only
- Never exposed to frontend
- Never logged
- Rotated quarterly or immediately on suspected exposure

### Transport Security
- HTTPS everywhere — enforced at infrastructure level
- HSTS headers on all responses
- No mixed content

---

## Incident Response

If a data breach is suspected:
1. Rotate all API keys and JWT secrets immediately
2. Notify affected users within 72 hours
3. Revoke all active sessions
4. Audit logs for unauthorized access patterns
5. Post-incident report published to users

---

## What Claude Code Should Enforce

When implementing the backend, these principles translate to code-level constraints:

```typescript
// NEVER do this — user_id from request body
const userId = req.body.user_id; // ❌

// ALWAYS do this — user_id from verified JWT
const userId = req.user.id; // ✅

// NEVER do this — query without user scoping
const session = await db.query('SELECT * FROM career_sessions WHERE id = $1', [sessionId]); // ❌

// ALWAYS do this — query with user scoping
const session = await db.query(
  'SELECT * FROM career_sessions WHERE id = $1 AND user_id = $2',
  [sessionId, userId]
); // ✅

// NEVER do this — send full graph to Claude
const prompt = `Here is the user's full career data: ${JSON.stringify(fullGraph)}`; // ❌

// ALWAYS do this — use the context assembler
const promptPackage = await assembleContext({ user_id: userId, task: 'node_chat', params }); // ✅
```
