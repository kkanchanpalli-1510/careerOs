# Career OS — Doc 12f: Chat Assist Panel

## What This Builds

A Claude-powered chat panel available on three workspace tabs:
- Short Bio (bio)
- LinkedIn Summary (summary)
- Article editor (articles)

Users can ask Claude to help refine the draft in front of them.
Claude has the current text, their voice profile, and relevant
career context. Suggested rewrites include an Apply button that
replaces the content directly.

Prerequisite: 12b (editable outputs) and 12d (article editor)
must be working before starting this.

---

## Design Decisions

**Split panel, not overlay.**
A `✦ Ask Claude` button in each panel's action bar toggles a 340px
chat column on the right. The editor reflows to fill the remaining
width. This keeps both the text and the conversation visible
simultaneously without covering content.

**Apply button on revision suggestions.**
When Claude's response contains a suggested rewrite, it is
delimited with `---REVISED---` ... `---END---`. The frontend
detects this block and renders an "Apply →" button. Conversational
turns (questions, clarifications) do not get the button.
This is the same pattern used in the article selection menu (12e).

**In-memory conversation history.**
Chat history lives in JS state for the tab session. It resets on
navigation. Events table captures what matters for analytics.

**Context is tab-specific, component is shared.**
One `ChatAssistPanel` component handles UI, streaming, and the
apply mechanic. Each tab passes a different context object — the
component does not know which tab it is on.

**Voice signals from chat messages.**
Every user message > 30 words is passed to `updateVoiceFromAnswer()`
async — the same function used by node chat and onboarding answers.
Whether the user applies or ignores a suggestion is tracked as an
event. Both feed the voice profile.

---

## Step 1 — Shared ChatAssistPanel Component

```javascript
// frontend/components/ChatAssistPanel.js

/**
 * context shape:
 * {
 *   type: 'bio' | 'summary' | 'article',
 *   sessionId: string,
 *   articleId?: string,           // articles tab only
 *   getCurrentText: () => string  // live getter — reads contenteditable
 * }
 */

export class ChatAssistPanel {
  constructor(container, context) {
    this.container = container;
    this.context = context;
    this.messages = [];         // { role, content }[]
    this.pendingSuggestion = null;
    this.open = false;
  }

  toggle() {
    this.open ? this.close() : this.openPanel();
  }

  openPanel() {
    this.open = true;
    this.render();
    this.container.classList.add('chat-assist-open');
  }

  close() {
    this.open = false;
    this.container.classList.remove('chat-assist-open');
    const panel = document.getElementById('chatAssistPanel');
    if (panel) panel.remove();
  }

  render() {
    // Remove existing if present
    const existing = document.getElementById('chatAssistPanel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'chatAssistPanel';
    panel.className = 'chat-assist-panel';
    panel.innerHTML = `
      <div class="chat-assist-header">
        <span class="chat-assist-title">✦ Ask Claude</span>
        <button class="chat-assist-close" onclick="chatAssist.close()">✕</button>
      </div>
      <div class="chat-assist-messages" id="chatAssistMessages">
        <div class="chat-assist-hint">
          Ask me to refine this draft. Examples:<br>
          "Make the opening more direct"<br>
          "Shorten this by 30%"<br>
          "Add a specific example from my career"
        </div>
      </div>
      <div class="chat-assist-input-row">
        <textarea
          id="chatAssistInput"
          class="chat-assist-input"
          placeholder="What would you like to change?"
          rows="2"
        ></textarea>
        <button class="chat-assist-send" onclick="chatAssist.send()">→</button>
      </div>
    `;

    // Append to the right of the panel container
    this.container.appendChild(panel);

    // Enter key sends (shift+enter for newline)
    document.getElementById('chatAssistInput')
      .addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.send();
        }
      });

    // Render existing messages if re-opening
    this.messages.forEach(m => this.appendMessageBubble(m.role, m.content));
  }

  async send() {
    const input = document.getElementById('chatAssistInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.disabled = true;
    document.querySelector('.chat-assist-send').disabled = true;

    // Add user message to history and UI
    this.messages.push({ role: 'user', content: text });
    this.appendMessageBubble('user', text);

    // Track intent — fire and forget
    this.trackEvent('chat_assist_requested', { message: text.slice(0, 120) });

    // Voice signal from user message
    if (text.split(/\s+/).length > 30) {
      updateVoiceFromAnswer(currentUserId, this.context.sessionId, text, 'node_chat')
        .catch(() => {});
    }

    // If there was a pending suggestion that was not applied, track ignore
    if (this.pendingSuggestion) {
      this.trackEvent('chat_assist_ignored', {});
      this.pendingSuggestion = null;
    }

    // Build request payload
    const payload = {
      session_id: this.context.sessionId,
      tab_type: this.context.type,
      current_text: this.context.getCurrentText(),
      messages: this.messages.slice(-10), // last 10 turns max
      ...(this.context.articleId && { article_id: this.context.articleId })
    };

    // Show streaming placeholder
    const assistantBubble = this.appendMessageBubble('assistant', '');
    const contentEl = assistantBubble.querySelector('.bubble-content');

    try {
      const response = await fetch('/api/v1/claude/chat-assist', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      const fullText = data.content;

      // Render response
      const { display, revised } = this.parseResponse(fullText);
      contentEl.textContent = display;

      // Add assistant turn to history (full text, not display)
      this.messages.push({ role: 'assistant', content: fullText });

      // If revision block present, add Apply button
      if (revised) {
        this.pendingSuggestion = revised;
        const applyBtn = document.createElement('button');
        applyBtn.className = 'chat-assist-apply';
        applyBtn.textContent = 'Apply →';
        applyBtn.onclick = () => this.applyRevision(revised, applyBtn);
        assistantBubble.appendChild(applyBtn);
      }

    } catch (e) {
      contentEl.textContent = 'Something went wrong. Try again.';
      contentEl.style.color = 'var(--text3)';
    } finally {
      input.disabled = false;
      document.querySelector('.chat-assist-send').disabled = false;
      input.focus();
    }
  }

  parseResponse(text) {
    const revisedMatch = text.match(/---REVISED---\n([\s\S]*?)\n---END---/);
    if (!revisedMatch) {
      return { display: text, revised: null };
    }
    const revised = revisedMatch[1].trim();
    const display = text
      .replace(/---REVISED---[\s\S]*?---END---/, '')
      .trim();
    return { display, revised };
  }

  applyRevision(text, btn) {
    // Determine the right target element by tab type
    const targetId = {
      bio: 'bio-text',
      summary: 'summary-text',
      article: 'articleEditor'
    }[this.context.type];

    const el = document.getElementById(targetId);
    if (!el) return;

    el.innerText = text;
    el.dispatchEvent(new Event('input')); // triggers auto-save

    btn.textContent = 'Applied ✓';
    btn.disabled = true;
    btn.style.color = 'var(--green)';

    this.trackEvent('chat_assist_applied', {
      tab_type: this.context.type,
      char_count: text.length
    });

    this.pendingSuggestion = null;
  }

  appendMessageBubble(role, content) {
    const messages = document.getElementById('chatAssistMessages');
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-bubble-${role}`;
    bubble.innerHTML = `<div class="bubble-content">${content}</div>`;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  trackEvent(eventName, metadata) {
    fetch('/api/v1/events/copy', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: this.context.sessionId,
        event_name: eventName,
        metadata: {
          tab_type: this.context.type,
          ...metadata
        }
      })
    }).catch(() => {});
  }
}
```

---

## Step 2 — Wire Into Each Panel

### Bio Panel — add to BioPanel.js

```javascript
// In BioPanel render():

// Add button to panel-actions
`<button onclick="chatAssist.toggle()" class="action-btn muted">
  ✦ Ask Claude
</button>`

// After render, init the assist panel
import { ChatAssistPanel } from '../components/ChatAssistPanel.js';

const chatAssist = new ChatAssistPanel(
  document.getElementById('bioPanelContainer'),
  {
    type: 'bio',
    sessionId: session.id,
    getCurrentText: () => document.getElementById('bio-text')?.innerText?.trim() || ''
  }
);
// Expose for onclick
window.chatAssist = chatAssist;
```

### Summary Panel — same pattern

```javascript
// context:
{
  type: 'summary',
  sessionId: session.id,
  getCurrentText: () => document.getElementById('summary-text')?.innerText?.trim() || ''
}
```

### Article Editor — add to openArticleEditor() in 12d

```javascript
// Add to editor-actions in topbar HTML:
`<button onclick="chatAssist.toggle()" class="action-btn muted">
  ✦ Ask Claude
</button>`

// After wiring editor and tracker:
const chatAssist = new ChatAssistPanel(
  document.getElementById('mainPanel'),
  {
    type: 'article',
    sessionId: currentSessionId,
    articleId: articleId,
    getCurrentText: () => document.getElementById('articleEditor')?.innerText?.trim() || ''
  }
);
window.chatAssist = chatAssist;
```

---

## Step 3 — Backend Route

```typescript
// src/routes/claude.ts — add

router.post('/claude/chat-assist', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id, tab_type, current_text, messages, article_id } = req.body;

  const ALLOWED_TAB_TYPES = ['bio', 'summary', 'article'];
  if (!ALLOWED_TAB_TYPES.includes(tab_type)) {
    return res.status(400).json({ error: 'Invalid tab_type' });
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  // Get voice profile for context
  const voiceProfile = await getVoiceProfile(userId);

  // Build tab-specific system prompt
  const { system, contextBlock } = buildChatAssistPrompt(
    session,
    tab_type,
    current_text,
    voiceProfile,
    article_id
  );

  // Build messages with context prepended to first user turn
  const messagesWithContext = injectContext(messages, contextBlock);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system,
    messages: messagesWithContext
  });

  const content = response.content[0]?.text || '';

  res.json({ content });
});
```

---

## Step 4 — Prompt Builder

```typescript
// src/assembler/tasks/chatAssist.ts

export function buildChatAssistPrompt(
  session: CareerSession,
  tabType: 'bio' | 'summary' | 'article',
  currentText: string,
  voiceProfile: VoiceProfile | null,
  articleId?: string
): { system: string; contextBlock: string } {

  const voiceContext = voiceProfile?.confidence >= 0.4
    ? `Voice profile: ${voiceProfile.voice_note}
Best day standard: ${voiceProfile.best_day_note}`
    : 'Write in a direct, specific, first-person style.';

  const SYSTEM_BASE = `You are a trusted editor helping a professional
refine their career writing. You have their career graph, voice profile,
and the current draft.

Your role:
- Suggest specific, concrete improvements
- Preserve what sounds like them — change what undersells them
- Never be generic. Every suggestion should be grounded in their actual experience.
- When suggesting a revised version, output it in this exact format:

---REVISED---
[the full revised text here]
---END---

Then add one sentence explaining the key change you made.

If you are answering a question or asking a clarifying question,
do NOT include a REVISED block.

${voiceContext}

BANNED WORDS (never use): passionate, seasoned, proven, dynamic,
results-driven, thought leader, self-starter, leveraging, synergy`;

  const tabSystems = {
    bio: `${SYSTEM_BASE}

You are editing a Short Bio (100–150 words, third person).
Use for: speaker bios, about pages, team profiles, email signatures.
Limit: 150 words maximum. Do not exceed this in any revision.`,

    summary: `${SYSTEM_BASE}

You are editing a LinkedIn Summary.
Limit: 2,400 characters. Do not exceed this in any revision.
Three-paragraph structure: hook → evidence → forward direction.`,

    article: `${SYSTEM_BASE}

You are editing a LinkedIn or Substack article (600–900 words).
No section headers. Flowing prose. Opens with something concrete, not a general claim.`
  };

  // Build context block injected at the start of conversation
  const topNodes = session.graph_data?.nodes
    ?.filter((n: Node) => n.weight >= 2)
    ?.slice(0, 6)
    ?.map((n: Node) => `${n.label}: ${n.detail || ''}`)
    ?.join('\n') || '';

  const contextBlock = `Current draft:
"""
${currentText}
"""

Career context:
${session.career_summary || ''}

Key experiences:
${topNodes}

Career stage: ${detectStageProfile(session.graph_data).stage}`;

  return {
    system: tabSystems[tabType],
    contextBlock
  };
}

function injectContext(
  messages: { role: string; content: string }[],
  contextBlock: string
): { role: string; content: string }[] {
  if (messages.length === 0) return messages;

  // Prepend context to the first user message only
  return messages.map((m, i) => {
    if (i === 0 && m.role === 'user') {
      return {
        ...m,
        content: `${contextBlock}\n\n---\n\nUser request: ${m.content}`
      };
    }
    return m;
  });
}
```

---

## Step 5 — CSS

Add to the workspace stylesheet:

```css
/* Split panel layout */
.panel-container {
  display: flex;
  gap: 0;
  transition: gap 0.2s ease;
}

.panel-container.chat-assist-open {
  gap: 16px;
}

.panel-container.chat-assist-open .panel-main {
  flex: 1;
  min-width: 0;
}

/* Chat assist panel */
.chat-assist-panel {
  width: 340px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  height: calc(100vh - 120px);
  position: sticky;
  top: 20px;
}

.chat-assist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.chat-assist-title {
  font-family: 'DM Mono', monospace;
  font-size: 11px;
  color: var(--gold);
  letter-spacing: 0.05em;
}

.chat-assist-close {
  background: none;
  border: none;
  color: var(--text3);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}

.chat-assist-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-assist-hint {
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  color: var(--text3);
  line-height: 1.8;
}

.chat-bubble {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 100%;
}

.chat-bubble-user .bubble-content {
  background: var(--surface2);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text1);
  align-self: flex-end;
  max-width: 90%;
}

.chat-bubble-assistant .bubble-content {
  font-size: 13px;
  color: var(--text1);
  line-height: 1.6;
  white-space: pre-wrap;
}

.chat-assist-apply {
  align-self: flex-start;
  background: none;
  border: 1px solid var(--gold);
  color: var(--gold);
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  margin-top: 4px;
  letter-spacing: 0.05em;
}

.chat-assist-apply:hover {
  background: var(--gold);
  color: var(--bg);
}

.chat-assist-input-row {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border);
}

.chat-assist-input {
  flex: 1;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text1);
  font-size: 13px;
  padding: 8px 10px;
  resize: none;
  font-family: inherit;
  line-height: 1.5;
}

.chat-assist-input:focus {
  outline: none;
  border-color: var(--gold);
}

.chat-assist-send {
  background: var(--gold);
  color: var(--bg);
  border: none;
  border-radius: 6px;
  width: 32px;
  cursor: pointer;
  font-size: 14px;
  flex-shrink: 0;
  align-self: flex-end;
  height: 36px;
}

.chat-assist-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

---

## Copy Tracking Events

| Action | Event Name | Metadata |
|---|---|---|
| User sends message | `chat_assist_requested` | `tab_type`, `message` (truncated 120 chars) |
| User applies revision | `chat_assist_applied` | `tab_type`, `char_count` |
| User ignores revision (sends another message) | `chat_assist_ignored` | `tab_type` |

All fire via the existing `/api/v1/events/copy` route. Fire-and-forget.

---

## Hard Rules

- `user_id` always from verified JWT — never from request body
- `session_id` ownership validated before any Claude call
- Voice signal updates are always async, always silent failure
- Chat panel never blocks the editor — no shared state, no locks
- `current_text` is read at send time (via `getCurrentText()` getter),
  not at panel open time — always reflects latest edits
- Max 10 message turns sent to API per request (last 10 only)
- Apply replaces full `innerText` and triggers `input` event to
  activate the existing debounced auto-save — no separate save needed

---

## Done Signal

This session is complete when:

1. Bio panel shows `✦ Ask Claude` button in the action bar
2. Clicking it opens the 340px chat column; editor reflows
3. User types a message and gets a response from Claude
4. When Claude suggests a rewrite, `---REVISED---` block is detected
   and an "Apply →" button renders below the response
5. Clicking Apply replaces the bio/summary/article text
6. "Applied ✓" confirmation shows; auto-save fires within 1.5 seconds
7. Summary and Article tabs have the same working chat panel
8. `chat_assist_requested` event logged for every send
9. `chat_assist_applied` event logged on every apply
10. Voice signal fires async for user messages > 30 words
11. Closing the panel and reopening resets to the hint state
    (in-memory history, not persisted)

Do not start any follow-on work until all eleven are working.
