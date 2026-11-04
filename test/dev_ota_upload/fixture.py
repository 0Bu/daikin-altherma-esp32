"""Offline behavioral witnesses for the local uploader; no sockets or board inventory are used."""
import argparse
import hashlib
import importlib.util
import io
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("dev_ota_upload", ROOT / "scripts/dev-ota-upload.py")
upload = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = upload
SPEC.loader.exec_module(upload)
gate = upload.gate
BOARD = {"host": "production.invalid", "mac": "02:11:22:33:44:55"}
VERSION = "1.2.3-dev.4"
ELF = "abc123def"


def image():
    body = bytearray(8192)
    body[0] = 0xE9
    struct.pack_into("<H", body, 12, 9)
    struct.pack_into("<I", body, 32, 0xABCD5432)
    body[48:48 + len(VERSION)] = VERSION.encode()
    project = b"daikin-altherma-esp32"
    body[80:80 + len(project)] = project
    body[176:208] = bytes.fromhex(ELF + "0" * 55)
    return bytes(body)


def status(**changes):
    return {"version": VERSION, "app_elf_sha256": ELF, "boot_id": "a" * 16, "uptime_s": 120,
            "wifi": {"mac": BOARD["mac"], "connected": True, "rolled_back": False},
            "mqtt": {"connected": True}, "ota": {"channel": "dev"},
            "hp": {"connected": True, "values": 1, "crc_err": 0, "timeout_err": 0},
            "sys": {"safe_mode": False, "free_heap": 80000, "max_alloc": 64000,
                    "heap_restarts": 0, "mqtt_skipped": 0, "poll_skipped": 0}, **changes}


def ota(**changes):
    return {"channel": "dev", "busy": False, "rollback_pending": False, "image_state": "valid",
            "generation": 7, "state": "done", "heap_min_free_bytes": 64000,
            "heap_min_largest_block_bytes": 32000, "ota_stack_min_free_bytes": 2048, **changes}


class Journal:
    calls = []
    def checkpoint(self, *args, **kwargs):
        self.calls.append((args, kwargs))


class Connection:
    instances = []
    def __init__(self, *_args):
        self.sent = []
        self.closed = False
        self.connects = 0
        self.instances.append(self)
    def settimeout(self, value):
        assert value > 0
    def connect(self, _address):
        self.connects += 1
    def sendall(self, data):
        self.sent.append(data)
    def close(self):
        self.closed = True


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.endpoint = gate.ResolvedHttpEndpoint(2, 1, 0, ("192.0.2.1", 80), "production.invalid")
        self.binary = image()
        self.artifact = {**upload.image_metadata(io.BytesIO(self.binary), len(self.binary)),
                         "sha256": hashlib.sha256(self.binary).hexdigest()}
        self.args = argparse.Namespace(image=Path("/tmp/fixture.bin"), expected_app_sha256=self.artifact["sha256"],
                                       expected_current_version=VERSION, expected_current_elf=ELF, execute=True,
                                       evidence=Path("/tmp/fixture-evidence.json"), expected_source_sha256="c" * 64)
        Connection.instances.clear()
        Journal.calls.clear()

    def test_snapshot_binds_exact_bytes_and_project_without_a_private_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "app.bin"
            path.write_bytes(self.binary)
            with patch.object(upload, "require_signature") as signature:
                with upload.image_snapshot(path, self.artifact["sha256"]) as (stream, artifact):
                    path.write_bytes(b"changed source")
                    self.assertEqual(stream.read(), self.binary)
                    self.assertEqual(artifact, self.artifact)
                signature.assert_called_once()
            path.write_bytes(self.binary)
            with patch.object(upload, "require_signature") as signature:
                with self.assertRaises(gate.GateError):
                    with upload.image_snapshot(path, "b" * 64):
                        self.fail("wrong file SHA accepted")
                signature.assert_not_called()
            path.write_bytes(self.binary[:4096])
            with self.assertRaises(gate.GateError):
                with upload.image_snapshot(path, self.artifact["sha256"]):
                    self.fail("unsigned-size image accepted")

    def test_wrong_chip_project_and_descriptor_are_rejected(self):
        for offset, replacement in ((0, b"x"), (12, b"\0\0"), (32, b"xxxx"), (80, b"another")):
            body = bytearray(self.binary)
            body[offset:offset + len(replacement)] = replacement
            with self.subTest(offset=offset), self.assertRaises(gate.GateError):
                upload.image_metadata(io.BytesIO(body), len(body))

    def test_signature_failure_precedes_all_board_contact(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "app.bin"
            path.write_bytes(self.binary)
            self.args.image = path
            with patch.object(upload, "require_signature", side_effect=gate.GateError("unsigned")), \
                 patch.object(gate, "load_inventory") as inventory:
                with self.assertRaises(gate.GateError):
                    upload.run(self.args)
                inventory.assert_not_called()

    def test_preflight_refuses_wrong_channel_mac_build_and_probation(self):
        bad_statuses = [status(ota={"channel": "release"}), status(version="wrong"),
                        status(wifi={"mac": "AA:11:22:33:44:55", "connected": True}),
                        status(boot_id=None), status(app_elf_sha256="000000000")]
        for current in bad_statuses:
            with self.subTest(current=current), patch.object(gate, "request_status_deadline", return_value=current), \
                 patch.object(gate, "request_json_deadline", return_value=ota()), \
                 self.assertRaises(gate.GateError):
                upload.preflight(self.endpoint, BOARD, VERSION, ELF)
        for candidate in (ota(channel="release"), ota(busy=True), ota(rollback_pending=True), ota(image_state="unarmed")):
            with self.subTest(candidate=candidate), patch.object(gate, "request_status_deadline", return_value=status()), \
                 patch.object(gate, "request_json_deadline", return_value=candidate), \
                 self.assertRaises(gate.GateError):
                upload.preflight(self.endpoint, BOARD, VERSION, ELF)

    def test_one_streamed_post_and_fixed_framing(self):
        payload = self.binary + b"x" * (upload.CHUNK_BYTES * 2)
        artifact = {**self.artifact, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
        class BoundedStream(io.BytesIO):
            def read(self, size=-1):
                if not 0 < size <= upload.CHUNK_BYTES:
                    raise AssertionError("upload attempted an unbounded image read")
                return super().read(size)
        with patch.object(upload.socket, "socket", Connection), \
             patch.object(gate, "read_compact_json_response", return_value={"ok": True, "generation": 7}):
            self.assertEqual(upload.upload_once(self.endpoint, BoundedStream(payload), artifact)["generation"], 7)
        self.assertEqual(len(Connection.instances), 1)
        connection = Connection.instances[0]
        self.assertTrue(connection.closed)
        self.assertEqual(connection.connects, 1)
        self.assertEqual(b"".join(connection.sent[1:]), payload)
        self.assertIn(b"POST /ota/upload?sha256=" + artifact["sha256"].encode(), connection.sent[0])
        self.assertIn(f"Content-Length: {len(payload)}\r\n".encode(), connection.sent[0])
        self.assertIn(b"Content-Type: application/octet-stream\r\n", connection.sent[0])
        self.assertTrue(all(len(chunk) <= upload.CHUNK_BYTES for chunk in connection.sent[1:]))

    def test_upload_errors_and_redirects_never_retry_or_reconnect(self):
        for error in (TimeoutError(), HTTPError("http://fixture", 302, "redirect", None, None),
                      HTTPError("http://fixture", 422, "rejected", None, None)):
            Connection.instances.clear()
            with self.subTest(error=error), patch.object(upload.socket, "socket", Connection), \
                 patch.object(gate, "read_compact_json_response", side_effect=error), \
                 self.assertRaises(type(error)):
                upload.upload_once(self.endpoint, io.BytesIO(self.binary), self.artifact)
            self.assertEqual(len(Connection.instances), 1)
            self.assertTrue(Connection.instances[0].closed)
            self.assertEqual(Connection.instances[0].connects, 1)

    def run_fixture(self, *, execute=True, current=None, upload_error=None):
        self.args.execute = execute
        patches = [patch.object(upload, "image_snapshot"), patch.object(gate, "load_inventory", return_value={"production": BOARD}),
                   patch.object(gate, "resolve_http_endpoint", return_value=self.endpoint),
                   patch.object(upload, "preflight", side_effect=[(status(), ota()), (current or status(), ota())]),
                   patch.object(upload, "upload_once", side_effect=upload_error, return_value={"ok": True, "generation": 7}),
                   patch.object(upload, "observe_boot", return_value={"image_state": "valid"}),
                   patch.object(gate, "request_json_deadline", return_value=ota()), patch.object(gate, "GateJournal", Journal)]
        with patch.object(upload.evidence, "verify_evidence", return_value={"source_sha256": "c" * 64}), \
             patch.object(upload.evidence, "require_upload_unused"), patch.object(upload.evidence, "claim_upload_attempt"), \
             patches[0] as snapshot, patches[1], patches[2], patches[3], patches[4] as writer, \
             patches[5] as observer, patches[6], patches[7]:
            snapshot.return_value.__enter__.return_value = (io.BytesIO(self.binary), self.artifact)
            if upload_error or (current and current["boot_id"] != status()["boot_id"]):
                with self.assertRaises(gate.GateError if not upload_error else type(upload_error)):
                    upload.run(self.args)
                observer.assert_not_called()
            else:
                result = upload.run(self.args)
                self.assertEqual(result["executed"], execute)
            return writer.call_count

    def test_dry_run_has_no_write_and_execute_uses_one_write(self):
        self.assertEqual(self.run_fixture(execute=False), 0)
        self.assertEqual(self.run_fixture(), 1)
        self.assertEqual(self.run_fixture(upload_error=TimeoutError()), 1)
        self.assertEqual(self.run_fixture(current=status(boot_id="b" * 16)), 0)

    def test_evidence_is_required_before_contact_and_rechecked_before_post(self):
        with patch.object(upload, "image_snapshot") as snapshot, \
             patch.object(upload.evidence, "verify_evidence", side_effect=upload.evidence.EvidenceError("stale")), \
             patch.object(gate, "load_inventory") as inventory:
            snapshot.return_value.__enter__.return_value = (io.BytesIO(self.binary), self.artifact)
            with self.assertRaises(upload.evidence.EvidenceError):
                upload.run(self.args)
            inventory.assert_not_called()
        with patch.object(upload, "image_snapshot") as snapshot, \
             patch.object(upload.evidence, "verify_evidence", side_effect=[{}, upload.evidence.EvidenceError("changed before POST")]) as verifier, \
             patch.object(upload.evidence, "require_upload_unused"), \
             patch.object(gate, "load_inventory", return_value={"production": BOARD}), \
             patch.object(gate, "resolve_http_endpoint", return_value=self.endpoint), \
             patch.object(upload, "preflight", return_value=(status(), ota())), \
             patch.object(upload, "upload_once") as writer:
            snapshot.return_value.__enter__.return_value = (io.BytesIO(self.binary), self.artifact)
            with self.assertRaises(upload.evidence.EvidenceError):
                upload.run(self.args)
            self.assertEqual(verifier.call_count, 2)
            writer.assert_not_called()

    def test_timeout_consumes_receipt_and_second_execute_has_no_second_post(self):
        with tempfile.TemporaryDirectory() as directory:
            self.args.evidence = Path(directory).resolve() / "receipt.json"
            self.args.evidence.write_text('{"fixture":"bound evidence"}')
            self.args.evidence.chmod(0o600)
            binding = {"source_sha256": "c" * 64,
                       "receipt_sha256": hashlib.sha256(self.args.evidence.read_bytes()).hexdigest()}
            with patch.object(upload, "image_snapshot") as snapshot, \
                 patch.object(upload.evidence, "verify_evidence", return_value=binding), \
                 patch.object(gate, "load_inventory", return_value={"production": BOARD}), \
                 patch.object(gate, "resolve_http_endpoint", return_value=self.endpoint), \
                 patch.object(upload, "preflight", return_value=(status(), ota())), \
                 patch.object(gate, "GateJournal", Journal), \
                 patch.object(upload, "upload_once", side_effect=TimeoutError()) as writer:
                snapshot.return_value.__enter__.return_value = (io.BytesIO(self.binary), self.artifact)
                with self.assertRaises(TimeoutError):
                    upload.run(self.args)
                with self.assertRaises(upload.evidence.EvidenceError):
                    upload.run(self.args)
                self.assertEqual(writer.call_count, 1)

    def test_same_build_needs_distinct_boot_and_no_second_reboot(self):
        clock = [0.0]
        def sleep(seconds):
            clock[0] += seconds
        first = status(boot_id="b" * 16, uptime_s=1)
        final = status(boot_id="b" * 16, uptime_s=100)
        with patch.object(upload.time, "monotonic", lambda: clock[0]), patch.object(upload.time, "sleep", sleep), \
             patch.object(gate, "request_status_deadline", side_effect=[status(), first, final, final]), \
             patch.object(gate, "request_json_deadline", side_effect=[ota(image_state="pending_verify", rollback_pending=True), ota()]):
            result = upload.observe_boot(self.endpoint, BOARD, self.artifact, "a" * 16)
            self.assertEqual(result["image_state"], "valid")
            self.assertEqual(result["boot_id"], "b" * 16)
            self.assertIs(result["probation_observed"], True)
        clock[0] = 0
        with patch.object(upload.time, "monotonic", lambda: clock[0]), patch.object(upload.time, "sleep", sleep), \
             patch.object(gate, "request_status_deadline", side_effect=[first, status(boot_id="c" * 16)]), \
             patch.object(gate, "request_json_deadline", return_value=ota(image_state="pending_verify", rollback_pending=True)), \
             self.assertRaises(gate.GateError):
            upload.observe_boot(self.endpoint, BOARD, self.artifact, "a" * 16)

    def test_first_seen_valid_boot_cannot_prove_same_build_probation_or_exclude_rollback(self):
        with patch.object(gate, "request_status_deadline", return_value=status(boot_id="b" * 16)), \
             patch.object(gate, "request_json_deadline", return_value=ota()), \
             self.assertRaisesRegex(gate.GateError, "probation was not observed"):
            upload.observe_boot(self.endpoint, BOARD, self.artifact, "a" * 16)

    def test_rollback_between_status_and_ota_state_cannot_inherit_pending_boot(self):
        with patch.object(upload.time, "sleep"), \
             patch.object(gate, "request_status_deadline", side_effect=[
                 status(boot_id="b" * 16, uptime_s=1), status(boot_id="b" * 16, uptime_s=100),
                 status(boot_id="c" * 16, uptime_s=1)]), \
             patch.object(gate, "request_json_deadline", side_effect=[
                 ota(image_state="pending_verify", rollback_pending=True), ota()]), \
             self.assertRaisesRegex(gate.GateError, "boot changed during probation acceptance"):
            upload.observe_boot(self.endpoint, BOARD, self.artifact, "a" * 16)


if __name__ == "__main__":
    unittest.main()
