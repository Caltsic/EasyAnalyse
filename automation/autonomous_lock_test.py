#!/usr/bin/env python3
"""Regression tests for automation/autonomous_lock.py.

Run from repository root:
  python3 automation/autonomous_lock_test.py
"""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'automation/autonomous_lock.py'


def run(args: list[str], lock_file: Path, reclaim_file: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ['python3', str(HELPER), '--lock-file', str(lock_file), '--reclaim-file', str(reclaim_file), *args],
        cwd=str(ROOT),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=10,
    )


def extract_run_id(stdout: str) -> str:
    for line in stdout.splitlines():
        if line.startswith('runId='):
            return line.split('=', 1)[1].strip()
    raise AssertionError(f'runId not found in output:\n{stdout}')


def test_acquire_prints_and_persists_run_id(tmp: Path) -> None:
    lock = tmp / 'run.lock'
    reclaim = tmp / 'run.lock.reclaim'
    proc = run(['acquire', '--task', 'LOCK-TEST'], lock, reclaim)
    assert proc.returncode == 0, proc.stdout
    assert 'AUTONOMOUS_LOCK=ACQUIRED' in proc.stdout
    run_id = extract_run_id(proc.stdout)
    data = json.loads(lock.read_text())
    assert data['runId'] == run_id
    assert data['task'] == 'LOCK-TEST'


def test_release_requires_matching_run_id(tmp: Path) -> None:
    lock = tmp / 'run.lock'
    reclaim = tmp / 'run.lock.reclaim'
    proc = run(['acquire', '--task', 'LOCK-TEST'], lock, reclaim)
    run_id = extract_run_id(proc.stdout)

    wrong = run(['release', '--run-id', 'wrong-owner'], lock, reclaim)
    assert wrong.returncode == 75, wrong.stdout
    assert 'AUTONOMOUS_LOCK=NOT_OWNER' in wrong.stdout
    assert lock.exists()

    ok = run(['release', '--run-id', run_id], lock, reclaim)
    assert ok.returncode == 0, ok.stdout
    assert 'AUTONOMOUS_LOCK=RELEASED' in ok.stdout
    assert not lock.exists()


def test_release_without_run_id_is_refused(tmp: Path) -> None:
    lock = tmp / 'run.lock'
    reclaim = tmp / 'run.lock.reclaim'
    proc = run(['acquire', '--task', 'LOCK-TEST'], lock, reclaim)
    extract_run_id(proc.stdout)

    refused = run(['release'], lock, reclaim)
    assert refused.returncode == 2, refused.stdout
    assert 'RELEASE_REFUSED' in refused.stdout
    assert lock.exists()


def test_stale_reclaim_does_not_delete_changed_lock(tmp: Path) -> None:
    lock = tmp / 'run.lock'
    reclaim = tmp / 'run.lock.reclaim'
    old_payload = {
        'runId': 'old-run',
        'startedAt': '2000-01-01T00:00:00Z',
        'task': 'old',
        'lockVersion': 2,
    }
    lock.write_text(json.dumps(old_payload))

    proc = run(['acquire', '--task', 'NEW', '--ttl-seconds', '1'], lock, reclaim)
    assert proc.returncode == 0, proc.stdout
    new_run_id = extract_run_id(proc.stdout)
    assert json.loads(lock.read_text())['runId'] == new_run_id

    old_release = run(['release', '--run-id', 'old-run'], lock, reclaim)
    assert old_release.returncode == 75, old_release.stdout
    assert json.loads(lock.read_text())['runId'] == new_run_id


def main() -> int:
    with tempfile.TemporaryDirectory() as temp:
        base = Path(temp)
        for test in [
            test_acquire_prints_and_persists_run_id,
            test_release_requires_matching_run_id,
            test_release_without_run_id_is_refused,
            test_stale_reclaim_does_not_delete_changed_lock,
        ]:
            test_dir = base / test.__name__
            test_dir.mkdir()
            test(test_dir)
    print('autonomous_lock_test: ok')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
