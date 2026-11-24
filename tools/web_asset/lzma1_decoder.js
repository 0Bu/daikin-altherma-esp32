// Pure-TypedArray standalone LZMA1 (.lzma FORMAT_ALONE) decoder.
// Zero globals, zero 64-bit array pairs, strict 13-byte header and bounds checks.
function lzma1Decompress(packed, maxOut) {
  "use strict";
  if (!packed || (!(packed instanceof Uint8Array) && Object.prototype.toString.call(packed) !== "[object Uint8Array]") ||
      packed.length < 18) {
    throw Error("corrupted input");
  }
  const prop = packed[0];
  if (prop >= 225) {
    throw Error("corrupted input");
  }
  const lc = prop % 9;
  const rem = (prop / 9) | 0;
  const lp = rem % 5;
  const pb = (rem / 5) | 0;
  const dictSize = (packed[1] | (packed[2] << 8) | (packed[3] << 16) | (packed[4] << 24)) >>> 0;
  if (dictSize === 0 || dictSize > 1048576) {
    throw Error("corrupted input");
  }
  const outSize = (packed[5] | (packed[6] << 8) | (packed[7] << 16) | (packed[8] << 24)) >>> 0;
  const outHi = (packed[9] | (packed[10] << 8) | (packed[11] << 16) | (packed[12] << 24)) >>> 0;
  const limit = maxOut > 0 ? maxOut : 1572864;
  if (outHi !== 0 || outSize === 0 || outSize > limit) {
    throw Error("corrupted input");
  }

  // Flat probability table layout (all Uint16 initialized to kBitModelTotal / 2 = 1024):
  //   0..191:     isMatch[12][16]
  //   192..203:   isRep[12]
  //   204..215:   isRepG0[12]
  //   216..227:   isRepG1[12]
  //   228..239:   isRepG2[12]
  //   240..431:   isRep0Long[12][16]
  //   432..687:   posSlot[4][64]
  //   688..801:   posDecoders[114]
  //   802..817:   posAlign[16]
  //   818..1331:  lenDecoder (2 choice + 128 low + 128 mid + 256 high)
  //   1332..1845: repLenDecoder (2 choice + 128 low + 128 mid + 256 high)
  //   1846..:     litProbs[1 << (lc + lp)][768]
  const litBaseOffset = 1846;
  const probs = new Uint16Array(litBaseOffset + (768 << (lc + lp)));
  probs.fill(1024);

  const out = new Uint8Array(outSize);
  const inLen = packed.length;
  let inPos = 13;
  let range = -1;
  let code = 0;
  for (let i = 0; i < 5; i++) {
    code = (code << 8) | packed[inPos++];
  }

  function decodeBit(idx) {
    const prob = probs[idx];
    const bound = ((range >>> 11) * prob) | 0;
    if ((code ^ -2147483648) < (bound ^ -2147483648)) {
      range = bound;
      probs[idx] = prob + ((2048 - prob) >>> 5);
      if ((range & -16777216) === 0) {
        if (inPos >= inLen) {
          throw Error("corrupted input");
        }
        code = (code << 8) | packed[inPos++];
        range <<= 8;
      }
      return 0;
    }
    range = (range - bound) | 0;
    code = (code - bound) | 0;
    probs[idx] = prob - (prob >>> 5);
    if ((range & -16777216) === 0) {
      if (inPos >= inLen) {
        throw Error("corrupted input");
      }
      code = (code << 8) | packed[inPos++];
      range <<= 8;
    }
    return 1;
  }

  function decodeTree(base, numBits) {
    let m = 1;
    for (let i = 0; i < numBits; i++) {
      m = (m << 1) | decodeBit(base + m);
    }
    return m - (1 << numBits);
  }

  function decodeReverseTree(base, numBits) {
    let m = 1;
    let symbol = 0;
    for (let i = 0; i < numBits; i++) {
      const bit = decodeBit(base + m);
      m = (m << 1) | bit;
      symbol |= bit << i;
    }
    return symbol;
  }

  function decodeDirect(numBits) {
    let result = 0;
    for (let i = 0; i < numBits; i++) {
      range >>>= 1;
      result <<= 1;
      if ((code ^ -2147483648) >= (range ^ -2147483648)) {
        code = (code - range) | 0;
        result |= 1;
      }
      if ((range & -16777216) === 0) {
        if (inPos >= inLen) {
          throw Error("corrupted input");
        }
        code = (code << 8) | packed[inPos++];
        range <<= 8;
      }
    }
    return result >>> 0;
  }

  function decodeLength(base, posState) {
    if (decodeBit(base) === 0) {
      return decodeTree(base + 2 + (posState << 3), 3);
    }
    if (decodeBit(base + 1) === 0) {
      return 8 + decodeTree(base + 130 + (posState << 3), 3);
    }
    return 16 + decodeTree(base + 258, 8);
  }

  const posMask = (1 << pb) - 1;
  const lpMask = (1 << lp) - 1;
  const litShift = 8 - lc;
  let state = 0;
  let rep0 = 0;
  let rep1 = 0;
  let rep2 = 0;
  let rep3 = 0;
  let outPos = 0;

  while (outPos < outSize) {
    const posState = outPos & posMask;
    if (decodeBit((state << 4) + posState) === 0) {
      const prev = outPos > 0 ? out[outPos - 1] : 0;
      const litBase = litBaseOffset + (((outPos & lpMask) << lc) + (prev >>> litShift)) * 768;
      let sym = 1;
      if (state >= 7) {
        if (rep0 >= outPos) {
          throw Error("corrupted input");
        }
        let matchByte = out[outPos - rep0 - 1];
        while (sym < 256) {
          const matchBit = (matchByte >>> 7) & 1;
          matchByte = (matchByte << 1) & 0xff;
          const b = decodeBit(litBase + ((1 + matchBit) << 8) + sym);
          sym = (sym << 1) | b;
          if (matchBit !== b) {
            break;
          }
        }
      }
      while (sym < 256) {
        sym = (sym << 1) | decodeBit(litBase + sym);
      }
      out[outPos++] = sym & 0xff;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
    } else {
      let len;
      if (decodeBit(192 + state) !== 0) {
        len = 0;
        if (decodeBit(204 + state) === 0) {
          if (decodeBit(240 + (state << 4) + posState) === 0) {
            state = state < 7 ? 9 : 11;
            len = 1;
          }
        } else {
          let dist;
          if (decodeBit(216 + state) === 0) {
            dist = rep1;
          } else {
            if (decodeBit(228 + state) === 0) {
              dist = rep2;
            } else {
              dist = rep3;
              rep3 = rep2;
            }
            rep2 = rep1;
          }
          rep1 = rep0;
          rep0 = dist;
        }
        if (len === 0) {
          len = 2 + decodeLength(1332, posState);
          state = state < 7 ? 8 : 11;
        }
      } else {
        rep3 = rep2;
        rep2 = rep1;
        rep1 = rep0;
        len = 2 + decodeLength(818, posState);
        state = state < 7 ? 7 : 10;
        const slot = decodeTree(432 + ((len - 2 < 4 ? len - 2 : 3) << 6), 6);
        if (slot >= 4) {
          const directBits = (slot >> 1) - 1;
          rep0 = ((2 | (slot & 1)) << directBits) >>> 0;
          if (slot < 14) {
            rep0 += decodeReverseTree(688 + rep0 - slot - 1, directBits);
          } else {
            rep0 = (rep0 + (decodeDirect(directBits - 4) << 4) + decodeReverseTree(802, 4)) >>> 0;
          }
        } else {
          rep0 = slot;
        }
      }
      if (rep0 >= outPos || rep0 >= dictSize || outPos + len > outSize) {
        throw Error("corrupted input");
      }
      let src = outPos - rep0 - 1;
      for (let i = 0; i < len; i++) {
        out[outPos++] = out[src++];
      }
    }
  }
  return out;
}
