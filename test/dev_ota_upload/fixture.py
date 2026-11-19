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
SAFE_TMP = str(Path("/tmp").resolve())


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
                                       target="production", expected_mac=None, execute=True)
        Connection.instances.clear()
        Journal.calls.clear()

    def test_snapshot_binds_exact_bytes_and_project_without_a_private_key(self):
        with tempfile.TemporaryDirectory(dir=SAFE_TMP) as directory:
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
            linked_file = Path(directory).resolve() / "linked.bin"
            linked_file.symlink_to(path)
            with self.assertRaises(gate.GateError):
                with upload.image_snapshot(linked_file, self.artifact["sha256"]):
                    self.fail("symlinked file accepted")
            linked_dir = Path(directory).resolve() / "linked-dir"
            linked_dir.symlink_to(Path(directory).resolve())
            with self.assertRaises(gate.GateError):
                with upload.image_snapshot(linked_dir / "app.bin", self.artifact["sha256"]):
                    self.fail("symlinked directory accepted")

    def test_wrong_chip_project_and_descriptor_are_rejected(self):
        for offset, replacement in ((0, b"x"), (12, b"\0\0"), (32, b"xxxx"), (80, b"another")):
            body = bytearray(self.binary)
            body[offset:offset + len(replacement)] = replacement
            with self.subTest(offset=offset), self.assertRaises(gate.GateError):
                upload.image_metadata(io.BytesIO(body), len(body))

    def test_signature_failure_precedes_all_board_contact(self):
        with tempfile.TemporaryDirectory(dir=SAFE_TMP) as directory:
            path = Path(directory).resolve() / "app.bin"
            path.write_bytes(self.binary)
            self.args.image = path
            with patch.object(upload, "require_signature", side_effect=gate.GateError("unsigned")), \
                 patch.object(gate, "load_inventory") as inventory:
                with self.assertRaises(gate.GateError):
                    upload.run(self.args)
                inventory.assert_not_called()

    def test_preflight_refuses_wrong_channel_mac_build_and_probation(self):
        bad_statuses = [status(ota={"channel": "release"}), status(version=None),
                        status(wifi={"mac": "AA:11:22:33:44:55", "connected": True}),
                        status(boot_id=None), status(app_elf_sha256="bad")]
        for current in bad_statuses:
            with self.subTest(current=current), patch.object(gate, "request_status_deadline", return_value=current), \
                 patch.object(gate, "request_json_deadline", return_value=ota()), \
                 self.assertRaises(gate.GateError):
                upload.preflight(self.endpoint, dict(BOARD), production=True)
        for production in (True, False):
            for candidate in (ota(channel="release"), ota(busy=True), ota(rollback_pending=True)):
                with self.subTest(candidate=candidate, production=production), \
                     patch.object(gate, "request_status_deadline", return_value=status()), \
                     patch.object(gate, "request_json_deadline", return_value=candidate), \
                     self.assertRaises(gate.GateError):
                    upload.preflight(self.endpoint, dict(BOARD), production=production)

    def test_non_production_board_accepts_writable_start_without_ota_history_and_pins_live_mac(self):
        for candidate in (ota(image_state="unarmed"), ota(image_state="unknown", rollback_pending=None)):
            board = {"host": "192.0.2.170", "mac": None}
            with self.subTest(candidate=candidate), patch.object(gate, "request_status_deadline", return_value=status()), \
                 patch.object(gate, "request_json_deadline", return_value=candidate):
                self.assertEqual(upload.preflight(self.endpoint, board, production=False), status())
                self.assertEqual(board["mac"], BOARD["mac"])
                with self.assertRaises(gate.GateError):
                    upload.preflight(self.endpoint, dict(BOARD), production=True)

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

    def test_inventory_and_arbitrary_host_targets_work_without_codex_receipt(self):
        bench = {"host": "bench.invalid", "mac": "02:11:22:33:44:66"}
        custom_mac = "02:11:22:33:44:77"
        for target, expected_host, expected_role, has_inventory, execute in (
            ("production", BOARD["host"], "production", True, False),
            ("production", BOARD["host"], "production", True, True),
            ("bench", bench["host"], "bench", True, True),
            ("192.0.2.170", "192.0.2.170", "host", False, True),
        ):
            live_status = status(wifi={"mac": custom_mac if target == "192.0.2.170" else BOARD["mac"],
                                       "connected": True, "rolled_back": False})
            with self.subTest(target=target, execute=execute), \
                 patch.object(upload, "image_snapshot") as snapshot, \
                 patch.object(gate, "INVENTORY_PATH", Path("/nonexistent/inventory.json") if not has_inventory else Path("/tmp")), \
                 patch.object(gate, "load_inventory", return_value={"production": BOARD, "bench": bench}) as inv_loader, \
                 patch.object(gate, "resolve_http_endpoint", return_value=self.endpoint) as resolve, \
                 patch.object(upload, "preflight", return_value=live_status) as preflight, \
                 patch.object(upload, "claim_upload_attempt") as claim, \
                 patch.object(upload, "upload_once", return_value={"ok": True, "generation": 7}) as writer, \
                 patch.object(gate, "request_json_deadline", return_value=ota()), \
                 patch.object(upload, "observe_boot", return_value={"image_state": "valid"}) as observe, \
                 patch.object(gate, "GateJournal", Journal):
                snapshot.return_value.__enter__.return_value = (io.BytesIO(self.binary), self.artifact)
                args = upload.parse_args(["--target", target, "--image", "/tmp/fixture.bin",
                                          "--expected-app-sha256", self.artifact["sha256"],
                                          *(["--execute"] if execute else [])])
                result = upload.run(args)
                self.assertEqual(result["executed"], execute)
                self.assertEqual(result["target"], expected_role)
                if not has_inventory:
                    inv_loader.assert_not_called()
                resolve.assert_called_once_with(expected_host)
                self.assertEqual(preflight.call_count, 1)
                self.assertEqual(writer.call_count, int(execute))
                self.assertEqual(claim.call_count, int(execute))
                self.assertEqual(observe.call_count, int(execute))

    def test_shared_mdns_requires_expected_mac_and_ip_matching_production_mac_keeps_production_rules(self):
        with self.assertRaises(SystemExit):
            upload.parse_args(["--target", "daikin-altherma-esp32.local", "--image", "/tmp/fixture.bin",
                               "--expected-app-sha256", self.artifact["sha256"]])
        parsed = upload.parse_args(["--target", "daikin-altherma-esp32.local", "--expected-mac", "02:11:22:33:44:77",
                                    "--image", "/tmp/fixture.bin", "--expected-app-sha256", self.artifact["sha256"]])
        self.assertEqual(parsed.expected_mac, "02:11:22:33:44:77")
        with tempfile.TemporaryDirectory(dir=SAFE_TMP) as directory:
            inv_file = Path(directory) / "production-ota.json"
            inv_file.write_text("{}")
            bench = {"host": "bench.invalid", "mac": "02:11:22:33:44:66"}
            with patch.object(gate, "INVENTORY_PATH", inv_file), \
                 patch.object(gate, "load_inventory", return_value={"production": BOARD, "bench": bench}), \
                 patch.object(gate, "request_status_deadline", return_value=status()), \
                 patch.object(gate, "request_json_deadline", return_value=ota(image_state="unarmed")):
                board, role, production, prod_mac = upload.resolve_target("192.0.2.99", None)
                self.assertEqual(role, "host")
                self.assertFalse(production)
                with self.assertRaises(gate.GateError):
                    upload.preflight(self.endpoint, board, production=production, production_mac=prod_mac)

    def test_failed_preflight_never_posts(self):
        with patch.object(upload, "image_snapshot") as snapshot, \
             patch.object(gate, "load_inventory", return_value={"production": BOARD, "bench": {"host": "b.invalid", "mac": "02:00:00:00:00:01"}}), \
             patch.object(gate, "resolve_http_endpoint", return_value=self.endpoint), \
             patch.object(upload, "preflight", side_effect=gate.GateError("wrong target")), \
             patch.object(upload, "upload_once") as writer:
            snapshot.return_value.__enter__.return_value = (io.BytesIO(self.binary), self.artifact)
            with self.assertRaises(gate.GateError):
                upload.run(self.args)
            writer.assert_not_called()

    def test_timeout_consumes_image_path_and_second_execute_has_no_second_post(self):
        with tempfile.TemporaryDirectory(dir=SAFE_TMP) as directory:
            self.args.image = Path(directory).resolve() / "signed.bin"
            marker = self.args.image.with_suffix(".upload-attempt")
            with patch.object(upload, "image_snapshot") as snapshot, \
                 patch.object(gate, "load_inventory", return_value={"production": BOARD, "bench": {"host": "b.invalid", "mac": "02:00:00:00:00:01"}}), \
                 patch.object(gate, "resolve_http_endpoint", return_value=self.endpoint), \
                 patch.object(upload, "preflight", return_value=status()), \
                 patch.object(gate, "GateJournal", Journal), \
                 patch.object(upload, "upload_once", side_effect=TimeoutError()) as writer:
                snapshot.return_value.__enter__.return_value = (io.BytesIO(self.binary), self.artifact)
                with self.assertRaises(TimeoutError):
                    upload.run(self.args)
                self.assertEqual(marker.read_text().strip(), self.artifact["sha256"])
                with self.assertRaisesRegex(gate.GateError, "already owns a write attempt"):
                    upload.run(self.args)
                writer.assert_called_once()

    def test_same_build_needs_distinct_boot_and_no_second_reboot(self):
        clock = [0.0]
        def sleep(seconds):
            clock[0] += seconds
        first = status(boot_id="b" * 16, uptime_s=1)
        final = status(boot_id="b" * 16, uptime_s=100)
        with patch.object(upload.time, "monotonic", lambda: clock[0]), patch.object(upload.time, "sleep", sleep), \
             patch.object(gate, "request_status_deadline", side_effect=[status(), first, final, final]), \
             patch.object(gate, "request_json_deadline", side_effect=[ota(image_state="pending_verify", rollback_pending=True), ota()]):
            result = upload.observe_boot(self.endpoint, BOARD, self.artifact, "a" * 16, production=True)
            self.assertEqual(result["image_state"], "valid")
            self.assertEqual(result["boot_id"], "b" * 16)
            self.assertIs(result["probation_observed"], True)
        clock[0] = 0
        with patch.object(upload.time, "monotonic", lambda: clock[0]), patch.object(upload.time, "sleep", sleep), \
             patch.object(gate, "request_status_deadline", side_effect=[first, status(boot_id="c" * 16)]), \
             patch.object(gate, "request_json_deadline", return_value=ota(image_state="pending_verify", rollback_pending=True)), \
             self.assertRaises(gate.GateError):
            upload.observe_boot(self.endpoint, BOARD, self.artifact, "a" * 16, production=True)

    def test_first_seen_valid_boot_cannot_prove_same_build_probation_or_exclude_rollback(self):
        with patch.object(gate, "request_status_deadline", return_value=status(boot_id="b" * 16)), \
             patch.object(gate, "request_json_deadline", return_value=ota()), \
             self.assertRaisesRegex(gate.GateError, "probation was not observed"):
            upload.observe_boot(self.endpoint, BOARD, self.artifact, "a" * 16, production=True)

    def test_rollback_between_status_and_ota_state_cannot_inherit_pending_boot(self):
        with patch.object(upload.time, "sleep"), \
             patch.object(gate, "request_status_deadline", side_effect=[
                 status(boot_id="b" * 16, uptime_s=1), status(boot_id="b" * 16, uptime_s=100),
                 status(boot_id="c" * 16, uptime_s=1)]), \
             patch.object(gate, "request_json_deadline", side_effect=[
                 ota(image_state="pending_verify", rollback_pending=True), ota()]), \
             self.assertRaisesRegex(gate.GateError, "boot changed during probation acceptance"):
            upload.observe_boot(self.endpoint, BOARD, self.artifact, "a" * 16, production=True)

    def test_unwired_board_can_complete_probation_but_production_cannot(self):
        for production in (True, False):
            unwired = status(boot_id="b" * 16, mqtt={"configured": True, "connected": False},
                             hp={**status()["hp"], "connected": False, "values": 0})
            with self.subTest(production=production), patch.object(upload.time, "sleep"), \
                 patch.object(gate, "request_status_deadline", return_value=unwired), \
                 patch.object(gate, "request_json_deadline", side_effect=[
                     ota(image_state="pending_verify", rollback_pending=True), ota()]):
                if production:
                    with self.assertRaisesRegex(gate.GateError, "runtime health"):
                        upload.observe_boot(self.endpoint, BOARD, self.artifact, "a" * 16, production=True)
                else:
                    self.assertTrue(upload.observe_boot(self.endpoint, BOARD, self.artifact,
                                                        "a" * 16, production=False)["probation_observed"])


if __name__ == "__main__":
    unittest.main()
