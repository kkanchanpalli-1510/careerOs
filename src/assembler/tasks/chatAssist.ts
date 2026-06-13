// Chat assist — inline editor for bio, LinkedIn summary, and article drafts.
// Returns a system prompt + context block, NOT a PromptPackage —
// because chat-assist is a multi-turn conversation, not a single-shot task.

import { VoiceProfile } from '../../lib/voiceProfile';

export type ChatAssistTabType = 'bio' | 'summary' | 'article';

export interface ChatAssistContext {
  system: string;
  contextBlock: string;
}

const BASE_SYSTEM = `You are a trusted editor helping a professional refine their
career writing. You have their career graph, voice profile, and the current draft.

Your role:
- Suggest specific, concrete improvements
- Preserve what sounds like them — change what undersells them
- Never be generic. Every suggestion must be grounded in their actual experience.
- When suggesting a revised version, output it in this exact format:

---REVISED---
[the full revised text here]
---END---

Then add one sentence explaining the key change you made.

If you are answering a question or asking a clarifying question, do NOT include a
REVISED block.

BANNED WORDS (never use): passionate, seasoned, proven, dynamic, results-driven,
thought leader, self-starter, leveraging, synergy`;

const TAB_ADDENDUM: Record<ChatAssistTabType, string> = {
  bio: `You are editing a Short Bio (100–150 words, third person).
Use for: speaker bios, about pages, team profiles, email signatures.
Limit: 150 words maximum. Do not exceed this in any revision.`,

  summary: `You are editing a LinkedIn Summary.
Limit: 2,400 characters. Do not exceed this in any revision.
Three-paragraph structure: hook → evidence → forward direction.`,

  article: `You are editing a LinkedIn or Substack article.
Voice: direct, specific, first-person. No generic management language.
Keep the strong parts — only suggest changes that make it more specific
or more like them. Never add fluff.`,
};

export function buildChatAssistContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any,
  tabType: ChatAssistTabType,
  currentText: string,
  voiceProfile: VoiceProfile | null,
): ChatAssistContext {

  const voiceGuidance = voiceProfile && voiceProfile.confidence >= 0.4
    ? `Voice profile: ${voiceProfile.voice_note}\nBest day standard: ${voiceProfile.best_day_note}`
    : 'Write in a direct, specific, first-person style.';

  const system = `${BASE_SYSTEM}\n\n${voiceGuidance}\n\n${TAB_ADDENDUM[tabType]}`;

  const portrait  = session.insights?.portrait;
  const strength  = session.insights?.strength;
  const branches  = session.insights?.branches;
  const chosen    = branches?.[session.selected_branch ?? 0];

  const contextBlock = [
    portrait?.identity   ? `Identity: ${portrait.identity}`                          : '',
    strength?.insight    ? `Core strength: ${strength.insight}`                      : '',
    chosen?.title        ? `Chosen direction: ${chosen.title}`                       : '',
    `Current ${tabType} draft:\n${currentText}`,
  ].filter(Boolean).join('\n\n');

  return { system, contextBlock };
}

/** Injects the context block as the first user turn so it's always present. */
export function injectContext(
  messages: Array<{ role: string; content: string }>,
  contextBlock: string,
): Array<{ role: string; content: string }> {
  // If no messages yet, prime with the context block
  if (!messages.length) {
    return [{ role: 'user', content: contextBlock }];
  }
  // Prepend context to the first user message if it isn't already there
  const first = messages[0];
  if (first.role === 'user' && !first.content.startsWith('Identity:') &&
      !first.content.startsWith('Core strength:') &&
      !first.content.startsWith('Current ')) {
    return [
      { role: 'user', content: `${contextBlock}\n\n${first.content}` },
      ...messages.slice(1),
    ];
  }
  return messages;
}
