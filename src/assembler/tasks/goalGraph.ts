import { Node, Edge, CareerGraph } from '../types';
import { detectStageProfile } from '../summary';
import { anthropic, MODEL } from '../../lib/anthropic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateGoalGhostNodes(session: any, goalTitle: string): Promise<Node[]> {
  const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };
  const existingLabels = graph.nodes
    .filter(n => !(n as any).ghost)
    .map(n => n.label)
    .join(', ');

  const stageProfile = detectStageProfile(graph);
  const careerSummary: string = session.career_summary ?? '';

  const stageContext = {
    ic:        'This person is an individual contributor. Ghost nodes should represent specific technical skills, project outcomes, or craft-level capabilities.',
    leader:    'This person is a manager or director. Ghost nodes should represent leadership scope, team-building outcomes, and cross-functional influence.',
    executive: 'This person is an executive. Ghost nodes should represent strategic decisions, P&L ownership, board-level communication, and organization-building.',
  }[stageProfile.stage];

  const prompt = `You are mapping the gap between a professional's current career graph and their target role.

Current career summary:
${careerSummary}

Career stage context: ${stageContext}

Existing node labels (do NOT create ghost nodes for things already present):
${existingLabels}

Target role: "${goalTitle}"

Generate 4-7 ghost nodes representing the GENUINE GAPS — experiences, skills, outcomes, or decisions this person needs to develop to reach their goal.

Rules:
- Only generate gaps that are ABSENT from the existing node list
- Each gap should be SPECIFIC and ACHIEVABLE — not generic ("leadership skills")
- Each gap should be closable through work, writing, or structured experience
- Weight 3 = critical gap (blocks the role), Weight 2 = important gap, Weight 1 = nice to have
- Include a mix of node types: skills, outcomes, and at least one decision

Return ONLY a valid JSON array — no markdown, no backticks:
[{
  "id": "ghost_snake_case_unique_id",
  "type": "skill|project|outcome|decision|role",
  "label": "2-4 words",
  "detail": "one sentence — what this gap represents and why it matters for the target role",
  "year": null,
  "weight": 1|2|3,
  "ghost": true,
  "ghost_progress": 0.0
}]`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (response.content[0] as { type: string; text: string }).text?.trim() ?? '';
  let cleaned = text.replace(/^```json\n?|```$/g, '').trim();
  // Repair truncated JSON array — find the last complete object and close the array
  if (!cleaned.endsWith(']')) {
    const lastClose = cleaned.lastIndexOf('}');
    if (lastClose !== -1) cleaned = cleaned.slice(0, lastClose + 1) + ']';
  }
  const nodes = JSON.parse(cleaned) as Node[];

  // Ensure IDs are unique by appending timestamp suffix
  const ts = Date.now();
  return nodes.map((n, i) => ({ ...n, id: `${n.id}_${ts}_${i}` }));
}

export function buildGhostEdges(ghostNodes: Node[], allNodes: Node[]): Array<Edge & { ghost: boolean }> {
  const highWeightReal = allNodes
    .filter(n => !(n as any).ghost && n.weight >= 2)
    .slice(0, 10);

  const edges: Array<Edge & { ghost: boolean }> = [];

  for (const ghost of ghostNodes) {
    const ghostWords = new Set(ghost.label.toLowerCase().split(/\s+/));
    let bestMatch = highWeightReal[0];
    let bestScore = 0;

    for (const real of highWeightReal) {
      const realWords = new Set(real.label.toLowerCase().split(/\s+/));
      const overlap = [...ghostWords].filter(w => realWords.has(w)).length;
      if (overlap > bestScore) { bestScore = overlap; bestMatch = real; }
    }

    if (bestMatch) {
      edges.push({ source: bestMatch.id, target: ghost.id, relation: 'LED_TO' as const, ghost: true });
    }
  }

  return edges;
}
