"""Validate S4A manifests and guard development/held-out split integrity."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "evals" / "datasets" / "extraction" / "v1"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-gate", action="store_true")
    args = parser.parse_args()

    schema = json.loads((DATASET / "dataset.schema.json").read_text(encoding="utf-8"))
    manifests = {
        split: json.loads((DATASET / f"{split}.json").read_text(encoding="utf-8"))
        for split in ("development", "held-out")
    }
    errors: list[str] = []
    ids: set[str] = set()
    groups: dict[str, str] = {}
    source_ids: dict[str, str] = {}

    for filename_split, manifest in manifests.items():
        for error in Draft202012Validator(schema).iter_errors(manifest):
            errors.append(f"{filename_split}:{'.'.join(map(str, error.path))}: {error.message}")
        expected_split = "held_out" if filename_split == "held-out" else "development"
        for case in manifest.get("cases", []):
            if case["split"] != expected_split:
                errors.append(f"{case['id']}: split does not match its manifest")
            if case["id"] in ids:
                errors.append(f"{case['id']}: duplicate immutable case ID")
            ids.add(case["id"])
            source = case["source"]
            for value, seen, label in [
                (source["source_id"], source_ids, "source"),
                (source["entity_group_id"], groups, "entity group"),
            ]:
                previous = seen.get(value)
                if previous and previous != expected_split:
                    errors.append(f"{case['id']}: {label} crosses development/held-out splits")
                seen[value] = expected_split

    if args.release_gate:
        executable_development = [c for c in manifests["development"]["cases"] if c["fixture_status"] == "executable"]
        executable_held_out = [c for c in manifests["held-out"]["cases"] if c["fixture_status"] == "executable"]
        if not executable_development:
            errors.append("release gate: no executable development cases")
        if not executable_held_out:
            errors.append("release gate: no executable held-out cases")
        if any(m["status"] != "reviewed" for m in manifests.values()):
            errors.append("release gate: both manifests must be reviewed")

    if errors:
        print("Extraction dataset validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"Extraction dataset schema and split checks passed ({len(ids)} cases).")
    if not args.release_gate:
        print("Baseline only: use --release-gate before any OCR release decision.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
