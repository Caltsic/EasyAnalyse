#!/usr/bin/env python3
"""Owner-safe run lock helper for EasyAnalyse autonomous builder.

This script intentionally has no third-party dependencies. It is used by
fresh cron supervisors to avoid concurrent agents editing the same git branch.

Usage:
  python automation/autonomous_lock.py acquire --task M3-T1
  python automation/autonomous_lock.py release --run-id <runId>
  python automation/autonomous_lock.py status

Exit codes:
  0  acquired/released/status ok
  75 lock is held by a non-stale run or by another owner
  2  usage or unexpected lock handling error
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LOCK_PATH = Path("automation/.autonomous_run.lock")
RECLAIM_SUFFIX = ".reclaim"
DEFAULT_TTL_SECONDS = 6 * 60 * 60


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat().replace("+00:00", "Z")


def parse_iso(value: Any) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        text = value.replace("Z", "+00:00")
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return None


def read_lock(path: Path = LOCK_PATH) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
        return {"malformed": True, "rawType": type(data).__name__}
    except FileNotFoundError:
        return {}
    except Exception as exc:  # malformed/truncated locks should be explicit
        return {"malformed": True, "error": f"{type(exc).__name__}: {exc}"}


def lock_age_seconds(path: Path, data: dict[str, Any]) -> float:
    started_ts = parse_iso(data.get("startedAt"))
    if started_ts is not None:
        return max(0.0, time.time() - started_ts)
    try:
        return max(0.0, time.time() - path.stat().st_mtime)
    except FileNotFoundError:
        return 0.0


def make_payload(task: str | None, run_id: str) -> dict[str, Any]:
    return {
        "job": "EasyAnalyse Agent Branch Autonomous Builder",
        "runId": run_id,
        "startedAt": iso_now(),
        "pid": os.getpid(),
        "host": socket.gethostname(),
        "task": task or "unknown",
        "branch": "agent",
        "lockVersion": 2,
    }


def atomic_create(path: Path, payload: dict[str, Any]) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    try:
        fd = os.open(str(path), flags, 0o600)
    except FileExistsError:
        return False
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    return True


def emit_acquired(path: Path, payload: dict[str, Any]) -> None:
    print("AUTONOMOUS_LOCK=ACQUIRED")
    print(f"lock_file={path}")
    print(f"runId={payload['runId']}")
    print(f"startedAt={payload['startedAt']}")


def emit_held(path: Path, age: float, ttl: int, data: dict[str, Any]) -> None:
    print("AUTONOMOUS_LOCK=HELD")
    print(f"lock_file={path}")
    print(f"age_seconds={int(age)}")
    print(f"ttl_seconds={ttl}")
    if data.get("runId"):
        print(f"heldRunId={data['runId']}")
    print("Action: skip this cron round without git changes.")


def acquire_reclaim_mutex(path: Path) -> bool:
    return atomic_create(path, {"startedAt": iso_now(), "pid": os.getpid(), "host": socket.gethostname()})


def release_reclaim_mutex(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def acquire(args: argparse.Namespace) -> int:
    path = Path(args.lock_file)
    reclaim_path = Path(args.reclaim_file) if args.reclaim_file else Path(f"{path}{RECLAIM_SUFFIX}")
    ttl = int(args.ttl_seconds)
    task = args.task
    run_id = args.run_id or str(uuid.uuid4())

    for _attempt in range(3):
        payload = make_payload(task, run_id)
        if atomic_create(path, payload):
            # Verify we still own the final lock. This catches unexpected filesystem races.
            if read_lock(path).get("runId") != run_id:
                print("AUTONOMOUS_LOCK=FAILED final owner verification mismatch", file=sys.stderr)
                return 2
            emit_acquired(path, payload)
            return 0

        data = read_lock(path)
        if data.get("runId") == run_id:
            print("AUTONOMOUS_LOCK=ALREADY_HELD_BY_RUN")
            print(f"lock_file={path}")
            print(f"runId={run_id}")
            return 0

        age = lock_age_seconds(path, data)
        if age <= ttl:
            emit_held(path, age, ttl, data)
            return 75

        if not acquire_reclaim_mutex(reclaim_path):
            print("AUTONOMOUS_LOCK=HELD")
            print(f"lock_file={path}")
            print("reclaim_mutex=held")
            print("Action: skip this cron round without git changes.")
            return 75

        try:
            latest = read_lock(path)
            latest_age = lock_age_seconds(path, latest)
            if latest.get("runId") != data.get("runId") or latest.get("startedAt") != data.get("startedAt"):
                # Another runner changed the lock after our first read; do not delete it.
                emit_held(path, latest_age, ttl, latest)
                return 75
            if latest_age <= ttl:
                emit_held(path, latest_age, ttl, latest)
                return 75

            print("AUTONOMOUS_LOCK=STALE")
            print(f"lock_file={path}")
            print(f"age_seconds={int(latest_age)}")
            print(f"ttl_seconds={ttl}")
            print(f"old_lock_summary={json.dumps(latest, ensure_ascii=False, sort_keys=True)[:500]}")
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            except Exception as exc:
                print(f"failed_to_remove_stale_lock={type(exc).__name__}: {exc}", file=sys.stderr)
                return 2
        finally:
            release_reclaim_mutex(reclaim_path)
        # Loop to acquire after stale deletion; if another process wins, next attempt reports held.

    print("AUTONOMOUS_LOCK=FAILED")
    return 2


def release(args: argparse.Namespace) -> int:
    path = Path(args.lock_file)
    reclaim_path = Path(args.reclaim_file) if args.reclaim_file else Path(f"{path}{RECLAIM_SUFFIX}")

    if not acquire_reclaim_mutex(reclaim_path):
        print("AUTONOMOUS_LOCK=RELEASE_BLOCKED reclaim mutex held")
        return 75

    try:
        data = read_lock(path)
        if not data:
            print("AUTONOMOUS_LOCK=ABSENT")
            return 0

        if not args.force:
            if not args.run_id:
                print("AUTONOMOUS_LOCK=RELEASE_REFUSED missing --run-id", file=sys.stderr)
                return 2
            if data.get("runId") != args.run_id:
                print("AUTONOMOUS_LOCK=NOT_OWNER")
                print(f"lock_file={path}")
                print(f"expectedRunId={data.get('runId', '')}")
                print(f"providedRunId={args.run_id}")
                return 75

        latest = read_lock(path)
        if latest.get("runId") != data.get("runId") or latest.get("startedAt") != data.get("startedAt"):
            print("AUTONOMOUS_LOCK=RELEASE_REFUSED lock changed before unlink")
            return 75

        try:
            path.unlink()
            print("AUTONOMOUS_LOCK=RELEASED")
            print(f"released_lock_summary={json.dumps(data, ensure_ascii=False, sort_keys=True)[:500]}")
            return 0
        except FileNotFoundError:
            print("AUTONOMOUS_LOCK=ABSENT")
            return 0
        except Exception as exc:
            print(f"AUTONOMOUS_LOCK=RELEASE_FAILED {type(exc).__name__}: {exc}", file=sys.stderr)
            return 2
    finally:
        release_reclaim_mutex(reclaim_path)


def status(args: argparse.Namespace) -> int:
    path = Path(args.lock_file)
    if not path.exists():
        print("AUTONOMOUS_LOCK=ABSENT")
        return 0
    data = read_lock(path)
    age = lock_age_seconds(path, data)
    print("AUTONOMOUS_LOCK=PRESENT")
    print(f"lock_file={path}")
    print(f"age_seconds={int(age)}")
    if data.get("runId"):
        print(f"runId={data['runId']}")
    print(f"lock_summary={json.dumps(data, ensure_ascii=False, sort_keys=True)[:1000]}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock-file", default=str(LOCK_PATH))
    parser.add_argument("--reclaim-file", default=None)
    sub = parser.add_subparsers(dest="command", required=True)

    p_acquire = sub.add_parser("acquire")
    p_acquire.add_argument("--task", default="unknown")
    p_acquire.add_argument("--ttl-seconds", type=int, default=DEFAULT_TTL_SECONDS)
    p_acquire.add_argument("--run-id", default=None)
    p_acquire.set_defaults(func=acquire)

    p_release = sub.add_parser("release")
    p_release.add_argument("--run-id", default=None)
    p_release.add_argument("--force", action="store_true", help="manual emergency cleanup only; never use in normal cron flow")
    p_release.set_defaults(func=release)

    p_status = sub.add_parser("status")
    p_status.set_defaults(func=status)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
