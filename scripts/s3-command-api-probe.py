"""Self-cleaning live probe for JWT -> command API -> durable Postgres job."""

from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from pydantic import BaseModel, ConfigDict, Field
import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.atlas_api.app import create_app  # noqa: E402
from backend.atlas_api.commands import (  # noqa: E402
    CommandRegistry,
    CommandRoute,
    RegisteredCommandService,
)
from backend.atlas_api.config import RuntimeMode, Settings  # noqa: E402
from backend.atlas_api.jobs import JobNotFound, JobRuntime  # noqa: E402
from backend.atlas_api.postgres_jobs import PostgresJobRepository  # noqa: E402


EVIDENCE_DIR = ROOT / "docs" / "architecture" / "s3" / "evidence"


class ProbePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    probe_id: UUID
    sequence: int = Field(ge=1, le=2)


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def required(name: str, fallback: str | None = None) -> str:
    value = os.environ.get(name) or (os.environ.get(fallback, "") if fallback else "")
    if not value or "YOUR_" in value.upper() or "PLACEHOLDER" in value.upper():
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def connection_factory(password: str):
    pooler_path = ROOT / "supabase" / ".temp" / "pooler-url"
    pooler = urlsplit(pooler_path.read_text(encoding="utf-8").strip())
    if not pooler.hostname or not pooler.username or not pooler.port:
        raise RuntimeError("linked Supabase pooler URL is incomplete")

    def connect():
        return psycopg.connect(
            host=pooler.hostname,
            port=pooler.port,
            dbname=pooler.path.lstrip("/") or "postgres",
            user=pooler.username,
            password=password,
            sslmode="require",
            connect_timeout=15,
        )

    return connect


def supabase_headers(key: str, token: str | None = None) -> dict[str, str]:
    return {
        "apikey": key,
        "authorization": f"Bearer {token or key}",
        "content-type": "application/json",
    }


def create_user(
    client: httpx.Client,
    url: str,
    service_key: str,
    email: str,
    password: str,
) -> UUID:
    response = client.post(
        f"{url}/auth/v1/admin/users",
        headers=supabase_headers(service_key),
        json={"email": email, "password": password, "email_confirm": True},
    )
    response.raise_for_status()
    return UUID(response.json()["id"])


def sign_in(
    client: httpx.Client,
    url: str,
    anon_key: str,
    email: str,
    password: str,
) -> str:
    response = client.post(
        f"{url}/auth/v1/token?grant_type=password",
        headers=supabase_headers(anon_key),
        json={"email": email, "password": password},
    )
    response.raise_for_status()
    return response.json()["access_token"]


def delete_user(client: httpx.Client, url: str, service_key: str, user_id: UUID) -> None:
    response = client.delete(
        f"{url}/auth/v1/admin/users/{user_id}",
        headers=supabase_headers(service_key),
    )
    response.raise_for_status()


async def exercise_api(
    app, token_a: str, token_b: str, probe_id: UUID
) -> tuple[list[str], UUID, UUID]:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    body = {
        "command_type": "platform.integration_probe",
        "payload_schema_version": "platform_probe.v1",
        "payload": {"probe_id": str(probe_id), "sequence": 1},
    }
    key = f"probe:{probe_id}"
    async with httpx.AsyncClient(transport=transport, base_url="http://atlas.test") as client:
        anonymous = await client.post(
            "/v1/commands", headers={"idempotency-key": key}, json=body
        )
        first = await client.post(
            "/v1/commands",
            headers={"authorization": f"Bearer {token_a}", "idempotency-key": key},
            json=body,
        )
        replay = await client.post(
            "/v1/commands",
            headers={"authorization": f"Bearer {token_a}", "idempotency-key": key},
            json=body,
        )
        changed_body = {**body, "payload": {"probe_id": str(probe_id), "sequence": 2}}
        conflict = await client.post(
            "/v1/commands",
            headers={"authorization": f"Bearer {token_a}", "idempotency-key": key},
            json=changed_body,
        )
        other_tenant = await client.post(
            "/v1/commands",
            headers={"authorization": f"Bearer {token_b}", "idempotency-key": key},
            json=body,
        )

    assert anonymous.status_code == 401
    assert first.status_code == replay.status_code == other_tenant.status_code == 202
    assert conflict.status_code == 409
    assert first.json()["replayed"] is False and replay.json()["replayed"] is True
    assert first.json()["job"]["job_id"] == replay.json()["job"]["job_id"]
    assert first.json()["job"]["job_id"] != other_tenant.json()["job"]["job_id"]
    checks = [
        "anonymous command was rejected",
        "real password JWT resolved to a server-owned principal",
        "first authenticated command created one durable queued job",
        "same tenant and intent replayed the existing job",
        "changed intent with the same key returned a conflict",
        "the same key was independent in a second tenant",
    ]
    return (
        checks,
        UUID(first.json()["job"]["job_id"]),
        UUID(other_tenant.json()["job"]["job_id"]),
    )


def write_evidence(project_ref: str, checks: list[str]) -> Path:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    commit = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    report = {
        "schema_version": "s3-command-api-probe.v1",
        "project_ref": project_ref,
        "app_commit": commit,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "status": "passed",
        "authentication_method": "password",
        "model_provider_calls_expected": 0,
        "checks": checks,
        "cleanup_verified": True,
    }
    path = EVIDENCE_DIR / f"{stamp}-command-api-probe.json"
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm-project-ref", required=True)
    args = parser.parse_args()

    load_env(ROOT / ".env.local")
    load_env(ROOT / ".env")
    url = required("SUPABASE_URL", "VITE_SUPABASE_URL").rstrip("/")
    anon_key = required("VITE_SUPABASE_ANON_KEY")
    service_key = required("SUPABASE_SERVICE_ROLE_KEY")
    database_password = required("SUPABASE_DB_PASSWORD")
    hostname = urlsplit(url).hostname
    project_ref = hostname.split(".")[0] if hostname else ""
    if args.confirm_project_ref != project_ref:
        raise RuntimeError("confirmed project ref does not match SUPABASE_URL")

    marker = f"s3-command-{uuid4()}"
    users: list[UUID] = []
    connect = connection_factory(database_password)
    repository = PostgresJobRepository(connect)
    runtime = JobRuntime(repository, clock=lambda: datetime.now(timezone.utc))
    service = RegisteredCommandService(
        runtime,
        CommandRegistry(
            [
                CommandRoute(
                    command_type="platform.integration_probe",
                    payload_schema_version="platform_probe.v1",
                    payload_model=ProbePayload,
                    workflow_name="platform.integration_probe",
                    workflow_version="v1",
                    max_attempts=1,
                )
            ]
        ),
        clock=lambda: datetime.now(timezone.utc),
    )
    app = create_app(
        Settings(runtime_mode=RuntimeMode.PRODUCTION, supabase_url=url),
        command_service=service,
    )

    with httpx.Client(timeout=20) as client:
        try:
            password_a = secrets.token_urlsafe(24)
            password_b = secrets.token_urlsafe(24)
            email_a = f"{marker}-a@example.invalid"
            email_b = f"{marker}-b@example.invalid"
            user_a = create_user(client, url, service_key, email_a, password_a)
            users.append(user_a)
            user_b = create_user(client, url, service_key, email_b, password_b)
            users.append(user_b)
            token_a = sign_in(client, url, anon_key, email_a, password_a)
            token_b = sign_in(client, url, anon_key, email_b, password_b)
            checks, job_a, job_b = asyncio.run(
                exercise_api(app, token_a, token_b, uuid4())
            )

            assert repository.get(user_a, job_a).tenant_id == user_a
            assert repository.get(user_b, job_b).tenant_id == user_b
            try:
                repository.get(user_a, job_b)
                raise AssertionError("cross-tenant job read succeeded")
            except JobNotFound:
                checks.append("cross-tenant job lookup revealed no foreign record")
        finally:
            cleanup_failures = 0
            for user_id in reversed(users):
                try:
                    delete_user(client, url, service_key, user_id)
                except httpx.HTTPError:
                    cleanup_failures += 1
            if cleanup_failures:
                raise RuntimeError("probe could not remove every temporary user")

    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select count(*) from public.platform_commands where tenant_id = any(%s)",
                (users,),
            )
            if cursor.fetchone()[0] != 0:
                raise RuntimeError("probe cleanup left command rows")
    checks.append("temporary users and cascading command/job/outbox rows were removed")
    evidence = write_evidence(project_ref, checks)
    print(f"S3 command API probe passed ({len(checks)} checks)")
    print(f"Sanitized evidence: {evidence}")


if __name__ == "__main__":
    main()
