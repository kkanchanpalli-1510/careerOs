// Generates a targeted question for a single sparse node.
// Called from the nudge flow — not the normal enrichment interview.

import { PromptPackage } from '../types';
import { StageProfile } from '../summary';
import { Node, NudgeReason } from '../../lib/nodeEnrichment';

export function buildNodeEnrichmentPrompt(
  node: Node,
  connectedNodes: Node[],
  nudgeReason: NudgeReason,
  stageProfile: StageProfile,
): PromptPackage {

  const stageInstruction = {
    ic: `Focus on craft — what specifically they built, the technical
         decision they made, how they solved the hard part.`,
    leader: `Focus on leverage — what became possible for others,
             what the team achieved, what was built that outlasted
             their direct involvement.`,
    executive: `Focus on judgment — what bet was made and why,
                what they knew that others didn't, what conviction
                they had before it was validated.`,
  }[stageProfile.stage];

  const system = `You write single targeted questions to get professionals
to share the most valuable missing detail about a career experience.

The question must:
- Be specific to this exact node and its connections — not generic
- Reference specific connected nodes or outcomes by name where relevant
- Ask for the one thing that would complete the picture
- Never say "tell me more" — always ask for something concrete

${stageInstruction}`;

  const user_context = `Node to enrich:
Label: ${node.label}
Type: ${node.type}
Current detail (thin or missing): ${node.detail || 'none'}
Year: ${node.year || 'unknown'}

Connected nodes (reference these by name in the question):
${connectedNodes.slice(0, 5).map(n =>
    `- ${n.label} (${n.type}): ${n.detail || 'no detail'}`
  ).join('\n')}

Why this was selected:
${nudgeReason.centralitySentence}
${nudgeReason.recencySentence}`;

  const task_prompt = `Write one question to get the most valuable
missing detail about this experience.

Reference specific connected nodes or outcomes by name where it
makes the question more precise — show you've read the graph.

If current detail already mentions something, push deeper —
ask what's behind it, not what's already there.

One or two sentences maximum.
Return ONLY the question. No preamble. No explanation.`;

  return {
    system,
    user_context,
    task_prompt,
    estimated_tokens: 250,
    cache_key: `node_enrich_q_${node.id}_${stageProfile.stage}`,
    metadata: {
      nodes_selected: connectedNodes.length + 1,
      node_ids_selected: [node.id, ...connectedNodes.map(n => n.id)],
      truncated: false,
      summary_version: 0,
    },
  };
}
