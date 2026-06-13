import { Router, Request, Response } from 'express';
import { requireAuth, uid } from '../middleware/auth';
import { validateSessionOwnership } from '../db/sessions';
import { observeNodeEdit } from '../assembler/tasks/voiceExtraction';

const router = Router();
router.use(requireAuth);

// ─── POST /voice/edit-signal ──────────────────────────────────
// Records a light-weight edit signal for voice calibration.
// Payload: { session_id, tab_type, original_text, edited_text, accepted }

router.post('/edit-signal', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, tab_type, original_text, edited_text, accepted } = req.body;

  if (!session_id || !original_text || !edited_text) {
    res.status(400).json({ error: 'session_id, original_text, edited_text required' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    // The edit IS the feedback (doc 12b): the original→edited diff is the
    // voice signal. observeNodeEdit infers the vocabulary preference and
    // appends it to the voice profile. Fire-and-forget — never block the UI.
    void observeNodeEdit(userId, original_text, edited_text).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'edit_signal failed' });
  }
});

export default router;
