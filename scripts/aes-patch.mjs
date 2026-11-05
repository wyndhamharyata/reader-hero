// pdf.js decrypts AES a byte at a time with two new arrays per block, most of an encrypted book's import on a slow phone. This is a word-at-a-time version.
const code = `// Injected at build time by scripts/aes-patch.mjs
let __rhAesTables = null;

function __rhAesBuildTables(cipher) {
  const inv = cipher._inv_s;
  const multiply = (a, b) => {
    let product = 0;

    for (; b > 0; b >>= 1) {
      if (b & 1) product ^= a;
      a = (a << 1) ^ (a & 0x80 ? 0x11b : 0);
    }

    return product;
  };
  const t0 = new Uint32Array(256);
  const t1 = new Uint32Array(256);
  const t2 = new Uint32Array(256);
  const t3 = new Uint32Array(256);

  for (let x = 0; x < 256; x += 1) {
    const s = inv[x];
    const word = ((multiply(s, 14) << 24) | (multiply(s, 9) << 16) | (multiply(s, 13) << 8) | multiply(s, 11)) >>> 0;

    t0[x] = word;
    t1[x] = (word >>> 8) | (word << 24);
    t2[x] = (word >>> 16) | (word << 16);
    t3[x] = (word >>> 24) | (word << 8);
  }

  return { t0, t1, t2, t3, inv, sbox: cipher._s };
}

// The decryption round keys: pdf.js's expanded key in reverse, with InvMixColumns on the middle rounds.
function __rhAesRoundKeys(cipher, tables) {
  const expanded = cipher._key;
  const rounds = cipher._cyclesOfRepetition;
  const { t0, t1, t2, t3, sbox } = tables;
  const keys = new Uint32Array((rounds + 1) * 4);

  for (let round = 0; round <= rounds; round += 1) {
    for (let column = 0; column < 4; column += 1) {
      const at = (rounds - round) * 16 + column * 4;
      let word = ((expanded[at] << 24) | (expanded[at + 1] << 16) | (expanded[at + 2] << 8) | expanded[at + 3]) >>> 0;

      if (round > 0 && round < rounds) {
        word = t0[sbox[word >>> 24]] ^ t1[sbox[(word >>> 16) & 255]] ^ t2[sbox[(word >>> 8) & 255]] ^ t3[sbox[word & 255]];
      }

      keys[round * 4 + column] = word;
    }
  }

  return keys;
}

function __rhAesCbc(cipher, data, finalize) {
  if (cipher.bufferPosition !== 0) return cipher._decryptBlock2Slow(data, finalize);

  const tables = (__rhAesTables ??= __rhAesBuildTables(cipher));
  const keys = (cipher.__rhAesKeys ??= __rhAesRoundKeys(cipher, tables));
  const { t0, t1, t2, t3, inv } = tables;
  const rounds = cipher._cyclesOfRepetition;
  const blocks = data.length >> 4;
  const buffer = new Uint8Array(16);

  buffer.set(data.subarray(blocks * 16));
  cipher.buffer = buffer;
  cipher.bufferLength = data.length & 15;
  if (blocks === 0) return new Uint8Array(0);

  const out = new Uint8Array(blocks * 16);
  const iv = cipher.iv;
  let p0 = ((iv[0] << 24) | (iv[1] << 16) | (iv[2] << 8) | iv[3]) >>> 0;
  let p1 = ((iv[4] << 24) | (iv[5] << 16) | (iv[6] << 8) | iv[7]) >>> 0;
  let p2 = ((iv[8] << 24) | (iv[9] << 16) | (iv[10] << 8) | iv[11]) >>> 0;
  let p3 = ((iv[12] << 24) | (iv[13] << 16) | (iv[14] << 8) | iv[15]) >>> 0;

  for (let at = 0; at < blocks * 16; at += 16) {
    const c0 = ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0;
    const c1 = ((data[at + 4] << 24) | (data[at + 5] << 16) | (data[at + 6] << 8) | data[at + 7]) >>> 0;
    const c2 = ((data[at + 8] << 24) | (data[at + 9] << 16) | (data[at + 10] << 8) | data[at + 11]) >>> 0;
    const c3 = ((data[at + 12] << 24) | (data[at + 13] << 16) | (data[at + 14] << 8) | data[at + 15]) >>> 0;
    let s0 = c0 ^ keys[0];
    let s1 = c1 ^ keys[1];
    let s2 = c2 ^ keys[2];
    let s3 = c3 ^ keys[3];
    let k = 4;

    for (let round = 1; round < rounds; round += 1, k += 4) {
      const n0 = t0[s0 >>> 24] ^ t1[(s3 >>> 16) & 255] ^ t2[(s2 >>> 8) & 255] ^ t3[s1 & 255] ^ keys[k];
      const n1 = t0[s1 >>> 24] ^ t1[(s0 >>> 16) & 255] ^ t2[(s3 >>> 8) & 255] ^ t3[s2 & 255] ^ keys[k + 1];
      const n2 = t0[s2 >>> 24] ^ t1[(s1 >>> 16) & 255] ^ t2[(s0 >>> 8) & 255] ^ t3[s3 & 255] ^ keys[k + 2];
      const n3 = t0[s3 >>> 24] ^ t1[(s2 >>> 16) & 255] ^ t2[(s1 >>> 8) & 255] ^ t3[s0 & 255] ^ keys[k + 3];

      s0 = n0;
      s1 = n1;
      s2 = n2;
      s3 = n3;
    }

    const w0 = ((inv[s0 >>> 24] << 24) | (inv[(s3 >>> 16) & 255] << 16) | (inv[(s2 >>> 8) & 255] << 8) | inv[s1 & 255]) ^ keys[k] ^ p0;
    const w1 = ((inv[s1 >>> 24] << 24) | (inv[(s0 >>> 16) & 255] << 16) | (inv[(s3 >>> 8) & 255] << 8) | inv[s2 & 255]) ^ keys[k + 1] ^ p1;
    const w2 = ((inv[s2 >>> 24] << 24) | (inv[(s1 >>> 16) & 255] << 16) | (inv[(s0 >>> 8) & 255] << 8) | inv[s3 & 255]) ^ keys[k + 2] ^ p2;
    const w3 = ((inv[s3 >>> 24] << 24) | (inv[(s2 >>> 16) & 255] << 16) | (inv[(s1 >>> 8) & 255] << 8) | inv[s0 & 255]) ^ keys[k + 3] ^ p3;

    out[at] = w0 >>> 24;
    out[at + 1] = w0 >>> 16;
    out[at + 2] = w0 >>> 8;
    out[at + 3] = w0;
    out[at + 4] = w1 >>> 24;
    out[at + 5] = w1 >>> 16;
    out[at + 6] = w1 >>> 8;
    out[at + 7] = w1;
    out[at + 8] = w2 >>> 24;
    out[at + 9] = w2 >>> 16;
    out[at + 10] = w2 >>> 8;
    out[at + 11] = w2;
    out[at + 12] = w3 >>> 24;
    out[at + 13] = w3 >>> 16;
    out[at + 14] = w3 >>> 8;
    out[at + 15] = w3;
    p0 = c0;
    p1 = c1;
    p2 = c2;
    p3 = c3;
  }

  cipher.iv = data.slice(blocks * 16 - 16, blocks * 16);

  // The padding check pdf.js runs on the last block, kept as it is.
  let length = out.length;

  if (finalize) {
    let padding = out[length - 1];

    if (padding <= 16) {
      for (let i = 15, last = 16 - padding; i >= last; i -= 1) {
        if (out[length - 16 + i] !== padding) {
          padding = 0;
          break;
        }
      }

      length -= padding;
    }
  }

  return length === out.length ? out : out.subarray(0, length);
}
`;

const definition = /_decryptBlock2\(([\w$]+), ?([\w$]+)\) ?\{/g;

// The build fails when pdf.js changes this method, so an upgrade cannot drop the patch unseen.
export function patchAes(source) {
  const found = source.match(definition) ?? [];

  if (found.length !== 1) {
    throw new Error(`aes-patch: expected one _decryptBlock2 in pdf.js, found ${found.length}`);
  }

  return (
    code +
    source.replace(
      definition,
      (_, data, finalize) =>
        `_decryptBlock2(${data}, ${finalize}) { return __rhAesCbc(this, ${data}, ${finalize}); } _decryptBlock2Slow(${data}, ${finalize}) {`,
    )
  );
}
