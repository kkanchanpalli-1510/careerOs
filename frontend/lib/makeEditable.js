// frontend/lib/makeEditable.js

import { saveOutputEdit, updateVersionHistory } from './outputEdits.js';
import { captureEditSignal, calculateSimilarity } from './voiceSignals.js';

export function makeEditable(elementId, sessionId, outputType) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const originalText = el.innerText.trim();
  let saveTimer = null;
  let voiceTimer = null;

  el.contentEditable = 'true';
  el.spellcheck = true;
  el.style.outline = 'none';
  el.style.cursor = 'text';
  el.style.minHeight = '60px';

  el.addEventListener('focus', () => {
    el.style.borderLeft = '2px solid var(--gold)';
    el.style.paddingLeft = '12px';
    el.style.marginLeft = '-14px';
  });
  el.addEventListener('blur', () => {
    el.style.borderLeft = '2px solid transparent';
    el.style.paddingLeft = '0';
    el.style.marginLeft = '0';
  });

  el.addEventListener('input', () => {
    const currentText = el.innerText.trim();

    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await saveOutputEdit(sessionId, outputType, currentText);
      updateVersionHistory(sessionId, outputType, currentText);
    }, 1500);

    clearTimeout(voiceTimer);
    voiceTimer = setTimeout(() => {
      const similarity = calculateSimilarity(originalText, currentText);
      if (similarity < 0.95) {
        captureEditSignal(sessionId, outputType, originalText, currentText)
          .catch(() => {});
      }
    }, 8000);

    updateCharCount(elementId, currentText.length);
  });

  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });
}

function updateCharCount(elementId, count) {
  const counter = document.getElementById(elementId + 'Count');
  if (counter) counter.textContent = count.toLocaleString();
}
