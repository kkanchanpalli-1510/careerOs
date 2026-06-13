// frontend/lib/articleReview.js

function getToken() { return window.__careerToken ?? ''; }

export async function reviewArticleDraft(sessionId, articleId) {
  const editor = document.getElementById('articleEditor');
  if (!editor) return;

  const articleText = editor.innerText.trim();
  if (!articleText || articleText.length < 100) return;

  const existing = document.getElementById('reviewPanel');
  if (existing) existing.remove();

  const reviewPanel = createReviewPanel();
  document.getElementById('mainPanel').appendChild(reviewPanel);

  // Log event
  fetch('/api/v1/events/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      event_name: 'article_review_requested',
      metadata: { article_id: articleId }
    })
  }).catch(() => {});

  try {
    const res = await fetch('/api/v1/claude/article-review', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ session_id: sessionId, article_id: articleId, article_text: articleText })
    });

    if (!res.ok) throw new Error('review failed');
    const { observations, overall } = await res.json();
    window._currentObservations = observations;
    window._currentReviewSessionId = sessionId;
    renderReviewResults(reviewPanel, observations, overall, articleId);
  } catch {
    renderReviewError(reviewPanel);
  }
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
      <div class="review-dots"><span></span><span></span><span></span></div>
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
            <button class="obs-apply-btn"
              onclick="applyReviewSuggestion(${i}, '${articleId}')"
            >Apply suggestion</button>
          </div>
          <div class="obs-location">"${obs.location}"</div>
          <div class="obs-issue">${obs.issue}</div>
          <div class="obs-suggestion">${obs.suggestion}</div>
        </div>
      `).join('')}
    </div>
    ${overall ? `<div class="review-overall">"${overall}"</div>` : ''}
  `;
}

function renderReviewError(panel) {
  panel.innerHTML = `
    <div class="review-header">
      <div class="review-title">◆ Review draft</div>
      <button onclick="closeReviewPanel()" class="review-close">×</button>
    </div>
    <div class="review-loading" style="color:var(--t3)">
      Review requires backend — coming soon
    </div>
  `;
}

window.closeReviewPanel = function() {
  const panel = document.getElementById('reviewPanel');
  if (panel) panel.remove();
};

window.applyReviewSuggestion = async function(obsIdx, articleId) {
  const obs = window._currentObservations?.[obsIdx];
  if (!obs) return;

  const sessionId = window._currentReviewSessionId;
  const editor = document.getElementById('articleEditor');
  if (!editor) return;

  const obsEl = document.getElementById(`obs-${obsIdx}`);
  const applyBtn = obsEl?.querySelector('.obs-apply-btn');
  if (applyBtn) { applyBtn.textContent = '···'; applyBtn.disabled = true; }

  try {
    const res = await fetch('/api/v1/claude/article-enhance-selection', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: sessionId,
        article_id: articleId,
        selected_text: obs.location,
        action: 'rewrite',
        instruction_override: obs.suggestion
      })
    });

    if (!res.ok) throw new Error('enhance failed');
    const { enhanced_text } = await res.json();

    if (enhanced_text) {
      editor.innerText = editor.innerText.replace(obs.location, enhanced_text);
      editor.dispatchEvent(new Event('input'));
      if (obsEl) obsEl.classList.add('applied');
    }
  } catch {
    if (applyBtn) { applyBtn.textContent = 'Apply suggestion'; applyBtn.disabled = false; }
  }
};
