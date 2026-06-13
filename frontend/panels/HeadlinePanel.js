// frontend/panels/HeadlinePanel.js

import { makeEditable } from '../lib/makeEditable.js';
import { initFeedbackTiming } from '../components/FeedbackStrip.js';

export function render(container, session) {
  const headline = session?.insights?.linkedin_headline || '';

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">LinkedIn Headline</div>
      <div class="panel-use-label">Appears under your name on LinkedIn — 120 characters</div>
    </div>

    <div class="panel-actions">
      <button onclick="copyOutput('headline')" id="copy-headline" class="action-btn">⌘ Copy</button>
      <button onclick="regenerateOutput('linkedin_headline')" class="action-btn muted">↺ Regenerate</button>
      <button onclick="showHistory('linkedin_headline')" class="action-btn muted"
              id="history-linkedin_headline" style="display:none">⋯ History</button>
    </div>

    <div id="output-headline">
      <div id="headline-text" class="output-text output-text--headline">${headline || '<span class="output-empty">LinkedIn headline will appear here after your graph session</span>'}</div>
    </div>

    <div class="char-counter">
      <span id="headline-textCount">${headline.length.toLocaleString()}</span> / 120
    </div>

    <div id="feedback-container-headline"></div>
  `;

  if (headline) {
    makeEditable('headline-text', session?.id, 'linkedin_headline');
    initFeedbackTiming('headline', session?.id);
  }
}
