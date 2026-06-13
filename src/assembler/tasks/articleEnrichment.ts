import { Node, CareerGraph } from '../types';
import { anthropic, MODEL } from '../../lib/anthropic';

export interface EnrichmentUpdate {
  ghost_node_id:    string;
  ghost_node_label: string;
  progress_delta:   number;
  reasoning:        string;
}

export interface EnrichmentResult {
  updates: EnrichmentUpdate[];
}

export async function evaluateArticleAgainstGhostNodes(
  articleContent:    string,
  articleTitle:      string,
  ghostNodes:        Node[],
  targetGhostNodeId: string | null,
): Promise<EnrichmentResult> {
  const openGhosts = ghostNodes
    .filter(n => ((n as any).ghost_progress ?? 0) < 0.8)
    .slice(0, 8);

  if (!openGhosts.length) return { updates: [] };

  const prompt = `You are evaluating how much an article closes specific career gaps.

Article title: "${articleTitle}"
Article excerpt (first 600 words):
"""
${articleContent.slice(0, 2400)}
"""

Open career gaps (ghost nodes):
${openGhosts.map(n => `- ID: ${n.id} | ${n.label} (${n.type}): ${n.detail}`).join('\n')}

${targetGhostNodeId
    ? `NOTE: This article was intentionally written to address gap ID: ${targetGhostNodeId}`
    : ''}

For each ghost node the article MEANINGFULLY addresses, return an update.
Only include gaps where the article genuinely demonstrates or develops the capability.

Progress scale:
- 0.4 = article clearly and fully demonstrates this capability
- 0.3 = article partially demonstrates this capability
- 0.2 = article touches on this but doesn't fully demonstrate it
- omit = not addressed

Return ONLY valid JSON array (empty array if no gaps addressed) — no markdown:
[{
  "ghost_node_id": "id from the list above",
  "ghost_node_label": "label from the list above",
  "progress_delta": 0.2|0.3|0.4,
  "reasoning": "one sentence — specifically how this article addresses this gap"
}]`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (response.content[0] as { type: string; text: string }).text?.trim() ?? '';
  const cleaned = text.replace(/^```json\n?|```$/g, '').trim();

  try {
    const updates = JSON.parse(cleaned);
    return { updates: Array.isArray(updates) ? updates : [] };
  } catch {
    return { updates: [] };
  }
}

export function buildEnrichmentToast(updates: EnrichmentUpdate[], graph: CareerGraph): string {
  if (!updates.length) return 'Published ✓ — added to your career graph';

  const converted = updates.filter(u => {
    const node = graph.nodes.find(n => n.id === u.ghost_node_id);
    return node && !(node as any).ghost;
  });

  if (converted.length > 0) {
    return `Published ✓ — "${converted[0].ghost_node_label}" gap closed`;
  }
  return `Published ✓ — ${updates[0].ghost_node_label} gap progressed`;
}
