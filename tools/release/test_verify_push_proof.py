#!/usr/bin/env python3
"""Offline controls for the protected release receipt verifier."""

from datetime import datetime, timezone
import json
import time
import unittest
from unittest.mock import patch

import verify_push_proof as proof


class LocalProofTests(unittest.TestCase):
    def setUp(self):
        self.base, self.head, self.tree, self.merge, self.squash = (c * 40 for c in "abcde")
        self.now = int(time.time())
        self.label = {"schema": 1, "repo": proof.REPO, "head": self.head, "base": self.base,
                      "tree": self.tree, "finished_at": self.now - 60}
        self.body = {"number": 311, "state": "open", "base": {"ref": "main", "repo": {"full_name": proof.REPO}},
                     "head": {"sha": self.head, "repo": {"full_name": "fork/example"}}}
        self.comments = [self.comment()]

    def time(self, delta):
        return datetime.fromtimestamp(self.now + delta, timezone.utc).isoformat()

    def comment(self, **fields):
        return {"body": proof.PREFIX + json.dumps(self.label | fields), "user": {"id": proof.MAINTAINER_ID},
                "created_at": self.time(-40), "updated_at": self.time(-40)}

    def query(self, path):
        if path.startswith("issues/311/comments?"):
            page = int(path.split("&page=")[1])
            first = (page - 1) * proof.COMMENTS_PER_PAGE
            return self.comments[first:first + proof.COMMENTS_PER_PAGE]
        rows = {
            "pulls/311": self.body,
            "git/ref/heads/main": {"object": {"sha": self.base}},
            "git/ref/pull/311/merge": {"object": {"sha": self.merge}},
            f"git/commits/{self.merge}": {"sha": self.merge, "tree": {"sha": self.tree},
                                           "parents": [{"sha": self.base}, {"sha": self.head}]},
            f"commits/{self.squash}/pulls?per_page=100": [
                self.body | {"state": "closed", "merge_commit_sha": self.squash, "merged_at": self.time(-20)}],
            f"git/commits/{self.squash}": {"sha": self.squash, "tree": {"sha": self.tree},
                                            "parents": [{"sha": self.base}]},
        }
        return rows[path]

    def test_exact_fork_pr_and_squash_pass(self):
        self.assertEqual(proof.verify_pr(311, self.head, self.query), self.label)
        self.assertEqual(proof.verify_landed(self.squash, self.query), self.label)

    def test_unrelated_comments_do_not_hide_receipt_on_later_page(self):
        comment = {"user": {"id": 42}, "body": "discussion" * 6000}
        self.comments[:] = [comment] * (proof.COMMENTS_PER_PAGE * 4) + [self.comment()]
        self.assertEqual(proof.verify_pr(311, self.head, self.query), self.label)

    def test_untrusted_author_or_application_cannot_certify(self):
        for fields in ({"user": {"id": 42}}, {"performed_via_github_app": True}):
            self.comments[:] = [self.comment() | fields]
            with self.assertRaises(proof.ProofError):
                proof.verify_pr(311, self.head, self.query)

    def test_wrong_identity_or_claimed_future_result_is_refused(self):
        for fields in ({"head": self.merge}, {"base": self.head}, {"tree": self.squash},
                       {"repo": "unrelated/repo"}, {"finished_at": self.now}, {"schema": True}):
            self.comments[:] = [self.comment(**fields)]
            with self.assertRaises(proof.ProofError):
                proof.verify_pr(311, self.head, self.query)

    def test_missing_malformed_or_edited_receipt_fails(self):
        for comments in ([], [{"body": "Checkboxes", "user": {"id": proof.MAINTAINER_ID}}],
                         [self.comment() | {"updated_at": self.time(-30)}],
                         [self.comment() | {"body": proof.PREFIX + "{bad json"}]):
            self.comments[:] = comments
            with self.assertRaises(proof.ProofError):
                proof.verify_pr(311, self.head, self.query)

    def test_evidence_posted_after_merge_cannot_authorize_publication(self):
        self.comments[:] = [self.comment() | {"created_at": self.time(-10), "updated_at": self.time(-10)}]
        with self.assertRaises(proof.ProofError):
            proof.verify_landed(self.squash, self.query)

    def test_renovate_pin_inherits_receipt_only_for_the_attested_landed_patch(self):
        target, pin_head = "f" * 40, "0" * 40
        number = 312
        identity = {"name": "Renovate Bot", "email": "renovate@whitesourcesoftware.com"}
        actor = {"login": "renovate-bot"}
        filename = ".github/workflows/renovate.yaml"
        old = "      uses: renovatebot/github-action@" + "1" * 40 + " # v1.0.0"
        new = "      uses: renovatebot/github-action@" + "2" * 40 + " # v1.0.1"
        file = {"filename": filename, "status": "modified", "additions": 1, "deletions": 1,
                "changes": 2, "patch": f"@@ -1 +1 @@\n-{old}\n+{new}"}
        pr = self.body | {"number": number, "state": "closed", "merge_commit_sha": target,
                          "merged_at": self.time(-10),
                          "draft": False, "commits": 1, "changed_files": 1, "user": {"login": "0Bu"},
                          "body": "This PR has been generated by [Mend Renovate CLI]\n<!--renovate-debug:",
                          "head": {"sha": pin_head, "ref": "renovate/runner",
                                   "repo": {"full_name": proof.REPO}}}
        actual = {"sha": target, "files": [file | {"blob_url": "different"}]}
        rows = {
            f"commits/{target}/pulls?per_page=100": [
                {key: value for key, value in pr.items() if key not in ("commits", "changed_files")}],
            f"pulls/{number}": pr,
            f"git/commits/{target}": {"sha": target, "parents": [{"sha": self.squash}],
                                     "tree": {"sha": self.merge}},
            f"commits/{pin_head}": {"sha": pin_head, "parents": [{"sha": self.squash}],
                                   "author": actor, "committer": actor, "files": [file],
                                   "commit": {"author": identity, "committer": identity}},
            f"commits/{target}": actual,
        }

        def query(path):
            if path.startswith(f"issues/{number}/comments?"):
                return []
            return rows[path] if path in rows else self.query(path)

        self.assertEqual(proof.verify_landed(target, query), self.label)
        actual["files"].append({"filename": "main/main.cpp"})
        with self.assertRaisesRegex(proof.ProofError, "missing exact local check receipt"):
            proof.verify_landed(target, query)

    def test_expired_api_deadline_starts_no_request(self):
        with patch.object(proof.subprocess, "run") as run:
            with self.assertRaisesRegex(proof.ProofError, "exceeded its deadline"):
                proof.api("issues/311", deadline=time.monotonic()-1)
        run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
