#!/usr/bin/env python3
"""Resolve an immutable main source and require its completed verification run."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

REPO = 'hebi10/subtitle-workbench'
WORKFLOW = '.github/workflows/verify.yml'
REQUIRED_JOBS = {'Web unit and UI tests', 'Android unit, lint and debug APK'}


class SourceError(RuntimeError):
    pass


def resolve(env, event):
    if env.get('GITHUB_REPOSITORY') != REPO:
        raise SourceError('Release workflow is restricted to ' + REPO)
    if env.get('GITHUB_EVENT_NAME') == 'workflow_dispatch':
        if env.get('GITHUB_REF') != 'refs/heads/main':
            raise SourceError('Manual Play workflows must run from main')
        sha = env.get('GITHUB_SHA', '')
    elif env.get('GITHUB_EVENT_NAME') == 'workflow_run':
        run = event.get('workflow_run', {})
        if (run.get('name') != 'Verify web and Android' or run.get('path') != WORKFLOW or run.get('event') != 'push'
                or run.get('conclusion') != 'success' or run.get('head_branch') != 'main'
                or run.get('head_repository', {}).get('full_name') != REPO):
            raise SourceError('Automatic deploy requires a successful same-repository main push verification')
        sha = run.get('head_sha', '')
    else:
        raise SourceError('Unsupported release event')
    if not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise SourceError('Release source must be a complete immutable commit SHA')
    return sha


def require_current_main(sha, current_main):
    if not re.fullmatch(r'[a-f0-9]{40}', sha) or sha != current_main:
        raise SourceError('Release source is stale; rerun from the current verified main commit')


def verify_ci(sha, run, jobs):
    if (run.get('head_sha') != sha or run.get('head_branch') != 'main' or run.get('conclusion') != 'success'
            or run.get('event') not in ('push', 'workflow_dispatch') or run.get('path') != WORKFLOW):
        raise SourceError('Required main verification has not succeeded for this exact source SHA')
    successful = {job.get('name') for job in jobs if job.get('conclusion') == 'success'}
    if not REQUIRED_JOBS.issubset(successful):
        raise SourceError('Required web/UI and Android unit/lint/build jobs must both succeed')


def gh(path):
    result = subprocess.run(['gh', 'api', path], capture_output=True, check=False, text=True)
    if result.returncode:
        raise SourceError('Could not read required GitHub verification metadata')
    try:
        return json.loads(result.stdout)
    except ValueError:
        raise SourceError('Invalid GitHub verification metadata') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assert-current', metavar='SHA')
    args = parser.parse_args()
    try:
        if args.assert_current:
            current = gh(f'repos/{REPO}/git/ref/heads/main')['object']['sha']
            require_current_main(args.assert_current, current)
            print('Release source still matches current main')
            return 0
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
        sha = resolve(os.environ, event)
        current = gh(f'repos/{REPO}/git/ref/heads/main')['object']['sha']
        require_current_main(sha, current)
        ancestry = subprocess.run(['git', 'merge-base', '--is-ancestor', sha, 'origin/main'], capture_output=True, check=False)
        if ancestry.returncode:
            raise SourceError('Release source is not an ancestor of the trusted main branch')
        runs = gh(f'repos/{REPO}/actions/workflows/verify.yml/runs?head_sha={sha}&branch=main&per_page=100')['workflow_runs']
        candidates = [run for run in runs if run.get('conclusion') == 'success' and run.get('event') in ('push', 'workflow_dispatch')]
        if not candidates:
            raise SourceError('Required Verify web and Android run is missing for the exact main source SHA')
        run = max(candidates, key=lambda value: value['id'])
        jobs = gh(f'repos/{REPO}/actions/runs/{run["id"]}/jobs?per_page=100')['jobs']
        verify_ci(sha, run, jobs)
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            output.write(f'sha={sha}\nverify_run_id={run["id"]}\n')
        print(f'Trusted main source {sha}; required CI run {run["id"]} passed')
        return 0
    except (SourceError, KeyError, OSError, ValueError) as error:
        message = str(error) if isinstance(error, SourceError) else 'Source metadata is missing or invalid'
        print('Release source check failed: ' + message, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
