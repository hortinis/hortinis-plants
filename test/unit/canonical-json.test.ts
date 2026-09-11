import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CanonicalJsonError,
  parseJsonStrict,
  serializeCanonicalJson,
} from "../../src/serialization/canonical-json.js";

const text = (value: unknown) =>
  new TextDecoder().decode(serializeCanonicalJson(value));

describe("canonical JSON", () => {
  it("sorts object keys while preserving arrays", () => {
    expect(text({ z: 1, a: { d: 2, b: 3 }, list: [2, 1] })).toBe(
      '{"a":{"b":3,"d":2},"list":[2,1],"z":1}',
    );
  });
  it("produces identical bytes and hashes for equivalent objects", () => {
    const first = serializeCanonicalJson({ b: 2, a: 1 });
    const second = serializeCanonicalJson({ a: 1, b: 2 });
    expect(first).toEqual(second);
    expect(createHash("sha256").update(first).digest("hex")).toBe(
      createHash("sha256").update(second).digest("hex"),
    );
  });
  it("rejects unsupported values with paths", () => {
    expect(() => serializeCanonicalJson({ rules: [undefined] })).toThrowError(
      expect.objectContaining<Partial<CanonicalJsonError>>({
        code: "UNSUPPORTED_VALUE",
        instancePath: "/rules/0",
      }),
    );
    expect(() => serializeCanonicalJson(NaN)).toThrowError(CanonicalJsonError);
    const sparse: unknown[] = [];
    sparse.length = 1;
    expect(() => serializeCanonicalJson(sparse)).toThrowError(
      expect.objectContaining({ instancePath: "/0" }),
    );
  });
  it("rejects duplicate keys, including escaped equivalents", () => {
    expect(() => parseJsonStrict('{"a":1,"a":2}')).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_KEY", instancePath: "/a" }),
    );
    expect(() => parseJsonStrict('{"a":1,"\\u0061":2}')).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_KEY" }),
    );
    expect(parseJsonStrict('{"a":[1,true,null]}')).toEqual({
      a: [1, true, null],
    });
  });
});
