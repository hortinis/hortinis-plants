import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compressDeterministicGzip } from "../../src/artifact/deterministic-gzip.js";

const input = new TextEncoder().encode('{"a":1}\n{"b":2}\n');

describe("deterministic gzip", () => {
  it("produces stable bytes and metadata", () => {
    const first = compressDeterministicGzip(input, 2);
    const second = compressDeterministicGzip(input, 2);

    expect(first.bytes).toEqual(second.bytes);
    expect(first.sha256).toBe(
      createHash("sha256").update(first.bytes).digest("hex"),
    );
    expect(first.compressedByteSize).toBe(first.bytes.byteLength);
    expect(first.entryCount).toBe(2);
    expect(first.bytes.slice(4, 8)).toEqual(new Uint8Array([0, 0, 0, 0]));
    expect(first.bytes[9]).toBe(0xff);
  });

  it("matches the pinned V1 golden output", () => {
    const result = compressDeterministicGzip(input, 2);

    expect(Buffer.from(result.bytes).toString("hex")).toBe(
      "1f8b08000000000002ffab564a54b232ace5aa564a52b232aae50200c8b2ce9f10000000",
    );
    expect(result.sha256).toBe(
      "ace7c84639a46036fb0ad1892dcc2f86f7874fd11448920f2ca2ec0d237a97fe",
    );
    expect(result.compressedByteSize).toBe(36);
  });

  it("round-trips the original bytes", () => {
    const result = compressDeterministicGzip(input, 2);

    expect(gunzipSync(result.bytes)).toEqual(Buffer.from(input));
  });

  it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid entry count %s",
    (entryCount) => {
      expect(() => compressDeterministicGzip(input, entryCount)).toThrow(
        RangeError,
      );
    },
  );

  it("accepts empty input and zero entries", () => {
    const result = compressDeterministicGzip(new Uint8Array(), 0);

    expect(gunzipSync(result.bytes)).toEqual(Buffer.alloc(0));
    expect(result.entryCount).toBe(0);
  });
});
