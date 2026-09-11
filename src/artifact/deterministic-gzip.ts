import { createHash } from "node:crypto";
import { constants, gzipSync } from "node:zlib";

export interface CompressedArtifact {
  bytes: Uint8Array;
  sha256: string;
  compressedByteSize: number;
  entryCount: number;
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
