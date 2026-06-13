import { Node, PromptPackage } from '../types';
import { StageProfile, buildCareerSummary } from '../summary';
import { VoiceProfile } from '../../lib/voiceProfile';

export function buildArticleDraftPrompt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any,
  userThoughts: string,
  stageProfile: StageProfile,
  voiceProfile?: VoiceProfile | null,
): PromptPackage {

  const graph   = session.graph_data ?? { nodes: [], edges: [] };
  const w3Nodes: Node[] = graph.nodes.filter((n: Node) => n.weight === 3);
  const w2Nodes: Node[] = graph.nodes.filter((n: Node) => n.weight === 2).slice(0, 8);
  const outcomes: Node[] = graph.nodes.filter((n: Node) => n.type === 'outcome' && n.weight >= 2);
  const careerSummary = buildCareerSummary(session);

  const voiceGuidance = voiceProfile && voiceProfile.confidence >= 0.4
    ? `Voice profile: ${voiceProfile.voice_note}
Best day standard: ${voiceProfile.best_day_note}`
    : 'Write in a direct, specific, first-person style.';

  const stageGuidance = {
    ic: `This is an individual contributor. The article should celebrate craft,
specific technical insight, and non-obvious perspectives from deep practice.
Lead with a specific thing they built or discovered — not a general claim.`,
    leader: `This is a manager or director. The article should surface what they
learned about building teams, enabling others, or creating systems that compound.
The reader is someone building an org — give them something actionable they can't
get from generic management content.`,
    executive: `This is an executive or founder. The article should express a point
of view — a judgment about where an industry is going, a bet that turned out right,
or something most people in this domain are getting wrong.
Tone: peer-to-peer. Not self-promotional.`,
  }[stageProfile.stage];

  const system = `You are a ghostwriter helping a professional turn their thinking
into a LinkedIn or Substack article that earns genuine attention.

The article must:
- Lead with a specific, non-obvious claim or observation — not a generic hook
- Be grounded in this person's actual experience — not generic advice
- Sound like the person wrote it on their best day
- Have a clear POV the reader can agree or disagree with
- End with something actionable or memorable — not a call to follow

${stageGuidance}

${voiceGuidance}

BANNED WORDS/PHRASES (never use): passionate, leveraging, synergy, results-driven,
game-changer, thought leader, innovative, at the end of the day, in today's fast-paced,
circle back, move the needle, dive deep`;

  const user_context = [
    `Career context: ${careerSummary}`,
    w3Nodes.length
      ? `Defining experiences:\n${w3Nodes.map(n => `- ${n.label}: ${n.detail}`).join('\n')}`
      : '',
    w2Nodes.length
      ? `Supporting experiences:\n${w2Nodes.map(n => `- ${n.label}: ${n.detail || ''}`).join('\n')}`
      : '',
    outcomes.length
      ? `Key outcomes: ${outcomes.map(n => n.label).join(', ')}`
      : '',
  ].filter(Boolean).join('\n\n');

  const task_prompt = `User's thoughts / angle they want to explore:
"${userThoughts}"

Write the article now. Structure:
Line 1: Title (specific, opinionated, under 12 words)
Line 2: blank
Body: 400–600 words. No generic intros. Start with the claim.
Use short paragraphs. No headers unless essential.

Return ONLY the article — title on line 1, then body. No explanation.`;

  return {
    system,
    user_context,
    task_prompt,
    estimated_tokens: 1200,
    cache_key: `article_draft_${session.id}_${Date.now()}`,
    metadata: {
      nodes_selected: w3Nodes.length + w2Nodes.length,
      node_ids_selected: [...w3Nodes, ...w2Nodes].map((n: Node) => n.id),
      truncated: false,
      summary_version: session.summary_version ?? 0,
    },
  };
}
