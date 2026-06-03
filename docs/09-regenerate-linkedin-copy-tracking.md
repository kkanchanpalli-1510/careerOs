# Career OS — Feature Spec: Insight Regeneration + LinkedIn Summary + Shareable Portrait + Copy Tracking

## Overview

Four connected features that close the enrichment loop and add the first
distribution mechanics to the product:

1. **Regenerate Core Strength** — refresh the insight after graph enrichment
   or surface an alternative perspective
2. **LinkedIn Summary Generator** — generate a LinkedIn-optimized profile
   summary from the career graph
3. **Shareable Career Portrait and Bio** — generate a short bio and a
   shareable career portrait card with copy buttons for any platform
4. **Copy Tracking** — instrument every copy action as a validation signal

These are all low-complexity additions that reuse existing infrastructure.
No new architecture required.

---

## Feature 1 — Regenerate Core Strength

### User Story

After completing the mini-interview (Q1–Q4) the user's graph has 4–8 new
nodes that didn't exist when the first insight was generated. The Regenerate
button lets them see how the insight sharpens with richer data — closing the
enrichment loop visually.

A second use case: the first insight didn't land emotionally. Regenerate
surfaces an alternative structural pattern from the same graph.

### UI

Location: The strength card (Layer 1 of the outcome card stack in the graph panel).

Add two elements to the strength card tab row:
```
[ ◆ Core Strength ]  [↺ Regenerate]  [↑/↓ collapse]
```

The Regenerate button:
- Only appears after graph extraction is complete
- Shows a loading state while generating ("Refreshing...")
- Replaces the current insight text with the new one
- Does NOT show both simultaneously — replace, don't stack
- Stores the previous insight so user can restore it ("← Previous")

### Backend

New context assembler task: `insight_regeneration`

Identical to `insight_generation` with one addition — pass the previous
insight as context so Claude generates a genuinely different angle:

```typescript
// src/assembler/tasks/insightGeneration.ts

export function buildInsightRegenerationPrompt(
  selectedNodes: Node[],
  edges: Edge[],
  stageProfile: StageProfile,
  previousInsight: string  // NEW — pass previous insight
): PromptPackage {

  const task_prompt = `Generate a NEW insight that surfaces a DIFFERENT structural
pattern from this career graph. Do not repeat or rephrase the previous insight.

Previous insight (do not repeat this pattern):
"${previousInsight}"

Find the SECOND most interesting structural pattern — one the person
has probably also never articulated. Apply the same quality bar:
strength-first, grounded in specific nodes, identity-reframing.

${BASE_TASK_PROMPT}`;

  // ... same structure as buildInsightPrompt()
}
```

### API Endpoint

```
POST /api/v1/claude/insight/regenerate
Body: { session_id, previous_insight }
Returns: { insight, strength_label, pattern_nodes, identity_reframe }
```

### Database

Add one field to `career_sessions`:

```sql
ALTER TABLE career_sessions
ADD COLUMN previous_insight TEXT;  -- stores last insight before regeneration
```

On regenerate: move current `insights.strength` to `previous_insight`,
store new insight in `insights.strength`.

### Copy Tracking

Track regeneration count as a product signal:

```sql
-- In usage_logs, task_type = 'insight_regeneration'
-- Count per user tells you: how many people enriched enough to want a refresh
-- High regeneration rate = enrichment loop is working
```

---

## Feature 2 — LinkedIn Summary Generator

### User Story

The user wants a professional summary they can paste into their LinkedIn
profile. Career OS generates it from their full career graph — better than
anything they could write from scratch because it comes from the complete
pattern of their career, not just what they remember when staring at a
blank field.

No LinkedIn API. No OAuth. Copy and paste only.
The copy count tells us if this output earns trust.

### UI

Location: A new button in the Career Portrait card (Layer 3 of the outcome
card stack). Appears after the portrait is generated.

```
[ ◈ Career Portrait ]
  [identity] [celebration] [what makes you rare] [next move] [gap]

  ─────────────────────────────────────────────
  [ ✦ Generate LinkedIn Summary ]
```

Clicking expands a new sub-section within the portrait card:

```
LINKEDIN SUMMARY
─────────────────────────────────────────────
[Generated summary text — 3 paragraphs]

Character count: 847 / 2,600

[ Copy to clipboard ]   [ Regenerate ]
─────────────────────────────────────────────
```

### LinkedIn Summary Format

LinkedIn summaries have specific constraints and conventions:

- **Character limit:** 2,600 characters (show live count)
- **Voice:** First person ("I build..." not "Kishore builds...")
- **Structure:** Opening hook → what you do + what makes you distinctive
  → key evidence → forward direction/what you're looking for
- **Tone:** Calibrated to career stage (see 08-career-stage-calibration.md)
  - IC: craft-forward, specific capabilities
  - Leader: impact and leverage, team outcomes
  - Executive: vision, judgment, strategic bets
- **Keywords:** Surface role-relevant terms naturally for LinkedIn search
- **No buzzwords:** No "passionate", "results-driven", "seasoned", "dynamic"
- **Ends with:** Optional soft CTA — "Open to conversations about [direction]"

### Context Assembler Task: `linkedin_summary`

```typescript
// src/assembler/tasks/linkedinSummary.ts

export function buildLinkedInSummaryPrompt(
  session: CareerSession,
  stageProfile: StageProfile
): PromptPackage {

  const stageGuidance = LINKEDIN_STAGE_GUIDANCE[stageProfile.stage];
  const careerSummary = buildCareerSummary(session);
  const topNodes = session.graph_data.nodes
    .filter(n => n.weight >= 2)
    .slice(0, 12);
  const portrait = session.insights?.portrait;
  const chosenDirection = session.insights?.branches?.[session.selected_branch ?? 0];

  const system = `You are a LinkedIn profile expert who writes summaries
that feel human, specific, and authentic — not like AI-generated marketing copy.

${stageGuidance}

BANNED WORDS (never use): passionate, seasoned, proven, dynamic,
results-driven, thought leader, self-starter, go-getter, rockstar,
ninja, guru, strategic thinker, innovative, leveraging, synergy`;

  const user_context = `Career context:
${careerSummary}

Identity reframe: ${portrait?.identity || ''}
Core strength: ${session.insights?.strength || ''}
Key outcomes: ${topNodes.filter(n => n.type === 'outcome').map(n => n.label).join(', ')}
Chosen direction: ${chosenDirection?.title || 'not specified'}`;

  const task_prompt = `Write a LinkedIn profile summary for this person.

Requirements:
- First person voice throughout
- Under 2,400 characters (leave buffer for edits)
- Three paragraphs:
  Para 1 (2-3 sentences): The opening hook — who they are at their core,
    what makes them distinctive. NOT a job title recitation.
  Para 2 (3-4 sentences): The evidence — specific outcomes, what they've built,
    the impact. At least one concrete metric if available from their graph.
  Para 3 (2-3 sentences): Forward direction — what they're focused on now,
    what they're open to. Should feel aspirational but grounded.
- Tone calibrated to their career stage (see stage guidance above)
- Natural, human, reads like they wrote it themselves on a good day
- End with a single optional line: "Open to conversations about [their direction]."

Return ONLY the summary text. No explanation. No headers. No JSON.`;

  return {
    system,
    user_context,
    task_prompt,
    estimated_tokens: 800,
    cache_key: `linkedin_${session.id}_${session.summary_version}`,
    metadata: {
      nodes_selected: topNodes.length,
      node_ids_selected: topNodes.map(n => n.id),
      truncated: false,
      summary_version: session.summary_version
    }
  };
}

const LINKEDIN_STAGE_GUIDANCE: Record<CareerStage, string> = {
  ic: `STAGE: Individual Contributor
Tone: Specific, craft-forward, energetic. Celebrate what they build and create.
Opening: Lead with a distinctive capability or rare combination, not job title.
Evidence: Technical outputs, specific problems solved, unique approaches.
Forward: What kind of problems they want to work on next.`,

  leader: `STAGE: Manager / Director / Team Lead
Tone: Measured, impact-focused. The hero is what the team achieved.
Opening: Lead with the outcomes they enable, not their title.
Evidence: Team scale, capabilities built, cross-functional impact, systems created.
Forward: What kind of organization or challenge they want to help grow next.`,

  executive: `STAGE: VP / Executive / Founder
Tone: Deliberate, elevated. Peer-to-peer. Not self-promotional.
Opening: Lead with a point of view or the type of problem they're built for.
Evidence: Strategic bets made, organizational transformations, business outcomes.
Forward: What they're thinking about at the industry or platform level.`
};
```

### API Endpoint

```
POST /api/v1/claude/linkedin-summary
Body: { session_id }
Returns: { summary, character_count }
```

### Database

Store the generated summary in the session insights:

```sql
-- No schema change needed
-- Store in existing insights JSONB column:
-- insights.linkedin_summary: string
-- insights.linkedin_summary_generated_at: timestamp
```

---

## Feature 3 — Shareable Career Portrait and Bio

### The Concept

Two distinct outputs from the same graph, serving different use cases:

**Short Bio (100–150 words)** — the professional bio everyone needs and nobody
writes well. Used for: conference speaker bios, website about pages, Twitter/X
bios, email signatures, Slack profiles, company team pages.

**Career Portrait Card (visual)** — a designed card showing the identity reframe,
core strength statement, and top capability tags. Shareable as an image on any
platform. The kind of thing people post when they get a new role, speak at a
conference, or want to share something meaningful about their professional identity.

Both outputs are generated from the existing graph and portrait data.
Both have copy buttons tracked as validation signals.

### Why This Has Higher Distribution Potential Than LinkedIn Summary

A LinkedIn summary lives on one platform, visible only to profile visitors.
A career portrait card can be shared anywhere — Twitter/X, LinkedIn posts,
Instagram, Slack, email. It is visual, emotional, and self-contained.
The strength insight line is the kind of sentence people screenshot and share.

### UI — Short Bio

Location: New sub-section within the Career Portrait card, below LinkedIn summary.

```
[ ◈ Career Portrait ]
  ─────────────────────────────────
  [identity] [celebration] [rare] [next move]
  ─────────────────────────────────
  [ ✦ LinkedIn Summary ]   [ ✦ Short Bio ]   [ ✦ Portrait Card ]
```

Short bio panel when expanded:

```
SHORT BIO
─────────────────────────────────────────────
Use for: speaker bios, about pages, team profiles, email signatures

[Generated bio — 2-3 sentences, ~120 words]

[ Copy Bio ]    [ Regenerate ]
─────────────────────────────────────────────
```

### UI — Career Portrait Card

When the user clicks "Portrait Card" a modal opens showing a designed card:

```
┌─────────────────────────────────────────────────┐
│  ◈  Career OS                                   │
│                                                 │
│  [Identity reframe — e.g. "Founding Operator   │
│   Who Uses Infrastructure as the Medium"]       │
│                                                 │
│  "[Core strength insight — 1-2 sentences]"      │
│                                                 │
│  ┤ Data Architecture  ┤ PLG Signal Design  ┤   │
│  ┤ Organizational Influence  ┤ Zero-to-One  ┤  │
│                                                 │
│  careeros.app                        [logo]     │
└─────────────────────────────────────────────────┘

[ Copy as Text ]   [ Download Image ]   [ Copy Link ]
```

Three copy options:
- **Copy as Text** — plain text version for pasting anywhere
- **Download Image** — PNG of the card for sharing on visual platforms
- **Copy Link** — shareable URL to a hosted version of the card (Phase 2)

### Context Assembler Task: `short_bio`

```typescript
// src/assembler/tasks/shortBio.ts

export function buildShortBioPrompt(
  session: CareerSession,
  stageProfile: StageProfile
): PromptPackage {

  const portrait = session.insights?.portrait;
  const careerSummary = buildCareerSummary(session);
  const topNodes = session.graph_data.nodes
    .filter(n => n.weight === 3)
    .map(n => n.label);

  const system = `You write professional bios that feel human and specific —
not AI-generated marketing copy. The bio should sound like the person
wrote it themselves on a very good day.

${BIO_STAGE_GUIDANCE[stageProfile.stage]}

BANNED WORDS: passionate, seasoned, proven, dynamic, results-driven,
thought leader, self-starter, innovative, leveraging`;

  const user_context = `Identity: ${portrait?.identity || ''}
Core strength: ${session.insights?.strength || ''}
Defining capabilities: ${topNodes.join(', ')}
Career context: ${careerSummary}
Chosen direction: ${session.insights?.branches?.[session.selected_branch ?? 0]?.title || ''}`;

  const task_prompt = `Write a short professional bio for this person.

Requirements:
- 100–150 words maximum
- Third person voice ("Kishore builds..." not "I build...")
- Two to three sentences:
  Sentence 1: Who they are at their core + what makes them distinctive.
    NOT a job title. Lead with the identity reframe.
  Sentence 2: Evidence — one or two specific outcomes or capabilities
    that ground the identity claim. At least one concrete signal.
  Sentence 3 (optional): Current focus or direction.
    What they are building toward or open to.
- Reads naturally when spoken aloud at a conference introduction
- Specific enough that it could only be about this person

Return ONLY the bio text. No labels. No JSON. No explanation.`;

  return {
    system,
    user_context,
    task_prompt,
    estimated_tokens: 400,
    cache_key: `bio_${session.id}_${session.summary_version}`,
    metadata: {
      nodes_selected: topNodes.length,
      node_ids_selected: session.graph_data.nodes
        .filter(n => n.weight === 3).map(n => n.id),
      truncated: false,
      summary_version: session.summary_version
    }
  };
}

const BIO_STAGE_GUIDANCE: Record<CareerStage, string> = {
  ic: `STAGE: Individual Contributor
Lead with craft and rare capability. What this person builds.
Evidence: specific technical outputs, unusual skill combinations.
Avoid: management language, org scale, team size.`,

  leader: `STAGE: Manager / Director
Lead with leverage and what they enable in others.
Evidence: team scale, capabilities built, cross-functional outcomes.
The bio should feel like someone who makes organizations better.`,

  executive: `STAGE: VP / Executive
Lead with a point of view or the type of problem they are built for.
Evidence: strategic bets, organizational transformation, business outcomes.
Tone: peer-to-peer, measured. Not self-promotional.`
};
```

### Career Portrait Card — Implementation

The portrait card is an HTML/CSS component rendered in the frontend.
No backend call needed — all data comes from the existing portrait, insight,
and graph data already in session state.

```javascript
function renderPortraitCard(session) {
  const portrait = session.insights?.portrait;
  const insight = session.insights?.strength;
  const identity = portrait?.identity || '';
  const topTags = session.graphData?.nodes
    .filter(n => n.weight >= 2 && n.type === 'skill')
    .slice(0, 6)
    .map(n => n.label);

  // Render as styled HTML div
  const card = document.createElement('div');
  card.className = 'portrait-card';
  card.innerHTML = `
    <div class="pc-header">
      <div class="pc-logo">◈ Career OS</div>
    </div>
    <div class="pc-identity">${identity}</div>
    <div class="pc-insight">"${truncate(insight, 180)}"</div>
    <div class="pc-tags">
      ${topTags.map(t => `<span class="pc-tag">${t}</span>`).join('')}
    </div>
    <div class="pc-footer">careeros.app</div>
  `;

  return card;
}

// Copy as text
function copyPortraitAsText(session) {
  const portrait = session.insights?.portrait;
  const insight = session.insights?.strength;
  const tags = session.graphData?.nodes
    .filter(n => n.weight >= 2 && n.type === 'skill')
    .slice(0, 6).map(n => n.label).join('  ·  ');

  const text = `${portrait?.identity || ''}

"${insight}"

${tags}

careeros.app`;

  copyWithTracking(text, 'copy_portrait_card_text', {
    identity: portrait?.identity,
    stage: getCurrentStage()
  });
}

// Download as image using html2canvas or native browser API
async function downloadPortraitImage() {
  const card = document.getElementById('portraitCard');
  // Use html2canvas library (add to dependencies)
  const canvas = await html2canvas(card, {
    backgroundColor: '#000000',
    scale: 2  // retina quality
  });
  const link = document.createElement('a');
  link.download = 'career-portrait.png';
  link.href = canvas.toDataURL('image/png');
  link.click();

  // Track download as a copy event
  copyWithTracking('', 'download_portrait_image', {
    stage: getCurrentStage()
  });
}
```

### Portrait Card Styles

```css
.portrait-card {
  background: #000000;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 36px 40px;
  width: 560px;
  font-family: 'DM Sans', sans-serif;
  color: #f0f0f0;
}

.pc-header {
  font-family: 'DM Mono', monospace;
  font-size: 11px;
  color: #e8a640;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 28px;
}

.pc-identity {
  font-family: 'Cormorant Garamond', serif;
  font-size: 28px;
  font-weight: 300;
  line-height: 1.2;
  color: #ffffff;
  margin-bottom: 20px;
  letter-spacing: -0.01em;
}

.pc-insight {
  font-family: 'Cormorant Garamond', serif;
  font-size: 16px;
  font-style: italic;
  font-weight: 300;
  line-height: 1.6;
  color: #a0a0a0;
  margin-bottom: 28px;
  border-left: 2px solid #e8a640;
  padding-left: 16px;
}

.pc-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 28px;
}

.pc-tag {
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  color: #707070;
  border: 1px solid #252525;
  padding: 4px 10px;
  border-radius: 3px;
  letter-spacing: 0.06em;
}

.pc-footer {
  font-family: 'DM Mono', monospace;
  font-size: 9px;
  color: #404040;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
```

### API Endpoints

```
POST /api/v1/claude/short-bio
Body: { session_id }
Returns: { bio }

-- No endpoint needed for portrait card — generated client-side
-- from existing session data
```

### Database

Store in existing insights JSONB:
```
insights.short_bio: string
insights.short_bio_generated_at: timestamp
-- No schema change required
```

### Copy Events for This Feature

| Action | Event Name | What It Signals |
|---|---|---|
| Copy Short Bio | `copy_short_bio` | Bio earns enough trust to use publicly |
| Copy Portrait Card text | `copy_portrait_card_text` | Identity reframe resonating |
| Download Portrait Image | `download_portrait_image` | Intent to share visually |
| Copy Portrait Link (Phase 2) | `copy_portrait_link` | Distribution intent |

**The most valuable signal:** `download_portrait_image` — this is the user
saying "I am going to share this on a public platform." Higher intent than
a copy event because it requires an extra action.

---

### Why This Matters

Copy count is the minimum viable validation signal for any generated output.
It answers: "Did this earn enough trust that the user wanted to use it?"

A user who copies the LinkedIn summary is telling you:
- The output was good enough to use publicly
- They trust the product's voice to represent them
- The LinkedIn integration is worth building

### What to Track

Every copy action across the product:

| Copy Location | Event Name | What It Signals |
|---|---|---|
| Core Strength insight | `copy_insight` | Insight resonated — shareable |
| LinkedIn Summary | `copy_linkedin_summary` | High-value validation signal |
| Short Bio | `copy_short_bio` | Bio earns trust for public use |
| Career Portrait card (text) | `copy_portrait_card_text` | Identity reframe resonating |
| Career Portrait card (image) | `download_portrait_image` | Intent to share publicly |
| Career Portrait celebration | `copy_portrait` | Emotional resonance |
| Resume projection positioning | `copy_positioning` | Resume use case working |
| Resume projection bullets | `copy_bullets` | Resume use case working |
| Growth path action | `copy_growth_action` | Forward arc resonating |

### Implementation

#### Backend — copy_events table

```sql
CREATE TABLE copy_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  session_id UUID REFERENCES career_sessions(id),
  event_name TEXT NOT NULL,
  metadata JSONB,          -- e.g. { character_count: 847, stage: 'executive' }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_copy_events_user ON copy_events(user_id);
CREATE INDEX idx_copy_events_name ON copy_events(event_name);
CREATE INDEX idx_copy_events_created ON copy_events(created_at);
```

#### API Endpoint

```
POST /api/v1/events/copy
Body: { session_id, event_name, metadata }
Returns: { ok: true }

-- Fire and forget — don't await in the frontend
-- Never block UI on this call
-- Fail silently if it errors
```

#### Frontend — Copy Button Component

Every copy button follows the same pattern:

```javascript
async function copyWithTracking(text, eventName, metadata = {}) {
  // 1. Copy to clipboard
  await navigator.clipboard.writeText(text);

  // 2. Visual feedback — button changes for 1.5s
  showCopied(eventName);  // button text → "✓ Copied"

  // 3. Track — fire and forget, never await
  fetch('/api/v1/events/copy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    body: JSON.stringify({
      session_id: getCurrentSessionId(),
      event_name: eventName,
      metadata: {
        ...metadata,
        stage: getCurrentStage(),
        session_step: getCurrentStep()
      }
    })
  }).catch(() => {});  // silent failure — never interrupt copy action
}
```

Usage in UI:
```javascript
// LinkedIn summary copy button
copyBtn.onclick = () => copyWithTracking(
  summaryText,
  'copy_linkedin_summary',
  { character_count: summaryText.length, has_direction: !!chosenDirection }
);

// Insight regenerate copy button
copyBtn.onclick = () => copyWithTracking(
  insightText,
  'copy_insight',
  { is_regenerated: isRegenerated, regeneration_count: regenCount }
);
```

### Product Dashboard Queries

Once copy events are flowing, these queries tell the story:

```sql
-- LinkedIn summary copy rate (copies / summaries generated)
SELECT
  COUNT(DISTINCT ce.user_id) as users_who_copied,
  COUNT(DISTINCT ug.user_id) as users_who_generated,
  ROUND(100.0 * COUNT(DISTINCT ce.user_id) / NULLIF(COUNT(DISTINCT ug.user_id), 0), 1) as copy_rate_pct
FROM copy_events ce
RIGHT JOIN usage_logs ug ON ug.task_type = 'linkedin_summary'
WHERE ce.event_name = 'copy_linkedin_summary';

-- Copy rate by career stage
SELECT
  metadata->>'stage' as stage,
  event_name,
  COUNT(*) as copies,
  COUNT(DISTINCT user_id) as unique_users
FROM copy_events
GROUP BY stage, event_name
ORDER BY copies DESC;

-- Most copied outputs (tells you which features are earning trust)
SELECT event_name, COUNT(*) as total_copies,
  COUNT(DISTINCT user_id) as unique_users
FROM copy_events
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY event_name
ORDER BY total_copies DESC;
```

---

## Implementation Order

### Day 1 — Copy tracking infrastructure (do this first)
Reason: Once in place, every feature ships already instrumented.

1. Create `copy_events` table
2. `POST /events/copy` endpoint
3. `copyWithTracking()` utility in frontend
4. Add copy buttons to existing outputs (insight, portrait, positioning bullets)

### Day 2 — Regenerate insight
1. Add `previous_insight` column to `career_sessions`
2. `buildInsightRegenerationPrompt()` in assembler
3. `POST /claude/insight/regenerate` endpoint
4. Regenerate button in strength card UI with loading/previous states

### Day 3 — LinkedIn summary + Short bio
1. `buildLinkedInSummaryPrompt()` in assembler with stage calibration
2. `buildShortBioPrompt()` in assembler with stage calibration
3. `POST /claude/linkedin-summary` and `POST /claude/short-bio` endpoints
4. Both output panels in portrait card with character counter where relevant
5. Copy buttons on both (auto-tracked)

### Day 4 — Career portrait card
1. `renderPortraitCard()` component in frontend (no backend needed)
2. Portrait card modal with dark styled card
3. "Copy as Text" button (tracked)
4. "Download Image" button using html2canvas (tracked as download event)
5. Add `html2canvas` to frontend dependencies

### Total: ~4 days of Claude Code sessions

---

## Success Metrics (30 days post-launch)

| Metric | Signal | Target |
|---|---|---|
| LinkedIn summary copy rate | Output earning trust | > 40% of users who generate |
| Short bio copy rate | Bio earns trust for public use | > 35% of users who generate |
| Portrait card download rate | Intent to share publicly | > 20% of users who generate |
| Insight regeneration rate | Enrichment loop working | > 25% of users who complete Q4 |
| Copy events per session | Overall output quality | > 2 copy events per completed session |
| LinkedIn summary → regenerate | First version not landing | < 30% (high = prompt quality issue) |

**Phase 2 triggers:**
- LinkedIn summary copy rate > 40% → begin LinkedIn OAuth integration
- Portrait card download rate > 20% → build hosted shareable portrait URL
- Short bio copy rate > 35% → add platform-specific bio variants
  (Twitter/X 160 chars, conference 50 words, email signature one-liner)
