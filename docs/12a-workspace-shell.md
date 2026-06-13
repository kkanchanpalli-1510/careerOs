# Career OS — Doc 12a: Workspace Shell

## What This Builds

The navigation shell that returning users land in.
No content panels yet — just the layout, routing, and
session detection logic.

Doc 12b through 12e add content into this shell.
Build and test this before starting 12b.

---

## Context

Read career-os-docs/12-career-workspace.md Feature 1
for the full design rationale. This file is the build spec.

The core shift: graph-first was right for session 1.
Workspace-first is right for sessions 2 through 100.

---

## Session Detection

```typescript
// src/lib/routing.ts

export function getDefaultRoute(session: CareerSession): string {
  // First visit — no insight yet, show graph for wow moment
  if (!session.insights?.strength) return '/graph';

  // Returning user — show workspace
  return '/workspace';
}
```

Wire to the frontend router:
- After login, load the user's primary session
- Call `getDefaultRoute(session)` and redirect
- Never hardcode `/workspace` as default — always check session state

---

## Layout Structure

Two-column layout. Left nav fixed at 200px.
Main panel fills remaining width.

```
┌──────────────────────────────────────────────────────────┐
│  ◈ Career OS                         [You]  [Partner]    │
├───────────┬──────────────────────────────────────────────┤
│           │                                              │
│  LEFT NAV │  MAIN PANEL                                  │
│  200px    │  flex: 1                                     │
│           │                                              │
│           │  [renders based on nav selection]            │
│           │                                              │
└───────────┴──────────────────────────────────────────────┘
```

---

## Left Navigation Component

```javascript
// frontend/components/WorkspaceNav.js

const NAV_ITEMS = [
  {
    section: 'Profile',
    items: [
      { id: 'strength',   icon: '◆', label: 'Core Strength',    color: 'gold'   },
      { id: 'directions', icon: '⟡', label: 'Directions',        color: 'blue'   },
      { id: 'portrait',   icon: '◈', label: 'Career Portrait',   color: 'green'  },
    ]
  },
  {
    section: 'Publish',
    items: [
      { id: 'headline',   icon: '—', label: 'LinkedIn Headline', color: 'default' },
      { id: 'summary',    icon: '—', label: 'LinkedIn Summary',  color: 'default' },
      { id: 'bio',        icon: '—', label: 'Short Bio',         color: 'default' },
      { id: 'articles',   icon: '—', label: 'Articles',          color: 'default',
        badge: () => getArticleCount() },
    ]
  },
  {
    section: null,  // no section header — bottom nav
    items: [
      { id: 'graph',    icon: '↗', label: 'Graph',    color: 'default', external: true },
      { id: 'settings', icon: '⚙', label: 'Settings', color: 'default' },
    ]
  }
];

function renderNav(activeId) {
  return NAV_ITEMS.map(section => `
    ${section.section
      ? `<div class="nav-section-label">${section.section}</div>`
      : '<div class="nav-sep"></div>'}
    ${section.items.map(item => `
      <div class="nav-item ${activeId === item.id ? 'active' : ''}"
           data-id="${item.id}"
           onclick="navigateTo('${item.id}')">
        <span class="nav-icon" style="color:var(--${item.color === 'default' ? 't3' : item.color})">
          ${item.icon}
        </span>
        <span class="nav-label">${item.label}</span>
        ${item.badge ? `<span class="nav-badge">${item.badge()}</span>` : ''}
        ${item.external ? `<span class="nav-external">↗</span>` : ''}
      </div>
    `).join('')}
  `).join('');
}
```

---

## Main Panel Routing

```javascript
// frontend/workspace.js

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

async function navigateTo(panelId) {
  if (panelId === 'graph') {
    openGraphView();
    return;
  }

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === panelId);
  });

  // Load and render panel
  const mainPanel = document.getElementById('mainPanel');
  mainPanel.innerHTML = '<div class="panel-loading">···</div>';

  const { render } = await PANEL_LOADERS[panelId]();
  mainPanel.innerHTML = '';
  render(mainPanel, currentSession);

  // Update URL without reload
  history.pushState({ panel: panelId }, '', `/workspace/${panelId}`);
}

// Default to strength on workspace load
navigateTo('strength');
```

---

## Graph View — Full Screen with Back Button

When user clicks Graph in the nav, the graph opens full screen.
Not a new page — the workspace panels hide and the graph fills
the window. Back button returns to the previous panel.

```javascript
function openGraphView() {
  const workspace = document.getElementById('workspace');
  const graphContainer = document.getElementById('graphContainer');
  const backBtn = document.getElementById('graphBackBtn');

  // Hide workspace, show graph
  workspace.style.display = 'none';
  graphContainer.style.display = 'flex';
  graphContainer.style.flexDirection = 'column';

  // Back button
  backBtn.style.display = 'flex';
  backBtn.onclick = () => {
    graphContainer.style.display = 'none';
    workspace.style.display = 'grid';
  };
}
```

Graph back button fixed at top of graph view:
```
← Back to workspace    ◈ Career OS    [nodes: 18]  [edges: 24]
```

---

## Nudge Banner Slot

The workspace header includes a reserved slot for the nudge
banner. Empty by default. Feature 5 (doc 12c) populates it.

```html
<div id="nudgeBanner" class="nudge-banner" style="display:none;">
  <!-- populated by doc 12c -->
</div>
```

This slot must exist in the shell even though 12c builds the content.

---

## CSS — Workspace Shell

```css
/* Workspace layout */
#workspace {
  display: grid;
  grid-template-columns: 200px 1fr;
  grid-template-rows: 44px 1fr;
  height: 100vh;
  background: var(--bg);
}

/* Top bar spans full width */
#workspaceTopbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--b1);
  background: var(--s1);
  gap: 12px;
}

/* Left nav */
#workspaceNav {
  border-right: 1px solid var(--b1);
  background: var(--s1);
  padding: 12px 0;
  overflow-y: auto;
}

/* Main panel */
#mainPanel {
  overflow-y: auto;
  padding: 24px 32px;
}

/* Nav items */
.nav-section-label {
  font-family: 'DM Mono', monospace;
  font-size: 7px;
  color: var(--t4);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 10px 16px 4px;
}

.nav-sep {
  height: 1px;
  background: var(--b1);
  margin: 8px 12px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 16px;
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 0;
  position: relative;
}

.nav-item:hover { background: rgba(255,255,255,0.02); }

.nav-item.active {
  background: rgba(255,255,255,0.03);
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0; top: 20%; bottom: 20%;
  width: 2px;
  background: var(--gold);
  border-radius: 0 2px 2px 0;
}

.nav-icon {
  font-size: 10px;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

.nav-label {
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  color: var(--t2);
  flex: 1;
}

.nav-item.active .nav-label { color: var(--t1); }

.nav-badge {
  font-family: 'DM Mono', monospace;
  font-size: 8px;
  color: var(--t3);
  background: var(--s2);
  border: 1px solid var(--b1);
  padding: 1px 5px;
  border-radius: 3px;
}

/* Panel loading state */
.panel-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  font-family: 'DM Mono', monospace;
  font-size: 12px;
  color: var(--t4);
  letter-spacing: 0.2em;
}

/* Graph back button */
#graphBackBtn {
  position: fixed;
  top: 10px; left: 16px;
  z-index: 100;
  display: none;
  align-items: center;
  gap: 6px;
  font-family: 'DM Mono', monospace;
  font-size: 9px;
  color: var(--t2);
  background: rgba(0,0,0,0.8);
  border: 1px solid var(--b2);
  padding: 5px 12px;
  border-radius: 3px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.15s;
}

#graphBackBtn:hover { color: var(--t1); border-color: var(--b3); }
```

---

## Empty Panel States

Each panel slot shows a placeholder until doc 12b/12c/12d/12e
builds the real content. Placeholder just shows the panel name:

```javascript
// Default panel render — replaced by each doc
function renderEmptyPanel(panelId, container) {
  container.innerHTML = `
    <div style="padding:40px; color:var(--t3);
                font-family:'DM Mono',monospace; font-size:11px;">
      ${panelId} panel — coming in next build session
    </div>
  `;
}
```

---

## Done Signal

This session is complete when:

1. `/workspace` loads with left nav and empty main panel
2. Clicking nav items switches the main panel content
3. Active nav item shows amber left border
4. Graph nav item opens full-screen graph
5. Back button returns to workspace on the panel that was active
6. Session detection works: new user → /graph, returning user → /workspace
7. Nudge banner slot exists in DOM (empty, display:none)

Do not start 12b until all seven are working.
