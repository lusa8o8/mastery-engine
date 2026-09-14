"""Python-side tests for the generated S2A JSON Schema contracts."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "contracts" / "s2a"


class S2AContractsTest(unittest.TestCase):
    def test_pack_declares_no_domain_dependencies(self) -> None:
        pack = json.loads((PACK / "pack.json").read_text(encoding="utf-8"))
        self.assertEqual(pack["pack"], "s2a-common-platform")
        self.assertEqual(pack["status"], "draft")
        self.assertEqual(pack["dependencies"], [])
        self.assertEqual(len(pack["contracts"]), len(set(pack["contracts"])))

    def test_fixtures_match_expected_acceptance(self) -> None:
        index = json.loads((PACK / "fixtures" / "index.json").read_text())
        self.assertEqual(
            {case["category"] for case in index["cases"] if case["category"] != "auth"},
            {"normal", "empty", "partial", "invalid", "legacy"},
        )
        self.assertEqual(
            {case["contract"] for case in index["cases"]},
            {"principal", "auth_return_target", "command", "error", "workflow_job", "workflow_step", "model_call", "outbox_event", "audit_event"},
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

    def test_pydantic_enforces_cross_field_tenant_boundary(self) -> None:
        import sys

        sys.path.insert(0, str(PACK))
        from models import CommandEnvelope

        fixture = json.loads((PACK / "fixtures" / "command-invalid.json").read_text())
        with self.assertRaises(ValueError):
            CommandEnvelope.model_validate(fixture)

    def test_auth_methods_share_the_same_stable_principal(self) -> None:
        password = json.loads((PACK / "fixtures" / "principal-password.json").read_text())
        google = json.loads((PACK / "fixtures" / "principal-google.json").read_text())
        self.assertEqual(password["principal_id"], google["principal_id"])
        self.assertEqual(password["tenant_id"], google["tenant_id"])
        self.assertNotEqual(password["auth_method"], google["auth_method"])

    def test_auth_return_targets_fail_closed(self) -> None:
        import sys

        sys.path.insert(0, str(PACK))
        from models import AuthReturnTarget, validate_auth_return_target

        allowed = {"http://localhost:5173", "https://solvd.trymyapp.uk"}
        validate_auth_return_target(
            AuthReturnTarget(schema_version="auth_return_target.v1", origin="http://localhost:5173", return_path="/home"), allowed
        )
        for origin, path in [
            ("https://evil.example", "/home"),
            ("http://localhost:5173", "//evil.example"),
            ("http://localhost:5173", "/home\\redirect"),
        ]:
            with self.assertRaises(ValueError):
                validate_auth_return_target(AuthReturnTarget(schema_version="auth_return_target.v1", origin=origin, return_path=path), allowed)

    def test_generated_artifacts_are_current(self) -> None:
        import sys

        sys.path.insert(0, str(PACK))
        from generate import build_artifacts

        schemas, openapi, typescript = build_artifacts()
        self.assertEqual((PACK / "openapi.json").read_text(encoding="utf-8"), openapi)
        self.assertEqual((PACK / "types.ts").read_text(encoding="utf-8"), typescript)
        for filename, expected in schemas.items():
            self.assertEqual((PACK / "schemas" / filename).read_text(encoding="utf-8"), expected)


if __name__ == "__main__":
    unittest.main()
