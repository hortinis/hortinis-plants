import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { discoverSchemas } from "../../src/schema/schema-compiler.js";
import { validateValidationDataset } from "../../src/curation/validation-dataset.js";

describe("GROW source metadata", () => {
  it("records the pinned release, CC BY 4.0 eligibility, and verified resources", async () => {
    const schemas = await discoverSchemas(join(process.cwd(), "schemas"));
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    for (const { schema } of schemas) ajv.addSchema(schema, schema.$id);
    const sourceManifest = JSON.parse(
      await readFile("data/sources/grow/source-manifest.json", "utf8"),
    ) as unknown;
    const validate = ajv.getSchema(
      "urn:hortinis:plants:schema:v1:source-manifest",
    );
    expect(validate).toBeDefined();
    expect(validate?.(sourceManifest), JSON.stringify(validate?.errors)).toBe(
      true,
    );
    expect(sourceManifest).toMatchObject({
      id: "source_manifest_grow_epd_2020",
      release: { identifier: "doi:10.15132/10000157" },
      licenceReview: { status: "accepted", declaredLicence: "CC-BY-4.0" },
    });
  });

  it("validates the structured temperature values and harvest action", async () => {
    const schemas = await discoverSchemas(join(process.cwd(), "schemas"));
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    for (const { schema } of schemas) ajv.addSchema(schema, schema.$id);
    const temperature = ajv.getSchema(
      "urn:hortinis:plants:schema:v1:temperature-profile",
    );
    const germination = ajv.getSchema(
      "urn:hortinis:plants:schema:v1:germination-profile",
    );
    const assertion = ajv.getSchema("urn:hortinis:plants:schema:v1:assertion");
    const rule = ajv.getSchema(
      "urn:hortinis:plants:schema:v1:cultivation-rule",
    );
    expect(
      temperature?.({ unit: "Cel", minimum: 10, maximum: 30, optimum: 24 }),
    ).toBe(true);
    expect(temperature?.({ unit: "C", optimum: 24 })).toBe(false);
    expect(
      germination?.({
        temperature: { unit: "Cel", optimum: 24 },
        duration: { unit: "d", minimum: 4, maximum: 10 },
      }),
    ).toBe(true);
    const assertionRecord = JSON.parse(
      await readFile(
        "test/fixtures/schema-conformance/v1/catalog-assertion-valid.json",
        "utf8",
      ),
    ) as Record<string, unknown>;
    assertionRecord.predicate = "growing_temperature";
    assertionRecord.value = { unit: "Cel", minimum: 10, maximum: 30 };
    expect(assertion?.(assertionRecord)).toBe(true);
    assertionRecord.value = { unit: "C", minimum: 10, maximum: 30 };
    expect(assertion?.(assertionRecord)).toBe(false);
    const ruleRecord = JSON.parse(
      await readFile(
        "test/fixtures/schema-conformance/v1/catalog-cultivation-rule-calendar-valid.json",
        "utf8",
      ),
    ) as Record<string, unknown>;
    ruleRecord.action = "harvest";
    expect(rule?.(ruleRecord)).toBe(true);
  });

  it("rejects reversed temperature profiles during semantic dataset validation", () => {
    const issues = validateValidationDataset({
      taxa: [],
      plantConcepts: [],
      cultivars: [],
      contexts: [],
      rules: [],
      evidence: [],
      reviews: [],
      assertions: [
        {
          id: "assertion_bad_temperature",
          subjectType: "plant-concept",
          subjectId: "plant_unmapped",
          predicate: "growing_temperature",
          value: { unit: "Cel", minimum: 30, maximum: 10 },
          context: {},
          evidenceReferenceIds: ["evidence_missing"],
          reviewId: "review_missing",
        },
      ],
    });
    expect(issues.map((issue) => issue.code)).toContain(
      "INVALID_TEMPERATURE_PROFILE",
    );
  });
});
