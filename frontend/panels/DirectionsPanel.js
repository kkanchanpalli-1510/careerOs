// frontend/panels/DirectionsPanel.js

import { callBackend, currentSessionId, showToast } from '../workspace.js';

export function render(container, session) {
  const branches       = session?.insights?.branches ?? [];
  const selectedBranch = session?.selected_branch ?? null;

  if (!branches.length) {
    container.innerHTML = `
      <div class="panel-header"><div class="panel-title">Career Directions</div></div>
      <div style="padding:40px 32px;color:var(--t3);font-family:'DM Mono',monospace;font-size:11px;">
        Complete the career intelligence session to reveal your directions.
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Career Directions</div>
    </div>
    <div class="directions-panel-body">
      <div class="directions-intro">Three non-obvious directions your career is pointing — derived from your graph topology.</div>
      <div class="dir-cards-list" id="dirCardsList">
        ${branches.slice(0, 3).map((b, i) => `
          <div class="dir-card ${selectedBranch === i ? 'selected' : ''}" id="wpDirCard-${i}"
               onclick="window._selectDirection(${i})">
            <div class="dir-card-header">
              <div class="dir-card-num">Direction ${i + 1}</div>
              <div class="dir-card-timeline">${b.timeline || ''}</div>
            </div>
            <div class="dir-card-title">${b.title}</div>
            <div class="dir-card-why">${b.description || ''}</div>
            ${selectedBranch === i ? '<div class="dir-card-selected-badge">✓ Selected</div>' : ''}
          </div>`).join('')}
      </div>
    </div>
    <style>
      .directions-panel-body{padding:24px 32px;max-width:720px;}
      .directions-intro{font-size:12px;color:var(--t3);font-family:'DM Mono',monospace;margin-bottom:24px;line-height:1.6;}
      .dir-cards-list{display:flex;flex-direction:column;gap:12px;}
      .dir-card{background:var(--s1);border:1px solid var(--b2);border-radius:8px;padding:20px 22px;cursor:pointer;transition:border-color 0.2s;}
      .dir-card:hover{border-color:var(--gold);}
      .dir-card.selected{border-color:var(--gold);background:var(--s2);}
      .dir-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
      .dir-card-num{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:0.12em;color:var(--t3);text-transform:uppercase;}
      .dir-card-timeline{font-family:'DM Mono',monospace;font-size:8px;color:var(--gold);border:1px solid var(--gold);padding:2px 8px;border-radius:10px;}
      .dir-card-title{font-size:14px;font-weight:500;color:var(--t1);margin-bottom:8px;}
      .dir-card-why{font-size:12px;color:var(--t2);line-height:1.65;}
      .dir-card-selected-badge{margin-top:10px;font-family:'DM Mono',monospace;font-size:8px;color:var(--gold);letter-spacing:0.1em;}
    </style>`;

  window._selectDirection = async (idx) => {
    const sid = currentSessionId();
    if (!sid) return;
    try {
      await callBackend(`sessions/${sid}`, {
        method: 'PATCH',
        body: JSON.stringify({ selected_branch: idx }),
      });
      // Update visual state
      document.querySelectorAll('.dir-card').forEach((el, i) => {
        el.classList.toggle('selected', i === idx);
        const badge = el.querySelector('.dir-card-selected-badge');
        if (i === idx && !badge) {
          const b = document.createElement('div');
          b.className = 'dir-card-selected-badge';
          b.textContent = '✓ Selected';
          el.appendChild(b);
        } else if (i !== idx && badge) {
          badge.remove();
        }
      });
      showToast('Direction selected');
    } catch {
      showToast('Could not save selection — try again');
    }
  };
}
