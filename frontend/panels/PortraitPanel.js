// frontend/panels/PortraitPanel.js

export function render(container, session) {
  const portrait  = session?.insights?.portrait;
  const strength  = session?.insights?.strength;
  const branches  = session?.insights?.branches ?? [];
  const chosen    = branches[session?.selected_branch ?? 0];

  if (!portrait?.identity) {
    container.innerHTML = `
      <div class="panel-header"><div class="panel-title">Career Portrait</div></div>
      <div style="padding:40px 32px;color:var(--t3);font-family:'DM Mono',monospace;font-size:11px;">
        Complete the career intelligence session to reveal your career portrait.
      </div>`;
    return;
  }

  const celebrationHtml = (portrait.celebration || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Career Portrait</div>
    </div>
    <div class="portrait-panel-body">
      <div class="portrait-identity">${portrait.identity}</div>

      ${strength?.insight ? `
        <div class="portrait-core-strength">
          <div class="portrait-section-label">Core Strength</div>
          <div class="portrait-strength-text">${strength.insight.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</div>
        </div>` : ''}

      <div class="portrait-celebration">${celebrationHtml}</div>

      <div class="portrait-rows">
        <div class="portrait-row">
          <div class="portrait-row-label" style="color:var(--green);">What makes you rare</div>
          <div class="portrait-row-val">${portrait.rare_factor || ''}</div>
        </div>
        <div class="portrait-row">
          <div class="portrait-row-label" style="color:var(--gold);">Next move · 30 days</div>
          <div class="portrait-row-val">${portrait.next_action || ''}</div>
        </div>
        <div class="portrait-row">
          <div class="portrait-row-label" style="color:var(--t2);">What to build next</div>
          <div class="portrait-row-val" style="font-style:italic;">${portrait.gap || ''}</div>
        </div>
        ${chosen ? `
        <div class="portrait-row">
          <div class="portrait-row-label" style="color:var(--blue);">Chosen direction</div>
          <div class="portrait-row-val">${chosen.title}</div>
        </div>` : ''}
      </div>
    </div>
    <style>
      .portrait-panel-body{padding:28px 32px;max-width:680px;}
      .portrait-identity{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:300;line-height:1.35;color:var(--t1);margin-bottom:24px;}
      .portrait-core-strength{background:var(--s2);border-left:2px solid var(--gold);padding:14px 18px;border-radius:0 6px 6px 0;margin-bottom:24px;}
      .portrait-section-label{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:0.12em;color:var(--gold);text-transform:uppercase;margin-bottom:6px;}
      .portrait-strength-text{font-size:13px;color:var(--t2);line-height:1.65;}
      .portrait-strength-text strong{color:var(--gold);font-weight:500;}
      .portrait-celebration{font-size:13px;color:var(--t1);line-height:1.75;margin-bottom:28px;}
      .portrait-celebration strong{color:var(--gold);font-weight:500;}
      .portrait-rows{display:flex;flex-direction:column;gap:16px;}
      .portrait-row{border-top:1px solid var(--b1);padding-top:14px;}
      .portrait-row-label{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;}
      .portrait-row-val{font-size:13px;color:var(--t1);line-height:1.65;}
    </style>`;
}
