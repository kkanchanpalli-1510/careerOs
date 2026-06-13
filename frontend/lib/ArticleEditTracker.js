// frontend/lib/ArticleEditTracker.js

import { calculateSimilarity } from './voiceSignals.js';

function getToken() {
  return window.__careerToken ?? '';
}

export class ArticleEditTracker {
  constructor(userId, sessionId, articleId, generatedDraft) {
    this.userId = userId;
    this.sessionId = sessionId;
    this.articleId = articleId;
    this.generatedDraft = generatedDraft;
    this.saveTimer = null;
    this.voiceTimer = null;
    this.lastSavedContent = generatedDraft;
  }

  onContentChange(currentText) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveCurrentVersion(currentText);
    }, 2000);

    clearTimeout(this.voiceTimer);
    this.voiceTimer = setTimeout(() => {
      this.updateVoiceFromEdits(currentText);
    }, 10000);

    const wc = document.getElementById('wordCount');
    if (wc) wc.textContent = currentText.trim().split(/\s+/).filter(Boolean).length;
  }

  async saveCurrentVersion(text) {
    if (text === this.lastSavedContent) return;

    try {
      await fetch(`/api/v1/articles/${this.articleId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: text })
      });

      this.lastSavedContent = text;

      const indicator = document.getElementById('saveIndicator');
      if (indicator) {
        indicator.textContent = 'Saved';
        indicator.style.color = 'var(--green)';
        setTimeout(() => { indicator.textContent = ''; }, 2000);
      }
    } catch {
      // Silent save failure
    }
  }

  updateVoiceFromEdits(currentText) {
    const similarity = calculateSimilarity(this.generatedDraft, currentText);
    if (similarity > 0.92) return;

    fetch('/api/v1/voice/edit-signal', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: this.sessionId,
        output_type: 'article',
        original: this.generatedDraft,
        final: currentText,
        similarity
      })
    }).catch(() => {});
  }
}
