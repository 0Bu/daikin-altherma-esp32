// Exercise the real raw-board probe over AF_UNIX only. EOF orders the serialized HTTP task's
// close/context cleanup before its next handler; it does not establish heap idle or TCP PCB drain.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.env.PRODUCTION_OTA_CONTRACT_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const probe = String.raw`
import ast, errno, inspect, runpy, socket, sys, threading, time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

source = Path(sys.argv[1]).read_text()
gate = runpy.run_path(sys.argv[1], run_name="probe_completion_contract")
ns = gate["request_bytes_deadline"].__globals__
reader, finish = ns["read_bounded_http_response"], ns["finish_plain_http_response"]
endpoint = SimpleNamespace(family=socket.AF_UNIX, socktype=socket.SOCK_STREAM,
                          proto=0, sockaddr="unused-local", host_header="fixture.invalid")
checks = 0

def check(condition, label):
    assert condition, "PROBE_COMPLETION: " + label

def variant(name, old, new):
    original = inspect.getsource(ns[name])
    check(original.count(old) == 1, "mutation anchor " + name)
    local = {}
    exec(compile(original.replace(old, new), "<completion-mutant>", "exec"), ns, local)
    return local[name]

class LocalClient:
    def __init__(self, raw, *, shutdown_errno=None, tls=False, sent=None):
        self.raw, self.shutdown_errno, self.tls, self.sent = raw, shutdown_errno, tls, sent
        self.half_closed, self.eof_timeouts = False, []
    def connect(self, address):
        check(address == "unused-local", "only the socketpair endpoint may be used")
    def settimeout(self, seconds):
        if self.half_closed:
            self.eof_timeouts.append(seconds)
        self.raw.settimeout(seconds)
    def sendall(self, body):
        self.raw.sendall(body)
        if self.sent is not None:
            self.sent.set()
    def recv(self, size):
        return self.raw.recv(size)
    def shutdown(self, how):
        check(not self.tls, "TLS controller must not use raw SHUT_WR")
        check(how == socket.SHUT_WR, "probe must half-close only its write direction")
        self.half_closed = True
        try:
            self.raw.shutdown(how)
        except OSError as error:
            if self.shutdown_errno is None or error.errno != errno.ENOTCONN:
                raise
        if self.shutdown_errno is not None:
            raise OSError(self.shutdown_errno, "fixture shutdown error")
    def do_handshake(self):
        pass
    def close(self):
        self.raw.close()

def transport(client):
    def construct(family, kind, proto):
        check((family, kind, proto) == (socket.AF_UNIX, socket.SOCK_STREAM, 0),
              "no TCP socket may be constructed")
        return client
    return SimpleNamespace(socket=construct, SHUT_WR=socket.SHUT_WR,
                           SOCK_STREAM=socket.SOCK_STREAM,
                           getaddrinfo=lambda *a, **k: [(socket.AF_UNIX, socket.SOCK_STREAM,
                                                       0, "", "unused-local")])

def request_head(peer):
    body = b""
    while b"\r\n\r\n" not in body:
        part = peer.recv(4096)
        check(bool(part), "request headers must finish")
        body += part
    check(b"Connection: close\r\n" in body, "raw request must ask for close")

def response(chunked=False, busy=False):
    status = b"503 Busy" if busy else b"200 OK"
    framing = (b"Transfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n"
               if chunked else b"Content-Length: 2\r\n\r\n{}")
    return b"HTTP/1.1 " + status + b"\r\n" + framing

def fixture(label, *, mode="held", chunked=False, raw=True, reader_impl=reader,
            finish_impl=finish, budget=0.8, body_delay=0, shutdown_errno=None):
    global checks
    client_socket, peer = socket.socketpair()
    peer.settimeout(2)
    client = LocalClient(client_socket, shutdown_errno=shutdown_errno, tls=not raw)
    body_sent, fin_seen, release, cleaned, done = [threading.Event() for _ in range(5)]
    result, peer_errors = {}, []
    def serve():
        try:
            if raw:
                request_head(peer)
            if body_delay:
                time.sleep(body_delay)
            peer.sendall(response(chunked, mode == "busy"))
            body_sent.set()
            if mode == "already_closed":
                peer.close()
                return
            while peer.recv(4096):
                pass
            fin_seen.set()
            if mode in ("held", "busy", "timeout", "deadline", "eof_before_cleanup"):
                if mode == "eof_before_cleanup":
                    peer.close()
                check(release.wait(2), "fixture cleanup release")
            if mode == "tail":
                peer.sendall(b"X")
            cleaned.set()
        except BaseException as error:
            peer_errors.append(error)
        finally:
            peer.close()
    def invoke():
        try:
            if raw:
                result["body"] = ns["request_bytes_deadline"](
                    endpoint, "/status", timeout=budget, max_body_bytes=32, allow_chunked=True)
            else:
                # Direct shared-reader callers, including TLS, retain the default lifecycle.
                result["body"] = reader_impl(client, "fixture.invalid", "/control",
                    time.monotonic() + budget, max_body_bytes=32, allow_chunked=True)
        except BaseException as error:
            result["error"] = error
        finally:
            done.set()
            client.close()
    peer_thread, caller = threading.Thread(target=serve), threading.Thread(target=invoke)
    with patch.dict(ns, socket=transport(client), read_bounded_http_response=reader_impl,
                    finish_plain_http_response=finish_impl):
        try:
            peer_thread.start()
            caller.start()
            check(body_sent.wait(1), label + " body sent")
            if mode in ("held", "busy"):
                check(fin_seen.wait(1), label + " client FIN")
                if raw:
                    check(not done.wait(0.04), label + " returned before peer close")
                else:
                    check(done.wait(1), label + " default reader waited for EOF")
                release.set()
            elif mode == "eof_before_cleanup":
                check(done.wait(1) and not cleaned.is_set(), "EOF alone is not context cleanup")
                release.set()
            elif mode in ("timeout", "deadline"):
                check(done.wait(1.5), label + " EOF wait did not expire")
                release.set()
            caller.join(2)
            peer_thread.join(2)
            check(not caller.is_alive() and not peer_thread.is_alive(), label + " joined")
            check(not peer_errors, label + " peer failed: " + repr(peer_errors))
            error = result.get("error")
            if mode in ("timeout", "deadline"):
                check(isinstance(error, (TimeoutError, socket.timeout)), label + " must time out")
                check(client.eof_timeouts and
                      client.eof_timeouts[0] <= budget - body_delay + 0.06,
                      label + " renewed the absolute request deadline")
            elif mode == "tail":
                check(isinstance(error, gate["GateError"]), label + " accepted late bytes")
            elif mode == "busy":
                check(isinstance(error, ns["HTTPError"]) and error.code == 503,
                      label + " lost bounded 503 classification")
            elif shutdown_errno == errno.EIO:
                check(isinstance(error, OSError) and error.errno == errno.EIO,
                      label + " swallowed unrelated shutdown failure")
            else:
                check(result.get("body") == b"{}", label + " body/error: " + repr(result))
            checks += 1
        finally:
            release.set()
            for connection in (client_socket, peer):
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                connection.close()
            if caller.ident is not None:
                caller.join(2)
            if peer_thread.ident is not None:
                peer_thread.join(2)

# Both framing paths and the former return-at-body behavior execute the production reader.
for chunked in (False, True):
    fixture("raw close ordering", chunked=chunked)
    fixture("shared reader default", chunked=chunked, raw=False)
fixture("missing peer EOF", mode="timeout", budget=0.2)
fixture("remaining original deadline", mode="deadline", budget=0.35, body_delay=0.18)
fixture("late trailing byte", mode="tail")
fixture("503 closes before classification", mode="busy")
fixture("EOF is not all cleanup", mode="eof_before_cleanup")
fixture("peer already closed", mode="already_closed", shutdown_errno=errno.ENOTCONN)
fixture("ENOTCONN still rejects late bytes", mode="tail", shutdown_errno=errno.ENOTCONN)
fixture("ENOTCONN still requires EOF", mode="timeout", budget=0.2, shutdown_errno=errno.ENOTCONN)
fixture("other shutdown error escapes", mode="already_closed", shutdown_errno=errno.EIO)

# Exercise the actual HTTPS controller with fake TLS over AF_UNIX: no DNS or TLS service is used.
def controller_default(reader_impl=reader):
    global checks
    client_socket, peer = socket.socketpair()
    peer.settimeout(2)
    client = LocalClient(client_socket, tls=True)
    errors = []
    def serve():
        try:
            request_head(peer)
            peer.sendall(response())
            while peer.recv(4096):
                pass
        except BaseException as error:
            errors.append(error)
        finally:
            peer.close()
    thread = threading.Thread(target=serve)
    tls = SimpleNamespace(create_default_context=lambda: SimpleNamespace(
        wrap_socket=lambda *a, **k: client))
    with patch.dict(ns, socket=transport(client), ssl=tls,
                    read_bounded_http_response=reader_impl):
        try:
            thread.start()
            check(ns["control_json"]("https://controller.invalid/control", method="GET",
                  token="fixture", payload=None, label="fixture") == {}, "HTTPS result")
            check(not client.half_closed, "HTTPS controller opted into raw close")
            checks += 1
        finally:
            client.close()
            thread.join(2)
            check(not thread.is_alive() and not errors, "HTTPS fixture joined")
controller_default()

# Model one synchronous HTTP task: EOF can precede context free, but the next handler cannot.
def serialized_cleanup():
    global checks
    worker_raw, worker_peer = socket.socketpair()
    final_raw, final_peer = socket.socketpair()
    worker_peer.settimeout(2)
    final_peer.settimeout(2)
    release, final_sent, closed, final_handler = [threading.Event() for _ in range(4)]
    context, errors, results = {"worker"}, [], []
    worker = LocalClient(worker_raw)
    final = LocalClient(final_raw, sent=final_sent)
    clients = iter((worker, final))
    def serve():
        try:
            request_head(worker_peer)
            worker_peer.sendall(response())
            while worker_peer.recv(4096):
                pass
            worker_peer.close()  # close_fn precedes the SDK's following context release.
            closed.set()
            check(release.wait(2), "serialized context release")
            context.clear()
            request_head(final_peer)
            check(not context, "final handler overlapped prior context")
            final_handler.set()
            final_peer.sendall(response())
            while final_peer.recv(4096):
                pass
        except BaseException as error:
            errors.append(error)
        finally:
            worker_peer.close()
            final_peer.close()
    def probe():
        try:
            for _ in range(2):
                results.append(ns["request_bytes_deadline"](endpoint, "/status", timeout=1.5,
                    max_body_bytes=32, allow_chunked=True))
        except BaseException as error:
            errors.append(error)
    sockets = transport(worker)
    sockets.socket = lambda *a: next(clients)
    server, caller = threading.Thread(target=serve), threading.Thread(target=probe)
    with patch.dict(ns, socket=sockets):
        try:
            server.start()
            caller.start()
            check(closed.wait(1) and final_sent.wait(1), "final request follows worker peer EOF")
            check(context and not final_handler.is_set(), "EOF alone freed context or ran handler")
            release.set()
            caller.join(2)
            server.join(2)
            check(not caller.is_alive() and not server.is_alive() and not errors,
                  "serialized fixture joined: " + repr(errors))
            check(results == [b"{}", b"{}"] and final_handler.is_set(), "final handler completed")
            checks += 1
        finally:
            release.set()
            for connection in (worker_raw, final_raw, worker_peer, final_peer):
                connection.close()
            caller.join(2)
            server.join(2)
serialized_cleanup()

# A late receive must not turn an already expired deadline into a successful EOF.
clock = SimpleNamespace(now=0.0)
class LateEOF:
    def settimeout(self, value):
        check(value > 0, "positive remaining timeout")
    def shutdown(self, how):
        pass
    def recv(self, size):
        clock.now = 2.0
        return b""
with patch.dict(ns, time=SimpleNamespace(monotonic=lambda: clock.now)):
    try:
        finish(LateEOF(), 1.0)
    except TimeoutError:
        checks += 1
    else:
        check(False, "post-EOF absolute deadline check missing")

# The opt-in belongs solely to the raw request entry point, never a shared or TLS caller.
tree = ast.parse(source)
opted_in = []
for definition in (node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)):
    for call in (node for node in ast.walk(definition) if isinstance(node, ast.Call)):
        if isinstance(call.func, ast.Name) and call.func.id == "read_bounded_http_response":
            if any(keyword.arg == "require_peer_close" and
                   isinstance(keyword.value, ast.Constant) and keyword.value.value is True
                   for keyword in call.keywords):
                opted_in.append(definition.name)
check(opted_in == ["request_bytes_deadline"], "raw-only opt-in binding")

# These semantic regressions must each be caught by the same executable witnesses above.
mutants = [
    ("omit close returned before peer close",
     lambda: fixture("omit close", finish_impl=lambda *a: None)),
    ("renew deadline renewed the absolute request deadline",
     lambda: fixture("renew deadline", mode="deadline", budget=0.35,
        body_delay=0.18, finish_impl=lambda connection, deadline:
            finish(connection, time.monotonic() + 0.35))),
    ("503 early returned before peer close", lambda: fixture("503 early", mode="busy", reader_impl=variant(
        "read_bounded_http_response", "    if require_peer_close:\n",
        "    if require_peer_close and status < 400:\n"))),
    ("TLS controller must not use raw SHUT_WR", lambda: controller_default(variant(
        "read_bounded_http_response", "    if require_peer_close:\n", "    if True:\n"))),
    ("ignore late bytes accepted late bytes", lambda: fixture("ignore late bytes", mode="tail", finish_impl=variant(
        "finish_plain_http_response",
        '    if connection.recv(1):\n        fail("HTTP response has bytes after its framed body")\n',
        '    connection.recv(1)\n'))),
]
for label, run in mutants:
    try:
        run()
    except AssertionError as error:
        check(str(error) == "PROBE_COMPLETION: " + label, label + " unrelated mutant failure: " + str(error))
    else:
        check(False, label + " mutant survived")
print(f"OTA probe completion: {checks} controls, {len(mutants)} regressions rejected; AF_UNIX only")
`;
const result = spawnSync("python3", [
  "-I", "-B", "-c", probe, path.join(root, "scripts/production-ota-gate.py"),
], { encoding: "utf8", timeout: 20000 });
assert.equal(result.status, 0,
  `OTA probe completion failed: ${result.error || ""}\n${result.stdout}\n${result.stderr}`);
process.stdout.write(result.stdout);
