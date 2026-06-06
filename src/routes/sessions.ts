import { Router, Request, Response } from 'express';
import { requireAuth, uid } from '../middleware/auth';
import { supabaseAdmin } from '../db/client';
import { CareerGraph } from '../assembler/types';
import { detectStageProfile, buildDeterministicSkeleton } from '../assembler/summary';
import { STAGE_QUESTIONS } from '../assembler/tasks/gapEnrichment';
import { validateSessionOwnership, updateSession } from '../db/sessions';
import { observeNodeEdit } from '../assembler/tasks/voiceExtraction';

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

// ─── PATCH /sessions/:id/graph — update a single node's editable fields ──────
// Accepts the full updated graph_data. Only label, detail, and year are
// user-editable — all other node fields (type, weight, edges) are immutable
// from this endpoint to prevent clients from corrupting graph structure.

router.patch('/:id/graph', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = req.params.id as string;
  const { node_id, label, detail, year } = req.body;

  if (!node_id) {
    res.status(400).json({ error: 'node_id required' }); return;
  }

  const session = await validateSessionOwnership(id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  const graph: CareerGraph = session.graph_data;
  if (!graph) { res.status(409).json({ error: 'No graph on this session' }); return; }

  const node = graph.nodes.find(n => n.id === node_id);
  if (!node) { res.status(404).json({ error: 'Node not found' }); return; }

  const originalLabel = node.label;

  // Apply only whitelisted editable fields
  if (label !== undefined) node.label  = String(label).trim()  || node.label;
  if (detail !== undefined) node.detail = String(detail).trim() || node.detail;
  if (year   !== undefined) node.year   = String(year).trim()   || node.year;

  // Rebuild deterministic skeleton since node content changed
  const stageProfile = detectStageProfile(graph);
  const skeleton = buildDeterministicSkeleton(graph, session.insights, session.selected_branch, stageProfile);

  await updateSession(id, userId, {
    graph_data:      graph,
    career_summary:  skeleton,
    summary_version: (session.summary_version ?? 0) + 1,
  });

  // Fire-and-forget voice observation when label changes
  if (label !== undefined && label !== originalLabel) {
    observeNodeEdit(userId, originalLabel, node.label).catch(() => {});
  }

  res.json({ node, summary_version: (session.summary_version ?? 0) + 1 });
});

// ─── PATCH /sessions/:id/positions — persist graph layout ────────────────────

router.patch('/:id/positions', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = req.params.id as string;
  const { positions } = req.body;

  if (!positions || typeof positions !== 'object') {
    res.status(400).json({ error: 'positions object required' }); return;
  }

  const session = await validateSessionOwnership(id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  await updateSession(id, userId, { node_positions: positions });

  res.json({ ok: true });
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
