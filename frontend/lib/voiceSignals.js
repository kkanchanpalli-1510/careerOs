// frontend/lib/voiceSignals.js

export function calculateSimilarity(a, b) {
  if (!a || !b) return 0;
  const aWords = new Set(a.toLowerCase().split(/\s+/));
  const bWords = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...aWords].filter(w => bWords.has(w)).length;
  const union = new Set([...aWords, ...bWords]).size;
  return union === 0 ? 1 : intersection / union;
}

export async function captureEditSignal(sessionId, outputType, originalText, finalText) {
  fetch('/api/v1/voice/edit-signal', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      session_id: sessionId,
      output_type: outputType,
      original: originalText,
      final: finalText,
      similarity: calculateSimilarity(originalText, finalText)
    })
  }).catch(() => {});
}

function getToken() {
  return window.__careerToken ?? '';
}
