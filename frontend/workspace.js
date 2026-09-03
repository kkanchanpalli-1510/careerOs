// frontend/workspace.js
import { renderNav } from './components/WorkspaceNav.js';
import { loadNudgeBanner, showToast as _showToast } from './nudge.js';

// ── API config ─────────────────────────────────────────────────────────────
const BACKEND_URL  = '';
const _SUPA_PREFIX = 'rltvhwzyezkqidgcnbrw';

export function getToken() {
  try {
    const raw = localStorage.getItem(`sb-${_SUPA_PREFIX}-auth-token`);
    if (!raw) return window.__careerToken ?? '';
    return JSON.parse(raw)?.access_token ?? '';
  } catch {
    return window.__careerToken ?? '';
  }
}

export async function fetchBackend(path) {
  const res = await fetch(`${BACKEND_URL}/api/v1/${path}`, {
    headers: { 'Authorization': `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(`fetchBackend ${path} → ${res.status}`);
  return res.json();
}

export async function callBackend(path, options = {}) {
  const headers = { 'Authorization': `Bearer ${getToken()}`, ...options.headers };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BACKEND_URL}/api/v1/${path}`, { ...options, headers });
  if (!res.ok) throw new Error(`callBackend ${path} → ${res.status}`);
  return res.json();
}

export function showToast(msg) { _showToast(msg); }

export function currentSessionId() { return currentSession?.id ?? null; }

// ── Session state ──────────────────────────────────────────────────────────
export let currentSession = null;

// ── Panel registry ─────────────────────────────────────────────────────────
const PANEL_LOADERS = {
  strength:   () => import('./panels/StrengthPanel.js'),
  directions: () => import('./panels/DirectionsPanel.js'),
  portrait:   () => import('./panels/PortraitPanel.js'),
  headline:   () => import('./panels/HeadlinePanel.js'),
  summary:    () => import('./panels/SummaryPanel.js'),
  bio:        () => import('./panels/BioPanel.js'),
  articles:   () => import('./panels/ArticlesPanel.js'),
  goal:       () => import('./panels/GoalPanel.js'),
  settings:   () => import('./panels/SettingsPanel.js'),
};

let _activePanelId = null;

// ── Navigation ─────────────────────────────────────────────────────────────
export async function navigateTo(panelId) {
  if (panelId === 'graph') {
    openGraphView();
    return;
  }

  _activePanelId = panelId;

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === panelId);
  });

  const mainPanel = document.getElementById('mainPanel');
  mainPanel.innerHTML = '<div class="panel-loading">···</div>';

  const loader = PANEL_LOADERS[panelId];
  if (!loader) {
    renderEmptyPanel(panelId, mainPanel);
    return;
  }

  const { render } = await loader();
  mainPanel.innerHTML = '';
  render(mainPanel, currentSession);

  history.pushState({ panel: panelId }, '', `/workspace/${panelId}`);
}

// ── Graph full-screen toggle ───────────────────────────────────────────────
export function openGraphView() {
  const workspace      = document.getElementById('workspace');
  const graphContainer = document.getElementById('graphContainer');
  const backBtn        = document.getElementById('graphBackBtn');

  workspace.style.display      = 'none';
  graphContainer.style.display = 'flex';
  graphContainer.style.flexDirection = 'column';

  backBtn.style.display = 'flex';
  backBtn.onclick = () => {
    graphContainer.style.display = 'none';
    workspace.style.display      = 'grid';
    backBtn.style.display        = 'none';
  };
}

// ── Empty panel fallback ───────────────────────────────────────────────────
function renderEmptyPanel(panelId, container) {
  container.innerHTML = `
    <div style="padding:40px; color:var(--t3);
                font-family:'DM Mono',monospace; font-size:11px;">
      ${panelId} panel — coming in next build session
    </div>
  `;
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  // Expose token globally so lib files (selectionMenu, articleReview, nudge) can read it
  window.__careerToken = getToken();

  // Dev shortcut: ?mock=new simulates a first-visit session
  const mock = new URLSearchParams(location.search).get('mock');
  if (mock === 'new') {
    currentSession = {};
  } else if (mock === 'full') {
    currentSession = {
      id: 'mock-session-id',
      insights: {
        strength: 'stub',
        short_bio: 'Sarah Chen is a product leader with 12 years building developer tools at scale. She has led teams at Stripe, Notion, and most recently Vercel, where she drove platform adoption from 50k to 2M developers. Her work sits at the intersection of infrastructure and craft.',
        linkedin_summary: 'I build products that developers love.\n\nFor 12 years I\'ve worked at the intersection of infrastructure and craft — at Stripe, Notion, and Vercel. My focus is the moment a developer first touches a new tool and decides whether to stay.\n\nI believe the best developer tools disappear. They accelerate thought without adding friction. That conviction has shaped every product decision I\'ve made.',
        linkedin_headline: 'Product Leader · Developer Tools · Stripe → Notion → Vercel',
      }
    };
  } else if (mock === 'returning') {
    currentSession = { insights: { strength: 'stub' } };
  } else {
    // Real session — prefer window.__careerSession injected by server, else fetch from API
    if (window.__careerSession) {
      currentSession = window.__careerSession;
    } else {
      try {
        const sessions = await fetchBackend('sessions');
        currentSession = Array.isArray(sessions) && sessions.length ? sessions[0] : null;
        if (currentSession) window.__currentSession = currentSession;
      } catch {
        currentSession = null;
      }
    }
  }

  // If no session and not in mock mode, go back to the main page to authenticate
  if (!currentSession && !mock) {
    location.replace('/');
    return;
  }

  // Render nav
  const navEl = document.getElementById('workspaceNav');
  navEl.innerHTML = renderNav('strength');

  // Default panel
  await navigateTo('strength');

  // Load nudge banner async — non-blocking
  if (currentSession?.id) {
    loadNudgeBanner(currentSession.id).catch(() => {});
  }
}

// Expose navigateTo globally so inline onclick handlers in renderNav work
window.navigateTo = navigateTo;

document.addEventListener('DOMContentLoaded', init);

// Browser back/forward
window.addEventListener('popstate', (e) => {
  if (e.state?.panel) navigateTo(e.state.panel);
});
