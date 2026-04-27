#!/usr/bin/env python3
"""Atomic run lock helper for EasyAnalyse autonomous builder.

This script intentionally has no third-party dependencies. It is used by
fresh cron supervisors to avoid concurrent agents editing the same git branch.

Usage:
  python automation/autonomous_lock.py acquire --task M3-T1
  python automation/autonomous_lock.py release
  python automation/autonomous_lock.py status

Exit codes:
  0  acquired/released/status ok
  75 lock is held by a non-stale run; caller should skip this cron round
  2  usage or unexpected lock handling error
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LOCK_PATH = Path("automation/.autonomous_run.lock")
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


def make_payload(task: str | None) -> dict[str, Any]:
    return {
        "job": "EasyAnalyse Agent Branch Autonomous Builder",
        "startedAt": iso_now(),
        "pid": os.getpid(),
        "host": socket.gethostname(),
        "task": task or "unknown",
        "branch": "agent",
        "lockVersion": 1,
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


def acquire(args: argparse.Namespace) -> int:
    path = Path(args.lock_file)
    ttl = int(args.ttl_seconds)
    task = args.task

    for attempt in range(2):
        payload = make_payload(task)
        if atomic_create(path, payload):
            print("AUTONOMOUS_LOCK=ACQUIRED")
            print(f"lock_file={path}")
            print(f"startedAt={payload['startedAt']}")
            return 0

        data = read_lock(path)
        age = lock_age_seconds(path, data)
        if age <= ttl:
            print("AUTONOMOUS_LOCK=HELD")
            print(f"lock_file={path}")
            print(f"age_seconds={int(age)}")
            print(f"ttl_seconds={ttl}")
            print("Action: skip this cron round without git changes.")
            return 75

        # Stale or malformed old lock whose mtime exceeds TTL. Remove and retry once.
        print("AUTONOMOUS_LOCK=STALE")
        print(f"lock_file={path}")
        print(f"age_seconds={int(age)}")
        print(f"ttl_seconds={ttl}")
        print(f"old_lock_summary={json.dumps(data, ensure_ascii=False, sort_keys=True)[:500]}")
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except Exception as exc:
            print(f"failed_to_remove_stale_lock={type(exc).__name__}: {exc}", file=sys.stderr)
            return 2
        # Loop once to acquire after deletion; if another process wins, second loop reports held.

    print("AUTONOMOUS_LOCK=FAILED")
    return 2


def release(args: argparse.Namespace) -> int:
    path = Path(args.lock_file)
    try:
        data = read_lock(path)
        path.unlink()
        print("AUTONOMOUS_LOCK=RELEASED")
        if data:
            print(f"released_lock_summary={json.dumps(data, ensure_ascii=False, sort_keys=True)[:500]}")
        return 0
    except FileNotFoundError:
        print("AUTONOMOUS_LOCK=ABSENT")
        return 0
    except Exception as exc:
        print(f"AUTONOMOUS_LOCK=RELEASE_FAILED {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


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
    print(f"lock_summary={json.dumps(data, ensure_ascii=False, sort_keys=True)[:1000]}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock-file", default=str(LOCK_PATH))
    sub = parser.add_subparsers(dest="command", required=True)

    p_acquire = sub.add_parser("acquire")
    p_acquire.add_argument("--task", default="unknown")
    p_acquire.add_argument("--ttl-seconds", type=int, default=DEFAULT_TTL_SECONDS)
    p_acquire.set_defaults(func=acquire)

    p_release = sub.add_parser("release")
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
