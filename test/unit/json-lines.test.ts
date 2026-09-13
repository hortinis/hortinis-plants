import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import {
  JsonLinesError,
  readJsonLines,
  writeJsonLines,
} from "../../src/serialization/json-lines.js";
import type { ValidationApi } from "../../src/schema/validation-api.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function chunks(...values: string[]): Readable {
  return Readable.from(values.map((value) => encoder.encode(value)));
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const value of iterable) output.push(value);
  return output;
}

describe("streaming JSON Lines", () => {
  it("writes canonical LF-terminated records and emits no bytes for empty input", async () => {
    const output = await collect(writeJsonLines([{ z: 1, a: "é" }, [2, 1]]));
    expect(output.map((bytes) => decoder.decode(bytes)).join("")).toBe(
      '{"a":"é","z":1}\n[2,1]\n',
    );
    expect(await collect(writeJsonLines([]))).toEqual([]);
  });

  it("reads valid noncanonical JSON across arbitrary UTF-8 chunk boundaries", async () => {
    const bytes = encoder.encode('{ "name" : "plante é" }\n[1,2]\n');
    const pieces = Array.from(bytes, (byte) => Uint8Array.of(byte));
    const records = await collect(readJsonLines(Readable.from(pieces)));
    expect(records).toEqual([
      { lineNumber: 1, value: { name: "plante é" } },
      { lineNumber: 2, value: [1, 2] },
    ]);
  });

  it.each([
    ["blank", "{}\n\n", "BLANK_LINE"],
    ["CRLF", "{}\r\n", "INVALID_LINE_ENDING"],
    ["malformed JSON", "{\n", "INVALID_JSON"],
    ["duplicate keys", '{"a":1,"\\u0061":2}\n', "DUPLICATE_KEY"],
    ["missing final LF", "{}", "MISSING_FINAL_NEWLINE"],
  ] as const)("reports %s with a line number", async (_name, source, code) => {
    await expect(collect(readJsonLines(chunks(source)))).rejects.toMatchObject({
      name: "JsonLinesError",
      code,
      lineNumber: code === "BLANK_LINE" ? 2 : 1,
    });
  });

  it("rejects a BOM, invalid UTF-8, and records over the configured byte limit", async () => {
    await expect(
      collect(
        readJsonLines(
          Readable.from([Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0x0a)]),
        ),
      ),
    ).rejects.toMatchObject({ code: "INVALID_UTF8", lineNumber: 1 });
    await expect(
      collect(
        readJsonLines(Readable.from([Uint8Array.of(0x22, 0xff, 0x22, 0x0a)])),
      ),
    ).rejects.toMatchObject({ code: "INVALID_UTF8", lineNumber: 1 });
    await expect(
      collect(readJsonLines(chunks('{"a":1}\n'), { maxLineBytes: 6 })),
    ).rejects.toMatchObject({ code: "LINE_TOO_LONG", lineNumber: 1 });
  });

  it("reports serialization paths and validation errors with record numbers", async () => {
    await expect(
      collect(writeJsonLines([{ a: undefined }])),
    ).rejects.toMatchObject({
      code: "SERIALIZATION_FAILED",
      lineNumber: 1,
      instancePath: "/a",
    });

    const validationApi: ValidationApi = {
      validate: (_schemaId, value) =>
        typeof value === "string"
          ? { valid: true }
          : {
              valid: false,
              errors: [
                {
                  instancePath: "",
                  schemaPath: "#/type",
                  keyword: "type",
                  message: "must be string",
                },
              ],
            },
    };
    await expect(
      collect(
        writeJsonLines(["ok", 2], {
          schemaId: "urn:test:string",
          validationApi,
        }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      lineNumber: 2,
      validationErrors: [{ keyword: "type" }],
    });
    await expect(
      collect(
        readJsonLines(chunks('"ok"\n2\n'), {
          schemaId: "urn:test:string",
          validationApi,
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", lineNumber: 2 });
  });

  it("associates schema registry failures with the current line", async () => {
    const validationApi: ValidationApi = {
      validate: () => {
        throw new Error("schema missing");
      },
    };
    await expect(
      collect(
        readJsonLines(chunks('"value"\n'), {
          schemaId: "urn:test:missing",
          validationApi,
        }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_PIPELINE_FAILED",
      lineNumber: 1,
    });
  });

  it("stops reading input after the first bad record", async () => {
    let consumed = 0;
    async function* input(): AsyncGenerator<Uint8Array> {
      await Promise.resolve();
      consumed += 1;
      yield encoder.encode("{}\n");
      await Promise.resolve();
      consumed += 1;
      yield encoder.encode("bad\n");
      await Promise.resolve();
      consumed += 1;
      yield encoder.encode("{}\n");
    }
    const iterator = readJsonLines(input())[Symbol.asyncIterator]();
    await iterator.next();
    await expect(iterator.next()).rejects.toBeInstanceOf(JsonLinesError);
    expect(consumed).toBe(2);
  });
});
