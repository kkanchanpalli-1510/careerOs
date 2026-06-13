// src/assembler/tasks/articleDraft.ts

import type { CareerSession, Node } from '../../lib/nodeEnrichment';
import type { StageProfile, PromptPackage } from './nodeEnrichment';

interface VoiceProfile {
  confidence: number;
  voice_note: string;
  best_day_note: string;
}

export function buildArticleDraftPrompt(
  session: CareerSession,
  userThoughts: string,
  stageProfile: StageProfile,
  voiceProfile?: VoiceProfile
): PromptPackage {

  const w3Nodes = session.graph_data?.nodes
    .filter((n: Node) => n.weight === 3)
    .map((n: Node) => `${n.label}: ${n.detail}`);

  const w2Nodes = session.graph_data?.nodes
    .filter((n: Node) => n.weight === 2)
    .slice(0, 8)
    .map((n: Node) => `${n.label}: ${n.detail || 'no detail'}`);

  const outcomes = session.graph_data?.nodes
    .filter((n: Node) => n.type === 'outcome' && n.weight >= 2)
    .map((n: Node) => n.label);

  const voiceContext = voiceProfile?.confidence >= 0.4
    ? `Voice profile: ${voiceProfile.voice_note}\nBest day standard: ${voiceProfile.best_day_note}`
    : 'Voice profile not yet established — write in a direct, specific, first-person style.';

  const stageInstruction = {
    ic: `Tone: specific, craft-forward, energetic. First person.
         Lead with what you built or saw, not your title.
         Use short declarative sentences.`,
    leader: `Tone: measured, impact-focused. First person.
             Lead with outcomes and what you enabled in others.
             The team or system is the hero, not just you personally.`,
    executive: `Tone: deliberate, peer-to-peer. First person.
                Lead with a point of view or the type of problem
                you're built for. Not breathless — considered.`
  }[stageProfile.stage];

  const system = `You are ghostwriting a LinkedIn or Substack article
for a professional. The article must:
- Sound exactly like this person — not like AI wrote it
- Be grounded in their actual career experience (use graph nodes as evidence)
- Have a clear, non-obvious point of view
- Open with something that makes the right person stop scrolling
- Be 600–900 words

${stageInstruction}

BANNED in this article:
- "I'm passionate about"
- "In today's fast-paced world"
- "Leveraged" — use "used" or describe what was done
- "Thought leader" or "thought leadership"
- "Game-changer" or "paradigm shift"
- Any form of "I'm excited to share"
- Rhetorical questions as section headers`;

  const user_context = `${voiceContext}

Career graph — defining experiences:
${w3Nodes?.join('\n')}

Supporting experiences:
${w2Nodes?.join('\n')}

Key outcomes: ${outcomes?.join(', ')}

Career summary: ${(session as any).career_summary || ''}`;

  const task_prompt = `Write a LinkedIn/Substack article based on these thoughts:

"${userThoughts}"

Requirements:
1. Open with a specific, concrete hook — something that happened,
   not a general observation. Pull from the graph if relevant.
2. Develop the core argument with 2-3 specific examples or evidence
   from the career graph. Name the nodes, outcomes, or decisions.
3. Write a conclusion that connects back to the opening and ends
   with something worth thinking about — not a call to action.
4. 600–900 words. No section headers. Flowing prose.

Return the article title on the first line, then a blank line,
then the article body. Nothing else.`;

  return {
    system,
    user_context,
    task_prompt,
    estimated_tokens: 1200,
    cache_key: `article_draft_${session.id}_${Date.now()}`,
    metadata: {
      nodes_selected: (w3Nodes?.length || 0) + (w2Nodes?.length || 0),
      node_ids_selected: [],
      truncated: false,
      summary_version: (session as any).summary_version || 0
    }
  };
}
