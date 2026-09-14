"""Python-side tests for the generated S2A JSON Schema contracts."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "contracts" / "s2a"
sys.path.insert(0, str(PACK))

from models import (  # noqa: E402 - the contract pack is intentionally standalone
    AuditEvent,
    AuthReturnTarget,
    CommandEnvelope,
    CONTRACT_MODELS,
    ErrorEnvelope,
    ModelCallRecord,
    OutboxEvent,
    TenantScope,
    WorkflowJob,
    WorkflowStep,
    validate_auth_return_target,
)


class S2AContractsTest(unittest.TestCase):
    def test_pack_declares_no_domain_dependencies(self) -> None:
        pack = json.loads((PACK / "pack.json").read_text(encoding="utf-8"))
        self.assertEqual(pack["pack"], "s2a-common-platform")
        self.assertEqual(pack["status"], "frozen")
        self.assertEqual(pack["version"], "1.0.0")
        self.assertEqual(pack["dependencies"], [])
        self.assertEqual(len(pack["contracts"]), len(set(pack["contracts"])))
        self.assertEqual(
            set(pack["contracts"]),
            {path.name.removesuffix(".schema.json") for path in (PACK / "schemas").glob("*.schema.json")},
        )

    def test_review_scenarios_use_only_frozen_common_contracts(self) -> None:
        pack = json.loads((PACK / "pack.json").read_text(encoding="utf-8"))
        review = json.loads((PACK / "review-scenarios.json").read_text(encoding="utf-8"))
        scenarios = review["scenarios"]
        self.assertEqual(len({item["id"] for item in scenarios}), len(scenarios))
        self.assertEqual(
            {item["id"] for item in scenarios},
            {
                "paper-upload-and-extraction",
                "atlas-tutor-turn-and-resume",
                "exam-generation-marking-and-remediation",
            },
        )
        frozen = set(pack["contracts"])
        for scenario in scenarios:
            self.assertTrue(set(scenario["common_contract_sequence"]).issubset(frozen))
            self.assertTrue(scenario["required_steps"])
            self.assertTrue(scenario["failure_policy"])
            self.assertNotIn("s2a-common-platform", scenario["imports_after_s2a"])

    def test_fixtures_match_expected_acceptance(self) -> None:
        index = json.loads((PACK / "fixtures" / "index.json").read_text())
        self.assertEqual(
            {case["category"] for case in index["cases"] if case["category"] != "auth"},
            {"normal", "empty", "partial", "invalid", "legacy"},
        )
        self.assertEqual(
            {case["contract"] for case in index["cases"]},
            {"principal", "tenant_scope", "auth_return_target", "command", "error", "workflow_job", "workflow_step", "model_call", "outbox_event", "audit_event"},
        )
        for case in index["cases"]:
            schema = json.loads(
                (PACK / "schemas" / f"{case['contract']}.v1.schema.json").read_text()
            )
            fixture = json.loads((PACK / "fixtures" / case["file"]).read_text())
            valid = not list(
                Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(fixture)
            )
            self.assertEqual(valid, case["accepted"], case["id"])
            if case["accepted"]:
                CONTRACT_MODELS[case["contract"]].model_validate(fixture)

    def test_pydantic_enforces_cross_field_tenant_boundary(self) -> None:
        fixture = json.loads((PACK / "fixtures" / "command-invalid.json").read_text())
        with self.assertRaises(ValueError):
            CommandEnvelope.model_validate(fixture)

        scope = json.loads((PACK / "fixtures" / "tenant-scope-normal.json").read_text())
        scope["tenant_id"] = "99999999-9999-4999-8999-999999999999"
        with self.assertRaises(ValueError):
            TenantScope.model_validate(scope)

    def test_auth_methods_share_the_same_stable_principal(self) -> None:
        password = json.loads((PACK / "fixtures" / "principal-password.json").read_text())
        google = json.loads((PACK / "fixtures" / "principal-google.json").read_text())
        self.assertEqual(password["principal_id"], google["principal_id"])
        self.assertEqual(password["tenant_id"], google["tenant_id"])
        self.assertNotEqual(password["auth_method"], google["auth_method"])

    def test_auth_return_targets_fail_closed(self) -> None:
        allowed = {"http://localhost:5173", "https://solvd.trymyapp.uk"}
        paths = {"/home", "/upload", "/vault", "/patterns", "/simulate", "/engine", "/summary", "/progress"}
        validate_auth_return_target(
            AuthReturnTarget(schema_version="auth_return_target.v1", origin="http://localhost:5173", return_path="/home"), allowed, paths
        )
        for origin, path in [
            ("https://evil.example", "/home"),
            ("http://localhost:5173", "//evil.example"),
            ("http://localhost:5173", "/home\\redirect"),
        ]:
            with self.assertRaises(ValueError):
                validate_auth_return_target(AuthReturnTarget(schema_version="auth_return_target.v1", origin=origin, return_path=path), allowed, paths)

        with self.assertRaises(ValueError):
            validate_auth_return_target(
                AuthReturnTarget(schema_version="auth_return_target.v1", origin="http://localhost:5173", return_path="/auth"),
                allowed,
                paths,
            )

    def test_lifecycle_invariants_fail_closed(self) -> None:
        job = json.loads((PACK / "fixtures" / "workflow-job-normal.json").read_text())
        job.update(status="running", attempt_count=1)
        with self.assertRaises(ValueError):
            WorkflowJob.model_validate(job)

        step = json.loads((PACK / "fixtures" / "workflow-step-normal.json").read_text())
        step.update(status="failed", completed_at="2026-09-14T08:10:03Z")
        with self.assertRaises(ValueError):
            WorkflowStep.model_validate(step)

        call = json.loads((PACK / "fixtures" / "model-call-normal.json").read_text())
        call.pop("step_id")
        with self.assertRaises(ValueError):
            ModelCallRecord.model_validate(call)

        # Interactive calls omit both background identifiers but retain the
        # universal request correlation ID.
        call.pop("job_id")
        ModelCallRecord.model_validate(call)

    def test_error_event_and_audit_invariants_fail_closed(self) -> None:
        error = json.loads((PACK / "fixtures" / "error-empty.json").read_text())
        error["http_status"] = 200
        with self.assertRaises(ValueError):
            ErrorEnvelope.model_validate(error)

        event = json.loads((PACK / "fixtures" / "outbox-event-normal.json").read_text())
        event["available_at"] = "2026-09-14T08:00:00Z"
        with self.assertRaises(ValueError):
            OutboxEvent.model_validate(event)

        audit = json.loads((PACK / "fixtures" / "audit-event-normal.json").read_text())
        audit["metadata"]["prompt_text"] = "must never be logged"
        with self.assertRaises(ValueError):
            AuditEvent.model_validate(audit)

    def test_generated_artifacts_are_current(self) -> None:
        from generate import build_artifacts

        schemas, openapi, typescript = build_artifacts()
        self.assertEqual((PACK / "openapi.json").read_text(encoding="utf-8"), openapi)
        self.assertEqual((PACK / "types.ts").read_text(encoding="utf-8"), typescript)
        for filename, expected in schemas.items():
            self.assertEqual((PACK / "schemas" / filename).read_text(encoding="utf-8"), expected)


if __name__ == "__main__":
    unittest.main()
