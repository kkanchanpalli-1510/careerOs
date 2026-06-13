// src/lib/nodeEnrichmentTest.js
// Plain JS port of the spec unit tests — runs without TS compilation

function isNodeSparse(node) {
  const detailIsThin = !node.detail ||
    node.detail.length < 20 ||
    (node.detail.length < 50 && node.detail.toLowerCase().includes(
      node.label.toLowerCase().split(' ')[0]
    ));
  const missingYear = !node.year && node.weight >= 2;
  return detailIsThin || missingYear;
}

function getRecencyScore(node) {
  if (!node.year) return 0.5;
  const year = parseInt(node.year.split('-').pop() || '0');
  const age = new Date().getFullYear() - year;
  if (age <= 2) return 1.0;
  if (age <= 5) return 0.7;
  if (age <= 10) return 0.4;
  return 0.2;
}

function calculateNodeCentrality(nodeId, edges) {
  return edges.filter(e => e.source === nodeId || e.target === nodeId).length;
}

function scoreNodeForEnrichment(node, edges, enrichedNodeIds) {
  if (enrichedNodeIds.includes(node.id)) return 0;
  if (!isNodeSparse(node)) return 0;
  if (node.weight === 1) return 0;

  const centrality = calculateNodeCentrality(node.id, edges);
  const recency = getRecencyScore(node);
  const weight = node.weight;

  return (centrality * 0.45) + (weight * 0.35) + (recency * 0.20);
}

// ── Tests ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

console.log('\nRunning nodeEnrichment unit tests...\n');

// Test 1: weight-1 nodes never score
const weight1Node = { id: 'a', weight: 1, type: 'skill', label: 'Python', detail: '' };
assert(scoreNodeForEnrichment(weight1Node, [], []) === 0, 'weight-1 node scores 0');

// Test 2: enriched nodes never score
const enrichedNode = { id: 'b', weight: 3, type: 'role', label: 'PLG Architecture', detail: '' };
assert(scoreNodeForEnrichment(enrichedNode, [], ['b']) === 0, 'enriched node scores 0');

// Test 3: non-sparse nodes never score
const richNode = {
  id: 'c', weight: 3, type: 'project', label: 'Event Schema',
  detail: 'Built unified event schema that replaced fragmented log pipelines and enabled $100M PLG motion',
  year: '2022'
};
assert(scoreNodeForEnrichment(richNode, [], []) === 0, 'non-sparse node scores 0');

// Test 4: central recent node scores highest
const centralRecent = {
  id: 'd', weight: 3, type: 'project',
  label: 'PLG Architecture', detail: 'PLG', year: '2023'
};
const edges = Array(8).fill(null).map((_, i) => ({ source: 'd', target: `node${i}` }));
const score = scoreNodeForEnrichment(centralRecent, edges, []);
// Expected: (8*0.45) + (3*0.35) + (0.7*0.20) = 3.6 + 1.05 + 0.14 = 4.79
const expectedScore = (8 * 0.45) + (3 * 0.35) + (0.7 * 0.20);
assert(score > 4.0, `central recent node scores > 4.0 (got ${score.toFixed(3)}, expected ~${expectedScore.toFixed(3)})`);

// Test 5: isNodeSparse — detail mentioning label word is sparse
const labelRepeatNode = { id: 'e', weight: 2, label: 'Product Strategy', detail: 'Product work done here', year: '2021' };
assert(isNodeSparse(labelRepeatNode) === true, 'detail repeating label word is sparse');

// Test 6: isNodeSparse — missing year on weight-2 node is sparse
const noYearNode = { id: 'f', weight: 2, label: 'Leadership', detail: 'Led cross-functional teams to deliver platform initiatives' };
assert(isNodeSparse(noYearNode) === true, 'missing year on weight-2 node is sparse');

// Test 7: getRecencyScore — year ranges
assert(getRecencyScore({ year: String(new Date().getFullYear() - 1) }) === 1.0, 'recency 1yr ago = 1.0');
assert(getRecencyScore({ year: String(new Date().getFullYear() - 4) }) === 0.7, 'recency 4yr ago = 0.7');
assert(getRecencyScore({ year: String(new Date().getFullYear() - 8) }) === 0.4, 'recency 8yr ago = 0.4');
assert(getRecencyScore({ year: String(new Date().getFullYear() - 12) }) === 0.2, 'recency 12yr ago = 0.2');
assert(getRecencyScore({}) === 0.5, 'no year = 0.5');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
