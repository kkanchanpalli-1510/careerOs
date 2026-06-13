import { Router, Request, Response } from 'express';
import { requireAuth, uid } from '../middleware/auth';
import { supabaseAdmin } from '../db/client';
import { CareerGraph, Node } from '../assembler/types';
import { detectStageProfile, buildDeterministicSkeleton } from '../assembler/summary';
import { STAGE_QUESTIONS } from '../assembler/tasks/gapEnrichment';
import { validateSessionOwnership, updateSession } from '../db/sessions';
import { observeNodeEdit } from '../assembler/tasks/voiceExtraction';
import {
  selectNextNudge, buildNudgeReason, getConnectedNodes, scoreNodeForEnrichment,
} from '../lib/nodeEnrichment';
import { buildNodeEnrichmentPrompt } from '../assembler/tasks/nodeEnrichmentPrompt';
import { anthropic, MODEL } from '../lib/anthropic';
import { logUsage } from '../db/usage';

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

// ─── POST /sessions/:id/refinements — accept or dismiss a pending refinement ─
// action='accept': swaps pending text → active, clears pending entry
// action='dismiss': clears pending entry, keeps active text unchanged

router.post('/:id/refinements', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id = req.params.id as string;
  const { output_type, action } = req.body;

  if (!output_type || !['accept', 'dismiss'].includes(action)) {
    res.status(400).json({ error: 'output_type and action (accept|dismiss) required' }); return;
  }

  const session = await validateSessionOwnership(id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  const insights: Record<string, unknown> = session.insights ?? {};
  const pending = (insights.pending_refinements ?? {}) as Record<string, { text: string; previous: string; refined_at: string }>;
  const refinement = pending[output_type];

  if (!refinement) {
    res.json({ ok: true, changed: false }); return;
  }

  const updatedInsights = { ...insights };

  if (action === 'accept') {
    // Promote refined text → active output
    updatedInsights[output_type] = refinement.text;
    if (output_type === 'linkedin_summary') {
      updatedInsights.linkedin_summary_generated_at = refinement.refined_at;
    } else if (output_type === 'short_bio') {
      updatedInsights.short_bio_generated_at = refinement.refined_at;
    }
  }

  // Clear the pending entry regardless of accept/dismiss
  const newPending = { ...pending };
  delete newPending[output_type];
  updatedInsights.pending_refinements = Object.keys(newPending).length ? newPending : null;

  await updateSession(id, userId, { insights: updatedInsights });

  res.json({
    ok: true,
    changed: action === 'accept',
    ...(action === 'accept' ? { text: refinement.text } : {}),
  });
});

// ─── GET /:id/next-nudge — next sparse node to enrich ────────

router.get('/:id/next-nudge', async (req: Request, res: Response) => {
  const userId = uid(req);
  const session = await validateSessionOwnership(req.params.id as string, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  // No nudges until first insight is generated
  if (!session.insights?.strength) { res.json({ nudge: null }); return; }

  const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };
  const enrichedNodeIds: string[] = session.enriched_node_ids ?? [];
  const nextNode = selectNextNudge(graph, enrichedNodeIds);
  if (!nextNode) { res.json({ nudge: null }); return; }

  const connectedNodes = getConnectedNodes(nextNode.id, graph);
  const reason = buildNudgeReason(nextNode, graph, session, connectedNodes);

  res.json({
    nudge: {
      node:     nextNode,
      reason,
      question: null,
      score:    scoreNodeForEnrichment(nextNode, graph.edges, enrichedNodeIds),
    },
  });
});

// ─── POST /:id/nudge-question — generate Claude enrichment question ──

router.post('/:id/nudge-question', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { node_id } = req.body;
  if (!node_id) { res.status(400).json({ error: 'node_id required' }); return; }

  const sessionId = req.params.id as string;
  const session = await validateSessionOwnership(sessionId, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };
  const node = graph.nodes.find(n => n.id === node_id);
  if (!node) { res.status(404).json({ error: 'Node not found' }); return; }

  const connectedNodes = getConnectedNodes(node_id, graph);
  const reason = buildNudgeReason(node, graph, session, connectedNodes);
  const stageProfile = detectStageProfile(graph);
  const pkg = buildNodeEnrichmentPrompt(node, connectedNodes, reason, stageProfile);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 150,
    system: pkg.system,
    messages: [{ role: 'user', content: `${pkg.user_context}\n\n${pkg.task_prompt}`.trim() }],
  });

  await logUsage({
    userId, sessionId, taskType: 'node_enrichment_question',
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens,
  });

  const question = (response.content[0] as { type: string; text: string }).text.trim();
  res.json({ question, node_id });
});

// ─── POST /:id/enrich-node — save enrichment answer to graph ─

router.post('/:id/enrich-node', async (req: Request, res: Response) => {
  const userId = uid(req);
  const sessionId = req.params.id as string;
  const { node_id, detail, year } = req.body;
  if (!node_id || !detail?.trim()) {
    res.status(400).json({ error: 'node_id and detail required' }); return;
  }

  const session = await validateSessionOwnership(sessionId, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  const graph: CareerGraph = { ...session.graph_data, nodes: [...(session.graph_data?.nodes ?? [])] };
  const nodeIdx = graph.nodes.findIndex(n => n.id === node_id);
  if (nodeIdx === -1) { res.status(404).json({ error: 'Node not found' }); return; }

  graph.nodes[nodeIdx] = {
    ...graph.nodes[nodeIdx],
    detail: detail.trim(),
    year:   year?.trim() || graph.nodes[nodeIdx].year,
  };

  const enrichedNodeIds = [...(session.enriched_node_ids ?? []), node_id];

  const stageProfile = detectStageProfile(graph);
  const skeleton = buildDeterministicSkeleton(graph, session.insights, session.selected_branch, stageProfile);

  await updateSession(sessionId, userId, {
    graph_data:        graph,
    enriched_node_ids: enrichedNodeIds,
    career_summary:    skeleton,
    summary_version:   (session.summary_version ?? 0) + 1,
  });

  // Fire-and-forget voice signal from the enrichment answer
  const { updateVoiceFromAnswer } = await import('../assembler/tasks/voiceExtraction');
  updateVoiceFromAnswer(userId, detail.trim(), 'enrichment').catch(() => {});

  res.json({
    updated_node: graph.nodes[nodeIdx],
    triggered_refinements: ['linkedin_summary', 'short_bio'],
  });
});

// ─── PATCH /:id/outputs/:outputType — save user-edited output ─

router.patch('/:id/outputs/:outputType', async (req: Request, res: Response) => {
  const userId = uid(req);
  const id         = req.params.id as string;
  const outputType = req.params.outputType as string;
  const { text } = req.body;

  const ALLOWED = ['linkedin_summary', 'short_bio', 'linkedin_headline'];
  if (!ALLOWED.includes(outputType)) {
    res.status(400).json({ error: 'Invalid outputType' }); return;
  }
  if (typeof text !== 'string') {
    res.status(400).json({ error: 'text required' }); return;
  }

  const session = await validateSessionOwnership(id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  const insights = {
    ...(session.insights ?? {}),
    [outputType]:                    text,
    [`${outputType}_user_edited`]:   true,
  };

  await updateSession(id, userId, { insights });
  res.json({ ok: true });
});

// ─── DELETE /:id/goal — clear goal + ghost nodes ──────────────

router.delete('/:id/goal', async (req: Request, res: Response) => {
  const userId = uid(req);
  const sessionId = req.params.id as string;
  const session = await validateSessionOwnership(sessionId, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };
  const cleanedGraph: CareerGraph = {
    nodes: graph.nodes.filter(n => !(n as any).ghost),
    edges: (graph.edges as any[]).filter((e: any) => !e.ghost) as typeof graph.edges,
  };

  await updateSession(sessionId, userId, {
    goal_title:               null,
    goal_graph_generated_at:  null,
    graph_data:               cleanedGraph,
    summary_version:          (session.summary_version ?? 0) + 1,
  });

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
