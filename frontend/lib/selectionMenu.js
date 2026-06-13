// frontend/lib/selectionMenu.js

function getToken() { return window.__careerToken ?? ''; }

const SELECTION_ACTIONS = [
  { id: 'strengthen', label: 'Strengthen with graph' },
  { id: 'direct',     label: 'More direct'           },
  { id: 'expand',     label: 'Expand'                },
  { id: 'cut',        label: 'Cut'                   },
  { id: 'rewrite',    label: 'Rewrite'               },
];

export function initSelectionMenu(editorId, sessionId, articleId) {
  const editor = document.getElementById(editorId);
  if (!editor) return;

  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (!selectedText || selectedText.length < 10) {
      hideSelectionMenu();
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      hideSelectionMenu();
      return;
    }

    showSelectionMenu(selection, selectedText, sessionId, articleId);
  });
}

function showSelectionMenu(selection, selectedText, sessionId, articleId) {
  let menu = document.getElementById('selectionMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'selectionMenu';
    menu.className = 'selection-menu';
    document.body.appendChild(menu);
  }

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  menu.style.top = `${rect.top + window.scrollY - 44}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;

  menu.innerHTML = SELECTION_ACTIONS.map(action => `
    <button
      class="sel-action-btn"
      onmousedown="event.preventDefault()"
      onclick="applySelectionAction('${action.id}', '${sessionId}', '${articleId}')"
    >${action.label}</button>
  `).join('');

  menu.style.display = 'flex';

  window.currentSelectedText = selectedText;
  window.currentSelectionRange = selection.getRangeAt(0).cloneRange();
}

export function hideSelectionMenu() {
  const menu = document.getElementById('selectionMenu');
  if (menu) menu.style.display = 'none';
}

window.applySelectionAction = async function(action, sessionId, articleId) {
  const selectedText = window.currentSelectedText;
  if (!selectedText) return;

  const menu = document.getElementById('selectionMenu');
  if (menu) menu.innerHTML = '<div class="sel-loading">···</div>';

  try {
    const res = await fetch('/api/v1/claude/article-enhance-selection', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session_id: sessionId,
        article_id: articleId,
        selected_text: selectedText,
        action
      })
    });

    if (!res.ok) throw new Error('enhance failed');
    const { enhanced_text } = await res.json();

    if (enhanced_text && window.currentSelectionRange) {
      const range = window.currentSelectionRange;
      range.deleteContents();
      range.insertNode(document.createTextNode(enhanced_text));

      const editor = document.getElementById('articleEditor');
      if (editor) editor.dispatchEvent(new Event('input'));

      // Log event fire-and-forget
      fetch('/api/v1/events/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          event_name: 'article_selection_enhanced',
          metadata: { action, article_id: articleId }
        })
      }).catch(() => {});
    }
  } catch {
    // Backend unavailable — silently restore menu
    const menu = document.getElementById('selectionMenu');
    if (menu) {
      menu.innerHTML = SELECTION_ACTIONS.map(a => `
        <button class="sel-action-btn"
          onmousedown="event.preventDefault()"
          onclick="applySelectionAction('${a.id}', '${sessionId}', '${articleId}')"
        >${a.label}</button>
      `).join('');
    }
  }

  hideSelectionMenu();
};
