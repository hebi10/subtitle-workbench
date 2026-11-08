import importlib.util
import pathlib
import unittest

SCRIPT = pathlib.Path(__file__).parents[1] / 'source.py'
spec = importlib.util.spec_from_file_location('source', SCRIPT)
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
SHA = 'a' * 40
REPO = 'hebi10/subtitle-workbench'


class SourceTests(unittest.TestCase):
    def test_manual_dispatch_only_accepts_main(self):
        for ref in ('refs/heads/feature', 'refs/tags/v1'):
            with self.assertRaises(source.SourceError):
                source.resolve({'GITHUB_REPOSITORY': REPO, 'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REF': ref, 'GITHUB_SHA': SHA}, {})
        self.assertEqual(source.resolve({'GITHUB_REPOSITORY': REPO, 'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REF': 'refs/heads/main', 'GITHUB_SHA': SHA}, {}), SHA)

    def test_automatic_source_must_be_successful_same_repo_main_push(self):
        run = {'name': 'Verify web and Android', 'path': '.github/workflows/verify.yml', 'event': 'push', 'conclusion': 'success',
               'head_branch': 'main', 'head_sha': SHA, 'head_repository': {'full_name': REPO}}
        env = {'GITHUB_REPOSITORY': REPO, 'GITHUB_EVENT_NAME': 'workflow_run'}
        self.assertEqual(source.resolve(env, {'workflow_run': run}), SHA)
        for key, value in [('event', 'pull_request'), ('head_branch', 'feature'), ('conclusion', 'failure'), ('path', 'other.yml')]:
            invalid = dict(run, **{key: value})
            with self.assertRaises(source.SourceError):
                source.resolve(env, {'workflow_run': invalid})
        run['head_repository'] = {'full_name': 'attacker/fork'}
        with self.assertRaises(source.SourceError):
            source.resolve(env, {'workflow_run': run})

    def test_stale_main_source_fails_before_deployment(self):
        source.require_current_main(SHA, SHA)
        with self.assertRaisesRegex(source.SourceError, 'stale'):
            source.require_current_main(SHA, 'b' * 40)

    def test_deploy_requires_both_completed_verify_jobs_on_exact_sha(self):
        run = {'head_sha': SHA, 'head_branch': 'main', 'event': 'push', 'conclusion': 'success', 'path': '.github/workflows/verify.yml'}
        jobs = [{'name': 'Web unit and UI tests', 'conclusion': 'success'}, {'name': 'Android unit, lint and debug APK', 'conclusion': 'success'}]
        source.verify_ci(SHA, run, jobs)
        for invalid_jobs in (jobs[:1], [dict(jobs[0], conclusion='skipped'), jobs[1]]):
            with self.assertRaises(source.SourceError):
                source.verify_ci(SHA, run, invalid_jobs)
        with self.assertRaises(source.SourceError):
            source.verify_ci('b' * 40, run, jobs)


if __name__ == '__main__':
    unittest.main()
