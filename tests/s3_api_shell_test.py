"""Fixture-backed tests for the S3 FastAPI trust boundary."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest
from uuid import UUID

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.atlas_api.app import StaticReadinessProbe, create_app  # noqa: E402
from backend.atlas_api.auth import FixtureAuthenticator  # noqa: E402
from backend.atlas_api.config import RuntimeMode, Settings  # noqa: E402
from contracts.s2a.models import AuthMethod, Principal  # noqa: E402


PRINCIPAL_ID = UUID("11111111-1111-4111-8111-111111111111")


def principal(method: AuthMethod) -> Principal:
    return Principal(
        schema_version="principal.v1",
        principal_id=PRINCIPAL_ID,
        tenant_id=PRINCIPAL_ID,
        auth_method=method,
        authenticated_at=datetime(2026, 9, 14, 8, tzinfo=timezone.utc),
    )


def fixture_app(*, ready: bool = True):
    checks = {
        "authentication": ready,
        "database": ready,
        "job_store": ready,
        "model_gateway": ready,
    }
    return create_app(
        Settings(runtime_mode=RuntimeMode.FIXTURE, docs_enabled=False),
        authenticator=FixtureAuthenticator(
            {
                "password-fixture": principal(AuthMethod.PASSWORD),
                "google-fixture": principal(AuthMethod.GOOGLE),
            }
        ),
        readiness_probe=StaticReadinessProbe(checks),
    )


async def request(app, method: str, path: str, **kwargs) -> httpx.Response:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://atlas.test") as client:
        return await client.request(method, path, **kwargs)


class S3ApiShellTest(unittest.IsolatedAsyncioTestCase):
    async def test_liveness_is_public_and_preserves_valid_request_id(self) -> None:
        supplied = "44444444-4444-4444-8444-444444444444"
        response = await request(
            fixture_app(), "GET", "/health/live", headers={"x-request-id": supplied}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-request-id"], supplied)
        self.assertEqual(response.json()["status"], "ok")

    async def test_invalid_request_id_is_replaced_with_uuid(self) -> None:
        response = await request(
            fixture_app(), "GET", "/health/live", headers={"x-request-id": "not-a-uuid"}
        )
        self.assertNotEqual(response.headers["x-request-id"], "not-a-uuid")
        UUID(response.headers["x-request-id"])

    async def test_readiness_fails_closed_with_typed_error(self) -> None:
        response = await request(fixture_app(ready=False), "GET", "/health/ready")
        body = response.json()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(body["schema_version"], "error.v1")
        self.assertEqual(body["code"], "DEPENDENCY_FAILED")
        self.assertTrue(body["retryable"])
        self.assertEqual(
            body["details"]["unready"],
            ["authentication", "database", "job_store", "model_gateway"],
        )
        self.assertEqual(body["request_id"], response.headers["x-request-id"])

    async def test_readiness_succeeds_only_when_every_check_passes(self) -> None:
        response = await request(fixture_app(), "GET", "/health/ready")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ready")
        self.assertTrue(all(response.json()["checks"].values()))

    async def test_protected_route_rejects_missing_malformed_and_unknown_tokens(self) -> None:
        headers = [
            {},
            {"authorization": "Basic value"},
            {"authorization": "Bearer unknown"},
            {"authorization": "Bearer two tokens"},
        ]
        responses = [
            await request(fixture_app(), "GET", "/v1/whoami", headers=item)
            for item in headers
        ]
        self.assertTrue(all(response.status_code == 401 for response in responses))
        self.assertTrue(
            all(response.json()["code"] == "UNAUTHENTICATED" for response in responses)
        )

    async def test_password_and_google_share_one_principal_boundary(self) -> None:
        app = fixture_app()
        password = await request(
            app,
            "GET",
            "/v1/whoami",
            headers={"authorization": "Bearer password-fixture"},
        )
        google = await request(
            app,
            "GET",
            "/v1/whoami",
            headers={"authorization": "Bearer google-fixture"},
        )
        self.assertEqual(password.status_code, 200)
        self.assertEqual(google.status_code, 200)
        self.assertEqual(password.json()["principal_id"], google.json()["principal_id"])
        self.assertEqual(password.json()["tenant_id"], google.json()["tenant_id"])
        self.assertNotEqual(password.json()["auth_method"], google.json()["auth_method"])
        self.assertNotIn("fixture", str(password.json()))

    async def test_locked_default_cannot_authenticate_or_report_ready(self) -> None:
        locked = create_app(Settings(runtime_mode=RuntimeMode.LOCKED))
        ready = await request(locked, "GET", "/health/ready")
        identity = await request(
            locked,
            "GET",
            "/v1/whoami",
            headers={"authorization": "Bearer anything"},
        )
        self.assertEqual(ready.status_code, 503)
        self.assertEqual(identity.status_code, 503)
        self.assertEqual(identity.json()["code"], "DEPENDENCY_FAILED")

    async def test_locked_authenticator_cannot_be_forced_ready_by_probe(self) -> None:
        locked = create_app(
            Settings(runtime_mode=RuntimeMode.LOCKED),
            readiness_probe=StaticReadinessProbe(
                {
                    "authentication": True,
                    "database": True,
                    "job_store": True,
                    "model_gateway": True,
                }
            ),
        )
        response = await request(locked, "GET", "/health/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["details"]["unready"], ["authentication"])

    async def test_fixture_authenticator_is_impossible_in_production_mode(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden"):
            create_app(
                Settings(runtime_mode=RuntimeMode.PRODUCTION),
                authenticator=FixtureAuthenticator(
                    {"fixture": principal(AuthMethod.PASSWORD)}
                ),
            )

    def test_production_mode_requires_supabase_configuration(self) -> None:
        with self.assertRaisesRegex(ValueError, "SUPABASE_URL"):
            create_app(Settings(runtime_mode=RuntimeMode.PRODUCTION))

    async def test_validation_and_missing_routes_do_not_reflect_input(self) -> None:
        app = fixture_app()

        @app.get("/_test/number")
        async def number(value: int) -> dict[str, int]:
            return {"value": value}

        missing = await request(app, "GET", "/private-secret-route")
        invalid = await request(app, "GET", "/_test/number?value=private-secret")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["message"], "Route not found")
        self.assertNotIn("private-secret-route", str(missing.json()))
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(invalid.json()["details"], {"fields": ["query.value"]})
        self.assertNotIn("private-secret", str(invalid.json()))

    async def test_unexpected_errors_hide_exception_text(self) -> None:
        app = fixture_app()

        @app.get("/_test/boom")
        async def boom() -> None:
            raise RuntimeError("provider leaked private-secret")

        response = await request(app, "GET", "/_test/boom")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["code"], "INTERNAL_ERROR")
        self.assertNotIn("private-secret", str(response.json()))

    async def test_openapi_exposes_frozen_principal_and_error_envelopes(self) -> None:
        app = fixture_app()
        response = await request(app, "GET", "/openapi.json")
        components = response.json()["components"]["schemas"]
        self.assertIn("Principal", components)
        self.assertIn("ErrorEnvelope", components)
        self.assertIsNone(app.docs_url)


if __name__ == "__main__":
    unittest.main()
