// frontend/nudge.js — nudge banner + panel

function getToken() {
  return window.__careerToken ?? '';
}

// ── Banner ─────────────────────────────────────────────────────────────────

export async function loadNudgeBanner(sessionId) {
  const banner = document.getElementById('nudgeBanner');
  if (!banner) return;
  if (sessionStorage.getItem('nudge_dismissed')) return;

  let nudge;
  try {
    const res = await fetch(`/api/v1/sessions/${sessionId}/next-nudge`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (!res.ok) return;
    ({ nudge } = await res.json());
  } catch {
    return;
  }

  if (!nudge) return;

  banner.style.display = 'flex';
  banner.innerHTML = `
    <div class="nudge-banner-dot"></div>
    <div class="nudge-banner-text">
      <strong>${nudge.node.label}</strong> is central but sparse —
      ${nudge.reason.notableConnections.length > 0
        ? `connects to ${nudge.reason.notableConnections.slice(0, 2).join(' and ')}`
        : `${nudge.reason.connectionCount} connections`}
      · Would strengthen your LinkedIn summary
    </div>
    <button class="nudge-banner-btn"
            onclick="openNudgePanel('${nudge.node.id}')">
      Add detail →
    </button>
    <button class="nudge-banner-dismiss" onclick="dismissNudge()">×</button>
  `;

  window.currentNudge = nudge;
}

window.dismissNudge = function() {
  const banner = document.getElementById('nudgeBanner');
  if (banner) banner.style.display = 'none';
  sessionStorage.setItem('nudge_dismissed', '1');
};

// ── Panel ──────────────────────────────────────────────────────────────────

window.openNudgePanel = async function(nodeId) {
  const nudge = window.currentNudge;
  if (!nudge || nudge.node.id !== nodeId) return;

  // Close any existing panel
  document.getElementById('nudgePanel')?.remove();

  const panel = createNudgePanelElement(nudge.node, nudge.reason, null);
  document.body.appendChild(panel);
  setTimeout(() => panel.classList.add('open'), 16);

  // Phase 2 — load question
  try {
    const sessionId = window.currentSession?.id;
    if (!sessionId) throw new Error('no session');

    const { question } = await fetch(
      `/api/v1/sessions/${sessionId}/nudge-question`,
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
  } catch {
    updateNudgePanelQuestion(panel, 'What would you want someone to know about this experience?');
  }
};

function createNudgePanelElement(node, reason, question) {
  const el = document.createElement('div');
  el.className = 'nudge-panel';
  el.id = 'nudgePanel';
  el.innerHTML = `
    <div class="nudge-panel-header">
      <div class="nudge-panel-title">◆ One experience worth developing</div>
      <button onclick="closeNudgePanel()" class="nudge-panel-skip">Skip →</button>
    </div>

    <div class="nudge-panel-node">${node.label}</div>

    <div class="nudge-section-label">WHY THIS ONE</div>
    <div class="nudge-reason-text">
      ${reason.centralitySentence}<br>
      ${reason.recencySentence}<br>
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
        : `<div class="nudge-q-loading"><span></span><span></span><span></span></div>`
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
  const el = panel.querySelector('#nudgeQuestion');
  if (el) el.innerHTML = `<div class="nudge-q-text">"${question}"</div>`;
}

window.closeNudgePanel = function() {
  const panel = document.getElementById('nudgePanel');
  if (!panel) return;
  panel.classList.remove('open');
  setTimeout(() => panel.remove(), 300);
};

window.saveEnrichment = async function(nodeId) {
  const answer = document.getElementById('nudgeAnswer')?.value.trim();
  const year = document.getElementById('nudgeYear')?.value.trim();

  if (!answer || answer.length < 20) {
    const ta = document.getElementById('nudgeAnswer');
    if (ta) ta.style.borderColor = '#ef4444';
    return;
  }

  const saveBtn = document.querySelector('.nudge-save-btn');
  if (saveBtn) { saveBtn.textContent = 'Saving…'; saveBtn.disabled = true; }

  try {
    const sessionId = window.currentSession?.id;
    const result = await fetch(
      `/api/v1/sessions/${sessionId}/enrich-node`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ node_id: nodeId, detail: answer, year })
      }
    ).then(r => r.json());

    animateNodeEnrichment(nodeId);
    window.closeNudgePanel();
    showToast('Graph updated — outputs will refine shortly');

    const banner = document.getElementById('nudgeBanner');
    if (banner) banner.style.display = 'none';

    // Update local session graph state
    if (window.currentSession?.graph_data && result.updated_node) {
      window.currentSession.graph_data.nodes = window.currentSession.graph_data.nodes.map(n =>
        n.id === nodeId ? result.updated_node : n
      );
    }
  } catch {
    if (saveBtn) { saveBtn.textContent = 'Save to graph'; saveBtn.disabled = false; }
  }
};

// ── Graph node visual helpers ──────────────────────────────────────────────

export function getNodeStyle(node, enrichedNodeIds) {
  const { isNodeSparse } = window.__nodeEnrichment || {};
  const sparse = isNodeSparse
    ? isNodeSparse(node) && !enrichedNodeIds.includes(node.id)
    : false;

  return {
    strokeDasharray: sparse ? '3,2' : 'none',
    opacity: sparse ? '0.6' : '1.0',
    labelFill: sparse ? '#333' : '#505050',
    title: sparse ? `${node.label} — click to add detail` : node.label
  };
}

export function animateNodeEnrichment(nodeId) {
  const nodeEl = document.getElementById(`node-${nodeId}`);
  if (!nodeEl) return;

  nodeEl.setAttribute('stroke-dasharray', 'none');
  nodeEl.setAttribute('opacity', '1');
  nodeEl.style.transition = 'all 0.3s';
  nodeEl.setAttribute('stroke', 'var(--gold)');
  nodeEl.setAttribute('stroke-width', '3');

  setTimeout(() => {
    nodeEl.setAttribute('stroke-width', '2');
  }, 800);
}

window.animateNodeEnrichment = animateNodeEnrichment;

// ── Toast ──────────────────────────────────────────────────────────────────

export function showToast(message) {
  const existing = document.getElementById('careerToast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'careerToast';
  toast.className = 'career-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('visible'), 16);
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

window.showToast = showToast;
