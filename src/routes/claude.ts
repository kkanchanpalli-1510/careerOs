import { Router, Request, Response } from 'express';
import { requireAuth, uid } from '../middleware/auth';
import { assembleContext } from '../assembler';
import { anthropic, MODEL } from '../lib/anthropic';
import { logUsage, checkRateLimit } from '../db/usage';
import { validateSessionOwnership, updateSession } from '../db/sessions';
import { appendNodeMessages } from '../db/conversations';
import { buildDeterministicSkeleton, detectStageProfile } from '../assembler/summary';
import { CareerGraph, InsightStrength, TaskType } from '../assembler/types';
import { validateInsight } from '../assembler/tasks/insightGeneration';
import { buildResumeVoicePrompt, updateVoiceFromAnswer } from '../assembler/tasks/voiceExtraction';
import { initVoiceProfile, ResumeVoiceResult } from '../lib/voiceProfile';
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
  const { session_id } = req.body;
  if (!session_id) { res.status(400).json({ error: 'session_id required' }); return; }

  if (!await checkRateLimit(userId, 'content_ideas')) {
    res.status(429).json({ error: 'Daily content ideas limit reached' }); return;
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const pkg = await assembleContext({
      user_id: userId, task: 'content_ideas', params: { session_id },
    });

    const response = await callClaude(userId, session_id, 'content_ideas', pkg, 600);
    const result = parseJsonResponse<{ ideas: unknown[] }>(response);

    const insights = { ...(session.insights ?? {}), content_ideas: result.ideas };
    await updateSession(session_id, userId, {
      insights,
      content_ideas: result.ideas,
      content_ideas_generated_at: new Date().toISOString(),
    });

    res.json({ ideas: result.ideas, metadata: pkg.metadata });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'content_ideas failed';
    res.status(500).json({ error: msg });
  }
});

// ─── POST /claude/article-draft ──────────────────────────────

router.post('/article-draft', async (req: Request, res: Response) => {
  const userId = uid(req);
  const { session_id, thoughts } = req.body;
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
      params: { session_id, user_thoughts: thoughts.trim() },
    });

    const response = await callClaude(userId, session_id, 'article_draft', pkg, 1200);
    const raw = responseText(response);

    // First line is the title, blank line, then body
    const lines = raw.split('\n');
    const title = lines[0].trim();
    const body  = lines.slice(2).join('\n').trim();

    const { data: article, error } = await (await import('../db/client')).supabaseAdmin
      .from('articles')
      .insert({
        user_id:           userId,
        session_id,
        title,
        theme:             thoughts.trim(),
        generated_draft:   body,
        current_content:   body,
        word_count:        body.split(/\s+/).length,
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
    const { supabaseAdmin } = await import('../db/client');

    const { data: article, error: fetchErr } = await supabaseAdmin
      .from('articles')
      .select('*')
      .eq('id', articleId)
      .eq('user_id', userId)
      .single();
    if (fetchErr || !article) { res.status(404).json({ error: 'Article not found' }); return; }

    const wordCount = (final_content ?? article.current_content ?? '').split(/\s+/).length;
    const editSimilarity = article.generated_draft && final_content
      ? Math.max(0, 1 - (editDistance(article.generated_draft, final_content) /
          Math.max(article.generated_draft.length, final_content.length)))
      : 1;

    await supabaseAdmin.from('articles').update({
      status:            'published',
      published_content: final_content ?? article.current_content,
      published_url:     published_url ?? null,
      platform:          platform ?? null,
      published_at:      new Date().toISOString(),
      word_count:        wordCount,
      edit_similarity:   editSimilarity,
    }).eq('id', articleId).eq('user_id', userId);

    // Add a publication node to the career graph
    const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };
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

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) { res.status(403).json({ error: 'Forbidden' }); return; }

  try {
    const { buildChatAssistContext, injectContext } = await import('../assembler/tasks/chatAssist');
    const { getVoiceProfile } = await import('../lib/voiceProfile');
    const { anthropic, MODEL } = await import('../lib/anthropic');

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

export default router;

// Rough edit-distance proxy — just character-level diff ratio
function editDistance(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) matches++;
  }
  return longer.length - matches;
}
