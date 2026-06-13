// frontend/components/ChatAssistPanel.js

function getToken() { return window.__careerToken ?? ''; }

/**
 * context shape:
 * {
 *   type: 'bio' | 'summary' | 'article',
 *   sessionId: string,
 *   articleId?: string,
 *   getCurrentText: () => string
 * }
 */
export class ChatAssistPanel {
  constructor(container, context) {
    this.container = container;
    this.context = context;
    this.messages = [];
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

    this.container.appendChild(panel);

    document.getElementById('chatAssistInput')
      .addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.send();
        }
      });

    // Re-render history if re-opening within same navigation
    this.messages.forEach(m => this.appendMessageBubble(m.role, m.content));
  }

  async send() {
    const input = document.getElementById('chatAssistInput');
    const text = input?.value.trim();
    if (!text) return;

    input.value = '';
    input.disabled = true;
    const sendBtn = document.querySelector('.chat-assist-send');
    if (sendBtn) sendBtn.disabled = true;

    this.messages.push({ role: 'user', content: text });
    this.appendMessageBubble('user', text);

    this.trackEvent('chat_assist_requested', { message: text.slice(0, 120) });

    // Voice signal for long messages — fire-and-forget
    if (text.split(/\s+/).length > 30) {
      fetch('/api/v1/voice/edit-signal', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session_id: this.context.sessionId,
          output_type: this.context.type,
          original: '',
          final: text,
          similarity: 0
        })
      }).catch(() => {});
    }

    if (this.pendingSuggestion) {
      this.trackEvent('chat_assist_ignored', {});
      this.pendingSuggestion = null;
    }

    const payload = {
      session_id: this.context.sessionId,
      tab_type: this.context.type,
      current_text: this.context.getCurrentText(),
      messages: this.messages.slice(-10),
      ...(this.context.articleId && { article_id: this.context.articleId })
    };

    const assistantBubble = this.appendMessageBubble('assistant', '···');
    const contentEl = assistantBubble.querySelector('.bubble-content');

    try {
      const res = await fetch('/api/v1/claude/chat-assist', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('chat-assist failed');
      const { content: fullText } = await res.json();

      const { display, revised } = this.parseResponse(fullText);
      contentEl.textContent = display;

      this.messages.push({ role: 'assistant', content: fullText });

      if (revised) {
        this.pendingSuggestion = revised;
        const applyBtn = document.createElement('button');
        applyBtn.className = 'chat-assist-apply';
        applyBtn.textContent = 'Apply →';
        applyBtn.onclick = () => this.applyRevision(revised, applyBtn);
        assistantBubble.appendChild(applyBtn);
      }

    } catch {
      contentEl.textContent = 'Chat assist requires backend — coming soon';
      contentEl.style.color = 'var(--t3)';
      this.messages.pop(); // remove failed user message from history
    } finally {
      if (input) input.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      if (input) input.focus();
    }
  }

  parseResponse(text) {
    const revisedMatch = text.match(/---REVISED---\n([\s\S]*?)\n---END---/);
    if (!revisedMatch) return { display: text, revised: null };
    const revised = revisedMatch[1].trim();
    const display = text.replace(/---REVISED---[\s\S]*?---END---/, '').trim();
    return { display, revised };
  }

  applyRevision(text, btn) {
    const targetId = {
      bio: 'bio-text',
      summary: 'summary-text',
      article: 'articleEditor'
    }[this.context.type];

    const el = document.getElementById(targetId);
    if (!el) return;

    el.innerText = text;
    el.dispatchEvent(new Event('input'));

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
    if (!messages) return { querySelector: () => null };

    // Hide hint once a real message is added
    const hint = messages.querySelector('.chat-assist-hint');
    if (hint && content !== '') hint.style.display = 'none';

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
        metadata: { tab_type: this.context.type, ...metadata }
      })
    }).catch(() => {});
  }
}
