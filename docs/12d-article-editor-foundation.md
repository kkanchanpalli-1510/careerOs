# Career OS — Doc 12d: Article Editor Foundation

## What This Builds

The foundation of the article editor:
- Articles database table
- New Article panel with thoughts input and theme suggestions
- Article draft generation endpoint
- Basic editable editor with auto-save
- ArticleEditTracker for voice signal capture
- Article list view

Does NOT include: selection enhancement menu, review draft,
or publish flow. Those are in doc 12e.

Prerequisite: 12a workspace shell is built and working.

---

## Context

Read career-os-docs/12-career-workspace.md Feature 3
for full design rationale. This is the build spec.

Core principle: Career OS becomes the place where the user writes.
Voice twinning gets better with every article — edit distance
between Career OS draft and user's final is the primary signal.

---

## Step 1 — Database Migration

Show this to the user before running.

```sql
-- migration: 003_articles.sql

CREATE TABLE articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES career_sessions(id) ON DELETE CASCADE,

  -- Content
  title TEXT,
  theme TEXT,                    -- the idea/theme that prompted the article
  generated_draft TEXT,          -- what Career OS wrote (never changes)
  current_content TEXT,          -- what the user has now
  published_content TEXT,        -- final published version

  -- Status
  status TEXT DEFAULT 'draft',   -- 'draft' | 'published'
  published_url TEXT,
  published_at TIMESTAMPTZ,
  platform TEXT,                 -- 'linkedin' | 'substack' | 'other'

  -- Voice signal
  word_count INTEGER,
  edit_similarity FLOAT,         -- 1.0 = no edits, 0.0 = complete rewrite
  edit_count INTEGER DEFAULT 0,  -- how many save cycles

  -- Versions
  versions JSONB DEFAULT '[]',
  -- [{ version: 1, content: '...', saved_at: timestamp }]

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_articles_user ON articles(user_id);
CREATE INDEX idx_articles_session ON articles(session_id);
CREATE INDEX idx_articles_status ON articles(status);

-- Content ideas cache on sessions
ALTER TABLE career_sessions
ADD COLUMN IF NOT EXISTS content_ideas JSONB DEFAULT '[]';
ALTER TABLE career_sessions
ADD COLUMN IF NOT EXISTS content_ideas_generated_at TIMESTAMPTZ;
```

---

## Step 2 — Assembler Task: Article Draft

```typescript
// src/assembler/tasks/articleDraft.ts

export function buildArticleDraftPrompt(
  session: CareerSession,
  userThoughts: string,
  stageProfile: StageProfile,
  voiceProfile?: VoiceProfile
): PromptPackage {

  const w3Nodes = session.graph_data?.nodes
    .filter((n: Node) => n.weight === 3)
    .map((n: Node) => `${n.label}: ${n.detail}`);

  const w2Nodes = session.graph_data?.nodes
    .filter((n: Node) => n.weight === 2)
    .slice(0, 8)
    .map((n: Node) => `${n.label}: ${n.detail || 'no detail'}`);

  const outcomes = session.graph_data?.nodes
    .filter((n: Node) => n.type === 'outcome' && n.weight >= 2)
    .map((n: Node) => n.label);

  const voiceContext = voiceProfile?.confidence >= 0.4
    ? `Voice profile: ${voiceProfile.voice_note}
Best day standard: ${voiceProfile.best_day_note}`
    : 'Voice profile not yet established — write in a direct, specific, first-person style.';

  const stageInstruction = {
    ic: `Tone: specific, craft-forward, energetic. First person.
         Lead with what you built or saw, not your title.
         Use short declarative sentences.`,
    leader: `Tone: measured, impact-focused. First person.
             Lead with outcomes and what you enabled in others.
             The team or system is the hero, not just you personally.`,
    executive: `Tone: deliberate, peer-to-peer. First person.
                Lead with a point of view or the type of problem
                you're built for. Not breathless — considered.`
  }[stageProfile.stage];

  const system = `You are ghostwriting a LinkedIn or Substack article
for a professional. The article must:
- Sound exactly like this person — not like AI wrote it
- Be grounded in their actual career experience (use graph nodes as evidence)
- Have a clear, non-obvious point of view
- Open with something that makes the right person stop scrolling
- Be 600–900 words

${stageInstruction}

BANNED in this article:
- "I'm passionate about"
- "In today's fast-paced world"
- "Leveraged" — use "used" or describe what was done
- "Thought leader" or "thought leadership"
- "Game-changer" or "paradigm shift"
- Any form of "I'm excited to share"
- Rhetorical questions as section headers`;

  const user_context = `${voiceContext}

Career graph — defining experiences:
${w3Nodes?.join('\n')}

Supporting experiences:
${w2Nodes?.join('\n')}

Key outcomes: ${outcomes?.join(', ')}

Career summary: ${session.career_summary || ''}`;

  const task_prompt = `Write a LinkedIn/Substack article based on these thoughts:

"${userThoughts}"

Requirements:
1. Open with a specific, concrete hook — something that happened,
   not a general observation. Pull from the graph if relevant.
2. Develop the core argument with 2-3 specific examples or evidence
   from the career graph. Name the nodes, outcomes, or decisions.
3. Write a conclusion that connects back to the opening and ends
   with something worth thinking about — not a call to action.
4. 600–900 words. No section headers. Flowing prose.

Return the article title on the first line, then a blank line,
then the article body. Nothing else.`;

  return {
    system,
    user_context,
    task_prompt,
    estimated_tokens: 1200,
    cache_key: `article_draft_${session.id}_${Date.now()}`,
    metadata: {
      nodes_selected: (w3Nodes?.length || 0) + (w2Nodes?.length || 0),
      node_ids_selected: [],
      truncated: false,
      summary_version: session.summary_version || 0
    }
  };
}
```

---

## Step 3 — Content Ideas Assembler Task

```typescript
// src/assembler/tasks/contentIdeas.ts

export function buildContentIdeasPrompt(
  session: CareerSession,
  recentNodeLabels: string[]
): PromptPackage {

  const w3Nodes = session.graph_data?.nodes
    .filter((n: Node) => n.weight === 3)
    .map((n: Node) => `${n.label}: ${n.detail}`);

  const direction = session.insights?.branches?.[
    session.selected_branch ?? 0
  ];

  const task_prompt = `Generate 3 specific article ideas for this person.

Each idea must be:
- Grounded in their actual graph nodes — not generic topics
- Specific enough that only this person could write it convincingly
- A clear point of view — not "thoughts on X" but "the non-obvious
  thing about X that most people miss"
- Relevant to their direction: ${direction?.title || 'not selected'}

Recently active nodes (highest relevance): ${recentNodeLabels.join(', ')}

Return ONLY valid JSON — no markdown, no backticks:
{
  "ideas": [
    {
      "title": "Specific opinionated article title",
      "premise": "One sentence: the non-obvious argument",
      "graph_nodes": ["node labels that provide the evidence"],
      "why_them": "One sentence: why this person specifically"
    }
  ]
}`;

  return {
    system: `You generate specific content ideas grounded in real
career experience. Every idea must reference actual graph data.
Never suggest generic thought leadership topics.`,
    user_context: `Defining experiences:\n${w3Nodes?.join('\n')}
Career summary: ${session.career_summary}`,
    task_prompt,
    estimated_tokens: 600,
    cache_key: `content_ideas_${session.id}_${session.summary_version}`,
    metadata: {
      nodes_selected: w3Nodes?.length || 0,
      node_ids_selected: [],
      truncated: false,
      summary_version: session.summary_version || 0
    }
  };
}
```

---

## Step 4 — API Endpoints

```typescript
// src/routes/claude.ts — add to existing Claude router

// Generate article draft
router.post('/claude/article-draft', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id, thoughts, theme_id } = req.body;

  if (!thoughts || thoughts.trim().length < 10) {
    return res.status(400).json({ error: 'Thoughts required' });
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const stageProfile = detectStageProfile(session.graph_data);
  const voiceProfile = await getVoiceProfile(userId);

  const promptPackage = buildArticleDraftPrompt(
    session, thoughts.trim(), stageProfile, voiceProfile
  );

  await logUsageEstimate(userId, session_id, 'article_draft',
    promptPackage.estimated_tokens);

  const rawDraft = await callClaude(promptPackage, 1200);

  // Parse title from first line
  const lines = rawDraft.split('\n');
  const title = lines[0].trim();
  const body = lines.slice(2).join('\n').trim();

  // Store article
  const article = await db.query(`
    INSERT INTO articles
      (user_id, session_id, title, theme, generated_draft,
       current_content, word_count)
    VALUES ($1, $2, $3, $4, $5, $5, $6)
    RETURNING id, title
  `, [
    userId, session_id, title,
    thoughts.trim(), body,
    body.split(/\s+/).length
  ]);

  await logUsageActual(userId, session_id, 'article_draft');

  res.json({
    article_id: article.rows[0].id,
    title: article.rows[0].title,
    draft: body
  });
});

// Generate content ideas (cached per session)
router.post('/claude/content-ideas', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id } = req.body;

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  // Return cached if fresh (less than 7 days old and graph unchanged)
  if (session.content_ideas?.length > 0 &&
      session.content_ideas_generated_at &&
      session.summary_version === session.content_ideas_version) {
    return res.json({ ideas: session.content_ideas });
  }

  // Get recently active node labels from usage logs
  const recentActivity = await db.query(`
    SELECT metadata->>'node_id' as node_id
    FROM usage_logs
    WHERE user_id = $1 AND task_type = 'node_chat'
      AND created_at > NOW() - INTERVAL '14 days'
    ORDER BY created_at DESC
    LIMIT 5
  `, [userId]);

  const recentNodeIds = recentActivity.rows.map(r => r.node_id);
  const recentNodeLabels = session.graph_data?.nodes
    .filter((n: Node) => recentNodeIds.includes(n.id))
    .map((n: Node) => n.label) || [];

  const promptPackage = buildContentIdeasPrompt(session, recentNodeLabels);
  const result = await callClaude(promptPackage, 600);

  let ideas = [];
  try {
    const parsed = JSON.parse(result);
    ideas = parsed.ideas || [];
  } catch (e) {
    ideas = [];
  }

  // Cache ideas
  await db.query(`
    UPDATE career_sessions
    SET content_ideas = $1,
        content_ideas_generated_at = NOW()
    WHERE id = $2
  `, [JSON.stringify(ideas), session_id]);

  res.json({ ideas });
});

// Save article edit (auto-save)
router.patch('/articles/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { content } = req.body;

  const article = await db.query(
    'SELECT * FROM articles WHERE id = $1 AND user_id = $2',
    [req.params.id, userId]
  );

  if (!article.rows[0]) {
    return res.status(404).json({ error: 'Not found' });
  }

  const wordCount = content?.split(/\s+/).length || 0;
  const similarity = calculateSimilarity(
    article.rows[0].generated_draft || '',
    content || ''
  );

  // Add version entry
  const versions = article.rows[0].versions || [];
  versions.push({
    version: versions.length + 1,
    content,
    saved_at: new Date().toISOString()
  });

  await db.query(`
    UPDATE articles
    SET current_content = $1,
        word_count = $2,
        edit_similarity = $3,
        edit_count = edit_count + 1,
        versions = $4,
        updated_at = NOW()
    WHERE id = $5 AND user_id = $6
  `, [content, wordCount, similarity,
      JSON.stringify(versions), req.params.id, userId]);

  res.json({ ok: true, word_count: wordCount, edit_similarity: similarity });
});

// Get article list
router.get('/articles', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id } = req.query;

  const articles = await db.query(`
    SELECT id, title, status, word_count, edit_similarity,
           edit_count, created_at, updated_at,
           LEFT(current_content, 200) as preview
    FROM articles
    WHERE user_id = $1
      ${session_id ? 'AND session_id = $2' : ''}
    ORDER BY updated_at DESC
  `, session_id ? [userId, session_id] : [userId]);

  res.json({ articles: articles.rows });
});

// Get single article
router.get('/articles/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;

  const article = await db.query(
    'SELECT * FROM articles WHERE id = $1 AND user_id = $2',
    [req.params.id, userId]
  );

  if (!article.rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json({ article: article.rows[0] });
});
```

---

## Step 5 — ArticleEditTracker

```javascript
// frontend/lib/ArticleEditTracker.js

export class ArticleEditTracker {
  constructor(userId, sessionId, articleId, generatedDraft) {
    this.userId = userId;
    this.sessionId = sessionId;
    this.articleId = articleId;
    this.generatedDraft = generatedDraft;
    this.saveTimer = null;
    this.voiceTimer = null;
    this.lastSavedContent = generatedDraft;
  }

  onContentChange(currentText) {
    // Save frequently — never lose work
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveCurrentVersion(currentText);
    }, 2000);

    // Voice update — less frequent, more expensive
    clearTimeout(this.voiceTimer);
    this.voiceTimer = setTimeout(() => {
      this.updateVoiceFromEdits(currentText);
    }, 10000);

    // Update word count display
    const wc = document.getElementById('wordCount');
    if (wc) wc.textContent = currentText.trim().split(/\s+/).length;
  }

  async saveCurrentVersion(text) {
    if (text === this.lastSavedContent) return; // no change

    try {
      const result = await fetch(`/api/v1/articles/${this.articleId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: text })
      }).then(r => r.json());

      this.lastSavedContent = text;

      // Update save indicator
      const indicator = document.getElementById('saveIndicator');
      if (indicator) {
        indicator.textContent = 'Saved';
        indicator.style.color = 'var(--green)';
        setTimeout(() => {
          indicator.textContent = '';
        }, 2000);
      }
    } catch (e) {
      // Silent save failure
    }
  }

  updateVoiceFromEdits(currentText) {
    const similarity = calculateSimilarity(this.generatedDraft, currentText);
    if (similarity > 0.92) return; // not enough change

    // Fire and forget
    fetch('/api/v1/voice/edit-signal', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: this.sessionId,
        output_type: 'article',
        original: this.generatedDraft,
        final: currentText,
        similarity
      })
    }).catch(() => {});
  }
}
```

---

## Step 6 — Article Panel UI

### Articles List View (default)

```javascript
// frontend/panels/ArticlesPanel.js

export async function render(container, session) {
  // Load articles
  const { articles } = await fetch(
    `/api/v1/articles?session_id=${session.id}`,
    { headers: { 'Authorization': `Bearer ${getToken()}` } }
  ).then(r => r.json());

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Articles</div>
      <button onclick="openNewArticle()" class="action-btn primary">
        + New Article
      </button>
    </div>

    <div id="articleList">
      ${articles.length === 0
        ? renderEmptyArticleList()
        : articles.map(renderArticleListItem).join('')
      }
    </div>
  `;
}

function renderEmptyArticleList() {
  return `
    <div class="empty-state">
      <div class="empty-icon">◆</div>
      <div class="empty-title">Your career graph has a story to tell</div>
      <div class="empty-desc">
        Share a thought or pick a theme — Career OS will develop it
        into a draft in your voice.
      </div>
      <button onclick="openNewArticle()" class="action-btn primary">
        Write your first article →
      </button>
    </div>
  `;
}

function renderArticleListItem(article) {
  const statusDot = article.status === 'published'
    ? '<span class="status-dot published"></span>'
    : '<span class="status-dot draft"></span>';
  const date = new Date(article.updated_at).toLocaleDateString();

  return `
    <div class="article-list-item"
         onclick="openArticleEditor('${article.id}')">
      ${statusDot}
      <div class="article-list-body">
        <div class="article-list-title">${article.title || 'Untitled draft'}</div>
        <div class="article-list-meta">
          ${article.word_count || 0} words · ${date}
          ${article.edit_similarity !== null
            ? `· ${Math.round(article.edit_similarity * 100)}% match`
            : ''}
        </div>
      </div>
      <div class="article-list-arrow">→</div>
    </div>
  `;
}
```

### New Article View

```javascript
async function openNewArticle() {
  const mainPanel = document.getElementById('mainPanel');

  // Load content ideas (cached)
  const { ideas } = await fetch(
    `/api/v1/claude/content-ideas`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ session_id: currentSessionId })
    }
  ).then(r => r.json());

  mainPanel.innerHTML = `
    <div class="panel-header">
      <button onclick="navigateTo('articles')" class="back-btn">
        ← Articles
      </button>
    </div>

    <div class="new-article-panel">
      <div class="new-article-title">New Article</div>
      <div class="new-article-subtitle">
        What's on your mind? Share a thought — even rough.
        Career OS will develop it into a draft in your voice.
      </div>

      <textarea
        id="articleThoughts"
        class="thoughts-input"
        placeholder="e.g. I've been thinking about why most analytics teams implement agentic workflows in completely the wrong order..."
        rows="5"
      ></textarea>

      ${ideas?.length > 0 ? `
        <div class="suggestions-label">Or pick a theme →</div>
        <div class="idea-cards">
          ${ideas.map((idea, i) => `
            <div class="idea-card" onclick="selectIdea(${i})">
              <div class="idea-title">${idea.title}</div>
              <div class="idea-premise">${idea.premise}</div>
              <div class="idea-nodes">
                ${idea.graph_nodes?.slice(0,3).map(n =>
                  `<span class="idea-node-tag">${n}</span>`
                ).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <button
        onclick="generateArticleDraft()"
        class="action-btn primary"
        id="generateBtn"
      >
        Develop this →
      </button>
    </div>
  `;

  // Store ideas for selection
  window.contentIdeas = ideas;
}

function selectIdea(idx) {
  const idea = window.contentIdeas[idx];
  const textarea = document.getElementById('articleThoughts');
  textarea.value = idea.premise;
  document.querySelectorAll('.idea-card').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
  });
}

async function generateArticleDraft() {
  const thoughts = document.getElementById('articleThoughts').value.trim();
  if (!thoughts) return;

  const btn = document.getElementById('generateBtn');
  btn.textContent = 'Writing in your voice…';
  btn.disabled = true;

  const { article_id, title, draft } = await fetch(
    '/api/v1/claude/article-draft',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: currentSessionId,
        thoughts
      })
    }
  ).then(r => r.json());

  openArticleEditor(article_id, title, draft);
}
```

### Article Editor View

```javascript
async function openArticleEditor(articleId, title, draft) {
  // Load article if not passed directly
  if (!title || !draft) {
    const { article } = await fetch(`/api/v1/articles/${articleId}`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    }).then(r => r.json());
    title = article.title;
    draft = article.current_content;
    articleId = article.id;
  }

  const mainPanel = document.getElementById('mainPanel');
  mainPanel.innerHTML = `
    <div class="editor-topbar">
      <button onclick="navigateTo('articles')" class="back-btn">
        ← Articles
      </button>
      <div class="editor-title" contenteditable="true"
           id="articleTitle">${title || 'Untitled'}</div>
      <div class="editor-meta">
        <span id="wordCount">${draft.split(/\s+/).length}</span> words
        · <span id="saveIndicator"></span>
      </div>
      <button onclick="copyAllContent()" class="action-btn muted">
        Copy all
      </button>
    </div>

    <div
      id="articleEditor"
      class="article-editor-body"
      contenteditable="true"
      spellcheck="true"
    >${draft}</div>

    <div class="editor-footer">
      ✦ Career OS is watching · Edits refine your voice twin
    </div>
  `;

  // Wire edit tracker
  const tracker = new ArticleEditTracker(
    currentUserId,
    currentSessionId,
    articleId,
    draft
  );

  const editorEl = document.getElementById('articleEditor');
  editorEl.addEventListener('input', () => {
    tracker.onContentChange(editorEl.innerText);
  });

  // Prevent formatted paste
  editorEl.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });
}

function copyAllContent() {
  const content = document.getElementById('articleEditor').innerText;
  navigator.clipboard.writeText(content);
  copyWithTracking(content, 'copy_article_full', {
    article_id: currentArticleId,
    stage: getCurrentStage()
  });
  showToast('Article copied');
}
```

---

## Done Signal

This session is complete when:

1. SQL migration runs cleanly, articles table created
2. Navigating to Articles shows empty state with "Write your first article" button
3. Clicking New Article shows thoughts textarea + three content ideas
4. Typing thoughts and clicking "Develop this →" generates a draft (~10–15 seconds)
5. Draft opens in editor — contenteditable, fully editable
6. Word count updates as user types
7. Auto-save fires every 2 seconds, "Saved" confirmation appears briefly
8. After editing and returning to article list, article shows updated word count
9. Edit similarity score logged to articles table after each save

Do not start 12e until all nine are working.
