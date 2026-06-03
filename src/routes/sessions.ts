import { Router, Request, Response } from 'express';
import { requireAuth, uid } from '../middleware/auth';
import { supabaseAdmin } from '../db/client';
import { CareerGraph } from '../assembler/types';
import { detectStageProfile } from '../assembler/summary';
import { STAGE_QUESTIONS } from '../assembler/tasks/gapEnrichment';

const router = Router();
router.use(requireAuth);

// ─── POST /sessions — create new session ─────────────────────

router.post('/', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { name } = req.body;

  const { data, error } = await supabaseAdmin
    .from('career_sessions')
    .insert({ user_id: userId, name: name || 'My Career' })
    .select('id, name, step, created_at')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ─── GET /sessions — list user sessions ──────────────────────

router.get('/', async (req: Request, res: Response) => {
  const userId = uid(req);

  const { data, error } = await supabaseAdmin
    .from('career_sessions')
    .select('id, name, step, created_at, updated_at, graph_data, insights, answers, selected_branch, career_summary, enrich_count')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

// ─── GET /sessions/:id/questions — stage-calibrated questions ──

router.get('/:id/questions', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = req.params.id as string;

  const { data, error } = await supabaseAdmin
    .from('career_sessions')
    .select('graph_data')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !data) { res.status(404).json({ error: 'Session not found' }); return; }

  const graph: CareerGraph = (data.graph_data as CareerGraph | null) ?? { nodes: [], edges: [] };
  const { stage, isTransitioning, transitionDirection, titleCapabilityGap } = detectStageProfile(graph);

  res.json({
    stage,
    isTransitioning,
    transitionDirection,
    titleCapabilityGap,
    questions: STAGE_QUESTIONS[stage],
  });
});

// ─── DELETE /sessions/:id — delete a session ─────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { id } = req.params;

  const { error } = await supabaseAdmin
    .from('career_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ deleted: true });
});

export default router;
