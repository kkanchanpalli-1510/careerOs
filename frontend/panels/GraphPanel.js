// frontend/panels/GraphPanel.js — Career graph renderer for the workspace full-screen view

const TC = { role:'#3b82f6', skill:'#10b981', project:'#8b5cf6', outcome:'#f59e0b', decision:'#ef4444' };
const TR = { role:14, skill:10, project:12, outcome:11, decision:13 };

let _edgeEls = [];
let _nodeEls = {};
let _nodePositions = {};
let _dragState = null;

function mkMarker(id, col) {
  const m = document.createElementNS('http://www.w3.org/2000/svg','marker');
  m.setAttribute('id',id); m.setAttribute('markerWidth','6'); m.setAttribute('markerHeight','6');
  m.setAttribute('refX','5'); m.setAttribute('refY','3'); m.setAttribute('orient','auto');
  const p = document.createElementNS('http://www.w3.org/2000/svg','path');
  p.setAttribute('d','M0,0 L0,6 L6,3 z'); p.setAttribute('fill',col);
  m.appendChild(p); return m;
}

function redrawEdgesForNode(nodeId, newX, newY) {
  _edgeEls.forEach(({ line, sourceId, targetId }) => {
    if (sourceId === nodeId) { line.setAttribute('x1', newX); line.setAttribute('y1', newY); }
    if (targetId === nodeId) { line.setAttribute('x2', newX); line.setAttribute('y2', newY); }
  });
}

function enableDrag(g, nodeId, wrap) {
  g.addEventListener('mousedown', ev => {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    const rect = wrap.getBoundingClientRect();
    const pos = _nodePositions[nodeId] || { x: 0, y: 0 };
    _dragState = { nodeId, startX: ev.clientX - rect.left, startY: ev.clientY - rect.top, origX: pos.x, origY: pos.y, moved: false };
    document.body.classList.add('dragging');

    const onMove = ev2 => {
      if (!_dragState) return;
      const dx = (ev2.clientX - rect.left) - _dragState.startX;
      const dy = (ev2.clientY - rect.top)  - _dragState.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _dragState.moved = true;
      const newX = _dragState.origX + dx;
      const newY = _dragState.origY + dy;
      const el = _nodeEls[nodeId]; if (!el) return;
      _nodePositions[nodeId] = { x: newX, y: newY };
      el.circle.setAttribute('cx', newX); el.circle.setAttribute('cy', newY);
      el.glow.setAttribute('cx', newX);   el.glow.setAttribute('cy', newY);
      el.text.setAttribute('x', newX);    el.text.setAttribute('y', newY + el.r + 12);
      if (el.dot) { el.dot.setAttribute('cx', newX); el.dot.setAttribute('cy', newY); }
      redrawEdgesForNode(nodeId, newX, newY);
      const tip = document.getElementById('wsNtip'); if (tip) tip.style.display = 'none';
    };

    const onUp = () => {
      document.body.classList.remove('dragging');
      _dragState = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

export function render(container, session) {
  const graphData = session?.graph_data;
  if (!graphData?.nodes?.length) {
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--t3);font-family:'DM Mono',monospace;font-size:11px;">
        No graph data — complete the career intelligence session first.
      </div>`;
    return;
  }

  // Reset state
  _edgeEls = []; _nodeEls = {}; _nodePositions = {}; _dragState = null;

  container.innerHTML = `
    <div id="wsGraphSvgWrap" style="position:relative;flex:1;overflow:hidden;background:var(--bg);"></div>
    <div id="wsNtip" style="display:none;position:absolute;pointer-events:none;z-index:200;
         background:#0f1220;border:1px solid #1e2840;border-radius:6px;padding:10px 14px;
         max-width:210px;font-family:'DM Mono',monospace;"></div>
    <div style="position:absolute;bottom:14px;left:50%;transform:translateX(-50%);
         font-family:'DM Mono',monospace;font-size:8px;letter-spacing:0.1em;color:var(--t3);">
      ${graphData.nodes.length} nodes · ${graphData.edges.length} edges · hover to explore · drag to rearrange
    </div>
    <style>
      #wsNtip .ntip-type{font-size:8px;letter-spacing:0.1em;color:var(--t3);text-transform:uppercase;margin-bottom:4px;}
      #wsNtip .ntip-label{font-size:13px;font-weight:500;color:var(--t1);margin-bottom:6px;}
      #wsNtip .ntip-detail{font-size:10px;color:var(--t2);line-height:1.55;}
      .dragging{cursor:grabbing!important;}
    </style>`;

  const wrap = container.querySelector('#wsGraphSvgWrap');
  const ntip = container.querySelector('#wsNtip');

  // Force explicit height so flex:1 resolves before we measure
  wrap.style.height = (container.clientHeight || window.innerHeight) + 'px';

  requestAnimationFrame(() => {
    const W = wrap.clientWidth  || window.innerWidth  || 800;
    const H = wrap.clientHeight || window.innerHeight || 600;

    const nodes = graphData.nodes.map(n => ({
      ...n,
      x: W/2 + (Math.random()-0.5)*W*0.55,
      y: H/2 + (Math.random()-0.5)*H*0.55,
      vx:0, vy:0,
      r: (TR[n.type]||10) + (n.weight||1)*2
    }));

    const nm = {}; nodes.forEach(n => nm[n.id] = n);
    const edges = graphData.edges.filter(e => nm[e.source] && nm[e.target]);

    // Force-layout simulation
    for (let it = 0; it < 160; it++) {
      for (let i = 0; i < nodes.length; i++) for (let j = i+1; j < nodes.length; j++) {
        const dx=nodes[j].x-nodes[i].x, dy=nodes[j].y-nodes[i].y;
        const d=Math.sqrt(dx*dx+dy*dy)||1, f=2600/(d*d);
        nodes[i].vx-=(dx/d)*f; nodes[i].vy-=(dy/d)*f;
        nodes[j].vx+=(dx/d)*f; nodes[j].vy+=(dy/d)*f;
      }
      edges.forEach(e => {
        const a=nm[e.source],b=nm[e.target]; if(!a||!b) return;
        const dx=b.x-a.x, dy=b.y-a.y, d=Math.sqrt(dx*dx+dy*dy)||1;
        const f=(d-85)*0.05, fx=(dx/d)*f, fy=(dy/d)*f;
        a.vx+=fx; a.vy+=fy; b.vx-=fx; b.vy-=fy;
      });
      nodes.forEach(n => {
        n.vx+=(W/2-n.x)*0.008; n.vy+=(H/2-n.y)*0.008;
        n.x+=n.vx*0.6; n.y+=n.vy*0.6; n.vx*=0.7; n.vy*=0.7;
        n.x=Math.max(n.r+12,Math.min(W-n.r-12,n.x));
        n.y=Math.max(n.r+12,Math.min(H-n.r-12,n.y));
      });
    }

    // Build SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('width',W); svg.setAttribute('height',H);
    svg.style.cssText = 'position:absolute;top:0;left:0;';

    const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    defs.appendChild(mkMarker('wsAd','#1e2840'));
    defs.appendChild(mkMarker('wsAh','#e8a640'));
    defs.appendChild(mkMarker('wsAv','#2d3860'));
    svg.appendChild(defs);

    // Edges
    const eG = document.createElementNS('http://www.w3.org/2000/svg','g');
    edges.forEach(e => {
      const a=nm[e.source],b=nm[e.target]; if(!a||!b) return;
      const isV = e.relation==='VARIANT_OF';
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',a.x); line.setAttribute('y1',a.y);
      line.setAttribute('x2',b.x); line.setAttribute('y2',b.y);
      if (isV) {
        line.setAttribute('stroke','#2d3860'); line.setAttribute('stroke-width','1');
        line.setAttribute('stroke-dasharray','4,3'); line.setAttribute('opacity','0');
        line.setAttribute('marker-end','url(#wsAv)');
      } else {
        line.setAttribute('stroke','#1a1e30'); line.setAttribute('stroke-width','1.5');
        line.setAttribute('opacity','0'); line.setAttribute('marker-end','url(#wsAd)');
      }
      line.style.transition = 'opacity 0.4s,stroke 0.4s';
      eG.appendChild(line);
      _edgeEls.push({ line, sourceId: e.source, targetId: e.target, relation: e.relation||'' });
    });
    svg.appendChild(eG);

    // Nodes
    const nG = document.createElementNS('http://www.w3.org/2000/svg','g');
    nodes.forEach(n => {
      const color = TC[n.type]||'#6b7fa3';
      _nodePositions[n.id] = { x: n.x, y: n.y };

      const g = document.createElementNS('http://www.w3.org/2000/svg','g');
      g.style.cursor = 'pointer'; g.style.opacity = '0'; g.style.transition = 'opacity 0.35s';

      const glow = document.createElementNS('http://www.w3.org/2000/svg','circle');
      glow.setAttribute('cx',n.x); glow.setAttribute('cy',n.y); glow.setAttribute('r',n.r+8);
      glow.setAttribute('fill',color); glow.setAttribute('opacity','0.06');
      glow.style.transition = 'opacity 0.4s,fill 0.4s';
      if (n.weight===3) {
        const anim = document.createElementNS('http://www.w3.org/2000/svg','animate');
        anim.setAttribute('attributeName','opacity'); anim.setAttribute('values','0.06;0.16;0.06');
        anim.setAttribute('dur',(2.5+Math.random()*1.5)+'s'); anim.setAttribute('repeatCount','indefinite');
        glow.appendChild(anim);
      }
      g.appendChild(glow);

      const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
      c.setAttribute('cx',n.x); c.setAttribute('cy',n.y); c.setAttribute('r',n.r);
      c.setAttribute('fill','#0f1018'); c.setAttribute('stroke',color);
      c.setAttribute('stroke-width',n.weight===3?'2':'1.5');
      c.style.transition = 'stroke 0.4s,stroke-width 0.3s,fill 0.3s';
      g.appendChild(c);

      let dot = null;
      if (n.weight===3) {
        dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
        dot.setAttribute('cx',n.x); dot.setAttribute('cy',n.y); dot.setAttribute('r','3');
        dot.setAttribute('fill',color); dot.setAttribute('opacity','0.6');
        g.appendChild(dot);
      }

      const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
      txt.setAttribute('x',n.x); txt.setAttribute('y',n.y+n.r+12);
      txt.setAttribute('text-anchor','middle'); txt.setAttribute('fill','#6b7fa3');
      txt.setAttribute('font-family','DM Mono,monospace'); txt.setAttribute('font-size','8');
      txt.setAttribute('letter-spacing','0.3'); txt.style.transition = 'fill 0.3s';
      txt.textContent = n.label.length>18 ? n.label.slice(0,17)+'…' : n.label;
      g.appendChild(txt);

      _nodeEls[n.id] = { g, circle: c, glow, text: txt, dot, r: n.r, color };

      // Ghost node styling
      if (n.ghost) {
        c.setAttribute('fill','transparent');
        c.setAttribute('stroke-dasharray','4 3');
        c.setAttribute('opacity','0.6');
        glow.setAttribute('opacity','0.04');
      }

      enableDrag(g, n.id, wrap);

      g.addEventListener('mouseenter', ev => {
        if (_dragState) return;
        c.setAttribute('stroke-width','2.5'); glow.setAttribute('opacity',n.ghost?'0.12':'0.2');
        txt.setAttribute('fill',color);
        _edgeEls.forEach(({ line, sourceId, targetId, relation }) => {
          if (sourceId===n.id || targetId===n.id) {
            if (relation==='VARIANT_OF') {
              line.setAttribute('stroke','#6b7fa3'); line.setAttribute('stroke-width','1.5'); line.setAttribute('marker-end','url(#wsAv)');
            } else {
              line.setAttribute('stroke',color); line.setAttribute('stroke-width','2'); line.setAttribute('marker-end','url(#wsAh)');
            }
          }
        });
        ntip.style.display = 'block';
        const ghostTag = n.ghost ? `<div style="margin-top:4px;font-size:8px;color:var(--gold);">◈ Gap node — not yet in your story</div>` : '';
        ntip.innerHTML = `<div class="ntip-type">${n.type}${n.year?' · '+n.year:''}</div><div class="ntip-label">${n.label}</div><div class="ntip-detail">${n.detail||''}</div>${ghostTag}`;
      });

      g.addEventListener('mousemove', ev => {
        if (_dragState) return;
        const r = wrap.getBoundingClientRect();
        let tx = ev.clientX-r.left+12, ty = ev.clientY-r.top-10;
        if (tx+210 > W) tx -= 220;
        ntip.style.left = tx+'px'; ntip.style.top = ty+'px';
      });

      g.addEventListener('mouseleave', () => {
        if (_dragState) return;
        c.setAttribute('stroke-width',n.weight===3?'2':'1.5');
        glow.setAttribute('opacity',n.ghost?'0.04':'0.06');
        txt.setAttribute('fill','#6b7fa3');
        _edgeEls.forEach(({ line, sourceId, targetId, relation }) => {
          if (sourceId===n.id || targetId===n.id) {
            if (relation==='VARIANT_OF') {
              line.setAttribute('stroke','#2d3860'); line.setAttribute('stroke-width','1'); line.setAttribute('marker-end','url(#wsAv)');
            } else {
              line.setAttribute('stroke','#1a1e30'); line.setAttribute('stroke-width','1.5'); line.setAttribute('marker-end','url(#wsAd)');
            }
          }
        });
        ntip.style.display = 'none';
      });

      nG.appendChild(g);
    });
    svg.appendChild(nG);
    wrap.appendChild(svg);

    // Staggered entrance
    const order = ['role','decision','skill','project','outcome'];
    const sorted = [...nodes].sort((a,b) => (order.indexOf(a.type)||99)-(order.indexOf(b.type)||99));
    sorted.forEach((n,i) => setTimeout(() => { if(_nodeEls[n.id]) _nodeEls[n.id].g.style.opacity='1'; }, 60+i*45));
    const ed = 60+sorted.length*45+180;
    _edgeEls.forEach(({ line }, i) => setTimeout(() => line.setAttribute('opacity','1'), ed+i*12));
  });
}
