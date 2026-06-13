import { Router, Request, Response } from 'express';
import { requireAuth, uid } from '../middleware/auth';
import { assembleContext } from '../assembler';
import { anthropic, MODEL } from '../lib/anthropic';
import { logUsage, checkRateLimit } from '../db/usage';
import { validateSessionOwnership, updateSession } from '../db/sessions';
import { appendNodeMessages } from '../db/conversations';
import { buildDeterministicSkeleton, detectStageProfile } from '../assembler/summary';
import { CareerGraph, InsightStrength, Node, TaskType } from '../assembler/types';
import { validateInsight } from '../assembler/tasks/insightGeneration';
import { buildResumeVoicePrompt, updateVoiceFromAnswer } from '../assembler/tasks/voiceExtraction';
import { initVoiceProfile, ResumeVoiceResult } from '../lib/voiceProfile';
import { supabaseAdmin } from '../db/client';
import { getVoiceProfile } from '../lib/voiceProfile';
import { generateGoalGhostNodes, buildGhostEdges } from '../assembler/tasks/goalGraph';
import { evaluateArticleAgainstGhostNodes, buildEnrichmentToast } from '../assembler/tasks/articleEnrichment';
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

    // Run graph extraction and voice extraction in parallel — both use resume text.
    // Resume text is discarded after this block (never stored).
    const voicePrompt = buildResumeVoicePrompt(resume_text);
    const [response, voiceMsg] = await Promise.all([
      callClaude(userId, session_id, 'graph_extraction', pkg, 3000),
      anthropic.messages.create({
        model: MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: voicePrompt }],
      }),
    ]);

    const graph: CareerGraph = parseJsonResponse<CareerGraph>(response);

    // Store voice profile async — never block the response on it
    try {
      const voiceText = (voiceMsg.content[0] as { type: string; text: string }).text.trim();
      const voiceResult: ResumeVoiceResult = JSON.parse(voiceText.replace(/^```json\n?|```$/g, ''));
      initVoiceProfile(userId, voiceResult).catch(() => {});
    } catch {
      // Voice extraction failure does not affect graph extraction
    }

    const skeleton = buildDeterministicSkeleton(graph, null, null, detectStageProfile(graph));
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

    const skeleton = buildDeterministicSkeleton(updatedGraph, session.insights, session.selected_branch, detectStageProfile(updatedGraph));
    await updateSession(session_id, userId, {
      graph_data: updatedGraph,
      career_summary: skeleton,
      answers,
      enrich_count: (session.enrich_count ?? 0) + 1,
      summary_version: (session.summary_version ?? 0) + 1,
    });

    // Fire-and-forget voice update — answer text is high-signal for natural voice
    updateVoiceFromAnswer(userId, answer, 'enrichment').catch(() => {});

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
          const skeleton = buildDeterministicSkeleton(graph, insights, chosen_branch_index, detectStageProfile(graph));
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

// ─── POST /claude/career-chat ─────────────────────────────────

router.post('/career-chat', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, message, history } = req.body;
  if (!session_id || !message) {
    res.status(400).json({ error: 'session_id, message required' }); return;
  }

  if (!await checkRateLimit(userId, 'career_chat')) {
    res.status(429).json({ error: 'Daily career chat limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'career_chat',
      params: { session_id, message, history: history ?? [] },
    });

    const response = await callClaude(userId, session_id, 'career_chat', pkg, 600);
    const reply = responseText(response);

    res.json({ content: reply, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'career_chat failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/insight/regenerate ─────────────────────────

router.post('/insight/regenerate', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, previous_insight } = req.body;
  if (!session_id || !previous_insight) {
    res.status(400).json({ error: 'session_id, previous_insight required' }); return;
  }

  if (!await checkRateLimit(userId, 'insight_regeneration')) {
    res.status(429).json({ error: 'Daily regeneration limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'insight_regeneration',
      params: { session_id, previous_insight },
    });

    let response = await callClaude(userId, session_id, 'insight_regeneration', pkg, 400);
    let strength: InsightStrength = parseJsonResponse<InsightStrength>(response);

    // Same quality gate as initial insight_generation
    if (!validateInsight(strength.insight)) {
      const retryPkg = {
        ...pkg,
        task_prompt: `${pkg.task_prompt}\n\nNOTE: The previous attempt contained generic language. Regenerate with more specific behavioral evidence from the graph. The identity reframe in sentence 3 must use **bold**.`,
      };
      response = await callClaude(userId, session_id, 'insight_regeneration', retryPkg, 400);
      strength = parseJsonResponse<InsightStrength>(response);
    }

    // Save new insight; move current insight into previous_insight for restore
    const insights = { ...(session.insights ?? {}), strength };
    await updateSession(session_id, userId, {
      insights,
      previous_insight,
    });

    res.json({ strength, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'insight_regeneration failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/linkedin-summary ───────────────────────────

router.post('/linkedin-summary', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id } = req.body;
  if (!session_id) { res.status(400).json({ error: 'session_id required' }); return; }

  if (!await checkRateLimit(userId, 'linkedin_summary')) {
    res.status(429).json({ error: 'Daily LinkedIn summary limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'linkedin_summary', params: { session_id },
    });

    const response = await callClaude(userId, session_id, 'linkedin_summary', pkg, 600);
    const summary = responseText(response);

    const insights = {
      ...(session.insights ?? {}),
      linkedin_summary: summary,
      linkedin_summary_generated_at: new Date().toISOString(),
    };
    await updateSession(session_id, userId, { insights });

    res.json({ summary, character_count: summary.length, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'linkedin_summary failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/short-bio ───────────────────────────────────

router.post('/short-bio', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id } = req.body;
  if (!session_id) { res.status(400).json({ error: 'session_id required' }); return; }

  if (!await checkRateLimit(userId, 'short_bio')) {
    res.status(429).json({ error: 'Daily bio limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'short_bio', params: { session_id },
    });

    const response = await callClaude(userId, session_id, 'short_bio', pkg, 300);
    const bio = responseText(response);

    const insights = {
      ...(session.insights ?? {}),
      short_bio: bio,
      short_bio_generated_at: new Date().toISOString(),
    };
    await updateSession(session_id, userId, { insights });

    res.json({ bio, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'short_bio failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/content-ideas ──────────────────────────────

router.post('/content-ideas', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, target_ghost_node_id } = req.body;
  if (!session_id) { res.status(400).json({ error: 'session_id required' }); return; }

  if (!await checkRateLimit(userId, 'content_ideas')) {
    res.status(429).json({ error: 'Daily content ideas limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  const ghostNodes = (session.graph_data?.nodes ?? []).filter((n: Node & { ghost?: boolean }) => n.ghost);

  // Return cached ideas when no ghost target and cache is < 24h old
  if (!target_ghost_node_id && session.content_ideas_generated_at) {
    const age = Date.now() - new Date(session.content_ideas_generated_at).getTime();
    if (age < 86_400_000 && Array.isArray(session.content_ideas)) {
      res.json({ ideas: session.content_ideas, ghost_nodes: ghostNodes }); return;
    }
  }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'content_ideas',
      params: { session_id, target_ghost_node_id: target_ghost_node_id ?? null },
    });

    const response = await callClaude(userId, session_id, 'content_ideas', pkg, 600);
    const result = parseJsonResponse<{ ideas: unknown[] }>(response);
    const ideas = Array.isArray(result?.ideas)
      ? result.ideas
      : Array.isArray(result)
        ? result
        : [];

    await updateSession(session_id, userId, {
      content_ideas:               ideas,
      content_ideas_generated_at:  new Date().toISOString(),
    });

    res.json({ ideas, ghost_nodes: ghostNodes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'content_ideas failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/article-draft ──────────────────────────────

router.post('/article-draft', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, thoughts, target_ghost_node_id } = req.body;
  if (!session_id || !thoughts?.trim()) {
    res.status(400).json({ error: 'session_id, thoughts required' }); return;
  }

  if (!await checkRateLimit(userId, 'article_draft')) {
    res.status(429).json({ error: 'Daily article draft limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'article_draft',
      params: { session_id, user_thoughts: thoughts.trim(), target_ghost_node_id: target_ghost_node_id ?? null },
    });

    const response = await callClaude(userId, session_id, 'article_draft', pkg, 1200);
    const raw = responseText(response);

    const lines = raw.split('\n');
    const title = lines[0].trim();
    const body  = lines.slice(2).join('\n').trim();

    const { data: article, error } = await supabaseAdmin
      .from('articles')
      .insert({
        user_id:              userId,
        session_id,
        title,
        theme:                thoughts.trim(),
        generated_draft:      body,
        current_content:      body,
        word_count:           body.split(/\s+/).filter(Boolean).length,
        target_ghost_node_id: target_ghost_node_id ?? null,
      })
      .select('id, title')
      .single();

    if (error) throw error;

    res.json({ article_id: article.id, title, body, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'article_draft failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/article/:id/publish ────────────────────────

router.post('/article/:id/publish', async (req: Request, res: Response) => {
  const userId = uid(req);
  const articleId = req.params.id;
  const { session_id, platform, published_url, final_content } = req.body;
  if (!session_id) { res.status(400).json({ error: 'session_id required' }); return; }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const { data: article, error: fetchErr } = await supabaseAdmin
      .from('articles')
      .select('*')
      .eq('id', articleId)
      .eq('user_id', userId)
      .single();
    if (fetchErr || !article) { res.status(404).json({ error: 'Article not found' }); return; }

    if (article.status === 'published') {
      res.status(409).json({ error: 'Article already published' }); return;
    }

    const content = final_content ?? article.current_content ?? '';
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    const editSimilarity = article.generated_draft && final_content
      ? wordJaccard(article.generated_draft, final_content)
      : 1;

    await supabaseAdmin.from('articles').update({
      status:            'published',
      published_content: content,
      published_url:     published_url ?? null,
      platform:          platform ?? null,
      published_at:      new Date().toISOString(),
      word_count:        wordCount,
      edit_similarity:   editSimilarity,
    }).eq('id', articleId).eq('user_id', userId).neq('status', 'published');

    // Add a publication node to the career graph (clone nodes to avoid mutating session ref)
    const graph: CareerGraph = {
      nodes: [...(session.graph_data?.nodes ?? [])],
      edges: [...(session.graph_data?.edges ?? [])],
    };
    const pubNode = {
      id:     `pub_${Date.now()}`,
      type:   'outcome' as const,
      label:  article.title?.slice(0, 35) ?? 'Published Article',
      detail: `Published ${platform ?? ''} article. ${(final_content ?? '').slice(0, 80)}…`,
      year:   new Date().getFullYear().toString(),
      weight: 2 as const,
    };
    graph.nodes.push(pubNode);
    await updateSession(session_id, userId, {
      graph_data:      graph,
      summary_version: (session.summary_version ?? 0) + 1,
    });

    // Fire-and-forget: evaluate article against ghost nodes and advance progress
    const ghostNodes = graph.nodes.filter((n: any) => n.ghost);
    if (ghostNodes.length) {
      evaluateArticleAgainstGhostNodes(
        content, article.title ?? '', ghostNodes, article.target_ghost_node_id ?? null,
      ).then(async ({ updates }) => {
        if (!updates.length) return;
        const freshSession = await validateSessionOwnership(session_id, userId);
        if (!freshSession) return;
        const freshGraph: CareerGraph = {
          nodes: [...(freshSession.graph_data?.nodes ?? [])],
          edges: [...(freshSession.graph_data?.edges ?? [])],
        };
        let changed = false;
        for (const u of updates) {
          const nodeIdx = freshGraph.nodes.findIndex((n: any) => n.id === u.ghost_node_id);
          if (nodeIdx === -1) continue;
          const node = freshGraph.nodes[nodeIdx] as any;
          const newProgress = Math.min(1, (node.ghost_progress ?? 0) + u.progress_delta);
          freshGraph.nodes[nodeIdx] = { ...node, ghost_progress: newProgress };
          if (newProgress >= 0.8) {
            // Convert ghost node to real outcome node
            const { ghost, ghost_progress, ghost_filled_by, ghost_addressed_by, ...realFields } = freshGraph.nodes[nodeIdx] as any;
            freshGraph.nodes[nodeIdx] = { ...realFields, type: 'outcome', weight: 2 };
          }
          changed = true;
        }
        if (changed) {
          await updateSession(session_id, userId, {
            graph_data:      freshGraph,
            summary_version: (freshSession.summary_version ?? 0) + 1,
          });
        }
      }).catch(() => {});
    }

    res.json({ ok: true, word_count: wordCount, edit_similarity: editSimilarity });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'article publish failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/chat-assist ─────────────────────────────────

router.post('/chat-assist', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, tab_type, current_text, messages } = req.body;

  const VALID_TABS = ['bio', 'summary', 'article'];
  if (!session_id || !VALID_TABS.includes(tab_type)) {
    res.status(400).json({ error: 'session_id and valid tab_type required' }); return;
  }

  if (!await checkRateLimit(userId, 'chat_assist')) {
    res.status(429).json({ error: 'Daily chat assist limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const { buildChatAssistContext, injectContext } = await import('../assembler/tasks/chatAssist');
    const { getVoiceProfile } = await import('../lib/voiceProfile');

    const voiceProfile = await getVoiceProfile(userId).catch(() => null);
    const { system, contextBlock } = buildChatAssistContext(
      session, tab_type, current_text ?? '', voiceProfile,
    );

    const rawMessages: Array<{ role: string; content: string }> = messages ?? [];
    const primed = injectContext(rawMessages, contextBlock);

    const response = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: 1000,
      system,
      messages:   primed as Array<{ role: 'user' | 'assistant'; content: string }>,
    });

    await logUsage({
      userId, sessionId: session_id, taskType: 'chat_assist',
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    });

    const content = (response.content[0] as { type: string; text: string }).text;
    res.json({ content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'chat_assist failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/node-enrichment-question ────────────────────

router.post('/node-enrichment-question', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, node_id } = req.body;
  if (!session_id || !node_id) {
    res.status(400).json({ error: 'session_id, node_id required' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'node_enrichment_question', params: { session_id, node_id },
    });

    const response = await callClaude(userId, session_id, 'node_enrichment_question', pkg, 150);
    const question = responseText(response);

    res.json({ question, node_id, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'node_enrichment_question failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/article-enhance-selection ──────────────────
// Five editor actions on a text selection: strengthen, direct, expand, cut, rewrite.

router.post('/article-enhance-selection', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, selected_text, action, full_text } = req.body;

  const VALID_ACTIONS = ['strengthen', 'direct', 'expand', 'cut', 'rewrite'];
  if (!session_id || !selected_text?.trim() || !VALID_ACTIONS.includes(action)) {
    res.status(400).json({ error: 'session_id, selected_text, and valid action required' }); return;
  }

  if (!await checkRateLimit(userId, 'article_enhance_selection')) {
    res.status(429).json({ error: 'Daily enhancement limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const voiceProfile = await getVoiceProfile(userId).catch(() => null);
    const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };

    const ACTION_INSTRUCTIONS: Record<string, string> = {
      strengthen: 'Make this passage stronger and more compelling. Use concrete evidence or sharper language. Do not expand the length significantly.',
      direct:     'Make this passage more direct and confident. Cut hedging language ("I think", "sort of", "maybe"). Keep the same meaning.',
      expand:     'Expand this passage with one or two additional sentences that deepen the insight or add a specific example.',
      cut:        'Cut this passage to its essential meaning. Remove filler, repetition, and weak qualifiers. Aim for half the word count.',
      rewrite:    'Rewrite this passage from scratch while preserving the core idea. Fresh angle, new phrasing.',
    };

    const voiceGuidance = voiceProfile
      ? `Voice note: ${voiceProfile.voice_note ?? ''}`
      : '';

    const contextSample = full_text
      ? `\n\nFull article context (first 400 words):\n${full_text.slice(0, 1600)}`
      : '';

    const system = `You are a professional writing editor helping improve LinkedIn and professional articles. Return ONLY the improved version of the selected text — no commentary, no labels, no explanation. Match the author's voice.${voiceGuidance ? '\n\n' + voiceGuidance : ''}`;

    const userPrompt = `Action: ${action.toUpperCase()}\nInstruction: ${ACTION_INSTRUCTIONS[action]}${contextSample}\n\nSelected text to ${action}:\n"""\n${selected_text}\n"""\n\nReturn the improved version only:`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    });

    await logUsage({
      userId, sessionId: session_id, taskType: 'article_enhance_selection',
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    });

    res.json({ enhanced_text: responseText(response).trim() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'article_enhance_selection failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/article-review ──────────────────────────────
// Returns 3 structured observations (voice / specificity / structure) + overall one-liner.

router.post('/article-review', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, article_id } = req.body;
  if (!session_id || !article_id) {
    res.status(400).json({ error: 'session_id and article_id required' }); return;
  }

  if (!await checkRateLimit(userId, 'article_review')) {
    res.status(429).json({ error: 'Daily review limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const { data: article, error: fetchErr } = await supabaseAdmin
      .from('articles')
      .select('title, current_content, generated_draft')
      .eq('id', article_id)
      .eq('user_id', userId)
      .single();
    if (fetchErr || !article) { res.status(404).json({ error: 'Article not found' }); return; }

    const content = article.current_content ?? article.generated_draft ?? '';
    if (!content.trim()) {
      res.status(400).json({ error: 'Article has no content to review' }); return;
    }

    const voiceProfile = await getVoiceProfile(userId).catch(() => null);
    const voiceHint = voiceProfile
      ? `Author voice note: ${voiceProfile.voice_note ?? ''}`
      : '';

    const prompt = `You are a professional editor reviewing a LinkedIn-style article.${voiceHint ? '\n' + voiceHint : ''}

Article title: "${article.title ?? 'Untitled'}"
Article content:
"""
${content.slice(0, 3000)}
"""

Return ONLY valid JSON (no markdown fences) with exactly this shape:
{
  "observations": [
    { "dimension": "voice",       "finding": "...", "suggestion": "..." },
    { "dimension": "specificity", "finding": "...", "suggestion": "..." },
    { "dimension": "structure",   "finding": "...", "suggestion": "..." }
  ],
  "overall": "One sentence — the most important thing to improve in this draft."
}

Rules:
- Each finding is 1 sentence describing what's working or what's weak.
- Each suggestion is 1 sentence — a specific, actionable change.
- overall is 1 sentence.
- Never repeat the same point across dimensions.`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    await logUsage({
      userId, sessionId: session_id, taskType: 'article_review',
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    });

    const result = parseJsonResponse<{ observations: unknown[]; overall: string }>(response);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'article_review failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/goal-graph ───────────────────────────────────
// Generates 4-7 ghost nodes representing gaps to the target role and merges them into the session graph.

router.post('/goal-graph', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, goal_title } = req.body;
  if (!session_id || !goal_title?.trim()) {
    res.status(400).json({ error: 'session_id and goal_title required' }); return;
  }

  if (!await checkRateLimit(userId, 'goal_graph')) {
    res.status(429).json({ error: 'Daily goal graph limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const ghostNodes = await generateGoalGhostNodes(session, goal_title.trim());

    const graph: CareerGraph = {
      nodes: [...(session.graph_data?.nodes ?? [])],
      edges: [...(session.graph_data?.edges ?? [])],
    };

    // Remove any previous ghost nodes before inserting the new set
    graph.nodes = graph.nodes.filter((n: any) => !n.ghost);
    graph.edges = (graph.edges as any[]).filter((e: any) => !e.ghost) as typeof graph.edges;

    graph.nodes.push(...ghostNodes);
    const ghostEdges = buildGhostEdges(ghostNodes, graph.nodes);
    (graph.edges as any[]).push(...ghostEdges);

    await updateSession(session_id, userId, {
      goal_title:               goal_title.trim(),
      goal_graph_generated_at:  new Date().toISOString(),
      goal_graph_version:       (session.goal_graph_version ?? 0) + 1,
      graph_data:               graph,
      summary_version:          (session.summary_version ?? 0) + 1,
    });

    await logUsage({ userId, sessionId: session_id, taskType: 'goal_graph', estimatedTokens: 1000 });

    res.json({ ghost_nodes: ghostNodes, goal_title: goal_title.trim() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'goal_graph failed';
    res.status(500).json({ error: msg });
  }
});

export default router;

// Word-level Jaccard similarity: |A∩B| / |A∪B| over the token sets
function wordJaccard(a: string, b: string): number {
  const tokA = new Set(a.toLowerCase().match(/\w+/g) ?? []);
  const tokB = new Set(b.toLowerCase().match(/\w+/g) ?? []);
  if (!tokA.size && !tokB.size) return 1;
  let intersection = 0;
  for (const t of tokA) { if (tokB.has(t)) intersection++; }
  return intersection / (tokA.size + tokB.size - intersection);
}
