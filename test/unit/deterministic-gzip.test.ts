import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  compressDeterministicGzip,
  writeDeterministicGzip,
} from "../../src/artifact/deterministic-gzip.js";
import { writeCompressedJsonLines } from "../../src/artifact/json-lines-gzip.js";

const input = new TextEncoder().encode('{"a":1}\n{"b":2}\n');

function* splitBytes(bytes: Uint8Array, sizes: readonly number[]) {
  let offset = 0;
  let index = 0;
  while (offset < bytes.byteLength) {
    const end = Math.min(
      bytes.byteLength,
      offset + sizes[index % sizes.length]!,
    );
    yield bytes.subarray(offset, end);
    offset = end;
    index += 1;
  }
}

function memoryWritable(chunks: Uint8Array[] = []): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(new Uint8Array(chunk));
      callback();
    },
  });
}

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

  it("streams the same deterministic gzip bytes across chunk boundaries", async () => {
    const firstChunks: Uint8Array[] = [];
    const secondChunks: Uint8Array[] = [];
    const first = await writeDeterministicGzip(
      splitBytes(input, [input.byteLength]),
      memoryWritable(firstChunks),
      2,
    );
    const second = await writeDeterministicGzip(
      splitBytes(input, [1, 4, 2, 3]),
      memoryWritable(secondChunks),
      2,
    );
    const firstBytes = Buffer.concat(
      firstChunks.map((chunk) => Buffer.from(chunk)),
    );
    const secondBytes = Buffer.concat(
      secondChunks.map((chunk) => Buffer.from(chunk)),
    );
    expect(firstBytes).toEqual(secondBytes);
    expect(firstBytes).toEqual(
      Buffer.from(compressDeterministicGzip(input, 2).bytes),
    );
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      sha256: createHash("sha256").update(firstBytes).digest("hex"),
      compressedByteSize: firstBytes.byteLength,
      entryCount: 2,
    });
    expect(gunzipSync(firstBytes)).toEqual(Buffer.from(input));
  });

  it("streams canonical JSON Lines with an authoritative record count", async () => {
    const chunks: Uint8Array[] = [];
    const metadata = await writeCompressedJsonLines(
      [{ z: 1, a: 2 }, { b: 3 }],
      memoryWritable(chunks),
    );
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    expect(metadata.entryCount).toBe(2);
    expect(metadata.compressedByteSize).toBe(bytes.byteLength);
    expect(metadata.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(gunzipSync(bytes).toString("utf8")).toBe('{"a":2,"z":1}\n{"b":3}\n');
  });

  it("streams a large lazy dataset to a discarding sink", async () => {
    const count = 100_000;
    async function run(): Promise<{
      sha256: string;
      size: number;
      count: number;
    }> {
      let produced = 0;
      let compressedByteSize = 0;
      const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          compressedByteSize += chunk.byteLength;
          callback();
        },
      });
      function* records() {
        for (let index = 0; index < count; index += 1) {
          produced += 1;
          yield { id: index, label: `plant-${index}` };
        }
      }
      const metadata = await writeCompressedJsonLines(records(), sink);
      expect(produced).toBe(count);
      expect(metadata.compressedByteSize).toBe(compressedByteSize);
      return {
        sha256: metadata.sha256,
        size: metadata.compressedByteSize,
        count: metadata.entryCount,
      };
    }

    const first = await run();
    const second = await run();
    expect(first).toEqual(second);
    expect(first.count).toBe(count);
    expect(first.size).toBeGreaterThan(100_000);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/u);
  }, 15_000);

  it("does not return metadata when the destination fails", async () => {
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("destination unavailable"));
      },
    });
    await expect(
      writeDeterministicGzip(
        splitBytes(input, [input.byteLength]),
        destination,
        2,
      ),
    ).rejects.toThrow("destination unavailable");
  });
});
