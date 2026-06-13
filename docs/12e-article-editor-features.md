# Career OS — Doc 12e: Article Editor Features

## What This Builds

Intelligence features on top of the article editor foundation:
- Text selection enhancement menu (5 actions)
- Review draft — three structured observations
- Mark as published → creates publication node in graph

Prerequisite: 12d article editor foundation is complete.
The editor must be working before adding these features.

---

## Context

Read career-os-docs/12-career-workspace.md Feature 3 continued.

The editor in 12d is a writing surface.
The features in 12e make it an intelligent collaborator.

---

## Feature 1 — Selection Enhancement Menu

When the user selects text in the editor, a small floating
menu appears near the selection. Five targeted actions.

Each action is a Claude call on the **selected passage only** —
not the full article. Fast (~2-3 seconds). Targeted.

### Frontend — Selection Detection

```javascript
// frontend/lib/selectionMenu.js

export function initSelectionMenu(editorId, sessionId, articleId) {
  const editor = document.getElementById(editorId);
  if (!editor) return;

  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (!selectedText || selectedText.length < 10) {
      hideSelectionMenu();
      return;
    }

    // Check selection is inside the editor
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      hideSelectionMenu();
      return;
    }

    showSelectionMenu(selection, selectedText, sessionId, articleId);
  });
}

const SELECTION_ACTIONS = [
  { id: 'strengthen', label: 'Strengthen with graph' },
  { id: 'direct',     label: 'More direct'           },
  { id: 'expand',     label: 'Expand'                },
  { id: 'cut',        label: 'Cut'                   },
  { id: 'rewrite',    label: 'Rewrite'               },
];

function showSelectionMenu(selection, selectedText, sessionId, articleId) {
  let menu = document.getElementById('selectionMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'selectionMenu';
    menu.className = 'selection-menu';
    document.body.appendChild(menu);
  }

  // Position near selection
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  menu.style.top = `${rect.top + window.scrollY - 44}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;

  menu.innerHTML = SELECTION_ACTIONS.map(action => `
    <button
      class="sel-action-btn"
      onclick="applySelectionAction('${action.id}', '${sessionId}', '${articleId}')"
    >${action.label}</button>
  `).join('');

  menu.style.display = 'flex';

  // Store selected text
  window.currentSelectedText = selectedText;
  window.currentSelectionRange = selection.getRangeAt(0).cloneRange();
}

function hideSelectionMenu() {
  const menu = document.getElementById('selectionMenu');
  if (menu) menu.style.display = 'none';
}

async function applySelectionAction(action, sessionId, articleId) {
  const selectedText = window.currentSelectedText;
  if (!selectedText) return;

  // Show loading state on menu
  const menu = document.getElementById('selectionMenu');
  menu.innerHTML = '<div class="sel-loading">···</div>';

  const { enhanced_text } = await fetch(
    '/api/v1/claude/article-enhance-selection',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: sessionId,
        article_id: articleId,
        selected_text: selectedText,
        action
      })
    }
  ).then(r => r.json());

  // Replace selection with enhanced text
  if (enhanced_text && window.currentSelectionRange) {
    const range = window.currentSelectionRange;
    range.deleteContents();
    range.insertNode(document.createTextNode(enhanced_text));

    // Trigger save
    const editor = document.getElementById('articleEditor');
    editor.dispatchEvent(new Event('input'));
  }

  hideSelectionMenu();
}
```

### Backend — Selection Enhancement Endpoint

```typescript
// src/routes/claude.ts — add to existing Claude router

router.post('/claude/article-enhance-selection',
  requireAuth, async (req, res) => {

  const userId = req.user.id;
  const { session_id, article_id, selected_text, action } = req.body;

  const VALID_ACTIONS = ['strengthen', 'direct', 'expand', 'cut', 'rewrite'];
  if (!VALID_ACTIONS.includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const voiceProfile = await getVoiceProfile(userId);

  const ACTION_INSTRUCTIONS: Record<string, string> = {
    strengthen: `Strengthen this passage using specific evidence from
      the career graph provided. Replace vague claims with concrete
      details from actual graph nodes. Same voice, more specific.`,
    direct: `Make this passage more direct. Remove hedging language.
      Active voice. Apply the principle: let actions speak without
      qualification. No "I personally", no "leveraged".`,
    expand: `Expand this passage with one more specific example from
      the career graph. Concrete and grounded in actual experience.
      Add one paragraph — don't pad.`,
    cut: `Cut this passage to its essential point. Remove everything
      that doesn't add meaning. Half the words, same impact.
      No summaries of what was just said.`,
    rewrite: `Rewrite this passage in the person's natural voice.
      Apply the voice profile carefully. Sound like them on their
      best day — direct, specific, first person.`
  };

  // Select relevant graph nodes for context
  const relevantNodes = session.graph_data?.nodes
    .filter((n: Node) => n.weight >= 2)
    .filter((n: Node) =>
      selected_text.toLowerCase().includes(
        n.label.toLowerCase().split(' ')[0]
      ) || n.weight === 3
    )
    .slice(0, 5);

  const prompt = `${ACTION_INSTRUCTIONS[action]}

Voice profile: ${voiceProfile?.voice_note || 'Direct, specific, first person.'}
Best day standard: ${voiceProfile?.best_day_note || ''}

Relevant career graph nodes:
${relevantNodes?.map((n: Node) =>
  `${n.label}: ${n.detail || 'no detail'}`
).join('\n')}

Text to enhance:
"${selected_text}"

Return ONLY the enhanced text. No explanation. No quotes.
Match the original length unless action is expand or cut.`;

  const enhanced = await callClaudeRaw(prompt, 400);
  res.json({ enhanced_text: enhanced.trim() });
});
```

### Selection Menu CSS

```css
.selection-menu {
  position: absolute;
  z-index: 200;
  display: none;
  gap: 2px;
  background: var(--s2);
  border: 1px solid var(--b2);
  border-radius: 4px;
  padding: 4px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}

.sel-action-btn {
  font-family: 'DM Mono', monospace;
  font-size: 8px;
  letter-spacing: 0.06em;
  padding: 5px 10px;
  border-radius: 3px;
  border: none;
  background: none;
  color: var(--t2);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.1s;
}

.sel-action-btn:hover { background: var(--b1); color: var(--t1); }
.sel-action-btn:first-child:hover { color: var(--gold); }

.sel-loading {
  padding: 5px 14px;
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  color: var(--gold);
  letter-spacing: 0.2em;
}
```

---

## Feature 2 — Review Draft

The "Review draft" button sends the full article to Claude
for holistic feedback. Returns three structured observations.

### Frontend — Review Panel

```javascript
// frontend/lib/articleReview.js

export async function reviewArticleDraft(sessionId, articleId) {
  const editor = document.getElementById('articleEditor');
  if (!editor) return;

  const articleText = editor.innerText.trim();
  if (!articleText || articleText.length < 100) return;

  // Show review panel
  const reviewPanel = createReviewPanel();
  document.getElementById('mainPanel').appendChild(reviewPanel);

  const { observations, overall } = await fetch(
    '/api/v1/claude/article-review',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: sessionId,
        article_id: articleId,
        article_text: articleText
      })
    }
  ).then(r => r.json());

  renderReviewResults(reviewPanel, observations, overall, articleId);
}

function createReviewPanel() {
  const panel = document.createElement('div');
  panel.className = 'review-panel';
  panel.id = 'reviewPanel';
  panel.innerHTML = `
    <div class="review-header">
      <div class="review-title">◆ Reviewing draft…</div>
      <button onclick="closeReviewPanel()" class="review-close">×</button>
    </div>
    <div class="review-loading">
      <div class="review-dots">
        <span></span><span></span><span></span>
      </div>
      Reading your draft against your career graph…
    </div>
  `;
  return panel;
}

function renderReviewResults(panel, observations, overall, articleId) {
  panel.innerHTML = `
    <div class="review-header">
      <div class="review-title">◆ Three things to strengthen</div>
      <button onclick="closeReviewPanel()" class="review-close">×</button>
    </div>

    <div class="review-observations">
      ${observations.map((obs, i) => `
        <div class="review-obs" id="obs-${i}">
          <div class="obs-header">
            <div class="obs-type ${obs.type}">${obs.type}</div>
            <button
              class="obs-apply-btn"
              onclick="applyReviewSuggestion(${i}, '${articleId}')"
            >Apply suggestion</button>
          </div>
          <div class="obs-location">"${obs.location}"</div>
          <div class="obs-issue">${obs.issue}</div>
          <div class="obs-suggestion">${obs.suggestion}</div>
        </div>
      `).join('')}
    </div>

    <div class="review-overall">
      "${overall}"
    </div>
  `;
}

async function applyReviewSuggestion(obsIdx, articleId) {
  const obs = currentObservations[obsIdx];
  if (!obs) return;

  // Find the location text in the editor and apply suggestion
  const editor = document.getElementById('articleEditor');
  const content = editor.innerText;

  // Simple find-and-replace of the location snippet
  // For more complex replacements, use the selection enhancement flow
  const enhanced = await fetch(
    '/api/v1/claude/article-enhance-selection',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: currentSessionId,
        article_id: articleId,
        selected_text: obs.location,
        action: 'rewrite',
        instruction_override: obs.suggestion
      })
    }
  ).then(r => r.json());

  if (enhanced.enhanced_text) {
    editor.innerText = content.replace(obs.location, enhanced.enhanced_text);
    editor.dispatchEvent(new Event('input'));

    // Mark observation as applied
    const obsEl = document.getElementById(`obs-${obsIdx}`);
    if (obsEl) obsEl.classList.add('applied');
  }
}
```

### Backend — Review Endpoint

```typescript
// src/routes/claude.ts — add

router.post('/claude/article-review',
  requireAuth, async (req, res) => {

  const userId = req.user.id;
  const { session_id, article_id, article_text } = req.body;

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const voiceProfile = await getVoiceProfile(userId);

  const system = `You are a trusted editor who knows this person's
career deeply. Your feedback is specific, grounded in their actual
graph, and always preserves their voice while elevating their clarity.

Never give generic feedback. Every observation must reference
something specific in the article text or their career graph.`;

  const user_context = `Voice profile: ${voiceProfile?.voice_note || ''}
Career graph summary: ${session.career_summary || ''}

Key graph nodes:
${session.graph_data?.nodes
  .filter((n: Node) => n.weight >= 2)
  .slice(0, 8)
  .map((n: Node) => `${n.label}: ${n.detail || ''}`)
  .join('\n')}`;

  const task_prompt = `Review this article draft. Identify the three
most impactful improvements.

Focus on:
1. Voice accuracy — passages that feel generic or unlike their
   voice profile. Flag them specifically.
2. Specificity gaps — where graph data could make a vague claim
   concrete. Reference specific nodes by name.
3. Structure — is the opening strong? Does it close on the premise?

Article:
${article_text}

Return ONLY valid JSON — no markdown, no backticks:
{
  "observations": [
    {
      "type": "voice|specificity|structure",
      "location": "first 8-10 words of the relevant passage",
      "issue": "what's weak here — one sentence",
      "suggestion": "specific improvement — may reference graph nodes"
    }
  ],
  "overall": "one sentence: what's strongest about this draft"
}`;

  const rawResult = await callClaudeRaw(
    `${system}\n\n${user_context}\n\n${task_prompt}`, 700
  );

  let result = { observations: [], overall: '' };
  try {
    result = JSON.parse(rawResult);
  } catch (e) {
    // Parse error — return empty
  }

  res.json(result);
});
```

### Review Panel CSS

```css
.review-panel {
  position: fixed;
  right: 0; top: 44px; bottom: 0;
  width: 340px;
  background: var(--s1);
  border-left: 1px solid var(--b2);
  z-index: 50;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  animation: slideInRight 0.3s ease;
}

@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.review-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--b1);
  flex-shrink: 0;
}

.review-title {
  font-family: 'DM Mono', monospace;
  font-size: 9px;
  color: var(--gold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.review-close {
  background: none; border: none; color: var(--t3);
  cursor: pointer; font-size: 14px; padding: 2px 6px;
}

.review-observations { padding: 16px; }

.review-obs {
  background: var(--s2); border: 1px solid var(--b1);
  border-radius: 4px; padding: 12px; margin-bottom: 10px;
  transition: opacity 0.3s;
}

.review-obs.applied { opacity: 0.4; }

.obs-header {
  display: flex; align-items: center;
  justify-content: space-between; margin-bottom: 8px;
}

.obs-type {
  font-family: 'DM Mono', monospace;
  font-size: 7px; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 2px 7px; border-radius: 2px;
}
.obs-type.voice { color: var(--gold); border: 1px solid rgba(232,166,64,0.3); }
.obs-type.specificity { color: var(--blue); border: 1px solid rgba(96,165,250,0.3); }
.obs-type.structure { color: var(--purple); border: 1px solid rgba(167,139,250,0.3); }

.obs-apply-btn {
  font-family: 'DM Mono', monospace; font-size: 7px;
  letter-spacing: 0.08em; padding: 3px 8px; border-radius: 3px;
  border: 1px solid var(--b2); background: none; color: var(--t3);
  cursor: pointer; transition: all 0.15s;
}
.obs-apply-btn:hover { border-color: var(--gold); color: var(--gold); }

.obs-location {
  font-size: 10px; color: var(--t3); font-style: italic;
  margin-bottom: 6px; font-family: 'Cormorant Garamond', serif;
}
.obs-issue { font-size: 11px; color: var(--t2); margin-bottom: 6px; }
.obs-suggestion {
  font-size: 11px; color: var(--t1); line-height: 1.6;
  border-left: 2px solid var(--gold); padding-left: 8px;
}

.review-overall {
  margin: 0 16px 16px;
  font-family: 'Cormorant Garamond', serif;
  font-size: 14px; font-style: italic; color: var(--t2);
  border-top: 1px solid var(--b1); padding-top: 14px;
  line-height: 1.6;
}
```

---

## Feature 3 — Mark as Published

When the user clicks "Publish to LinkedIn" or "Mark as published,"
three things happen:

1. Article status updates to 'published'
2. A publication node is created in the career graph
3. The article appears in the graph with a publication icon

### Frontend

```javascript
async function markAsPublished(articleId, platform = 'linkedin') {
  const publishedUrl = prompt(
    'Optional: paste the published URL to track it',
    ''
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

  copyWithTracking('', 'article_published', {
    article_id: articleId,
    platform,
    word_count: result.word_count,
    edit_similarity: result.edit_similarity
  });

  showToast('Published ✓ — added to your career graph');

  // Refresh article list
  navigateTo('articles');
}
```

### Backend — Publish Endpoint

```typescript
// src/routes/claude.ts — add

router.post('/articles/:id/publish', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id, platform, published_url } = req.body;

  const article = await db.query(
    'SELECT * FROM articles WHERE id = $1 AND user_id = $2',
    [req.params.id, userId]
  );

  if (!article.rows[0]) return res.status(404).json({ error: 'Not found' });

  const a = article.rows[0];

  // Update article status
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

  // Create publication node in graph
  const session = await validateSessionOwnership(session_id, userId);
  if (session) {
    const pubNode = {
      id: `pub_${Date.now()}`,
      type: 'publication',
      label: a.title?.slice(0, 35) || 'Article',
      detail: `Published ${platform} article. ${
        a.current_content?.slice(0, 100)
      }…`,
      year: new Date().getFullYear().toString(),
      weight: 2,
      url: published_url || null
    };

    const graph = session.graph_data;
    graph.nodes.push(pubNode);

    await db.query(`
      UPDATE career_sessions
      SET graph_data = $1,
          summary_version = summary_version + 1,
          updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify(graph), session_id]);
  }

  // Update copy_events for tracking
  await db.query(`
    INSERT INTO copy_events (user_id, session_id, event_name, metadata)
    VALUES ($1, $2, 'article_published', $3)
  `, [userId, session_id, JSON.stringify({
    article_id: a.id,
    platform,
    word_count: a.word_count,
    edit_similarity: a.edit_similarity
  })]);

  res.json({
    ok: true,
    word_count: a.word_count,
    edit_similarity: a.edit_similarity
  });
});
```

---

## Wire Selection Menu and Review Button into Editor

Update the editor topbar from 12d to include these buttons:

```javascript
// In openArticleEditor() from 12d — update innerHTML

`<div class="editor-topbar">
  <button onclick="navigateTo('articles')" class="back-btn">
    ← Articles
  </button>
  <div class="editor-title" contenteditable="true"
       id="articleTitle">${title || 'Untitled'}</div>
  <div class="editor-meta">
    <span id="wordCount">${draft.split(/\s+/).length}</span> words
    · <span id="saveIndicator"></span>
  </div>
  <div class="editor-actions">
    <button onclick="reviewArticleDraft('${sessionId}', '${articleId}')"
            class="action-btn muted">
      ◆ Review draft
    </button>
    <button onclick="copyAllContent()" class="action-btn muted">
      Copy all
    </button>
    <button onclick="markAsPublished('${articleId}')"
            class="action-btn primary">
      Publish →
    </button>
  </div>
</div>`

// After wiring editor:
initSelectionMenu('articleEditor', sessionId, articleId);
```

---

## Copy Tracking Events

| Action | Event Name |
|---|---|
| Selection enhanced | `article_selection_enhanced` with `action` in metadata |
| Review draft requested | `article_review_requested` |
| Article published | `article_published` with `platform`, `edit_similarity` |
| Full article copied | `copy_article_full` |

---

## Done Signal

This session is complete when:

1. Selecting text in the editor shows the five-button menu
2. Each menu action sends the selection and returns a replacement
3. Replacement inserts correctly at the original selection position
4. "Review draft" button opens the slide-in review panel
5. Review panel shows three observations with type badges
6. "Apply suggestion" replaces the relevant passage
7. "Publish →" prompts for URL, updates article status
8. Published article creates a publication node visible in the graph
9. All events tracked via `copyWithTracking`
10. Edit similarity score visible in article list for published articles

All twelve doc 12 features are complete after this session.
