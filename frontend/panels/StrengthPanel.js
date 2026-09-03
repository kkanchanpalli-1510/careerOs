// frontend/panels/StrengthPanel.js

export function render(container, session) {
  const strength = session?.insights?.strength;

  if (!strength?.insight) {
    container.innerHTML = `
      <div class="panel-header"><div class="panel-title">Core Strength</div></div>
      <div style="padding:40px 32px;color:var(--t3);font-family:'DM Mono',monospace;font-size:11px;">
        Complete the career intelligence session to reveal your core strength.
      </div>`;
    return;
  }

  const insightHtml = strength.insight.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  const patternNodes = strength.pattern_nodes ?? [];
  const patternType  = strength.pattern_type  ?? '';
  const label        = strength.strength_label ?? '';
  const reframe      = strength.identity_reframe ?? '';

  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">Core Strength</div>
    </div>
    <div class="strength-panel-body">
      ${label ? `<div class="strength-label">◆ ${label}</div>` : ''}
      <div class="strength-insight">${insightHtml}</div>
      ${reframe ? `
        <div class="strength-reframe">
          <div class="strength-reframe-label">Identity reframe</div>
          <div class="strength-reframe-text">${reframe}</div>
        </div>` : ''}
      ${patternType ? `<div class="strength-pattern-type">Pattern: ${patternType}</div>` : ''}
      ${patternNodes.length ? `
        <div class="strength-nodes-label">Nodes that form this pattern</div>
        <div class="strength-nodes">
          ${patternNodes.map(id => {
            const node = session?.graph_data?.nodes?.find(n => n.id === id);
            return node ? `<span class="strength-node-chip ${node.type ?? ''}">${node.label}</span>` : '';
          }).filter(Boolean).join('')}
        </div>` : ''}
    </div>
    <style>
      .strength-panel-body{padding:28px 32px;max-width:680px;}
      .strength-label{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.15em;color:var(--gold);text-transform:uppercase;margin-bottom:16px;}
      .strength-insight{font-size:15px;line-height:1.8;color:var(--t1);margin-bottom:28px;}
      .strength-insight strong{color:var(--gold);font-weight:500;}
      .strength-reframe{background:var(--s2);border-left:2px solid var(--gold);padding:14px 18px;border-radius:0 6px 6px 0;margin-bottom:24px;}
      .strength-reframe-label{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:0.12em;color:var(--t3);text-transform:uppercase;margin-bottom:6px;}
      .strength-reframe-text{font-size:13px;color:var(--t2);line-height:1.65;font-style:italic;}
      .strength-pattern-type{font-family:'DM Mono',monospace;font-size:9px;color:var(--t3);margin-bottom:16px;}
      .strength-nodes-label{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:0.1em;color:var(--t3);text-transform:uppercase;margin-bottom:10px;}
      .strength-nodes{display:flex;flex-wrap:wrap;gap:6px;}
      .strength-node-chip{font-family:'DM Mono',monospace;font-size:9px;padding:4px 10px;border-radius:12px;border:1px solid var(--b2);color:var(--t2);}
      .strength-node-chip.role{border-color:var(--blue);color:var(--blue);}
      .strength-node-chip.skill{border-color:var(--green);color:var(--green);}
      .strength-node-chip.project{border-color:var(--purple);color:var(--purple);}
      .strength-node-chip.outcome{border-color:var(--gold);color:var(--gold);}
      .strength-node-chip.decision{border-color:#ef4444;color:#ef4444;}
    </style>`;
}
