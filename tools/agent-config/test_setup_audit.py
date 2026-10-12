#!/usr/bin/env python3
"""Offline pre-push audit seam: own checkout, fixed budgets, both failures propagate."""

from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SetupAuditChecks(unittest.TestCase):
    def audit(self, config_rc=0, skill_rc=0):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            scripts = root / "scripts"
            scripts.mkdir()
            shutil.copy2(ROOT / "scripts/run-agentic-setup-audit.sh", scripts)
            (scripts / "run-agent-instructions-budget.sh").write_text(
                '#!/usr/bin/env bash\nset -euo pipefail\n'
                'printf "config:%s:%s:%s\\n" "$AGENT_CONFIG_ROOT" '
                '"${AGENT_INSTRUCTIONS_BUDGET_BYTES-unset}" '
                '"${AGENT_EFFECTIVE_INSTRUCTIONS_BUDGET_BYTES-unset}"\n'
                'exit "$FIXTURE_CONFIG_RC"\n')
            (scripts / "run-skill-audit.sh").write_text(
                '#!/usr/bin/env bash\nset -euo pipefail\nprintf "skill\\n"\nexit "$FIXTURE_SKILL_RC"\n')
            for script in scripts.iterdir():
                script.chmod(0o755)
            before = {p.name: p.read_bytes() for p in scripts.iterdir()}
            env = dict(os.environ, AGENT_CONFIG_ROOT="/synthetic/other-checkout",
                       AGENT_INSTRUCTIONS_BUDGET_BYTES="999999", AGENT_EFFECTIVE_INSTRUCTIONS_BUDGET_BYTES="999999",
                       FIXTURE_CONFIG_RC=str(config_rc), FIXTURE_SKILL_RC=str(skill_rc))
            result = subprocess.run([str(scripts / "run-agentic-setup-audit.sh")], cwd=root,
                                    env=env, text=True, capture_output=True, timeout=5)
            self.assertEqual(before, {p.name: p.read_bytes() for p in scripts.iterdir()})
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["scripts"])
            self.assertTrue(result.stdout.startswith(f"config:{root}:unset:unset\n"))
            return result

    def test_foreign_root_and_relaxed_budgets_cannot_change_audited_checkout(self):
        result = self.audit()
        self.assertEqual(result.returncode, 0)
        self.assertIn("\nskill\n", result.stdout)
        self.assertIn("separate evidence", result.stdout)

    def test_config_failure_stops_before_skill_and_success_message(self):
        result = self.audit(config_rc=1)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("\nskill\n", result.stdout)
        self.assertNotIn("source contracts verified", result.stdout)

    def test_skill_runtime_error_is_not_a_pass(self):
        result = self.audit(skill_rc=2)
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("source contracts verified", result.stdout)


if __name__ == "__main__":
    unittest.main()
