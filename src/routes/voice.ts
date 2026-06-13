// src/routes/voice.ts

import { Router } from 'express';

const router = Router();

router.post('/voice/edit-signal', requireAuth, async (req, res) => {
  res.json({ ok: true }); // always 200, process async

  const { session_id, output_type, original, final, similarity } = req.body;
  const userId = req.user.id;

  try {
    await updateVoiceFromAnswer(userId, final, 'output_edit');

    await db.query(`
      INSERT INTO copy_events
        (user_id, session_id, event_name, metadata)
      VALUES ($1, $2, 'output_edited', $3)
    `, [userId, session_id, JSON.stringify({
      output_type,
      similarity,
      edit_direction: final.length < original.length ? 'shorter' : 'longer'
    })]);
  } catch (e) {
    // Silent — already responded
  }
});

export default router;

declare function requireAuth(req: any, res: any, next: any): void;
declare function updateVoiceFromAnswer(userId: string, text: string, source: string): Promise<void>;
declare const db: { query: (sql: string, params: any[]) => Promise<any> };
