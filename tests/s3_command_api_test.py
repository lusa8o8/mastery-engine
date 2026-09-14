"""Authorization and idempotency tests for the first S3 command endpoint."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, Field
from psycopg import OperationalError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.atlas_api.app import create_app  # noqa: E402
from backend.atlas_api.auth import FixtureAuthenticator  # noqa: E402
from backend.atlas_api.commands import (  # noqa: E402
    CommandRegistry,
    CommandRoute,
    RegisteredCommandService,
)
from backend.atlas_api.config import RuntimeMode, Settings  # noqa: E402
from backend.atlas_api.jobs import (  # noqa: E402
    InMemoryJobRepository,
    JobNotFound,
    JobRuntime,
)
from backend.atlas_api.job_queries import RegisteredJobQueryService  # noqa: E402
from backend.atlas_api.worker import (  # noqa: E402
    WorkflowDefinition,
    WorkflowDisposition,
    WorkflowRegistry,
    WorkflowWorker,
)
from contracts.s2a.models import AuthMethod, Principal  # noqa: E402


USER_A = UUID("11111111-1111-4111-8111-111111111111")
USER_B = UUID("22222222-2222-4222-8222-222222222222")
NOW = datetime(2026, 9, 14, 15, tzinfo=timezone.utc)


class ExtractionFixturePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resource_id: UUID
    requested_pages: list[int] = Field(min_length=1, max_length=20)


class ExtractionFixtureResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resource_id: UUID
    accepted_page_count: int = Field(ge=1, le=20)


def principal(user_id: UUID) -> Principal:
    return Principal(
        schema_version="principal.v1",
        principal_id=user_id,
        tenant_id=user_id,
        auth_method=AuthMethod.PASSWORD,
        authenticated_at=NOW,
    )


def command_body(resource_id: UUID = USER_A) -> dict:
    return {
        "command_type": "resource.extract",
        "payload_schema_version": "resource_extract.v1",
        "payload": {"resource_id": str(resource_id), "requested_pages": [1, 2]},
    }


def command_app(*, runtime_override=None):
    repository = InMemoryJobRepository()
    job_ids = iter(
        (
            UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"),
            UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"),
            UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"),
        )
    )
    command_ids = iter(
        (
            UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"),
            UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"),
            UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"),
            UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4"),
        )
    )
    runtime = runtime_override or JobRuntime(
        repository, clock=lambda: NOW, id_factory=lambda: next(job_ids)
    )
    service = RegisteredCommandService(
        runtime,
        CommandRegistry(
            [
                CommandRoute(
                    command_type="resource.extract",
                    payload_schema_version="resource_extract.v1",
                    payload_model=ExtractionFixturePayload,
                    workflow_name="resource.extraction",
                    workflow_version="v1",
                    max_attempts=3,
                )
            ]
        ),
        clock=lambda: NOW,
        id_factory=lambda: next(command_ids),
    )
    app = create_app(
        Settings(runtime_mode=RuntimeMode.FIXTURE),
        authenticator=FixtureAuthenticator(
            {"user-a": principal(USER_A), "user-b": principal(USER_B)}
        ),
        command_service=service,
        job_query_service=RegisteredJobQueryService(runtime),
    )
    app.state.test_runtime = runtime
    return app, repository


async def request(app, **kwargs) -> httpx.Response:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://atlas.test") as client:
        return await client.post("/v1/commands", **kwargs)


async def get_job(app, job_id: str, token: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://atlas.test") as client:
        return await client.get(
            f"/v1/jobs/{job_id}",
            headers={"authorization": f"Bearer {token}"},
        )


def headers(token: str, key: str = "extract:attempt-1") -> dict[str, str]:
    return {"authorization": f"Bearer {token}", "idempotency-key": key}


class CommandApiTest(unittest.IsolatedAsyncioTestCase):
    def test_registry_rejects_invalid_and_duplicate_routes_at_startup(self) -> None:
        route = CommandRoute(
            command_type="resource.extract",
            payload_schema_version="resource_extract.v1",
            payload_model=ExtractionFixturePayload,
            workflow_name="resource.extraction",
            workflow_version="v1",
        )
        with self.assertRaisesRegex(ValueError, "duplicated"):
            CommandRegistry([route, route])
        with self.assertRaisesRegex(ValueError, "workflow_version"):
            CommandRoute(
                command_type="resource.extract",
                payload_schema_version="resource_extract.v1",
                payload_model=ExtractionFixturePayload,
                workflow_name="resource.extraction",
                workflow_version="latest",
            )

    async def test_verified_principal_owns_the_server_built_command_and_job(self) -> None:
        app, repository = command_app()
        response = await request(
            app, headers=headers("user-a"), json=command_body()
        )
        self.assertEqual(response.status_code, 202)
        body = response.json()
        self.assertEqual(body["schema_version"], "command_submission.v1")
        self.assertFalse(body["replayed"])
        self.assertEqual(body["job"]["tenant_id"], str(USER_A))
        stored = repository.get_command(USER_A, UUID(body["job"]["command_id"]))
        self.assertEqual(stored.principal_id, USER_A)
        self.assertEqual(stored.tenant_id, USER_A)
        self.assertEqual(stored.request_id, UUID(response.headers["x-request-id"]))

        snapshot = await get_job(app, body["job"]["job_id"], "user-a")
        self.assertEqual(snapshot.status_code, 200)
        self.assertEqual(snapshot.json()["schema_version"], "job_snapshot.v1")
        self.assertEqual(snapshot.json()["job"]["tenant_id"], str(USER_A))
        self.assertIsNone(snapshot.json()["result"])

        foreign = await get_job(app, body["job"]["job_id"], "user-b")
        missing = await get_job(
            app, "ffffffff-ffff-4fff-8fff-ffffffffffff", "user-a"
        )
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(foreign.json()["code"], "NOT_FOUND")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["code"], "NOT_FOUND")

    async def test_same_intent_replays_one_job_and_changed_intent_conflicts(self) -> None:
        app, _repository = command_app()
        first = await request(app, headers=headers("user-a"), json=command_body())
        replay = await request(app, headers=headers("user-a"), json=command_body())
        changed = await request(
            app,
            headers=headers("user-a"),
            json=command_body(UUID("33333333-3333-4333-8333-333333333333")),
        )
        self.assertEqual(first.status_code, 202)
        self.assertEqual(replay.status_code, 202)
        self.assertEqual(first.json()["job"]["job_id"], replay.json()["job"]["job_id"])
        self.assertTrue(replay.json()["replayed"])
        self.assertEqual(changed.status_code, 409)
        self.assertEqual(changed.json()["code"], "CONFLICT")

    async def test_worker_result_is_validated_persisted_and_read_by_owner(self) -> None:
        app, _repository = command_app()
        submitted = await request(
            app, headers=headers("user-a"), json=command_body()
        )

        async def execute(context):
            return {
                "resource_id": context.command.payload["resource_id"],
                "accepted_page_count": len(
                    context.command.payload["requested_pages"]
                ),
            }

        async def verify(_context, candidate):
            self.assertEqual(candidate["accepted_page_count"], 2)
            return WorkflowDisposition.SUCCEEDED

        worker = WorkflowWorker(
            app.state.test_runtime,
            WorkflowRegistry(
                [
                    WorkflowDefinition(
                        workflow_name="resource.extraction",
                        workflow_version="v1",
                        execute=execute,
                        verify=verify,
                        timeout_seconds=1,
                        result_model=ExtractionFixtureResult,
                        result_schema_version="resource_extract_result.v1",
                    )
                ]
            ),
            clock=lambda: NOW,
        )
        trace = await worker.run_once()
        assert trace is not None
        self.assertEqual(trace.status, "succeeded")

        job_id = submitted.json()["job"]["job_id"]
        snapshot = await get_job(app, job_id, "user-a")
        self.assertEqual(snapshot.status_code, 200)
        self.assertEqual(snapshot.json()["job"]["status"], "succeeded")
        self.assertEqual(
            snapshot.json()["result"]["output"],
            {"resource_id": str(USER_A), "accepted_page_count": 2},
        )
        self.assertEqual(
            snapshot.json()["result"]["output_schema_version"],
            "resource_extract_result.v1",
        )
        self.assertEqual((await get_job(app, job_id, "user-b")).status_code, 404)

    async def test_idempotency_namespace_is_per_tenant(self) -> None:
        app, _repository = command_app()
        user_a = await request(app, headers=headers("user-a"), json=command_body())
        user_b = await request(app, headers=headers("user-b"), json=command_body())
        self.assertEqual(user_a.status_code, 202)
        self.assertEqual(user_b.status_code, 202)
        self.assertNotEqual(user_a.json()["job"]["job_id"], user_b.json()["job"]["job_id"])
        self.assertEqual(user_b.json()["job"]["tenant_id"], str(USER_B))

    async def test_missing_authentication_cannot_create_a_command(self) -> None:
        app, repository = command_app()
        response = await request(
            app,
            headers={"idempotency-key": "extract:attempt-1"},
            json=command_body(),
        )
        self.assertEqual(response.status_code, 401)
        with self.assertRaises(JobNotFound):
            repository.get(USER_A, UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"))

    async def test_unknown_route_and_invalid_payload_fail_before_storage(self) -> None:
        app, repository = command_app()
        unknown = command_body()
        unknown["command_type"] = "resource.delete"
        invalid = command_body()
        invalid["payload"]["private_content"] = "do-not-reflect-me"
        responses = (
            await request(app, headers=headers("user-a"), json=unknown),
            await request(app, headers=headers("user-a"), json=invalid),
        )
        self.assertTrue(all(response.status_code == 422 for response in responses))
        self.assertTrue(all(response.json()["code"] == "INVALID_INPUT" for response in responses))
        self.assertNotIn("do-not-reflect-me", str(responses[1].json()))
        with self.assertRaises(JobNotFound):
            repository.get(USER_A, UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"))

    async def test_identity_fields_and_bad_idempotency_headers_are_rejected(self) -> None:
        app, _repository = command_app()
        injected = command_body()
        injected["tenant_id"] = str(USER_B)
        responses = (
            await request(app, headers=headers("user-a"), json=injected),
            await request(
                app,
                headers={"authorization": "Bearer user-a"},
                json=command_body(),
            ),
            await request(
                app,
                headers=headers("user-a", "bad key with spaces"),
                json=command_body(),
            ),
        )
        self.assertTrue(all(response.status_code == 422 for response in responses))
        self.assertTrue(all(response.json()["code"] == "INVALID_INPUT" for response in responses))

    async def test_oversized_payload_is_rejected_before_command_submission(self) -> None:
        app, repository = command_app()
        oversized = command_body()
        oversized["payload"]["padding"] = "private-value" * 6000
        response = await request(
            app, headers=headers("user-a"), json=oversized
        )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("private-value", str(response.json()))
        with self.assertRaises(JobNotFound):
            repository.get(USER_A, UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"))

    async def test_command_endpoint_is_locked_without_injected_service(self) -> None:
        app = create_app(
            Settings(runtime_mode=RuntimeMode.FIXTURE),
            authenticator=FixtureAuthenticator({"user-a": principal(USER_A)}),
        )
        response = await request(
            app, headers=headers("user-a"), json=command_body()
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "DEPENDENCY_FAILED")

    async def test_database_failure_is_retryable_and_does_not_leak_details(self) -> None:
        class UnavailableRuntime:
            def submit(self, *_args, **_kwargs):
                raise OperationalError("private database endpoint")

        app, _repository = command_app(runtime_override=UnavailableRuntime())
        response = await request(
            app, headers=headers("user-a"), json=command_body()
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "DEPENDENCY_FAILED")
        self.assertTrue(response.json()["retryable"])
        self.assertNotIn("private database", str(response.json()))


if __name__ == "__main__":
    unittest.main()
