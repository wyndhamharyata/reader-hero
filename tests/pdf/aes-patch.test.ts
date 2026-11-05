/// <reference types="node" />
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { patchAes } from "../../scripts/aes-patch.mjs";

interface Cipher {
  decryptBlock(data: Uint8Array, finalize: boolean, iv?: Uint8Array | null): Uint8Array;
}
type CipherClass = new (key: Uint8Array) => Cipher;
interface Ciphers {
  readonly RhAes128: CipherClass;
  readonly RhAes256: CipherClass;
}

const workerDir = join(process.cwd(), "node_modules", "pdfjs-dist", "build");
const source = readFileSync(join(workerDir, "pdf.worker.mjs"), "utf8");
const exposed = "\nexport { AES128Cipher as RhAes128, AES256Cipher as RhAes256 };\n";

// pdf.js's own cipher classes, as shipped and as patched, loaded from a copy that exports them.
const load = async (text: string): Promise<Ciphers> => {
  const path = join(mkdtempSync(join(tmpdir(), "rh-aes-")), "worker.mjs");

  writeFileSync(path, text.replace(/^\/\/# sourceMappingURL=.*$/m, "") + exposed);

  return (await import(/* @vite-ignore */ pathToFileURL(path).href)) as Ciphers;
};

let shipped: Ciphers;
let patched: Ciphers;

beforeAll(async () => {
  shipped = await load(source);
  patched = await load(patchAes(source));
}, 60_000);

const encrypt = (
  bits: 128 | 256,
  key: Uint8Array,
  iv: Uint8Array,
  plain: Uint8Array,
): Uint8Array => {
  const cipher = createCipheriv(`aes-${bits}-cbc`, key, iv);

  return new Uint8Array(Buffer.concat([cipher.update(plain), cipher.final()]));
};

// The way pdf.js reads a stream: the IV leads the data, which comes in pieces, and the last piece finalizes.
const decrypt = (
  Class: CipherClass,
  key: Uint8Array,
  data: Uint8Array,
  piece: number,
): Uint8Array => {
  const cipher = new Class(key);
  const parts: Array<Uint8Array> = [];

  for (let at = 0; at < data.length; at += piece) {
    parts.push(cipher.decryptBlock(data.subarray(at, at + piece), at + piece >= data.length));
  }

  return new Uint8Array(Buffer.concat(parts));
};

describe("patchAes", () => {
  it("given pdf.js's shipped minified worker, finds the one method it replaces", () => {
    const minified = readFileSync(join(workerDir, "pdf.worker.min.mjs"), "utf8");

    expect(patchAes(minified)).toContain("_decryptBlock2Slow(");
  });

  it("given a pdf.js without the method, fails the build instead of shipping it unpatched", () => {
    expect(() => patchAes("class A {}")).toThrow(/expected one _decryptBlock2/);
  });

  for (const bits of [128, 256] as const) {
    it(`given AES-${bits} data in whole and in pieces, decrypts to the same bytes as pdf.js and as Node`, () => {
      const Class = bits === 128 ? "RhAes128" : "RhAes256";

      for (const size of [0, 1, 15, 16, 17, 31, 32, 1000, 65_536 + 7]) {
        const key = new Uint8Array(randomBytes(bits / 8));
        const iv = new Uint8Array(randomBytes(16));
        const plain = new Uint8Array(randomBytes(size));
        const data = new Uint8Array([...iv, ...encrypt(bits, key, iv, plain)]);

        for (const piece of [data.length, 16, 48, 4096]) {
          const fast = decrypt(patched[Class], key, data, piece);

          expect(fast).toEqual(decrypt(shipped[Class], key, data, piece));
          expect(fast).toEqual(plain);
        }
      }
    });

    it(`given AES-${bits} pieces that split a block, matches pdf.js byte for byte`, () => {
      const Class = bits === 128 ? "RhAes128" : "RhAes256";
      const key = new Uint8Array(randomBytes(bits / 8));
      const data = new Uint8Array(randomBytes(16 + 16 * 40 + 9));

      for (const piece of [7, 33, 100]) {
        expect(decrypt(patched[Class], key, data, piece)).toEqual(
          decrypt(shipped[Class], key, data, piece),
        );
      }
    });
  }
});
