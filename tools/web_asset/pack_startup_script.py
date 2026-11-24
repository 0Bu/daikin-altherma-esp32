"""Pack the assembled dashboard's one classic script after syntax minification."""

import base64
import json
import lzma
from pathlib import Path
import re
import zlib

from build_locale_bundle import MAX_DECODED_BYTES, PREFIX, encode_frame, load_decoder


OPEN_SCRIPT = "<script>"
CLOSE_SCRIPT = "</script>"
SCRIPT_TAG = re.compile(r"</?script(?=[\t\n\f\r />]|$)", re.IGNORECASE)
SCRIPT_END = re.compile(r"</script(?=[\t\n\f\r />]|$)", re.IGNORECASE)
BODY_END = re.compile(r"\s*</body>\s*</html>\s*\Z")
APP_MARKER = "//@@INLINE:app.js@@"
LOCALE_TAG_DECL = 'const LOCALE_ASSET_TAG=""'


def script_span(page: str) -> tuple[int, int]:
    if page.count(OPEN_SCRIPT) != 1 or page.count(CLOSE_SCRIPT) != 1:
        raise ValueError("expected one plain startup script slot")
    opening = page.index(OPEN_SCRIPT)
    start = opening + len(OPEN_SCRIPT)
    end = page.index(CLOSE_SCRIPT)
    tail = page[end + len(CLOSE_SCRIPT):]
    if (end < start or not BODY_END.fullmatch(tail) or SCRIPT_TAG.search(page[:opening])):
        raise ValueError("expected the sole classic startup script at the end of the dashboard body")
    if SCRIPT_END.search(page[start:end]):
        raise ValueError("unsafe script end in startup script")
    return start, end


def validate_assembled_app(page: str, manifest: Path) -> None:
    """Require the ordered app.sources bytes from the canonical assembly, before minification."""
    if APP_MARKER in page:
        raise ValueError("startup app marker was not assembled")
    start, end = script_span(page)
    entries = [line.strip() for line in manifest.read_text(encoding="utf-8-sig").splitlines()]
    sources = []
    root = manifest.parent.resolve()
    for entry in entries:
        if not entry or entry.startswith("#"):
            continue
        relative = Path(entry)
        if relative.is_absolute() or ".." in relative.parts or relative.suffix != ".js":
            raise ValueError("unsafe startup script manifest entry")
        source = (root / relative).resolve()
        if not source.is_relative_to(root):
            raise ValueError("unsafe startup script manifest entry")
        sources.append(source.read_text(encoding="utf-8"))
    if not sources or page[start:end] != "\n" + "".join(sources):
        raise ValueError("startup script slot differs from the assembled app.sources")


def stamp_locale_tag(script_text: str, locale_tag: str | None) -> str:
    if not locale_tag:
        return script_text
    if re.fullmatch(r"[0-9a-f]{8}", locale_tag) is None:
        raise ValueError(f"invalid locale asset tag: {locale_tag!r}")
    count = script_text.count(LOCALE_TAG_DECL)
    if count == 1:
        return script_text.replace(LOCALE_TAG_DECL, f'const LOCALE_ASSET_TAG="{locale_tag}"', 1)
    if count > 1 or "LOCALE_ASSET_TAG" in script_text:
        raise ValueError("startup script must contain at most one exact LOCALE_ASSET_TAG placeholder")
    return script_text


def pack_startup_script(page: str, locale_tag: str | None = None) -> str:
    """Replace only the minified script content and leave the exact HTML slot in place."""
    start, end = script_span(page)
    script_text = stamp_locale_tag(page[start:end], locale_tag)
    source = script_text.encode("utf-8")
    frame = PREFIX + source
    if not source or len(frame) > MAX_DECODED_BYTES:
        raise ValueError("startup script frame must be nonempty and fit the 1 MiB decoded bound")
    decoder = load_decoder()
    try:
        packed = encode_frame(frame, MAX_DECODED_BYTES)
    except lzma.LZMAError as error:
        raise ValueError(f"startup script LZMA encoding failed: {error}") from error

    encoded = base64.b64encode(packed).decode("ascii")
    header = json.dumps(list(packed[:13]), separators=(",", ":"))
    prefix = json.dumps(list(PREFIX), separators=(",", ":"))
    crc = zlib.crc32(source)
    # A connected classic script with inline text executes synchronously on insertion. Use the
    # existing body-end element as the anchor. This slot deliberately accepts no attributes;
    # a nonce, module conversion or a new CSP needs its own execution review.
    wrapper = (
        '(()=>{"use strict";const slot=document.currentScript;if(!slot||!slot.isConnected)throw Error("app script slot");'
        f'const bin=atob("{encoded}"),packed=new Uint8Array(bin.length);'
        'for(let i=0;i<bin.length;i++)packed[i]=bin.charCodeAt(i);'
        f'if(packed.length<13||!{header}.every((v,i)=>packed[i]===v))'
        'throw Error("app LZMA header");'
        + decoder +
        f'const all=lzma1Decompress(packed,{len(frame)});'
        f'if(all.length!=={len(frame)})throw Error("app payload length");'
        f'if(!{prefix}.every((v,i)=>all[i]===v))throw Error("app payload prefix");'
        f'const bytes=all.subarray({len(PREFIX)});'
        'const table=new Int32Array(256);for(let n=0;n<256;n++){let c=n;'
        'for(let k=0;k<8;k++)c=c&1?-306674912^(c>>>1):c>>>1;table[n]=c;}'
        'let checksum=-1;for(let i=0;i<bytes.length;i++)checksum=table[(checksum^bytes[i])&255]^(checksum>>>8);'
        f'if(((checksum^4294967295)>>>0)!=={crc})throw Error("app payload integrity");'
        'const source=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);'
        'const script=document.createElement("script");script.textContent=source;'
        'slot.after(script);script.remove();})();'
    )
    if SCRIPT_END.search(wrapper):
        raise ValueError("unsafe script end in startup wrapper")
    return page[:start] + wrapper + page[end:]
