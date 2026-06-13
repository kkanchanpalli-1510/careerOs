// frontend/lib/outputEdits.js

function getToken() {
  return window.__careerToken ?? '';
}

export async function saveOutputEdit(sessionId, outputType, text) {
  // Fire and forget — never block the caller waiting for a response
  fetch(`/api/v1/sessions/${sessionId}/outputs/${outputType}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text, edited_by_user: true })
  }).catch(() => {});
}

export function updateVersionHistory(sessionId, outputType, text) {
  // Show history button now that an edit has been made
  const historyBtn = document.getElementById(`history-${outputType}`);
  if (historyBtn) historyBtn.style.display = '';
}
