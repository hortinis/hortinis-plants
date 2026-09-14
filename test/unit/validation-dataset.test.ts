import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateValidationDataset,
  type DatasetRecord,
  type ValidationDataset,
} from "../../src/curation/validation-dataset.js";
import { readJsonLines } from "../../src/serialization/json-lines.js";
import { getCompiledValidationApi } from "../support/compiled-validation-api.js";

const root = join(process.cwd(), "data/validation/v1.2");

const schemasByFile: Readonly<Record<string, string>> = {
  "taxa.jsonl": "urn:hortinis:plants:schema:v1:taxon",
  "plant-concepts.jsonl": "urn:hortinis:plants:schema:v1:plant-concept",
  "cultivar-groups.jsonl": "urn:hortinis:plants:schema:v1:cultivar-group",
  "cultivars.jsonl": "urn:hortinis:plants:schema:v1:cultivar",
  "localized-names.jsonl": "urn:hortinis:plants:schema:v1:localized-name",
  "geographic-contexts.jsonl":
    "urn:hortinis:plants:schema:v1:geographic-context",
  "cultivation-contexts.jsonl":
    "urn:hortinis:plants:schema:v1:cultivation-context",
  "plant-facts.jsonl": "urn:hortinis:plants:schema:v1:plant-fact",
  "cultivation-rules.jsonl": "urn:hortinis:plants:schema:v1:cultivation-rule",
  "relationships.jsonl": "urn:hortinis:plants:schema:v1:relationship",
  "assertions.jsonl": "urn:hortinis:plants:schema:authoring:v1:assertion",
  "evidence-references.jsonl":
    "urn:hortinis:plants:schema:v1:evidence-reference",
  "sources.jsonl": "urn:hortinis:plants:schema:v1:source",
  "licences.jsonl": "urn:hortinis:plants:schema:v1:licence",
  "reviews.jsonl": "urn:hortinis:plants:schema:v1:review",
  "curation-issues.jsonl":
    "urn:hortinis:plants:schema:authoring:v1:curation-issue",
};

async function readRecords(file: string): Promise<DatasetRecord[]> {
  const records: DatasetRecord[] = [];
  for await (const { value } of readJsonLines(
    createReadStream(join(root, file)),
  )) {
    records.push(value as DatasetRecord);
  }
  return records;
}

describe("V1.2 validation dataset", () => {
  it("has resolvable curated references and distinct cultivar rules", async () => {
    const manifest = JSON.parse(
      await readFile(join(root, "dataset-manifest.json"), "utf8"),
    ) as { files: string[] };
    const sourceManifest = JSON.parse(
      await readFile(join(root, "source-manifest.json"), "utf8"),
    ) as unknown;
    const api = await getCompiledValidationApi();
    expect(
      api.validate(
        "urn:hortinis:plants:schema:v1:source-manifest",
        sourceManifest,
      ),
    ).toEqual({ valid: true });

    for (const file of manifest.files) {
      const schemaId = schemasByFile[file];
      expect(schemaId, `No schema mapping for ${file}`).toBeDefined();
      let lineNumber = 0;
      for await (const { value } of readJsonLines(
        createReadStream(join(root, file)),
      )) {
        lineNumber += 1;
        expect(api.validate(schemaId!, value), `${file}:${lineNumber}`).toEqual(
          { valid: true },
        );
      }
    }

    const dataset: ValidationDataset = {
      sourceManifestId: "source_manifest_dev_validation",
      taxa: await readRecords("taxa.jsonl"),
      plantConcepts: await readRecords("plant-concepts.jsonl"),
      cultivars: await readRecords("cultivars.jsonl"),
      localizedNames: await readRecords("localized-names.jsonl"),
      geographicContexts: await readRecords("geographic-contexts.jsonl"),
      contexts: await readRecords("cultivation-contexts.jsonl"),
      rules: await readRecords("cultivation-rules.jsonl"),
      assertions: await readRecords("assertions.jsonl"),
      evidence: await readRecords("evidence-references.jsonl"),
      sources: await readRecords("sources.jsonl"),
      licences: await readRecords("licences.jsonl"),
      reviews: await readRecords("reviews.jsonl"),
      curationIssues: await readRecords("curation-issues.jsonl"),
    };

    expect(validateValidationDataset(dataset)).toEqual([]);
    expect(dataset.cultivars).toHaveLength(2);
    expect(
      dataset.rules.filter((rule) => {
        const subject = rule.subject as { type?: string } | undefined;
        return subject?.type === "cultivar";
      }),
    ).toHaveLength(2);

    const invalidRule = dataset.rules.map((rule) =>
      rule.id === "rule_lettuce"
        ? {
            ...rule,
            timing: {
              type: "calendar-date-window",
              start: { month: 2, day: 30 },
              end: { month: 9, day: 30 },
            },
          }
        : rule,
    );
    expect(
      validateValidationDataset({ ...dataset, rules: invalidRule }),
    ).toContainEqual(
      expect.objectContaining({
        code: "INVALID_CALENDAR_VALUE",
        recordId: "rule_lettuce",
      }),
    );

    const invalidAssertion = dataset.assertions.map((assertion) =>
      assertion.id === "assertion_lettuce_window"
        ? {
            ...assertion,
            value: {
              type: "calendar-date-window",
              start: { month: 2, day: 30 },
              end: { month: 9, day: 30 },
            },
          }
        : assertion,
    );
    expect(
      validateValidationDataset({ ...dataset, assertions: invalidAssertion }),
    ).toContainEqual(
      expect.objectContaining({
        code: "INVALID_CALENDAR_VALUE",
        recordId: "assertion_lettuce_window",
      }),
    );
  });

  it("resolves C4 taxonomy, name, and subject decisions independently", () => {
    const c4Dataset: ValidationDataset = {
      sourceManifestIds: [
        "source_manifest_grow_epd_2020",
        "source_manifest_wfo_plant_list_2026_06",
      ],
      taxa: [
        {
          id: "taxon_example",
          status: "active",
          scientificName: "Examplea officinalis",
          evidenceReferenceIds: [],
        },
      ],
      plantConcepts: [
        {
          id: "plant_example",
          status: "active",
          taxonId: "taxon_example",
          evidenceReferenceIds: [],
        },
      ],
      cultivars: [],
      contexts: [],
      rules: [],
      assertions: [],
      evidence: [],
      reviews: [
        {
          id: "review_content_example",
          purpose: "content",
          status: "accepted",
        },
      ],
      externalTaxonomyCrosswalks: [
        {
          id: "crosswalk_example",
          taxonId: "taxon_example",
          externalIdentifier: {
            sourceId: "source_world_flora_online_plant_list",
            sourceManifestId: "source_manifest_wfo_plant_list_2026_06",
            sourceReleaseId: "2026-06",
            identifier: "wfo-example",
          },
          externalName: "Examplea officinalis",
          taxonRank: "species",
          taxonomicStatus: "Accepted",
          matchMethod: "exact-name",
          locator: "https://example.test/wfo#example",
          status: "accepted",
          reviewId: "review_content_example",
        },
      ],
      sourceNameDecisions: [
        {
          id: "name_decision_example",
          sourceId: "source_grow_edible_plant_database",
          sourceManifestId: "source_manifest_grow_epd_2020",
          sourceReleaseId: "doi:10.15132/10000157",
          sourceRecordId: "1",
          sourceName: "Examplea officinalis",
          sourceLocator: "plant1.accdb#table=Edible%20plants&record.ID=1",
          decision: "accept-candidate",
          externalTaxonomyCrosswalkId: "crosswalk_example",
          status: "accepted",
          reviewId: "review_content_example",
        },
      ],
      sourceSubjectMappings: [
        {
          id: "subject_mapping_example",
          sourceId: "source_grow_edible_plant_database",
          sourceManifestId: "source_manifest_grow_epd_2020",
          sourceReleaseId: "doi:10.15132/10000157",
          sourceRecordId: "1",
          sourceLocator: "plant1.accdb#table=Edible%20plants&record.ID=1",
          subject: { type: "plant-concept", id: "plant_example" },
          externalTaxonomyCrosswalkId: "crosswalk_example",
          status: "accepted",
          reviewId: "review_content_example",
        },
      ],
    };

    expect(validateValidationDataset(c4Dataset)).toEqual([]);
    expect(
      validateValidationDataset({
        ...c4Dataset,
        sourceNameDecisions: [
          {
            ...c4Dataset.sourceNameDecisions![0]!,
            sourceManifestId: "unknown",
          },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "MISSING_REFERENCE",
        recordId: "name_decision_example",
      }),
    );
  });
});
