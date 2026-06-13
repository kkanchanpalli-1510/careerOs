# Career OS — Voice Profile System

## The Core Principle

> Mirror their character. Elevate their habits. Write like them on their best day.

Career OS is not a transcription service — it does not simply reflect back
what the user already wrote about themselves. It is a trusted editor: someone
who preserves everything that makes the person distinctly them, while quietly
lifting the parts that undersell them.

**Character** — the things that make this person's voice uniquely theirs.
Preserve these always. They are identity. Change them and the output no
longer sounds like the person.

**Habit** — patterns that exist not because the person chose them, but because
they never noticed them. Passive constructions. Hedging around genuine
achievements. Claiming credit indirectly. These are not character — they are
the residue of how people learned to write about themselves professionally.
Elevate these.

---

## The "Best Day" Standard

Every generated output targets this standard:

> Write like this person on their best day — the version that comes out
> when they're talking to a peer they respect, not performing for an
> audience they're trying to impress. Direct. Specific. Confident without
> being boastful. Owns the work without claiming more than happened.

This is the voice that emerges in a great interview with a trusted
interviewer. Career OS captures it and reproduces it consistently —
even on days when the person defaults back to hedging, passive,
resume-speak habits.

---

## Signal Sources — The Full Stack

Six sources feed the voice profile. All passive — the user never
configures anything. The profile builds as a side effect of using
the product.

| Source | Weight | When available | What it reveals |
|---|---|---|---|
| Resume text | 0.2 | Session start | Considered voice, vocabulary, ownership style |
| Onboarding Q1–Q4 | 0.4 | First session | Natural unguarded voice |
| Node chat messages | 0.2 | Ongoing | Conversational register, real-time vocabulary |
| Node label edits | 0.1 | Ongoing | Vocabulary preferences, framing choices |
| Output feedback | 0.05 | Ongoing | What doesn't feel like them |
| Regeneration behavior | 0.05 | Ongoing | Implicit signal — what missed, what landed |

Resume weight is lowest because it is the most curated, edited version
of how the person writes. Interview answers and node chat are less
edited and therefore higher signal. The resume gets you started.
Conversation gets you to truth.

---

## Resume Voice Extraction

### When It Runs

Parallel to graph extraction — same resume text, two simultaneous
Claude calls. Both complete before the resume text is discarded.
Privacy principle holds: the raw resume is never stored.

```typescript
// In graph_extraction route
const [graphResult, voiceResult] = await Promise.all([
  claude(buildGraphExtractionPrompt(resumeText), 4000),
  claude(buildResumeVoicePrompt(resumeText), 400)
]);

// Store both results
await storeGraph(sessionId, JSON.parse(graphResult));
await initVoiceProfile(userId, JSON.parse(voiceResult));

// Resume text discarded here — never stored
```

### The Resume Voice Prompt

Location: `src/assembler/tasks/voiceExtraction.ts`

```typescript
export function buildResumeVoicePrompt(resumeText: string): string {
  return `Analyze the writing style of this resume. Focus entirely on
HOW the person writes — not WHAT they did. Extract voice characteristics
that will help ghostwrite for this person.

Observe these signals:

OWNERSHIP STYLE
Does the person claim work directly ("I built", "I designed") or
deflect ("contributed to", "helped drive") or use passive
("was built", "were implemented")? Look for patterns — does the
style change based on whether the work was individual vs collective?

SENTENCE STRUCTURE
Do they write in bullet fragments or full sentences?
Fragments signal someone who thinks in deliverables.
Full sentences signal someone who thinks in narrative.

WHAT THEY LEAD WITH
Under each role, does the first bullet show scope ("Led 30-person team"),
output ("Built event schema architecture"), or impact ("$100M revenue")?
This ordering instinct is their natural prioritization.

ADJECTIVE DENSITY
High density: "Seasoned leader with proven track record of driving results"
Low density: "Built the event schema that replaced fragmented log pipelines"
These require completely different tones in generated outputs.

PRONOUN PRESENCE
Does "I" appear directly or is it avoided entirely?
Avoidance is often habitual self-effacement, not character.

SIGNATURE CONSTRUCTIONS
One or two phrases or patterns that feel distinctly like how this
person thinks. Specific constructions worth preserving in outputs.

Resume:
${resumeText}

Return ONLY valid JSON:
{
  "ownership_style": "direct|deflects|passive|mixed",
  "sentence_structure": "fragments|narrative|mixed",
  "leads_with": "scope|output|impact|mixed",
  "adjective_density": "high|medium|low",
  "pronoun_usage": "first_person|avoids_i|mixed",
  "signature_constructions": ["up to 2 phrases or patterns distinctly theirs"],
  "voice_note": "2 sentences: how to write like this person based on their resume alone",
  "confidence": 0.3
}

Confidence for resume-only signal is always 0.3 — it grows as more
signals arrive. Never set higher for resume alone.`;
}
```

---

## Gap Detection — Resume vs Natural Voice

The resume voice and interview voice are sometimes different.
This gap itself is a signal — and often the most valuable one.

Someone whose resume is passive and adjective-heavy but whose
interview answers are direct and specific is showing you:
**their resume was written to impress; their natural voice is direct.**

Generated outputs should match natural voice, not resume voice.
The resume voice represents how they thought they needed to present
themselves. The interview voice is who they actually are.

### Gap Detection Logic

```typescript
export function detectVoiceGap(
  resumeVoice: ResumeVoiceProfile,
  interviewVoice: InterviewVoiceProfile
): VoiceGap | null {

  const gaps: string[] = [];

  if (resumeVoice.ownership_style === 'passive' &&
      interviewVoice.ownership_style === 'direct') {
    gaps.push('Resume uses passive construction; natural voice is direct');
  }

  if (resumeVoice.adjective_density === 'high' &&
      interviewVoice.adjective_density === 'low') {
    gaps.push('Resume is adjective-heavy; natural voice lets work speak');
  }

  if (resumeVoice.pronoun_usage === 'avoids_i' &&
      interviewVoice.pronoun_usage === 'first_person') {
    gaps.push('Resume avoids "I"; natural voice owns work directly');
  }

  if (gaps.length === 0) return null;

  return {
    detected: true,
    resume_register: summarizeRegister(resumeVoice),
    natural_register: summarizeRegister(interviewVoice),
    gaps,
    gap_note: `Resume is more guarded than natural voice. ` +
      `Weight conversation signals over resume signals for tone.`,
    weighting: {
      resume: 0.1,    // reduce resume weight when gap is significant
      answers: 0.65,
      node_chat: 0.25
    }
  };
}
```

### Surfacing the Gap to the User

When a significant gap is detected, show a single gentle observation
after the first LinkedIn summary or short bio generates. Not a
correction — an insight.

```
┌─────────────────────────────────────────────────────────┐
│  ◆ Something we noticed                                 │
│                                                         │
│  Your resume reads more formally than the way you       │
│  naturally describe your work. The summary we generated │
│  reflects how you actually talk about what you've       │
│  built — direct, specific, without the hedging.         │
│                                                         │
│  If that feels more like you, your resume might be      │
│  underselling you in the same way.                      │
│                                                         │
│  [ Got it ]                                             │
└─────────────────────────────────────────────────────────┘
```

One observation. No call to action. Dismiss with one tap.
Show once, never repeat.

---

## Continuous Voice Refinement

The voice profile is never finished. Every interaction is a signal.

### Signal Processing Rules

**Minimum length:** Only process text samples > 50 words.
Short messages add noise, not signal.

**Async always:** Voice profile updates never block the user's
action. Always fire-and-forget. Always silent failure.

**Additive not replacement:** Each update adds observations to
the existing profile. The profile accumulates — it does not reset.

**Confidence gating:** Updates below 0.3 confidence are stored
but do not trigger regeneration or voice note rebuilds.

### Stream 1 — Written Answers (weight: 0.4)

Every answer the user types — onboarding questions, enrichment
follow-ups — goes through a voice observation pass after submission.

```typescript
// Runs async after any user text input > 50 words
export async function updateVoiceFromAnswer(
  userId: string,
  text: string,
  context: 'onboarding' | 'enrichment'
): Promise<void> {
  const existing = await getVoiceProfile(userId);

  const prompt = `You are refining a voice profile based on a new writing sample.

Existing profile:
${JSON.stringify(existing.character)}

New sample (context: ${context}):
"${text}"

Identify ONLY what is new or refined — do not repeat existing observations.
Return null if this sample adds nothing new to the picture.

Return JSON or null:
{
  "refinements": {
    "ownership_style": "update only if this sample changes the picture",
    "sentence_structure": "update only if pattern shifts",
    "new_signature_constructions": ["any new phrases distinctly theirs"],
    "habit_observed": "one habit to elevate if newly detected, or null",
    "character_note": "one sentence adding to character picture, or null"
  },
  "confidence": 0.0-1.0
}`;

  const result = await claude(prompt, 300);
  if (!result || result.confidence < 0.3) return;

  await mergeVoiceProfile(userId, result.refinements);
  await checkRebuildThreshold(userId);
}
```

### Stream 2 — Node Chat Messages (weight: 0.2)

Node chat is the most unguarded writing in the product — the user
is asking questions, not presenting themselves. This makes it high
signal for natural vocabulary and rhythm.

Process every node chat message > 50 words with the same
`updateVoiceFromAnswer()` function, context = 'node_chat'.

Throttle to once per 3 messages to avoid over-processing.

### Stream 3 — Node Label Edits (weight: 0.1)

When a user edits a node label, they reveal vocabulary preference.

```typescript
export async function observeNodeEdit(
  userId: string,
  original: string,
  edited: string
): Promise<void> {
  if (original === edited) return;
  if (edited.length < 3) return;

  await appendVoiceObservation(userId, {
    type: 'vocabulary_preference',
    rejected: original,
    preferred: edited,
    signal: inferVocabularySignal(original, edited)
  });
}

function inferVocabularySignal(original: string, edited: string): string {
  // More specific → they prefer precision over labels
  if (edited.split(' ').length > original.split(' ').length + 2) {
    return 'prefers_specificity';
  }
  // More action-oriented → they prefer verbs over nouns
  if (/^(built|drove|designed|led|created)/i.test(edited) &&
      !/^(built|drove|designed|led|created)/i.test(original)) {
    return 'prefers_action_verbs';
  }
  return 'vocabulary_shift';
}
```

### Stream 4 — Output Feedback (weight: 0.05)

Explicit feedback from the nudge UI and feedback buttons.

```typescript
// From copy_events table metadata
// feedback field: 'too_formal' | 'too_casual' | 'too_promotional' |
//                 'not_like_me' | 'accepted' | 'restored_previous'

export async function processFeedbackSignal(
  userId: string,
  taskType: string,
  signal: FeedbackSignal
): Promise<void> {

  const adjustment = FEEDBACK_ADJUSTMENTS[signal];
  if (!adjustment) return;

  await appendTaskAdjustment(userId, taskType, adjustment);

  // If 3+ same signals on same task → trigger voice note rebuild
  const count = await countFeedbackSignal(userId, taskType, signal);
  if (count >= 3) {
    await triggerVoiceNoteRebuild(userId, `systematic_feedback_${signal}`);
  }
}

const FEEDBACK_ADJUSTMENTS: Record<FeedbackSignal, string> = {
  too_formal: 'More conversational. Shorter sentences. Less elevated vocabulary.',
  too_casual: 'More considered. Longer sentences where appropriate.',
  too_promotional: 'Remove sales-copy patterns. Describe what exists, not what was eliminated.',
  not_like_me: 'Review character signals — something core to their voice was missed.',
  restored_previous: 'New version was worse than previous — do not change in this direction again.',
  accepted: '' // positive signal, no adjustment needed
};
```

---

## Character vs Habit — The Elevation Framework

### The Three Elevation Principles

These are the global rules that define where to lift vs where to preserve.
They apply to every generated output regardless of task type.

**Principle 1 — Elevate ownership, preserve collaboration**

When someone was the primary agent of an outcome, say so directly.
Do not add "personally" (qualifier). Do not change genuine "we" to "I"
(false individualism). Do not change individual "I" to "we" (false modesty).

Test: *Was this person the primary agent?*
Yes + hedging = elevate
Genuinely collective = preserve collective framing

**Principle 2 — Elevate specificity, preserve their vocabulary**

Replace vague claims with specific ones — but use their words,
not better-sounding synonyms.

"Drove results" → "built the event schema that unblocked $100M in PLG revenue"
NOT → "architected a transformational data platform"

The specificity is elevated. The vocabulary stays in their register.

Test: *Does the elevated version sound like them saying it more precisely,
or like someone else saying it impressively?*
Former = right. Latter = gone too far.

**Principle 3 — Elevate confidence, preserve genuine humility**

Remove hedging language around real achievements: "kind of," "sort of,"
"I think," "maybe," "hopefully." These don't belong in professional output.

But if someone genuinely shares credit, that shared credit stays.
Humility about collective work is character.
Uncertainty about individual work is habit.

Test: *Is this hedge about what happened (habit) or about who deserves credit (character)?*

### Detecting Character vs Habit

The same pattern can be character or habit depending on context.

```typescript
export function classifyPattern(
  pattern: string,
  voiceProfile: VoiceProfile
): 'character' | 'habit' {

  // Consistent across all contexts → character
  if (patternIsConsistent(pattern, voiceProfile)) return 'character';

  // Appears only around self-directed work → habit
  if (patternOnlyAroundSelfWork(pattern, voiceProfile)) return 'habit';

  // Appears in resume but not in natural speech → habit
  if (inResumeNotInSpeech(pattern, voiceProfile)) return 'habit';

  // Default: when uncertain, classify as character
  // Better to preserve than to over-elevate
  return 'character';
}
```

**When uncertain, preserve.** An output that sounds like a slightly
better version of them is always preferable to one that doesn't
sound like them at all.

---

## The Voice Profile Data Model

Stored at **user level** — not session level.
Voice is the person. It persists across all sessions.

```sql
CREATE TABLE voice_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,

  -- Character (preserve these)
  character JSONB DEFAULT '{}',
  -- {
  --   sentence_length: 'short|medium|long|mixed',
  --   leads_with: 'scope|output|impact|mixed',
  --   pronoun_usage: 'first_person|avoids_i|mixed',
  --   signature_constructions: [],
  --   collaboration_style: 'individual|collective|mixed'
  -- }

  -- Habits (elevate these)
  habits JSONB DEFAULT '{}',
  -- {
  --   ownership_pattern: 'direct|deflects|passive',
  --   adjective_density: 'high|medium|low',
  --   hedging_tendency: 'confident|moderate|cautious',
  --   observed_habits: ['list of specific habits to correct']
  -- }

  -- Gap detection
  gap JSONB DEFAULT '{}',
  -- {
  --   detected: boolean,
  --   resume_register: string,
  --   natural_register: string,
  --   gap_note: string,
  --   gap_surfaced: boolean,  -- was the observation shown to user?
  --   weighting: { resume, answers, node_chat }
  -- }

  -- Synthesized voice output
  voice_note TEXT,           -- "write like this person: ..."
  best_day_note TEXT,        -- "on their best day they sound like: ..."
  voice_note_version INTEGER DEFAULT 0,

  -- Task-specific adjustments (from feedback)
  task_adjustments JSONB DEFAULT '{}',
  -- { 'linkedin_summary': 'less formal', 'short_bio': '...' }

  -- Signal accumulation
  sample_count INTEGER DEFAULT 0,
  total_words_observed INTEGER DEFAULT 0,
  confidence FLOAT DEFAULT 0.0,

  -- Vocabulary observations
  vocabulary_preferred JSONB DEFAULT '[]',  -- phrases/words moved toward
  vocabulary_rejected JSONB DEFAULT '[]',   -- phrases/words moved away from

  -- Feedback history
  feedback_log JSONB DEFAULT '[]',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_voice_profiles_user ON voice_profiles(user_id);
```

---

## Voice Note Rebuild

Triggered when:
- Confidence crosses 0.4 (first meaningful rebuild)
- Confidence crosses 0.7 (high-fidelity rebuild)
- 10 new samples accumulated since last rebuild
- 3+ same feedback signals on a task type
- Significant gap detected between resume and natural voice

```typescript
export async function rebuildVoiceNote(userId: string): Promise<void> {
  const profile = await getVoiceProfile(userId);

  if (profile.sample_count < 3) return;
  if (profile.confidence < 0.4) return;

  const prompt = `You are writing instructions for a ghostwriter who will
write professional summaries, bios, and career narratives on behalf of
this person.

Your instructions must capture two things:
1. Their CHARACTER — what to preserve exactly as-is
2. Their HABITS — what to elevate to their best-day voice

Accumulated voice data:
Sample count: ${profile.sample_count}
Words observed: ${profile.total_words_observed}
Confidence: ${profile.confidence}

Character signals:
${JSON.stringify(profile.character)}

Habits to elevate:
${JSON.stringify(profile.habits)}

Gap detected: ${profile.gap?.detected || false}
${profile.gap?.gap_note || ''}

Vocabulary they prefer: ${profile.vocabulary_preferred?.join(', ')}
Vocabulary they avoid: ${profile.vocabulary_rejected?.join(', ')}

Task adjustments: ${JSON.stringify(profile.task_adjustments)}

Write two paragraphs:

VOICE NOTE (3-4 sentences):
How to write like this person. Their rhythm, sentence style,
vocabulary register, how they handle ownership of work.
Specific enough that a ghostwriter could match their voice.

BEST DAY NOTE (2-3 sentences):
How this person sounds when they're at their most articulate
and unguarded — talking to a peer they respect, not performing
for an audience. This is the target register for all outputs.
What habits to quietly correct to reach this standard.

Return JSON:
{
  "voice_note": "...",
  "best_day_note": "..."
}`;

  const result = await claude(prompt, 500);
  await updateVoiceNotes(userId, result.voice_note, result.best_day_note);
}
```

---

## Injecting Voice Into Generation Prompts

The voice note and best day note are appended to the career summary
that is already sent on every Claude call. No changes needed in
individual task files — it flows through `buildCareerSummary()`.

```typescript
export function buildCareerSummary(
  session: CareerSession,
  voiceProfile?: VoiceProfile
): string {

  const skeleton = buildDeterministicSkeleton(
    session.graph_data,
    session.insights,
    session.selected_branch,
    session.career_stage
  );

  const behavioral = session.behavioral_pattern || '';

  // Only inject voice when confidence is meaningful
  const voice = voiceProfile && voiceProfile.confidence >= 0.4
    ? buildVoiceContext(voiceProfile)
    : '';

  return [skeleton, behavioral, voice].filter(Boolean).join('\n');
}

function buildVoiceContext(profile: VoiceProfile): string {
  const lines = [];

  if (profile.voice_note) {
    lines.push(`Voice: ${profile.voice_note}`);
  }

  if (profile.best_day_note) {
    lines.push(`Best day standard: ${profile.best_day_note}`);
  }

  if (profile.task_adjustments && Object.keys(profile.task_adjustments).length) {
    lines.push(`Task adjustments: ${JSON.stringify(profile.task_adjustments)}`);
  }

  // Global elevation principles always appended
  lines.push(`Elevation rules:
    1. Elevate ownership, preserve collaboration —
       direct ownership when person was primary agent,
       collective framing when work was genuinely shared.
    2. Elevate specificity, preserve their vocabulary —
       use their words more precisely, not better-sounding synonyms.
    3. Elevate confidence, preserve genuine humility —
       remove hedging around real achievements,
       keep shared credit where it is accurate.`);

  return lines.join('\n');
}
```

---

## Output Version History and Refinement UX

### The Refinement Nudge

When a background refinement generates a new version, the user is
never silently overwritten. A subtle nudge appears next time they
open the portrait card.

```
┌─────────────────────────────────────────────────────────┐
│  LINKEDIN SUMMARY                                       │
│  ─────────────────────────────────────────────────      │
│  [current summary text]                                 │
│                                                         │
│  ✦ Refined since your last session  [See what changed]  │
└─────────────────────────────────────────────────────────┘
```

Clicking "See what changed" opens a before/after comparison:

```
┌──────────────────────────────────────────────────────┐
│  What changed                                        │
│  ──────────────────────────────────────────────      │
│  BEFORE                    AFTER                     │
│  I personally designed     I designed and shipped    │
│  No SQL. No bottleneck.    Product intelligence      │
│  Just intelligence…        without a data team…      │
│                                                      │
│  [ Keep current ]          [ Use refined version ]   │
└──────────────────────────────────────────────────────┘
```

### If User Ignores the Nudge

After 7 days with no interaction the nudge disappears.
Refined version preserved in history but not actively surfaced.
A small version history icon appears in the output panel header.

```
LinkedIn Summary  [↺ Regenerate]  [⋯ History]
```

### Copy Protection Rule

**Never auto-refine an output that has been copied.**
If the user copied a version it may already exist in the world —
on their LinkedIn profile, in an email, shared somewhere.
Silently replacing it would create inconsistency.

Instead: show the refinement nudge but note the copy status.

```
✦ Refined since you last copied this  [See what changed]
```

The user can still choose to update. But they are explicitly
informed that this version may already be in use somewhere.

### Version History

Every output maintains a full version stack with timestamps and reasons.

```typescript
interface OutputVersion {
  version: number;
  text: string;
  generated_at: Date;
  reason: 'initial' | 'regenerated' | 'voice_refined' | 'graph_enriched';
  voice_confidence_at_generation: number;
  was_copied: boolean;
  copied_at: Date | null;
}
```

The version history UI shows the full timeline:

```
Version History — LinkedIn Summary

● v3  3 days ago  Voice refined (confidence 0.72)
  "I designed and shipped an MCP telemetry plugin..."
  [ Use this version ]

○ v2  2 weeks ago  Graph enriched (+4 nodes)
  "I build the infrastructure layer that makes..."
  [ Use this version ]

○ v1  1 month ago  Initial generation
  "I personally designed and shipped..."          ← copied Jun 3
  [ Use this version ]
```

Any version is restorable at any time. The copy timestamp shows
which version is currently in use in the world.

---

## Auto-Refine Triggers

Background refinement runs when:

| Trigger | Targets refined | Reason |
|---|---|---|
| Voice confidence crosses 0.4 | linkedin_summary, short_bio | First personalized voice available |
| Voice confidence crosses 0.7 | linkedin_summary, short_bio, insight | High-fidelity voice available |
| 3+ new graph nodes added | linkedin_summary, short_bio, portrait | Career story has meaningfully changed |
| Node label edited | linkedin_summary, short_bio | Vocabulary preference signal |
| 3+ same feedback signals on task | That task only | Systematic miss detected |
| Gap detected (resume vs natural) | linkedin_summary, short_bio | Natural voice now known, was using resume voice |

### Auto-Refine Does Not Run When:
- Output was copied in the last 30 days (copy-protected)
- Output is less than 24 hours old (too recent)
- Voice confidence below 0.4 (not enough signal yet)
- User explicitly kept current version within last 7 days

---

## Confidence Progression

```
Resume parsed                → confidence 0.3  (seed)
Q1 answered (>50 words)      → confidence 0.38
Q2 answered (>50 words)      → confidence 0.45
Q3 answered (>50 words)      → confidence 0.51
Q4 answered (>50 words)      → confidence 0.57
                             → THRESHOLD: 0.4 crossed
                             → voice note built
                             → linkedin_summary, short_bio now use voice
5 node chat messages         → confidence 0.63
Node label edited ×2         → confidence 0.66
10 node chat messages        → confidence 0.71
                             → THRESHOLD: 0.7 crossed
                             → voice note rebuilt (high fidelity)
                             → refinement triggered for all outputs
Feedback: accepted ×3        → confidence 0.74 (positive reinforcement)
```

---

## New Files for Claude Code

```
New table: voice_profiles (user-level)
  — See schema above
  — Migration: 002_voice_profiles.sql (show before running)

New file: src/assembler/tasks/voiceExtraction.ts
  — buildResumeVoicePrompt()
  — updateVoiceFromAnswer()
  — observeNodeEdit()
  — processFeedbackSignal()

New file: src/lib/voiceProfile.ts
  — getVoiceProfile(userId)
  — initVoiceProfile(userId, resumeVoice)
  — mergeVoiceProfile(userId, refinements)
  — appendVoiceObservation(userId, observation)
  — appendTaskAdjustment(userId, taskType, adjustment)
  — checkRebuildThreshold(userId)
  — triggerVoiceNoteRebuild(userId, reason)
  — detectVoiceGap(resumeVoice, interviewVoice)
  — classifyPattern(pattern, voiceProfile)
  — triggerAutoRefine(userId, reason)

New file: src/lib/versionHistory.ts
  — getOutputVersions(userId, sessionId, outputType)
  — addOutputVersion(userId, sessionId, outputType, text, reason)
  — restoreVersion(userId, sessionId, outputType, versionNumber)
  — checkCopyProtection(userId, sessionId, outputType)
  — markOutputCopied(userId, sessionId, outputType)

Update: src/assembler/summary.ts
  — buildCareerSummary() accepts optional voiceProfile parameter
  — injects voice context when confidence >= 0.4
  — buildVoiceContext() helper

Update: src/routes/claude.ts (graph_extraction route only)
  — Run buildResumeVoicePrompt() in parallel with graph extraction
  — Call initVoiceProfile() before discarding resume text

Update: src/routes/events.ts (copy tracking route)
  — After logging copy event, call markOutputCopied()
  — This activates copy protection for that output

Update: src/routes/sessions.ts
  — After answer submission, call updateVoiceFromAnswer() async
  — After node edit save, call observeNodeEdit() async
```

---

## Message for Claude Code

```
Read career-os-docs/10-voice-profile.md.

The copy tracking, regenerate, LinkedIn summary, short bio,
and portrait card features from doc 09 are already built.

Now add the voice profile system. Build in this order:

1. Migration: 002_voice_profiles.sql
   Show me before running.

2. src/lib/voiceProfile.ts
   All the profile management functions.
   These are pure DB operations — no Claude calls.

3. src/lib/versionHistory.ts
   Version stack for linkedin_summary, short_bio, insight.
   Needed by auto-refine and copy protection.

4. src/assembler/tasks/voiceExtraction.ts
   buildResumeVoicePrompt() first — unit test with a sample resume.
   Then updateVoiceFromAnswer().
   Then observeNodeEdit() and processFeedbackSignal().

5. Update src/assembler/summary.ts
   buildCareerSummary() to accept and inject voiceProfile.
   Only inject when confidence >= 0.4.

6. Update src/routes/claude.ts
   graph_extraction route: run voice extraction in parallel.
   Promise.all — both calls, then discard resume text.

7. Update src/routes/events.ts
   copy event handler: call markOutputCopied() after logging.

8. Update src/routes/sessions.ts
   answer submission: call updateVoiceFromAnswer() async.
   node edit save: call observeNodeEdit() async.

Do not modify any existing assembler task files.
The voice injection flows through buildCareerSummary() — 
linkedin_summary and short_bio tasks pick it up automatically.

Show each migration before running.
All voice profile updates are async and fire-and-forget.
Never await a voice profile update in a request handler.
```
