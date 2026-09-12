# Supported Scope Baseline

This records what the current product actually enforces. It is not a promise that every accepted document will extract correctly.

## Current upload envelope

- File types: PDF, JPEG/JPG, PNG and WebP.
- Maximum size: 20 MB per file.
- Batch uploads: allowed and processed one file at a time.
- Required metadata: student-supplied paper name and one of Past Exam, Mock Exam, Class Test, Quiz, Tutorial Sheet or Assignment.
- Page limit: **not enforced or documented**.
- Language: **not enforced**; prompts are English.
- Document quality: no deterministic scan-quality, rotation, handwriting or page-completeness gate.

## Mathematical scope

The UI describes Atlas as a math tutor, but there is no versioned curriculum, institution, course or mathematical-domain allow-list. Extraction assigns free-text `topic` and `sub_type` values. Therefore the honest current support statement is:

> Best-effort extraction and tutoring for readable mathematics assessment material that Claude can interpret; no domain-specific accuracy guarantee yet.

## First-release limits to ratify before S6

The product owner and evaluation baseline must set explicit values for maximum pages, handwriting support, language(s), supported curricula/domains, minimum scan quality, table/diagram handling and partial-document behavior. Until then, these are `TBD`, not hidden assumptions.

## Explicit non-goals for the first reliable release

- General web search or open-ended RAG over the internet.
- Automatic publication of private uploads to a public library.
- Inferring a student’s institution membership from paper metadata.
- Unreviewed copyrighted-paper redistribution.
- Fully autonomous multi-agent behavior or unbounded tool loops.
- Model-controlled mastery transitions, entitlements or database writes.
- Guaranteed handwriting recognition or proof grading before dedicated evals pass.
- Replacing the accepted mobile experience during backend stabilization.
