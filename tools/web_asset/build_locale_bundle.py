#!/usr/bin/env python3
"""Build five offline, self-contained locale resources without changing the startup page."""

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
DECODER_PATH = ROOT / "lzma1_decoder.js"
PREFIX = bytes((255, 76, 90, 77, 65, 1))  # invalid UTF-8 lead, LZMA, schema 1
DICTIONARY_BYTES = 512 * 1024
LZMA_POSITION_BITS = 0
LZMA_NICE_LENGTH = 128
# ASCII text locales have no byte-aligned 32-bit binary records: pb=0 removes position-state bit
# modelling (properties = lc + 9*lp + 45*pb = 3), trading negligible ratio on raw LZMA for lower
# entropy under gzip and a higher nice length. Keep lc=3, lp=0 and the 512 KiB dictionary.
LZMA_PROPERTIES = bytes((3, 0, 0, 8, 0))
MAX_DECODED_BYTES = 1024 * 1024
MAX_LOCALE_DECODED_BYTES = 1536 * 1024
MAX_SOURCE_GZIP_BYTES = 32768
MAX_PACKS_GZIP_BYTES = 296960

# Single source of truth for the five shipped locale packs:
# - `de`: plain zopfli-gzipped minified JS (zero LZMA overhead on the primary external locale)
# - 4 cognate packs: self-contained pure-TypedArray LZMA1 frames for shared-prefix dictionaries
LOCALE_PACKS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("de", ("de",)),
    ("romance", ("es", "fr", "it")),
    ("slavic", ("pl", "cs", "uk")),
    ("nordic", ("nb", "sv", "fi")),
    ("cjk", ("zh", "ja")),
)
LOCALE_TO_PACK: dict[str, str] = {
    code: pack_name for pack_name, codes in LOCALE_PACKS for code in codes
}


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_decoder(decoder_path: Path = DECODER_PATH) -> str:
    """Load and minify the first-party pure-TypedArray LZMA1 decoder."""
    raw = decoder_path.read_text(encoding="utf-8")
    minified = minify_javascript(raw)
    if not minified.startswith("function lzma1Decompress(") or "</script" in minified.lower():
        raise ValueError("unexpected pure-TypedArray LZMA1 decoder source")
    return minified


def compute_locale_asset_tag(locale_dir: Path, decoder_path: Path = DECODER_PATH) -> str:
    """Compute one deterministic 8-hex cache-busting tag across locale sources and packer inputs."""
    hasher = hashlib.sha256()
    hasher.update(json.dumps(LOCALE_PACKS, separators=(",", ":")).encode("utf-8"))
    hasher.update(b"\0")
    hasher.update(Path(__file__).read_bytes())
    hasher.update(b"\0")
    hasher.update(decoder_path.read_bytes())
    for path in sorted(locale_dir.glob("*.js")):
        hasher.update(b"\0")
        hasher.update(path.name.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(path.read_bytes())
    return hasher.hexdigest()[:8]


def render_tag_header(tag: str) -> str:
    if re.fullmatch(r"[0-9a-f]{8}", tag) is None:
        raise ValueError(f"invalid locale asset tag: {tag!r}")
    return f'#pragma once\nnamespace daik {{ inline constexpr char LOCALE_ASSET_TAG[] = "{tag}"; }}\n'


def encode_frame(frame: bytes, max_decoded_bytes: int = MAX_LOCALE_DECODED_BYTES) -> bytes:
    if not frame or len(frame) > max_decoded_bytes:
        raise ValueError("decoded locale frame exceeds its bound")
    packed = lzma.compress(frame, format=lzma.FORMAT_ALONE,
                           filters=[{"id": lzma.FILTER_LZMA1, "preset": 6,
                                     "dict_size": DICTIONARY_BYTES,
                                     "pb": LZMA_POSITION_BITS,
                                     "nice_len": LZMA_NICE_LENGTH}])
    if packed[:5] != LZMA_PROPERTIES or packed[5:13] != b"\xff" * 8:
        raise ValueError("unexpected locale LZMA properties")
    # Enforce explicit outSize so corrupt streams cannot expand unboundedly.
    packed = packed[:5] + len(frame).to_bytes(8, "little") + packed[13:]
    if lzma.decompress(packed, format=lzma.FORMAT_ALONE) != frame:
        raise ValueError("locale LZMA round trip changed the input")
    return packed


def render_plain_wrapper(pack_name: str, codes: tuple[str, ...], source_bytes: int,
                         source_crc32: int, source_js: str) -> str:
    """Wrap plain minified locale JS with idempotency and completeness guards."""
    codes_js = json.dumps(list(codes), separators=(",", ":"))
    return (
        '(()=>{"use strict";if(typeof window==="undefined"||!window.document)throw Error("window required");'
        f'const key=Symbol.for("daikin-altherma-esp32.locales.v1.{pack_name}.{source_bytes}.{source_crc32:08x}"),'
        f'ready=()=>({codes_js}).every(localeReady);'
        'if(window[key]===true&&ready())return;'
        + source_js.rstrip(";") + "\n;"
        + 'if(!ready())throw Error("locale bundle incomplete");window[key]=true;})();'
    )


def render_wrapper(packed: bytes, source_bytes: int, source_crc32: int,
                   decoder: str, pack_name: str = "bundle",
                   codes: tuple[str, ...] = ()) -> str:
    """Synchronous registration preserves the existing script.onload language lease.

    Each cognate pack embeds the self-contained TypedArray LZMA1 decoder directly, checks the
    13-byte header, frame length, magic prefix, CRC32 and UTF-8 before executing the catalog script.
    No browser worker, Blob, eval, global decoder export or message handler is installed.
    """
    if source_bytes < 0 or source_bytes + len(PREFIX) > MAX_LOCALE_DECODED_BYTES:
        raise ValueError("decoded locale source exceeds its 1.5 MiB bound")
    encoded = base64.b64encode(packed).decode("ascii")
    header = LZMA_PROPERTIES + (source_bytes + len(PREFIX)).to_bytes(8, "little")
    header_values = json.dumps(list(header), separators=(",", ":"))
    codes_js = json.dumps(list(codes), separators=(",", ":"))
    ready_expr = (
        f"{codes_js}.every(localeReady)"
        if codes
        else 'UI_LANGS.filter(x=>x!=="en").every(localeReady)'
    )
    return (
        '(()=>{"use strict";if(typeof window==="undefined"||!window.document)throw Error("window required");'
        f'const key=Symbol.for("daikin-altherma-esp32.locales.v1.{pack_name}.{source_bytes}.{source_crc32:08x}"),'
        f'ready=()=>{ready_expr};'
        'if(window[key]===true&&ready())return;'
        f'const bin=atob("{encoded}"),packed=new Uint8Array(bin.length);'
        'for(let i=0;i<bin.length;i++)packed[i]=bin.charCodeAt(i);'
        f'if(packed.length<13||!{header_values}.every((v,i)=>packed[i]===v))'
        'throw Error("locale LZMA header");'
        + decoder +
        f'const all=lzma1Decompress(packed,{source_bytes + len(PREFIX)});'
        f'if(all.length!=={source_bytes + len(PREFIX)})'
        'throw Error("locale payload length");'
        'if(![255,76,90,77,65].every((v,i)=>all[i]===v))throw Error("locale payload prefix");'
        'if(all[5]!==1)throw Error("locale payload version");const bytes=all.subarray(6);'
        'const table=new Int32Array(256);for(let n=0;n<256;n++){let c=n;'
        'for(let k=0;k<8;k++)c=c&1?-306674912^(c>>>1):c>>>1;table[n]=c;}'
        'let checksum=-1;for(let i=0;i<bytes.length;i++)checksum=table[(checksum^bytes[i])&255]^(checksum>>>8);'
        f'if(((checksum^4294967295)>>>0)!=={source_crc32})'
        'throw Error("locale payload integrity");'
        'const script=document.createElement("script");'
        'script.textContent=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);'
        'document.head.append(script);script.remove();'
        'if(!ready())throw Error("locale bundle incomplete");window[key]=true;})();'
    )


def build_packs(locale_dir: Path, locales: list[str], source_limit: int,
                total_limit: int, decoder_path: Path = DECODER_PATH) -> tuple[dict[str, bytes], dict]:
    if not locales or len(set(locales)) != len(locales) or any(
            re.fullmatch(r"[a-z]{2}", code) is None for code in locales):
        raise ValueError("locale codes must be unique two-letter identifiers")
    available = {path.stem for path in locale_dir.glob("*.js")}
    if set(locales) != available:
        raise ValueError("locale pack inventory differs from the source directory")
    if set(locales) != set(LOCALE_TO_PACK):
        raise ValueError("locale pack inventory differs from the canonical five-pack map")
    decoder = load_decoder(decoder_path)
    minified_by_code: dict[str, bytes] = {}
    quality_by_code: dict[str, dict] = {}
    for code in locales:
        path = locale_dir / f"{code}.js"
        original = path.read_bytes()
        source = minify_javascript(original.decode("utf-8")).encode("utf-8")
        # Independent per-file quality gates stay enforced even when cognate languages share a pack.
        encoded = compress(source, 5)
        if len(encoded) > source_limit:
            raise ValueError(f"{code} locale gzip is {len(encoded)} bytes; budget is {source_limit}")
        minified_by_code[code] = source
        quality_by_code[code] = {
            "locale": code,
            "pack": LOCALE_TO_PACK[code],
            "source_sha256": sha256(original),
            "minified_sha256": sha256(source),
            "minified_bytes": len(source),
            "source_gzip_bytes": len(encoded),
        }

    packs_gzip: dict[str, bytes] = {}
    pack_meta: list[dict] = []
    for pack_name, codes in LOCALE_PACKS:
        if pack_name == "de":
            source = minified_by_code["de"]
            crc = zlib.crc32(source)
            wrapper = render_plain_wrapper(pack_name, codes, len(source), crc, source.decode("utf-8"))
            encoded = compress(wrapper.encode("utf-8"), 5)
            packs_gzip[pack_name] = encoded
            pack_meta.append({
                "name": pack_name,
                "locales": list(codes),
                "encoding": "gzip",
                "decoded_source_bytes": len(source),
                "decoded_source_sha256": sha256(source),
                "decoded_source_crc32": f"{crc:08x}",
                "pack_gzip_bytes": len(encoded),
                "pack_sha256": sha256(encoded),
            })
        else:
            source = b"(()=>{\n" + b";\n".join(minified_by_code[c] for c in codes) + b"\n})();"
            framed = PREFIX + source
            if len(framed) > MAX_LOCALE_DECODED_BYTES:
                raise ValueError(f"decoded locale pack {pack_name} exceeds its 1.5 MiB bound")
            crc = zlib.crc32(source)
            packed = encode_frame(framed)
            wrapper = render_wrapper(packed, len(source), crc, decoder, pack_name=pack_name, codes=codes)
            encoded = compress(wrapper.encode("utf-8"), 5)
            packs_gzip[pack_name] = encoded
            pack_meta.append({
                "name": pack_name,
                "locales": list(codes),
                "encoding": "lzma+gzip",
                "decoded_source_bytes": len(source),
                "decoded_source_sha256": sha256(source),
                "decoded_source_crc32": f"{crc:08x}",
                "framed_bytes": len(framed),
                "lzma_header_hex": packed[:13].hex(),
                "lzma_bytes": len(packed),
                "pack_gzip_bytes": len(encoded),
                "pack_sha256": sha256(encoded),
            })

    total_gzip_bytes = sum(len(data) for data in packs_gzip.values())
    if total_gzip_bytes > total_limit:
        raise ValueError(
            f"locale packs gzip total is {total_gzip_bytes} bytes; budget is {total_limit}"
        )

    tag = compute_locale_asset_tag(locale_dir, decoder_path)
    metadata = {
        "schema_version": PREFIX[-1],
        "prefix_hex": PREFIX.hex(),
        "locales": locales,
        "locale_asset_tag": tag,
        "dictionary_bytes": DICTIONARY_BYTES,
        "preset": 6,
        "sources": [quality_by_code[code] for code in locales],
        "packs": pack_meta,
        "total_gzip_bytes": total_gzip_bytes,
        "decoder_sha256": sha256(decoder_path.read_bytes()),
    }
    return packs_gzip, metadata


def positive(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--locale-dir", type=Path, required=True)
    parser.add_argument("--locales", nargs="+", required=True)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--tag-header", type=Path)
    parser.add_argument("--metadata", type=Path)
    parser.add_argument("--print-locale-tag", action="store_true")
    parser.add_argument("--source-max-gzip-bytes", type=positive, default=MAX_SOURCE_GZIP_BYTES)
    parser.add_argument("--max-gzip-bytes", type=positive, default=MAX_PACKS_GZIP_BYTES)
    args = parser.parse_args()
    if args.source_max_gzip_bytes > MAX_SOURCE_GZIP_BYTES or args.max_gzip_bytes > MAX_PACKS_GZIP_BYTES:
        parser.error("locale budgets may be tightened, not raised")
    if args.print_locale_tag:
        print(compute_locale_asset_tag(args.locale_dir))
        return 0
    if args.output_dir is None:
        parser.error("--output-dir is required unless --print-locale-tag is given")
    try:
        packs, metadata = build_packs(args.locale_dir, args.locales,
                                      args.source_max_gzip_bytes, args.max_gzip_bytes)
    except (OSError, ValueError, lzma.LZMAError, RuntimeError) as error:
        parser.error(str(error))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for pack_name, data in packs.items():
        (args.output_dir / f"locale-{pack_name}.js.gz").write_bytes(data)
    if args.tag_header:
        args.tag_header.parent.mkdir(parents=True, exist_ok=True)
        args.tag_header.write_text(render_tag_header(metadata["locale_asset_tag"]), encoding="utf-8")
    if args.metadata:
        args.metadata.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"locale packs: {len(packs)} packs for {len(args.locales)} catalogs -> "
          f"{metadata['total_gzip_bytes']} gzip bytes (budget {args.max_gzip_bytes}); "
          f"source caps {args.source_max_gzip_bytes}; tag {metadata['locale_asset_tag']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
