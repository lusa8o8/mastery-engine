# Extraction evaluation datasets

Status: **S4A baseline scaffold; not a release-quality benchmark**

This directory defines how Atlas will measure PDF validation, OCR,
transcription, question segmentation, page/region evidence, abstention, and
document prompt-injection resistance before changing the production extractor.

## What is committed

- A versioned JSON Schema.
- Planned synthetic development cases covering the first critical behaviors.
- An intentionally empty held-out manifest. Cases are not called held-out until
  a reviewer isolates their source and expected answer from prompt authors.

## What stays private

Real tutorial sheets and exam papers stay under `evals/private/`, which Git
ignores. The candidate registry stores only a SHA-256 hash, byte count, page
count, media type, and review statusâ€”never extracted questions or answers.
Registration does not upload a document or call a model.

```powershell
py scripts\register-private-extraction-source.py `
  "C:\path\to\tutorial-one.pdf" "C:\path\to\tutorial-two.pdf"
py scripts\validate-extraction-dataset.py
```

`validate-extraction-dataset.py --release-gate` will continue to fail until the
planned cases are executable and at least one independently protected held-out
case exists. That failure is intentional and prevents this scaffold being
mistaken for OCR readiness.

## Review path

1. Confirm the owner permits local evaluation and record redistribution limits.
2. Redact personal data before creating any portable page/image fixture.
3. Group pages from the same paper in one `entity_group_id` before splitting.
4. Have a reviewer create ground truth with page/region locators.
5. Keep held-out content and labels unavailable to prompt/model authors.
6. Run deterministic graders before adding model or human graders.
