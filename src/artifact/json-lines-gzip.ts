import type { Writable } from "node:stream";
import {
  writeDeterministicGzipWithCount,
  type CompressedArtifactMetadata,
} from "./deterministic-gzip.js";
import {
  writeJsonLines,
  type JsonLinesWriteOptions,
} from "../serialization/json-lines.js";

export type CompressedJsonLinesOptions = JsonLinesWriteOptions;

/** Canonically frame records, gzip them deterministically, and hash compressed bytes. */
export async function writeCompressedJsonLines(
  values: Iterable<unknown> | AsyncIterable<unknown>,
  destination: Writable,
  options: CompressedJsonLinesOptions = {},
): Promise<CompressedArtifactMetadata> {
  let entryCount = 0;
  async function* countedLines(): AsyncGenerator<Uint8Array> {
    for await (const line of writeJsonLines(values, options)) {
      entryCount += 1;
      yield line;
    }
  }

  return writeDeterministicGzipWithCount(
    countedLines(),
    destination,
    () => entryCount,
  );
}
