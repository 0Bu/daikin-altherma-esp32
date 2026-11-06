#!/usr/bin/env python3
"""Verify removal of one owned test container with bounded Docker client lifetimes."""

import re
import subprocess
import sys
import tempfile


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


def main(arguments):
    if len(arguments) != 1 or not re.fullmatch("[a-f0-9]{64}", arguments[0]):
        return 2
    container = arguments[0]
    removed = docker(["rm", "--force", container])
    if removed is not None and removed[0] == 0:
        return 0
    remaining = docker(["ps", "--all", "--quiet", "--no-trunc", "--filter", "id=" + container])
    return 0 if remaining is not None and remaining[0] == 0 and not remaining[1].strip() else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
