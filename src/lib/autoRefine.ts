// Auto-refine — background regeneration of outputs when voice profile improves.
// All calls are fire-and-forget. Never awaited from a request handler.
// Never silently overwrites — stores as pending_refinement for user to accept.

import { supabaseAdmin } from '../db/client';
import { anthropic, MODEL } from './anthropic';
import { assembleContext } from '../assembler';
import { isCopyProtected } from './voiceProfile';
import { logUsage } from '../db/usage';

const REFINE_TARGETS = [
  { task: 'linkedin_summary' as const, key: 'linkedin_summary', ageKey: 'linkedin_summary_generated_at', maxTokens: 600 },
  { task: 'short_bio'        as const, key: 'short_bio',        ageKey: 'short_bio_generated_at',        maxTokens: 300 },
];

const MIN_AGE_MS = 24 * 60 * 60 * 1000; // outputs younger than 24h are not refined

export async function triggerAutoRefine(userId: string, reason: string): Promise<void> {
  // Get all sessions that have a portrait (complete sessions only)
  const { data: sessions } = await supabaseAdmin
    .from('career_sessions')
    .select('id, insights')
    .eq('user_id', userId)
    .not('insights->portrait', 'is', null);

  if (!sessions?.length) return;

  for (const session of sessions) {
    await refineSession(userId, session.id, session.insights ?? {}, reason).catch(() => {});
  }
}

async function refineSession(
  userId: string,
  sessionId: string,
  insights: Record<string, unknown>,
  reason: string
): Promise<void> {
  const cutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();
  const pending: Record<string, { text: string; previous: string; refined_at: string; reason: string }> =
    (insights.pending_refinements as Record<string, unknown> ?? {}) as Record<string, { text: string; previous: string; refined_at: string; reason: string }>;

  let anyNew = false;

  for (const target of REFINE_TARGETS) {
    const existing = insights[target.key] as string | undefined;
    if (!existing) continue; // never generated — nothing to refine

    const generatedAt = insights[target.ageKey] as string | undefined;
    if (generatedAt && generatedAt > cutoff) continue; // too recent

    if (await isCopyProtected(userId, sessionId, target.key)) continue; // copy-protected

    // Generate refined version using current voice profile
    try {
      const pkg = await assembleContext({
        user_id: userId,
        task: target.task,
        params: { session_id: sessionId },
      });

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: target.maxTokens,
        system: pkg.system,
        messages: [{ role: 'user', content: `${pkg.user_context}\n\n${pkg.task_prompt}`.trim() }],
      });

      await logUsage({
        userId, sessionId, taskType: target.task,
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
      });

      const refined = (response.content[0] as { type: string; text: string }).text.trim();
      if (!refined || refined === existing) continue; // no meaningful change

      pending[target.key] = {
        text: refined,
        previous: existing,
        refined_at: new Date().toISOString(),
        reason,
      };
      anyNew = true;
    } catch {
      // Silent — auto-refine failures are never surfaced to the user
    }
  }

  if (anyNew) {
    // Store pending refinements — never overwrites active output
    await supabaseAdmin
      .from('career_sessions')
      .update({ insights: { ...insights, pending_refinements: pending } })
      .eq('id', sessionId)
      .eq('user_id', userId);
  }
}
