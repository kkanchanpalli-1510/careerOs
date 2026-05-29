// Pure function — reads DB, no writes, no Claude calls

import { AssemblerInput, PromptPackage, CareerGraph, Node } from './types';
import { buildCareerSummary } from './summary';
import { buildInsightPrompt } from './tasks/insightGeneration';
import { supabaseAdmin } from '../db/client';

const CEILINGS: Record<string, number> = {
  graph_extraction:          5000,
  insight_generation:         800,
  branch_generation:         1000,
  gap_enrichment:             500,
  final_synthesis:           1500,
  node_chat:                 1000,
  resume_projection:         1200,
  career_summary_generation:  600,
  career_chat:               1400,
};

function tokens(text: string) { return Math.ceil(text.length / 4); }

async function getSession(sessionId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from('career_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();
  return data;
}

async function getConversation(sessionId: string, nodeId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from('node_conversations')
    .select('*')
    .eq('session_id', sessionId)
    .eq('node_id', nodeId)
    .eq('user_id', userId)
    .single();
  return data;
}

function scoreNode(node: Node, keywords: string[]): number {
  const text = `${node.label} ${node.detail}`.toLowerCase();
  const hits = keywords.filter(kw => text.includes(kw)).length;
  return hits * 2 + node.weight;
}

function extractKeywords(text: string): string[] {
  const stop = new Set(['the','a','an','and','or','in','on','at','to','for','of',
    'with','by','is','are','was','were','be','have','has','this','that','you','we']);
  return [...new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !stop.has(w))
  )];
}

// ─── Entry point ─────────────────────────────────────────────

export async function assembleContext(input: AssemblerInput): Promise<PromptPackage> {
  if (!input.user_id) throw new Error('AssemblerError: user_id is required');

  switch (input.task) {
    case 'graph_extraction':          return assembleGraphExtraction(input);
    case 'insight_generation':        return assembleInsightGeneration(input);
    case 'branch_generation':         return assembleBranchGeneration(input);
    case 'gap_enrichment':            return assembleGapEnrichment(input);
    case 'final_synthesis':           return assembleFinalSynthesis(input);
    case 'node_chat':                 return assembleNodeChat(input);
    case 'resume_projection':         return assembleResumeProjection(input);
    case 'career_summary_generation': return assembleCareerSummaryGeneration(input);
    case 'career_chat':               return assembleCareerChat(input);
    default: throw new Error(`AssemblerError: unknown task ${(input as never as { task: string }).task}`);
  }
}

// ─── 1. graph_extraction ─────────────────────────────────────

async function assembleGraphExtraction(input: AssemblerInput): Promise<PromptPackage> {
  const { resume_text } = input.params as { resume_text: string };

  const system = `You are a career graph extraction engine. Output ONLY valid JSON — no markdown, no commentary.`;

  const task_prompt = `Extract a career graph from this resume. Return JSON matching:
{
  "nodes": [{ "id": "snake_case", "type": "role|skill|project|outcome|decision",
    "label": "2-4 words", "detail": "one sentence", "year": "YYYY or YYYY-YYYY or null",
    "weight": 1|2|3 }],
  "edges": [{ "source": "id", "target": "id",
    "relation": "USED|LED_TO|DEMONSTRATED|REQUIRED|INFLUENCED|BUILT_ON" }]
}
Weight: 3=career-defining (3-5 nodes), 2=important (6-10), 1=supporting.
Extract 15-25 nodes total.

Resume:
${resume_text}`;

  const est = tokens(task_prompt);
  return {
    system, user_context: '', task_prompt,
    estimated_tokens: est,
    cache_key: `graph_extraction:${input.user_id}`,
    metadata: { nodes_selected: 0, node_ids_selected: [], truncated: est > CEILINGS.graph_extraction, summary_version: 0 },
  };
}

// ─── 2. insight_generation ───────────────────────────────────

async function assembleInsightGeneration(input: AssemblerInput): Promise<PromptPackage> {
  const { session_id } = input.params as { session_id: string };
  const session = await getSession(session_id, input.user_id);
  if (!session) throw new Error('AssemblerError: session not found');

  const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };

  // weight-3 as primary signal, top 6 weight-2 as support — no weight-1
  const w3 = graph.nodes.filter(n => n.weight === 3);
  const w2 = graph.nodes.filter(n => n.weight === 2).slice(0, 6);
  const selected = [...w3, ...w2];
  const selectedIds = new Set(selected.map(n => n.id));

  const relevantEdges = graph.edges.filter(
    e => selectedIds.has(e.source) && selectedIds.has(e.target)
  );

  const pkg = buildInsightPrompt(selected, relevantEdges);

  return {
    ...pkg,
    estimated_tokens: Math.min(pkg.estimated_tokens, CEILINGS.insight_generation),
    cache_key: `insight:${session_id}:v${session.summary_version}`,
    metadata: { ...pkg.metadata, summary_version: session.summary_version ?? 0 },
  };
}

// ─── 3. branch_generation ────────────────────────────────────

async function assembleBranchGeneration(input: AssemblerInput): Promise<PromptPackage> {
  const { session_id } = input.params as { session_id: string };
  const session = await getSession(session_id, input.user_id);
  if (!session) throw new Error('AssemblerError: session not found');

  const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };
  const answers: string[] = session.answers ?? [];
  const strength = session.insights?.strength;

  // all nodes — label + type + weight only, NOT full detail
  const nodeText = graph.nodes
    .map(n => `${n.label} [${n.type}] w${n.weight}`)
    .join(', ');

  const system = `You are a career trajectory analyst. Surface non-obvious directions from rare node combinations — not the obvious next step.`;

  const user_context = [
    `Nodes: ${nodeText}`,
    strength?.identity_reframe ? `Identity: ${strength.identity_reframe}.` : '',
    strength?.insight ? `Core strength: ${strength.insight.split('.')[0]}.` : '',
    answers[0] ? `Q1 (initiative): ${answers[0]}` : '',
    answers[1] ? `Q2 (tacit expertise): ${answers[1]}` : '',
  ].filter(Boolean).join('\n');

  const task_prompt = `Generate exactly 3 career direction branches. Return ONLY valid JSON:
[{ "title": "2-4 words", "description": "one sentence — why it emerges from THEIR graph",
   "timeline": "6-18 months|1-2 years|2-3 years", "type": "immediate|emerging|nonobvious" }]
Branch 1: most reachable. Branch 2: energizing. Branch 3: the one they haven't considered.`;

  const est = tokens(system + user_context + task_prompt);
  return {
    system, user_context, task_prompt,
    estimated_tokens: Math.min(est, CEILINGS.branch_generation),
    cache_key: `branches:${session_id}:v${session.summary_version}`,
    metadata: { nodes_selected: graph.nodes.length, node_ids_selected: graph.nodes.map(n => n.id), truncated: est > CEILINGS.branch_generation, summary_version: session.summary_version ?? 0 },
  };
}

// ─── 4. gap_enrichment ───────────────────────────────────────

async function assembleGapEnrichment(input: AssemblerInput): Promise<PromptPackage> {
  const { session_id, question, answer, question_index } = input.params as {
    session_id: string; question: string; answer: string; question_index: number;
  };
  const session = await getSession(session_id, input.user_id);
  if (!session) throw new Error('AssemblerError: session not found');

  const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };
  const existingLabels = graph.nodes.map(n => n.label).join(', ');

  const BLIND_SPOTS = [
    'initiative pattern — self-directed action never on resumes',
    'tacit expertise — feels obvious to them, rare to others',
    'energy signal — which branches are actually reachable',
    'decision architecture — judgment quality',
  ];

  const system = `You are enriching a career graph. Extract new nodes from a user's answer. Return ONLY valid JSON — no commentary.`;

  const user_context = `Existing node labels (for deduplication): ${existingLabels}`;

  const task_prompt = `Question: "${question}"
Blind spot: ${BLIND_SPOTS[question_index] ?? BLIND_SPOTS[0]}
Answer: "${answer}"

Extract 1-2 new nodes. Return ONLY valid JSON:
{ "nodes": [{ "id": "snake_case", "type": "role|skill|project|outcome|decision",
  "label": "2-4 words", "detail": "one sentence", "year": null, "weight": 1|2|3 }],
  "edges": [{ "source": "new_id", "target": "existing_node_id",
    "relation": "USED|LED_TO|DEMONSTRATED|REQUIRED|INFLUENCED|BUILT_ON" }] }
If nothing new, return { "nodes": [], "edges": [] }.`;

  const est = tokens(system + user_context + task_prompt);
  return {
    system, user_context, task_prompt,
    estimated_tokens: Math.min(est, CEILINGS.gap_enrichment),
    cache_key: `enrich:${session_id}:q${question_index}`,
    metadata: { nodes_selected: 0, node_ids_selected: [], truncated: est > CEILINGS.gap_enrichment, summary_version: session.summary_version ?? 0 },
  };
}

// ─── 5. final_synthesis ──────────────────────────────────────

async function assembleFinalSynthesis(input: AssemblerInput): Promise<PromptPackage> {
  const { session_id, chosen_branch_index } = input.params as {
    session_id: string; chosen_branch_index: number;
  };
  const session = await getSession(session_id, input.user_id);
  if (!session) throw new Error('AssemblerError: session not found');

  const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };
  const answers: string[] = session.answers ?? [];
  const insights = session.insights ?? {};
  const branch = insights.branches?.[chosen_branch_index];

  const topNodes = graph.nodes
    .filter(n => n.weight >= 2)
    .map(n => `[${n.type}] ${n.label} (w${n.weight})${n.year ? ` ${n.year}` : ''}: ${n.detail}`)
    .join('\n');

  const system = `You are writing a career portrait. Celebrate first. Be specific and grounded — only in what you've been given. Sound like a brilliant friend who has studied their entire career.`;

  const user_context = [
    `Key career nodes:\n${topNodes}`,
    insights.strength?.identity_reframe ? `Identity: ${insights.strength.identity_reframe}.` : '',
    insights.strength?.insight ? `Core strength: ${insights.strength.insight}` : '',
    branch ? `Chosen direction: ${branch.title} — ${branch.description}` : '',
    answers.map((a, i) => a ? `Q${i + 1}: ${a}` : '').filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n\n');

  const task_prompt = `Write a career portrait. Return ONLY valid JSON:
{ "identity": "one sentence — who they are at their best professionally",
  "celebration": "2-3 sentences — what is genuinely impressive, grounded in specific nodes",
  "rare_factor": "one sentence — what makes this graph rare",
  "next_action": "one concrete action toward their chosen direction",
  "gap": "one honest gap — framed as opportunity, not deficit" }`;

  const topNodesList = graph.nodes.filter(n => n.weight >= 2);
  const est = tokens(system + user_context + task_prompt);
  return {
    system, user_context, task_prompt,
    estimated_tokens: Math.min(est, CEILINGS.final_synthesis),
    cache_key: `synthesis:${session_id}:b${chosen_branch_index}`,
    metadata: { nodes_selected: topNodesList.length, node_ids_selected: topNodesList.map(n => n.id), truncated: est > CEILINGS.final_synthesis, summary_version: session.summary_version ?? 0 },
  };
}

// ─── 6. node_chat ────────────────────────────────────────────

async function assembleNodeChat(input: AssemblerInput): Promise<PromptPackage> {
  const { session_id, node_id, user_message } = input.params as {
    session_id: string; node_id: string; user_message: string; conversation_turn: number;
  };
  const session = await getSession(session_id, input.user_id);
  if (!session) throw new Error('AssemblerError: session not found');

  const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };
  const careerSummary = buildCareerSummary(session);

  const node = graph.nodes.find(n => n.id === node_id);
  if (!node) throw new Error(`AssemblerError: node ${node_id} not found`);

  // direct neighbors — label + type only (1-hop)
  const connectedEdges = graph.edges.filter(e => e.source === node_id || e.target === node_id);
  const neighborIds = connectedEdges.map(e => e.source === node_id ? e.target : e.source);
  const neighbors = graph.nodes
    .filter(n => neighborIds.includes(n.id))
    .map(n => `${n.label} [${n.type}]`);

  // weight-3 anchors — label + 1-sentence detail
  const w3Anchors = graph.nodes
    .filter(n => n.weight === 3 && n.id !== node_id)
    .map(n => `${n.label}: ${n.detail}`);

  // windowed conversation history
  const conv = await getConversation(session_id, node_id, input.user_id);
  const messages: Array<{ role: string; content: string }> = conv?.messages ?? [];
  const WINDOW = 6;
  let historyText = '';
  if (messages.length > 0) {
    const fmt = (m: { role: string; content: string }) =>
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`;
    if (messages.length <= WINDOW) {
      historyText = messages.map(fmt).join('\n');
    } else {
      const recent = messages.slice(-WINDOW).map(fmt).join('\n');
      historyText = conv?.summary
        ? `[Earlier: ${conv.summary}]\n\n${recent}`
        : recent;
    }
  }

  const nodeContext = [
    `${node.label} [${node.type}] weight:${node.weight}`,
    `Detail: ${node.detail}`,
    node.year ? `Year: ${node.year}` : '',
    neighbors.length ? `Connected: ${neighbors.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const system = `You are a career intelligence assistant embedded in a node in the user's career graph. Be specific to this node, grounded in their graph. 2-4 sentences unless asked for more.`;

  const user_context = [
    `Career summary: ${careerSummary}`,
    w3Anchors.length ? `Defining nodes: ${w3Anchors.join(' | ')}` : '',
    `\nNode:\n${nodeContext}`,
    historyText ? `\nConversation:\n${historyText}` : '',
  ].filter(Boolean).join('\n');

  const est = tokens(system + user_context + user_message);
  return {
    system, user_context, task_prompt: user_message,
    estimated_tokens: Math.min(est, CEILINGS.node_chat),
    cache_key: `node_chat:${session_id}:${node_id}`,
    metadata: {
      nodes_selected: 1 + neighborIds.length + w3Anchors.length,
      node_ids_selected: [node_id, ...neighborIds],
      truncated: est > CEILINGS.node_chat,
      summary_version: session.summary_version ?? 0,
    },
  };
}

// ─── 7. resume_projection ────────────────────────────────────

async function assembleResumeProjection(input: AssemblerInput): Promise<PromptPackage> {
  const { session_id, job_description } = input.params as {
    session_id: string; job_description: string;
  };
  const session = await getSession(session_id, input.user_id);
  if (!session) throw new Error('AssemblerError: session not found');

  const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };
  const careerSummary = buildCareerSummary(session);
  const keywords = extractKeywords(job_description);

  const ranked = graph.nodes
    .map(n => ({ node: n, score: scoreNode(n, keywords) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const nodeText = ranked.map(({ node: n }) =>
    `[${n.type}] ${n.label}${n.year ? ` (${n.year})` : ''}: ${n.detail}`
  ).join('\n');

  const system = `You are a resume intelligence engine. Project this career graph onto a specific role — select relevant nodes, generate tailored bullets grounded in graph data, perform honest gap analysis.`;

  const user_context = `Career summary: ${careerSummary}\n\nMost relevant nodes:\n${nodeText}`;

  const task_prompt = `Job description:\n${job_description}\n\nReturn ONLY valid JSON:
{ "positioning_statement": "2-3 sentences — unique fit for this role, grounded in graph",
  "achievement_bullets": ["verb-led, quantified where graph has outcome data — 4-6 total"],
  "gap_analysis": {
    "strengths": ["2-3 clear strengths for this role"],
    "gaps": [{ "label": "gap name", "description": "one sentence", "question": "enrichment question to close it" }],
    "bridge": "one sentence — how to frame the gap positively"
  },
  "selected_node_ids": ["id1", "id2"] }`;

  const est = tokens(system + user_context + task_prompt);
  return {
    system, user_context, task_prompt,
    estimated_tokens: Math.min(est, CEILINGS.resume_projection),
    cache_key: `projection:${session_id}`,
    metadata: { nodes_selected: ranked.length, node_ids_selected: ranked.map(r => r.node.id), truncated: est > CEILINGS.resume_projection, summary_version: session.summary_version ?? 0 },
  };
}

// ─── 8. career_summary_generation ───────────────────────────

async function assembleCareerSummaryGeneration(input: AssemblerInput): Promise<PromptPackage> {
  const { session_id } = input.params as { session_id: string };
  const session = await getSession(session_id, input.user_id);
  if (!session) throw new Error('AssemblerError: session not found');

  const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };
  const answers: string[] = session.answers ?? [];
  const portrait = session.insights?.portrait;

  const w3 = graph.nodes
    .filter(n => n.weight === 3)
    .map(n => `${n.label}: ${n.detail}`)
    .join('\n');

  const system = `You are generating a compact behavioral pattern — a 1-2 sentence distillation of how this person operates, derived from their career-defining nodes and answers.`;

  const user_context = [
    `Defining nodes:\n${w3}`,
    portrait?.rare_factor ? `Rare factor: ${portrait.rare_factor}` : '',
    answers[0] ? `Initiative answer: ${answers[0]}` : '',
    answers[1] ? `Tacit expertise answer: ${answers[1]}` : '',
  ].filter(Boolean).join('\n');

  const task_prompt = `Write a 1-2 sentence behavioral pattern. Focus on HOW they operate, not what they've done. Example: "Identifies systemic gaps before anyone assigns them. Every major outcome preceded by an unrequested decision." Return only the pattern text.`;

  const w3List = graph.nodes.filter(n => n.weight === 3);
  const est = tokens(system + user_context + task_prompt);
  return {
    system, user_context, task_prompt,
    estimated_tokens: Math.min(est, CEILINGS.career_summary_generation),
    cache_key: `career_summary:${session_id}:v${session.summary_version}`,
    metadata: { nodes_selected: w3List.length, node_ids_selected: w3List.map(n => n.id), truncated: est > CEILINGS.career_summary_generation, summary_version: session.summary_version ?? 0 },
  };
}

// ─── 9. career_chat ──────────────────────────────────────────

async function assembleCareerChat(input: AssemblerInput): Promise<PromptPackage> {
  const { session_id, message, history = [] } = input.params as {
    session_id: string;
    message: string;
    history?: Array<{ role: string; content: string }>;
  };
  const session = await getSession(session_id, input.user_id);
  if (!session) throw new Error('AssemblerError: session not found');

  const careerSummary = buildCareerSummary(session);
  const graph: CareerGraph = session.graph_data ?? { nodes: [], edges: [] };

  // Defining nodes as grounding anchors
  const anchors = graph.nodes
    .filter(n => n.weight === 3)
    .slice(0, 8)
    .map(n => `${n.label} [${n.type}]: ${n.detail}`)
    .join('\n');

  const portrait  = session.insights?.portrait  as Record<string, string> | undefined;
  const strength  = session.insights?.strength  as { insight?: string } | undefined;
  const branches  = session.insights?.branches  as Array<Record<string, string>> | undefined;

  const insightContext = [
    strength?.insight  ? `Core strength: ${strength.insight}` : '',
    portrait?.identity ? `Career identity: ${portrait.identity}` : '',
    portrait?.next_action ? `Recommended next move: ${portrait.next_action}` : '',
    portrait?.rare_factor ? `What makes them rare: ${portrait.rare_factor}` : '',
    branches?.length
      ? `Career directions: ${branches.slice(0, 3).map(b => b.title ?? b.direction ?? '').filter(Boolean).join(' | ')}`
      : '',
  ].filter(Boolean).join('\n');

  // Windowed conversation history (last 8 turns)
  const recent = (history as Array<{ role: string; content: string }>).slice(-8);
  const historyText = recent.length
    ? recent.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')
    : '';

  const system = `You are a career intelligence assistant. The user has completed their career graph analysis. Answer their career questions with specificity — ground every answer in their actual graph data, portrait, and insights. Never give generic advice. Be direct, insightful, and concise (3-5 sentences unless more is clearly needed).`;

  const user_context = [
    `Career summary: ${careerSummary}`,
    anchors          ? `\nKey career nodes:\n${anchors}` : '',
    insightContext   ? `\nInsights:\n${insightContext}` : '',
    historyText      ? `\nConversation so far:\n${historyText}` : '',
  ].filter(Boolean).join('\n');

  const est = tokens(system + user_context + message);
  const w3List = graph.nodes.filter(n => n.weight === 3);
  return {
    system, user_context, task_prompt: message,
    estimated_tokens: Math.min(est, CEILINGS.career_chat),
    cache_key: `career_chat:${session_id}`,
    metadata: {
      nodes_selected: w3List.length,
      node_ids_selected: w3List.map(n => n.id),
      truncated: est > CEILINGS.career_chat,
      summary_version: session.summary_version ?? 0,
    },
  };
}
