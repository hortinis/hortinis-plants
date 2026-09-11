import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSchemas } from "../../src/schema/schema-compiler.js";

const exampleId = "urn:hortinis:plants:schema:v1:schema-compilation-example";

describe("schema compilation", () => {
  it("compiles and loads a validator by schema identifier", async () => {
    const outputDirectory = await mkdtemp(
      join(process.cwd(), "dist/schema-test-"),
    );
    const outputFile = join(outputDirectory, "registry.cjs");
    await compileSchemas({ schemasDirectory: "schemas", outputFile });
    const imported = (await import(pathToFileURL(outputFile).href)) as {
      default: {
        validatorsBySchemaId: Record<string, (value: unknown) => boolean>;
      };
    };
    const registry = imported.default;

    expect(registry.validatorsBySchemaId[exampleId]?.({ value: "ok" })).toBe(
      true,
    );
    expect(registry.validatorsBySchemaId[exampleId]?.({ value: "" })).toBe(
      false,
    );
  });

  it("rejects duplicate identifiers", async () => {
    const schemasDirectory = await mkdtemp(join(tmpdir(), "hortinis-schema-"));
    const schema = JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:test:duplicate",
      type: "string",
    });
    await writeFile(join(schemasDirectory, "a.schema.json"), schema);
    await writeFile(join(schemasDirectory, "b.schema.json"), schema);

    await expect(
      compileSchemas({
        schemasDirectory,
        outputFile: join(schemasDirectory, "out.js"),
      }),
    ).rejects.toThrow("Duplicate schema identifier urn:test:duplicate");
  });

  it("rejects unresolved references", async () => {
    const schemasDirectory = await mkdtemp(join(tmpdir(), "hortinis-schema-"));
    await writeFile(
      join(schemasDirectory, "broken.schema.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:test:broken",
        $ref: "urn:test:missing",
      }),
    );

    await expect(
      compileSchemas({
        schemasDirectory,
        outputFile: join(schemasDirectory, "out.js"),
      }),
    ).rejects.toThrow("urn:test:missing");
  });

  it("resolves references between registered schemas", async () => {
    const schemasDirectory = await mkdtemp(
      join(process.cwd(), "dist/schema-reference-"),
    );
    await writeFile(
      join(schemasDirectory, "base.schema.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:test:reference-base",
        type: "string",
        minLength: 1,
      }),
    );
    await writeFile(
      join(schemasDirectory, "wrapper.schema.json"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:test:reference-wrapper",
        type: "object",
        required: ["value"],
        properties: { value: { $ref: "urn:test:reference-base" } },
      }),
    );
    const outputFile = join(schemasDirectory, "registry.cjs");
    await compileSchemas({ schemasDirectory, outputFile });
    const imported = (await import(pathToFileURL(outputFile).href)) as {
      default: {
        validatorsBySchemaId: Record<string, (value: unknown) => boolean>;
      };
    };
    const validator =
      imported.default.validatorsBySchemaId["urn:test:reference-wrapper"];

    expect(validator?.({ value: "ok" })).toBe(true);
    expect(validator?.({ value: "" })).toBe(false);
  });

  it("produces deterministic output", async () => {
    const firstDirectory = await mkdtemp(join(tmpdir(), "hortinis-schema-"));
    const secondDirectory = await mkdtemp(join(tmpdir(), "hortinis-schema-"));
    const schemaA = JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:test:a",
      type: "string",
    });
    const schemaB = JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:test:b",
      type: "number",
    });
    await writeFile(join(firstDirectory, "a.schema.json"), schemaA);
    await writeFile(join(firstDirectory, "b.schema.json"), schemaB);
    await writeFile(join(secondDirectory, "z.schema.json"), schemaB);
    await writeFile(join(secondDirectory, "a.schema.json"), schemaA);
    const firstOutput = join(firstDirectory, "out.js");
    const secondOutput = join(secondDirectory, "out.js");
    await compileSchemas({
      schemasDirectory: firstDirectory,
      outputFile: firstOutput,
    });
    await compileSchemas({
      schemasDirectory: secondDirectory,
      outputFile: secondOutput,
    });

    expect(await readFile(firstOutput, "utf8")).toBe(
      await readFile(secondOutput, "utf8"),
    );
  });
});
