# Career OS — Doc 12b: Editable Outputs + Micro-Feedback

## What This Builds

Two features added to the Publish panels:
1. Every output (bio, summary, headline) is editable inline
2. Micro-feedback strip below every output

Prerequisite: 12a workspace shell is built and working.

---

## Context

Read career-os-docs/12-career-workspace.md Features 2 and 4
for full design rationale. This is the build spec.

Key principle: the edit IS the feedback. A user who changes
"leveraged" to "used" six times gives more signal than any
rating. Capture it automatically — never ask them to rate.

---

## Feature 1 — Editable Bio and Summary

### Which Outputs Are Editable

All three Publish outputs:
- Short Bio (100–150 words, third person)
- LinkedIn Summary (2,400 chars)
- LinkedIn Headline (120 chars)

Portrait outputs (Strength, Portrait card) are NOT editable here.
They have regenerate buttons. The editing mechanic is for
the outputs users will publish verbatim.

### Implementation — contenteditable

Do NOT use Tiptap or Quill. These are plain text outputs.
`contenteditable` with debounced save is sufficient and
dramatically simpler.

```javascript
// frontend/lib/makeEditable.js

export function makeEditable(elementId, sessionId, outputType) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const originalText = el.innerText.trim();
  let saveTimer = null;
  let voiceTimer = null;

  // Make editable
  el.contentEditable = 'true';
  el.spellcheck = true;
  el.style.outline = 'none';
  el.style.cursor = 'text';
  el.style.minHeight = '60px';

  // Visual focus indicator — amber left border on focus
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

    // Save every 1.5 seconds
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await saveOutputEdit(sessionId, outputType, currentText);
      updateVersionHistory(sessionId, outputType, currentText);
    }, 1500);

    // Voice signal every 8 seconds — less frequent
    clearTimeout(voiceTimer);
    voiceTimer = setTimeout(() => {
      const similarity = calculateSimilarity(originalText, currentText);
      if (similarity < 0.95) {
        captureEditSignal(sessionId, outputType, originalText, currentText)
          .catch(() => {});
      }
    }, 8000);

    // Update character count if present
    updateCharCount(elementId, currentText.length);
  });

  // Prevent paste of formatted text — plain text only
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
```

### Save to Backend

```javascript
// frontend/lib/outputEdits.js

export async function saveOutputEdit(sessionId, outputType, text) {
  try {
    await fetch(`/api/v1/sessions/${sessionId}/outputs/${outputType}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text, edited_by_user: true })
    });
  } catch (e) {
    // Silent failure — never interrupt editing
    console.error('Save failed silently', e);
  }
}
```

### Backend Route

```typescript
// src/routes/sessions.ts — add to existing sessions router

router.patch('/sessions/:id/outputs/:outputType',
  requireAuth, async (req, res) => {

  const userId = req.user.id;
  const { id: sessionId, outputType } = req.params;
  const { text, edited_by_user } = req.body;

  const ALLOWED_OUTPUT_TYPES = [
    'linkedin_summary', 'short_bio', 'linkedin_headline'
  ];

  if (!ALLOWED_OUTPUT_TYPES.includes(outputType)) {
    return res.status(400).json({ error: 'Invalid output type' });
  }

  const session = await validateSessionOwnership(sessionId, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  // Store in insights JSONB
  await db.query(`
    UPDATE career_sessions
    SET insights = jsonb_set(
      insights,
      '{${outputType}}',
      $1::jsonb
    ),
    updated_at = NOW()
    WHERE id = $2 AND user_id = $3
  `, [JSON.stringify(text), sessionId, userId]);

  // Track that this output was user-edited
  // Used by copy protection and voice profile
  await db.query(`
    UPDATE career_sessions
    SET insights = jsonb_set(
      insights,
      '{${outputType}_user_edited}',
      'true'::jsonb
    )
    WHERE id = $1
  `, [sessionId]);

  res.json({ ok: true });
});
```

### Voice Signal Capture

```javascript
// frontend/lib/voiceSignals.js

export async function captureEditSignal(
  sessionId,
  outputType,
  originalText,
  finalText
) {
  // Fire and forget — never block UI
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

export function calculateSimilarity(a, b) {
  if (!a || !b) return 0;
  const aWords = new Set(a.toLowerCase().split(/\s+/));
  const bWords = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...aWords].filter(w => bWords.has(w)).length;
  const union = new Set([...aWords, ...bWords]).size;
  return union === 0 ? 1 : intersection / union;
}
```

```typescript
// src/routes/voice.ts — new route file

router.post('/voice/edit-signal', requireAuth, async (req, res) => {
  // Always return 200 — fire and forget
  res.json({ ok: true });

  // Process async after response sent
  const { session_id, output_type, original, final, similarity } = req.body;
  const userId = req.user.id;

  try {
    // Queue voice profile update
    await updateVoiceFromAnswer(userId, final, 'output_edit');

    // Log for analytics
    await db.query(`
      INSERT INTO copy_events
        (user_id, session_id, event_name, metadata)
      VALUES ($1, $2, 'output_edited', $3)
    `, [userId, session_id, JSON.stringify({
      output_type,
      similarity,
      edit_direction: final.length < original.length ? 'shorter' : 'longer'
    })]);
  } catch (e) {
    // Silent — already responded
  }
});
```

### Version History Icon

Each panel header shows a history icon after the first edit:

```
LinkedIn Summary  [↺ Regenerate]  [⋯ History]
```

`[⋯ History]` appears only after the output has been edited
or regenerated at least once. Uses the version history mechanic
from doc 09 — same data model, same restore flow.

---

## Feature 2 — Summary Micro-Feedback Strip

### Where It Appears

Below every Publish output. Not immediately on generation —
surfaces after the user has had time to read.

Trigger: 30 seconds after panel loads OR user scrolls past
the output OR user hovers the copy button.

### The Five Options

```
Does this sound like you?

[ ✓ My voice ]  [ Too formal ]  [ Too casual ]
[ Too promotional ]  [ Missing something ]
```

```javascript
// frontend/components/FeedbackStrip.js

const FEEDBACK_OPTIONS = [
  { id: 'my_voice',         label: '✓ My voice',        primary: true  },
  { id: 'too_formal',       label: 'Too formal',         primary: false },
  { id: 'too_casual',       label: 'Too casual',         primary: false },
  { id: 'too_promotional',  label: 'Too promotional',    primary: false },
  { id: 'missing_something', label: 'Missing something', primary: false },
];

function renderFeedbackStrip(outputType, sessionId) {
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

async function submitFeedback(outputType, signal, sessionId) {
  const strip = document.getElementById(`feedback-${outputType}`);

  // Handle "missing something" — show text field
  if (signal === 'missing_something') {
    showMissingField(outputType, sessionId);
    return;
  }

  // All other signals — confirm and dismiss
  const MESSAGES = {
    my_voice:        '✓ Noted — this version is calibrated well',
    too_formal:      'Got it — next version will be more conversational',
    too_casual:      'Understood — will bring more weight next time',
    too_promotional: 'Noted — will describe what exists, not what it replaced',
  };

  strip.innerHTML = `
    <div class="feedback-confirmed">${MESSAGES[signal]}</div>
  `;

  // Fade out after 3 seconds
  setTimeout(() => {
    strip.style.opacity = '0';
    setTimeout(() => strip.remove(), 400);
  }, 3000);

  // Send signal — fire and forget
  sendFeedbackSignal(sessionId, outputType, signal).catch(() => {});
}

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
      <button onclick="submitMissing('${outputType}', '${sessionId}')">
        Add to my graph →
      </button>
      <button onclick="dismissFeedback('${outputType}')" class="muted">
        Cancel
      </button>
    </div>
  `;
  document.getElementById(`missing-input-${outputType}`).focus();
}

async function submitMissing(outputType, sessionId) {
  const input = document.getElementById(`missing-input-${outputType}`);
  const text = input.value.trim();
  if (!text) return;

  // Send to backend — enriches graph + voice profile
  await sendFeedbackSignal(sessionId, outputType, 'missing_something', text);

  const strip = document.getElementById(`feedback-${outputType}`);
  strip.innerHTML = `
    <div class="feedback-confirmed">
      ✓ Added — this will strengthen your outputs
    </div>
  `;
  setTimeout(() => strip.remove(), 3000);
}
```

### Feedback Signal Backend

```typescript
// src/routes/events.ts — add to existing events router

router.post('/events/feedback', requireAuth, async (req, res) => {
  res.json({ ok: true }); // always 200, process async

  const userId = req.user.id;
  const { session_id, output_type, signal, text } = req.body;

  try {
    // Log to copy_events
    await db.query(`
      INSERT INTO copy_events
        (user_id, session_id, event_name, metadata)
      VALUES ($1, $2, 'output_feedback', $3)
    `, [userId, session_id, JSON.stringify({ output_type, signal })]);

    // Process voice adjustment
    await processFeedbackSignal(userId, output_type, signal);

    // If "missing something" text provided — enrich voice profile
    if (text && text.length > 10) {
      await updateVoiceFromAnswer(userId, text, 'feedback_missing');

      // TODO: optionally create a new graph node from this text
      // This is a future enhancement — for now just voice update
    }
  } catch (e) {
    // Silent
  }
});
```

### Feedback Strip CSS

```css
.feedback-strip {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--b1);
  transition: opacity 0.4s;
}

.feedback-label {
  font-family: 'DM Mono', monospace;
  font-size: 8px;
  color: var(--t3);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.feedback-options {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.feedback-btn {
  font-family: 'DM Mono', monospace;
  font-size: 8px;
  letter-spacing: 0.06em;
  padding: 4px 10px;
  border-radius: 3px;
  border: 1px solid var(--b2);
  background: none;
  color: var(--t3);
  cursor: pointer;
  transition: all 0.15s;
}

.feedback-btn:hover { border-color: var(--b3); color: var(--t2); }

.feedback-btn.primary:hover {
  border-color: rgba(52,211,153,0.4);
  color: var(--green);
}

.feedback-confirmed {
  font-family: 'DM Mono', monospace;
  font-size: 9px;
  color: var(--green);
  letter-spacing: 0.08em;
}

.feedback-missing-input {
  width: 100%;
  background: var(--s2);
  border: 1px solid var(--b1);
  color: var(--t1);
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 4px;
  outline: none;
  resize: none;
  margin-bottom: 8px;
}

.feedback-missing-input:focus { border-color: var(--gold); }
```

### Feedback Timing

The strip does not appear immediately. It appears after:
- 30 seconds on the panel, OR
- User scrolls past the output bottom edge, OR
- User hovers the copy button

```javascript
function initFeedbackTiming(outputType, sessionId) {
  // Don't show if already given feedback this session
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

  // Timer trigger
  setTimeout(showStrip, 30000);

  // Scroll trigger
  const observer = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) showStrip();
  });
  const el = document.getElementById(`output-${outputType}`);
  if (el) observer.observe(el);

  // Copy hover trigger
  const copyBtn = document.getElementById(`copy-${outputType}`);
  if (copyBtn) copyBtn.addEventListener('mouseenter', showStrip);
}
```

---

## Panel Implementations

### Bio Panel

```javascript
// frontend/panels/BioPanel.js

export function render(container, session) {
  const bio = session.insights?.short_bio || '';

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Short Bio</div>
      <div class="panel-use-label">
        For: speaker bios · about pages · team profiles · email signatures
      </div>
    </div>

    <div class="panel-actions">
      <button onclick="copyOutput('bio')" id="copy-bio" class="action-btn">
        ⌘ Copy
      </button>
      <button onclick="regenerateOutput('short_bio')" class="action-btn muted">
        ↺ Regenerate
      </button>
      <button onclick="showHistory('short_bio')" class="action-btn muted"
              id="history-short_bio" style="display:none">
        ⋯ History
      </button>
    </div>

    <div id="output-bio" class="output-text" id="bio-text">
      ${bio}
    </div>

    <div id="feedback-container-bio"></div>
  `;

  makeEditable('bio-text', session.id, 'short_bio');
  initFeedbackTiming('bio', session.id);
}
```

### Summary Panel — same pattern with character counter

```javascript
// frontend/panels/SummaryPanel.js

export function render(container, session) {
  const summary = session.insights?.linkedin_summary || '';

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">LinkedIn Summary</div>
      <div class="panel-use-label">Paste into LinkedIn About section</div>
    </div>

    <div class="panel-actions">
      <button onclick="copyOutput('summary')" id="copy-summary" class="action-btn">
        ⌘ Copy
      </button>
      <button onclick="regenerateOutput('linkedin_summary')" class="action-btn muted">
        ↺ Regenerate
      </button>
    </div>

    <div id="output-summary" class="output-text" id="summary-text">
      ${summary}
    </div>

    <div class="char-counter">
      <span id="summary-textCount">${summary.length.toLocaleString()}</span>
      / 2,600
    </div>

    <div id="feedback-container-summary"></div>
  `;

  makeEditable('summary-text', session.id, 'linkedin_summary');
  initFeedbackTiming('summary', session.id);
}
```

---

## Done Signal

This session is complete when:

1. Bio, Summary, and Headline panels render in workspace
2. Clicking into any output makes it editable with amber left border
3. Edits save silently after 1.5 seconds
4. Character counter updates on Summary and Headline panels
5. Voice signal fires async on edit — never blocks
6. Feedback strip appears after 30 seconds (or on scroll/hover)
7. "My voice / Too formal / Too casual / Too promotional" dismiss with message
8. "Missing something" shows text field, submits to backend
9. Version history icon appears after first edit or regeneration

Do not start 12c until all nine are working.
