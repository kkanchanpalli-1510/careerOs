// Pure function — no I/O, no DB calls, no Claude calls

import { CareerGraph, SessionInsights } from './types';

export function buildDeterministicSkeleton(
  graph: CareerGraph,
  insights: SessionInsights | null,
  selectedBranch: number | null
): string {
  const w3 = graph.nodes
    .filter(n => n.weight === 3)
    .map(n => n.label);

  const w2 = graph.nodes
    .filter(n => n.weight === 2)
    .map(n => n.label)
    .slice(0, 4);

  const outcomes = graph.nodes
    .filter(n => n.type === 'outcome')
    .map(n => n.label)
    .slice(0, 3);

  const direction =
    selectedBranch !== null && insights?.branches?.[selectedBranch]
      ? insights.branches[selectedBranch].title
      : null;

  const identityReframe = insights?.strength?.identity_reframe ?? '';

  return [
    identityReframe ? `Identity: ${identityReframe}.`              : '',
    w3.length       ? `Career context: ${w3.join(', ')} [defining].` : '',
    w2.length       ? `Supporting: ${w2.join(', ')}.`               : '',
    direction       ? `Direction: ${direction}.`                    : '',
    outcomes.length ? `Key outcomes: ${outcomes.join(', ')}.`       : '',
  ].filter(Boolean).join(' ');
}

export function buildCareerSummary(session: {
  graph_data: CareerGraph | null;
  insights: SessionInsights | null;
  selected_branch: number | null;
  behavioral_pattern: string | null;
}): string {
  const graph = session.graph_data ?? { nodes: [], edges: [] };
  const skeleton = buildDeterministicSkeleton(graph, session.insights, session.selected_branch);
  const pattern = session.behavioral_pattern ?? '';
  return [skeleton, pattern].filter(Boolean).join('\n');
}
