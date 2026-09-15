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
      taxonomicNames: [
        {
          id: "taxonomic_name_example",
          taxonId: "taxon_example",
          status: "active",
          scientificName: "Examplea officinalis",
          nameStatus: "accepted",
          taxonRank: "species",
          externalIdentifier: {
            sourceId: "source_world_flora_online_plant_list",
            sourceManifestId: "source_manifest_wfo_plant_list_2026_06",
            sourceReleaseId: "2026-06",
            identifier: "wfo-example",
          },
          evidenceReferenceIds: [],
          reviewId: "review_content_example",
        },
        {
          id: "taxonomic_name_example_synonym",
          taxonId: "taxon_example",
          status: "active",
          scientificName: "Examplea prior",
          nameStatus: "synonym",
          taxonRank: "species",
          acceptedTaxonomicNameId: "taxonomic_name_example",
          externalIdentifier: {
            sourceId: "source_world_flora_online_plant_list",
            sourceManifestId: "source_manifest_wfo_plant_list_2026_06",
            sourceReleaseId: "2026-06",
            identifier: "wfo-example-synonym",
          },
          evidenceReferenceIds: [],
          reviewId: "review_content_example",
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
      geographicContexts: [
        {
          id: "geography_example",
          kind: "administrative-area",
          name: "Example country",
          evidenceReferenceIds: [],
        },
      ],
      contexts: [
        {
          id: "context_example",
          geographicScope: {
            type: "specified",
            geographicContextIds: ["geography_example"],
          },
          growingSystem: "outdoor",
          propagation: "unknown",
        },
      ],
      rules: [],
      assertions: [
        {
          id: "assertion_example",
          subject: { type: "plant-concept", id: "plant_example" },
          predicate: "frost_sensitivity",
          value: "hardy",
          contextId: "context_example",
          evidenceReferenceIds: [],
          reviewId: "review_content_example",
        },
      ],
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
          reviewId: "review_content_example",
        },
        {
          id: "crosswalk_example_synonym",
          taxonId: "taxon_example",
          externalIdentifier: {
            sourceId: "source_world_flora_online_plant_list",
            sourceManifestId: "source_manifest_wfo_plant_list_2026_06",
            sourceReleaseId: "2026-06",
            identifier: "wfo-example-synonym",
          },
          externalName: "Examplea prior",
          taxonRank: "species",
          taxonomicStatus: "Synonym",
          acceptedNameIdentifier: "wfo-example",
          matchMethod: "exact-synonym",
          locator: "https://example.test/wfo#synonym",
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
          reason: "Accept the reviewed exact-name candidate.",
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
          decision: "map",
          subject: { type: "plant-concept", id: "plant_example" },
          externalTaxonomyCrosswalkId: "crosswalk_example",
          reason: "Map the source record to the reviewed plant concept.",
          reviewId: "review_content_example",
        },
      ],
      sourceGeographyDecisions: [
        {
          id: "geography_decision_example",
          sourceId: "source_grow_edible_plant_database",
          sourceManifestId: "source_manifest_grow_epd_2020",
          sourceReleaseId: "doi:10.15132/10000157",
          sourceLocation: {
            sheetCode: "EXAMPLE",
            country: "Example country",
            name: "Example country (Example city)",
            locator: "PlantingCalendar.xlsx!EXAMPLE",
          },
          decision: "map",
          geographicContextId: "geography_example",
          normalization: {
            originalCountry: "Example country",
            normalizedCountry: "Example country",
            method: "identity",
          },
          reason: "Preserve the source-named country scope.",
          reviewId: "review_content_example",
        },
      ],
      sourceAssertionDecisions: [
        {
          id: "assertion_decision_example",
          sourceCandidateId: "candidate_example",
          draftManifestSha256:
            "70ea61f87b9b8ca0ca5e272f1e5a0d2fb3afb63bdd88b15994e10e781239ac1a",
          decision: "accept",
          reason: "Accept the reviewed source-backed assertion.",
          reviewId: "review_content_example",
          assertionId: "assertion_example",
          contextId: "context_example",
        },
      ],
    };

    expect(validateValidationDataset(c4Dataset)).toEqual([]);
    expect(
      validateValidationDataset({
        ...c4Dataset,
        taxonomicNames: c4Dataset.taxonomicNames!.map((name) =>
          name.id === "taxonomic_name_example_synonym"
            ? { ...name, taxonId: "taxon_other" }
            : name,
        ),
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "INVALID_TAXONOMIC_NAME",
        recordId: "taxonomic_name_example_synonym",
      }),
    );
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

    expect(
      validateValidationDataset({
        ...c4Dataset,
        externalTaxonomyCrosswalks: [
          ...c4Dataset.externalTaxonomyCrosswalks!,
          {
            ...c4Dataset.externalTaxonomyCrosswalks![0],
            id: "crosswalk_duplicate",
          },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_COMPOSITE_KEY" }),
    );

    expect(
      validateValidationDataset({
        ...c4Dataset,
        reviews: [{ ...c4Dataset.reviews[0], status: "unreviewed" }],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "INVALID_REVIEW_REFERENCE",
        recordId: "taxonomic_name_example",
      }),
    );

    expect(
      validateValidationDataset({
        ...c4Dataset,
        sourceNameDecisions: [
          ...c4Dataset.sourceNameDecisions!,
          {
            ...c4Dataset.sourceNameDecisions![0],
            id: "name_decision_duplicate",
          },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_COMPOSITE_KEY" }),
    );
  });
});
