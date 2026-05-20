# Curriculum Intelligence and Paper Contribution Plan

## Product Idea

Solvd currently depends on each student uploading their own past papers, tutorial sheets, quiz papers, and class tests. This is powerful, but it creates a cold-start problem:

- Students with good paper access get high-context prep.
- Students without papers may not get the full value.

The opportunity is to build a **curriculum intelligence layer** from contributed papers.

Students who have papers can opt in to contribute them. In return, they can receive premium tokens or temporary premium access. Solvd can then use reviewed contributions to build curriculum-aware prep for students who do not have their own materials.

This must be designed as a consented, gated, reviewed contribution system, not casual file sharing.

## Strategic Position

The feature should not be framed as:

> Share papers with other students.

The safer and stronger framing is:

> Contribute papers to help Solvd learn curriculum patterns and generate aligned practice.

The value is not a public file library. The value is:

- Topic frequency
- Subtopic maps
- Mark allocation patterns
- Common traps
- Paper structure
- Generated practice questions
- Realistic exam simulations
- Curriculum confidence scoring

This becomes a moat because Solvd can eventually understand specific courses, exam boards, schools, and curricula.

## Trust Boundary

Private uploads and contributed uploads must be clearly separate.

Default behavior:

- A paper uploaded into a user's private vault is private.
- It is used only for that user's account and sessions.
- It is not added to shared curriculum intelligence by default.

Contribution behavior:

- The user explicitly opts in.
- The user sees what will happen to the paper.
- The user receives a reward only after review and approval.
- The raw paper is not automatically shown to other users.

## Consent Copy Draft

Suggested upload choice:

```text
How should Solvd use this paper?

( ) Private vault only
    Only you can study from this paper.

( ) Contribute to curriculum intelligence
    Solvd may extract topics, patterns, traps, paper structure,
    and practice signals from this paper to improve preparation
    for students in the same curriculum.

    Raw files are not automatically published to other students.
    Contributions are reviewed before rewards are issued.
```

Suggested reward copy:

```text
Reward after review:
+ premium tokens or temporary premium access
```

## Legal and Policy Risk

Past papers, tutorial sheets, quiz papers, and class tests may be copyrighted or institution-owned.

Solvd should avoid becoming a repository where students upload and redistribute raw copyrighted documents.

Safer product behavior:

- Extract educational metadata and patterns.
- Generate new aligned practice.
- Store raw files privately or for internal review only.
- Do not let users browse/download contributed raw papers unless rights are clear.

Before public launch of this feature, Solvd needs:

- Terms of service language for contributed materials.
- Contributor representation that they have the right to upload or permission to contribute.
- Copyright takedown process.
- Privacy policy updates.
- Admin review flow.
- Clear distinction between private and contributed uploads.

This document is not legal advice. It is a product risk map.

## Contribution Review Pipeline

Rewards should not be instant. Otherwise the system will attract spam, duplicates, low-quality scans, and materials the contributor should not have uploaded.

Recommended pipeline:

```text
Uploaded as contribution
-> queued for review
-> duplicate check
-> extraction quality check
-> metadata classification
-> copyright/sensitivity review
-> approve or reject
-> issue reward if approved
-> add extracted signals to curriculum intelligence
```

## Reward Rules

Reward should depend on usefulness, not just upload count.

Example reward tiers:

```text
Verified past exam paper
High reward

Clean tutorial sheet
Medium reward

Quiz/class test
Low to medium reward

Duplicate
No reward

Unreadable/low-quality file
No reward

Irrelevant or prohibited upload
No reward and possible account flag
```

Possible rewards:

- Premium tokens
- Temporary premium access
- Extra exam simulations
- Extra paper uploads
- Early access to curriculum packs

Avoid unlimited lifetime rewards until abuse controls are mature.

## Curriculum Intelligence Data Shape

Think in terms of a structured curriculum graph:

```text
Curriculum / exam board / institution
-> course
-> paper type
-> year / term
-> topic
-> subtopic
-> question format
-> marks
-> trap tags
-> frequency
-> generated practice templates
```

Possible entities:

- `curricula`
- `courses`
- `curriculum_sources`
- `contributed_documents`
- `contribution_reviews`
- `curriculum_topics`
- `curriculum_subtopics`
- `curriculum_patterns`
- `curriculum_traps`
- `contribution_rewards`

## Confidence Gating

The premium curriculum intelligence feature should only be available where Solvd has enough reliable data.

Example:

```text
MATH1110
Confidence: High
4 past exams
3 tutorial sheets
2 quizzes
Exam simulator enabled
Pattern report enabled

CALC102
Confidence: Low
1 paper
Simulator locked
Needs more contributions
```

Confidence factors:

- Number of unique papers
- Number of past exam papers
- Coverage across years/terms
- Extraction quality
- Mark allocation completeness
- Topic breadth
- Duplicate rate
- Admin review status

## Premium Feature Gating

The strongest curriculum intelligence should be a high-tier feature.

Suggested access:

```text
Free
- Own uploads only
- Limited public curriculum preview where available

Student
- Own uploads
- Basic pattern support
- Limited curriculum-aware practice where confidence is high

Premium / Exam+
- Verified curriculum packs
- Curriculum-aware simulator
- Pattern reports from shared corpus
- High-confidence course intelligence
```

## User Experience

Contribution should feel like an optional, trustworthy exchange:

```text
Contribute Paper
────────────────────────────────
Help build better prep for your curriculum.

Your paper will be reviewed before it improves
shared curriculum intelligence.

Reward after approval:
+ 50 premium tokens

[Upload contribution]
```

After upload:

```text
Contribution submitted
────────────────────────────────
Status: Under review

We will check:
- Duplicate status
- Readability
- Curriculum match
- Extraction quality

Reward is issued after approval.
```

## Admin Review Needs

Admin interface should eventually support:

- See submitted document metadata.
- Open private file preview.
- See extracted questions/topics.
- Mark duplicate.
- Mark low quality.
- Approve/reject contribution.
- Assign curriculum/course.
- Issue reward.
- Hide or delete problematic uploads.

## Abuse Risks

Likely abuse cases:

- Re-uploading the same paper repeatedly.
- Uploading random PDFs for rewards.
- Uploading textbooks or copyrighted books.
- Uploading personal student information.
- Uploading answer memos instead of papers.
- Uploading poor screenshots.
- Uploading files from unrelated curricula.

Mitigations:

- Duplicate hashing.
- OCR/extraction quality scoring.
- Manual review before reward.
- Reward caps per user/time period.
- File type and size restrictions.
- Account-level contribution reputation.
- Takedown process.

## Relationship to Exam Simulator

Curriculum intelligence directly improves the simulator.

Without shared corpus:

- Simulator can only use a student's own uploads.

With reviewed shared corpus:

- Simulator can generate better paper structure.
- Simulator can include common traps.
- Simulator can reflect mark weighting.
- Simulator can serve students who do not have enough papers.

This makes the future premium promise stronger:

> Practice under realistic exam pressure, using patterns learned from your exact curriculum.

## Recommended Sequence

Do not build public paper contribution before the simulator foundation is stronger.

Recommended order:

1. Finish exam simulator attempt mode.
2. Add answer capture and post-exam report.
3. Add internal model/prompt evals.
4. Add model-aware cost logging.
5. Design contribution tables and review workflow.
6. Add private vs contributed upload choice.
7. Add admin review.
8. Add rewards after review.
9. Enable curriculum intelligence only for high-confidence curricula.

## Key Product Principle

Protect trust first.

Students need to believe:

- Their private papers stay private.
- Contributions are voluntary.
- Rewards are fair.
- Solvd is not leaking their school materials.
- Curriculum intelligence helps students practice better without turning the product into a file-sharing site.

If that trust boundary is clear, paper contribution can become one of Solvd's strongest long-term advantages.
