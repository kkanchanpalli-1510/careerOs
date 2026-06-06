import { Router, Request, Response } from 'express';
import { requireAuth, uid } from '../middleware/auth';
import { supabaseAdmin } from '../db/client';
import { markOutputCopied } from '../lib/voiceProfile';
import { processFeedbackSignal } from '../assembler/tasks/voiceExtraction';

// Map copy event names to output types for copy-protection tracking
const COPY_EVENT_OUTPUT_MAP: Record<string, string> = {
  copy_linkedin_summary: 'linkedin_summary',
  copy_short_bio:        'short_bio',
  copy_insight:          'insight',
  copy_portrait:         'portrait',
};

const router = Router();
router.use(requireAuth);

// ─── POST /events/copy — fire-and-forget copy tracking ────────
// Always returns 200. Never throws to the client.
// Insert is best-effort — analytics, not critical path.

router.post('/copy', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, event_name, metadata } = req.body;

  if (!event_name) {
    res.json({ ok: true }); return; // silent no-op on missing event name
  }

  try {
    await supabaseAdmin.from('copy_events').insert({
      user_id:    userId,
      session_id: session_id ?? null,
      event_name,
      metadata:   metadata ?? null,
    });
  } catch {
    // Silently swallow — never block the client on analytics writes
  }

  // Activate copy-protection for this output type — fire-and-forget
  const outputType = COPY_EVENT_OUTPUT_MAP[event_name];
  if (outputType && session_id) {
    markOutputCopied(userId, session_id, outputType).catch(() => {});
  }

  res.json({ ok: true });
});

// ─── POST /events/feedback — voice feedback signal ────────────
// Logs explicit "too formal / not like me" signals and updates voice profile.
// Always returns 200. Never throws to client.

router.post('/feedback', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, output_type, signal } = req.body;

  if (!output_type || !signal) { res.json({ ok: true }); return; }

  // Fire-and-forget voice update — never await
  processFeedbackSignal(userId, output_type, signal as Parameters<typeof processFeedbackSignal>[2]).catch(() => {});

  try {
    await supabaseAdmin.from('copy_events').insert({
      user_id:    userId,
      session_id: session_id ?? null,
      event_name: `feedback_${signal}`,
      metadata:   { output_type, signal },
    });
  } catch { /* silent */ }

  res.json({ ok: true });
});

export default router;
