#!/usr/bin/env python3
"""Verify a Secure Boot v2 RSA image and its repository-pinned signing identity.

Unlike ``espsecure signature-info-v2``, this check verifies the RSA-PSS signature as
well as the block CRC and image digest. Trust comes from the separately committed
public-key digest: an internally consistent image signed by any other key is refused.
The implementation uses only the Python standard library so the write-capable
publisher can repeat the check without receiving the offline private key.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import struct
import sys
import tempfile
import zlib
from pathlib import Path


SECTOR_SIZE = 4096
BLOCK_SIZE = 1216
BLOCK_DATA_SIZE = 1196
MAX_BLOCKS = 3
RSA_BYTES = 384
MAGIC = 0xE7
RSA_VERSION = 0x02
DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
DEFAULT_EXPECTED = (
    Path(__file__).resolve().parents[1] / "tools/release/ota_signing_key_digest.txt"
)


class ImageError(ValueError):
    """The image cannot satisfy the signed-image continuity contract."""


def mgf1(seed: bytes, length: int) -> bytes:
    output = bytearray()
    counter = 0
    while len(output) < length:
        output.extend(hashlib.sha256(seed + counter.to_bytes(4, "big")).digest())
        counter += 1
    return bytes(output[:length])


def verify_rsa_pss(
    message_digest: bytes, modulus_le: bytes, exponent: int, signature_le: bytes
) -> None:
    modulus = int.from_bytes(modulus_le, "little")
    if len(modulus_le) != RSA_BYTES or modulus.bit_length() != RSA_BYTES * 8:
        raise ImageError("RSA modulus is not 3072 bits")
    if exponent < 1 or exponent % 2 == 0:
        raise ImageError("RSA public exponent is invalid")

    signature = int.from_bytes(signature_le, "little")
    if signature >= modulus:
        raise ImageError("RSA signature representative is outside the modulus")
    encoded = pow(signature, exponent, modulus).to_bytes(RSA_BYTES, "big")

    hash_len = 32
    salt_len = 32
    if encoded[-1] != 0xBC:
        raise ImageError("RSA-PSS trailer is invalid")
    masked_db = encoded[: RSA_BYTES - hash_len - 1]
    encoded_hash = encoded[RSA_BYTES - hash_len - 1 : -1]
    # EMSA-PSS uses emBits = modBits - 1, hence one unused high bit for RSA-3072.
    if masked_db[0] & 0x80:
        raise ImageError("RSA-PSS unused high bit is set")
    db = bytearray(a ^ b for a, b in zip(masked_db, mgf1(encoded_hash, len(masked_db))))
    db[0] &= 0x7F
    separator = len(db) - salt_len - 1
    if any(db[:separator]) or db[separator] != 0x01:
        raise ImageError("RSA-PSS padding is invalid")
    salt = bytes(db[-salt_len:])
    expected_hash = hashlib.sha256(b"\x00" * 8 + message_digest + salt).digest()
    if encoded_hash != expected_hash:
        raise ImageError("RSA-PSS signature verification failed")


def load_expected_digest(path: Path) -> str:
    try:
        value = path.read_text(encoding="ascii").strip()
    except OSError as exc:
        raise ImageError(f"cannot read pinned signing-key digest {path}: {exc}") from exc
    if not DIGEST_RE.fullmatch(value):
        raise ImageError(f"pinned signing-key digest is not lowercase SHA-256: {value!r}")
    return value


def check_image(
    image: bytes, expected_digest: str, *, allow_test_exponent: bool = False,
) -> list[str]:
    if not DIGEST_RE.fullmatch(expected_digest):
        raise ImageError("expected signing-key digest is not lowercase SHA-256")
    if len(image) < SECTOR_SIZE * 2 or len(image) % SECTOR_SIZE:
        raise ImageError("image size must be at least 8192 bytes and a multiple of 4096")

    payload = image[:-SECTOR_SIZE]
    sector = image[-SECTOR_SIZE:]
    image_digest = hashlib.sha256(payload).digest()
    key_digests: list[str] = []
    consumed = 0

    for index in range(MAX_BLOCKS):
        offset = index * BLOCK_SIZE
        block = sector[offset : offset + BLOCK_SIZE]
        if block == b"\xff" * BLOCK_SIZE:
            break
        if len(block) != BLOCK_SIZE:
            raise ImageError(f"signature block {index} is truncated")
        if block[0] != MAGIC or block[1] != RSA_VERSION or block[2:4] != b"\x00\x00":
            raise ImageError(f"signature block {index} has invalid magic, scheme, or reserved bytes")
        stored_crc = struct.unpack_from("<I", block, BLOCK_DATA_SIZE)[0]
        calculated_crc = zlib.crc32(block[:BLOCK_DATA_SIZE]) & 0xFFFFFFFF
        if stored_crc != calculated_crc:
            raise ImageError(f"signature block {index} CRC mismatch")
        if block[1200:] != b"\x00" * 16:
            raise ImageError(f"signature block {index} padding is not zero")

        block_digest = block[4:36]
        if block_digest != image_digest:
            raise ImageError(f"signature block {index} image digest mismatch")
        modulus_le = block[36:420]
        exponent = struct.unpack_from("<I", block, 420)[0]
        if exponent != 65537 and not allow_test_exponent:
            raise ImageError(
                f"signature block {index} uses unsupported RSA public exponent {exponent}"
            )
        signature_le = block[812:1196]
        verify_rsa_pss(block_digest, modulus_le, exponent, signature_le)

        key_digest = hashlib.sha256(block[36:812]).hexdigest()
        if key_digest != expected_digest:
            raise ImageError(
                f"signature block {index} uses key {key_digest}, expected {expected_digest}"
            )
        key_digests.append(key_digest)
        consumed = offset + BLOCK_SIZE

    if not key_digests:
        raise ImageError("no valid Secure Boot v2 RSA signature block found")
    if sector[consumed:] != b"\xff" * (SECTOR_SIZE - consumed):
        raise ImageError("signature sector contains unexpected trailing data")
    return key_digests


def pss_encode(message_digest: bytes, salt: bytes) -> bytes:
    """Build a deterministic EMSA-PSS value for the dependency-free self-test."""
    encoded_hash = hashlib.sha256(b"\x00" * 8 + message_digest + salt).digest()
    db = b"\x00" * (RSA_BYTES - 32 - len(salt) - 2) + b"\x01" + salt
    masked = bytearray(a ^ b for a, b in zip(db, mgf1(encoded_hash, len(db))))
    masked[0] &= 0x7F
    return bytes(masked) + encoded_hash + b"\xbc"


def make_self_test_image() -> tuple[bytes, str]:
    marker = b"test firmware"
    payload = marker + b"\xff" * (SECTOR_SIZE - len(marker))
    payload_digest = hashlib.sha256(payload).digest()
    # e=1 makes the deterministic PSS representative its own test signature. This is not a
    # production key; the test proves our complete parser and verifier without a crypto package.
    modulus = (1 << (RSA_BYTES * 8)) - 159
    modulus_le = modulus.to_bytes(RSA_BYTES, "little")
    exponent = 1
    signature_le = int.from_bytes(
        pss_encode(payload_digest, bytes(range(32))), "big"
    ).to_bytes(RSA_BYTES, "little")
    public_fields = modulus_le + struct.pack("<I", exponent) + b"\x00" * RSA_BYTES + b"\x00" * 4
    key_digest = hashlib.sha256(public_fields).hexdigest()
    body = struct.pack(
        "<BB2x32s384sI384sI384s",
        MAGIC,
        RSA_VERSION,
        payload_digest,
        modulus_le,
        exponent,
        b"\x00" * RSA_BYTES,
        0,
        signature_le,
    )
    block = body + struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF) + b"\x00" * 16
    sector = block + b"\xff" * (SECTOR_SIZE - len(block))
    return payload + sector, key_digest


def self_test() -> None:
    image, key_digest = make_self_test_image()
    assert check_image(image, key_digest, allow_test_exponent=True) == [key_digest]

    try:
        check_image(image, key_digest)
    except ImageError:
        pass
    else:
        raise AssertionError("production verification accepted the self-test exponent")

    mutations: list[tuple[str, bytes, str]] = []
    changed_payload = bytearray(image)
    changed_payload[0] ^= 1
    mutations.append(("changed payload", bytes(changed_payload), key_digest))
    mutations.append(("wrong pinned key", image, "0" * 64))
    mutations.append(("missing block", image[:-SECTOR_SIZE] + b"\xff" * SECTOR_SIZE, key_digest))

    changed_signature = bytearray(image)
    signature_offset = len(image) - SECTOR_SIZE + 812
    changed_signature[signature_offset] ^= 1
    block_offset = len(image) - SECTOR_SIZE
    crc = zlib.crc32(changed_signature[block_offset : block_offset + BLOCK_DATA_SIZE]) & 0xFFFFFFFF
    struct.pack_into("<I", changed_signature, block_offset + BLOCK_DATA_SIZE, crc)
    mutations.append(("invalid RSA-PSS signature", bytes(changed_signature), key_digest))

    for name, candidate, expected in mutations:
        try:
            check_image(candidate, expected, allow_test_exponent=True)
        except ImageError:
            continue
        raise AssertionError(f"self-test failed to reject {name}")

    with tempfile.TemporaryDirectory() as raw:
        expected_path = Path(raw) / "digest.txt"
        expected_path.write_text(key_digest + "\n", encoding="ascii")
        assert load_expected_digest(expected_path) == key_digest
    print("signing-key continuity self-test: PASS")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", nargs="?", type=Path)
    parser.add_argument("--expected-digest", type=Path, default=DEFAULT_EXPECTED)
    parser.add_argument("--print-digest", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        if args.image is not None:
            parser.error("--self-test does not accept an image")
        self_test()
        return 0
    if args.image is None:
        parser.error("an app image is required")
    expected = load_expected_digest(args.expected_digest)
    try:
        key_digests = check_image(args.image.read_bytes(), expected)
    except OSError as exc:
        raise ImageError(f"cannot read {args.image}: {exc}") from exc
    if args.print_digest:
        print(key_digests[0])
    else:
        print(
            f"signing-key continuity: OK ({args.image}, key {key_digests[0]}, "
            f"{len(key_digests)} signature block(s))"
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except ImageError as exc:
        raise SystemExit(f"signing-key continuity: {exc}") from exc
