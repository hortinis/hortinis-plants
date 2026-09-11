import { describe, expect, it } from "vitest";
import {
  createValidationApi,
  validate,
  ValidationPipelineError,
} from "../../src/schema/validation-api.js";
import { compileSchemas } from "../../src/schema/schema-compiler.js";
import { resolve } from "node:path";

const schemaId = "urn:test:example";

function error(
  instancePath: string,
  schemaPath: string,
  keyword: string,
  message: string,
): Record<string, string> {
  return { instancePath, schemaPath, keyword, message, ignored: "field" };
}

describe("validation API", () => {
  it("validates through the generated repository registry", async () => {
    await compileSchemas({
      schemasDirectory: "schemas",
      outputFile: resolve("dist/generated/schema-registry.cjs"),
    });

    expect(
      validate("urn:hortinis:plants:schema:v1:schema-compilation-example", {
        value: "ok",
      }),
    ).toEqual({ valid: true });
  });

  it("returns a success result and reuses the compiled validator", () => {
    let calls = 0;
    const validator = Object.assign(
      (value: unknown) => {
        calls += 1;
        return typeof value === "string";
      },
      { errors: null },
    );
    const api = createValidationApi({ [schemaId]: validator });

    expect(api.validate(schemaId, "ok")).toEqual({ valid: true });
    expect(api.validate(schemaId, "also ok")).toEqual({ valid: true });
    expect(calls).toBe(2);
  });

  it("normalizes and deterministically sorts validation errors", () => {
    const validator = Object.assign(() => false, {
      errors: [
        error("/b", "#/properties/b/type", "type", "must be string"),
        error("", "#/required", "required", "must have required property 'a'"),
        error(
          "/a",
          "#/properties/a/minLength",
          "minLength",
          "must NOT be empty",
        ),
      ],
    });
    const api = createValidationApi({ [schemaId]: validator });

    expect(api.validate(schemaId, {})).toEqual({
      valid: false,
      errors: [
        {
          instancePath: "",
          schemaPath: "#/required",
          keyword: "required",
          message: "must have required property 'a'",
        },
        {
          instancePath: "/a",
          schemaPath: "#/properties/a/minLength",
          keyword: "minLength",
          message: "must NOT be empty",
        },
        {
          instancePath: "/b",
          schemaPath: "#/properties/b/type",
          keyword: "type",
          message: "must be string",
        },
      ],
    });
  });

  it("does not transform the input", () => {
    const input = { value: 1, extra: true };
    const validator = Object.assign(
      (value: unknown) => {
        const candidate = value as { value?: unknown; extra?: unknown };
        return typeof candidate.value === "string";
      },
      {
        errors: [
          error("/value", "#/properties/value/type", "type", "must be string"),
        ],
      },
    );
    const api = createValidationApi({ [schemaId]: validator });

    expect(api.validate(schemaId, input)).toMatchObject({ valid: false });
    expect(input).toEqual({ value: 1, extra: true });
  });

  it("throws a pipeline error for an unknown schema", () => {
    const api = createValidationApi({ [schemaId]: () => true });

    for (const unknownSchemaId of ["urn:test:missing", "toString"]) {
      expect(() => api.validate(unknownSchemaId, null)).toThrowError(
        expect.objectContaining({
          name: "ValidationPipelineError",
          code: "UNKNOWN_SCHEMA_ID",
        }),
      );
    }
  });

  it.each([null, [], {}, { [schemaId]: "not a function" }])(
    "rejects an invalid registry (%j)",
    (registry) => {
      expect(() => createValidationApi(registry)).toThrowError(
        expect.objectContaining({
          name: "ValidationPipelineError",
          code: "INVALID_SCHEMA_REGISTRY",
        }),
      );
    },
  );

  it("rejects malformed validator results", () => {
    const validator = Object.assign(() => false, { errors: [] });
    const api = createValidationApi({ [schemaId]: validator });

    expect(() => api.validate(schemaId, null)).toThrowError(
      expect.objectContaining({
        name: "ValidationPipelineError",
        code: "INVALID_SCHEMA_REGISTRY",
      }),
    );
  });

  it("wraps validator exceptions without exposing Ajv errors", () => {
    const cause = new Error("broken validator");
    const api = createValidationApi({
      [schemaId]: () => {
        throw cause;
      },
    });

    expect(() => api.validate(schemaId, null)).toThrowError(
      expect.objectContaining<Partial<ValidationPipelineError>>({
        name: "ValidationPipelineError",
        code: "VALIDATOR_EXECUTION_FAILED",
        cause,
      }),
    );
  });
});
