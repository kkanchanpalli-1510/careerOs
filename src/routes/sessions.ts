// src/routes/sessions.ts

import { Router } from 'express';
import {
  selectNextNudge,
  scoreNodeForEnrichment,
  buildNudgeReason,
  getConnectedNodes,
  type Node,
} from '../lib/nodeEnrichment';
import { buildNodeEnrichmentPrompt } from '../assembler/tasks/nodeEnrichment';

const router = Router();

const ALLOWED_OUTPUT_TYPES = [
  'linkedin_summary',
  'short_bio',
  'linkedin_headline',
];

router.patch('/sessions/:id/outputs/:outputType', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { id: sessionId, outputType } = req.params;
  const { text, edited_by_user } = req.body;

  if (!ALLOWED_OUTPUT_TYPES.includes(outputType)) {
    return res.status(400).json({ error: 'Invalid output type' });
  }

  const session = await validateSessionOwnership(sessionId, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  await db.query(`
    UPDATE career_sessions
    SET insights = jsonb_set(
      insights,
      '{${outputType}}',
      $1::jsonb
    ),
    updated_at = NOW()
    WHERE id = $2 AND user_id = $3
  `, [JSON.stringify(text), sessionId, userId]);

  await db.query(`
    UPDATE career_sessions
    SET insights = jsonb_set(
      insights,
      '{${outputType}_user_edited}',
      'true'::jsonb
    )
    WHERE id = $1
  `, [sessionId]);

  res.json({ ok: true });
});

// ── GET /sessions/:id/next-nudge ───────────────────────────────────────────

router.get('/sessions/:id/next-nudge', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const session = await validateSessionOwnership(req.params.id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const isFirstSession = !session.insights?.strength;
  if (isFirstSession) return res.json({ nudge: null });

  const enrichedNodeIds = session.enriched_node_ids || [];
  const nextNode = selectNextNudge(session.graph_data, enrichedNodeIds);
  if (!nextNode) return res.json({ nudge: null });

  const reason = buildNudgeReason(nextNode, session.graph_data, session);

  res.json({
    nudge: {
      node: nextNode,
      reason,
      question: null,
      score: scoreNodeForEnrichment(nextNode, session.graph_data.edges, enrichedNodeIds)
    }
  });
});

// ── POST /sessions/:id/nudge-question ─────────────────────────────────────

router.post('/sessions/:id/nudge-question', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { node_id } = req.body;
  const session = await validateSessionOwnership(req.params.id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const node = session.graph_data?.nodes.find((n: Node) => n.id === node_id);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  const connectedNodes = getConnectedNodes(node_id, session.graph_data);
  const reason = buildNudgeReason(node, session.graph_data, session);
  const stageProfile = detectStageProfile(session.graph_data);
  const promptPackage = buildNodeEnrichmentPrompt(node, connectedNodes, reason, stageProfile);
  const question = await callClaude(promptPackage, 150);

  res.json({ question });
});

// ── POST /sessions/:id/enrich-node ────────────────────────────────────────

router.post('/sessions/:id/enrich-node', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { node_id, detail, year } = req.body;
  const session = await validateSessionOwnership(req.params.id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const graph = session.graph_data;
  const nodeIdx = graph.nodes.findIndex((n: Node) => n.id === node_id);
  if (nodeIdx === -1) return res.status(404).json({ error: 'Node not found' });

  graph.nodes[nodeIdx] = {
    ...graph.nodes[nodeIdx],
    detail,
    year: year || graph.nodes[nodeIdx].year
  };

  const enrichedNodeIds = [...(session.enriched_node_ids || []), node_id];

  await db.query(`
    UPDATE career_sessions
    SET graph_data = $1,
        enriched_node_ids = $2,
        summary_version = summary_version + 1,
        updated_at = NOW()
    WHERE id = $3 AND user_id = $4
  `, [
    JSON.stringify(graph),
    JSON.stringify(enrichedNodeIds),
    session.id,
    userId
  ]);

  triggerAutoRefine(userId, 'graph_enriched').catch(() => {});
  updateVoiceFromAnswer(userId, detail, 'enrichment').catch(() => {});

  res.json({
    updated_node: graph.nodes[nodeIdx],
    triggered_refinements: ['linkedin_summary', 'short_bio', 'portrait']
  });
});

export default router;

// Stub declarations — replace with actual implementations
declare function requireAuth(req: any, res: any, next: any): void;
declare function validateSessionOwnership(sessionId: string, userId: string): Promise<any>;
declare function detectStageProfile(graph: any): { stage: 'ic' | 'leader' | 'executive' };
declare function callClaude(prompt: any, maxTokens: number): Promise<string>;
declare function triggerAutoRefine(userId: string, trigger: string): Promise<void>;
declare function updateVoiceFromAnswer(userId: string, text: string, source: string): Promise<void>;
declare const db: { query: (sql: string, params: any[]) => Promise<any> };
