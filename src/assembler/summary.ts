// Pure function — no I/O, no DB calls, no Claude calls

import { CareerGraph, Node, SessionInsights } from './types';

// ── CAREER STAGE DETECTION ──────────────────────────────────────────────────

export type CareerStage = 'ic' | 'leader' | 'executive';

export interface StageProfile {
  stage: CareerStage;
  isTransitioning: boolean;
  transitionDirection: 'ic_to_leader' | 'leader_to_executive' | null;
  titleCapabilityGap: boolean; // title suggests lower level than outcomes show
}

// Word-boundary regexes guard against substring false positives:
//   'gm'    ⊂ "paradigm" / "segment"  →  \bgm\b won't match
//   'cro'   ⊂ "micro" / "microservices" →  \bcro\b won't match
//   'board' ⊂ "onboarding"             →  \bboard\b won't match
//   'partner' ⊂ "partnership"          →  \bpartner\b won't match
//
// Note: 'senior' is intentionally absent — "Senior Software Engineer" is IC;
//   "Senior Manager" still matches via 'manager'.
const EXEC_TITLE_RE =
  /\b(chief|cxo|vp|vice president|svp|evp|president|partner|founder|ceo|cto|cdo|coo|cpo|ciso|cro|general manager|gm|managing director|head of|director)\b/i;

const MANAGER_TITLE_RE = /\b(manager|lead|principal|staff)\b/i;

const BOARD_OUTCOME_RE =
  /(\bboard\b|ceo|c-suite|c suite|executive team|quarterly business review|qbr)/i;

const TEAM_OUTCOME_RE =
  /(team|org|report|hire|built.{0,20}team|grew.{0,20}team|manag)/i;

const STAGE_ORDINAL: Record<CareerStage, number> = { ic: 0, leader: 1, executive: 2 };

function nodeText(node: Node): string {
  return node.label + ' ' + (node.detail ?? '');
}

/** Title-only stage — used for per-role transition comparisons. */
function detectFromTitlesOnly(roles: Node[]): CareerStage {
  if (roles.some(n => EXEC_TITLE_RE.test(nodeText(n)))) return 'executive';
  if (roles.some(n => MANAGER_TITLE_RE.test(nodeText(n)))) return 'leader';
  return 'ic';
}

/** Outcome-only stage — used for title/capability gap detection. */
function detectFromOutcomesOnly(outcomes: Node[]): CareerStage {
  if (outcomes.some(n => BOARD_OUTCOME_RE.test(nodeText(n)))) return 'executive';
  if (outcomes.some(n => TEAM_OUTCOME_RE.test(nodeText(n)))) return 'leader';
  return 'ic';
}

/**
 * Detect career stage from the full graph.
 * Executive signals override leader signals; both override IC default.
 */
export function detectCareerStage(graph: CareerGraph): CareerStage {
  const roles     = graph.nodes.filter(n => n.type === 'role');
  const outcomes  = graph.nodes.filter(n => n.type === 'outcome');
  const decisions = graph.nodes.filter(n => n.type === 'decision');

  // ── EXECUTIVE SIGNALS ──
  const hasExecTitle       = roles.some(n => EXEC_TITLE_RE.test(nodeText(n)));
  const boardLevelOutcome  = outcomes.some(n => BOARD_OUTCOME_RE.test(nodeText(n)));

  if (hasExecTitle || boardLevelOutcome) return 'executive';

  // ── LEADER SIGNALS ──
  const leadsTeam          = outcomes.some(n => TEAM_OUTCOME_RE.test(nodeText(n)));
  const hasManagerTitle    = roles.some(n => MANAGER_TITLE_RE.test(nodeText(n)));
  // Two weight-3 decisions is an executive-tier conviction pattern
  const highConvictionDecisions = decisions.filter(n => n.weight === 3).length >= 2;

  if (leadsTeam || (hasManagerTitle && highConvictionDecisions)) return 'leader';

  return 'ic';
}

/**
 * Richer stage profile: detects transitions and title/capability mismatches.
 *
 * Transition detection compares title-inferred stages of the two most recent
 * timed roles.  We use detectFromTitlesOnly (not the full detectCareerStage)
 * for single-role comparisons because a standalone role node lacks the outcome
 * and decision signals that would normally trigger 'leader' detection.
 */
export function detectStageProfile(graph: CareerGraph): StageProfile {
  const stage    = detectCareerStage(graph);
  const roles    = graph.nodes.filter(n => n.type === 'role');
  const outcomes = graph.nodes.filter(n => n.type === 'outcome');

  // Title vs. outcome gap ──────────────────────────────────────────────────
  const titleStage   = detectFromTitlesOnly(roles);
  const outcomeStage = detectFromOutcomesOnly(outcomes);
  const titleCapabilityGap =
    titleStage !== outcomeStage &&
    STAGE_ORDINAL[outcomeStage] > STAGE_ORDINAL[titleStage];

  // Transition detection ───────────────────────────────────────────────────
  const sortedRoles = roles
    .filter(n => n.year)
    .sort((a, b) => (b.year ?? '').localeCompare(a.year ?? ''));

  const recentStage = sortedRoles[0]
    ? detectFromTitlesOnly([sortedRoles[0]])
    : stage;
  const priorStage = sortedRoles[1]
    ? detectFromTitlesOnly([sortedRoles[1]])
    : stage;

  const isTransitioning = recentStage !== priorStage;
  const transitionDirection: StageProfile['transitionDirection'] = isTransitioning
    ? priorStage === 'ic'     && recentStage === 'leader'    ? 'ic_to_leader'
    : priorStage === 'leader' && recentStage === 'executive' ? 'leader_to_executive'
    : null
    : null;

  return { stage, isTransitioning, transitionDirection, titleCapabilityGap };
}

const STAGE_LABEL: Record<CareerStage, string> = {
  ic:        'Individual Contributor',
  leader:    'Leader / Manager',
  executive: 'Executive / VP+',
};

export function buildDeterministicSkeleton(
  graph: CareerGraph,
  insights: SessionInsights | null,
  selectedBranch: number | null,
  stageProfile?: StageProfile,
): string {
  const profile = stageProfile ?? detectStageProfile(graph);

  const stageLine = [
    `Career stage: ${STAGE_LABEL[profile.stage]}`,
    profile.isTransitioning && profile.transitionDirection
      ? ` (in transition: ${profile.transitionDirection})`
      : '',
    profile.titleCapabilityGap ? ' [operating above title]' : '',
  ].join('') + '.';

  const w3 = graph.nodes.filter(n => n.weight === 3).map(n => n.label);
  const w2 = graph.nodes.filter(n => n.weight === 2).map(n => n.label).slice(0, 4);
  const outcomes = graph.nodes.filter(n => n.type === 'outcome').map(n => n.label).slice(0, 3);

  const direction =
    selectedBranch !== null && insights?.branches?.[selectedBranch]
      ? insights.branches[selectedBranch].title
      : null;

  const identityReframe = insights?.strength?.identity_reframe ?? '';

  return [
    stageLine,
    identityReframe ? `Identity: ${identityReframe}.`               : '',
    w3.length       ? `Career context: ${w3.join(', ')} [defining].` : '',
    w2.length       ? `Supporting: ${w2.join(', ')}.`                : '',
    direction       ? `Direction: ${direction}.`                     : '',
    outcomes.length ? `Key outcomes: ${outcomes.join(', ')}.`        : '',
  ].filter(Boolean).join(' ');
}

export interface VoiceProfileSnippet {
  confidence: number;
  voice_note: string | null;
  best_day_note: string | null;
  task_adjustments: Record<string, string>;
}

export function buildCareerSummary(
  session: {
    graph_data: CareerGraph | null;
    insights: SessionInsights | null;
    selected_branch: number | null;
    behavioral_pattern: string | null;
  },
  voiceProfile?: VoiceProfileSnippet | null
): string {
  const graph = session.graph_data ?? { nodes: [], edges: [] };
  const stageProfile = detectStageProfile(graph);
  const skeleton = buildDeterministicSkeleton(graph, session.insights, session.selected_branch, stageProfile);
  const pattern = session.behavioral_pattern ?? '';
  const voice = voiceProfile && voiceProfile.confidence >= 0.4
    ? buildVoiceContext(voiceProfile)
    : '';
  return [skeleton, pattern, voice].filter(Boolean).join('\n');
}

function buildVoiceContext(profile: VoiceProfileSnippet): string {
  const lines: string[] = [];

  if (profile.voice_note)
    lines.push(`Voice: ${profile.voice_note}`);
  if (profile.best_day_note)
    lines.push(`Best day standard: ${profile.best_day_note}`);
  if (profile.task_adjustments && Object.keys(profile.task_adjustments).length)
    lines.push(`Task adjustments: ${JSON.stringify(profile.task_adjustments)}`);

  lines.push(`Elevation rules:
  1. Elevate ownership, preserve collaboration — direct ownership when person was primary agent, collective framing when genuinely shared.
  2. Elevate specificity, preserve their vocabulary — use their words more precisely, not better-sounding synonyms.
  3. Elevate confidence, preserve genuine humility — remove hedging around real achievements, keep shared credit where accurate.`);

  return lines.join('\n');
}
