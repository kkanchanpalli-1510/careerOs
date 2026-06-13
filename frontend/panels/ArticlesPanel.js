// frontend/panels/ArticlesPanel.js

import { ArticleEditTracker } from '../lib/ArticleEditTracker.js';
import { showToast } from '../nudge.js';
import { calculateSimilarity } from '../lib/voiceSignals.js';
import { initSelectionMenu, hideSelectionMenu } from '../lib/selectionMenu.js';
import { reviewArticleDraft } from '../lib/articleReview.js';
import { ChatAssistPanel } from '../components/ChatAssistPanel.js';

function getToken() { return window.__careerToken ?? ''; }
function getSessionId() { return window.currentSession?.id ?? ''; }

// ── List view ──────────────────────────────────────────────────────────────

export async function render(container, session) {
  container.innerHTML = `<div class="panel-loading">···</div>`;

  let articles = [];
  try {
    const res = await fetch(
      `/api/v1/articles?session_id=${session?.id ?? ''}`,
      { headers: { 'Authorization': `Bearer ${getToken()}` } }
    );
    if (res.ok) ({ articles } = await res.json());
  } catch { /* no backend yet — show empty state */ }

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Articles</div>
      <button onclick="openNewArticle()" class="action-btn primary">+ New Article</button>
    </div>
    <div id="articleList">
      ${articles.length === 0
        ? renderEmptyArticleList()
        : articles.map(renderArticleListItem).join('')
      }
    </div>
  `;

  setupArticleGlobals(session);
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
    <div class="article-list-item" onclick="openArticleEditor('${article.id}')">
      ${statusDot}
      <div class="article-list-body">
        <div class="article-list-title">${article.title || 'Untitled draft'}</div>
        <div class="article-list-meta">
          ${article.word_count || 0} words · ${date}
          ${article.edit_similarity !== null && article.edit_similarity !== undefined
            ? `· ${Math.round(article.edit_similarity * 100)}% match`
            : ''}
        </div>
      </div>
      <div class="article-list-arrow">→</div>
    </div>
  `;
}

// ── New article view ───────────────────────────────────────────────────────

function setupArticleGlobals(session) {
  window.openNewArticle = async function() {
    const mainPanel = document.getElementById('mainPanel');
    mainPanel.innerHTML = `<div class="panel-loading">···</div>`;

    let ideas = [];
    try {
      const res = await fetch('/api/v1/claude/content-ideas', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ session_id: session?.id })
      });
      if (res.ok) ({ ideas } = await res.json());
    } catch { /* no backend — ideas stays empty */ }

    mainPanel.innerHTML = `
      <div class="panel-header">
        <button onclick="navigateTo('articles')" class="back-btn">← Articles</button>
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
        ${ideas.length > 0 ? `
          <div class="suggestions-label">Or pick a theme →</div>
          <div class="idea-cards">
            ${ideas.map((idea, i) => `
              <div class="idea-card" onclick="selectIdea(${i})">
                <div class="idea-title">${idea.title}</div>
                <div class="idea-premise">${idea.premise}</div>
                <div class="idea-nodes">
                  ${(idea.graph_nodes || []).slice(0, 3).map(n =>
                    `<span class="idea-node-tag">${n}</span>`
                  ).join('')}
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        <button onclick="generateArticleDraft()" class="action-btn primary" id="generateBtn">
          Develop this →
        </button>
      </div>
    `;

    window.contentIdeas = ideas;
  };

  window.selectIdea = function(idx) {
    const idea = window.contentIdeas?.[idx];
    if (!idea) return;
    const ta = document.getElementById('articleThoughts');
    if (ta) ta.value = idea.premise;
    document.querySelectorAll('.idea-card').forEach((el, i) => {
      el.classList.toggle('selected', i === idx);
    });
  };

  window.generateArticleDraft = async function() {
    const thoughts = document.getElementById('articleThoughts')?.value.trim();
    if (!thoughts) return;

    const btn = document.getElementById('generateBtn');
    if (btn) { btn.textContent = 'Writing in your voice…'; btn.disabled = true; }

    try {
      const res = await fetch('/api/v1/claude/article-draft', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ session_id: session?.id, thoughts })
      });

      if (!res.ok) throw new Error('Draft generation failed');
      const { article_id, title, draft } = await res.json();
      openArticleEditor(article_id, title, draft);
    } catch {
      if (btn) { btn.textContent = 'Develop this →'; btn.disabled = false; }
      showToast('Draft generation requires backend — coming soon');
    }
  };

  window.openArticleEditor = async function(articleId, title, draft) {
    if (!title || !draft) {
      try {
        const res = await fetch(`/api/v1/articles/${articleId}`, {
          headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (res.ok) {
          const { article } = await res.json();
          title = article.title;
          draft = article.current_content;
          articleId = article.id;
        }
      } catch { return; }
    }

    window.currentArticleId = articleId;
    const mainPanel = document.getElementById('mainPanel');
    const wordCount = draft?.trim().split(/\s+/).filter(Boolean).length ?? 0;

    mainPanel.innerHTML = `
      <div id="articleEditorContainer" class="panel-container">
      <div class="panel-main">
      <div class="editor-topbar">
        <button onclick="navigateTo('articles')" class="back-btn">← Articles</button>
        <div class="editor-title" contenteditable="true" id="articleTitle"
             spellcheck="false">${title || 'Untitled'}</div>
        <div class="editor-meta">
          <span id="wordCount">${wordCount}</span> words
          · <span id="saveIndicator"></span>
        </div>
        <div class="editor-actions">
          <button onclick="chatAssist.toggle()" class="action-btn muted">✦ Ask Claude</button>
          <button onclick="reviewArticleDraft('${session?.id}', '${articleId}')"
                  class="action-btn muted">◆ Review draft</button>
          <button onclick="copyAllContent()" class="action-btn muted">Copy all</button>
          <button onclick="markAsPublished('${articleId}')"
                  class="action-btn primary">Publish →</button>
        </div>
      </div>
      <div
        id="articleEditor"
        class="article-editor-body"
        contenteditable="true"
        spellcheck="true"
      >${draft || ''}</div>
      <div class="editor-footer">
        ✦ Career OS is watching · Edits refine your voice twin
      </div>
      </div><!-- panel-main -->
      </div><!-- articleEditorContainer -->
    `;

    const tracker = new ArticleEditTracker(
      null,
      session?.id,
      articleId,
      draft || ''
    );

    const editorEl = document.getElementById('articleEditor');
    editorEl.addEventListener('input', () => {
      tracker.onContentChange(editorEl.innerText);
    });

    editorEl.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    initSelectionMenu('articleEditor', session?.id, articleId);

    window.chatAssist = new ChatAssistPanel(
      document.getElementById('articleEditorContainer'),
      {
        type: 'article',
        sessionId: session?.id,
        articleId,
        getCurrentText: () => document.getElementById('articleEditor')?.innerText?.trim() || ''
      }
    );
  };

  window.copyAllContent = function() {
    const content = document.getElementById('articleEditor')?.innerText;
    if (content) navigator.clipboard.writeText(content).catch(() => {});
    showToast('Article copied');
    fetch('/api/v1/events/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: session?.id, event_name: 'copy_article_full', metadata: {} })
    }).catch(() => {});
  };

  window.reviewArticleDraft = function(sessionId, articleId) {
    reviewArticleDraft(sessionId, articleId);
  };

  window.markAsPublished = async function(articleId, platform = 'linkedin') {
    const publishedUrl = prompt('Optional: paste the published URL to track it', '') || null;

    try {
      const res = await fetch(`/api/v1/articles/${articleId}/publish`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ session_id: session?.id, platform, published_url: publishedUrl })
      });

      if (!res.ok) throw new Error('publish failed');

      fetch('/api/v1/events/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: session?.id,
          event_name: 'article_published',
          metadata: { article_id: articleId, platform }
        })
      }).catch(() => {});

      showToast('Published ✓ — added to your career graph');
      window.navigateTo('articles');
    } catch {
      showToast('Publish requires backend — coming soon');
    }
  };
}
