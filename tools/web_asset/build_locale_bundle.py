#!/usr/bin/env python3
"""Build one offline, lossless locale resource without changing the startup page."""

import argparse
import base64
import hashlib
import json
import lzma
from pathlib import Path
import re
import zlib

from minify_and_gzip import minify_javascript
from zopfli_gzip import compress


ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor" / "lzma-js"
PREFIX = bytes((255, 76, 90, 77, 65, 1))  # invalid UTF-8 lead, LZMA, schema 1
DICTIONARY_BYTES = 512 * 1024
MAX_DECODED_BYTES = 1024 * 1024
MAX_BUNDLE_GZIP_BYTES = 289792
MAX_SOURCE_GZIP_BYTES = 32768


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_decoder(vendor: Path = VENDOR) -> tuple[str, str, dict]:
    """Retain the upstream decoder byte-for-byte and its complete MIT notice."""
    manifest = json.loads((vendor / "UPSTREAM.json").read_text(encoding="utf-8"))
    required = {"LICENSE", "lzma-d.js", "lzma-d-min.js"}
    if set(manifest.get("files", {})) != required or manifest.get("modified") is not False:
        raise ValueError("unexpected pinned locale decoder inventory")
    for name, expected in manifest["files"].items():
        if sha256((vendor / name).read_bytes()) != expected:
            raise ValueError(f"pinned locale decoder hash mismatch: {name}")
    return ((vendor / "lzma-d-min.js").read_text(encoding="utf-8"),
            (vendor / "LICENSE").read_text(encoding="utf-8"), manifest)


def encode_frame(frame: bytes) -> bytes:
    if not frame or len(frame) > MAX_DECODED_BYTES:
        raise ValueError("decoded locale frame exceeds its 1 MiB bound")
    packed = lzma.compress(frame, format=lzma.FORMAT_ALONE,
                           filters=[{"id": lzma.FILTER_LZMA1, "preset": 6,
                                     "dict_size": DICTIONARY_BYTES}])
    if packed[:5] != bytes((0x5D, 0, 0, 8, 0)) or packed[5:13] != b"\xff" * 8:
        raise ValueError("unexpected locale LZMA properties")
    # The upstream decoder enforces outSize. Do not leave the stdlib's unknown-size marker in
    # the served frame: corrupt streams must not grow an unbounded numeric output array.
    packed = packed[:5] + len(frame).to_bytes(8, "little") + packed[13:]
    if lzma.decompress(packed, format=lzma.FORMAT_ALONE) != frame:
        raise ValueError("locale LZMA round trip changed the input")
    return packed


def render_wrapper(packed: bytes, source_bytes: int, source_crc32: int,
                   decoder: str, license_text: str) -> str:
    """Synchronous registration preserves the existing script.onload language lease.

    The decoder's binary-output contract returns an ordinary byte array. Converting it once to
    Uint8Array and taking a view avoids an additional numeric-array copy and its UTF-8 string
    builder. No browser worker, Blob, eval, global decoder export or message handler is installed.
    """
    if source_bytes < 0 or source_bytes + len(PREFIX) > MAX_DECODED_BYTES:
        raise ValueError("decoded locale source exceeds its 1 MiB bound")
    encoded = base64.b64encode(packed).decode("ascii")
    header = bytes((0x5D, 0, 0, 8, 0)) + (source_bytes + len(PREFIX)).to_bytes(8, "little")
    header_values = json.dumps(list(header), separators=(",", ":"))
    return (
        "(()=>{if(typeof window===\"undefined\"||!window.document)throw Error(\"window required\");"
        "const key=Symbol.for(\"daikin-altherma-esp32.locales.v1."
        f"{source_bytes}.{source_crc32:08x}"
        "\"),ready=()=>UI_LANGS.filter(x=>x!==\"en\").every(localeReady);"
        "if(window[key]===true&&ready())return;"
        "const packed=Uint8Array.from(atob(\"" + encoded + "\"),c=>c.charCodeAt(0));"
        f"if(packed.length<13||!{header_values}.every((v,i)=>packed[i]===v))"
        "throw Error(\"locale LZMA header\");"
        "const decoder=(function(){/*" + license_text + "*/" + decoder +
        ";return this.LZMA}).call({});"
        "const raw=decoder.decompress(packed);"
        "if(!Array.isArray(raw)&&!ArrayBuffer.isView(raw))throw Error(\"locale payload type\");"
        f"const all=Uint8Array.from(raw);if(all.length!=={source_bytes + len(PREFIX)})"
        "throw Error(\"locale payload length\");"
        "if(![255,76,90,77,65].every((v,i)=>all[i]===v))throw Error(\"locale payload prefix\");"
        "if(all[5]!==1)throw Error(\"locale payload version\");const bytes=all.subarray(6);"
        "const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)"
        "n=n&1?3988292384^(n>>>1):n>>>1;return n>>>0});"
        "let checksum=4294967295;for(const b of bytes)checksum=table[(checksum^b)&255]^(checksum>>>8);"
        f"if(((checksum^4294967295)>>>0)!=={source_crc32})"
        "throw Error(\"locale payload integrity\");"
        "const script=document.createElement(\"script\");"
        "script.textContent=new TextDecoder(\"utf-8\",{fatal:true}).decode(bytes);"
        "document.head.append(script);script.remove();"
        "if(!ready())throw Error(\"locale bundle incomplete\");window[key]=true;})();"
    )


def build_bundle(locale_dir: Path, locales: list[str], source_limit: int,
                 bundle_limit: int) -> tuple[bytes, dict]:
    if not locales or len(set(locales)) != len(locales) or any(
            re.fullmatch(r"[a-z]{2}", code) is None for code in locales):
        raise ValueError("locale codes must be unique two-letter identifiers")
    available = {path.stem for path in locale_dir.glob("*.js")}
    if set(locales) != available:
        raise ValueError("locale bundle inventory differs from the source directory")
    decoder, license_text, upstream = load_decoder()
    sources, quality = [], []
    for code in locales:
        path = locale_dir / f"{code}.js"
        original = path.read_bytes()
        source = minify_javascript(original.decode("utf-8")).encode("utf-8")
        # These remain independent per-file quality gates even though only one resource is linked.
        encoded = compress(source, 5)
        if len(encoded) > source_limit:
            raise ValueError(f"{code} locale gzip is {len(encoded)} bytes; budget is {source_limit}")
        sources.append(source)
        quality.append({"locale": code, "source_sha256": sha256(original),
                        "minified_sha256": sha256(source), "minified_bytes": len(source),
                        "source_gzip_bytes": len(encoded)})
    # Preserve every original formatter and capture its module helpers in this single scope.
    source = b"(()=>{\n" + b";\n".join(sources) + b"\n})();"
    framed = PREFIX + source
    if len(framed) > MAX_DECODED_BYTES:
        raise ValueError("decoded locale source exceeds its 1 MiB bound")
    crc = zlib.crc32(source)
    packed = encode_frame(framed)
    wrapper = render_wrapper(packed, len(source), crc, decoder, license_text)
    # Do not run a final minifier: the complete upstream notice must survive in the served bytes.
    encoded = compress(wrapper.encode("utf-8"), 5)
    if len(encoded) > bundle_limit:
        raise ValueError(f"locale bundle gzip is {len(encoded)} bytes; budget is {bundle_limit}")
    metadata = {
        "schema_version": PREFIX[-1], "prefix_hex": PREFIX.hex(), "locales": locales,
        "dictionary_bytes": DICTIONARY_BYTES, "preset": 6, "sources": quality,
        "decoded_source_bytes": len(source), "decoded_source_sha256": sha256(source),
        "decoded_source_crc32": f"{crc:08x}", "framed_bytes": len(framed),
        "lzma_header_hex": packed[:13].hex(), "lzma_bytes": len(packed),
        "bundle_gzip_bytes": len(encoded),
        "bundle_sha256": sha256(encoded), "decoder_commit": upstream["commit"],
        "decoder_sha256": upstream["files"]["lzma-d-min.js"],
        "complete_license_served": True,
    }
    return encoded, metadata


def positive(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--locale-dir", type=Path, required=True)
    parser.add_argument("--locales", nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path)
    parser.add_argument("--source-max-gzip-bytes", type=positive, default=MAX_SOURCE_GZIP_BYTES)
    parser.add_argument("--max-gzip-bytes", type=positive, default=MAX_BUNDLE_GZIP_BYTES)
    args = parser.parse_args()
    if args.source_max_gzip_bytes > MAX_SOURCE_GZIP_BYTES or args.max_gzip_bytes > MAX_BUNDLE_GZIP_BYTES:
        parser.error("locale budgets may be tightened, not raised")
    try:
        encoded, metadata = build_bundle(args.locale_dir, args.locales,
                                         args.source_max_gzip_bytes, args.max_gzip_bytes)
    except (OSError, ValueError, lzma.LZMAError, RuntimeError) as error:
        parser.error(str(error))
    args.output.write_bytes(encoded)
    if args.metadata:
        args.metadata.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"locale bundle: {len(args.locales)} catalogs -> {len(encoded)} gzip bytes "
          f"(budget {args.max_gzip_bytes}); source caps {args.source_max_gzip_bytes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
