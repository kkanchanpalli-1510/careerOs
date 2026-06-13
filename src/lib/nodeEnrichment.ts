// src/lib/nodeEnrichment.ts

export interface Node {
  id: string;
  weight: number;
  type: string;
  label: string;
  detail?: string | null;
  year?: string | null;
}

export interface Edge {
  source: string;
  target: string;
}

export interface CareerGraph {
  nodes: Node[];
  edges: Edge[];
}

export interface CareerSession {
  id: string;
  insights?: {
    linkedin_summary?: string;
    branches?: Array<{ title: string }>;
    [key: string]: any;
  };
  selected_branch?: number;
  graph_data?: CareerGraph;
  enriched_node_ids?: string[];
}

export interface NudgeReason {
  nodeLabel: string;
  centralitySentence: string;
  recencySentence: string;
  sparsitySentence: string;
  impacts: string[];
  connectionCount: number;
  notableConnections: string[];
}

// ── Scoring functions ──────────────────────────────────────────────────────

export function isNodeSparse(node: Node): boolean {
  const detailIsThin = !node.detail ||
    node.detail.length < 20 ||
    (node.detail.length < 50 && node.detail.toLowerCase().includes(
      node.label.toLowerCase().split(' ')[0]
    ));
  const missingYear = !node.year && node.weight >= 2;
  return detailIsThin || missingYear;
}

export function getRecencyScore(node: Node): number {
  if (!node.year) return 0.5;
  const year = parseInt(node.year.split('-').pop() || '0');
  const age = new Date().getFullYear() - year;
  if (age <= 2) return 1.0;
  if (age <= 5) return 0.7;
  if (age <= 10) return 0.4;
  return 0.2;
}

export function calculateNodeCentrality(nodeId: string, edges: Edge[]): number {
  return edges.filter(e => e.source === nodeId || e.target === nodeId).length;
}

export function scoreNodeForEnrichment(
  node: Node,
  edges: Edge[],
  enrichedNodeIds: string[]
): number {
  if (enrichedNodeIds.includes(node.id)) return 0;
  if (!isNodeSparse(node)) return 0;
  if (node.weight === 1) return 0;

  const centrality = calculateNodeCentrality(node.id, edges);
  const recency = getRecencyScore(node);
  const weight = node.weight;

  return (centrality * 0.45) + (weight * 0.35) + (recency * 0.20);
}

export function selectNextNudge(
  graph: CareerGraph,
  enrichedNodeIds: string[]
): Node | null {
  const scored = graph.nodes
    .map(node => ({
      node,
      score: scoreNodeForEnrichment(node, graph.edges, enrichedNodeIds)
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.node || null;
}

export function getConnectedNodes(nodeId: string, graph: CareerGraph): Node[] {
  const connectedIds = graph.edges
    .filter(e => e.source === nodeId || e.target === nodeId)
    .map(e => e.source === nodeId ? e.target : e.source);

  return graph.nodes
    .filter(n => connectedIds.includes(n.id))
    .sort((a, b) => b.weight - a.weight);
}

// ── Reason builder ─────────────────────────────────────────────────────────

export function buildNudgeReason(
  node: Node,
  graph: CareerGraph,
  session: CareerSession,
  precomputedConnectedNodes?: Node[]
): NudgeReason {
  const connectedNodes = precomputedConnectedNodes ?? getConnectedNodes(node.id, graph);
  const connectedIds = connectedNodes.map(n => n.id);
  const notableConnections = connectedNodes
    .filter(n => n.weight >= 2)
    .slice(0, 3)
    .map(n => n.label);

  const centralitySentence = notableConnections.length > 0
    ? `This experience connects to ${connectedIds.length} other nodes in your graph — including ${notableConnections.join(', ')}.`
    : `This experience is referenced by ${connectedIds.length} other nodes in your graph.`;

  const recencyScore = getRecencyScore(node);
  const recencySentence = recencyScore >= 0.7
    ? `It's recent work (${node.year}) — highly relevant to where you're headed.`
    : recencyScore >= 0.4
    ? `It's from ${node.year} — still central to your current capability set.`
    : `Though from ${node.year || 'earlier in your career'}, it's foundational to your current pattern.`;

  const sparsitySentence = node.detail && node.detail.length > 10
    ? `We only have one line about what you actually built here.`
    : `We have the label but no detail about what this involved.`;

  const impacts = buildImpactList(node, session, connectedIds.length);

  return {
    nodeLabel: node.label,
    centralitySentence,
    recencySentence,
    sparsitySentence,
    impacts,
    connectionCount: connectedIds.length,
    notableConnections
  };
}

function buildImpactList(
  node: Node,
  session: CareerSession,
  centrality: number
): string[] {
  const impacts: string[] = [];
  const summary = session.insights?.linkedin_summary || '';
  const direction = session.insights?.branches?.[session.selected_branch ?? 0];

  if (summary.toLowerCase().includes(node.label.toLowerCase())) {
    impacts.push('Your LinkedIn summary becomes more specific');
  }
  if (direction) {
    impacts.push(`Your "${direction.title}" direction gets stronger evidence`);
  }
  if (node.weight === 3) {
    impacts.push('Your career portrait gains a concrete example');
  }
  if (centrality >= 5) {
    impacts.push('Your core strength insight becomes more grounded');
  }

  return impacts.slice(0, 3);
}
