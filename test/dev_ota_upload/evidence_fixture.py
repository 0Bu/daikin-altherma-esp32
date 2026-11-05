"""Offline local-evidence tests. Git writes/builds/review events exist only in synthetic fixtures."""
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/dev_ota"))
import evidence as e


def report(source, role="doc_drift_checker", coordinator="coordinator-current", scope=None, build_sha256="b" * 64,
           profile_sha256="a" * 64, cli_thread_id="11111111-1111-4111-8111-111111111111", **changes):
    record = {"source_sha256": source, "build_sha256": build_sha256, "role": role,
              "profile_sha256": profile_sha256, "execution_kind": "independent-profile-session",
              "coordinator_id": coordinator, "sandbox_mode": "read-only", "approval_policy": "never",
              "complete": True, "blocking_findings": 0, "scope": scope or ["."], **changes}
    startup = {"type": "thread.started", "thread_id": cli_thread_id}
    message = {"type": "item.completed", "item": {"type": "agent_message", "text":
               "Independent fixture review: source paths and the complete local diff were inspected. " * 4 +
               "\n" + e.MARKER + json.dumps(record)}}
    return (json.dumps(startup) + "\n" + json.dumps(message) + "\n" + json.dumps({"type": "turn.completed"}) + "\n").encode()


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name).resolve()
        self.root = self.base / "source"
        self.root.mkdir()
        self.path = self.base / "private" / "receipt.json"
        for relative in ("tools/agent-hooks/require-pr-gates.sh", ".agents/agents/x10a-decode-reviewer.toml",
                         ".agents/agents/doc-drift-checker.toml", ".agents/agents/heap-safety-reviewer.toml",
                         "partitions.csv", "scripts/ci-build-all.sh", "sdkconfig.defaults"):
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, target)
        (self.root / ".gitignore").write_text("build/\nmanaged_components/\nsdkconfig\nsdkconfig.old\n*.bin\n*.elf\n*.pem\n__pycache__/\n")
        (self.root / "source.cpp").write_text("int source = 1;\n")
        def git(*args):
            return subprocess.run(["git", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", *args],
                                  cwd=self.root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        self.git = git
        git("init", "-q")
        git("add", ".")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture base")
        self.head = git("rev-parse", "HEAD").stdout.strip()
        git("update-ref", "refs/remotes/origin/main", self.head.decode())
        (self.root / "source.cpp").write_text("int source = 2;\n")
        (self.root / "new-source.py").write_text("new_source = True\n")
        self.document = e.create_receipt(self.path, "coordinator-current", self.root)
        self.source = self.document["source"]["sha256"]
        self.elf_bytes = b"synthetic public ELF fixture"
        self.unsigned = bytearray(4096)
        self.unsigned[176:208] = hashlib.sha256(self.elf_bytes).digest()
        self.signed = bytes(self.unsigned) + b"synthetic signature".ljust(4096, b"\xff")

    def tearDown(self):
        self.temporary.cleanup()

    def fake_capture(self, argv, log, root, environment=None, timeout=1800):
        if argv[0].endswith("idf-docker.sh") and argv[1] == "idf.py":
            build_source = Path(argv[0]).parents[1]
            (build_source / "build").mkdir()
            (build_source / "sdkconfig").write_text((build_source / "sdkconfig.defaults").read_text() +
                '\nCONFIG_PARTITION_TABLE_FILENAME="partitions.csv"\n# CONFIG_SECURE_BOOT is not set\n')
            # sdkconfig is generated output and follows the repository's real ignore policy.
            (build_source / "build/daikin-altherma-esp32.bin").write_bytes(self.unsigned)
            (build_source / "build/daikin-altherma-esp32.elf").write_bytes(self.elf_bytes)
        data = b"Canonical fixture execution completed successfully\n"
        if argv[0].endswith("run-codex-review.sh"):
            data = report(self.source, argv[1], build_sha256=argv[argv.index("--local-ota-build-sha256") + 1],
                          profile_sha256=e.profile_sha256(argv[1], self.root))
        log.write_bytes(data)
        log.chmod(0o600)
        return {"argv": argv, "exit_code": 0, "started_ns": 10, "finished_ns": 20,
                "log": log.name, "log_sha256": e.sha256(data)}

    def complete(self):
        with patch.object(e, "capture", side_effect=self.fake_capture), \
             patch.object(e.shutil, "which", return_value="/fixture/clang-format-18"):
            for name in self.document["required"]["checks"]:
                e.run_check(self.path, name, self.root)
            for role in self.document["required"]["reviews"]:
                e.run_review(self.path, role, ["."], "Review the complete local fixture", self.root)
        return e.load_receipt(self.path, self.source, self.root)

    def verify(self):
        return e.verify_evidence(self.path, self.source, io.BytesIO(self.signed), self.root)

    def commit_candidate(self):
        self.git("add", ".")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture feature")
        self.path.unlink()
        self.document = e.create_receipt(self.path, "coordinator-current", self.root)
        self.source = self.document["source"]["sha256"]

    def test_full_dirty_source_needs_no_new_commit_and_includes_untracked(self):
        self.assertEqual(self.git("rev-parse", "HEAD").stdout.strip(), self.head)
        self.assertEqual(self.document["source"]["base"], self.head.decode())
        self.assertIn("new-source.py", self.document["source"]["changed_paths"])
        self.complete()
        binding = self.verify()
        self.assertEqual(binding["source_sha256"], self.source)
        self.assertEqual(binding["base"], self.head.decode())
        self.assertEqual(self.git("rev-parse", "HEAD").stdout.strip(), self.head)

    def test_clean_committed_http_and_ui_feature_keeps_full_scope_and_base_head_review(self):
        for relative in ("main/http_ota.cpp", "main/www/local-test.html"):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("synthetic committed feature\n")
        self.commit_candidate()
        self.assertEqual(self.git("status", "--porcelain").stdout, b"")
        source = self.document["source"]
        self.assertEqual(source["base"], self.head.decode())
        self.assertNotEqual(source["base"], source["head"])
        self.assertIn("main/http_ota.cpp", source["changed_paths"])
        self.assertIn("main/www/local-test.html", source["changed_paths"])
        self.assertIn("heap_safety_reviewer", self.document["required"]["reviews"])
        self.assertTrue({"ui", "browser", "localization", "idf-matrix"}.issubset(self.document["required"]["checks"]))
        good = self.complete()
        for review in good["reviews"].values():
            self.assertEqual(review["execution"]["argv"][2:4], [source["base"], source["head"]])
        self.verify()
        for defect in ("head-head", "missing-heap", "missing-ui"):
            document = deepcopy(good)
            with self.subTest(defect=defect):
                if defect == "head-head":
                    document["reviews"]["doc_drift_checker"]["execution"]["argv"][2] = source["head"]
                elif defect == "missing-heap":
                    del document["reviews"]["heap_safety_reviewer"]
                else:
                    del document["checks"]["ui"]
                e.save_receipt(self.path, document)
                with self.assertRaises(e.EvidenceError):
                    self.verify()

    def test_changed_comparison_base_invalidates_identical_source_and_completed_evidence(self):
        self.commit_candidate()
        self.complete()
        self.verify()
        previous = self.document["source"]
        self.git("update-ref", "refs/remotes/origin/main", previous["head"])
        current = e.source_snapshot(self.root)
        self.assertEqual(current["head"], previous["head"])
        self.assertEqual(current["entries"], previous["entries"])
        self.assertNotEqual(current["base"], previous["base"])
        self.assertNotEqual(current["sha256"], previous["sha256"])
        with self.assertRaises(e.EvidenceError):
            self.verify()

    def test_committed_deletion_remains_explicit_in_the_build_source_inventory(self):
        (self.root / "source.cpp").unlink()
        self.commit_candidate()
        source = self.document["source"]
        self.assertIn("source.cpp", source["changed_paths"])
        self.assertEqual(next(item for item in source["entries"] if item["path"] == "source.cpp"),
                         {"path": "source.cpp", "kind": "deleted"})
        self.complete()
        self.assertEqual(self.verify()["base"], self.head.decode())

    def test_missing_shallow_or_unrelated_comparison_history_stops_before_source_reads_or_actions(self):
        tree = self.git("rev-parse", "HEAD^{tree}").stdout.decode().strip()
        orphan = self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                          "commit-tree", tree, "-m", "unrelated fixture history").stdout.decode().strip()
        for defect in ("missing", "shallow", "unrelated"):
            with self.subTest(defect=defect):
                if defect == "missing":
                    self.git("update-ref", "-d", "refs/remotes/origin/main")
                elif defect == "shallow":
                    (self.root / ".git/shallow").write_bytes(self.head + b"\n")
                else:
                    self.git("update-ref", "refs/remotes/origin/main", orphan)
                with patch.object(e.repro, "_read_regular_at") as reader, self.assertRaises(e.EvidenceError):
                    e.source_snapshot(self.root)
                reader.assert_not_called()
                with patch.object(e, "capture") as runner, self.assertRaises(e.EvidenceError):
                    e.run_check(self.path, "host", self.root)
                runner.assert_not_called()
                (self.root / ".git/shallow").unlink(missing_ok=True)
                self.git("update-ref", "refs/remotes/origin/main", self.head.decode())

    def test_tracked_new_deleted_and_mode_changes_invalidate_every_record(self):
        original = (self.root / "source.cpp").read_bytes()
        for kind in ("tracked", "new", "deleted", "mode"):
            with self.subTest(kind=kind):
                if kind == "tracked":
                    (self.root / "source.cpp").write_bytes(b"changed again")
                elif kind == "new":
                    (self.root / "another.py").write_text("new = 1")
                elif kind == "deleted":
                    (self.root / "source.cpp").unlink()
                else:
                    (self.root / "source.cpp").chmod(0o755)
                with self.assertRaises(e.EvidenceError):
                    e.load_receipt(self.path, self.source, self.root)
                (self.root / "source.cpp").write_bytes(original)
                (self.root / "source.cpp").chmod(0o644)
                (self.root / "another.py").unlink(missing_ok=True)

    def test_private_inventory_paths_are_rejected_before_source_reads(self):
        # Synthetic name only; no credential material is read or generated.
        (self.root / "credentials.json").write_text("{}")
        with patch.object(e.repro, "_read_regular_at") as reader, self.assertRaises(e.EvidenceError):
            e.source_snapshot(self.root)
        reader.assert_not_called()

    def test_missing_failed_stale_or_changed_check_and_review_are_rejected(self):
        good = self.complete()
        for defect in ("missing-check", "failed-check", "stale-check", "changed-log", "missing-review", "unobserved-review"):
            document = deepcopy(good)
            with self.subTest(defect=defect):
                if defect == "missing-check":
                    del document["checks"]["host"]
                elif defect == "failed-check":
                    document["checks"]["host"]["exit_code"] = 1
                elif defect == "stale-check":
                    document["checks"]["host"]["source_sha256"] = "b" * 64
                elif defect == "changed-log":
                    document["checks"]["host"]["log_sha256"] = "b" * 64
                elif defect == "missing-review":
                    del document["reviews"]["doc_drift_checker"]
                else:
                    document["reviews"]["doc_drift_checker"]["approval_policy"] = "unobserved"
                e.save_receipt(self.path, document)
                with self.assertRaises(e.EvidenceError):
                    self.verify()
        e.save_receipt(self.path, good)
        self.verify()

    def test_latest_timeout_or_parse_failure_invalidates_a_previous_pass(self):
        good = self.complete()
        with patch.object(e, "capture", side_effect=subprocess.TimeoutExpired("fixture", 1)), \
             self.assertRaises(subprocess.TimeoutExpired):
            e.run_check(self.path, "host", self.root)
        with self.assertRaises(e.EvidenceError):
            self.verify()
        e.save_receipt(self.path, good)
        def bad_report(*args, **kwargs):
            execution = self.fake_capture(*args, **kwargs)
            log = args[1]
            log.write_bytes(b"Review incomplete: no actual observed permissions\n")
            execution["log_sha256"] = e.sha256(log.read_bytes())
            return execution
        with patch.object(e, "capture", side_effect=bad_report), self.assertRaises(e.EvidenceError):
            e.run_review(self.path, "doc_drift_checker", ["."], "Review again", self.root)
        with self.assertRaises(e.EvidenceError):
            self.verify()

    def test_upload_worker_runtime_evidence_is_required_and_cannot_be_substituted(self):
        good = self.complete()
        self.assertIn("runtime", good["required"]["checks"])
        for defect in ("missing", "failed", "stale", "different-command", "removed-requirement"):
            document = deepcopy(good)
            with self.subTest(defect=defect):
                if defect == "missing":
                    del document["checks"]["runtime"]
                elif defect == "failed":
                    document["checks"]["runtime"]["exit_code"] = 1
                elif defect == "stale":
                    document["checks"]["runtime"]["source_sha256"] = "b" * 64
                elif defect == "different-command":
                    document["checks"]["runtime"]["argv"] = document["checks"]["host"]["argv"]
                else:
                    document["required"]["checks"].remove("runtime")
                e.save_receipt(self.path, document)
                with self.assertRaises(e.EvidenceError):
                    self.verify()
        e.save_receipt(self.path, good)
        self.verify()

    def test_unsigned_elf_signed_prefix_and_extra_build_inputs_are_bound(self):
        good = self.complete()
        build = good["checks"]["build"]
        for field in ("unsigned_image", "elf"):
            path = Path(build[field]["path"])
            previous = path.read_bytes()
            path.write_bytes(previous + b"changed")
            with self.subTest(field=field), self.assertRaises(e.EvidenceError):
                self.verify()
            path.write_bytes(previous)
        altered = bytearray(self.signed)
        altered[0] ^= 1
        with self.assertRaises(e.EvidenceError):
            e.verify_evidence(self.path, self.source, io.BytesIO(altered), self.root)
        with self.assertRaises(e.EvidenceError):
            e.verify_evidence(self.path, self.source, io.BytesIO(self.unsigned), self.root)
        injected = Path(build["build_source"]) / "main/injected.cpp"
        injected.parent.mkdir(exist_ok=True)
        injected.write_text("int unexpected_compile_input = 1;")
        with self.assertRaises(e.EvidenceError):
            self.verify()

    def test_signed_size_prediction_preserves_exact_ci_boundary_and_padding(self):
        self.unsigned.extend(b"\x00" * (0x1e7000 - len(self.unsigned)))
        with patch.object(e, "capture", side_effect=self.fake_capture):
            document = e.run_check(self.path, "build", self.root)
        build = document["checks"]["build"]
        build_source = Path(build["build_source"])
        capacity = build["capacity"]
        limit = capacity["unsigned_ci_limit_bytes"]
        self.assertEqual(capacity["signed_ci_limit_bytes"], 0x1e8000)
        self.assertEqual(limit, 0x1e7000)
        e.verify_build(document, self.path, self.root)
        for size in (limit - 1, limit):
            with self.subTest(size=size):
                predicted = e.signed_capacity(size, build_source)
                self.assertEqual(predicted["predicted_signed_bytes"], capacity["signed_ci_limit_bytes"])
        for size in (limit + 1, capacity["slot_bytes"] - capacity["signature_sector_bytes"], capacity["slot_bytes"]):
            with self.subTest(size=size), self.assertRaises(e.EvidenceError):
                e.signed_capacity(size, build_source)
        for defect in ("missing", "changed", "config"):
            candidate = deepcopy(document)
            with self.subTest(defect=defect):
                if defect == "missing":
                    del candidate["checks"]["build"]["capacity"]
                elif defect == "changed":
                    candidate["checks"]["build"]["capacity"]["predicted_signed_bytes"] += 1
                else:
                    config = build_source / "sdkconfig"
                    config.write_text(config.read_text().replace("CONFIG_SECURE_SIGNED_APPS_RSA_SCHEME=y",
                                                                 "CONFIG_SECURE_SIGNED_APPS_RSA_SCHEME=n"))
                with self.assertRaises(e.EvidenceError):
                    e.verify_build(candidate, self.path, self.root)

    def test_oversize_successful_compile_is_retained_as_failed_validation_before_review(self):
        self.unsigned.extend(b"\x00" * (0x1f0000 - len(self.unsigned)))
        with patch.object(e, "capture", side_effect=self.fake_capture) as runner, self.assertRaises(e.EvidenceError):
            e.run_check(self.path, "build", self.root)
        self.assertEqual(runner.call_count, 1)  # No stack/reviewer/device action follows a known overflow.
        document = e.load_receipt(self.path, self.source, self.root)
        failed = document["checks"]["build"]
        self.assertEqual(failed["exit_code"], 0)  # Retain the real compiler exit, not a fabricated command failure.
        self.assertIn("exceeds OTA app slot", failed["validation_error"])
        with patch.object(e, "capture") as runner, self.assertRaises(e.EvidenceError):
            e.run_review(self.path, "doc_drift_checker", ["."], "Oversize build must not reach review", self.root)
        runner.assert_not_called()

    def test_verify_build_repeats_capacity_check_even_if_artifact_digest_is_rebound(self):
        with patch.object(e, "capture", side_effect=self.fake_capture):
            document = e.run_check(self.path, "build", self.root)
        build = document["checks"]["build"]
        image = Path(build["unsigned_image"]["path"])
        image.write_bytes(image.read_bytes().ljust(0x1f0000, b"\x00"))
        build["unsigned_image"] = e.file_record(image)
        with self.assertRaisesRegex(e.EvidenceError, "exceeds OTA app slot"):
            e.verify_build(document, self.path, self.root)

    def test_parallel_records_merge_and_duplicate_action_fails_closed(self):
        _, host = e.begin_action(self.path, "checks", "host", self.root)
        _, domain = e.begin_action(self.path, "checks", "domain", self.root)
        with self.assertRaises(e.EvidenceError):
            e.begin_action(self.path, "checks", "host", self.root)
        e.finish_action(self.path, "checks", "domain", domain, {"result": "domain"}, self.root)
        final = e.finish_action(self.path, "checks", "host", host, {"result": "host"}, self.root)
        self.assertEqual(final["checks"]["host"], {"result": "host"})
        self.assertEqual(final["checks"]["domain"], {"result": "domain"})

    def test_review_requires_current_build_and_rebuild_invalidates_old_review(self):
        with patch.object(e, "capture") as runner, self.assertRaises(e.EvidenceError):
            e.run_review(self.path, "doc_drift_checker", ["."], "No build yet", self.root)
        runner.assert_not_called()
        self.complete()
        self.verify()
        with patch.object(e, "capture", side_effect=self.fake_capture):
            e.run_check(self.path, "build", self.root)
        with self.assertRaises(e.EvidenceError):
            self.verify()

    def test_concurrent_upload_attempts_have_one_durable_winner(self):
        self.complete()
        binding = self.verify()
        def claim():
            try:
                e.claim_upload_attempt(self.path, binding, "b" * 64)
                return True
            except e.EvidenceError:
                return False
        with ThreadPoolExecutor(max_workers=2) as executor:
            self.assertEqual(sorted(executor.map(lambda _value: claim(), range(2))), [False, True])
        marker = self.path.parent / "upload-attempt.json"
        self.assertEqual(marker.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(marker.read_text())["source_sha256"], self.source)
        # Read-only verification remains available after the single allowance is consumed.
        self.verify()

    def test_review_requires_real_session_distinct_id_profile_permissions_and_full_scope(self):
        parsed = e.parse_review_report(report(self.source) * 2, self.source, "doc_drift_checker", "coordinator-current",
                                        ["."], "b" * 64, "a" * 64)
        self.assertEqual(parsed["reviewer_id"], "11111111-1111-4111-8111-111111111111")
        for changes in ({"source_sha256": "b" * 64}, {"complete": False}, {"blocking_findings": 1},
                        {"approval_policy": "unobserved"}, {"sandbox_mode": "workspace-write"},
                        {"reviewer_id": "coordinator-current"}, {"scope": ["source.cpp"]}, {"build_sha256": "d" * 64},
                        {"profile_sha256": "d" * 64}, {"execution_kind": "native-child"},
                        {"cli_thread_id": "coordinator-current"}):
            payload = report(self.source, **changes)
            with self.subTest(changes=changes), self.assertRaises(e.EvidenceError):
                e.parse_review_report(payload, self.source, "doc_drift_checker", "coordinator-current", ["."], "b" * 64, "a" * 64)
        with self.assertRaises(e.EvidenceError):
            e.parse_review_report(report(self.source) + report(self.source, blocking_findings=1), self.source,
                                  "doc_drift_checker", "coordinator-current", ["."], "b" * 64, "a" * 64)
        message_only = report(self.source).splitlines()[1] + b"\n"
        with self.assertRaises(e.EvidenceError):
            e.parse_review_report(message_only, self.source, "doc_drift_checker", "coordinator-current", ["."], "b" * 64, "a" * 64)
        for payload in (b"\n".join(report(self.source).splitlines()[:-1]),
                        report(self.source) + json.dumps({"type": "thread.started", "thread_id": "different"}).encode(),
                        report(self.source) + json.dumps({"type": "turn.failed"}).encode()):
            with self.assertRaises(e.EvidenceError):
                e.parse_review_report(payload, self.source, "doc_drift_checker", "coordinator-current", ["."], "b" * 64, "a" * 64)
        with patch.object(e, "capture") as runner, self.assertRaises(e.EvidenceError):
            e.run_review(self.path, "doc_drift_checker", ["source.cpp"], "Narrow review", self.root)
        runner.assert_not_called()

    def test_local_review_mode_loads_profile_task_without_changing_default_native_review(self):
        review = e.load_module("local_ota_review_fixture", ROOT / "tools/agent-config/review.py")
        default = review.review_prompt("heap_safety_reviewer", "a" * 40, "a" * 40, ["main"], "Review")
        self.assertIn("Spawn exactly one native agent", default)
        local = review.review_prompt("heap_safety_reviewer", "a" * 40, "a" * 40, ["main"], "Review", {
            "source_sha256": "b" * 64, "build_sha256": "c" * 64, "profile_sha256": "d" * 64,
            "coordinator_id": "coordinator-current"})
        self.assertIn("independent-profile-session", local)
        self.assertNotIn("Spawn exactly one native agent", local)
        self.assertIn("Do not invent reviewer_id", local)

    def test_named_sensitive_and_symlink_images_stop_before_reading(self):
        for path in (self.base / "private.pem", self.base / "app.bin"):
            if path.suffix == ".bin":
                path.symlink_to(self.base / "not-read")
            with self.subTest(path=path), self.assertRaises(ValueError):
                e.public_image_digest(path)


if __name__ == "__main__":
    unittest.main()
