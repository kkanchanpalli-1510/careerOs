# Career OS — Doc 12c: Node Enrichment Nudges

## What This Builds

The node enrichment nudge system — the feature that onboards
users to interactive graph features while gathering the signal
that makes every output better.

Prerequisite: 12a workspace shell is built and working.
12b does not need to be complete before starting this.

---

## Context

Read career-os-docs/12-career-workspace.md Feature 5 for
full design rationale. This is the build spec.

Two purposes simultaneously:
1. Richer graph → better outputs
2. Onboards users to the interactive graph mechanic

The nudge is the product's handshake with the graph layer.

---

## Step 1 — Scoring Functions (build and unit test first)

Location: `src/lib/nodeEnrichment.ts`

**Build these as pure functions with no dependencies.
Unit test before wiring to any route.**

```typescript
// src/lib/nodeEnrichment.ts

export function isNodeSparse(node: Node): boolean {
  const detailIsThin = !node.detail ||
    node.detail.length < 20 ||
    node.detail.toLowerCase().includes(
      node.label.toLowerCase().split(' ')[0]
    );
  const missingYear = !node.year && node.weight >= 2;
  return detailIsThin || missingYear;
}

export function getRecencyScore(node: Node): number {
  if (!node.year) return 0.5;
  const year = parseInt(node.year.split('-').pop() || '0');
  const age = new Date().getFullYear() - year;
  // 0-2 years: full weight
  if (age <= 2) return 1.0;
  // 3-5 years: strong weight
  if (age <= 5) return 0.7;
  // 6-10 years: moderate
  if (age <= 10) return 0.4;
  // 10+: low but not zero
  return 0.2;
}

export function calculateNodeCentrality(
  nodeId: string,
  edges: Edge[]
): number {
  return edges.filter(e =>
    e.source === nodeId || e.target === nodeId
  ).length;
}

export function scoreNodeForEnrichment(
  node: Node,
  edges: Edge[],
  enrichedNodeIds: string[]
): number {
  // Never re-nudge enriched nodes
  if (enrichedNodeIds.includes(node.id)) return 0;
  // Never nudge if not sparse
  if (!isNodeSparse(node)) return 0;
  // Never nudge weight-1 supporting nodes
  if (node.weight === 1) return 0;

  const centrality = calculateNodeCentrality(node.id, edges);
  const recency = getRecencyScore(node);
  const weight = node.weight;

  // Centrality (0.45): hub nodes ripple through entire graph
  // Weight (0.35): career-defining nodes appear in every output
  // Recency (0.20): tiebreaker — prefer current experience
  return (centrality * 0.45) + (weight * 0.35) + (recency * 0.20);
}

export function selectNextNudge(
  graph: CareerGraph,
  enrichedNodeIds: string[]
): Node | null {
  const scored = graph.nodes
    .map(node => ({
      node,
      score: scoreNodeForEnrichment(node, graph.edges, enrichedNodeIds)
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.node || null;
}

export function getConnectedNodes(
  nodeId: string,
  graph: CareerGraph
): Node[] {
  const connectedIds = graph.edges
    .filter(e => e.source === nodeId || e.target === nodeId)
    .map(e => e.source === nodeId ? e.target : e.source);

  return graph.nodes
    .filter(n => connectedIds.includes(n.id))
    .sort((a, b) => b.weight - a.weight);
}
```

**Unit tests to run before wiring:**

```typescript
// Test 1: weight-1 nodes never score
const weight1Node = { id: 'a', weight: 1, type: 'skill',
  label: 'Python', detail: '' };
assert(scoreNodeForEnrichment(weight1Node, [], []) === 0);

// Test 2: enriched nodes never score
const enrichedNode = { id: 'b', weight: 3, type: 'role',
  label: 'PLG Architecture', detail: '' };
assert(scoreNodeForEnrichment(enrichedNode, [], ['b']) === 0);

// Test 3: non-sparse nodes never score
const richNode = { id: 'c', weight: 3, type: 'project',
  label: 'Event Schema', detail: 'Built unified event schema that replaced fragmented log pipelines and enabled $100M PLG motion', year: '2022' };
assert(scoreNodeForEnrichment(richNode, [], []) === 0);

// Test 4: central recent node scores highest
const centralRecent = { id: 'd', weight: 3, type: 'project',
  label: 'PLG Architecture', detail: 'PLG', year: '2023' };
const edges = Array(8).fill(null).map((_, i) =>
  ({ source: 'd', target: `node${i}` }));
const score = scoreNodeForEnrichment(centralRecent, edges, []);
assert(score > 4.0); // (8*0.45) + (3*0.35) + (0.7*0.20) = 4.79
console.log('All unit tests pass');
```

Show unit test results before proceeding to Step 2.

---

## Step 2 — Reason Builder (pure function, no Claude)

```typescript
// Add to src/lib/nodeEnrichment.ts

export interface NudgeReason {
  nodeLabel: string;
  centralitySentence: string;
  recencySentence: string;
  sparsitySentence: string;
  impacts: string[];
  connectionCount: number;
  notableConnections: string[];
}

export function buildNudgeReason(
  node: Node,
  graph: CareerGraph,
  session: CareerSession
): NudgeReason {

  const connectedNodes = getConnectedNodes(node.id, graph);
  const connectedIds = connectedNodes.map(n => n.id);
  const notableConnections = connectedNodes
    .filter(n => n.weight >= 2)
    .slice(0, 3)
    .map(n => n.label);

  // Part 1 — Centrality
  const centralitySentence = notableConnections.length > 0
    ? `This experience connects to ${connectedIds.length} other nodes in your graph — including ${notableConnections.join(', ')}.`
    : `This experience is referenced by ${connectedIds.length} other nodes in your graph.`;

  // Part 2 — Recency + weight context
  const recencyScore = getRecencyScore(node);
  const recencySentence = recencyScore >= 0.7
    ? `It's recent work (${node.year}) — highly relevant to where you're headed.`
    : recencyScore >= 0.4
    ? `It's from ${node.year} — still central to your current capability set.`
    : `Though from ${node.year || 'earlier in your career'}, it's foundational to your current pattern.`;

  // Part 3 — What's missing
  const sparsitySentence = node.detail && node.detail.length > 10
    ? `We only have one line about what you actually built here.`
    : `We have the label but no detail about what this involved.`;

  // Impact list — what outputs improve
  const impacts = buildImpactList(node, session, connectedIds.length);

  return {
    nodeLabel: node.label,
    centralitySentence,
    recencySentence,
    sparsitySentence,
    impacts,
    connectionCount: connectedIds.length,
    notableConnections
  };
}

function buildImpactList(
  node: Node,
  session: CareerSession,
  centrality: number
): string[] {
  const impacts: string[] = [];
  const summary = session.insights?.linkedin_summary || '';
  const direction = session.insights?.branches?.[
    session.selected_branch ?? 0
  ];

  if (summary.toLowerCase().includes(node.label.toLowerCase())) {
    impacts.push('Your LinkedIn summary becomes more specific');
  }
  if (direction) {
    impacts.push(`Your "${direction.title}" direction gets stronger evidence`);
  }
  if (node.weight === 3) {
    impacts.push('Your career portrait gains a concrete example');
  }
  if (centrality >= 5) {
    impacts.push('Your core strength insight becomes more grounded');
  }

  return impacts.slice(0, 3);
}
```

---

## Step 3 — API Endpoints

### GET /sessions/:id/next-nudge

Returns the node and pre-computed reason. Question is null —
generated separately when panel opens.

```typescript
// src/routes/sessions.ts — add to existing router

router.get('/sessions/:id/next-nudge', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const session = await validateSessionOwnership(req.params.id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  // Session 1 rule — no nudges on first session
  const isFirstSession = !session.insights?.strength;
  if (isFirstSession) return res.json({ nudge: null });

  const enrichedNodeIds = session.enriched_node_ids || [];
  const nextNode = selectNextNudge(session.graph_data, enrichedNodeIds);

  if (!nextNode) return res.json({ nudge: null });

  const reason = buildNudgeReason(nextNode, session.graph_data, session);

  res.json({
    nudge: {
      node: nextNode,
      reason,
      question: null,  // null = load separately when panel opens
      score: scoreNodeForEnrichment(
        nextNode, session.graph_data.edges, enrichedNodeIds
      )
    }
  });
});
```

### POST /sessions/:id/nudge-question

Called when the panel opens. Generates the Claude question.
~1 second response time.

```typescript
router.post('/sessions/:id/nudge-question', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { node_id } = req.body;
  const session = await validateSessionOwnership(req.params.id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const node = session.graph_data?.nodes.find(
    (n: Node) => n.id === node_id
  );
  if (!node) return res.status(404).json({ error: 'Node not found' });

  const connectedNodes = getConnectedNodes(node_id, session.graph_data);
  const reason = buildNudgeReason(node, session.graph_data, session);
  const stageProfile = detectStageProfile(session.graph_data);

  const promptPackage = buildNodeEnrichmentPrompt(
    node, connectedNodes, reason, stageProfile
  );

  const question = await callClaude(promptPackage, 150);
  res.json({ question });
});
```

### POST /sessions/:id/enrich-node

```typescript
router.post('/sessions/:id/enrich-node', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { node_id, detail, year } = req.body;
  const session = await validateSessionOwnership(req.params.id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  // Update node in graph_data
  const graph = session.graph_data;
  const nodeIdx = graph.nodes.findIndex((n: Node) => n.id === node_id);
  if (nodeIdx === -1) return res.status(404).json({ error: 'Node not found' });

  graph.nodes[nodeIdx] = {
    ...graph.nodes[nodeIdx],
    detail,
    year: year || graph.nodes[nodeIdx].year
  };

  // Mark as enriched
  const enrichedNodeIds = [
    ...(session.enriched_node_ids || []),
    node_id
  ];

  await db.query(`
    UPDATE career_sessions
    SET graph_data = $1,
        enriched_node_ids = $2,
        summary_version = summary_version + 1,
        updated_at = NOW()
    WHERE id = $3 AND user_id = $4
  `, [
    JSON.stringify(graph),
    JSON.stringify(enrichedNodeIds),
    session.id,
    userId
  ]);

  // Async post-save actions — fire and forget
  triggerAutoRefine(userId, 'graph_enriched').catch(() => {});
  updateVoiceFromAnswer(userId, detail, 'enrichment').catch(() => {});

  res.json({
    updated_node: graph.nodes[nodeIdx],
    triggered_refinements: ['linkedin_summary', 'short_bio', 'portrait']
  });
});
```

---

## Step 4 — Assembler Task: buildNodeEnrichmentPrompt

```typescript
// src/assembler/tasks/nodeEnrichment.ts

export function buildNodeEnrichmentPrompt(
  node: Node,
  connectedNodes: Node[],
  nudgeReason: NudgeReason,
  stageProfile: StageProfile
): PromptPackage {

  const stageInstruction = {
    ic: `Focus on craft — what specifically they built, the technical
         decision they made, how they solved the hard part.`,
    leader: `Focus on leverage — what became possible for others,
             what the team achieved, what was built that outlasted
             their direct involvement.`,
    executive: `Focus on judgment — what bet was made and why,
                what they knew that others didn't, what conviction
                they had before it was validated.`
  }[stageProfile.stage];

  const system = `You write single targeted questions to get professionals
to share the most valuable missing detail about a career experience.

The question must:
- Be specific to this exact node and its connections — not generic
- Reference specific connected nodes or outcomes by name where relevant
- Ask for the one thing that would complete the picture
- Never say "tell me more" — always ask for something concrete

${stageInstruction}`;

  const user_context = `Node to enrich:
Label: ${node.label}
Type: ${node.type}
Current detail (thin or missing): ${node.detail || 'none'}
Year: ${node.year || 'unknown'}

Connected nodes (reference these by name in the question):
${connectedNodes.slice(0, 5).map(n =>
  `- ${n.label} (${n.type}): ${n.detail || 'no detail'}`
).join('\n')}

Why this was selected:
${nudgeReason.centralitySentence}
${nudgeReason.recencySentence}`;

  const task_prompt = `Write one question to get the most valuable
missing detail about this experience.

Reference specific connected nodes or outcomes by name where it
makes the question more precise — show you've read the graph.

If current detail already mentions something, push deeper —
ask what's behind it, not what's already there.

One or two sentences maximum.
Return ONLY the question. No preamble. No explanation.`;

  return {
    system,
    user_context,
    task_prompt,
    estimated_tokens: 250,
    cache_key: `node_enrich_q_${node.id}_${stageProfile.stage}`,
    metadata: {
      nodes_selected: connectedNodes.length + 1,
      node_ids_selected: [node.id, ...connectedNodes.map(n => n.id)],
      truncated: false,
      summary_version: 0
    }
  };
}
```

---

## Step 5 — Sparse Node Visual in Graph

Before enrichment: dashed border, 60% opacity, label dimmed.
After enrichment: solid border, full opacity, amber pulse.

```javascript
// In renderGraph() — add to node rendering logic

function getNodeStyle(node, enrichedNodeIds) {
  const sparse = isNodeSparse(node) && !enrichedNodeIds.includes(node.id);

  return {
    strokeDasharray: sparse ? '3,2' : 'none',
    opacity: sparse ? '0.6' : '1.0',
    labelFill: sparse ? '#333' : '#505050',
    // Tooltip on hover
    title: sparse ? `${node.label} — click to add detail` : node.label
  };
}

// After successful enrich-node call:
function animateNodeEnrichment(nodeId) {
  const nodeEl = document.getElementById(`node-${nodeId}`);
  if (!nodeEl) return;

  // Remove sparse treatment
  nodeEl.setAttribute('stroke-dasharray', 'none');
  nodeEl.setAttribute('opacity', '1');

  // Amber pulse animation
  nodeEl.style.transition = 'all 0.3s';
  nodeEl.setAttribute('stroke', 'var(--gold)');
  nodeEl.setAttribute('stroke-width', '3');

  setTimeout(() => {
    nodeEl.setAttribute('stroke-width', '2');
    // Return to normal color based on node type
  }, 800);
}
```

---

## Step 6 — Workspace Banner + Nudge Panel UI

### Banner (loads on workspace open)

```javascript
// frontend/workspace.js — add to workspace init

async function loadNudgeBanner() {
  const banner = document.getElementById('nudgeBanner');
  if (!banner) return;

  const { nudge } = await fetch(
    `/api/v1/sessions/${currentSessionId}/next-nudge`,
    { headers: { 'Authorization': `Bearer ${getToken()}` } }
  ).then(r => r.json());

  if (!nudge) return;

  banner.style.display = 'flex';
  banner.innerHTML = `
    <div class="nudge-banner-dot"></div>
    <div class="nudge-banner-text">
      <strong>${nudge.node.label}</strong> is central but sparse —
      ${nudge.reason.notableConnections.length > 0
        ? `connects to ${nudge.reason.notableConnections.slice(0,2).join(' and ')}`
        : `${nudge.reason.connectionCount} connections`}
      · Would strengthen your LinkedIn summary
    </div>
    <button class="nudge-banner-btn"
            onclick="openNudgePanel('${nudge.node.id}')">
      Add detail →
    </button>
    <button class="nudge-banner-dismiss"
            onclick="dismissNudge()">×</button>
  `;

  // Store nudge data for panel
  window.currentNudge = nudge;
}

function dismissNudge() {
  const banner = document.getElementById('nudgeBanner');
  if (banner) banner.style.display = 'none';
  // Don't show again this session
  sessionStorage.setItem('nudge_dismissed', '1');
}
```

### Nudge Panel (two-phase render)

```javascript
async function openNudgePanel(nodeId) {
  const nudge = window.currentNudge;
  if (!nudge || nudge.node.id !== nodeId) return;

  const panel = createNudgePanelElement(nudge.node, nudge.reason, null);
  document.body.appendChild(panel);
  panel.classList.add('open');

  // Phase 2 — load Claude-generated question
  const { question } = await fetch(
    `/api/v1/sessions/${currentSessionId}/nudge-question`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ node_id: nodeId })
    }
  ).then(r => r.json());

  updateNudgePanelQuestion(panel, question);
}

function createNudgePanelElement(node, reason, question) {
  const el = document.createElement('div');
  el.className = 'nudge-panel';
  el.id = 'nudgePanel';
  el.innerHTML = `
    <div class="nudge-panel-header">
      <div class="nudge-panel-title">◆ One experience worth developing</div>
      <button onclick="closeNudgePanel()" class="nudge-panel-skip">
        Skip →
      </button>
    </div>

    <div class="nudge-panel-node">${node.label}</div>

    <div class="nudge-section-label">WHY THIS ONE</div>
    <div class="nudge-reason-text">
      ${reason.centralitySentence}
      ${reason.recencySentence}
      ${reason.sparsitySentence}
    </div>

    <div class="nudge-section-label">WHAT GETS BETTER</div>
    <div class="nudge-impacts">
      ${reason.impacts.map(i => `<div class="nudge-impact">→ ${i}</div>`).join('')}
    </div>

    <div class="nudge-divider"></div>

    <div class="nudge-question" id="nudgeQuestion">
      ${question
        ? `<div class="nudge-q-text">"${question}"</div>`
        : `<div class="nudge-q-loading">
             <span></span><span></span><span></span>
           </div>`
      }
    </div>

    <textarea
      id="nudgeAnswer"
      class="nudge-answer-input"
      placeholder="Be specific — a concrete example is worth more than a summary…"
      rows="4"
    ></textarea>

    <div class="nudge-year-row">
      <label class="nudge-year-label">When was this?</label>
      <input type="text" id="nudgeYear" class="nudge-year-input"
             value="${node.year || ''}"
             placeholder="e.g. 2021–2023">
    </div>

    <button onclick="saveEnrichment('${node.id}')" class="nudge-save-btn">
      Save to graph
    </button>

    <div class="nudge-footer">
      ◈ This updates your LinkedIn summary, portrait, and directions automatically.
    </div>
  `;
  return el;
}

function updateNudgePanelQuestion(panel, question) {
  const questionEl = panel.querySelector('#nudgeQuestion');
  if (questionEl) {
    questionEl.innerHTML = `<div class="nudge-q-text">"${question}"</div>`;
  }
}

async function saveEnrichment(nodeId) {
  const answer = document.getElementById('nudgeAnswer').value.trim();
  const year = document.getElementById('nudgeYear').value.trim();

  if (!answer || answer.length < 20) {
    document.getElementById('nudgeAnswer').style.borderColor = 'var(--red)';
    return;
  }

  const saveBtn = document.querySelector('.nudge-save-btn');
  saveBtn.textContent = 'Saving…';
  saveBtn.disabled = true;

  const result = await fetch(
    `/api/v1/sessions/${currentSessionId}/enrich-node`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ node_id: nodeId, detail: answer, year })
    }
  ).then(r => r.json());

  // Animate node in graph
  animateNodeEnrichment(nodeId);

  // Close panel
  closeNudgePanel();

  // Show confirmation
  showToast('Graph updated — outputs will refine shortly');

  // Hide banner
  const banner = document.getElementById('nudgeBanner');
  if (banner) banner.style.display = 'none';

  // Update local session state
  currentSession.graph_data = {
    ...currentSession.graph_data,
    nodes: currentSession.graph_data.nodes.map(n =>
      n.id === nodeId ? result.updated_node : n
    )
  };
}
```

---

## Done Signal

This session is complete when:

1. Unit tests for scoring functions all pass
2. `GET /sessions/:id/next-nudge` returns correct node based on score
3. Workspace banner appears on return visits with node label and reason
4. Clicking "Add detail →" opens nudge panel
5. Panel shows reason instantly (Phase 1)
6. Question appears ~1 second later replacing loading pulse (Phase 2)
7. User can type answer and save
8. After save: node detail updates in graph_data
9. Graph node changes from dashed/dim to solid/full opacity
10. Amber pulse on enriched node
11. Banner hides after save
12. Toast confirms "Graph updated"

Do not start 12d until all twelve are working.
