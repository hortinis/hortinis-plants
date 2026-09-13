import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createValidationApi,
  ValidationPipelineError,
} from "../../src/schema/validation-api.js";
import { compileSchemas } from "../../src/schema/schema-compiler.js";
import {
  loadConformanceFixtures,
  readFixture,
  type ConformanceFixtureCase,
} from "../support/schema-conformance-fixtures.js";

const manifestPath = join(
  process.cwd(),
  "test/fixtures/schema-conformance/v1/manifest.json",
);

describe("schema conformance fixtures", () => {
  it("validates every critical fixture through the compiled registry", async () => {
    const fixtures = await loadConformanceFixtures(manifestPath);
    // Keep the generated CommonJS registry below the repository so its runtime
    // `require("ajv/...")` dependencies resolve through node_modules.
    const outputDirectory = await mkdtemp(
      join(process.cwd(), "dist/schema-conformance-"),
    );
    const outputFile = join(outputDirectory, "registry.cjs");
    const schemas = await compileSchemas({
      schemasDirectory: "schemas",
      outputFile,
    });
    const imported = (await import(pathToFileURL(outputFile).href)) as {
      default: { validatorsBySchemaId: unknown };
    };
    const api = createValidationApi(imported.default.validatorsBySchemaId);

    for (const schema of schemas) {
      if (schema.schema.$id === "urn:hortinis:plants:schema:v1:common") {
        continue;
      }
      const schemaFixtures = fixtures.filter(
        (fixture) => fixture.schemaId === schema.schema.$id,
      );
      expect(
        schemaFixtures.some(
          (fixture) =>
            "valid" in fixture.expected && fixture.expected.valid === true,
        ),
        `${schema.schema.$id} needs a positive fixture`,
      ).toBe(true);
      expect(
        schemaFixtures.some(
          (fixture) => "valid" in fixture.expected && !fixture.expected.valid,
        ),
        `${schema.schema.$id} needs a negative fixture`,
      ).toBe(true);
    }

    for (const fixture of fixtures) {
      assertFixture(api, fixture, await readFixture(fixture.fixturePath));
    }
  });
});

function assertFixture(
  api: ReturnType<typeof createValidationApi>,
  fixture: ConformanceFixtureCase,
  value: unknown,
): void {
  try {
    const result = api.validate(fixture.schemaId, value);
    if ("pipelineError" in fixture.expected) {
      throw new Error(
        `${fixture.id} expected pipeline error ${fixture.expected.pipelineError}`,
      );
    }
    if (fixture.expected.valid) {
      expect(result, fixture.id).toEqual({ valid: true });
      return;
    }
    expect(result.valid, fixture.id).toBe(false);
    if (result.valid) return;
    expect(
      result.errors.map(({ instancePath, keyword }) => ({
        instancePath,
        keyword,
      })),
      fixture.id,
    ).toEqual(fixture.expected.errors);
  } catch (error) {
    if (!("pipelineError" in fixture.expected)) throw error;
    expect(error, fixture.id).toBeInstanceOf(ValidationPipelineError);
    expect((error as ValidationPipelineError).code, fixture.id).toBe(
      fixture.expected.pipelineError,
    );
  }
}
