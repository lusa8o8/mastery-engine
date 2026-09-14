"""Register local PDF evidence without copying or extracting its content."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_REGISTRY = ROOT / "evals" / "private" / "extraction" / "candidates.v1.json"
DOWNLOADS = (Path.home() / "Downloads").resolve()


def inspect_pdf(raw_path: str) -> dict:
    path = Path(raw_path).resolve(strict=True)
    if not path.is_file() or DOWNLOADS not in path.parents:
        raise ValueError(f"Source must be a regular file inside {DOWNLOADS}")
    data = path.read_bytes()
    if not data.startswith(b"%PDF-"):
        raise ValueError(f"{path.name} does not have a PDF file signature")
    reader = PdfReader(path)
    if reader.is_encrypted:
        raise ValueError(f"{path.name} is encrypted")
    page_count = len(reader.pages)
    if page_count < 1:
        raise ValueError(f"{path.name} contains no pages")
    digest = hashlib.sha256(data).hexdigest()
    return {
        "source_id": f"sha256:{digest}",
        "display_name": path.name,
        "byte_count": len(data),
        "page_count": page_count,
        "media_type": "application/pdf",
        "consent_status": "local_evaluation_only",
        "license_status": "private_not_redistributable",
        "redaction_status": "pending",
        "annotation_status": "candidate",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+")
    args = parser.parse_args()
    existing = {"registry_version": "private-extraction-candidates.v1", "sources": []}
    if PRIVATE_REGISTRY.exists():
        existing = json.loads(PRIVATE_REGISTRY.read_text(encoding="utf-8"))
    by_id = {item["source_id"]: item for item in existing["sources"]}
    for raw_path in args.files:
        item = inspect_pdf(raw_path)
        item["registered_at"] = datetime.now(timezone.utc).isoformat()
        by_id[item["source_id"]] = item
    existing["sources"] = sorted(by_id.values(), key=lambda item: item["source_id"])
    PRIVATE_REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    PRIVATE_REGISTRY.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")
    print(f"Registered {len(args.files)} local PDF(s); registry now has {len(by_id)} candidate(s).")
    print("No document content was copied, extracted, uploaded, or committed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
