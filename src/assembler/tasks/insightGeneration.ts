import { Node, Edge, PromptPackage } from '../types';
import { CareerStage, StageProfile } from '../summary';

// ── Stage instructions ────────────────────────────────────────────────────────

const STAGE_INSTRUCTIONS: Record<CareerStage, string> = {
  ic: `CAREER STAGE: Individual Contributor

FOCUS: What this person builds, creates, and sees that others cannot.
The remarkable thing about them is CRAFT — rare technical capability,
unusual combinations of skills, the instinct to build the right thing.

TONE: Direct, energetic, specific. Short punchy sentences.
Celebrate depth and specificity. Use active verbs.

OPENS WITH: "You build..." / "You see..." / "You create..." /
"You have an instinct for..." / "Your ability to [specific thing]..."

VOCABULARY: build, create, solve, design, see, instinct, craft, depth,
rare combination, almost no one, specific capability

EVIDENCE: Ground in specific technical outputs, projects built,
problems solved in a way others couldn't

IDENTITY REFRAME: The craftsperson. The builder. The inventor.
Someone who produces things others cannot.

WHAT TO AVOID: Generic leadership language. "Strategic vision."
Anything that sounds like a performance review.`,

  leader: `CAREER STAGE: Manager / Director / Team Lead

FOCUS: The leverage this person creates in others and the systems
they build that outlast their direct involvement.
The remarkable thing is the FORCE MULTIPLIER — they make teams
better, translate between technical and organizational reality,
build capabilities that compound.

TONE: Measured, warm, specific about impact on others.
Medium sentence length. The hero is what they enabled,
not what they personally produced.

OPENS WITH: "You create conditions..." / "You multiply..." /
"What makes you rare is not what you build — it's what you
enable others to build." / "You have a gift for..."

VOCABULARY: enables, multiplies, builds teams, creates conditions,
translates, bridges, compounds, outlasts, leverage, force multiplier

EVIDENCE: Ground in team outcomes, capabilities built in others,
systems that continued after they moved on

IDENTITY REFRAME: The multiplier. The builder of builders.
Someone who creates leverage that outlasts their direct involvement.

WHAT TO AVOID: Focusing only on their individual technical output.
Ignoring the organizational impact. Using IC-level language
for someone who has clearly moved beyond individual execution.`,

  executive: `CAREER STAGE: VP / SVP / C-Suite / Executive / Founder

FOCUS: The bets they make and the worlds they create.
The remarkable thing is JUDGMENT — they see the strategic move
before it is obvious, have the conviction to make it, and
the credibility to move organizations toward it.

TONE: Deliberate, measured, elevated. Longer sentences that
carry weight. Not breathless. Not hushed reverence.
The tone of someone speaking to an equal who happens to
have a remarkable pattern in their history.

OPENS WITH: "You have the judgment to..." / "You possess a rare
quality of mind..." / "What distinguishes you is not..." /
"You are one of the few people who can..."

VOCABULARY: judgment, vision, conviction, bets, shapes, defines,
architecture, transformation, before it was obvious, moves
organizations, rare quality, consequential

EVIDENCE: Ground in strategic decisions made before they were
validated, organizational transformations led, the moments where
they had conviction without proof

IDENTITY REFRAME: The architect. The bet-maker. The world-builder.
Someone who creates the conditions in which great things become possible.

WHAT TO AVOID: Focusing on execution. Focusing on individual
technical output. Anything that sounds like IC or manager-level
achievement. Breathless admiration — executives respond to
peers, not fans.`,
};

function buildTransitionNote(profile: StageProfile): string {
  if (!profile.isTransitioning && !profile.titleCapabilityGap) return '';

  if (profile.titleCapabilityGap) {
    return `IMPORTANT — TITLE/CAPABILITY GAP DETECTED:
This person's outcomes suggest they are operating ABOVE their current title.
Their capabilities and impact are at a higher level than their formal position.
Surface this gap explicitly as part of the identity reframe — they are
already operating at the next level, they just haven't been formally
recognized for it yet. This is often the most valuable insight Career OS
can deliver.`;
  }

  if (profile.transitionDirection === 'ic_to_leader') {
    return `IMPORTANT — RECENT TRANSITION: IC → LEADER
This person has recently moved from individual contributor to leading others.
They likely still think of themselves primarily as a builder/craftsperson.
The insight should honor their IC roots while helping them see that their
identity is expanding — they are now building people and systems, not just products.
This is an identity transition moment. Handle with care and specificity.`;
  }

  if (profile.transitionDirection === 'leader_to_executive') {
    return `IMPORTANT — RECENT TRANSITION: LEADER → EXECUTIVE
This person has recently crossed into executive-level scope and impact.
They may still describe themselves in manager/director terms.
The insight should reflect back the executive-level pattern already
visible in their graph — the strategic bets, the organizational impact,
the judgment calls — even if they haven't fully claimed that identity yet.`;
  }

  return '';
}

// ── Banned words + validation ─────────────────────────────────────────────────

const BANNED_WORDS = [
  'seasoned', 'passionate', 'proven', 'dynamic', 'results-driven',
  'strategic thinker', 'thought leader', 'self-starter', 'go-getter',
  'visionary', 'innovative', 'exceptional', 'outstanding', 'remarkable',
  'accomplished', 'experienced', 'skilled', 'talented',
  'dedicated', 'committed', 'driven', 'motivated', 'collaborative',
];

export function buildInsightPrompt(
  selectedNodes: Node[],
  edges: Edge[],
  stageProfile: StageProfile,
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

  const stageInstructions = STAGE_INSTRUCTIONS[stageProfile.stage];
  const transitionNote    = buildTransitionNote(stageProfile);

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

Pattern 5 — THE MULTI-LENS OPERATOR
If the graph contains VARIANT_OF edges — two projection nodes connected by VARIANT_OF from the same experience — the person operates with fundamentally different professional identities from the same raw material. This is rare.
Name both lenses explicitly and explain that having both is the differentiator, not either one alone.
Frame: "Most people who [lens A] cannot also [lens B]. You do both — from the same work."
Example signal: a project or role node with two VARIANT_OF-linked peers, each with their own distinct downstream skill/outcome edges pointing into different domains.

RECENCY PRINCIPLE:
The insight must reflect who this person IS NOW and IS BECOMING — not just who they were.
- Nodes with recent years (last 2-3 years) are leading indicators; treat them as more signal-rich than older nodes with the same weight
- If recent nodes reveal an emerging capability or identity shift — surface that over the historical through-line
- The identity reframe (sentence 3) should describe who they are today and growing into, not just what they've always been
- Exception: if a decades-long behavioral pattern has recent evidence too, that cross-temporal consistency IS worth naming

ABSOLUTE RULES:
- Never use: seasoned, passionate, proven, dynamic, results-driven, strategic thinker, thought leader, self-starter — these are resume words that signal nothing
- Never open with their job title or company name
- Never describe what they have accomplished — describe what they ARE
- The insight must be specific enough it could only apply to this person's graph, not to any senior professional
- Maximum 3 sentences. No hedging. No "it appears" or "it seems" or "it looks like"
- Tone: like a trusted mentor who has studied their entire career and is telling them something true that nobody else has ever named for them
- The final sentence (the reframe) should be something they would actually put in their LinkedIn bio or use to introduce themselves

${stageInstructions}${transitionNote ? `\n\n${transitionNote}` : ''}`;

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
