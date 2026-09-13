import {
  CanonicalJsonError,
  parseJsonStrict,
  serializeCanonicalJson,
} from "./canonical-json.js";
import {
  validate,
  type ValidationApi,
  type ValidationError,
} from "../schema/validation-api.js";

export const DEFAULT_MAX_JSON_LINE_BYTES = 16 * 1024 * 1024;

export type JsonLinesErrorCode =
  | "BLANK_LINE"
  | "INVALID_UTF8"
  | "INVALID_JSON"
  | "DUPLICATE_KEY"
  | "INVALID_LINE_ENDING"
  | "MISSING_FINAL_NEWLINE"
  | "LINE_TOO_LONG"
  | "VALIDATION_FAILED"
  | "SERIALIZATION_FAILED"
  | "VALIDATION_PIPELINE_FAILED";

export class JsonLinesError extends Error {
  readonly code: JsonLinesErrorCode;
  readonly lineNumber: number;
  readonly instancePath?: string;
  readonly validationErrors?: readonly ValidationError[];

  constructor(options: {
    code: JsonLinesErrorCode;
    lineNumber: number;
    message: string;
    instancePath?: string;
    validationErrors?: readonly ValidationError[];
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "JsonLinesError";
    this.code = options.code;
    this.lineNumber = options.lineNumber;
    if (options.instancePath !== undefined)
      this.instancePath = options.instancePath;
    if (options.validationErrors !== undefined)
      this.validationErrors = options.validationErrors;
  }
}

export interface JsonLineRecord {
  readonly lineNumber: number;
  readonly value: unknown;
}

export interface JsonLinesReadOptions {
  readonly maxLineBytes?: number;
  readonly schemaId?: string;
  readonly validationApi?: ValidationApi;
}

export type JsonLinesWriteOptions = JsonLinesReadOptions;

/** Incrementally parse strict UTF-8 JSON Lines, retaining at most one record. */
export async function* readJsonLines(
  chunks: AsyncIterable<Uint8Array>,
  options: JsonLinesReadOptions = {},
): AsyncGenerator<JsonLineRecord> {
  const maxLineBytes = checkedMaxLineBytes(options.maxLineBytes);
  const validation = createValidation(options);
  let lineNumber = 1;
  let lineSize = 0;
  let pieces: Uint8Array[] = [];
  let sawAnyByte = false;
  let endedWithNewline = true;

  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError("JSON Lines input chunks must be Uint8Array values");
    }
    if (chunk.byteLength > 0) sawAnyByte = true;
    let start = 0;
    for (let index = 0; index < chunk.byteLength; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      const segment = chunk.subarray(start, index);
      addPiece(segment);
      const bytes = joinPieces(pieces, lineSize);
      const result = parseLine(bytes, lineNumber, validation);
      yield { lineNumber, value: result };
      lineNumber += 1;
      lineSize = 0;
      pieces = [];
      endedWithNewline = true;
      start = index + 1;
    }
    const tail = chunk.subarray(start);
    if (tail.byteLength > 0) {
      addPiece(tail);
      endedWithNewline = false;
    }
  }

  if (lineSize > 0 || (sawAnyByte && !endedWithNewline)) {
    throw new JsonLinesError({
      code: "MISSING_FINAL_NEWLINE",
      lineNumber,
      message: `JSON Lines record on line ${lineNumber} is not terminated by LF`,
    });
  }

  function addPiece(piece: Uint8Array): void {
    if (piece.byteLength === 0) return;
    lineSize += piece.byteLength;
    if (lineSize > maxLineBytes) {
      throw new JsonLinesError({
        code: "LINE_TOO_LONG",
        lineNumber,
        message: `JSON Lines record on line ${lineNumber} exceeds ${maxLineBytes} bytes`,
      });
    }
    pieces.push(piece);
  }
}

/** Canonically frame each input value as one LF-terminated UTF-8 JSON record. */
export async function* writeJsonLines(
  values: Iterable<unknown> | AsyncIterable<unknown>,
  options: JsonLinesWriteOptions = {},
): AsyncGenerator<Uint8Array> {
  const maxLineBytes = checkedMaxLineBytes(options.maxLineBytes);
  const validation = createValidation(options);
  let lineNumber = 0;

  for await (const value of toAsyncIterable(values)) {
    lineNumber += 1;
    validateValue(value, lineNumber, validation);
    let bytes: Uint8Array;
    try {
      bytes = serializeCanonicalJson(value);
    } catch (error) {
      if (error instanceof CanonicalJsonError) {
        throw new JsonLinesError({
          code: "SERIALIZATION_FAILED",
          lineNumber,
          message: error.message,
          instancePath: error.instancePath,
          cause: error,
        });
      }
      throw new JsonLinesError({
        code: "SERIALIZATION_FAILED",
        lineNumber,
        message: `Unable to serialize JSON Lines record on line ${lineNumber}`,
        cause: error,
      });
    }
    if (bytes.byteLength > maxLineBytes) {
      throw new JsonLinesError({
        code: "LINE_TOO_LONG",
        lineNumber,
        message: `JSON Lines record on line ${lineNumber} exceeds ${maxLineBytes} bytes`,
      });
    }
    const framed = new Uint8Array(bytes.byteLength + 1);
    framed.set(bytes);
    framed[bytes.byteLength] = 0x0a;
    yield framed;
  }
}

function parseLine(
  bytes: Uint8Array,
  lineNumber: number,
  validation: ReturnType<typeof createValidation>,
): unknown {
  if (bytes.byteLength === 0) {
    throw new JsonLinesError({
      code: "BLANK_LINE",
      lineNumber,
      message: `Blank JSON Lines record on line ${lineNumber}`,
    });
  }
  if (lineNumber === 1 && startsWithBom(bytes)) {
    throw new JsonLinesError({
      code: "INVALID_UTF8",
      lineNumber,
      message: "JSON Lines input must not begin with a UTF-8 byte-order mark",
    });
  }
  if (bytes[bytes.byteLength - 1] === 0x0d) {
    throw new JsonLinesError({
      code: "INVALID_LINE_ENDING",
      lineNumber,
      message: `CRLF line ending is not allowed on line ${lineNumber}`,
    });
  }
  let value: unknown;
  try {
    value = parseJsonStrict(bytes);
  } catch (error) {
    if (error instanceof CanonicalJsonError) {
      const code =
        error.code === "DUPLICATE_KEY"
          ? "DUPLICATE_KEY"
          : error.code === "INVALID_JSON"
            ? invalidUtf8(bytes)
              ? "INVALID_UTF8"
              : "INVALID_JSON"
            : "INVALID_JSON";
      throw new JsonLinesError({
        code,
        lineNumber,
        message: error.message,
        instancePath: error.instancePath,
        cause: error,
      });
    }
    throw new JsonLinesError({
      code: "INVALID_JSON",
      lineNumber,
      message: `Invalid JSON on line ${lineNumber}`,
      cause: error,
    });
  }
  validateValue(value, lineNumber, validation);
  return value;
}

function validateValue(
  value: unknown,
  lineNumber: number,
  validation: ReturnType<typeof createValidation>,
): void {
  if (validation === undefined) return;
  let result: ReturnType<ValidationApi["validate"]>;
  try {
    result = validation.api.validate(validation.schemaId, value);
  } catch (error) {
    throw new JsonLinesError({
      code: "VALIDATION_PIPELINE_FAILED",
      lineNumber,
      message: `Schema validation pipeline failed on JSON Lines line ${lineNumber}`,
      cause: error,
    });
  }
  if (!result.valid) {
    throw new JsonLinesError({
      code: "VALIDATION_FAILED",
      lineNumber,
      message: `Schema validation failed on JSON Lines line ${lineNumber}`,
      validationErrors: result.errors,
    });
  }
}

function createValidation(
  options: JsonLinesReadOptions,
): { readonly api: ValidationApi; readonly schemaId: string } | undefined {
  if (options.schemaId === undefined) {
    if (options.validationApi !== undefined) {
      throw new TypeError(
        "schemaId is required when validationApi is supplied",
      );
    }
    return undefined;
  }
  return {
    api: options.validationApi ?? { validate },
    schemaId: options.schemaId,
  };
}

function checkedMaxLineBytes(value: number | undefined): number {
  const max = value ?? DEFAULT_MAX_JSON_LINE_BYTES;
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError("maxLineBytes must be a positive safe integer");
  }
  return max;
}

function joinPieces(
  pieces: readonly Uint8Array[],
  byteLength: number,
): Uint8Array {
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const piece of pieces) {
    output.set(piece, offset);
    offset += piece.byteLength;
  }
  return output;
}

function startsWithBom(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  );
}

function invalidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

async function* toAsyncIterable(
  values: Iterable<unknown> | AsyncIterable<unknown>,
): AsyncGenerator<unknown> {
  for await (const value of values) yield value;
}
