// Voice profile — all DB operations are pure CRUD, no Claude calls here.
// Claude calls live in src/assembler/tasks/voiceExtraction.ts

import { supabaseAdmin } from '../db/client';
import { anthropic, MODEL } from './anthropic';

export interface VoiceProfile {
  id: string;
  user_id: string;
  character: Record<string, unknown>;
  habits: Record<string, unknown>;
  gap: Record<string, unknown>;
  voice_note: string | null;
  best_day_note: string | null;
  voice_note_version: number;
  task_adjustments: Record<string, string>;
  sample_count: number;
  total_words_observed: number;
  confidence: number;
  vocabulary_preferred: string[];
  vocabulary_rejected: string[];
  feedback_log: unknown[];
  copied_outputs: Record<string, { copied_at: string; version: number }>;
}

export interface ResumeVoiceResult {
  ownership_style: 'direct' | 'deflects' | 'passive' | 'mixed';
  sentence_structure: 'fragments' | 'narrative' | 'mixed';
  leads_with: 'scope' | 'output' | 'impact' | 'mixed';
  adjective_density: 'high' | 'medium' | 'low';
  pronoun_usage: 'first_person' | 'avoids_i' | 'mixed';
  signature_constructions: string[];
  voice_note: string;
  confidence: number;
}

export async function getVoiceProfile(userId: string): Promise<VoiceProfile | null> {
  const { data } = await supabaseAdmin
    .from('voice_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
  return data as VoiceProfile | null;
}

export async function initVoiceProfile(
  userId: string,
  resumeVoice: ResumeVoiceResult
): Promise<void> {
  const character = {
    sentence_structure: resumeVoice.sentence_structure,
    leads_with: resumeVoice.leads_with,
    pronoun_usage: resumeVoice.pronoun_usage,
    signature_constructions: resumeVoice.signature_constructions,
  };
  const habits = {
    ownership_pattern: resumeVoice.ownership_style,
    adjective_density: resumeVoice.adjective_density,
    hedging_tendency: 'unknown',
    observed_habits: [],
  };

  await supabaseAdmin.from('voice_profiles').upsert({
    user_id: userId,
    character,
    habits,
    confidence: resumeVoice.confidence,
    sample_count: 1,
    total_words_observed: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

export async function mergeVoiceProfile(
  userId: string,
  refinements: Record<string, unknown>
): Promise<void> {
  const existing = await getVoiceProfile(userId);
  if (!existing) return;

  const newCharacter = { ...existing.character };
  const newHabits    = { ...existing.habits };

  if (refinements.ownership_style)
    newHabits.ownership_pattern = refinements.ownership_style;
  if (refinements.sentence_structure)
    newCharacter.sentence_structure = refinements.sentence_structure;
  if (refinements.habit_observed) {
    const observed = (newHabits.observed_habits as string[]) ?? [];
    observed.push(refinements.habit_observed as string);
    newHabits.observed_habits = observed;
  }
  if (Array.isArray(refinements.new_signature_constructions) && refinements.new_signature_constructions.length) {
    const existing_sigs = (newCharacter.signature_constructions as string[]) ?? [];
    newCharacter.signature_constructions = [
      ...existing_sigs,
      ...(refinements.new_signature_constructions as string[]),
    ].slice(0, 6);
  }

  const confidenceDelta = 0.05;

  await supabaseAdmin.from('voice_profiles').update({
    character: newCharacter,
    habits: newHabits,
    sample_count: existing.sample_count + 1,
    confidence: Math.min(1.0, existing.confidence + confidenceDelta),
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);

  await checkRebuildThreshold(userId);
}

export async function appendVoiceObservation(
  userId: string,
  observation: { type: string; rejected: string; preferred: string; signal: string }
): Promise<void> {
  const existing = await getVoiceProfile(userId);
  if (!existing) return;

  const preferred = [...(existing.vocabulary_preferred ?? []), observation.preferred].slice(-20);
  const rejected  = [...(existing.vocabulary_rejected  ?? []), observation.rejected ].slice(-20);

  await supabaseAdmin.from('voice_profiles').update({
    vocabulary_preferred: preferred,
    vocabulary_rejected: rejected,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);
}

export async function appendTaskAdjustment(
  userId: string,
  taskType: string,
  adjustment: string
): Promise<void> {
  const existing = await getVoiceProfile(userId);
  if (!existing) return;

  const adjustments = { ...existing.task_adjustments, [taskType]: adjustment };

  await supabaseAdmin.from('voice_profiles').update({
    task_adjustments: adjustments,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);
}

export async function incrementWordCount(userId: string, words: number): Promise<void> {
  const existing = await getVoiceProfile(userId);
  if (!existing) return;

  await supabaseAdmin.from('voice_profiles').update({
    total_words_observed: existing.total_words_observed + words,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);
}

export async function checkRebuildThreshold(userId: string): Promise<void> {
  const profile = await getVoiceProfile(userId);
  if (!profile) return;

  const prevVersion = profile.voice_note_version;
  const shouldRebuild =
    (profile.confidence >= 0.4 && prevVersion === 0) ||
    (profile.confidence >= 0.7 && prevVersion < 2)   ||
    (profile.sample_count > 0 && profile.sample_count % 10 === 0);

  if (shouldRebuild) {
    // Fire-and-forget — never awaited by the caller
    triggerVoiceNoteRebuild(userId, 'threshold_crossed').catch(() => {});
  }
}

export async function triggerVoiceNoteRebuild(userId: string, _reason: string): Promise<void> {
  const profile = await getVoiceProfile(userId);
  if (!profile || profile.sample_count < 3 || profile.confidence < 0.4) return;

  const prompt = `You are writing instructions for a ghostwriter who will write professional
summaries, bios, and career narratives on behalf of this person.

Capture two things:
1. CHARACTER — what to preserve exactly as-is
2. HABITS — what to elevate to their best-day voice

Accumulated voice data:
Sample count: ${profile.sample_count}
Words observed: ${profile.total_words_observed}
Confidence: ${profile.confidence}

Character signals:
${JSON.stringify(profile.character, null, 2)}

Habits to elevate:
${JSON.stringify(profile.habits, null, 2)}

Gap detected: ${(profile.gap as Record<string,unknown>)?.detected ?? false}
${(profile.gap as Record<string,unknown>)?.gap_note ?? ''}

Vocabulary they prefer: ${(profile.vocabulary_preferred ?? []).join(', ')}
Vocabulary they avoid: ${(profile.vocabulary_rejected ?? []).join(', ')}

Task adjustments: ${JSON.stringify(profile.task_adjustments)}

Return JSON only:
{
  "voice_note": "3-4 sentences: how to write like this person — rhythm, vocabulary, ownership style",
  "best_day_note": "2-3 sentences: how they sound when most articulate and unguarded, what habits to quietly correct"
}`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (msg.content[0] as { type: string; text: string }).text.trim();
    const result = JSON.parse(text.replace(/^```json\n?|```$/g, ''));

    await supabaseAdmin.from('voice_profiles').update({
      voice_note: result.voice_note,
      best_day_note: result.best_day_note,
      voice_note_version: profile.voice_note_version + 1,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
  } catch {
    // Silent failure — voice rebuild is never on the critical path
  }
}

export async function detectAndStoreVoiceGap(
  userId: string,
  resumeVoice: ResumeVoiceResult,
  interviewOwnership: string,
  interviewAdjectives: string
): Promise<void> {
  const gaps: string[] = [];

  if (resumeVoice.ownership_style === 'passive' && interviewOwnership === 'direct')
    gaps.push('Resume uses passive construction; natural voice is direct');
  if (resumeVoice.adjective_density === 'high' && interviewAdjectives === 'low')
    gaps.push('Resume is adjective-heavy; natural voice lets work speak');
  if (resumeVoice.pronoun_usage === 'avoids_i' && interviewOwnership === 'direct')
    gaps.push('Resume avoids "I"; natural voice owns work directly');

  if (gaps.length === 0) return;

  const gap = {
    detected: true,
    resume_register: `${resumeVoice.ownership_style} ownership, ${resumeVoice.adjective_density} adjectives`,
    natural_register: `${interviewOwnership} ownership, ${interviewAdjectives} adjectives`,
    gaps,
    gap_note: 'Resume is more guarded than natural voice. Weight conversation signals over resume signals.',
    gap_surfaced: false,
    weighting: { resume: 0.1, answers: 0.65, node_chat: 0.25 },
  };

  await supabaseAdmin.from('voice_profiles').update({
    gap,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);
}

export async function markOutputCopied(
  userId: string,
  sessionId: string,
  outputType: string
): Promise<void> {
  const existing = await getVoiceProfile(userId);
  if (!existing) return;

  const key = `${sessionId}:${outputType}`;
  const copied = {
    ...existing.copied_outputs,
    [key]: { copied_at: new Date().toISOString(), version: 1 },
  };

  await supabaseAdmin.from('voice_profiles').update({
    copied_outputs: copied,
    updated_at: new Date().toISOString(),
  }).eq('user_id', userId);
}

export async function isCopyProtected(
  userId: string,
  sessionId: string,
  outputType: string
): Promise<boolean> {
  const profile = await getVoiceProfile(userId);
  if (!profile) return false;

  const key = `${sessionId}:${outputType}`;
  const entry = profile.copied_outputs?.[key];
  if (!entry) return false;

  const copiedAt = new Date(entry.copied_at).getTime();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return copiedAt > thirtyDaysAgo;
}
