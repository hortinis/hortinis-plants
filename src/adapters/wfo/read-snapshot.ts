import { createRequire } from "node:module";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import type { Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parse } from "csv-parse";
import {
  REQUIRED_WFO_COLUMNS,
  WFO_CLASSIFICATION_FILENAME,
} from "./constants.js";
import type { WfoSnapshotRecord } from "./types.js";

interface ZipEntry extends AsyncIterable<Uint8Array> {
  readonly path: string;
  readonly type: string;
  autodrain(): ZipEntry;
  pipe<T>(destination: T): T;
}

interface UnzipperModule {
  Parse(options: { readonly forceStream: true }): Duplex;
}

const unzipper = createRequire(import.meta.url)("unzipper") as UnzipperModule;

export type WfoSnapshotErrorCode =
  | "MISSING_SNAPSHOT"
  | "UNSUPPORTED_ARCHIVE"
  | "MISSING_CLASSIFICATION"
  | "UNSUPPORTED_FORMAT"
  | "MISSING_REQUIRED_FIELD"
  | "DUPLICATE_COLUMN";

export class WfoSnapshotError extends Error {
  readonly code: WfoSnapshotErrorCode;

  constructor(
    code: WfoSnapshotErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WfoSnapshotError";
    this.code = code;
  }
}

/** Stream classification.csv directly from the ZIP without extracting the archive. */
export async function* readWfoSnapshot(
  snapshotPath: string,
): AsyncGenerator<WfoSnapshotRecord> {
  let classificationCount = 0;
  let archive: Duplex | undefined;
  let archiveCompletion: Promise<void> | undefined;
  try {
    await access(snapshotPath);
    archive = unzipper.Parse({ forceStream: true });
    archiveCompletion = pipeline(createReadStream(snapshotPath), archive);
    void archiveCompletion.catch(() => undefined);
    for await (const entry of archive as AsyncIterable<ZipEntry>) {
      if (entry.path !== WFO_CLASSIFICATION_FILENAME) {
        entry.autodrain();
        continue;
      }
      classificationCount += 1;
      if (classificationCount > 1) {
        throw new WfoSnapshotError(
          "UNSUPPORTED_ARCHIVE",
          `WFO archive contains more than one ${WFO_CLASSIFICATION_FILENAME} entry`,
        );
      }
      if (entry.type !== "File") {
        throw new WfoSnapshotError(
          "UNSUPPORTED_ARCHIVE",
          `${WFO_CLASSIFICATION_FILENAME} is not a regular archive file`,
        );
      }
      let headerSeen = false;
      let rowNumber = 1;
      const csv = entry.pipe(
        parse({
          bom: true,
          // The pinned WFO Darwin Core export names this entry .csv but separates
          // its fields with tabs.
          delimiter: "\t",
          columns(headers: string[]) {
            headerSeen = true;
            validateHeaders(headers);
            return headers;
          },
          max_record_size: 8 * 1024 * 1024,
          relax_column_count: false,
          skip_empty_lines: true,
        }),
      ) as AsyncIterable<Record<string, string | undefined>>;

      try {
        for await (const row of csv) {
          rowNumber += 1;
          yield parseRecord(row, rowNumber);
        }
      } catch (error) {
        if (error instanceof WfoSnapshotError) throw error;
        throw new WfoSnapshotError(
          "UNSUPPORTED_FORMAT",
          `Unable to parse ${WFO_CLASSIFICATION_FILENAME} near CSV record ${rowNumber + 1}: ${message(error)}`,
          { cause: error },
        );
      }
      if (!headerSeen) {
        throw new WfoSnapshotError(
          "UNSUPPORTED_FORMAT",
          `${WFO_CLASSIFICATION_FILENAME} is empty or has no header row`,
        );
      }
    }
    await archiveCompletion;
  } catch (error) {
    if (error instanceof WfoSnapshotError) throw error;
    if (isMissingFile(error)) {
      throw new WfoSnapshotError(
        "MISSING_SNAPSHOT",
        `WFO snapshot is missing: ${snapshotPath}`,
        { cause: error },
      );
    }
    throw new WfoSnapshotError(
      "UNSUPPORTED_ARCHIVE",
      `Unable to read WFO ZIP snapshot ${snapshotPath}: ${message(error)}`,
      { cause: error },
    );
  } finally {
    if (archive !== undefined && !archive.readableEnded) archive.destroy();
    await archiveCompletion?.catch(() => undefined);
  }
  if (classificationCount === 0) {
    throw new WfoSnapshotError(
      "MISSING_CLASSIFICATION",
      `WFO archive does not contain ${WFO_CLASSIFICATION_FILENAME}`,
    );
  }
}

function validateHeaders(headers: readonly string[]): void {
  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) {
      throw new WfoSnapshotError(
        "DUPLICATE_COLUMN",
        `WFO classification CSV repeats the ${JSON.stringify(header)} column`,
      );
    }
    seen.add(header);
  }
  const missing = REQUIRED_WFO_COLUMNS.filter((column) => !seen.has(column));
  if (missing.length > 0) {
    throw new WfoSnapshotError(
      "UNSUPPORTED_FORMAT",
      `WFO classification CSV is missing required columns: ${missing.join(", ")}`,
    );
  }
}

function parseRecord(
  row: Readonly<Record<string, string | undefined>>,
  rowNumber: number,
): WfoSnapshotRecord {
  const required = [
    "taxonID",
    "scientificName",
    "taxonRank",
    "taxonomicStatus",
  ] as const;
  for (const field of required) {
    if ((row[field] ?? "").trim().length === 0) {
      throw new WfoSnapshotError(
        "MISSING_REQUIRED_FIELD",
        `WFO ${WFO_CLASSIFICATION_FILENAME} record ${rowNumber} is missing ${field}`,
      );
    }
  }
  return {
    taxonID: (row.taxonID ?? "").trim(),
    scientificName: row.scientificName ?? "",
    scientificNameAuthorship: row.scientificNameAuthorship ?? "",
    taxonRank: (row.taxonRank ?? "").trim(),
    taxonomicStatus: (row.taxonomicStatus ?? "").trim(),
    acceptedNameUsageID: (row.acceptedNameUsageID ?? "").trim(),
    parentNameUsageID: (row.parentNameUsageID ?? "").trim(),
    genus: (row.genus ?? "").trim(),
    family: (row.family ?? "").trim(),
    rowNumber,
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
