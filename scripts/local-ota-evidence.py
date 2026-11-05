#!/usr/bin/env python3
"""Capture and verify local checks, isolated build and independent reviews without a commit."""
import argparse
from pathlib import Path
import json
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools/dev_ota"))
import evidence


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--evidence", type=Path, required=True)
    actions = parser.add_subparsers(dest="action", required=True)
    snapshot = actions.add_parser("snapshot")
    snapshot.add_argument("--coordinator-id", required=True)
    check = actions.add_parser("check")
    check.add_argument("--check", choices=[*evidence.CHECKS, "build"], required=True)
    review = actions.add_parser("review")
    review.add_argument("--role", choices=sorted(evidence.ROLES), required=True)
    review.add_argument("--scope", nargs="+", required=True)
    review.add_argument("--intent", required=True)
    verify = actions.add_parser("verify")
    verify.add_argument("--signed-image", type=Path, required=True)
    verify.add_argument("--expected-source-sha256", required=True)
    args = parser.parse_args(argv)
    path = evidence.receipt_path(args.evidence)
    if args.action == "snapshot":
        result = evidence.create_receipt(path, args.coordinator_id)
    elif args.action == "check":
        result = evidence.run_check(path, args.check)
    elif args.action == "review":
        result = evidence.run_review(path, args.role, args.scope, args.intent)
    else:
        digest = evidence.public_image_digest(args.signed_image)
        uploader = evidence.load_module("local_ota_uploader", evidence.ROOT / "scripts/dev-ota-upload.py")
        with uploader.image_snapshot(args.signed_image, digest) as (stream, _artifact):
            result = evidence.verify_evidence(path, args.expected_source_sha256, stream)
        print(json.dumps(result, sort_keys=True))
        return 0
    print(json.dumps({"source_sha256": result["source"]["sha256"], "required": result["required"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f"local-ota-evidence: {error}", file=sys.stderr)
        raise SystemExit(1)
