// frontend/components/FeedbackStrip.js

const FEEDBACK_OPTIONS = [
  { id: 'my_voice',          label: '✓ My voice',        primary: true  },
  { id: 'too_formal',        label: 'Too formal',         primary: false },
  { id: 'too_casual',        label: 'Too casual',         primary: false },
  { id: 'too_promotional',   label: 'Too promotional',    primary: false },
  { id: 'missing_something', label: 'Missing something',  primary: false },
];

export function renderFeedbackStrip(outputType, sessionId) {
  return `
    <div class="feedback-strip" id="feedback-${outputType}">
      <div class="feedback-label">Does this sound like you?</div>
      <div class="feedback-options">
        ${FEEDBACK_OPTIONS.map(opt => `
          <button
            class="feedback-btn ${opt.primary ? 'primary' : ''}"
            onclick="submitFeedback('${outputType}', '${opt.id}', '${sessionId}')">
            ${opt.label}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

export function initFeedbackTiming(outputType, sessionId) {
  if (sessionStorage.getItem(`feedback_given_${outputType}`)) return;

  let shown = false;

  function showStrip() {
    if (shown) return;
    shown = true;
    sessionStorage.setItem(`feedback_given_${outputType}`, '1');
    const container = document.getElementById(`feedback-container-${outputType}`);
    if (container) {
      container.innerHTML = renderFeedbackStrip(outputType, sessionId);
      container.style.opacity = '0';
      requestAnimationFrame(() => {
        container.style.transition = 'opacity 0.4s';
        container.style.opacity = '1';
      });
    }
  }

  setTimeout(showStrip, 30000);

  const el = document.getElementById(`output-${outputType}`);
  if (el) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) showStrip();
    });
    observer.observe(el);
  }

  const copyBtn = document.getElementById(`copy-${outputType}`);
  if (copyBtn) copyBtn.addEventListener('mouseenter', showStrip);
}

// Exposed globally for inline onclick handlers
window.submitFeedback = async function(outputType, signal, sessionId) {
  const strip = document.getElementById(`feedback-${outputType}`);
  if (!strip) return;

  if (signal === 'missing_something') {
    showMissingField(outputType, sessionId);
    return;
  }

  const MESSAGES = {
    my_voice:        '✓ Noted — this version is calibrated well',
    too_formal:      'Got it — next version will be more conversational',
    too_casual:      'Understood — will bring more weight next time',
    too_promotional: 'Noted — will describe what exists, not what it replaced',
  };

  strip.innerHTML = `<div class="feedback-confirmed">${MESSAGES[signal]}</div>`;

  setTimeout(() => {
    strip.style.opacity = '0';
    setTimeout(() => strip.remove(), 400);
  }, 3000);

  sendFeedbackSignal(sessionId, outputType, signal).catch(() => {});
};

function showMissingField(outputType, sessionId) {
  const strip = document.getElementById(`feedback-${outputType}`);
  strip.innerHTML = `
    <div class="feedback-label">What's missing?</div>
    <textarea
      id="missing-input-${outputType}"
      class="feedback-missing-input"
      placeholder="The thing that would make this more accurate..."
      rows="2"
    ></textarea>
    <div class="feedback-actions">
      <button class="action-btn" onclick="submitMissing('${outputType}', '${sessionId}')">
        Add to my graph →
      </button>
      <button class="action-btn muted" onclick="dismissFeedback('${outputType}')">
        Cancel
      </button>
    </div>
  `;
  document.getElementById(`missing-input-${outputType}`)?.focus();
}

window.submitMissing = async function(outputType, sessionId) {
  const input = document.getElementById(`missing-input-${outputType}`);
  const text = input?.value.trim();
  if (!text) return;

  await sendFeedbackSignal(sessionId, outputType, 'missing_something', text);

  const strip = document.getElementById(`feedback-${outputType}`);
  if (strip) {
    strip.innerHTML = `<div class="feedback-confirmed">✓ Added — this will strengthen your outputs</div>`;
    setTimeout(() => strip.remove(), 3000);
  }
};

window.dismissFeedback = function(outputType) {
  const strip = document.getElementById(`feedback-${outputType}`);
  if (strip) {
    strip.style.opacity = '0';
    setTimeout(() => strip.remove(), 400);
  }
};

async function sendFeedbackSignal(sessionId, outputType, signal, text = null) {
  const body = { session_id: sessionId, output_type: outputType, signal };
  if (text) body.text = text;

  fetch('/api/v1/events/feedback', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${window.__careerToken ?? ''}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }).catch(() => {});
}
