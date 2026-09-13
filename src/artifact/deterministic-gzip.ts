import { createHash } from "node:crypto";
import { constants, createGzip, gzipSync } from "node:zlib";
import {
  Readable,
  Transform,
  type TransformCallback,
  type Writable,
} from "node:stream";
import { pipeline } from "node:stream/promises";

export interface CompressedArtifact {
  bytes: Uint8Array;
  sha256: string;
  compressedByteSize: number;
  entryCount: number;
}

export interface CompressedArtifactMetadata {
  readonly sha256: string;
  readonly compressedByteSize: number;
  readonly entryCount: number;
}

const gzipOptions = {
  level: constants.Z_BEST_COMPRESSION,
  memLevel: 8,
  strategy: constants.Z_DEFAULT_STRATEGY,
  windowBits: 15,
} as const;

/**
 * Compress already-framed artifact bytes with reproducible gzip metadata.
 * JSONL framing and record counting remain the responsibility of the caller.
 */
export function compressDeterministicGzip(
  input: Uint8Array,
  entryCount: number,
): CompressedArtifact {
  if (!Number.isSafeInteger(entryCount) || entryCount < 0) {
    throw new RangeError("entryCount must be a non-negative safe integer");
  }

  const bytes = new Uint8Array(gzipSync(input, gzipOptions));
  normalizeGzipHeader(bytes);

  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    compressedByteSize: bytes.byteLength,
    entryCount,
  };
}

/** Stream deterministic gzip bytes to a writable destination with backpressure. */
export async function writeDeterministicGzip(
  input: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
  destination: Writable,
  entryCount: number,
): Promise<CompressedArtifactMetadata> {
  return writeDeterministicGzipWithCount(input, destination, entryCount);
}

/** @internal Supports record counts that become known when input is exhausted. */
export async function writeDeterministicGzipWithCount(
  input: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
  destination: Writable,
  entryCount: number | (() => number),
): Promise<CompressedArtifactMetadata> {
  if (typeof entryCount === "number") checkEntryCount(entryCount);

  const digest = createHash("sha256");
  let compressedByteSize = 0;
  let header = new Uint8Array(0);
  let finalized = false;
  const meter = new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: TransformCallback,
    ) {
      try {
        let bytes = new Uint8Array(chunk);
        if (!finalized) {
          const needed = 10 - header.byteLength;
          const take = Math.min(needed, bytes.byteLength);
          const next = new Uint8Array(header.byteLength + take);
          next.set(header);
          next.set(bytes.subarray(0, take), header.byteLength);
          header = next;
          bytes = bytes.subarray(take);
          if (header.byteLength === 10) {
            normalizeGzipHeader(header);
            digest.update(header);
            compressedByteSize += header.byteLength;
            this.push(Buffer.from(header));
            finalized = true;
          }
        }
        if (bytes.byteLength > 0) {
          digest.update(bytes);
          compressedByteSize += bytes.byteLength;
          this.push(Buffer.from(bytes));
        }
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback: TransformCallback) {
      if (!finalized) {
        callback(
          new Error("Compressed stream ended before a complete gzip header"),
        );
        return;
      }
      callback();
    },
  });

  const source = Readable.from(input);
  const gzip = createGzip(gzipOptions);
  await pipeline(source, gzip, meter, destination);

  const count = typeof entryCount === "function" ? entryCount() : entryCount;
  checkEntryCount(count);
  return {
    sha256: digest.digest("hex"),
    compressedByteSize,
    entryCount: count,
  };
}

function normalizeGzipHeader(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 10 ||
    bytes[0] !== 0x1f ||
    bytes[1] !== 0x8b ||
    bytes[2] !== 0x08 ||
    bytes[3] !== 0
  ) {
    throw new Error(
      "Unexpected gzip header produced by the configured compressor",
    );
  }

  // Gzip mtime and OS fields are metadata outside the compressed payload.
  bytes.fill(0, 4, 8);
  bytes[9] = 0xff;
}

function checkEntryCount(entryCount: number): void {
  if (!Number.isSafeInteger(entryCount) || entryCount < 0) {
    throw new RangeError("entryCount must be a non-negative safe integer");
  }
}
