// frontend/panels/SummaryPanel.js

import { makeEditable } from '../lib/makeEditable.js';
import { initFeedbackTiming } from '../components/FeedbackStrip.js';
import { ChatAssistPanel } from '../components/ChatAssistPanel.js';

export function render(container, session) {
  const summary = session?.insights?.linkedin_summary || '';

  container.innerHTML = `
    <div id="summaryPanelContainer" class="panel-container">
      <div class="panel-main">
        <div class="panel-header">
          <div class="panel-title">LinkedIn Summary</div>
          <div class="panel-use-label">Paste into LinkedIn About section</div>
        </div>

        <div class="panel-actions">
          <button onclick="copyOutput('summary')" id="copy-summary" class="action-btn">⌘ Copy</button>
          <button onclick="regenerateOutput('linkedin_summary')" class="action-btn muted">↺ Regenerate</button>
          <button onclick="showHistory('linkedin_summary')" class="action-btn muted"
                  id="history-linkedin_summary" style="display:none">⋯ History</button>
          <button onclick="chatAssist.toggle()" class="action-btn muted">✦ Ask Claude</button>
        </div>

        <div id="output-summary">
          <div id="summary-text" class="output-text">${summary || '<span class="output-empty">LinkedIn summary will appear here after your graph session</span>'}</div>
        </div>

        <div class="char-counter">
          <span id="summary-textCount">${summary.length.toLocaleString()}</span> / 2,600
        </div>

        <div id="feedback-container-summary"></div>
      </div>
    </div>
  `;

  if (summary) {
    makeEditable('summary-text', session?.id, 'linkedin_summary');
    initFeedbackTiming('summary', session?.id);
  }

  window.chatAssist = new ChatAssistPanel(
    document.getElementById('summaryPanelContainer'),
    {
      type: 'summary',
      sessionId: session?.id,
      getCurrentText: () => document.getElementById('summary-text')?.innerText?.trim() || ''
    }
  );
}
