# Career OS — Frontend Status and Backend Wiring Guide

## What's Built

The full interactive frontend demo is complete as a single HTML file (`career-os-interactive.html`). It demonstrates the entire product loop end-to-end.

### Features Implemented

**Graph system:**
- Force-layout physics simulation (custom, no D3 dependency)
- Staggered node entrance animation by type (roles → decisions → skills → projects → outcomes)
- Edge draw animation after nodes settle
- Weight-3 nodes have idle breathing glow animation
- Draggable nodes with real-time edge redraw
- Hover highlights connected edges in node's type color
- Ghost nodes for goal delta (dashed border, pink, pulsing)

**Interactive nodes:**
- Click any node → detail panel slides in from right
- Editable label, detail, year fields with save
- Connected nodes shown as colored tags
- Per-node Claude chat with conversation history
- Chat history persists per node per session

**Outcome card stack (graph panel, bottom):**
- Layer 1: Core Strength — amber border, slides up when insight typed
- Layer 2: Career Directions — blue border, 3 direction cards with timeline badges
- Layer 3: Career Portrait — green border, identity + celebration + rare factor + next action + gap
- Each card independently collapsible via tab row
- All three persist across session restore

**Session system:**
- You / Partner switcher — completely isolated state per session
- Full session persistence via localStorage
- Restore on page load with "✓ Sessions restored" toast
- Auto-save on meaningful state changes (debounced on drag)
- Clear Sessions button with confirmation

**Conversation panel:**
- Four targeted questions with inline textarea
- Graph enriches in real time after each answer (new node appears with dashed border + pulse)
- Branch selection in directions card, not conversation panel
- Final synthesis writes to portrait card, not conversation panel

**API integration:**
- Test Key button in header — validates before session starts
- JSON repair fallback for truncated responses
- All prompts grounded only in session data — no hardcoded career info
- Model: `claude-sonnet-4-6`

---

## What Needs to Change for Backend Integration

### 1. Remove API Key Input
The header API key field and Test Key button are replaced by auth UI.

```html
<!-- REMOVE -->
<div class="api-row">
  <label>API Key</label>
  <input class="api-inp" type="password" id="apiKey">
  <button onclick="testKey()">Test Key</button>
</div>

<!-- REPLACE WITH -->
<div id="authStatus">
  <span id="userEmail"></span>
  <button onclick="signOut()">Sign out</button>
</div>
```

### 2. Replace the `claude()` Function

Current implementation calls Anthropic directly from the browser:
```javascript
// CURRENT — remove this
async function claude(prompt, max=2000) {
  const key = document.getElementById('apiKey').value.trim();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    headers: { 'x-api-key': key, ... }
  });
}
```

Replace with backend proxy:
```javascript
// NEW — calls backend, which holds the API key
async function callBackend(task, params) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API_URL}/api/v1/claude/${task}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API error');
  return data;
}
```

### 3. Replace localStorage with Database Calls

Current: `localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))`

New: API calls to `/api/v1/sessions/:id`

```javascript
// Save session state
async function saveSessions() {
  const session = S();
  await fetch(`${API_URL}/api/v1/sessions/${session.id}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      graph_data: session.graphData,
      node_positions: session.nodePositions,
      answers: session.answers,
      insights: session.insights,
      selected_branch: session.selectedBranch,
      card_states: session.cardStates,
      step: session.step
    })
  });
}

// Load session on startup
async function loadSessions() {
  const res = await fetch(`${API_URL}/api/v1/sessions`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const { sessions } = await res.json();
  // Restore state from sessions array
}
```

### 4. Add Auth Flow

```javascript
// Add Supabase client
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Auth state listener
supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    document.getElementById('userEmail').textContent = session.user.email;
    loadSessions(); // restore user's sessions from DB
  } else {
    showAuthScreen(); // show login
  }
});

// Sign in
async function signIn(email) {
  await supabase.auth.signInWithOtp({ email });
  // User clicks link in email → redirected back → auth state changes
}

// Sign out
async function signOut() {
  await supabase.auth.signOut();
}
```

### 5. Update Claude Call Sites

Each `claude()` call maps to a backend route:

| Current call | New backend route | Task type |
|---|---|---|
| Graph extraction prompt | POST /claude/extract | graph_extraction |
| Insight generation prompt | POST /claude/insight | insight_generation |
| Branch generation prompt | POST /claude/branches | branch_generation |
| Gap enrichment prompt | POST /claude/enrich | gap_enrichment |
| Final synthesis prompt | POST /claude/synthesis | final_synthesis |
| Node chat prompt | POST /claude/node-chat | node_chat |
| Resume projection prompt | POST /claude/project | resume_projection |

### 6. Remove repairJSON()

The context assembler handles token ceiling enforcement server-side. The frontend receives complete, valid JSON from the backend. Remove the client-side JSON repair function.

---

## What Stays the Same

- All SVG graph rendering code
- All animation logic
- All drag and drop system
- All node detail panel
- Outcome card stack system
- Session switcher UI
- All CSS and visual design
- The `assembleContext` behavior is now server-side but the results are identical

---

## Environment Config for Frontend

```javascript
// config.js
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';  // safe to expose
const API_URL = 'https://your-railway-app.railway.app';
```

---

## Auth Screen (add before graph UI)

Simple email magic link flow — no password:

```html
<div id="authScreen" style="display:flex;flex-direction:column;align-items:center;
  justify-content:center;height:100vh;gap:20px;background:var(--bg);">
  <div class="logo-text">Career OS</div>
  <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--text2);">
    Enter your email to continue
  </div>
  <input type="email" id="emailInput" placeholder="you@example.com"
    style="[...existing input styles...]">
  <button onclick="signIn(document.getElementById('emailInput').value)"
    class="start-btn">Continue →</button>
  <div id="authMessage" style="font-family:'DM Mono',monospace;font-size:10px;
    color:var(--green);display:none;">
    Check your email for a sign-in link
  </div>
</div>
```

---

## Current Demo Files

| File | Status | Notes |
|---|---|---|
| `career-os-interactive.html` | Complete | Full working demo, localStorage persistence |
| `career-os-sharable.html` | Complete | Version for sharing with API key input visible |
| `career-os-demo.html` | Complete | Version with embedded key slot (for Netlify) |
| `career-os-overview.html` | Complete | Product overview document |

All files are self-contained single HTML files. No build step required for the frontend at this stage.
