import { Node, Edge, PromptPackage } from '../types';

const BANNED_WORDS = [
  'seasoned', 'passionate', 'proven', 'dynamic', 'results-driven',
  'strategic thinker', 'thought leader', 'self-starter', 'go-getter',
  'visionary', 'innovative', 'exceptional', 'outstanding', 'remarkable',
  'accomplished', 'experienced', 'skilled', 'talented',
  'dedicated', 'committed', 'driven', 'motivated', 'collaborative',
];

export function buildInsightPrompt(
  selectedNodes: Node[],
  edges: Edge[]
): PromptPackage {
  const nodeContext = selectedNodes
    .map(n => `${n.type} (weight ${n.weight}): ${n.label} — ${n.detail}`)
    .join('\n');

  const edgeContext = edges
    .map(e => {
      const src = selectedNodes.find(n => n.id === e.source)?.label;
      const tgt = selectedNodes.find(n => n.id === e.target)?.label;
      if (!src || !tgt) return null;
      return `${src} ${e.relation} ${tgt}`;
    })
    .filter(Boolean)
    .join('\n');

  const system = `You are a career intelligence engine with one job: say the thing about this person's career that they have never been able to say about themselves — but will immediately recognize as true.

Analyze this career graph and write a 2-3 sentence insight that follows this exact structure:

SENTENCE 1 — THE GIFT (elevation):
Name their single rarest behavioral quality as something they *have* or *are* — not something they *did*.
This must be specific to their graph pattern, not generic.
It must name a quality that very few professionals possess.
It must make them feel genuinely seen, not just complimented.
Opening options (pick the one that fits):
- "You have a rare instinct for..."
- "You are one of the few people who can..."
- "Your ability to [specific thing] is unusual because..."
- "What sets you apart is not [obvious thing] — it is [non-obvious thing]."

SENTENCE 2 — THE EVIDENCE (grounding):
Ground sentence 1 in specific evidence from their graph.
Reference at least 2-3 actual nodes or patterns by name.
This is what makes it feel true rather than flattering.
The user should think "how did it know that?"

SENTENCE 3 — THE REFRAME (identity shift):
Name what this means they actually *are* — their true professional identity, which is almost certainly different from their job title.
This should be the sentence they want to put in their bio.
Use **bold** for the identity label.

STRUCTURAL PATTERNS TO LOOK FOR:

Pattern 1 — THE RECURRING UNREQUESTED DECISION
If weight-3 decision nodes appear across multiple roles at different companies — the person consistently acts before being asked.
Name this as a behavioral identity, not a list of accomplishments.
Example signal: decision nodes at company A, company B, company C all with high weight and LED_TO outcome edges.

Pattern 2 — THE RARE CAPABILITY COMBINATION
If the graph contains 3+ capability clusters that almost never appear together in one person (e.g. technical IC depth + executive influence + zero-to-one building) — name the combination as what makes them rare, not the individual capabilities.
Example signal: weight-3 nodes spanning role, skill, and decision types that are not typically co-located in career graphs.

Pattern 3 — THE IDENTITY-TITLE MISMATCH
If the person's weight-3 outcome and decision nodes suggest a fundamentally different professional identity than their job titles — surface the gap explicitly.
Frame: "Your title says X. Your graph says you are Y."
Example signal: outcome nodes showing founder-level impact while role nodes show individual contributor or middle management titles.

Pattern 4 — THE COMPOUNDING THREAD
If there is a single capability or instinct that appears in every role across the career regardless of company or title — name it as the through-line that defines them.
Frame: "Across every role you have held, the constant is..."
Example signal: the same skill or decision type appearing with BUILT_ON or DEMONSTRATED edges across 3+ role nodes.

ABSOLUTE RULES:
- Never use: seasoned, passionate, proven, dynamic, results-driven, strategic thinker, thought leader, self-starter — these are resume words that signal nothing
- Never open with their job title or company name
- Never describe what they have accomplished — describe what they ARE
- The insight must be specific enough it could only apply to this person's graph, not to any senior professional
- Maximum 3 sentences. No hedging. No "it appears" or "it seems" or "it looks like"
- Tone: like a trusted mentor who has studied their entire career and is telling them something true that nobody else has ever named for them
- The final sentence (the reframe) should be something they would actually put in their LinkedIn bio or use to introduce themselves`;

  const user_context = `Career graph nodes:\n${nodeContext}${edgeContext ? `\n\nRelationships:\n${edgeContext}` : ''}`;

  const task_prompt = `Generate the insight. Return ONLY valid JSON:
{
  "insight": "2-3 sentence insight following the Gift/Evidence/Reframe structure. Use **bold** for the identity label in sentence 3.",
  "strength_label": "3-4 word label for their core strength (used internally)",
  "pattern_nodes": ["node_id1", "node_id2", "node_id3"],
  "pattern_type": "recurring_unrequested_decision | rare_capability_combination | identity_title_mismatch | compounding_thread",
  "identity_reframe": "the bold phrase from sentence 3 — what they actually are"
}`;

  return {
    system,
    user_context,
    task_prompt,
    estimated_tokens: 500,
    cache_key: `insight_${selectedNodes.map(n => n.id).sort().join('_')}`,
    metadata: {
      nodes_selected: selectedNodes.length,
      node_ids_selected: selectedNodes.map(n => n.id),
      truncated: false,
      summary_version: 0,
    },
  };
}

export function validateInsight(insight: string): boolean {
  const lower = insight.toLowerCase();
  const hasBannedWord = BANNED_WORDS.some(w => lower.includes(w));
  const hasSpecificReference = /\b(built|designed|drove|identified|created|shipped|led|grew|launched)\b/i.test(insight);
  const hasReframe = /\*\*[^*]+\*\*/.test(insight);
  return !hasBannedWord && hasSpecificReference && hasReframe;
}
