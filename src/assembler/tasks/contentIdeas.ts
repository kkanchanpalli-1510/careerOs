import { Node, PromptPackage } from '../types';

export function buildContentIdeasPrompt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any,
  recentNodeLabels: string[],
): PromptPackage {

  const graph = session.graph_data ?? { nodes: [], edges: [] };
  const w3Nodes: Node[] = graph.nodes.filter((n: Node) => n.weight === 3);
  const direction = session.insights?.branches?.[session.selected_branch ?? 0];

  const task_prompt = `Generate 3 specific article ideas for this person.

Each idea must be:
- Grounded in their actual graph nodes — not generic topics
- Specific enough that only this person could write it convincingly
- A clear point of view — not "thoughts on X" but "the non-obvious
  thing about X that most people miss"
- Relevant to their direction: ${direction?.title || 'not selected'}

Recently active nodes (highest relevance): ${recentNodeLabels.join(', ')}

Return ONLY valid JSON — no markdown, no backticks:
{
  "ideas": [
    {
      "title": "Specific opinionated article title",
      "premise": "One sentence: the non-obvious argument",
      "graph_nodes": ["node labels that provide the evidence"],
      "why_them": "One sentence: why this person specifically"
    }
  ]
}`;

  return {
    system: `You generate specific content ideas grounded in real career experience.
Every idea must reference actual graph data. Never suggest generic thought leadership topics.`,
    user_context: [
      w3Nodes.length
        ? `Defining experiences:\n${w3Nodes.map(n => `${n.label}: ${n.detail}`).join('\n')}`
        : '',
      `Career summary: ${session.career_summary ?? ''}`,
    ].filter(Boolean).join('\n\n'),
    task_prompt,
    estimated_tokens: 600,
    cache_key: `content_ideas_${session.id}_${session.summary_version ?? 0}`,
    metadata: {
      nodes_selected: w3Nodes.length,
      node_ids_selected: w3Nodes.map((n: Node) => n.id),
      truncated: false,
      summary_version: session.summary_version ?? 0,
    },
  };
}
