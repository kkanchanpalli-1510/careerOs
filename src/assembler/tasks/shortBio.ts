import { PromptPackage } from '../types';
import { CareerStage, StageProfile, buildCareerSummary } from '../summary';

const BIO_STAGE_GUIDANCE: Record<CareerStage, string> = {
  ic: `STAGE: Individual Contributor
Lead with craft and rare capability. What this person builds.
Evidence: specific technical outputs, unusual skill combinations.
Avoid: management language, org scale, team size.`,

  leader: `STAGE: Manager / Director
Lead with leverage and what they enable in others.
Evidence: team scale, capabilities built, cross-functional outcomes.
The bio should feel like someone who makes organizations better.`,

  executive: `STAGE: VP / Executive
Lead with a point of view or the type of problem they are built for.
Evidence: strategic bets, organizational transformation, business outcomes.
Tone: peer-to-peer, measured. Not self-promotional.`,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Addressing {
  preferred_name: string | null;
  pronouns:       string | null;
}

/**
 * How to refer to the person in third-person copy.
 * Never inferred — only what they told us. Absent means neutral.
 */
function addressingRule(addressing?: Addressing): string {
  const name = addressing?.preferred_name?.trim();
  const pro  = addressing?.pronouns?.trim();

  if (!name && !pro) {
    return `- Third person voice. Do NOT use any person's name — use "They" throughout ("They build..." not "I build..."). Never invent or assume a name or a gender.`;
  }

  const parts = [`- Third person voice.`];
  parts.push(name
    ? `Refer to them as "${name}" on first mention, then by pronoun. Use this name exactly as written — do not shorten, expand, or re-order it.`
    : `Do NOT use any person's name — never invent or assume one.`);
  parts.push(pro
    ? `Their pronouns are ${pro} — use them consistently and correctly throughout. Do not substitute a different set, and do not avoid pronouns entirely.`
    : `Use "They" as the pronoun — they have not told us a different set, so do not guess one.`);
  return parts.join(' ');
}

export function buildShortBioPrompt(
  session: any, stageProfile: StageProfile, addressing?: Addressing,
): PromptPackage {
  const graph        = session.graph_data ?? { nodes: [], edges: [] };
  const portrait     = session.insights?.portrait;
  const careerSummary = buildCareerSummary(session);
  const w3Labels     = graph.nodes
    .filter((n: { weight: number }) => n.weight === 3)
    .map((n: { label: string }) => n.label);
  const branches     = session.insights?.branches;
  const chosenBranch = branches?.[session.selected_branch ?? 0];

  const system = `You write professional bios that feel human and specific — not AI-generated marketing copy. The bio should sound like the person wrote it themselves on a very good day.

${BIO_STAGE_GUIDANCE[stageProfile.stage]}

BANNED WORDS: passionate, seasoned, proven, dynamic, results-driven, thought leader, self-starter, innovative, leveraging`;

  const user_context = [
    portrait?.identity              ? `Identity: ${portrait.identity}`                             : '',
    session.insights?.strength?.insight
      ? `Core strength: ${session.insights.strength.insight}`                                      : '',
    w3Labels.length                 ? `Defining capabilities: ${w3Labels.join(', ')}`             : '',
    `Career context: ${careerSummary}`,
    chosenBranch?.title             ? `Chosen direction: ${chosenBranch.title}`                   : '',
  ].filter(Boolean).join('\n');

  const task_prompt = `Write a short professional bio for this person.

Requirements:
- 100–150 words maximum
${addressingRule(addressing)}
- Two to three sentences:
  Sentence 1: Who they are at their core + what makes them distinctive. NOT a job title. Lead with the identity reframe.
  Sentence 2: Evidence — one or two specific outcomes or capabilities that ground the identity claim. At least one concrete signal.
  Sentence 3 (optional): Current focus or direction. What they are building toward or open to.
- Reads naturally when spoken aloud at a conference introduction
- Specific enough that it could only be about this person

Return ONLY the bio text. No labels. No JSON. No explanation.`;

  const w3Nodes: Array<{ id: string }> = graph.nodes.filter((n: { weight: number }) => n.weight === 3);
  const summaryVersion: number = session.summary_version ?? 0;
  return {
    system,
    user_context,
    task_prompt,
    estimated_tokens: 400,
    cache_key:        `bio_${session.id}_v${summaryVersion}_${addressing?.preferred_name ?? ''}_${addressing?.pronouns ?? ''}`,
    metadata: {
      nodes_selected:    w3Nodes.length,
      node_ids_selected: w3Nodes.map((n) => n.id),
      truncated:         false,
      summary_version:   summaryVersion,
    },
  };
}
