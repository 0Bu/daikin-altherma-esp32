#!/usr/bin/env python3
"""Verify removal of one owned test container with bounded Docker client lifetimes."""

import json
import os
import re
import stat
import subprocess
import sys
import tempfile

OWNER_LABEL = "io.daikin-altherma-esp32.browser-owner"
IDENTIFIER = re.compile("[a-f0-9]{64}")
INSPECT_FORMAT = ('{"id":{{json .Id}},"name":{{json .Name}},'
                  '"owner":{{json (index .Config.Labels "' + OWNER_LABEL + '")}}}')


def docker(arguments):
    # A file avoids waiting for pipe EOF from a surviving CLI helper after the direct client dies.
    with tempfile.TemporaryFile() as output:
        try:
            result = subprocess.run(["docker", *arguments], stdin=subprocess.DEVNULL,
                                    stdout=output, stderr=subprocess.DEVNULL, timeout=3, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return None
        output.seek(0)
        return result.returncode, output.read(4096)


def absent(container):
    remaining = docker(["ps", "--all", "--quiet", "--no-trunc", "--filter", "id=" + container])
    return remaining is not None and remaining[0] == 0 and not remaining[1].strip()


def remove(container):
    removed = docker(["rm", "--force", container])
    if removed is not None and removed[0] == 0:
        return 0
    return 0 if absent(container) else 2


def read_record(path, maximum):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid():
            raise ValueError("invalid ownership file")
        value = source.read(maximum + 1)
        if len(value) > maximum:
            raise ValueError("oversized ownership file")
        return value


def owned(arguments):
    try:
        record = json.loads(read_record(arguments[1], 1024))
        if (set(record) != {"schema_version", "name", "token"} or record["schema_version"] != 1
                or not re.fullmatch("daikin-browser-[a-f0-9]{32}", record["name"])
                or not IDENTIFIER.fullmatch(record["token"])):
            return 2
        try:
            value = read_record(arguments[3], 128).decode("ascii").strip()
            container = value if IDENTIFIER.fullmatch(value) else None
        except FileNotFoundError:
            container = None
    except (OSError, UnicodeError, ValueError, TypeError):
        return 2

    target = container or record["name"]
    result = docker(["inspect", "--type", "container", "--format", INSPECT_FORMAT, target])
    if result is None or result[0] != 0:
        # A recorded CID proves creation completed. Without it, even an empty name lookup can
        # race an in-flight create after the client died: retain the reservation for recovery.
        return 0 if container and absent(container) else 2
    try:
        actual = json.loads(result[1])
        if (not isinstance(actual, dict) or set(actual) != {"id", "name", "owner"}
                or not IDENTIFIER.fullmatch(actual["id"])
                or (container and actual["id"] != container)
                or actual["name"] != "/" + record["name"] or actual["owner"] != record["token"]):
            return 2
    except (UnicodeError, ValueError, TypeError):
        return 2
    # Delete by the validated immutable ID, never by a name that another container can reuse.
    return remove(actual["id"])


def main(arguments):
    if len(arguments) == 1 and IDENTIFIER.fullmatch(arguments[0]):
        return remove(arguments[0])  # Compatibility for callers that already hold a completed CID.
    if len(arguments) == 4 and arguments[0] == "--ownership" and arguments[2] == "--cid-file":
        return owned(arguments)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
