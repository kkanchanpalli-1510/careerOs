// src/assembler/tasks/chatAssist.ts

import type { CareerSession, Node } from '../../lib/nodeEnrichment';

interface VoiceProfile {
  confidence: number;
  voice_note: string;
  best_day_note: string;
}

export function buildChatAssistPrompt(
  session: CareerSession,
  tabType: 'bio' | 'summary' | 'article',
  currentText: string,
  voiceProfile: VoiceProfile | null,
  articleId?: string
): { system: string; contextBlock: string } {

  const voiceContext = voiceProfile && voiceProfile.confidence >= 0.4
    ? `Voice profile: ${voiceProfile.voice_note}\nBest day standard: ${voiceProfile.best_day_note}`
    : 'Write in a direct, specific, first-person style.';

  const SYSTEM_BASE = `You are a trusted editor helping a professional
refine their career writing. You have their career graph, voice profile,
and the current draft.

Your role:
- Suggest specific, concrete improvements
- Preserve what sounds like them — change what undersells them
- Never be generic. Every suggestion should be grounded in their actual experience.
- When suggesting a revised version, output it in this exact format:

---REVISED---
[the full revised text here]
---END---

Then add one sentence explaining the key change you made.

If you are answering a question or asking a clarifying question,
do NOT include a REVISED block.

${voiceContext}

BANNED WORDS (never use): passionate, seasoned, proven, dynamic,
results-driven, thought leader, self-starter, leveraging, synergy`;

  const tabSystems: Record<string, string> = {
    bio: `${SYSTEM_BASE}

You are editing a Short Bio (100–150 words, third person).
Use for: speaker bios, about pages, team profiles, email signatures.
Limit: 150 words maximum. Do not exceed this in any revision.`,

    summary: `${SYSTEM_BASE}

You are editing a LinkedIn Summary.
Limit: 2,400 characters. Do not exceed this in any revision.
Three-paragraph structure: hook → evidence → forward direction.`,

    article: `${SYSTEM_BASE}

You are editing a LinkedIn or Substack article (600–900 words).
No section headers. Flowing prose. Opens with something concrete, not a general claim.`
  };

  const topNodes = session.graph_data?.nodes
    ?.filter((n: Node) => n.weight >= 2)
    ?.slice(0, 6)
    ?.map((n: Node) => `${n.label}: ${n.detail || ''}`)
    ?.join('\n') || '';

  const contextBlock = `Current draft:
"""
${currentText}
"""

Career context:
${(session as any).career_summary || ''}

Key experiences:
${topNodes}

Career stage: ${detectStageProfile(session.graph_data).stage}`;

  return {
    system: tabSystems[tabType],
    contextBlock
  };
}

export function injectContext(
  messages: { role: string; content: string }[],
  contextBlock: string
): { role: string; content: string }[] {
  if (messages.length === 0) return messages;
  return messages.map((m, i) => {
    if (i === 0 && m.role === 'user') {
      return { ...m, content: `${contextBlock}\n\n---\n\nUser request: ${m.content}` };
    }
    return m;
  });
}

declare function detectStageProfile(graph: any): { stage: 'ic' | 'leader' | 'executive' };
