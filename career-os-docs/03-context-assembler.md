# Career OS — Context Assembler Specification

## What It Is

A pure server-side function. Takes a request describing **who is asking** and **what task they need done**. Returns a **prompt package** — the minimum context Claude needs to complete that task well.

**No side effects. Does not call Claude. Does not write to the database. Reads, selects, compresses, and returns.**

```typescript
assembleContext(input: AssemblerInput): Promise<PromptPackage>
```

---

## Interface Contract

```typescript
type TaskType =
  | 'graph_extraction'
  | 'insight_generation'
  | 'branch_generation'
  | 'gap_enrichment'
  | 'final_synthesis'
  | 'node_chat'
  | 'resume_projection'
  | 'career_summary_generation';

interface AssemblerInput {
  user_id: string;                    // MANDATORY — always
  task: TaskType;
  params: Record<string, any>;        // task-specific, documented per task below
}

interface PromptPackage {
  system: string;                     // who Claude is + what it knows about this user
  user_context: string;               // specific data relevant to this task
  task_prompt: string;                // the actual instruction
  estimated_tokens: number;           // for cost logging before the call
  cache_key: string;                  // for prompt caching
  metadata: {
    nodes_selected: number;
    node_ids_selected: string[];
    truncated: boolean;               // true if token ceiling was hit
    summary_version: number;          // which version of career summary was used
  };
}
```

---

## The Eight Task Types

### 1. `graph_extraction`

**Purpose:** Convert raw resume text into a structured career graph.

**Input params:**
```typescript
{ resume_text: string }
```

**Behavior:**
- Only call where raw user text goes to Claude verbatim
- No prior graph context — this is the founding call
- System prompt is generic (career graph extraction engine)
- After this call completes, raw resume text is **discarded — never stored, never sent again**
- Returned graph JSON becomes the user's persistent graph in DB

**Context sent:** Resume text only
**Token ceiling:** 5,000
**Estimated tokens:** 1,500–4,000

**Output stored to:** `career_sessions.graph_data`

---

### 2. `insight_generation`

**Purpose:** Generate the core strength insight — the first wow moment.

**Input params:**
```typescript
{ session_id: string }
```

**Behavior:**
- Reads graph from DB
- Selects **weight-3 nodes only** as primary signal (typically 3–5 nodes)
- Selects **top 6 weight-2 nodes** as supporting evidence
- Does NOT send weight-1 nodes
- Sends node-to-node edges for selected nodes only
- No chat history, no prior answers (runs before Q1)
- System prompt enforces: strength-first, opens with "You have..." or "You are one of the few people who..."

**Context sent:** 8–11 selected nodes with edges
**Token ceiling:** 800
**Estimated tokens:** 400–600

**Output stored to:** `career_sessions.insights.strength`

---

### 3. `branch_generation`

**Purpose:** Generate three non-obvious career directions from graph topology.

**Input params:**
```typescript
{ session_id: string; answers: [string, string] }  // Q1 and Q2 only
```

**Behavior:**
- Reads all nodes from DB
- Sends **all nodes** but label + type + weight only — NOT full detail
- Sends Q1 and Q2 answers verbatim — primary signal
- Sends stored strength insight as one-sentence framing
- Does NOT send Q3, Q4 (not answered yet)
- Prompt enforces exactly 3 branches, celebration framing
- Pad to 3 if fewer returned (safety net)

**Context sent:** All nodes (labels only) + 2 answers + 1-sentence strength
**Token ceiling:** 1,000
**Estimated tokens:** 600–900

**Output stored to:** `career_sessions.insights.branches`

---

### 4. `gap_enrichment`

**Purpose:** Extract new graph nodes from a user's interview answer.

**Input params:**
```typescript
{
  session_id: string;
  question: string;
  answer: string;
  question_index: number;  // 0-3
}
```

**Behavior:**
- Reads current node labels from DB (for deduplication check only)
- Sends: question, answer, existing node labels list
- Does NOT send full node details
- Does NOT send chat history or prior answers
- Returns 1–2 new nodes, checked against existing labels for duplication
- After storage: flags `summary_version` for increment (triggers skeleton regeneration)

**Context sent:** 1 question + 1 answer + node labels list
**Token ceiling:** 500
**Estimated tokens:** 200–400

**Output stored to:** New nodes appended to `career_sessions.graph_data.nodes`

---

### 5. `final_synthesis`

**Purpose:** Generate the career portrait — celebration, identity, rare factor, next action, honest gap.

**Input params:**
```typescript
{
  session_id: string;
  chosen_branch_index: number;
}
```

**Behavior:**
- Reads graph from DB — sends weight-3 AND weight-2 nodes with **full detail**
- Sends all 4 answers verbatim
- Sends chosen branch title and `why` field
- Sends stored strength insight
- Does NOT send node positions, chat histories, or usage data
- Prompt enforces: grounded only in provided data, no invented facts, celebration framing
- After storage: triggers `career_summary_generation` async (behavioral pattern)

**Context sent:** Top nodes (full detail) + 4 answers + chosen branch + strength summary
**Token ceiling:** 1,500
**Estimated tokens:** 800–1,200

**Output stored to:** `career_sessions.insights.portrait`
**Triggers async:** `career_summary_generation`

---

### 6. `node_chat`

**Purpose:** Answer user questions about a specific node in the context of their full graph.

**Input params:**
```typescript
{
  session_id: string;
  node_id: string;
  user_message: string;
  conversation_turn: number;
}
```

**Behavior:**
- Reads the specific node's full detail from DB
- Reads **direct neighbors (1-hop only)** — label + type only
- Reads **weight-3 nodes** — label + 1-sentence detail (career context anchor)
- Reads career summary from DB (deterministic skeleton + behavioral pattern)
- Reads node conversation history with **windowing:**
  - ≤6 messages → send all verbatim
  - >6 messages → send stored conversation summary + last 6 messages only
- Never sends other nodes' chat histories
- Never sends raw answers (career summary covers this)

**Context sent:** 1 node (full) + neighbors (labels) + weight-3 anchors + career summary + windowed chat
**Token ceiling:** 1,000
**Estimated tokens:** 500–900 regardless of conversation length

**Output stored to:** `node_conversations.messages` — append new exchange
**Triggers:** Conversation summary regeneration if message_count > 6 (async)

---

### 7. `resume_projection`

**Purpose:** Generate a tailored resume projection for a specific job description.

**Input params:**
```typescript
{
  session_id: string;
  job_description: string;
}
```

**Behavior:**
- Reads all nodes from DB
- Runs **relevance pre-filter**: scores each node against JD using keyword + type matching
- Sends **top 12 nodes by relevance score** — not all nodes
- Sends career summary as framing
- Does NOT send answers, chat history, or prior insights
- Returns: selected node IDs, positioning statement, 5 bullets, skills list, structured gaps
- Gaps returned as structured objects: `{ label, description, question }` — each can become a `gap_enrichment` call

**Context sent:** 12 relevant nodes + career summary + JD
**Token ceiling:** 1,200
**Estimated tokens:** 700–1,000

**Output stored to:** `career_sessions.insights.projection` (latest only)

---

### 8. `career_summary_generation`

**Purpose:** Generate the LLM behavioral pattern component of the career summary.

**Input params:**
```typescript
{ session_id: string }
```

**Behavior:**
- Reads weight-3 nodes with full detail
- Reads stored portrait highlights if available
- Reads Q1 and Q2 answers (initiative pattern signal)
- Generates 50-token behavioral pattern paragraph
- Stores to `career_sessions.behavioral_pattern`
- This call runs **asynchronously** after `final_synthesis` — never in the critical path

**Context sent:** Weight-3 nodes + portrait highlights + Q1, Q2 answers
**Token ceiling:** 600
**Estimated tokens:** 300–500

**Output stored to:** `career_sessions.behavioral_pattern`

---

## The Career Summary — Hybrid Model

The career summary is the reusable context anchor sent on every non-extraction call. It is **never regenerated on the call path** — it is read from the database.

### Structure

```
[Deterministic skeleton — always current, ~100 tokens]
[Behavioral pattern — LLM-generated once, ~50 tokens]
```

### Deterministic Skeleton (pure function, no LLM)

```typescript
function buildDeterministicSkeleton(
  graph: CareerGraph,
  insights: SessionInsights,
  selectedBranch: number | null
): string {
  const w3 = graph.nodes
    .filter(n => n.weight === 3)
    .map(n => n.label);

  const w2 = graph.nodes
    .filter(n => n.weight === 2)
    .map(n => n.label)
    .slice(0, 4);

  const outcomes = graph.nodes
    .filter(n => n.type === 'outcome')
    .map(n => n.label)
    .slice(0, 3);

  const direction = selectedBranch !== null
    ? insights?.branches?.[selectedBranch]?.title
    : 'exploring';

  return [
    `Career context: ${w3.join(', ')} [defining].`,
    w2.length ? `Supporting: ${w2.join(', ')}.` : '',
    direction ? `Direction: ${direction}.` : '',
    outcomes.length ? `Key outcomes: ${outcomes.join(', ')}.` : ''
  ].filter(Boolean).join(' ');
}
```

Always current. Zero cost. Regenerates whenever `summary_version` increments.

### Behavioral Pattern (LLM, generated once)

Generated by `career_summary_generation` after `final_synthesis` completes. Stored in `career_sessions.behavioral_pattern`.

Example output:
```
Behavioral pattern: Identifies systemic gaps before anyone assigns them.
Every major outcome preceded by an unrequested decision.
```

### Combined Summary

```typescript
function buildCareerSummary(session: CareerSession): string {
  const skeleton = buildDeterministicSkeleton(
    session.graph_data,
    session.insights,
    session.selected_branch
  );
  const pattern = session.behavioral_pattern || '';
  return [skeleton, pattern].filter(Boolean).join('\n');
}
```

### Regeneration Triggers

| Trigger | What regenerates | Cost |
|---|---|---|
| New weight-3 node added | Deterministic skeleton | Free |
| New weight-2 node added | Deterministic skeleton | Free |
| Node label edited | Deterministic skeleton | Free |
| Chosen branch changes | Deterministic skeleton | Free |
| Session completes (portrait generated) | Behavioral pattern | One LLM call, async |
| User adds 3+ new nodes post-portrait | Behavioral pattern | One LLM call, async |
| User explicitly requests refresh | Behavioral pattern | One LLM call |

---

## Hard Rules

### Rule 1 — Token Ceiling Enforcement
Each task has a hard ceiling. If assembled context would exceed it, truncate lowest-weight nodes first, then oldest chat messages. Set `metadata.truncated = true`.

### Rule 2 — No PII in Prompts
The assembler never reads from the `users` table. Only from `career_sessions` and `node_conversations`. User name and email never appear in any Claude prompt.

### Rule 3 — user_id Scoping Is Mandatory
Every DB read includes `WHERE user_id = $user_id`. Validated at function entry — throws if `user_id` is missing.

```typescript
if (!input.user_id) {
  throw new Error('AssemblerError: user_id is required');
}
```

### Rule 4 — Raw Resume Text Is Never Re-Read
If `graph_extraction` is called and a graph already exists for this user + session, reject the call. Re-extraction requires explicit user action that clears the existing graph first.

### Rule 5 — Task-Appropriate Node Selection
The assembler decides which nodes to send — not the API route. The API route passes `session_id`, never a node list.

### Rule 6 — The Assembler Never Calls Claude
Pure read-and-construct function. The caller (API route) sends the prompt package to Claude and writes results back to DB. Clean separation.

### Rule 7 — No Cross-Session Data
The assembler never reads from a session belonging to a different user. The `session_id` is always validated against the `user_id` before any data is read.

---

## Token Budget Reference

| Task | Ceiling | Typical range |
|---|---|---|
| graph_extraction | 5,000 | 1,500–4,000 |
| insight_generation | 800 | 400–600 |
| branch_generation | 1,000 | 600–900 |
| gap_enrichment | 500 | 200–400 |
| final_synthesis | 1,500 | 800–1,200 |
| node_chat | 1,000 | 500–900 |
| resume_projection | 1,200 | 700–1,000 |
| career_summary_generation | 600 | 300–500 |

---

## Cost Model

At Claude Sonnet 4 pricing, a full onboarding session (graph extraction + insight + branch + 4 enrichments + synthesis + summary) costs approximately **$0.10–0.15**.

Node chat messages cost approximately **$0.01–0.02** each.

At $15–20/month subscription pricing, a user can complete ~2 full onboarding sessions and ~100 node chat messages before exceeding subscription revenue. Well within margin at typical usage patterns.
