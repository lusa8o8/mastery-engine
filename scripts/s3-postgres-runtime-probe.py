"""Bounded live probe for the S3 Postgres job and outbox repositories."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from time import monotonic, sleep
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
import psycopg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.atlas_api.jobs import (
    IdempotencyConflict,
    JobNotFound,
    JobOutcome,
    JobRuntime,
)
from backend.atlas_api.outbox import OutboxLease, OutboxLeaseLost, PostgresOutboxRepository
from backend.atlas_api.postgres_jobs import PostgresJobRepository
from contracts.s2a.models import CommandEnvelope, ErrorCode


EVIDENCE_DIR = ROOT / "docs" / "architecture" / "s3" / "evidence"


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


def required(name: str, fallback: str | None = None) -> str:
    value = os.environ.get(name) or (os.environ.get(fallback, "") if fallback else "")
    if not value or "YOUR_" in value.upper() or "PLACEHOLDER" in value.upper():
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def make_connection_factory(password: str):
    pooler = urlsplit((ROOT / "supabase" / ".temp" / "pooler-url").read_text().strip())
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


def api_headers(key: str, token: str | None = None) -> dict[str, str]:
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
        headers=api_headers(service_key),
        json={"email": email, "password": password, "email_confirm": True},
    )
    response.raise_for_status()
    return UUID(response.json()["id"])


def delete_user(client: httpx.Client, url: str, service_key: str, user_id: UUID) -> None:
    response = client.delete(
        f"{url}/auth/v1/admin/users/{user_id}", headers=api_headers(service_key)
    )
    response.raise_for_status()


def sign_in(client: httpx.Client, url: str, anon_key: str, email: str, password: str) -> str:
    response = client.post(
        f"{url}/auth/v1/token?grant_type=password",
        headers=api_headers(anon_key),
        json={"email": email, "password": password},
    )
    response.raise_for_status()
    return response.json()["access_token"]


def command(
    user_id: UUID,
    key: str,
    *,
    delivery: int,
    resource_id: str = "probe-paper",
) -> CommandEnvelope:
    return CommandEnvelope(
        schema_version="command.v1",
        request_id=uuid4(),
        command_id=uuid4(),
        command_type="resource.extract",
        principal_id=user_id,
        tenant_id=user_id,
        idempotency_key=key,
        payload_schema_version="resource_extract.v1",
        payload={"resource_id": resource_id, "delivery": delivery},
        requested_at=datetime.now(timezone.utc),
    )


def write_report(project_ref: str, checks: list[str], cleanup_verified: bool) -> Path:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        commit = "unknown"
    report = {
        "schema_version": "s3-postgres-probe.v1",
        "project_ref": project_ref,
        "app_commit": commit,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "status": "passed" if cleanup_verified else "failed",
        "model_provider_calls_expected": 0,
        "checks": checks,
        "cleanup_verified": cleanup_verified,
    }
    path = EVIDENCE_DIR / f"{stamp}-postgres-runtime-probe.json"
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
    project_ref = urlsplit(url).hostname.split(".")[0]  # type: ignore[union-attr]
    if args.confirm_project_ref != project_ref:
        raise RuntimeError("confirmed project ref does not match SUPABASE_URL")

    marker = f"s3-postgres-probe-{uuid4()}"
    email_a = f"{marker}-a@example.invalid"
    email_b = f"{marker}-b@example.invalid"
    password_a = secrets.token_urlsafe(24)
    password_b = secrets.token_urlsafe(24)
    created_users: list[UUID] = []
    checks: list[str] = []
    connect = make_connection_factory(database_password)

    with httpx.Client(timeout=20) as client:
        try:
            user_a = create_user(client, url, service_key, email_a, password_a)
            created_users.append(user_a)
            user_b = create_user(client, url, service_key, email_b, password_b)
            created_users.append(user_b)
            token_a = sign_in(client, url, anon_key, email_a, password_a)

            duplicate_event_id = uuid4()
            rollback_repo = PostgresJobRepository(
                connect, event_id_factory=lambda: duplicate_event_id
            )
            runtime = JobRuntime(
                rollback_repo,
                clock=lambda: datetime.now(timezone.utc),
                lease_duration=timedelta(minutes=5),
            )
            key = f"probe:{uuid4()}"
            first_command = command(user_a, key, delivery=1)
            replay_command = first_command.model_copy(
                update={"request_id": uuid4(), "command_id": uuid4()}
            )
            with ThreadPoolExecutor(max_workers=2) as executor:
                submissions = list(
                    executor.map(
                        lambda value: runtime.submit(
                            value,
                            workflow_name="resource.extraction",
                            workflow_version="v1",
                        ),
                        (first_command, replay_command),
                    )
                )
            first = next(result for result in submissions if not result.replayed)
            assert sum(result.replayed for result in submissions) == 1
            assert len({result.job.job_id for result in submissions}) == 1
            checks.append("concurrent duplicate commands returned one durable job")

            conflict_command = first_command.model_copy(
                update={
                    "request_id": uuid4(),
                    "command_id": uuid4(),
                    "payload": {"resource_id": "different-paper", "delivery": 1},
                }
            )
            try:
                runtime.submit(
                    conflict_command,
                    workflow_name="resource.extraction",
                    workflow_version="v1",
                )
                raise AssertionError("different intent reused an idempotency key")
            except IdempotencyConflict:
                checks.append("different intent failed closed on idempotency conflict")

            try:
                runtime.get(user_b, first.job.job_id)
                raise AssertionError("cross-tenant job read succeeded")
            except JobNotFound:
                checks.append("cross-tenant repository read was hidden")

            # Reusing the queued-event ID forces the claim's outbox insert to
            # fail. The surrounding transaction must roll the job claim back.
            try:
                runtime.claim_next()
                raise AssertionError("duplicate outbox event unexpectedly committed")
            except psycopg.errors.UniqueViolation:
                assert runtime.get(user_a, first.job.job_id).status.value == "queued"
                checks.append("outbox failure rolled back the job transition")

            durable_repo = PostgresJobRepository(connect)
            durable_runtime = JobRuntime(
                durable_repo,
                clock=lambda: datetime.now(timezone.utc),
                lease_duration=timedelta(minutes=5),
            )
            with ThreadPoolExecutor(max_workers=2) as executor:
                claims = list(executor.map(lambda _: durable_runtime.claim_next(), range(2)))
            leases = [claim for claim in claims if claim is not None]
            assert len(leases) == 1
            lease = leases[0]
            checks.append("two concurrent workers produced one lease")

            durable_runtime.cancel(user_a, first.job.job_id)
            stopped = durable_runtime.finish(lease, JobOutcome.SUCCEEDED)
            assert stopped.status.value == "cancelled"
            checks.append("running cancellation stopped at the lease boundary")

            for token in (None, token_a):
                headers = api_headers(anon_key, token)
                response = client.get(
                    f"{url}/rest/v1/workflow_jobs?select=job_id", headers=headers
                )
                assert response.status_code in {401, 403}
            checks.append("anonymous and authenticated browsers were denied")

            outbox = PostgresOutboxRepository(connect)
            published = 0
            first_outbox_lease = outbox.claim_next()
            assert first_outbox_lease is not None
            wrong_lease = OutboxLease(first_outbox_lease.event, uuid4())
            try:
                outbox.acknowledge(wrong_lease)
                raise AssertionError("wrong outbox lease was acknowledged")
            except OutboxLeaseLost:
                checks.append("stale outbox publisher was rejected")
            failed_delivery = outbox.record_failure(
                first_outbox_lease,
                ErrorCode.DEPENDENCY_FAILED,
                retry_delay=timedelta(seconds=1),
            )
            assert failed_delivery.last_error_code == ErrorCode.DEPENDENCY_FAILED
            checks.append("failed delivery was safely scheduled for retry")
            deadline = monotonic() + 15
            while published < 4 and monotonic() < deadline:
                outbox_lease = outbox.claim_next()
                if outbox_lease is None:
                    sleep(0.25)
                    continue
                outbox.acknowledge(outbox_lease)
                published += 1
            assert published == 4
            checks.append("all four state events were leased and acknowledged")
        finally:
            for user_id in reversed(created_users):
                delete_user(client, url, service_key, user_id)

    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "select count(*) from public.platform_commands where tenant_id = any(%s)",
                (created_users,),
            )
            cleanup_verified = cursor.fetchone()[0] == 0
    if not cleanup_verified:
        raise RuntimeError("probe cleanup left workflow rows")
    checks.append("temporary users and cascading workflow rows were removed")
    report = write_report(project_ref, checks, cleanup_verified)
    print(f"S3 Postgres runtime probe passed ({len(checks)} checks)")
    print(f"Sanitized evidence: {report}")


if __name__ == "__main__":
    main()
