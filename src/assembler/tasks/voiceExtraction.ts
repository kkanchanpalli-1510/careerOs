// Voice extraction — Claude calls that feed the voice profile.
// All functions are async and fire-and-forget from route handlers.

import { anthropic, MODEL } from '../../lib/anthropic';
import {
  getVoiceProfile,
  mergeVoiceProfile,
  appendVoiceObservation,
  appendTaskAdjustment,
  incrementWordCount,
  checkRebuildThreshold,
} from '../../lib/voiceProfile';

export function buildResumeVoicePrompt(resumeText: string): string {
  return `Analyze the writing style of this resume. Focus entirely on
HOW the person writes — not WHAT they did. Extract voice characteristics
that will help ghostwrite for this person.

Observe these signals:

OWNERSHIP STYLE
Does the person claim work directly ("I built", "I designed") or
deflect ("contributed to", "helped drive") or use passive
("was built", "were implemented")? Look for patterns.

SENTENCE STRUCTURE
Do they write in bullet fragments or full sentences?
Fragments signal someone who thinks in deliverables.
Full sentences signal someone who thinks in narrative.

WHAT THEY LEAD WITH
Under each role, does the first bullet show scope ("Led 30-person team"),
output ("Built event schema architecture"), or impact ("$100M revenue")?

ADJECTIVE DENSITY
High: "Seasoned leader with proven track record of driving results"
Low: "Built the event schema that replaced fragmented log pipelines"

PRONOUN PRESENCE
Does "I" appear directly or is it avoided entirely?

SIGNATURE CONSTRUCTIONS
One or two phrases or patterns distinctly like how this person thinks.

Resume:
${resumeText}

Return ONLY valid JSON:
{
  "ownership_style": "direct|deflects|passive|mixed",
  "sentence_structure": "fragments|narrative|mixed",
  "leads_with": "scope|output|impact|mixed",
  "adjective_density": "high|medium|low",
  "pronoun_usage": "first_person|avoids_i|mixed",
  "signature_constructions": ["up to 2 phrases distinctly theirs"],
  "voice_note": "2 sentences: how to write like this person based on resume alone",
  "confidence": 0.3
}`;
}

export async function updateVoiceFromAnswer(
  userId: string,
  text: string,
  context: 'onboarding' | 'enrichment' | 'node_chat'
): Promise<void> {
  // Minimum signal threshold — short messages add noise
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 50) return;

  const existing = await getVoiceProfile(userId);
  if (!existing) return;

  const prompt = `You are refining a voice profile based on a new writing sample.

Existing profile:
${JSON.stringify(existing.character)}

New sample (context: ${context}):
"${text}"

Identify ONLY what is new or refined — do not repeat existing observations.
Return null if this sample adds nothing new.

Return JSON or null:
{
  "refinements": {
    "ownership_style": "update only if this sample changes the picture, else omit",
    "sentence_structure": "update only if pattern shifts, else omit",
    "new_signature_constructions": ["any new phrases distinctly theirs"],
    "habit_observed": "one habit to elevate if newly detected, or null",
    "character_note": "one sentence adding to character picture, or null"
  },
  "confidence": 0.0
}`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (msg.content[0] as { type: string; text: string }).text.trim();
    if (raw === 'null') return;

    const result = JSON.parse(raw.replace(/^```json\n?|```$/g, ''));
    if (!result || result.confidence < 0.3) return;

    await mergeVoiceProfile(userId, result.refinements);
    await incrementWordCount(userId, wordCount);
    await checkRebuildThreshold(userId);
  } catch {
    // Silent failure — voice updates are never on the critical path
  }
}

export async function observeNodeEdit(
  userId: string,
  original: string,
  edited: string
): Promise<void> {
  if (original === edited) return;
  if (edited.length < 3) return;

  const signal = inferVocabularySignal(original, edited);

  await appendVoiceObservation(userId, {
    type: 'vocabulary_preference',
    rejected: original,
    preferred: edited,
    signal,
  }).catch(() => {});
}

function inferVocabularySignal(original: string, edited: string): string {
  if (edited.split(' ').length > original.split(' ').length + 2)
    return 'prefers_specificity';
  if (/^(built|drove|designed|led|created)/i.test(edited) &&
      !/^(built|drove|designed|led|created)/i.test(original))
    return 'prefers_action_verbs';
  return 'vocabulary_shift';
}

type FeedbackSignal =
  | 'too_formal' | 'too_casual' | 'too_promotional'
  | 'not_like_me' | 'accepted' | 'restored_previous';

const FEEDBACK_ADJUSTMENTS: Record<FeedbackSignal, string> = {
  too_formal:        'More conversational. Shorter sentences. Less elevated vocabulary.',
  too_casual:        'More considered. Longer sentences where appropriate.',
  too_promotional:   'Remove sales-copy patterns. Describe what exists, not what was eliminated.',
  not_like_me:       'Review character signals — something core to their voice was missed.',
  restored_previous: 'New version was worse than previous — do not change in this direction again.',
  accepted:          '',
};

export async function processFeedbackSignal(
  userId: string,
  taskType: string,
  signal: FeedbackSignal
): Promise<void> {
  const adjustment = FEEDBACK_ADJUSTMENTS[signal];
  if (!adjustment) return;

  await appendTaskAdjustment(userId, taskType, adjustment).catch(() => {});
}
