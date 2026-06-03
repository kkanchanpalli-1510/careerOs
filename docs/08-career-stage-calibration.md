# Career OS — Career Stage Calibration Requirements

## Overview

The insight generation system must detect a user's career stage from their graph and calibrate the insight tone, language, and focus accordingly. One-size-fits-all insight prompts produce generic output. Stage-calibrated prompts produce the non-obvious, emotionally resonant insight that is the product's core value proposition.

This document specifies:
1. How to detect career stage from the graph
2. How insight tone and language varies by stage
3. How the four onboarding questions vary by stage
4. How to handle career transition edge cases
5. Where this logic lives in the codebase

---

## The Core Principle

**The unit of value changes by career level:**

- **Individual Contributor** — remarkable for what they *can do*. Rare technical capability, unusual skill combinations, the ability to produce what others cannot. Identity is their craft.
- **Manager / Director** — remarkable for the *leverage they create*. They multiply others, build systems that outlast them, translate between technical reality and organizational possibility.
- **VP / Executive** — remarkable for the *bets they make and the worlds they create*. They don't execute, they decide. They don't build systems, they build the conditions for systems to exist.

---

## Stage Detection

### Function: `detectCareerStage(graph: CareerGraph): 'ic' | 'leader' | 'executive'`

Location: `src/assembler/summary.ts`

```typescript
export type CareerStage = 'ic' | 'leader' | 'executive';

export function detectCareerStage(graph: CareerGraph): CareerStage {
  const roles = graph.nodes.filter(n => n.type === 'role');
  const outcomes = graph.nodes.filter(n => n.type === 'outcome');
  const decisions = graph.nodes.filter(n => n.type === 'decision');

  // ── EXECUTIVE SIGNALS ──
  const execTitles = [
    'chief', 'cxo', 'vp ', 'vice president', 'svp', 'evp',
    'president', 'partner', 'founder', 'ceo', 'cto', 'cdo',
    'coo', 'cpo', 'ciso', 'cro', 'general manager', 'gm',
    'managing director', 'head of', 'director'  // director+ = exec threshold
  ];

  const hasExecTitle = roles.some(n =>
    execTitles.some(t =>
      n.label.toLowerCase().includes(t) ||
      (n.detail?.toLowerCase().includes(t))
    )
  );

  // Board/C-suite exposure in outcomes
  const boardLevelOutcome = outcomes.some(n =>
    /(board|ceo|c-suite|c suite|executive team|quarterly business review|qbr)/i
      .test(n.detail || n.label || '')
  );

  // Large org in outcomes
  const leadsLargeOrg = outcomes.some(n =>
    /(\b[1-9]\d+\s*(person|people|engineer|employee|report|member|ic))/i
      .test(n.detail || n.label || '')
  );

  // High-weight decisions (3+ weight-3 decisions = executive judgment pattern)
  const highConvictionDecisions = decisions.filter(n => n.weight === 3).length >= 2;

  if (hasExecTitle || boardLevelOutcome) return 'executive';

  // ── LEADER SIGNALS ──
  const leadsTeam = outcomes.some(n =>
    /(team|org|report|hire|built.{0,20}team|grew.{0,20}team|manag)/i
      .test(n.detail || n.label || '')
  );

  const managerTitles = ['manager', 'lead ', 'principal', 'staff ', 'senior'];
  const hasManagerTitle = roles.some(n =>
    managerTitles.some(t => n.label.toLowerCase().includes(t))
  );

  if (leadsTeam || (hasManagerTitle && highConvictionDecisions)) return 'leader';

  return 'ic';
}
```

### Stage Detection Must Also Identify Transition Cases

```typescript
export interface StageProfile {
  stage: CareerStage;
  isTransitioning: boolean;
  transitionDirection: 'ic_to_leader' | 'leader_to_executive' | null;
  titleCapabilityGap: boolean; // title suggests lower level than outcomes show
}

export function detectStageProfile(graph: CareerGraph): StageProfile {
  const stage = detectCareerStage(graph);
  const roles = graph.nodes.filter(n => n.type === 'role');
  const outcomes = graph.nodes.filter(n => n.type === 'outcome');

  // Detect mismatch: IC title but leader-weight outcomes
  const titleStage = detectFromTitlesOnly(roles);
  const outcomeStage = detectFromOutcomesOnly(outcomes);
  const titleCapabilityGap = titleStage !== outcomeStage && outcomeStage > titleStage;

  // Detect recent promotion (most recent role is higher level than previous roles)
  const sortedRoles = roles
    .filter(n => n.year)
    .sort((a, b) => (b.year || '').localeCompare(a.year || ''));

  const recentStage = sortedRoles[0]
    ? detectCareerStage({ nodes: [sortedRoles[0]], edges: [] })
    : stage;
  const priorStage = sortedRoles[1]
    ? detectCareerStage({ nodes: [sortedRoles[1]], edges: [] })
    : stage;

  const isTransitioning = recentStage !== priorStage;
  const transitionDirection = isTransitioning
    ? (priorStage === 'ic' && recentStage === 'leader' ? 'ic_to_leader'
      : priorStage === 'leader' && recentStage === 'executive' ? 'leader_to_executive'
      : null)
    : null;

  return { stage, isTransitioning, transitionDirection, titleCapabilityGap };
}
```

---

## Insight Prompt Calibration

### Location: `src/assembler/tasks/insightGeneration.ts`

The `buildInsightPrompt()` function must accept a `StageProfile` and inject stage-specific instructions into the system prompt.

```typescript
export function buildInsightPrompt(
  selectedNodes: Node[],
  edges: Edge[],
  stageProfile: StageProfile
): PromptPackage {

  const stageInstructions = STAGE_INSTRUCTIONS[stageProfile.stage];
  const transitionNote = buildTransitionNote(stageProfile);

  const system = `${BASE_INSIGHT_SYSTEM_PROMPT}

${stageInstructions}

${transitionNote}`;

  // ... rest of prompt construction
}
```

### Stage Instruction Blocks

```typescript
const STAGE_INSTRUCTIONS: Record<CareerStage, string> = {

  ic: `CAREER STAGE: Individual Contributor

FOCUS: What this person builds, creates, and sees that others cannot.
The remarkable thing about them is CRAFT — rare technical capability,
unusual combinations of skills, the instinct to build the right thing.

TONE: Direct, energetic, specific. Short punchy sentences.
Celebrate depth and specificity. Use active verbs.

OPENS WITH: "You build..." / "You see..." / "You create..." /
"You have an instinct for..." / "Your ability to [specific thing]..."

VOCABULARY: build, create, solve, design, see, instinct, craft, depth,
rare combination, almost no one, specific capability

EVIDENCE: Ground in specific technical outputs, projects built,
problems solved in a way others couldn't

IDENTITY REFRAME: The craftsperson. The builder. The inventor.
Someone who produces things others cannot.

WHAT TO AVOID: Generic leadership language. "Strategic vision."
Anything that sounds like a performance review.`,

  leader: `CAREER STAGE: Manager / Director / Team Lead

FOCUS: The leverage this person creates in others and the systems
they build that outlast their direct involvement.
The remarkable thing is the FORCE MULTIPLIER — they make teams
better, translate between technical and organizational reality,
build capabilities that compound.

TONE: Measured, warm, specific about impact on others.
Medium sentence length. The hero is what they enabled,
not what they personally produced.

OPENS WITH: "You create conditions..." / "You multiply..." /
"What makes you rare is not what you build — it's what you
enable others to build." / "You have a gift for..."

VOCABULARY: enables, multiplies, builds teams, creates conditions,
translates, bridges, compounds, outlasts, leverage, force multiplier

EVIDENCE: Ground in team outcomes, capabilities built in others,
systems that continued after they moved on

IDENTITY REFRAME: The multiplier. The builder of builders.
Someone who creates leverage that outlasts their direct involvement.

WHAT TO AVOID: Focusing only on their individual technical output.
Ignoring the organizational impact. Using IC-level language
for someone who has clearly moved beyond individual execution.`,

  executive: `CAREER STAGE: VP / SVP / C-Suite / Executive / Founder

FOCUS: The bets they make and the worlds they create.
The remarkable thing is JUDGMENT — they see the strategic move
before it is obvious, have the conviction to make it, and
the credibility to move organizations toward it.

TONE: Deliberate, measured, elevated. Longer sentences that
carry weight. Not breathless. Not hushed reverence.
The tone of someone speaking to an equal who happens to
have a remarkable pattern in their history.

OPENS WITH: "You have the judgment to..." / "You possess a rare
quality of mind..." / "What distinguishes you is not..." /
"You are one of the few people who can..."

VOCABULARY: judgment, vision, conviction, bets, shapes, defines,
architecture, transformation, before it was obvious, moves
organizations, rare quality, consequential

EVIDENCE: Ground in strategic decisions made before they were
validated, organizational transformations led, the moments where
they had conviction without proof

IDENTITY REFRAME: The architect. The bet-maker. The world-builder.
Someone who creates the conditions in which great things become possible.

WHAT TO AVOID: Focusing on execution. Focusing on individual
technical output. Anything that sounds like IC or manager-level
achievement. Breathless admiration — executives respond to
peers, not fans.`,
};
```

### Transition Notes

```typescript
function buildTransitionNote(profile: StageProfile): string {
  if (!profile.isTransitioning && !profile.titleCapabilityGap) return '';

  if (profile.titleCapabilityGap) {
    return `IMPORTANT — TITLE/CAPABILITY GAP DETECTED:
This person's outcomes suggest they are operating ABOVE their current title.
Their capabilities and impact are at a higher level than their formal position.
Surface this gap explicitly as part of the identity reframe — they are
already operating at the next level, they just haven't been formally
recognized for it yet. This is often the most valuable insight Career OS
can deliver.`;
  }

  if (profile.transitionDirection === 'ic_to_leader') {
    return `IMPORTANT — RECENT TRANSITION: IC → LEADER
This person has recently moved from individual contributor to leading others.
They likely still think of themselves primarily as a builder/craftsperson.
The insight should honor their IC roots while helping them see that their
identity is expanding — they are now building people and systems, not just products.
This is an identity transition moment. Handle with care and specificity.`;
  }

  if (profile.transitionDirection === 'leader_to_executive') {
    return `IMPORTANT — RECENT TRANSITION: LEADER → EXECUTIVE
This person has recently crossed into executive-level scope and impact.
They may still describe themselves in manager/director terms.
The insight should reflect back the executive-level pattern already
visible in their graph — the strategic bets, the organizational impact,
the judgment calls — even if they haven't fully claimed that identity yet.`;
  }

  return '';
}
```

---

## Question Calibration by Stage

### Location: `src/assembler/tasks/gapEnrichment.ts` and frontend

The four onboarding questions must vary based on detected career stage. Universal Q1 stays the same. Q2–Q4 shift.

```typescript
export const STAGE_QUESTIONS: Record<CareerStage, Question[]> = {

  ic: [
    {
      num: "Question 1 of 4",
      text: "Tell me about something significant you built or changed that nobody asked you to.",
      why: "Resumes document assignments. This surfaces your initiative pattern — the decisions you made before anyone knew they needed to be made."
    },
    {
      num: "Question 2 of 4",
      text: "What's the hardest technical problem you've solved — not just technically hard, but one where you had to invent the approach because no playbook existed?",
      why: "This surfaces your deepest capability signal — the problems only you could solve in the way you solved them. It's the most differentiated thing about you."
    },
    {
      num: "Question 3 of 4",
      text: "Which parts of your work made you lose track of time — and which felt like a tax you paid to get to the interesting parts?",
      why: "This tells us which capabilities are growing edges and which are terminal — what you'll keep developing vs. executing out of obligation. It determines which directions are actually reachable for you."
    },
    {
      num: "Question 4 of 4",
      text: "What's something you understand about your technical domain that most people in your field don't — a mental model or pattern others seem to miss?",
      why: "This surfaces your rarest signal: the insight that only comes from deep craft. It's almost never on a resume and almost always at the heart of what makes you exceptional."
    }
  ],

  leader: [
    {
      num: "Question 1 of 4",
      text: "Tell me about something significant you built or changed that nobody asked you to.",
      why: "Resumes document assignments. This surfaces your initiative pattern — the decisions you made before anyone knew they needed to be made."
    },
    {
      num: "Question 2 of 4",
      text: "Tell me about something you built — a team, a capability, a system, a culture — that continued to create value after you moved on from it.",
      why: "This surfaces your multiplier signal — the things you built that outlasted your direct involvement. It's the clearest evidence of leverage, and it's almost never captured in a resume."
    },
    {
      num: "Question 3 of 4",
      text: "Which parts of your work in the last two years energized you — and which parts did you do because they needed to be done but someone else would probably love them?",
      why: "At your level, energy signal determines which direction is sustainable. Where you have energy, you create leverage. Where you don't, you just manage."
    },
    {
      num: "Question 4 of 4",
      text: "What's the hardest organizational decision you've made — not technically hard, but one where you had to choose between two things that both mattered?",
      why: "This surfaces your decision architecture — the values and judgment underneath your trajectory. It's the most revealing thing about how you operate under constraint."
    }
  ],

  executive: [
    {
      num: "Question 1 of 4",
      text: "Tell me about a bet you made — strategic, architectural, organizational — before you had proof it was right.",
      why: "Executive-level insight comes from the bets made before they were obvious. This is the highest-signal question for your career stage — it surfaces conviction and judgment, not just execution."
    },
    {
      num: "Question 2 of 4",
      text: "What do people come to you for that they don't go to anyone else in your organization — the judgment call, the framing, the read on a situation?",
      why: "This surfaces your rarest organizational capability — the thing you've become known for that exists nowhere in your job description. At your level, this is your true differentiation."
    },
    {
      num: "Question 3 of 4",
      text: "Looking at the last two years — where did you create the most organizational leverage, and where did you find yourself doing work that should have been delegated or eliminated?",
      why: "For executives, energy and leverage signal what your next role should look like. Where you create leverage without draining energy is where your highest-value future sits."
    },
    {
      num: "Question 4 of 4",
      text: "What's the decision you made in your career that most people wouldn't have made — and that you still believe was right even if it was costly?",
      why: "This is the decision that reveals your values, your risk tolerance, and the quality of your judgment under pressure. It's almost always the most defining moment in the career and almost never on the resume."
    }
  ]
};
```

---

## Deterministic Skeleton Update

The `buildDeterministicSkeleton()` function must include the detected stage in the career summary:

```typescript
export function buildDeterministicSkeleton(
  graph: CareerGraph,
  insights: SessionInsights,
  selectedBranch: number | null,
  stageProfile: StageProfile  // ADD THIS PARAMETER
): string {

  const stageLabel = {
    ic: 'Individual Contributor',
    leader: 'Leader / Manager',
    executive: 'Executive / VP+'
  }[stageProfile.stage];

  const transitionNote = stageProfile.isTransitioning
    ? ` (in transition: ${stageProfile.transitionDirection})`
    : '';

  const w3 = graph.nodes.filter(n => n.weight === 3).map(n => n.label);
  const w2 = graph.nodes.filter(n => n.weight === 2).map(n => n.label).slice(0, 4);
  const outcomes = graph.nodes.filter(n => n.type === 'outcome').map(n => n.label).slice(0, 3);
  const direction = selectedBranch !== null
    ? insights?.branches?.[selectedBranch]?.title : 'exploring';

  return [
    `Career stage: ${stageLabel}${transitionNote}.`,
    `Defining capabilities: ${w3.join(', ')}.`,
    w2.length ? `Supporting: ${w2.join(', ')}.` : '',
    direction ? `Direction: ${direction}.` : '',
    outcomes.length ? `Key outcomes: ${outcomes.join(', ')}.` : ''
  ].filter(Boolean).join(' ');
}
```

---

## Frontend Updates Required

### Question Display

The frontend must request the stage-appropriate questions from the backend rather than using the hardcoded `QUESTIONS` array.

Add endpoint: `GET /api/v1/sessions/:id/questions`

Returns the appropriate question set based on the session's detected career stage.

### Insight Display

The insight overlay / strength card does not need UI changes — the calibration is entirely prompt-side. The output will naturally vary in tone and language.

### Stage Indicator (optional, Phase 2)

Consider showing a subtle stage indicator in the graph stats bar:
```
Nodes: 18  |  Edges: 24  |  Stage: Executive
```
This gives the user transparency about how their career is being read, and creates a conversation starter ("I'm actually transitioning from IC to leader") that triggers a graph enrichment.

---

## Testing Requirements

Each stage should be tested with representative career profiles:

**IC test profile:** Software engineer, 5 years experience, strong technical outputs, no management.

**Leader test profile:** Engineering manager, 8 years, built teams of 5-15, clear people outcomes.

**Executive test profile:** VP or Director+, large org scope, board-level exposure, strategic decisions.

**Transition test profile:** Recent promotion from IC to manager — title says manager but skills/language still IC.

**Title gap test profile:** IC title but outcomes show leader-level impact (the "operating above their level" case).

For each profile, the insight should:
- Open with the appropriate vocabulary for that stage
- Reference evidence appropriate to that stage (craft vs. leverage vs. judgment)
- Produce an identity reframe that lands at the right level
- Not use vocabulary from a different stage

---

## Implementation Order

1. `detectCareerStage()` and `detectStageProfile()` in `src/assembler/summary.ts`
2. `STAGE_QUESTIONS` in `src/assembler/tasks/gapEnrichment.ts`
3. Update `buildInsightPrompt()` in `src/assembler/tasks/insightGeneration.ts` to accept and use `StageProfile`
4. Update `buildDeterministicSkeleton()` to include stage in career summary
5. Add `GET /sessions/:id/questions` endpoint in `src/routes/sessions.ts`
6. Update frontend to fetch questions from backend instead of hardcoded array
7. Test with five representative profiles (IC, leader, executive, IC→leader transition, title gap)
