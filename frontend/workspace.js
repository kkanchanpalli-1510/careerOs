// frontend/workspace.js
import { getDefaultRoute } from '../src/lib/routing.js';
import { renderNav } from './components/WorkspaceNav.js';
import { loadNudgeBanner } from './nudge.js';

// ── Session state ──────────────────────────────────────────────────────────
// Populated by auth flow (Supabase) before workspace loads.
// In dev: ?mock=returning or ?mock=new overrides session detection.
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
    // Real session — read from Supabase if available
    currentSession = window.__careerSession ?? null;
  }

  // Session detection: redirect new users to graph
  const target = getDefaultRoute(currentSession ?? {});
  if (target === '/graph' && !location.pathname.startsWith('/graph')) {
    location.replace('/graph');
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
