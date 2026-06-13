# Career OS — Doc 13: Goal Graph, Ghost Nodes & Article-Driven Enrichment

## What This Builds

The forward-looking arc. Three connected features:

1. **Goal Graph** — user sets a target title/role; Claude generates the
   node profile of someone in that role and overlays it against the
   user's existing graph. Gaps appear as ghost nodes.

2. **Goal-Directed Article Suggestions** — the New Article panel
   surfaces article ideas ranked by which ghost nodes they address.
   Each article draft knows which gap it is contributing toward.

3. **Article Publish → Graph Enrichment** — when an article is
   published, Claude evaluates which ghost nodes it addresses and
   either closes them (converts to real nodes) or partially fills
   them. The graph updates. The user sees progress.

Together these complete the product loop described in the vision:
build graph → identify gaps → close gaps publicly → graph updates →
new gaps surface → repeat.

Prerequisites: 12a–12f must be working. Articles table must exist.

---

## Design Decisions

**Ghost nodes live in graph_data, not a separate table.**
The graph is the single source of truth. Ghost nodes are nodes
with `ghost: true` in the existing JSONB structure. No schema
migration needed beyond adding the `ghost` flag and the
`goal_title` field to career_sessions.

**Ghost node type is always one of the existing NodeTypes.**
A ghost node representing "Executive Communication" is type
`skill`, weight `2`. A ghost node for "P&L Ownership" is type
`outcome`, weight `3`. This keeps the graph renderer unchanged —
ghost nodes just render differently (dashed, muted).

**Partial fill, not binary close.**
An article about "building platform teams" partially fills a
"Platform Leadership" ghost node. A second article, or a
mini-interview answer, can fully close it. Progress is a float
`0.0 → 1.0` on the ghost node. At `>= 0.8` the node converts
to real. This avoids false precision from single data points.

**Article suggestions are ranked, not prescribed.**
The system surfaces which ghost nodes an article could address —
it does not force the user to write about specific topics.
The user always chooses. The ranking is visible ("addresses your
Platform Leadership gap") but the blank canvas option remains.

**Ghost node generation is a one-time Claude call per goal.**
Expensive but infrequent. Cached on the session. Re-runs only
if the user explicitly changes their goal title.

---

## Data Model Changes

### Extend Node type

```typescript
// src/assembler/types.ts — extend Node interface

interface Node {
  id: string;
  type: NodeType;
  label: string;
  detail: string;
  year: string | null;
  weight: 1 | 2 | 3;

  // New fields — optional, only on ghost nodes
  ghost?: true;                  // present and true = ghost node
  ghost_progress?: number;       // 0.0–1.0, default 0.0
  ghost_filled_by?: string[];    // article_ids that contributed
  ghost_addressed_by?: string;   // article_id of most recent contribution
}
```

### Extend career_sessions table

```sql
-- migration: 004_goal_graph.sql
-- Show to user before running

ALTER TABLE career_sessions
ADD COLUMN IF NOT EXISTS goal_title TEXT,
ADD COLUMN IF NOT EXISTS goal_graph_generated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS goal_graph_version INTEGER DEFAULT 0;

-- goal_title: the target role/title the user is working toward
-- e.g. "VP of Data", "Principal Engineer", "Head of Product"
-- goal_graph_generated_at: when ghost nodes were last generated
-- goal_graph_version: increments when ghost nodes are regenerated
```

Ghost nodes are stored inside the existing `graph_data` JSONB
column — no new column needed.

---

## Step 1 — Goal Setting UI

### Where It Lives

A new `goal` panel in the workspace nav, under Profile section:

```javascript
// Update NAV_ITEMS in WorkspaceNav.js — add after 'portrait'

{ id: 'goal', icon: '⟶', label: 'Career Goal', color: 'blue' }
```

### Goal Panel

```javascript
// frontend/panels/GoalPanel.js

export async function render(container, session) {
  const hasGoal = !!session.goal_title;
  const ghostNodes = session.graph_data?.nodes?.filter(n => n.ghost) || [];
  const closedCount = ghostNodes.filter(n => (n.ghost_progress || 0) >= 0.8).length;
  const openCount = ghostNodes.length - closedCount;

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Career Goal</div>
    </div>

    ${hasGoal ? `
      <div class="goal-current">
        <div class="goal-title-display">⟶ ${session.goal_title}</div>
        <button onclick="changeGoal()" class="action-btn muted">Change</button>
      </div>

      <div class="goal-progress">
        <div class="goal-progress-label">
          ${closedCount} of ${ghostNodes.length} gaps closed
        </div>
        <div class="goal-progress-bar">
          <div class="goal-progress-fill"
               style="width: ${ghostNodes.length
                 ? Math.round((closedCount / ghostNodes.length) * 100)
                 : 0}%">
          </div>
        </div>
      </div>

      <div class="ghost-node-list">
        <div class="ghost-list-header">Open gaps</div>
        ${ghostNodes
          .filter(n => (n.ghost_progress || 0) < 0.8)
          .sort((a, b) => b.weight - a.weight)
          .map(renderGhostNodeRow)
          .join('')}

        ${closedCount > 0 ? `
          <div class="ghost-list-header" style="margin-top:20px">Closed gaps</div>
          ${ghostNodes
            .filter(n => (n.ghost_progress || 0) >= 0.8)
            .map(renderClosedGhostNodeRow)
            .join('')}
        ` : ''}
      </div>
    ` : `
      <div class="goal-empty">
        <div class="goal-empty-title">Where are you headed?</div>
        <div class="goal-empty-desc">
          Set a target role. Career OS will show you exactly what
          gaps stand between where you are and where you want to be —
          and help you close them through your writing and work.
        </div>
        <div class="goal-input-row">
          <input
            id="goalTitleInput"
            class="goal-input"
            placeholder="e.g. VP of Data, Principal Engineer, Head of Product"
          />
          <button onclick="setGoal()" class="action-btn primary">
            Show my gaps →
          </button>
        </div>
      </div>
    `}
  `;
}

function renderGhostNodeRow(node) {
  const pct = Math.round((node.ghost_progress || 0) * 100);
  return `
    <div class="ghost-node-row">
      <div class="ghost-node-type-badge ${node.type}">${node.type}</div>
      <div class="ghost-node-body">
        <div class="ghost-node-label">${node.label}</div>
        <div class="ghost-node-detail">${node.detail}</div>
        ${pct > 0 ? `
          <div class="ghost-progress-bar">
            <div class="ghost-progress-fill" style="width:${pct}%"></div>
            <span class="ghost-progress-pct">${pct}%</span>
          </div>
        ` : ''}
      </div>
      <button
        onclick="writeForGap('${node.id}')"
        class="ghost-node-write-btn"
        title="Write an article to close this gap">
        ✦ Write
      </button>
    </div>
  `;
}

function renderClosedGhostNodeRow(node) {
  return `
    <div class="ghost-node-row closed">
      <div class="ghost-node-type-badge ${node.type}">${node.type}</div>
      <div class="ghost-node-body">
        <div class="ghost-node-label">${node.label} ✓</div>
        <div class="ghost-node-detail muted">
          Closed by ${node.ghost_filled_by?.length || 1} article(s)
        </div>
      </div>
    </div>
  `;
}
```

---

## Step 2 — Goal Graph Generation

### Frontend

```javascript
// frontend/panels/GoalPanel.js

async function setGoal() {
  const titleInput = document.getElementById('goalTitleInput');
  const goalTitle = titleInput.value.trim();
  if (!goalTitle) return;

  titleInput.disabled = true;
  document.querySelector('.action-btn.primary').textContent = 'Mapping gaps…';
  document.querySelector('.action-btn.primary').disabled = true;

  try {
    const result = await fetch('/api/v1/claude/goal-graph', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: currentSessionId,
        goal_title: goalTitle
      })
    }).then(r => r.json());

    // Reload session to get updated graph with ghost nodes
    currentSession = await fetchBackend(`sessions/${currentSessionId}`);
    render(document.getElementById('mainPanel'), currentSession);

    // Refresh graph view if open
    if (document.getElementById('graphContainer')?.style.display !== 'none') {
      renderGraph(currentSession.graph_data);
    }

  } catch (e) {
    titleInput.disabled = false;
    showToast('Could not generate goal graph — try again');
  }
}

async function changeGoal() {
  if (!confirm('This will replace your current goal and ghost nodes. Continue?')) return;

  // Remove all ghost nodes from graph locally
  // Backend regenerates on next goal-graph call
  await fetch(`/api/v1/sessions/${currentSessionId}/goal`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });

  currentSession.goal_title = null;
  render(document.getElementById('mainPanel'), currentSession);
}

// Called from ghost node "Write" button
function writeForGap(ghostNodeId) {
  // Navigate to New Article with ghost node pre-selected
  navigateTo('articles');
  // Small delay for panel to render, then open new article
  setTimeout(() => openNewArticle(ghostNodeId), 100);
}
```

### Backend Route

```typescript
// src/routes/claude.ts — add

router.post('/claude/goal-graph', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id, goal_title } = req.body;

  if (!goal_title || goal_title.length > 100) {
    return res.status(400).json({ error: 'Invalid goal_title' });
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  // Generate ghost nodes
  const ghostNodes = await generateGoalGhostNodes(session, goal_title);

  // Remove existing ghost nodes from graph, add new ones
  const graph = session.graph_data || { nodes: [], edges: [] };
  graph.nodes = graph.nodes.filter(n => !n.ghost);
  graph.nodes.push(...ghostNodes);

  // Add edges connecting ghost nodes to nearest real nodes
  const ghostEdges = buildGhostEdges(ghostNodes, graph.nodes);
  graph.edges = graph.edges.filter(e => !e.ghost);
  graph.edges.push(...ghostEdges);

  await db.query(`
    UPDATE career_sessions
    SET goal_title = $1,
        goal_graph_generated_at = NOW(),
        goal_graph_version = COALESCE(goal_graph_version, 0) + 1,
        graph_data = $2,
        summary_version = summary_version + 1,
        updated_at = NOW()
    WHERE id = $3 AND user_id = $4
  `, [goal_title, JSON.stringify(graph), session_id, userId]);

  await logCopyEvent(userId, session_id, 'goal_graph_generated', {
    goal_title,
    ghost_node_count: ghostNodes.length
  });

  res.json({
    goal_title,
    ghost_nodes: ghostNodes,
    ghost_node_count: ghostNodes.length
  });
});

// Delete goal — clears ghost nodes
router.delete('/sessions/:id/goal', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const session = await validateSessionOwnership(req.params.id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const graph = session.graph_data || { nodes: [], edges: [] };
  graph.nodes = graph.nodes.filter(n => !n.ghost);
  graph.edges = graph.edges.filter(e => !e.ghost);

  await db.query(`
    UPDATE career_sessions
    SET goal_title = NULL,
        goal_graph_generated_at = NULL,
        graph_data = $1,
        updated_at = NOW()
    WHERE id = $2 AND user_id = $3
  `, [JSON.stringify(graph), req.params.id, userId]);

  res.json({ ok: true });
});
```

### Ghost Node Generation (Assembler Task)

```typescript
// src/assembler/tasks/goalGraph.ts

export async function generateGoalGhostNodes(
  session: CareerSession,
  goalTitle: string
): Promise<Node[]> {

  const existingLabels = session.graph_data?.nodes
    ?.filter(n => !n.ghost)
    ?.map(n => n.label)
    ?.join(', ') || '';

  const stageProfile = detectStageProfile(session.graph_data);
  const careerSummary = session.career_summary || '';

  const prompt = `You are mapping the gap between a professional's current career graph
and their target role.

Current career summary:
${careerSummary}

Existing node labels (do not create ghost nodes for these):
${existingLabels}

Target role: "${goalTitle}"

Generate 4-7 ghost nodes representing the gaps — the experiences, skills,
outcomes, or decisions this person needs to develop to reach their goal.

Rules:
- Only generate gaps that are GENUINELY ABSENT from the existing node list
- Ghost nodes should be SPECIFIC and ACHIEVABLE — not generic ("leadership skills")
- Each gap should be closable through work, writing, or structured experience
- Weight 3 = critical gap (blocks the role), Weight 2 = important gap, Weight 1 = nice to have
- Balance node types — include skills, outcomes, and at least one decision

Return ONLY valid JSON array:
[{
  "id": "ghost_snake_case_id",
  "type": "skill|project|outcome|decision|role",
  "label": "2-4 words",
  "detail": "one sentence — what this gap represents and why it matters for the target role",
  "year": null,
  "weight": 1|2|3,
  "ghost": true,
  "ghost_progress": 0.0
}]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0]?.text?.trim() || '';
  const cleaned = text.replace(/^```json\n?|```$/g, '').trim();
  return JSON.parse(cleaned);
}

export function buildGhostEdges(
  ghostNodes: Node[],
  realNodes: Node[]
): Edge[] {
  // Connect each ghost node to the most relevant real node
  // by simple label similarity — lightweight, no Claude call
  const edges: Edge[] = [];
  const highWeightReal = realNodes
    .filter(n => !n.ghost && n.weight >= 2)
    .slice(0, 10);

  ghostNodes.forEach(ghost => {
    // Find real node with most label word overlap
    let bestMatch = highWeightReal[0];
    let bestScore = 0;

    const ghostWords = new Set(ghost.label.toLowerCase().split(/\s+/));

    highWeightReal.forEach(real => {
      const realWords = new Set(real.label.toLowerCase().split(/\s+/));
      const overlap = [...ghostWords].filter(w => realWords.has(w)).length;
      if (overlap > bestScore) {
        bestScore = overlap;
        bestMatch = real;
      }
    });

    if (bestMatch) {
      edges.push({
        source: bestMatch.id,
        target: ghost.id,
        relation: 'LED_TO',
        ghost: true  // mark edge as ghost too
      } as Edge & { ghost: boolean });
    }
  });

  return edges;
}
```

---

## Step 3 — Goal-Directed Article Suggestions

When a user opens New Article (or clicks "Write" from a ghost node),
the content ideas are ranked by ghost node relevance.

### Update New Article Panel (12d)

```javascript
// frontend/panels/ArticlesPanel.js — update openNewArticle()

async function openNewArticle(targetGhostNodeId = null) {
  const mainPanel = document.getElementById('mainPanel');

  // Load content ideas — now ghost-node-aware
  const { ideas, ghost_nodes } = await fetch(
    `/api/v1/claude/content-ideas`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: currentSessionId,
        target_ghost_node_id: targetGhostNodeId  // NEW — pre-rank for this gap
      })
    }
  ).then(r => r.json());

  mainPanel.innerHTML = `
    <div class="panel-header">
      <button onclick="navigateTo('articles')" class="back-btn">← Articles</button>
    </div>

    <div class="new-article-panel">
      <div class="new-article-title">New Article</div>

      ${targetGhostNodeId ? `
        <div class="goal-article-banner">
          <span class="goal-article-gap-label">
            Addressing gap: <strong>${
              ghost_nodes?.find(n => n.id === targetGhostNodeId)?.label || ''
            }</strong>
          </span>
        </div>
      ` : ''}

      <div class="new-article-subtitle">
        What's on your mind? Career OS will develop it into a draft
        in your voice — and connect it to your career graph.
      </div>

      <textarea
        id="articleThoughts"
        class="thoughts-input"
        placeholder="e.g. I've been thinking about why most analytics teams implement agentic workflows in completely the wrong order..."
        rows="5"
      ></textarea>

      ${ideas?.length > 0 ? `
        <div class="ideas-section">
          <div class="ideas-label">
            ${targetGhostNodeId ? 'Ideas for this gap' : 'Or start from one of these'}
          </div>
          ${ideas.map(idea => `
            <div class="idea-card ${idea.ghost_node_id ? 'goal-linked' : ''}"
                 onclick="selectIdea('${idea.text.replace(/'/g, "\\'")}')">
              <div class="idea-text">${idea.text}</div>
              ${idea.ghost_node_id ? `
                <div class="idea-gap-tag">
                  ⟶ ${idea.ghost_node_label}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}

      <button
        onclick="developArticle()"
        class="action-btn primary"
        style="margin-top:20px">
        Develop this →
      </button>
    </div>
  `;
}
```

### Update Content Ideas Endpoint

```typescript
// src/routes/claude.ts — update existing content-ideas handler

router.post('/claude/content-ideas', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id, target_ghost_node_id } = req.body;

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  // Check cache — skip if generated in last 24h and no ghost node target
  if (!target_ghost_node_id &&
      session.content_ideas_generated_at &&
      Date.now() - new Date(session.content_ideas_generated_at).getTime() < 86400000) {
    return res.json({
      ideas: session.content_ideas,
      ghost_nodes: session.graph_data?.nodes?.filter(n => n.ghost) || []
    });
  }

  const ghostNodes = session.graph_data?.nodes?.filter(n => n.ghost) || [];
  const targetGhost = target_ghost_node_id
    ? ghostNodes.find(n => n.id === target_ghost_node_id)
    : null;

  const ideas = await generateContentIdeas(session, ghostNodes, targetGhost);

  // Cache ideas
  await db.query(`
    UPDATE career_sessions
    SET content_ideas = $1,
        content_ideas_generated_at = NOW()
    WHERE id = $2
  `, [JSON.stringify(ideas), session_id]);

  res.json({ ideas, ghost_nodes: ghostNodes });
});
```

### Content Ideas Prompt (update existing)

```typescript
// src/assembler/tasks/contentIdeas.ts — update or create

export async function generateContentIdeas(
  session: CareerSession,
  ghostNodes: Node[],
  targetGhost: Node | null
): Promise<ContentIdea[]> {

  const w3Nodes = session.graph_data?.nodes
    ?.filter(n => !n.ghost && n.weight === 3)
    ?.map(n => n.label) || [];

  const openGhosts = ghostNodes
    .filter(n => (n.ghost_progress || 0) < 0.8)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const focusInstruction = targetGhost
    ? `PRIORITY: Generate ideas that directly address this gap: "${targetGhost.label}" — ${targetGhost.detail}`
    : `Generate ideas ranked by which open gaps they address.`;

  const prompt = `You are helping a professional decide what to write next.
Their writing serves two purposes: building their personal brand AND
closing specific gaps toward their career goal.

Their defining experiences: ${w3Nodes.join(', ')}
Career goal: ${session.goal_title || 'not set'}

Open gaps (ghost nodes):
${openGhosts.map(n => `- ${n.label} (weight: ${n.weight}): ${n.detail}`).join('\n')}

${focusInstruction}

Generate 4 article ideas. Each idea should:
- Be grounded in their actual experience (not generic advice)
- Have a non-obvious angle — not "lessons from X" or "why Y matters"
- Be something they can write from direct experience
- Ideally address one of their open gaps

Return ONLY valid JSON:
[{
  "text": "one sentence describing the article angle",
  "ghost_node_id": "id of the ghost node this addresses, or null",
  "ghost_node_label": "label of that ghost node, or null"
}]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0]?.text?.trim() || '';
  const cleaned = text.replace(/^```json\n?|```$/g, '').trim();
  return JSON.parse(cleaned);
}

interface ContentIdea {
  text: string;
  ghost_node_id: string | null;
  ghost_node_label: string | null;
}
```

---

## Step 4 — Article Draft Knows Its Gap

Pass the target ghost node into the article draft generation
so Claude explicitly writes toward the gap.

```typescript
// src/assembler/tasks/articleDraft.ts — update buildArticleDraftPrompt()

// Add to function signature:
export function buildArticleDraftPrompt(
  session: CareerSession,
  userThoughts: string,
  stageProfile: StageProfile,
  voiceProfile?: VoiceProfile,
  targetGhostNode?: Node   // NEW
): PromptPackage {

  // Add to system prompt:
  const gapInstruction = targetGhostNode
    ? `
GAP CONTEXT: This article should demonstrate or develop the capability:
"${targetGhostNode.label}" — ${targetGhostNode.detail}
Do not mention this explicitly. The article should embody it through
the story it tells and the perspective it takes.`
    : '';

  // Inject into system prompt after voice context
}
```

### Update article creation endpoint to accept ghost node

```typescript
// src/routes/claude.ts — update /claude/article-draft

router.post('/claude/article-draft', requireAuth, async (req, res) => {
  const { session_id, thoughts, target_ghost_node_id } = req.body;  // add field
  // ...
  // Look up target ghost node and pass to prompt builder
  const targetGhostNode = target_ghost_node_id
    ? session.graph_data?.nodes?.find(n => n.id === target_ghost_node_id)
    : undefined;

  // Store on article record
  await db.query(`
    INSERT INTO articles (user_id, session_id, title, theme,
      generated_draft, current_content, target_ghost_node_id)  -- add column
    VALUES ($1, $2, $3, $4, $5, $5, $6)
    RETURNING id
  `, [userId, session_id, title, thoughts, draft, target_ghost_node_id || null]);
});
```

```sql
-- Add to 004_goal_graph.sql migration

ALTER TABLE articles
ADD COLUMN IF NOT EXISTS target_ghost_node_id TEXT;
-- stores the ghost node id this article was written to address
```

---

## Step 5 — Publish → Graph Enrichment

This is the core of the forward arc. When an article is published,
Claude evaluates which ghost nodes it addresses and updates
their progress. At >= 0.8, ghost nodes convert to real.

### Update Publish Endpoint

```typescript
// src/routes/claude.ts — update /articles/:id/publish

router.post('/articles/:id/publish', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id, platform, published_url } = req.body;

  const article = await db.query(
    'SELECT * FROM articles WHERE id = $1 AND user_id = $2',
    [req.params.id, userId]
  );
  if (!article.rows[0]) return res.status(404).json({ error: 'Not found' });

  const a = article.rows[0];

  // Update article status (existing logic)
  await db.query(`
    UPDATE articles
    SET status = 'published',
        published_content = current_content,
        published_at = NOW(),
        platform = $1,
        published_url = $2,
        updated_at = NOW()
    WHERE id = $3
  `, [platform, published_url, a.id]);

  // Get session for graph enrichment
  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const graph = session.graph_data || { nodes: [], edges: [] };
  const ghostNodes = graph.nodes.filter(n => n.ghost);

  let enrichmentResult = null;

  if (ghostNodes.length > 0) {
    // Evaluate article against ghost nodes — async but we wait for it
    // because we need to return which nodes were affected
    enrichmentResult = await evaluateArticleAgainstGhostNodes(
      a.current_content,
      a.title,
      ghostNodes,
      a.target_ghost_node_id
    );

    // Apply progress updates
    let nodesConverted = 0;
    enrichmentResult.updates.forEach(update => {
      const node = graph.nodes.find(n => n.id === update.ghost_node_id);
      if (!node || !node.ghost) return;

      const newProgress = Math.min(1.0,
        (node.ghost_progress || 0) + update.progress_delta
      );
      node.ghost_progress = newProgress;
      node.ghost_filled_by = [
        ...(node.ghost_filled_by || []),
        a.id
      ];
      node.ghost_addressed_by = a.id;

      // Convert to real node if progress >= 0.8
      if (newProgress >= 0.8) {
        delete node.ghost;
        delete node.ghost_progress;
        node.year = new Date().getFullYear().toString();
        nodesConverted++;
      }
    });

    // Also add publication node (existing logic from 12e)
    const pubNode = {
      id: `pub_${Date.now()}`,
      type: 'publication',
      label: a.title?.slice(0, 35) || 'Article',
      detail: `Published ${platform} article. ${a.current_content?.slice(0, 100)}…`,
      year: new Date().getFullYear().toString(),
      weight: 2,
      url: published_url || null
    };
    graph.nodes.push(pubNode);

    // Save updated graph
    await db.query(`
      UPDATE career_sessions
      SET graph_data = $1,
          summary_version = summary_version + 1,
          updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify(graph), session_id]);

    // Track
    await logCopyEvent(userId, session_id, 'article_published', {
      article_id: a.id,
      platform,
      word_count: a.word_count,
      edit_similarity: a.edit_similarity,
      ghost_nodes_updated: enrichmentResult.updates.length,
      ghost_nodes_converted: nodesConverted
    });
  }

  res.json({
    ok: true,
    word_count: a.word_count,
    edit_similarity: a.edit_similarity,
    graph_enrichment: enrichmentResult
      ? {
          nodes_updated: enrichmentResult.updates,
          toast_message: buildEnrichmentToast(enrichmentResult.updates, graph)
        }
      : null
  });
});
```

### Graph Enrichment Evaluator

```typescript
// src/assembler/tasks/articleEnrichment.ts

interface EnrichmentUpdate {
  ghost_node_id: string;
  ghost_node_label: string;
  progress_delta: number;   // how much to add to ghost_progress
  reasoning: string;        // one sentence — why this article addresses this gap
}

interface EnrichmentResult {
  updates: EnrichmentUpdate[];
}

export async function evaluateArticleAgainstGhostNodes(
  articleContent: string,
  articleTitle: string,
  ghostNodes: Node[],
  targetGhostNodeId: string | null
): Promise<EnrichmentResult> {

  const openGhosts = ghostNodes
    .filter(n => (n.ghost_progress || 0) < 0.8)
    .slice(0, 8); // limit for token budget

  const prompt = `You are evaluating how much an article closes specific career gaps.

Article title: "${articleTitle}"
Article excerpt (first 600 words):
"""
${articleContent.slice(0, 2400)}
"""

Open career gaps (ghost nodes):
${openGhosts.map(n =>
  `- ID: ${n.id} | ${n.label} (${n.type}): ${n.detail}`
).join('\n')}

${targetGhostNodeId
  ? `NOTE: This article was intentionally written to address gap: ${targetGhostNodeId}`
  : ''}

For each ghost node the article MEANINGFULLY addresses, return an update.
Only include gaps where the article genuinely demonstrates or develops
the capability — not superficial mention.

Progress scale:
- 0.4 = article clearly demonstrates this capability
- 0.3 = article partially demonstrates this capability
- 0.2 = article touches on this but doesn't fully demonstrate it
- 0.0 = not addressed (omit from results)

Return ONLY valid JSON (empty array if no gaps addressed):
[{
  "ghost_node_id": "id from the list above",
  "ghost_node_label": "label from the list above",
  "progress_delta": 0.2|0.3|0.4,
  "reasoning": "one sentence — specifically how this article addresses this gap"
}]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0]?.text?.trim() || '';
  const cleaned = text.replace(/^```json\n?|```$/g, '').trim();

  try {
    const updates = JSON.parse(cleaned);
    return { updates: Array.isArray(updates) ? updates : [] };
  } catch {
    return { updates: [] };
  }
}

function buildEnrichmentToast(
  updates: EnrichmentUpdate[],
  graph: CareerGraph
): string {
  if (updates.length === 0) return 'Published ✓ — added to your career graph';

  const converted = updates.filter(u => {
    const node = graph.nodes.find(n => n.id === u.ghost_node_id);
    return node && !node.ghost; // already converted
  });

  if (converted.length > 0) {
    return `Published ✓ — "${converted[0].ghost_node_label}" gap closed`;
  }

  return `Published ✓ — ${updates[0].ghost_node_label} gap progressed`;
}
```

---

## Step 6 — Frontend: Show Enrichment After Publish

```javascript
// frontend/panels/ArticlesPanel.js — update markAsPublished()

async function markAsPublished(articleId, platform = 'linkedin') {
  const publishedUrl = prompt(
    'Optional: paste the published URL to track it', ''
  );

  const result = await fetch(`/api/v1/articles/${articleId}/publish`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      session_id: currentSessionId,
      platform,
      published_url: publishedUrl || null
    })
  }).then(r => r.json());

  // Show enrichment result if any gaps were affected
  if (result.graph_enrichment?.nodes_updated?.length > 0) {
    showEnrichmentModal(result.graph_enrichment);
  } else {
    showToast(result.graph_enrichment?.toast_message || 'Published ✓');
  }

  // Reload session to reflect updated graph
  currentSession = await fetchBackend(`sessions/${currentSessionId}`);

  navigateTo('articles');
}

function showEnrichmentModal(enrichment) {
  const modal = document.createElement('div');
  modal.className = 'enrichment-modal';
  modal.innerHTML = `
    <div class="enrichment-modal-body">
      <div class="enrichment-modal-title">
        ◆ Your graph just got richer
      </div>
      <div class="enrichment-modal-subtitle">
        This article advanced your progress toward your goal:
      </div>
      <div class="enrichment-updates">
        ${enrichment.nodes_updated.map(u => `
          <div class="enrichment-update-row">
            <div class="enrichment-update-label">${u.ghost_node_label}</div>
            <div class="enrichment-update-reason">${u.reasoning}</div>
            <div class="enrichment-update-delta">
              +${Math.round(u.progress_delta * 100)}% toward closing
            </div>
          </div>
        `).join('')}
      </div>
      <button onclick="this.closest('.enrichment-modal').remove(); navigateTo('goal')"
              class="action-btn primary">
        View my progress →
      </button>
      <button onclick="this.closest('.enrichment-modal').remove()"
              class="action-btn muted" style="margin-left:8px">
        Dismiss
      </button>
    </div>
  `;
  document.body.appendChild(modal);
}
```

---

## Step 7 — Graph Renderer: Ghost Node Styling

Ghost nodes already render with dashed borders in the frontend
demo (06-frontend-status.md confirms this). Update the renderer
to also show progress fill.

```javascript
// In renderGraph() — update ghost node rendering

// Existing ghost check (dashed border + pink color) stays
// Add progress arc for ghost nodes with progress > 0

nodes.forEach(n => {
  if (!n.ghost) return;
  if (!n.ghost_progress || n.ghost_progress < 0.05) return;

  // Draw a partial arc around the ghost node showing fill progress
  const angle = n.ghost_progress * 2 * Math.PI;
  const x2 = n.x + n.r * Math.sin(angle);
  const y2 = n.y - n.r * Math.cos(angle);
  const largeArc = angle > Math.PI ? 1 : 0;

  const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arc.setAttribute('d',
    `M ${n.x} ${n.y - n.r} A ${n.r} ${n.r} 0 ${largeArc} 1 ${x2} ${y2}`
  );
  arc.setAttribute('stroke', 'var(--gold)');
  arc.setAttribute('stroke-width', '2');
  arc.setAttribute('fill', 'none');
  arc.setAttribute('opacity', '0.6');
  svg.appendChild(arc);
});
```

---

## Copy Tracking Events

| Action | Event Name | Metadata |
|---|---|---|
| Goal set | `goal_graph_generated` | `goal_title`, `ghost_node_count` |
| Goal cleared | `goal_cleared` | — |
| Write-for-gap clicked | `write_for_gap_clicked` | `ghost_node_id`, `ghost_node_label` |
| Article drafted for gap | `article_draft_for_gap` | `ghost_node_id`, `target_ghost_node_label` |
| Article published → gap updated | `ghost_node_progress_updated` | `ghost_node_id`, `progress_delta`, `new_progress` |
| Ghost node converted to real | `ghost_node_converted` | `ghost_node_id`, `ghost_node_label`, `filled_by_count` |

---

## Hard Rules

- Ghost nodes are stored in `graph_data` JSONB — never a separate table
- `user_id` always from verified JWT
- Ghost node generation is always shown to user before running
  (UI shows "Mapping gaps…" state, not silent background job)
- Enrichment evaluation never blocks publish — if Claude call fails,
  article is still published, enrichment skipped silently
- Progress is additive and capped at 1.0 — never decrements
- Ghost node → real node conversion is irreversible from this endpoint
- Existing graph renderer ghost node styling (dashed, pink, pulsing)
  is preserved — we add progress arc on top, not instead of

---

## Done Signal

This session is complete when:

1. SQL migration 004 runs cleanly, goal_title and target_ghost_node_id columns exist
2. Goal panel renders in workspace nav, empty state shows input
3. Entering a goal title and clicking "Show my gaps →" generates 4-7 ghost nodes
4. Ghost nodes appear in the graph with dashed borders (existing style)
5. Goal panel shows open gaps list with weight-ordered ghost nodes
6. Ghost nodes with progress > 0 show a partial gold arc in the graph
7. Clicking "✦ Write" on a ghost node navigates to New Article pre-targeted at that gap
8. Content ideas show gap tags when they address a ghost node
9. Article draft generation receives and uses the target ghost node context
10. Publishing an article triggers ghost node evaluation (check backend logs)
11. Ghost nodes with progress >= 0.8 convert to real nodes (solid, no dashed border)
12. Enrichment modal appears after publish when gaps were affected
13. "View my progress →" from modal navigates to Goal panel showing updated progress
14. All events tracked in copy_events table

Do not consider this complete until items 10–13 are verified with a real
publish flow end-to-end.
