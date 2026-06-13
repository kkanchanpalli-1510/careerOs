// src/assembler/tasks/contentIdeas.ts

import type { CareerSession, Node } from '../../lib/nodeEnrichment';
import type { PromptPackage } from './nodeEnrichment';

export function buildContentIdeasPrompt(
  session: CareerSession,
  recentNodeLabels: string[]
): PromptPackage {

  const w3Nodes = session.graph_data?.nodes
    .filter((n: Node) => n.weight === 3)
    .map((n: Node) => `${n.label}: ${n.detail}`);

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
    system: `You generate specific content ideas grounded in real
career experience. Every idea must reference actual graph data.
Never suggest generic thought leadership topics.`,
    user_context: `Defining experiences:\n${w3Nodes?.join('\n')}
Career summary: ${(session as any).career_summary}`,
    task_prompt,
    estimated_tokens: 600,
    cache_key: `content_ideas_${session.id}_${(session as any).summary_version}`,
    metadata: {
      nodes_selected: w3Nodes?.length || 0,
      node_ids_selected: [],
      truncated: false,
      summary_version: (session as any).summary_version || 0
    }
  };
}
