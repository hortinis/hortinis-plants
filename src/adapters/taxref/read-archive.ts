import { createRequire } from "node:module";
import * as nodeStream from "node:stream";
import { Transform, type Readable } from "node:stream";
import { TextDecoder } from "node:util";
import { parse } from "csv-parse";

interface ZipEntry {
  readonly path: string;
  readonly type: string;
  stream(): Readable;
}

interface ZipDirectory {
  readonly files: readonly ZipEntry[];
}

interface UnzipperModule {
  readonly Open: {
    file(path: string): Promise<ZipDirectory>;
  };
}

export interface TaxrefArchive {
  readonly path: string;
  readonly entries: ReadonlyMap<string, ZipEntry>;
}

export interface TaxrefParsedRow {
  readonly recordNumber: number;
  readonly record: Readonly<Record<string, string>>;
}

export type TaxrefMemberEncoding = "utf-8" | "windows-1252";

const unzipper = createRequire(import.meta.url)("unzipper") as UnzipperModule;

export class TaxrefParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaxrefParseError";
  }
}

export async function openTaxrefArchive(path: string): Promise<TaxrefArchive> {
  let directory: ZipDirectory;
  try {
    directory = await unzipper.Open.file(path);
  } catch (error) {
    throw new TaxrefParseError(`Cannot open TAXREF archive ${path}`, {
      cause: error,
    });
  }
  const entries = new Map<string, ZipEntry>();
  for (const entry of directory.files) {
    if (entry.type !== "File") continue;
    if (entries.has(entry.path)) {
      throw new TaxrefParseError(`TAXREF archive repeats member ${entry.path}`);
    }
    entries.set(entry.path, entry);
  }
  return { path, entries };
}

export async function* readTaxrefMember(
  archive: TaxrefArchive,
  options: {
    readonly member: string;
    readonly headers: readonly string[];
    readonly delimiter: "\t" | ";";
    readonly encoding: TaxrefMemberEncoding;
  },
): AsyncGenerator<TaxrefParsedRow> {
  const entry = archive.entries.get(options.member);
  if (entry === undefined) {
    throw new TaxrefParseError(
      `TAXREF archive is missing required member ${options.member}`,
    );
  }
  let headerSeen = false;
  let recordNumber = 0;
  const decoder = new DecoderTransform(options.encoding);
  const csv = composeStreams(
    entry.stream(),
    decoder,
    parse({
      bom: false,
      delimiter: options.delimiter,
      record_delimiter: "\r\n",
      columns(headers: string[]) {
        headerSeen = true;
        assertHeaders(options.member, headers, options.headers);
        return headers;
      },
      max_record_size: 8 * 1024 * 1024,
      relax_column_count: false,
      skip_empty_lines: false,
    }),
  ) as AsyncIterable<Record<string, string | undefined>>;

  try {
    for await (const raw of csv) {
      recordNumber += 1;
      const record: Record<string, string> = {};
      for (const header of options.headers) {
        const value = raw[header];
        if (value === undefined) {
          throw new TaxrefParseError(
            `${options.member} record ${recordNumber} has no ${header} field`,
          );
        }
        record[header] = value;
      }
      yield { recordNumber, record };
    }
  } catch (error) {
    if (error instanceof TaxrefParseError) throw error;
    throw new TaxrefParseError(
      `Cannot parse ${options.member} near data record ${recordNumber + 1}: ${message(error)}`,
      { cause: error },
    );
  }
  if (!headerSeen) {
    throw new TaxrefParseError(`${options.member} is empty or has no header`);
  }
}

class DecoderTransform extends Transform {
  readonly #decoder: TextDecoder;

  constructor(encoding: TaxrefMemberEncoding) {
    super({ decodeStrings: true });
    this.#decoder = new TextDecoder(encoding, {
      fatal: encoding === "utf-8",
      ignoreBOM: false,
    });
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: string) => void,
  ): void {
    try {
      callback(null, this.#decoder.decode(chunk, { stream: true }));
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  override _flush(
    callback: (error?: Error | null, data?: string) => void,
  ): void {
    try {
      callback(null, this.#decoder.decode());
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function assertHeaders(
  member: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  if (
    actual.length !== expected.length ||
    actual.some((header, index) => header !== expected[index])
  ) {
    throw new TaxrefParseError(
      `${member} header changed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function composeStreams(...streams: unknown[]): AsyncIterable<unknown> {
  // Node 24 exposes compose; the pinned @types/node release omits its declaration.
  const runtime = nodeStream as typeof nodeStream & {
    compose: (...stages: unknown[]) => AsyncIterable<unknown>;
  };
  return runtime.compose(...streams);
}
