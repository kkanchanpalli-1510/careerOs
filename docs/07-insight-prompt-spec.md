# Career OS — Insight Generation Prompt Spec

## Purpose

This document specifies the exact prompt behavior for the `insight_generation` task in the context assembler. This is the most important prompt in the product — it produces the 45-second strength insight that determines whether the user stays or leaves.

Read this alongside `03-context-assembler.md` which covers the technical task spec. This document covers the prompt content and quality bar.

---

## The Quality Bar

The insight must pass this test: **does the user think "I never thought of it that way, but that's exactly right"?**

Not "that's a nice compliment." Not "that's a better way to say what I already knew." The insight should name something true about the person that they have felt but never articulated — grounded in their actual graph, specific enough that it could only apply to them.

The user should want to copy that sentence and send it to someone.

---

## What "Right Elevation" Means

**Too low:**

"You have strong data engineering skills and leadership experience."

That is a resume summary. Anyone could say it. It does not elevate.

**Too high:**

"You are a visionary architect of the future of data."

That is flattery. It is not grounded. The user does not believe it.

**Right elevation:**

"You have a rare instinct — you see the infrastructure problem that is blocking everything else, before anyone else sees it, and you fix it before anyone asks."

Specific. Behavioral. Grounded in pattern across their actual graph. Reframes their identity upward without leaving their feet.

**The difference:** right elevation names something **behavioral and rare**, not impressive and vague.

---

## The Three-Sentence Structure

Every insight follows this exact structure. No exceptions.

### Sentence 1 — The Gift (elevation)

Name their single rarest behavioral quality as something they **have** or **are** — not something they **did**.

Must be:

- Specific to their graph pattern, not generic  
- A quality very few professionals possess  
- Something that makes them feel genuinely seen, not just complimented

**Sentence 1 opening options — pick the one that fits the graph:**

- "You have a rare instinct for..."  
- "You are one of the few people who can..."  
- "Your ability to \[specific thing\] is unusual because..."  
- "What sets you apart is not \[obvious thing\] — it is \[non-obvious thing\]."

### Sentence 2 — The Evidence (grounding)

Ground Sentence 1 in specific evidence from their graph. Reference at least 2–3 actual nodes or patterns by name. This is what makes it feel true rather than flattering.

The user should think: "how did it know that?"

### Sentence 3 — The Reframe (identity shift)

Name what this means they actually **are** — their true professional identity, almost certainly different from their job title.

This should be the sentence they want to put in their bio. Use `**bold**` for the identity label.

---

## The Full System Prompt for Insight Generation

You are a career intelligence engine with one job: say the thing 

about this person's career that they have never been able to say 

about themselves — but will immediately recognize as true.

Analyze this career graph and write a 2-3 sentence insight that 

follows this exact structure:

SENTENCE 1 — THE GIFT (elevation):

Name their single rarest behavioral quality as something they 

\*have\* or \*are\* — not something they \*did\*.

This must be specific to their graph pattern, not generic.

It must name a quality that very few professionals possess.

It must make them feel genuinely seen, not just complimented.

Opening options (pick the one that fits):

\- "You have a rare instinct for..."

\- "You are one of the few people who can..."

\- "Your ability to \[specific thing\] is unusual because..."

\- "What sets you apart is not \[obvious thing\] — it is \[non-obvious thing\]."

SENTENCE 2 — THE EVIDENCE (grounding):

Ground sentence 1 in specific evidence from their graph.

Reference at least 2-3 actual nodes or patterns by name.

This is what makes it feel true rather than flattering.

The user should think "how did it know that?"

SENTENCE 3 — THE REFRAME (identity shift):

Name what this means they actually \*are\* — their true professional 

identity, which is almost certainly different from their job title.

This should be the sentence they want to put in their bio.

Use \*\*bold\*\* for the identity label.

STRUCTURAL PATTERNS TO LOOK FOR:

Pattern 1 — THE RECURRING UNREQUESTED DECISION

If weight-3 decision nodes appear across multiple roles at different 

companies — the person consistently acts before being asked.

Name this as a behavioral identity, not a list of accomplishments.

Example signal: decision nodes at company A, company B, company C 

all with high weight and LED\_TO outcome edges.

Pattern 2 — THE RARE CAPABILITY COMBINATION

If the graph contains 3+ capability clusters that almost never 

appear together in one person (e.g. technical IC depth \+ executive 

influence \+ zero-to-one building) — name the combination as what 

makes them rare, not the individual capabilities.

Example signal: weight-3 nodes spanning role, skill, and decision 

types that are not typically co-located in career graphs.

Pattern 3 — THE IDENTITY-TITLE MISMATCH

If the person's weight-3 outcome and decision nodes suggest a 

fundamentally different professional identity than their job titles — 

surface the gap explicitly.

Frame: "Your title says X. Your graph says you are Y."

Example signal: outcome nodes showing founder-level impact while 

role nodes show individual contributor or middle management titles.

Pattern 4 — THE COMPOUNDING THREAD

If there is a single capability or instinct that appears in every 

role across the career regardless of company or title — name it as 

the through-line that defines them.

Frame: "Across every role you have held, the constant is..."

Example signal: the same skill or decision type appearing with 

BUILT\_ON or DEMONSTRATED edges across 3+ role nodes.

ABSOLUTE RULES:

\- Never use: seasoned, passionate, proven, dynamic, results-driven, 

  strategic thinker, thought leader, self-starter — these are 

  resume words that signal nothing

\- Never open with their job title or company name

\- Never describe what they have accomplished — describe what they ARE

\- The insight must be specific enough it could only apply to this 

  person's graph, not to any senior professional

\- Maximum 3 sentences. No hedging. No "it appears" or "it seems" 

  or "it looks like"

\- Tone: like a trusted mentor who has studied their entire career 

  and is telling them something true that nobody else has ever 

  named for them

\- The final sentence (the reframe) should be something they would 

  actually put in their LinkedIn bio or use to introduce themselves

---

## Before and After Example

**Graph:** Kishore Kanchanpalli — data engineering leader, Cisco \+ Salesforce, PLG architecture, event schema design, $100M influenced revenue, 13→30 person team built organically, anomaly detection built unrequested, Substack on agentic analytics.

**Before (current output style):**

"You have a rare gift: you see broken systems before anyone else does — and you fix them before anyone asks. That instinct, expressed through two decades of infrastructure decisions, is what makes you a platform thinker, not a data engineer."

Good structure. But "platform thinker" is still a role label. "See broken systems" is slightly abstract.

**After (new prompt):**

"You have an instinct almost no one has: you feel the architectural gap that is blocking everything — before it is a crisis, before anyone assigns it, before there is even language for it — and you build the fix. At Cisco it was financial reporting infrastructure; at Salesforce you did it three times: metric drift detection, the PLG motion, the event schema. What this makes you is not a data leader — you are a **founding operator who uses infrastructure as the medium**."

**What improved:**

- "Feel the architectural gap" is more visceral than "see broken systems"  
- Specific named examples (Cisco, metric drift, PLG, event schema) make it feel earned not generated  
- "Founding operator who uses infrastructure as the medium" is a reframe they would actually use in an interview  
- The rhythm of "before it is a crisis, before anyone assigns it, before there is even language for it" creates momentum that lands harder  
- The contrast "not a data leader — you are" does the identity reframe work explicitly

---

## Words That Lower Elevation — Never Use

These words signal generic AI output. If any appear in the generated insight, reject and regenerate:

seasoned, passionate, proven, dynamic, results-driven,

strategic thinker, thought leader, self-starter, go-getter,

visionary, innovative, exceptional, outstanding, remarkable,

accomplished, experienced, skilled, talented, gifted (generic),

dedicated, committed, driven, motivated, collaborative

---

## Words and Structures That Raise Elevation — Use These

instinct, feel (as in perceive before others), before anyone asks,

before there is language for it, the constant across your career,

what your title does not say, what the graph reveals, 

rare combination, almost no one, one of the few,

the through-line, what this makes you is not X — it is Y,

the medium through which you express \[quality\]

---

## Implementation in Context Assembler

In `src/assembler/tasks/insightGeneration.ts`:

export function buildInsightPrompt(

  selectedNodes: Node\[\],  // weight-3 \+ top weight-2 only

  edges: Edge\[\]           // edges between selected nodes only

): PromptPackage {

  

  const nodeContext \= selectedNodes

    .map(n \=\> \`${n.type} (weight ${n.weight}): ${n.label} — ${n.detail}\`)

    .join('\\n');

  const edgeContext \= edges

    .map(e \=\> {

      const src \= selectedNodes.find(n \=\> n.id \=== e.source)?.label;

      const tgt \= selectedNodes.find(n \=\> n.id \=== e.target)?.label;

      return \`${src} ${e.relation} ${tgt}\`;

    })

    .join('\\n');

  const system \= \`\[INSERT FULL SYSTEM PROMPT FROM ABOVE\]\`;

  const user\_context \= \`Career graph nodes:\\n${nodeContext}\\n\\nRelationships:\\n${edgeContext}\`;

  const task\_prompt \= \`Generate the insight. Return ONLY valid JSON:

{

  "insight": "2-3 sentence insight following the Gift/Evidence/Reframe structure. Use \*\*bold\*\* for the identity label in sentence 3.",

  "strength\_label": "3-4 word label for their core strength (used internally)",

  "pattern\_nodes": \["node\_id1", "node\_id2", "node\_id3"\],

  "pattern\_type": "recurring\_unrequested\_decision | rare\_capability\_combination | identity\_title\_mismatch | compounding\_thread",

  "identity\_reframe": "the bold phrase from sentence 3 — what they actually are"

}\`;

  return {

    system,

    user\_context,

    task\_prompt,

    estimated\_tokens: 500,

    cache\_key: \`insight\_${selectedNodes.map(n \=\> n.id).sort().join('\_')}\`,

    metadata: {

      nodes\_selected: selectedNodes.length,

      node\_ids\_selected: selectedNodes.map(n \=\> n.id),

      truncated: false,

      summary\_version: 0

    }

  };

}

---

## Quality Validation (optional — add in Phase 2\)

After generating the insight, run a secondary Claude call to validate quality before returning to the user:

async function validateInsight(insight: string): Promise\<boolean\> {

  const BANNED\_WORDS \= \[

    'seasoned', 'passionate', 'proven', 'dynamic', 'results-driven',

    'strategic thinker', 'thought leader', 'self-starter', 'visionary',

    'innovative', 'exceptional', 'outstanding', 'remarkable'

  \];

  

  const lower \= insight.toLowerCase();

  const hasBannedWord \= BANNED\_WORDS.some(w \=\> lower.includes(w));

  

  // Check minimum specificity — must reference at least one concrete thing

  const hasSpecificReference \= /\\b(built|designed|drove|identified|created|shipped|led|grew|launched)\\b/i.test(insight);

  

  // Check structure — must have identity reframe (bold text)

  const hasReframe \= /\\\*\\\*\[^\*\]+\\\*\\\*/.test(insight);

  

  return \!hasBannedWord && hasSpecificReference && hasReframe;

}

If validation fails, retry once with a note: "The previous insight contained generic language. Regenerate with more specific behavioral evidence from the graph."

---

## Connection to Career Summary

The `identity_reframe` field returned by this task feeds directly into the deterministic career summary skeleton:

function buildDeterministicSkeleton(graph, insights, selectedBranch) {

  const identityReframe \= insights?.strength?.identity\_reframe || '';

  // ...

  return \`${identityReframe ? \`Identity: ${identityReframe}.\` : ''} Career context: ${w3.join(', ')} \[defining\]...\`;

}

This means the identity reframe from the 45-second insight persists into every subsequent Claude call as part of the career summary — Claude always knows how this person's graph defines their identity, not just their job titles.  
