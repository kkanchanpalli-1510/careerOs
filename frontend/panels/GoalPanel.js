// frontend/panels/GoalPanel.js — Doc 13: Goal Graph (v2)

import { getToken, fetchBackend, callBackend, showToast, currentSessionId } from '../workspace.js';

export async function render(container, session) {
  const hasGoal   = !!session.goal_title;
  const ghostNodes = (session.graph_data?.nodes ?? []).filter(n => n.ghost);
  const closedCount = ghostNodes.filter(n => (n.ghost_progress ?? 0) >= 0.8).length;
  const openNodes   = ghostNodes.filter(n => (n.ghost_progress ?? 0) < 0.8)
    .sort((a, b) => b.weight - a.weight);

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Career Goal</div>
    </div>

    ${hasGoal ? `
      <div class="goal-current">
        <div class="goal-title-display">⟶ ${session.goal_title}</div>
        <button onclick="changeGoal()" class="action-btn muted">Change goal</button>
      </div>

      <div class="goal-progress">
        <div class="goal-progress-label">
          ${closedCount} of ${ghostNodes.length} gaps closed
        </div>
        <div class="goal-progress-bar">
          <div class="goal-progress-fill"
               style="width:${ghostNodes.length ? Math.round((closedCount / ghostNodes.length) * 100) : 0}%">
          </div>
        </div>
      </div>

      <div class="ghost-node-list">
        <div class="ghost-list-header">Open gaps</div>
        ${openNodes.map(renderGhostNodeRow).join('') || '<div class="ghost-empty">All gaps closed ✓</div>'}

        ${closedCount > 0 ? `
          <div class="ghost-list-header" style="margin-top:20px">Closed gaps</div>
          ${ghostNodes.filter(n => (n.ghost_progress ?? 0) >= 0.8).map(renderClosedRow).join('')}
        ` : ''}
      </div>
    ` : `
      <div class="goal-empty">
        <div class="goal-empty-title">Where are you headed?</div>
        <div class="goal-empty-desc">
          Set a target role. Career OS will show you exactly what gaps stand between
          where you are and where you want to be — and help you close them through
          your writing and experience.
        </div>
        <div class="goal-input-row">
          <input id="goalTitleInput" class="goal-input"
                 placeholder="e.g. VP of Data, Principal Engineer, Head of Product"
                 onkeydown="if(event.key==='Enter') setGoal()"/>
          <button onclick="setGoal()" class="action-btn primary" id="setGoalBtn">
            Show my gaps →
          </button>
        </div>
      </div>
    `}
  `;

  // Expose panel-level functions on window (inline onclick handlers)
  window.setGoal = setGoal;
  window.changeGoal = changeGoal;
  window.writeForGap = writeForGap;
}

function renderGhostNodeRow(node) {
  const pct = Math.round((node.ghost_progress ?? 0) * 100);
  return `
    <div class="ghost-node-row">
      <div class="ghost-node-type-badge ${node.type}">${node.type}</div>
      <div class="ghost-node-body">
        <div class="ghost-node-label">${node.label}</div>
        <div class="ghost-node-detail">${node.detail ?? ''}</div>
        ${pct > 0 ? `
          <div class="ghost-progress-bar">
            <div class="ghost-progress-fill" style="width:${pct}%"></div>
            <span class="ghost-progress-pct">${pct}%</span>
          </div>
        ` : ''}
      </div>
      <button onclick="writeForGap('${node.id}')" class="ghost-node-write-btn"
              title="Write an article to close this gap">✦ Write</button>
    </div>
  `;
}

function renderClosedRow(node) {
  return `
    <div class="ghost-node-row closed">
      <div class="ghost-node-type-badge ${node.type}">${node.type}</div>
      <div class="ghost-node-body">
        <div class="ghost-node-label">${node.label} ✓</div>
        <div class="ghost-node-detail muted">
          Closed by ${node.ghost_filled_by?.length ?? 1} article(s)
        </div>
      </div>
    </div>
  `;
}

async function setGoal() {
  const input = document.getElementById('goalTitleInput');
  const btn   = document.getElementById('setGoalBtn');
  const goalTitle = input?.value.trim();
  if (!goalTitle) return;

  if (input) input.disabled = true;
  if (btn) { btn.textContent = 'Mapping gaps…'; btn.disabled = true; }

  try {
    const sid = currentSessionId();
    await callBackend(`claude/goal-graph`, {
      method: 'POST',
      body: JSON.stringify({ session_id: sid, goal_title: goalTitle }),
    });

    // Reload session + re-render
    const sessions = await fetchBackend('sessions');
    const session  = sessions.find(s => s.id === sid) ?? sessions[0];
    if (session) {
      window.__currentSession = session;
      const container = document.getElementById('mainPanel');
      if (container) await render(container, session);
    }
    showToast(`Goal set — ${goalTitle}`);
  } catch {
    if (input) input.disabled = false;
    if (btn) { btn.textContent = 'Show my gaps →'; btn.disabled = false; }
    showToast('Could not generate goal graph — try again');
  }
}

async function changeGoal() {
  if (!confirm('This will replace your current goal and ghost nodes. Continue?')) return;
  const sid = currentSessionId();
  await callBackend(`sessions/${sid}/goal`, { method: 'DELETE' });

  const sessions = await fetchBackend('sessions');
  const session  = sessions.find(s => s.id === sid) ?? sessions[0];
  if (session) {
    window.__currentSession = session;
    const container = document.getElementById('mainPanel');
    if (container) await render(container, session);
  }
}

function writeForGap(ghostNodeId) {
  // Navigate to articles panel with ghost node pre-targeted
  if (window.navigateTo) {
    window.navigateTo('articles');
    setTimeout(() => {
      if (window.openNewArticle) window.openNewArticle(ghostNodeId);
    }, 150);
  }
}
