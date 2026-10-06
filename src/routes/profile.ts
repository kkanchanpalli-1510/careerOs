// How the user wants to be addressed in anything written about them.
//
// These are profile fields rather than career_signals on purpose: a pronoun is
// stated fact, not an inferred belief. It must not decay, does not need
// corroboration, and is never inferred — only ever taken from what the user
// typed.

import { Router, Request, Response } from 'express';
import { requireAuth, uid } from '../middleware/auth';
import { supabaseAdmin } from '../db/client';

const router = Router();
router.use(requireAuth);

const MAX_NAME = 80;
const MAX_PRONOUNS = 40;

// ─── GET /profile ─────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const userId = uid(req);

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('email, name, preferred_name, pronouns, identity_prompted_at')
    .eq('id', userId)
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  res.json({
    email:          data.email,
    preferred_name: data.preferred_name ?? null,
    pronouns:       data.pronouns ?? null,
    // Whether we've already asked. Drives "ask once, respect a skip".
    asked:          !!data.identity_prompted_at,
  });
});

// ─── PATCH /profile ───────────────────────────────────────────
// Empty string clears a field back to null — "prefer not to say" is a valid
// answer and must be storable, not just skippable.

router.patch('/', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { preferred_name, pronouns } = req.body;

  const patch: Record<string, unknown> = {};

  if (preferred_name !== undefined) {
    const v = String(preferred_name).trim();
    if (v.length > MAX_NAME) {
      res.status(400).json({ error: `preferred_name must be ${MAX_NAME} characters or fewer` }); return;
    }
    patch.preferred_name = v || null;
  }

  if (pronouns !== undefined) {
    const v = String(pronouns).trim();
    if (v.length > MAX_PRONOUNS) {
      res.status(400).json({ error: `pronouns must be ${MAX_PRONOUNS} characters or fewer` }); return;
    }
    patch.pronouns = v || null;
  }

  if (!Object.keys(patch).length) {
    res.status(400).json({ error: 'preferred_name or pronouns required' }); return;
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select('preferred_name, pronouns')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ preferred_name: data.preferred_name, pronouns: data.pronouns });
});

// ─── POST /profile/asked ──────────────────────────────────────
// Marks that we've offered the question, so a user who skips is not asked
// again every time they generate a bio. Separate from PATCH because skipping
// sets no values but must still be remembered.

router.post('/asked', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { error } = await supabaseAdmin
    .from('users')
    .update({ identity_prompted_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

export default router;
