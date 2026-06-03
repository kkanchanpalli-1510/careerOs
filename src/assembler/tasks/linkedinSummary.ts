import { PromptPackage } from '../types';
import { CareerStage, StageProfile, buildCareerSummary } from '../summary';

const LINKEDIN_STAGE_GUIDANCE: Record<CareerStage, string> = {
  ic: `STAGE: Individual Contributor
Tone: Specific, craft-forward, energetic. Celebrate what they build and create.
Opening: Lead with a distinctive capability or rare combination, not job title.
Evidence: Technical outputs, specific problems solved, unique approaches.
Forward: What kind of problems they want to work on next.`,

  leader: `STAGE: Manager / Director / Team Lead
Tone: Measured, impact-focused. The hero is what the team achieved.
Opening: Lead with the outcomes they enable, not their title.
Evidence: Team scale, capabilities built, cross-functional impact, systems created.
Forward: What kind of organization or challenge they want to help grow next.`,

  executive: `STAGE: VP / Executive / Founder
Tone: Deliberate, elevated. Peer-to-peer. Not self-promotional.
Opening: Lead with a point of view or the type of problem they're built for.
Evidence: Strategic bets made, organizational transformations, business outcomes.
Forward: What they're thinking about at the industry or platform level.`,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildLinkedInSummaryPrompt(session: any, stageProfile: StageProfile): PromptPackage {
  const stageGuidance  = LINKEDIN_STAGE_GUIDANCE[stageProfile.stage];
  const careerSummary  = buildCareerSummary(session);
  const graph          = session.graph_data ?? { nodes: [], edges: [] };
  const topNodes       = graph.nodes.filter((n: { weight: number }) => n.weight >= 2).slice(0, 12);
  const portrait       = session.insights?.portrait;
  const branches       = session.insights?.branches;
  const chosenBranch   = branches?.[session.selected_branch ?? 0];

  const system = `You are a LinkedIn profile expert who writes summaries that feel human, specific, and authentic — not like AI-generated marketing copy.

${stageGuidance}

BANNED WORDS (never use): passionate, seasoned, proven, dynamic, results-driven, thought leader, self-starter, go-getter, rockstar, ninja, guru, strategic thinker, innovative, leveraging, synergy`;

  const user_context = [
    `Career context:\n${careerSummary}`,
    portrait?.identity    ? `Identity reframe: ${portrait.identity}`                              : '',
    session.insights?.strength?.insight
      ? `Core strength: ${session.insights.strength.insight}`                                     : '',
    topNodes.filter((n: { type: string }) => n.type === 'outcome').length
      ? `Key outcomes: ${topNodes.filter((n: { type: string }) => n.type === 'outcome').map((n: { label: string }) => n.label).join(', ')}` : '',
    chosenBranch?.title   ? `Chosen direction: ${chosenBranch.title}`                            : '',
  ].filter(Boolean).join('\n\n');

  const task_prompt = `Write a LinkedIn profile summary for this person.

Requirements:
- First person voice throughout
- Under 2,400 characters (leave buffer for edits)
- Three paragraphs:
  Para 1 (2-3 sentences): The opening hook — who they are at their core, what makes them distinctive. NOT a job title recitation.
  Para 2 (3-4 sentences): The evidence — specific outcomes, what they've built, the impact. At least one concrete metric if available from their graph.
  Para 3 (2-3 sentences): Forward direction — what they're focused on now, what they're open to. Should feel aspirational but grounded.
- Tone calibrated to their career stage (see stage guidance above)
- Natural, human, reads like they wrote it themselves on a good day
- End with a single optional line: "Open to conversations about [their direction]."

Return ONLY the summary text. No explanation. No headers. No JSON.`;

  const summaryVersion: number = session.summary_version ?? 0;
  return {
    system,
    user_context,
    task_prompt,
    estimated_tokens: 800,
    cache_key:        `linkedin_${session.id}_v${summaryVersion}`,
    metadata: {
      nodes_selected:    topNodes.length,
      node_ids_selected: topNodes.map((n: { id: string }) => n.id),
      truncated:         false,
      summary_version:   summaryVersion,
    },
  };
}
