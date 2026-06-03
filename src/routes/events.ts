import { Router, Request, Response } from 'express';
import { requireAuth, uid } from '../middleware/auth';
import { supabaseAdmin } from '../db/client';

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

  res.json({ ok: true });
});

export default router;
