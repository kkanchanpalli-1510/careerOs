// Mode 1 onboarding interview — doc 14.
// Generates one adaptive, graph-anchored question per dimension. Each question
// sees the graph plus every answer given so far, so Q2 and Q3 can follow the
// thread the previous answer opened.

import { PromptPackage, CareerGraph, Node } from '../types';
import { StageProfile } from '../summary';

export type InterviewDimension = 'energy' | 'rationale' | 'direction';

export const INTERVIEW_DIMENSIONS: InterviewDimension[] = [
  'energy', 'rationale', 'direction',
];

export interface InterviewAnswer {
  dimension: InterviewDimension;
  question:  string;
  why:       string;
  answer:    string;
  asked_at:  string;
}

const DIMENSION_BRIEF: Record<InterviewDimension, string> = {
  energy: `What work they actually like doing. Aim at a specific piece of work
in the graph and ask what made it different from the rest — the part of it that
absorbed them. You are trying to learn which work they would choose again.`,

  rationale: `Why they do what they do. Find a real choice visible in the graph
— a move between roles, a change of domain, a jump in scope — and ask what they
were optimizing for. You are trying to learn how they decide, not what they
decided.`,

  direction: `What matters to them next. Ask where they are trying to get to and
why that particular path matters — not the title, the reason behind wanting it.
You are trying to learn what they are optimizing their next decade for.`,
};

/** Roles ordered by time, used to spot transitions worth asking about. */
function roleTimeline(graph: CareerGraph): string {
  const roles = graph.nodes
    .filter(n => n.type === 'role' && !n.ghost)
    .sort((a, b) => parseStartYear(a.year) - parseStartYear(b.year));
  if (!roles.length) return '';
  return roles.map(r => `- ${r.label}${r.year ? ` (${r.year})` : ''}${r.detail ? `: ${r.detail}` : ''}`).join('\n');
}

function parseStartYear(year: string | null | undefined): number {
  if (!year) return 0;
  const m = year.match(/\d{4}/);
  return m ? parseInt(m[0], 10) : 0;
}

function parseEndYear(year: string | null | undefined): number {
  if (!year) return 0;
  if (/present/i.test(year)) return new Date().getFullYear();
  const all = year.match(/\d{4}/g);
  return all ? parseInt(all[all.length - 1], 10) : 0;
}

export function buildInterviewQuestionPrompt(
  dimension:   InterviewDimension,
  graph:       CareerGraph,
  stageProfile: StageProfile,
  previous:    InterviewAnswer[],
  coreStrength?: string,
): PromptPackage {

  const topNodes: Node[] = graph.nodes
    .filter(n => !n.ghost && n.weight >= 2)
    .sort((a, b) => (parseEndYear(b.year) - parseEndYear(a.year)) || (b.weight - a.weight))
    .slice(0, 18);

  const nodeLines = topNodes
    .map(n => `[${n.type}] ${n.label}${n.year ? ` (${n.year})` : ''}: ${n.detail || 'no detail given'}`)
    .join('\n');

  const system = `You are interviewing someone about their own career. You have
studied their graph closely and you are curious about the person, not the
resume.

What makes a question work here:
- It names something specific from their graph — a role, a project, a move,
  a year. A question that could have been asked of anyone has failed.
- It asks for a story or a decision. Never a rating, never a list, never
  "tell me more about X".
- It cannot be answered by reading their resume. If the resume already says it,
  you are asking the wrong thing.
- It is one question. Not two joined by "and".
- It is short. Two sentences at most, and the second is rarely needed.

Tone: a sharp person who has read everything and is genuinely curious about the
part that never made it onto the page. Not a form, not a coach, not flattery.
Never tell them their work was impressive or hard — you do not know that yet,
and that is what you are asking.`;

  const previousBlock = previous.length
    ? previous.map(p => `Q (${p.dimension}): ${p.question}\nThey said: ${p.answer}`).join('\n\n')
    : '';

  const timeline = roleTimeline(graph);

  const user_context = [
    `Career stage: ${stageProfile.stage}${stageProfile.isTransitioning ? ` (transitioning ${stageProfile.transitionDirection ?? ''})` : ''}`,
    timeline ? `Roles over time:\n${timeline}` : '',
    `Their graph — strongest nodes, most recent first:\n${nodeLines}`,
    coreStrength ? `Core strength we already identified: ${coreStrength}` : '',
    previousBlock ? `Earlier in this interview:\n${previousBlock}` : '',
  ].filter(Boolean).join('\n\n');

  const followUpRule = previous.length
    ? `\nThey have already told you something above. If their last answer opened
a thread worth pulling — a motive half-stated, a tension they skated past — pull
that thread instead of starting fresh. Referring back to what they just said is
the single strongest move available to you here.`
    : '';

  const task_prompt = `Ask question ${previous.length + 1} of 3.

This question is about: ${DIMENSION_BRIEF[dimension]}${followUpRule}

Return ONLY valid JSON:
{ "question": "the question — anchored in something specific from their graph",
  "why": "one sentence, addressed to them, on why this is worth answering. Plain and direct. Not a sales pitch." }`;

  return {
    system,
    user_context,
    task_prompt,
    estimated_tokens: 300,
    cache_key: `interview_q_${dimension}_${previous.length}`,
    metadata: {
      nodes_selected:    topNodes.length,
      node_ids_selected: topNodes.map(n => n.id),
      truncated:         false,
      summary_version:   0,
    },
  };
}
