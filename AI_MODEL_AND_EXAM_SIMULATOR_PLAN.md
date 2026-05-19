# AI Model Strategy, Evals, and Exam Simulator Direction

## Product Position

Solvd should not compete as a generic AI math tutor. The stronger position is:

> A calm math mastery engine that lowers cognitive load during learning, then pressure-tests students under realistic exam conditions.

The app needs two complementary modes:

- **Mastery mode:** slow, adaptive, low-pressure tutoring. The loop is fail fast, get corrected, understand, repeat.
- **Exam simulation mode:** timed, high-pressure practice that tests whether the student can perform under realistic paper conditions.

This combination is the product edge. Most AI tutors help students understand. Solvd should help students understand first, then prove they can perform.

## Current Model Usage

Known model usage in the current backend:

- Main tutoring chat: `claude-haiku-4-5-20251001`
- Paper extraction: `claude-haiku-4-5-20251001`
- Variant generation: `claude-haiku-4-5-20251001`
- Exam simulator generation: `claude-sonnet-4-6`
- Legacy browser API file: `src/api/llm.js` references `claude-haiku-4-5-20251001`, but does not appear to be used by the current main app flow.

Current frontend cost estimation uses:

- Input: `$0.80 / 1M tokens`
- Output: `$4.00 / 1M tokens`

This is no longer aligned with the current Haiku 4.5 pricing assumption used in product planning:

- Claude Haiku 4.5: about `$1 / 1M input`, `$5 / 1M output`
- Claude Sonnet-class models: materially more expensive and should be reserved for high-value paid workflows.

The current user-facing cost display should be removed from the UI. Internal cost tracking should remain, but it needs model-aware pricing before it is used for real margin decisions.

## Margin Problem

At a `$9/month` subscription, free users cannot be allowed to use Claude without strict limits. The product needs a model-routing strategy:

- Free users get useful tutoring, but through cheaper/free inference routes.
- Paid users get higher reliability and stronger models where quality matters.
- Expensive calls are reserved for moments that create visible product value.

Approximate cost per tutoring turn, assuming:

- `4,000` input tokens
- `700` output tokens

Estimated costs:

- Claude Haiku 4.5: about `$0.0075 / turn`
- Groq Qwen3 32B: about `$0.0016 / turn`
- Groq GPT OSS 120B: about `$0.0010 / turn`
- Groq Llama 3.1 8B: about `$0.00026 / turn`

Target average AI cost should be below `$1.00-$1.50/user/month` if the subscription is `$9/month`.

## Candidate Backend Model Routes

### Free Tier

Use cheaper inference by default:

- Main tutoring candidate: Cerebras or Groq `Qwen3 32B`
- Cheap fallback: Groq `GPT OSS 120B`
- Utility tasks: Groq `Llama 3.1 8B` or Gemini Flash-Lite style models
- Variant generation: Groq `Qwen3 32B` or `GPT OSS 120B`
- Paper extraction: limited monthly allowance
- Exam simulation: locked, heavily limited, or sample-only

Free tier should be generous enough to demonstrate value, but not unlimited.

### Paid Tier

Use stronger routes where quality matters:

- Main tutoring: Claude Haiku 4.5 until cheaper models pass evals
- Pattern analysis: Claude Haiku 4.5 or strong cheaper model after evals
- Exam simulation: Groq/Cerebras first, Claude/Sonnet only for higher tiers or limited premium runs
- Fallback: upgrade failed cheap-model responses to Claude only when needed

### Important Rule

Do not switch models based on price alone. A cheaper tutor that teaches badly will damage retention and trust. Model routing should be gated by evals.

## Prompt Versioning

Prompts should be versioned before serious prompt tuning.

Suggested fields to log per AI call:

- `prompt_version`
- `model`
- `provider`
- `context`
- `input_tokens`
- `output_tokens`
- `latency_ms`
- `user_id`
- `session_id`
- `quality_flag` or manual rating where available

Suggested prompt version names:

- `engine_foundation_v1`
- `engine_drills_v1`
- `engine_patterns_v1`
- `engine_traps_v1`
- `engine_pressure_v1`
- `engine_recall_v1`
- `extract_questions_v1`
- `exam_simulator_v1`

Prompt goals:

- Keep the current shorter response style.
- Restore the previous prompt's strength at helping users understand.
- Enforce brevity by structure, not by removing explanation quality.
- Prefer correction of the user's exact error over generic full-solution dumps.

## Evaluation Set

Build a small, hand-curated eval suite before changing provider or prompt behavior.

### Eval Categories

Create at least 90 eval cases:

1. **Explain this step** - 20 cases
   - User asks why a specific algebra/calculus/probability step works.
   - Model should explain the reason concisely, not restart the whole topic.

2. **Wrong student answer correction** - 20 cases
   - Student gives working with one clear error.
   - Model should identify the exact line or reasoning error.
   - Model should not assume the whole answer is wrong if the final answer is salvageable.

3. **Short correct answer acceptance** - 20 cases
   - Student gives a brief but correct answer.
   - Model should confirm correctness first.
   - Model may add compact supporting working, but should not penalize brevity.

4. **Trap questions** - 20 cases
   - Questions with domain restrictions, sign changes, extraneous roots, hidden conditions, probability wording traps, units, or notation traps.
   - Model should detect and teach the trap.

5. **Brevity control** - 10 cases
   - Prompt asks for help but the expected response should be short.
   - Model should avoid long lesson-style responses.

### Scoring Dimensions

Score each response from `1-5`:

- Mathematical correctness
- Step clarity
- Brevity
- Tone
- Does not reveal full solution too early
- Detects exact student error
- Handles short correct answers fairly
- Math notation quality

Suggested pass threshold:

- Average score: `>= 4.2`
- Correctness: `>= 4.5`
- Exact-error detection: `>= 4.0`
- Brevity: `>= 4.0`

Any candidate free/cheap model must beat this threshold before replacing Claude for a workflow.

## Eval Output Format

Each eval case should include:

```json
{
  "id": "wrong_answer_001",
  "topic": "Quadratic Functions",
  "sub_type": "Completing the Square",
  "layer": "drills",
  "system_prompt_version": "engine_drills_v1",
  "conversation": [
    {
      "role": "assistant",
      "content": "Question..."
    },
    {
      "role": "user",
      "content": "Student working..."
    }
  ],
  "expected_behavior": [
    "Identify the sign error in line 2",
    "Confirm what part of the method is correct",
    "Give a corrected next step",
    "Do not provide a long topic overview"
  ],
  "rubric": {
    "correctness": 5,
    "brevity": 4,
    "exact_error_detection": 5
  }
}
```

## Exam Simulator Direction

The current simulator mostly reproduces a paper. That is not enough.

The simulator should become a realistic performance environment:

- Timed conditions
- Realistic complexity
- Realistic traps
- One attempt flow
- Student answer capture
- Post-exam analysis
- Performance pressure distinct from mastery mode

### Product Difference

Mastery mode teaches slowly:

- Adaptive pace
- Immediate correction
- Repetition
- Conceptual understanding
- Low cognitive load

Exam simulation tests performance:

- Timer
- No hints during the attempt
- Question navigation
- Mark allocation
- Attempt state
- Post-exam correction only after submission
- Pressure, stamina, and decision-making

This distinction should be explicit in the product architecture.

## Exam Simulator MVP

The next simulator version should include:

1. **Timed attempt mode**
   - Start exam button.
   - Timer visible but visually quiet.
   - Time can be based on extracted paper metadata or generated simulator metadata.

2. **Answer capture**
   - Text area per question or per part.
   - Optional image upload later for handwritten work.
   - Autosave locally and/or to Supabase.

3. **Question navigation**
   - Collapsible side rail on desktop.
   - Bottom drawer or compact overview on mobile.
   - Shows attempted, unanswered, flagged.

4. **Collapsible progress rail**
   - Desktop only by default.
   - Collapsible to protect the aesthetic.
   - Shows paper progress without turning the UI into a dashboard.

5. **Submit exam**
   - Locks the attempt.
   - Sends answers for marking/feedback.
   - Produces a post-exam report.

6. **Post-exam report**
   - Score estimate
   - Topic weaknesses
   - Trap failures
   - Time pressure indicators
   - Recommended return path into mastery mode

## Collapsible Progress Rail

A side rail can help in the simulator because the simulator is not the same as the calm tutoring interface.

It should not be a permanent app navigation rail.

Good rail content:

- Timer
- Question list
- Attempted/unanswered/flagged state
- Marks per question
- Collapse button

Bad rail content:

- General app nav
- Decorative cards
- Long explanations
- Marketing copy

Desktop layout:

```text
┌───────────────────────────────┬───────────────┐
│ Exam question and answer area  │ Progress rail │
│                               │ Timer         │
│ Q1                            │ Q1 answered   │
│ Answer box                    │ Q2 flagged    │
│                               │ Q3 empty      │
└───────────────────────────────┴───────────────┘
```

Collapsed layout:

```text
┌──────────────────────────────────────┬───┐
│ Exam question and answer area         │ 5 │
│                                      │ / │
│                                      │ 8 │
└──────────────────────────────────────┴───┘
```

Mobile layout:

```text
Question 3 of 8        01:12:04
───────────────────────────────
Question content

Answer
┌───────────────────────────────┐
│                               │
└───────────────────────────────┘

[Flag]             [Overview]
```

## Simulator Data Model Ideas

Possible tables:

- `exam_simulations`
  - `id`
  - `user_id`
  - `source`
  - `paper_ids`
  - `title`
  - `time_minutes`
  - `total_marks`
  - `status`
  - `started_at`
  - `submitted_at`

- `exam_simulation_questions`
  - `id`
  - `simulation_id`
  - `number`
  - `raw_text`
  - `topic`
  - `sub_type`
  - `marks`
  - `trap_tags`

- `exam_attempt_answers`
  - `id`
  - `simulation_id`
  - `question_id`
  - `answer_text`
  - `flagged`
  - `answered_at`
  - `score_estimate`
  - `feedback`
  - `error_type`

## Strategic Recommendation

Do the work in this order:

1. Remove user-facing cost display.
2. Add model-aware internal cost tracking.
3. Add prompt version logging.
4. Build eval set.
5. Test Groq/Cerebras candidates against Claude baseline.
6. Route free users to cheaper models only after eval pass.
7. Rebuild exam simulator as timed attempt mode.
8. Add collapsible progress rail only inside simulator.

This keeps the core app calm while giving the simulator a separate performance-training identity.
