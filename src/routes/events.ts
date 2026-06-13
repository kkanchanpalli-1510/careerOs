// src/routes/events.ts

import { Router } from 'express';

const router = Router();

router.post('/events/feedback', requireAuth, async (req, res) => {
  res.json({ ok: true }); // always 200, process async

  const userId = req.user.id;
  const { session_id, output_type, signal, text } = req.body;

  try {
    await db.query(`
      INSERT INTO copy_events
        (user_id, session_id, event_name, metadata)
      VALUES ($1, $2, 'output_feedback', $3)
    `, [userId, session_id, JSON.stringify({ output_type, signal })]);

    await processFeedbackSignal(userId, output_type, signal);

    if (text && text.length > 10) {
      await updateVoiceFromAnswer(userId, text, 'feedback_missing');
    }
  } catch (e) {
    // Silent
  }
});

export default router;

declare function requireAuth(req: any, res: any, next: any): void;
declare function processFeedbackSignal(userId: string, outputType: string, signal: string): Promise<void>;
declare function updateVoiceFromAnswer(userId: string, text: string, source: string): Promise<void>;
declare const db: { query: (sql: string, params: any[]) => Promise<any> };
