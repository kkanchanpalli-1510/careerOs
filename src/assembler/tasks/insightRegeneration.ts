// Regenerate insight — identical pipeline to buildInsightPrompt but asks Claude
// to surface a DIFFERENT structural pattern from the same graph.
// Previous insight is passed as context so it is explicitly not repeated.

import { Node, Edge, PromptPackage } from '../types';
import { StageProfile } from '../summary';
import { buildInsightPrompt } from './insightGeneration';

const BASE_TASK_PROMPT = `Generate the insight. Return ONLY valid JSON:
{
  "insight": "2-3 sentence insight following the Gift/Evidence/Reframe structure. Use **bold** for the identity label in sentence 3.",
  "strength_label": "3-4 word label for their core strength (used internally)",
  "pattern_nodes": ["node_id1", "node_id2", "node_id3"],
  "pattern_type": "recurring_unrequested_decision | rare_capability_combination | identity_title_mismatch | compounding_thread",
  "identity_reframe": "the bold phrase from sentence 3 — what they actually are"
}`;

export function buildInsightRegenerationPrompt(
  selectedNodes: Node[],
  edges: Edge[],
  stageProfile: StageProfile,
  previousInsight: string,
): PromptPackage {
  // Start from the exact same base prompt (same system, user_context, stage instructions)
  const base = buildInsightPrompt(selectedNodes, edges, stageProfile);

  // Replace task_prompt with the regeneration variant that explicitly excludes the previous pattern
  const task_prompt = `Generate a NEW insight that surfaces a DIFFERENT structural pattern from this career graph. Do not repeat or rephrase the previous insight.

Previous insight (do not repeat this pattern):
"${previousInsight}"

Find the SECOND most interesting structural pattern — one the person has probably also never articulated. Apply the same quality bar: strength-first, grounded in specific nodes, identity-reframing. The identity reframe in sentence 3 must use **bold**.

${BASE_TASK_PROMPT}`;

  return {
    ...base,
    task_prompt,
    cache_key: `insight_regen_${selectedNodes.map(n => n.id).sort().join('_')}`,
  };
}
