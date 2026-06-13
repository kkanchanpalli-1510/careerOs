// src/routes/claude.ts

import { Router } from 'express';
import { buildArticleDraftPrompt } from '../assembler/tasks/articleDraft';
import { buildContentIdeasPrompt } from '../assembler/tasks/contentIdeas';
import { buildChatAssistPrompt, injectContext } from '../assembler/tasks/chatAssist';

const router = Router();

// ── POST /claude/article-draft ─────────────────────────────────────────────

router.post('/claude/article-draft', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id, thoughts } = req.body;

  if (!thoughts || thoughts.trim().length < 10) {
    return res.status(400).json({ error: 'Thoughts required' });
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const stageProfile = detectStageProfile(session.graph_data);
  const voiceProfile = await getVoiceProfile(userId);

  const promptPackage = buildArticleDraftPrompt(
    session, thoughts.trim(), stageProfile, voiceProfile
  );

  await logUsageEstimate(userId, session_id, 'article_draft',
    promptPackage.estimated_tokens);

  const rawDraft = await callClaude(promptPackage, 1200);

  const lines = rawDraft.split('\n');
  const title = lines[0].trim();
  const body = lines.slice(2).join('\n').trim();

  const article = await db.query(`
    INSERT INTO articles
      (user_id, session_id, title, theme, generated_draft,
       current_content, word_count)
    VALUES ($1, $2, $3, $4, $5, $5, $6)
    RETURNING id, title
  `, [
    userId, session_id, title,
    thoughts.trim(), body,
    body.split(/\s+/).length
  ]);

  await logUsageActual(userId, session_id, 'article_draft');

  res.json({
    article_id: article.rows[0].id,
    title: article.rows[0].title,
    draft: body
  });
});

// ── POST /claude/content-ideas ─────────────────────────────────────────────

router.post('/claude/content-ideas', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id } = req.body;

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  if (session.content_ideas?.length > 0 &&
      session.content_ideas_generated_at &&
      session.summary_version === session.content_ideas_version) {
    return res.json({ ideas: session.content_ideas });
  }

  const recentActivity = await db.query(`
    SELECT metadata->>'node_id' as node_id
    FROM usage_logs
    WHERE user_id = $1 AND task_type = 'node_chat'
      AND created_at > NOW() - INTERVAL '14 days'
    ORDER BY created_at DESC
    LIMIT 5
  `, [userId]);

  const recentNodeIds = recentActivity.rows.map((r: any) => r.node_id);
  const recentNodeLabels = session.graph_data?.nodes
    .filter((n: any) => recentNodeIds.includes(n.id))
    .map((n: any) => n.label) || [];

  const promptPackage = buildContentIdeasPrompt(session, recentNodeLabels);
  const result = await callClaude(promptPackage, 600);

  let ideas: any[] = [];
  try {
    const parsed = JSON.parse(result);
    ideas = parsed.ideas || [];
  } catch {
    ideas = [];
  }

  await db.query(`
    UPDATE career_sessions
    SET content_ideas = $1,
        content_ideas_generated_at = NOW()
    WHERE id = $2
  `, [JSON.stringify(ideas), session_id]);

  res.json({ ideas });
});

// ── PATCH /articles/:id ────────────────────────────────────────────────────

router.patch('/articles/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { content } = req.body;

  const article = await db.query(
    'SELECT * FROM articles WHERE id = $1 AND user_id = $2',
    [req.params.id, userId]
  );

  if (!article.rows[0]) return res.status(404).json({ error: 'Not found' });

  const wordCount = content?.split(/\s+/).length || 0;
  const similarity = calculateSimilarity(
    article.rows[0].generated_draft || '',
    content || ''
  );

  const versions = article.rows[0].versions || [];
  versions.push({
    version: versions.length + 1,
    content,
    saved_at: new Date().toISOString()
  });

  await db.query(`
    UPDATE articles
    SET current_content = $1,
        word_count = $2,
        edit_similarity = $3,
        edit_count = edit_count + 1,
        versions = $4,
        updated_at = NOW()
    WHERE id = $5 AND user_id = $6
  `, [content, wordCount, similarity,
      JSON.stringify(versions), req.params.id, userId]);

  res.json({ ok: true, word_count: wordCount, edit_similarity: similarity });
});

// ── GET /articles ──────────────────────────────────────────────────────────

router.get('/articles', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id } = req.query;

  const articles = await db.query(`
    SELECT id, title, status, word_count, edit_similarity,
           edit_count, created_at, updated_at,
           LEFT(current_content, 200) as preview
    FROM articles
    WHERE user_id = $1
      ${session_id ? 'AND session_id = $2' : ''}
    ORDER BY updated_at DESC
  `, session_id ? [userId, session_id] : [userId]);

  res.json({ articles: articles.rows });
});

// ── GET /articles/:id ──────────────────────────────────────────────────────

router.get('/articles/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;

  const article = await db.query(
    'SELECT * FROM articles WHERE id = $1 AND user_id = $2',
    [req.params.id, userId]
  );

  if (!article.rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json({ article: article.rows[0] });
});

// ── POST /claude/article-enhance-selection ─────────────────────────────────

router.post('/claude/article-enhance-selection', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id, article_id, selected_text, action, instruction_override } = req.body;

  const VALID_ACTIONS = ['strengthen', 'direct', 'expand', 'cut', 'rewrite'];
  if (!VALID_ACTIONS.includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const voiceProfile = await getVoiceProfile(userId);

  const ACTION_INSTRUCTIONS: Record<string, string> = {
    strengthen: `Strengthen this passage using specific evidence from the career graph provided. Replace vague claims with concrete details from actual graph nodes. Same voice, more specific.`,
    direct: `Make this passage more direct. Remove hedging language. Active voice. No "I personally", no "leveraged".`,
    expand: `Expand this passage with one more specific example from the career graph. Add one paragraph — don't pad.`,
    cut: `Cut this passage to its essential point. Remove everything that doesn't add meaning. Half the words, same impact.`,
    rewrite: `Rewrite this passage in the person's natural voice. Sound like them on their best day — direct, specific, first person.`
  };

  const instruction = instruction_override || ACTION_INSTRUCTIONS[action];

  const relevantNodes = session.graph_data?.nodes
    .filter((n: Node) => n.weight >= 2)
    .filter((n: Node) =>
      selected_text.toLowerCase().includes(n.label.toLowerCase().split(' ')[0]) || n.weight === 3
    )
    .slice(0, 5);

  const prompt = `${instruction}

Voice profile: ${voiceProfile?.voice_note || 'Direct, specific, first person.'}

Relevant career graph nodes:
${relevantNodes?.map((n: Node) => `${n.label}: ${n.detail || 'no detail'}`).join('\n')}

Text to enhance:
"${selected_text}"

Return ONLY the enhanced text. No explanation. No quotes. Match the original length unless action is expand or cut.`;

  const enhanced = await callClaudeRaw(prompt, 400);

  await db.query(`
    INSERT INTO copy_events (user_id, session_id, event_name, metadata)
    VALUES ($1, $2, 'article_selection_enhanced', $3)
  `, [userId, session_id, JSON.stringify({ action, article_id })]);

  res.json({ enhanced_text: enhanced.trim() });
});

// ── POST /claude/article-review ────────────────────────────────────────────

router.post('/claude/article-review', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id, article_id, article_text } = req.body;

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const voiceProfile = await getVoiceProfile(userId);

  const system = `You are a trusted editor who knows this person's career deeply. Your feedback is specific, grounded in their actual graph, and always preserves their voice while elevating their clarity. Never give generic feedback.`;

  const user_context = `Voice profile: ${voiceProfile?.voice_note || ''}
Career graph summary: ${session.career_summary || ''}

Key graph nodes:
${session.graph_data?.nodes
  .filter((n: Node) => n.weight >= 2)
  .slice(0, 8)
  .map((n: Node) => `${n.label}: ${n.detail || ''}`)
  .join('\n')}`;

  const task_prompt = `Review this article draft. Identify the three most impactful improvements.

Focus on:
1. Voice accuracy — passages that feel generic or unlike their voice profile.
2. Specificity gaps — where graph data could make a vague claim concrete.
3. Structure — is the opening strong? Does it close on the premise?

Article:
${article_text}

Return ONLY valid JSON — no markdown, no backticks:
{
  "observations": [
    {
      "type": "voice|specificity|structure",
      "location": "first 8-10 words of the relevant passage",
      "issue": "what's weak here — one sentence",
      "suggestion": "specific improvement — may reference graph nodes"
    }
  ],
  "overall": "one sentence: what's strongest about this draft"
}`;

  const rawResult = await callClaudeRaw(`${system}\n\n${user_context}\n\n${task_prompt}`, 700);

  let result = { observations: [], overall: '' };
  try { result = JSON.parse(rawResult); } catch {}

  await db.query(`
    INSERT INTO copy_events (user_id, session_id, event_name, metadata)
    VALUES ($1, $2, 'article_review_requested', $3)
  `, [userId, session_id, JSON.stringify({ article_id })]);

  res.json(result);
});

// ── POST /articles/:id/publish ─────────────────────────────────────────────

router.post('/articles/:id/publish', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id, platform, published_url } = req.body;

  const article = await db.query(
    'SELECT * FROM articles WHERE id = $1 AND user_id = $2',
    [req.params.id, userId]
  );
  if (!article.rows[0]) return res.status(404).json({ error: 'Not found' });

  const a = article.rows[0];

  await db.query(`
    UPDATE articles
    SET status = 'published',
        published_content = current_content,
        published_at = NOW(),
        platform = $1,
        published_url = $2,
        updated_at = NOW()
    WHERE id = $3
  `, [platform, published_url, a.id]);

  const session = await validateSessionOwnership(session_id, userId);
  if (session) {
    const pubNode = {
      id: `pub_${Date.now()}`,
      type: 'publication',
      label: a.title?.slice(0, 35) || 'Article',
      detail: `Published ${platform} article. ${a.current_content?.slice(0, 100)}…`,
      year: new Date().getFullYear().toString(),
      weight: 2,
      url: published_url || null
    };

    const graph = session.graph_data;
    graph.nodes.push(pubNode);

    await db.query(`
      UPDATE career_sessions
      SET graph_data = $1,
          summary_version = summary_version + 1,
          updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify(graph), session_id]);
  }

  await db.query(`
    INSERT INTO copy_events (user_id, session_id, event_name, metadata)
    VALUES ($1, $2, 'article_published', $3)
  `, [userId, session_id, JSON.stringify({
    article_id: a.id, platform,
    word_count: a.word_count, edit_similarity: a.edit_similarity
  })]);

  res.json({ ok: true, word_count: a.word_count, edit_similarity: a.edit_similarity });
});

// ── POST /claude/chat-assist ───────────────────────────────────────────────

router.post('/claude/chat-assist', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { session_id, tab_type, current_text, messages, article_id } = req.body;

  const ALLOWED_TAB_TYPES = ['bio', 'summary', 'article'];
  if (!ALLOWED_TAB_TYPES.includes(tab_type)) {
    return res.status(400).json({ error: 'Invalid tab_type' });
  }

  const session = await validateSessionOwnership(session_id, userId);
  if (!session) return res.status(403).json({ error: 'Forbidden' });

  const voiceProfile = await getVoiceProfile(userId);
  const { system, contextBlock } = buildChatAssistPrompt(
    session, tab_type, current_text, voiceProfile, article_id
  );

  const messagesWithContext = injectContext(messages, contextBlock);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system,
    messages: messagesWithContext
  });

  const content = response.content[0]?.text || '';
  res.json({ content });
});

export default router;

declare function requireAuth(req: any, res: any, next: any): void;
declare function validateSessionOwnership(sessionId: string, userId: string): Promise<any>;
declare function detectStageProfile(graph: any): { stage: 'ic' | 'leader' | 'executive' };
declare function callClaude(prompt: any, maxTokens: number): Promise<string>;
declare function callClaudeRaw(prompt: string, maxTokens: number): Promise<string>;
declare function getVoiceProfile(userId: string): Promise<any>;
declare function logUsageEstimate(userId: string, sessionId: string, task: string, tokens: number): Promise<void>;
declare function logUsageActual(userId: string, sessionId: string, task: string): Promise<void>;
declare function calculateSimilarity(a: string, b: string): number;
declare const db: { query: (sql: string, params: any[]) => Promise<any> };
declare const anthropic: { messages: { create: (opts: any) => Promise<any> } };
