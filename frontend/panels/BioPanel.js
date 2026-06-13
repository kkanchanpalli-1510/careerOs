// frontend/panels/BioPanel.js

import { makeEditable } from '../lib/makeEditable.js';
import { initFeedbackTiming } from '../components/FeedbackStrip.js';
import { ChatAssistPanel } from '../components/ChatAssistPanel.js';

export function render(container, session) {
  const bio = session?.insights?.short_bio || '';

  container.innerHTML = `
    <div id="bioPanelContainer" class="panel-container">
      <div class="panel-main">
        <div class="panel-header">
          <div class="panel-title">Short Bio</div>
          <div class="panel-use-label">For: speaker bios · about pages · team profiles · email signatures</div>
        </div>

        <div class="panel-actions">
          <button onclick="copyOutput('bio')" id="copy-bio" class="action-btn">⌘ Copy</button>
          <button onclick="regenerateOutput('short_bio')" class="action-btn muted">↺ Regenerate</button>
          <button onclick="showHistory('short_bio')" class="action-btn muted"
                  id="history-short_bio" style="display:none">⋯ History</button>
          <button onclick="chatAssist.toggle()" class="action-btn muted">✦ Ask Claude</button>
        </div>

        <div id="output-bio">
          <div id="bio-text" class="output-text">${bio || '<span class="output-empty">Short bio will appear here after your graph session</span>'}</div>
        </div>

        <div id="feedback-container-bio"></div>
      </div>
    </div>
  `;

  setupCopyOutput();

  if (bio) {
    makeEditable('bio-text', session?.id, 'short_bio');
    initFeedbackTiming('bio', session?.id);
  }

  window.chatAssist = new ChatAssistPanel(
    document.getElementById('bioPanelContainer'),
    {
      type: 'bio',
      sessionId: session?.id,
      getCurrentText: () => document.getElementById('bio-text')?.innerText?.trim() || ''
    }
  );
}

function setupCopyOutput() {
  if (window.copyOutput) return;
  window.copyOutput = function(panelId) {
    const el = document.getElementById(`${panelId}-text`);
    if (el) navigator.clipboard.writeText(el.innerText.trim()).catch(() => {});
  };
  window.regenerateOutput = function(outputType) {
    console.log('regenerate', outputType); // stubbed until 12c
  };
  window.showHistory = function(outputType) {
    console.log('history', outputType); // stubbed until 12e
  };
}
