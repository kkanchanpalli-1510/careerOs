/**
 * Unit tests for detectCareerStage() and detectStageProfile()
 * Run with:  npx ts-node src/assembler/__tests__/detectCareerStage.test.ts
 *
 * Five profiles from the spec:
 *  1. IC          — strong technical outputs, no management
 *  2. Leader      — engineering manager, team outcomes
 *  3. Executive   — VP title, board exposure
 *  4. Transition  — recent IC→leader move (title changed, recent role differs from prior)
 *  5. Title gap   — IC title but leader-level outcomes
 */

import assert from 'assert';
import { detectCareerStage, detectStageProfile } from '../summary';
import { CareerGraph, Node, Edge } from '../types';

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    const msg = e instanceof assert.AssertionError
      ? `expected ${JSON.stringify(e.expected)}  got ${JSON.stringify(e.actual)}`
      : String(e);
    console.error(`  ✗  ${name}`);
    console.error(`       ${msg}`);
    failed++;
  }
}

function suite(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// ── Node factory ─────────────────────────────────────────────────────────────

function role(
  id: string, label: string,
  detail = '', year: string | null = null, weight: 1 | 2 | 3 = 2,
): Node {
  return { id, type: 'role', label, detail, year, weight };
}

function outcome(id: string, label: string, detail = '', weight: 1 | 2 | 3 = 2): Node {
  return { id, type: 'outcome', label, detail, year: null, weight };
}

function decision(id: string, label: string, weight: 1 | 2 | 3 = 2): Node {
  return { id, type: 'decision', label, detail: '', year: null, weight };
}

function graph(nodes: Node[], edges: Edge[] = []): CareerGraph {
  return { nodes, edges };
}

// ── Profile 1: Individual Contributor ─────────────────────────────────────

const icGraph = graph([
  role('r1', 'Software Engineer', 'Built core authentication service at Stripe', '2022'),
  role('r2', 'Senior Software Engineer', 'Designed distributed rate-limiter used by 40+ teams', '2024'),
  outcome('o1', 'Shipped zero-downtime migration of 200M rows'),
  outcome('o2', 'Reduced p99 latency by 60% across payments pipeline'),
  decision('d1', 'Rewrote the caching layer despite pushback', 2),
]);

suite('Profile 1 — Individual Contributor', () => {
  test('detectCareerStage returns ic', () =>
    assert.strictEqual(detectCareerStage(icGraph), 'ic'));

  test('stage is ic', () =>
    assert.strictEqual(detectStageProfile(icGraph).stage, 'ic'));

  test('not transitioning', () =>
    assert.strictEqual(detectStageProfile(icGraph).isTransitioning, false));

  test('no title/capability gap', () =>
    assert.strictEqual(detectStageProfile(icGraph).titleCapabilityGap, false));

  test('transitionDirection is null', () =>
    assert.strictEqual(detectStageProfile(icGraph).transitionDirection, null));
});

// ── Profile 2: Leader / Engineering Manager ───────────────────────────────

const leaderGraph = graph([
  role('r1', 'Software Engineer', '', '2018'),
  role('r2', 'Engineering Manager', 'Managed platform team at Airbnb', '2022'),
  outcome('o1', 'Built team of 12 engineers from scratch'),
  outcome('o2', 'Grew org from 4 to 15 reports over 18 months'),
  decision('d1', 'Chose to hire senior ICs over promoting juniors', 3),
  decision('d2', 'Reorganized team structure despite exec resistance', 3),
]);

suite('Profile 2 — Leader / Engineering Manager', () => {
  test('detectCareerStage returns leader', () =>
    assert.strictEqual(detectCareerStage(leaderGraph), 'leader'));

  test('stage is leader', () =>
    assert.strictEqual(detectStageProfile(leaderGraph).stage, 'leader'));

  test('shows ic_to_leader transition (prior role was IC, recent is manager)', () => {
    // sortedRoles by year desc: [r2=EM(2022), r1=SWE(2018)]
    // recentStage = detectFromTitlesOnly([r2]) = 'leader'
    // priorStage  = detectFromTitlesOnly([r1]) = 'ic'
    // → isTransitioning=true, direction=ic_to_leader
    const p = detectStageProfile(leaderGraph);
    assert.strictEqual(p.isTransitioning, true);
    assert.strictEqual(p.transitionDirection, 'ic_to_leader');
  });

  test('no title/capability gap (title matches outcomes)', () =>
    assert.strictEqual(detectStageProfile(leaderGraph).titleCapabilityGap, false));
});

// ── Profile 3: Executive / VP ─────────────────────────────────────────────

const execGraph = graph([
  role('r1', 'Engineering Manager', '', '2018'),
  role('r2', 'VP of Engineering', 'Led 120-person org across three product lines', '2023'),
  outcome('o1', 'Presented roadmap to board of directors quarterly'),
  outcome('o2', 'Delivered $40M platform transformation on schedule'),
  decision('d1', 'Consolidated four teams into one platform org', 3),
  decision('d2', 'Killed legacy infrastructure a year before deadline', 3),
]);

suite('Profile 3 — Executive / VP', () => {
  test('detectCareerStage returns executive (VP title)', () =>
    assert.strictEqual(detectCareerStage(execGraph), 'executive'));

  test('stage is executive', () =>
    assert.strictEqual(detectStageProfile(execGraph).stage, 'executive'));

  test('is transitioning (leader→executive)', () => {
    const p = detectStageProfile(execGraph);
    assert.strictEqual(p.isTransitioning, true);
    assert.strictEqual(p.transitionDirection, 'leader_to_executive');
  });

  test('no title/capability gap', () =>
    assert.strictEqual(detectStageProfile(execGraph).titleCapabilityGap, false));
});

// ── Profile 4: IC → Leader Transition ─────────────────────────────────────
// Recent role: Engineering Manager (2024); prior role: Software Engineer (2021)
// The person just got promoted — thinking still IC, title now says manager.

const transitionGraph = graph([
  role('r1', 'Software Engineer', 'Backend systems at Notion', '2021'),
  role('r2', 'Engineering Manager', 'Leading a team of 6 backend engineers', '2024'),
  outcome('o1', 'Shipped three major product features as an IC'),
  // Clear team-management signal — matches the 'manag' branch of the regex
  outcome('o2', 'Managing six engineers through onboarding and their first performance cycles'),
  decision('d1', 'Took management role over higher-paying IC offer', 3),
]);

suite('Profile 4 — IC → Leader Transition', () => {
  test('detectCareerStage returns leader (team outcome present)', () =>
    assert.strictEqual(detectCareerStage(transitionGraph), 'leader'));

  test('stage is leader', () =>
    assert.strictEqual(detectStageProfile(transitionGraph).stage, 'leader'));

  test('is transitioning', () =>
    assert.strictEqual(detectStageProfile(transitionGraph).isTransitioning, true));

  test('transitionDirection is ic_to_leader', () =>
    assert.strictEqual(detectStageProfile(transitionGraph).transitionDirection, 'ic_to_leader'));

  test('no title/capability gap (title now reflects manager level)', () =>
    assert.strictEqual(detectStageProfile(transitionGraph).titleCapabilityGap, false));
});

// ── Profile 5: Title Gap (IC title, Leader outcomes) ──────────────────────
// IC job title but outcomes show team-level impact —
// the "operating above their level" case.

const titleGapGraph = graph([
  role('r1', 'Software Engineer', 'Individual contributor at fast-growing startup', '2021'),
  role('r2', 'Senior Software Engineer', 'Still technically IC despite scope', '2024'),
  // Outcomes clearly show leader-level work
  outcome('o1', 'Built and managed a team of 8 engineers informally'),
  outcome('o2', 'Hired three engineers; made all hiring decisions for the team'),
  outcome('o3', 'Ran all team standups, retros, and performance conversations'),
  decision('d1', 'Took on org responsibility without the title', 3),
]);

suite('Profile 5 — Title/Capability Gap', () => {
  test('detectCareerStage returns leader (outcome signals present)', () =>
    assert.strictEqual(detectCareerStage(titleGapGraph), 'leader'));

  test('stage is leader', () =>
    assert.strictEqual(detectStageProfile(titleGapGraph).stage, 'leader'));

  test('titleCapabilityGap is true', () =>
    assert.strictEqual(detectStageProfile(titleGapGraph).titleCapabilityGap, true));

  test('is not considered transitioning (no year-based role change)', () => {
    // Both roles are IC-titled; recentStage='ic' priorStage='ic' → no transition
    const p = detectStageProfile(titleGapGraph);
    assert.strictEqual(p.isTransitioning, false);
    assert.strictEqual(p.transitionDirection, null);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

suite('Edge cases', () => {
  test('empty graph returns ic', () =>
    assert.strictEqual(detectCareerStage(graph([])), 'ic'));

  test('director title (no space suffix needed) returns executive', () => {
    const g = graph([role('r1', 'Director of Product', 'Managed product strategy')]);
    assert.strictEqual(detectCareerStage(g), 'executive');
  });

  test('head of engineering returns executive', () => {
    const g = graph([role('r1', 'Head of Engineering', '')]);
    assert.strictEqual(detectCareerStage(g), 'executive');
  });

  test('founder returns executive', () => {
    const g = graph([role('r1', 'Co-Founder', 'Started the company')]);
    assert.strictEqual(detectCareerStage(g), 'executive');
  });

  test('board outcome alone promotes to executive', () => {
    const g = graph([
      role('r1', 'Software Engineer', ''),
      outcome('o1', 'Reported findings to the executive team and board'),
    ]);
    assert.strictEqual(detectCareerStage(g), 'executive');
  });

  test('manager title alone (no outcomes) returns ic — requires conviction decisions', () => {
    // manager title alone without outcomes OR high-conviction decisions stays ic
    const g = graph([role('r1', 'Engineering Manager', '')]);
    assert.strictEqual(detectCareerStage(g), 'ic');
  });

  test('manager title + 2 weight-3 decisions returns leader', () => {
    const g = graph([
      role('r1', 'Engineering Manager', ''),
      decision('d1', 'Hard call 1', 3),
      decision('d2', 'Hard call 2', 3),
    ]);
    assert.strictEqual(detectCareerStage(g), 'leader');
  });

  test('team outcome alone (no title) returns leader', () => {
    const g = graph([
      role('r1', 'Software Engineer', ''),
      outcome('o1', 'Built and grew team of 5 engineers from scratch'),
    ]);
    assert.strictEqual(detectCareerStage(g), 'leader');
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed + failed} tests   ${passed} passed   ${failed} failed`);
if (failed > 0) process.exit(1);
