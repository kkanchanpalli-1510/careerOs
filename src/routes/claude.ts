import { Router, Request, Response } from 'express';
import { requireAuth, uid } from '../middleware/auth';
import { assembleContext } from '../assembler';
import { anthropic, MODEL } from '../lib/anthropic';
import { logUsage, checkRateLimit } from '../db/usage';
import { validateSessionOwnership, updateSession } from '../db/sessions';
import { appendNodeMessages } from '../db/conversations';
import { buildDeterministicSkeleton } from '../assembler/summary';
import { CareerGraph, InsightStrength, TaskType } from '../assembler/types';
import { validateInsight } from '../assembler/tasks/insightGeneration';
import type { Message } from '@anthropic-ai/sdk/resources/messages';

const router = Router();
router.use(requireAuth);

function responseText(response: Message) {
  return (response.content[0] as { type: string; text: string }).text;
}

/** Strip optional markdown code fences then parse. Claude occasionally wraps JSON in ```json...```. */
function parseJsonResponse<T = unknown>(response: Message): T {
  const raw = responseText(response);
  const fenced = raw.match(/^```[a-zA-Z]*\n?([\s\S]*?)\n?```\s*$/);
  return JSON.parse(fenced ? fenced[1] : raw.trim()) as T;
}

async function callClaude(
  userId: string, sessionId: string, taskType: TaskType,
  pkg: { system: string; user_context: string; task_prompt: string; estimated_tokens: number },
  maxTokens: number
): Promise<Message> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: pkg.system,
    messages: [{ role: 'user', content: `${pkg.user_context}\n\n${pkg.task_prompt}`.trim() }],
  });

  await logUsage({
    userId, sessionId, taskType,
    promptTokens: response.usage.input_tokens,
    completionTokens: response.usage.output_tokens,
  });

  return response;
}

// ─── POST /claude/node-chat ───────────────────────────────────

router.post('/node-chat', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, node_id, message } = req.body;
  if (!session_id || !node_id || !message) {
    res.status(400).json({ error: 'session_id, node_id, message required' }); return;
  }

  if (!await checkRateLimit(userId, 'node_chat')) {
    res.status(429).json({ error: 'Daily node chat limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'node_chat',
      params: { session_id, node_id, user_message: message, conversation_turn: 0 },
    });

    const response = await callClaude(userId, session_id, 'node_chat', pkg, 600);
    const reply = responseText(response);

    await appendNodeMessages(session_id, node_id, userId, message, reply);

    res.json({ content: reply, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'node_chat failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/extract ─────────────────────────────────────

router.post('/extract', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, resume_text } = req.body;
  if (!session_id || !resume_text) {
    res.status(400).json({ error: 'session_id, resume_text required' }); return;
  }

  if (!await checkRateLimit(userId, 'graph_extraction')) {
    res.status(429).json({ error: 'Daily extraction limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  if (session.graph_data) {
    res.status(409).json({ error: 'Graph already exists for this session. Delete it first.' }); return;
  }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'graph_extraction', params: { resume_text },
    });

    const response = await callClaude(userId, session_id, 'graph_extraction', pkg, 3000);
    const graph: CareerGraph = parseJsonResponse<CareerGraph>(response);

    const skeleton = buildDeterministicSkeleton(graph, null, null);
    await updateSession(session_id, userId, {
      graph_data: graph,
      career_summary: skeleton,
      summary_version: 1,
      step: 1,
    });

    res.json({ graph, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'graph_extraction failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/insight ─────────────────────────────────────

router.post('/insight', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id } = req.body;
  if (!session_id) { res.status(400).json({ error: 'session_id required' }); return; }

  if (!await checkRateLimit(userId, 'insight_generation')) {
    res.status(429).json({ error: 'Daily insight limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'insight_generation', params: { session_id },
    });

    let response = await callClaude(userId, session_id, 'insight_generation', pkg, 400);
    let strength: InsightStrength = parseJsonResponse<InsightStrength>(response);

    // validate — retry once if banned words / missing reframe / no specificity
    if (!validateInsight(strength.insight)) {
      const retryPkg = {
        ...pkg,
        task_prompt: `${pkg.task_prompt}\n\nNOTE: The previous attempt contained generic language. Regenerate with more specific behavioral evidence from the graph. Banned words include: seasoned, passionate, proven, dynamic, results-driven, strategic thinker, thought leader. The identity reframe in sentence 3 must use **bold**.`,
      };
      response = await callClaude(userId, session_id, 'insight_generation', retryPkg, 400);
      strength = parseJsonResponse<InsightStrength>(response);
    }

    const insights = { ...(session.insights ?? {}), strength };
    await updateSession(session_id, userId, { insights });

    res.json({ strength, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'insight_generation failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/branches ────────────────────────────────────

router.post('/branches', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id } = req.body;
  if (!session_id) { res.status(400).json({ error: 'session_id required' }); return; }

  if (!await checkRateLimit(userId, 'branch_generation')) {
    res.status(429).json({ error: 'Daily branch limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'branch_generation', params: { session_id },
    });

    const response = await callClaude(userId, session_id, 'branch_generation', pkg, 500);
    const branches = parseJsonResponse<unknown[]>(response);

    const insights = { ...(session.insights ?? {}), branches };
    await updateSession(session_id, userId, { insights });

    res.json({ branches, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'branch_generation failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/enrich ──────────────────────────────────────

router.post('/enrich', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, question, answer, question_index } = req.body;
  if (!session_id || !question || !answer || question_index === undefined) {
    res.status(400).json({ error: 'session_id, question, answer, question_index required' }); return;
  }

  if (!await checkRateLimit(userId, 'gap_enrichment')) {
    res.status(429).json({ error: 'Daily enrichment limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  if (!session.graph_data) {
    res.status(409).json({ error: 'Run /extract before /enrich' }); return;
  }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'gap_enrichment',
      params: { session_id, question, answer, question_index },
    });

    const response = await callClaude(userId, session_id, 'gap_enrichment', pkg, 400);
    const enriched: { nodes: CareerGraph['nodes']; edges: CareerGraph['edges'] } = parseJsonResponse<{ nodes: CareerGraph['nodes']; edges: CareerGraph['edges'] }>(response);

    const graph: CareerGraph = session.graph_data;
    const updatedGraph: CareerGraph = {
      nodes: [...graph.nodes, ...enriched.nodes],
      edges: [...graph.edges, ...enriched.edges],
    };

    const answers: string[] = session.answers ?? [];
    answers[question_index] = answer;

    const skeleton = buildDeterministicSkeleton(updatedGraph, session.insights, session.selected_branch);
    await updateSession(session_id, userId, {
      graph_data: updatedGraph,
      career_summary: skeleton,
      answers,
      enrich_count: (session.enrich_count ?? 0) + 1,
      summary_version: (session.summary_version ?? 0) + 1,
    });

    res.json({ new_nodes: enriched.nodes, new_edges: enriched.edges, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'gap_enrichment failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/synthesis ───────────────────────────────────

router.post('/synthesis', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, chosen_branch_index } = req.body;
  if (!session_id || chosen_branch_index === undefined) {
    res.status(400).json({ error: 'session_id, chosen_branch_index required' }); return;
  }

  if (!await checkRateLimit(userId, 'final_synthesis')) {
    res.status(429).json({ error: 'Daily synthesis limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'final_synthesis',
      params: { session_id, chosen_branch_index },
    });

    const response = await callClaude(userId, session_id, 'final_synthesis', pkg, 600);
    const portrait = parseJsonResponse<unknown>(response);

    const insights = { ...(session.insights ?? {}), portrait };
    await updateSession(session_id, userId, { insights, selected_branch: chosen_branch_index });

    // behavioral pattern generation — fires after response, not in critical path
    setImmediate(() => {
      assembleContext({ user_id: userId, task: 'career_summary_generation', params: { session_id } })
        .then(summaryPkg => callClaude(userId, session_id, 'career_summary_generation', summaryPkg, 150))
        .then(async r => {
          const pattern = responseText(r);
          const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };
          const skeleton = buildDeterministicSkeleton(graph, insights, chosen_branch_index);
          await updateSession(session_id, userId, {
            behavioral_pattern: pattern,
            career_summary: `${skeleton}\n${pattern}`,
          });
        })
        .catch(err => { console.error('[career_summary_generation]', err instanceof Error ? err.message : err); });
    });

    res.json({ portrait, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'final_synthesis failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/project ─────────────────────────────────────

router.post('/project', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, job_description } = req.body;
  if (!session_id || !job_description) {
    res.status(400).json({ error: 'session_id, job_description required' }); return;
  }

  if (!await checkRateLimit(userId, 'resume_projection')) {
    res.status(429).json({ error: 'Daily projection limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'resume_projection',
      params: { session_id, job_description },
    });

    const response = await callClaude(userId, session_id, 'resume_projection', pkg, 800);
    const projection = parseJsonResponse<Record<string, unknown>>(response);

    const insights = { ...(session.insights ?? {}), projection };
    await updateSession(session_id, userId, { insights });

    res.json({ ...projection, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'resume_projection failed';
    res.status(500).json({ error: msg });
  }
});

export default router;
