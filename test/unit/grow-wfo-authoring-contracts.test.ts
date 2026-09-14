import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonLines } from "../../src/serialization/json-lines.js";
import { getCompiledValidationApi } from "../support/compiled-validation-api.js";

const repositoryRoot = process.cwd();
const datasetRoot = join(repositoryRoot, "data/curation/grow-wfo-initial");
const manifestPath = join(datasetRoot, "dataset-manifest.json");
const manifestSchemaId =
  "urn:hortinis:plants:schema:authoring:v1:curation-dataset-manifest";
const expectedCollections: Readonly<Record<string, readonly [string, string]>> =
  {
    taxa: ["taxa.jsonl", "urn:hortinis:plants:schema:v1:taxon"],
    "taxonomic-names": [
      "taxonomic-names.jsonl",
      "urn:hortinis:plants:schema:v1:taxonomic-name",
    ],
    "plant-concepts": [
      "plant-concepts.jsonl",
      "urn:hortinis:plants:schema:v1:plant-concept",
    ],
    "cultivar-groups": [
      "cultivar-groups.jsonl",
      "urn:hortinis:plants:schema:v1:cultivar-group",
    ],
    cultivars: ["cultivars.jsonl", "urn:hortinis:plants:schema:v1:cultivar"],
    "localized-names": [
      "localized-names.jsonl",
      "urn:hortinis:plants:schema:v1:localized-name",
    ],
    "geographic-contexts": [
      "geographic-contexts.jsonl",
      "urn:hortinis:plants:schema:v1:geographic-context",
    ],
    "cultivation-contexts": [
      "cultivation-contexts.jsonl",
      "urn:hortinis:plants:schema:v1:cultivation-context",
    ],
    "evidence-references": [
      "evidence-references.jsonl",
      "urn:hortinis:plants:schema:v1:evidence-reference",
    ],
    reviews: ["reviews.jsonl", "urn:hortinis:plants:schema:v1:review"],
    "external-taxonomy-crosswalks": [
      "external-taxonomy-crosswalks.jsonl",
      "urn:hortinis:plants:schema:authoring:v1:external-taxonomy-crosswalk",
    ],
    "source-name-decisions": [
      "source-name-decisions.jsonl",
      "urn:hortinis:plants:schema:authoring:v1:source-name-decision",
    ],
    "source-subject-mappings": [
      "source-subject-mappings.jsonl",
      "urn:hortinis:plants:schema:authoring:v1:source-subject-mapping",
    ],
    "source-geography-decisions": [
      "source-geography-decisions.jsonl",
      "urn:hortinis:plants:schema:authoring:v1:source-geography-decision",
    ],
    "source-assertion-decisions": [
      "source-assertion-decisions.jsonl",
      "urn:hortinis:plants:schema:authoring:v1:source-assertion-decision",
    ],
    assertions: [
      "assertions.jsonl",
      "urn:hortinis:plants:schema:authoring:v1:assertion",
    ],
    "curation-issues": [
      "curation-issues.jsonl",
      "urn:hortinis:plants:schema:authoring:v1:curation-issue",
    ],
  };

interface CollectionDescriptor {
  readonly role: string;
  readonly path: string;
  readonly schemaId: string;
}

interface DependencyDescriptor {
  readonly id: string;
  readonly path: string;
  readonly schemaId: string;
  readonly sha256: string;
}

interface CurationManifest {
  readonly collections: readonly CollectionDescriptor[];
  readonly dependencies: readonly DependencyDescriptor[];
}

describe("GROW/WFO C4 authoring contracts", () => {
  it("validates the tracked manifest, dependencies, and empty collections", async () => {
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(
      manifestBytes.toString("utf8"),
    ) as CurationManifest;
    const api = await getCompiledValidationApi();

    expect(api.validate(manifestSchemaId, manifest)).toEqual({ valid: true });

    const roles = manifest.collections.map(({ role }) => role);
    const paths = manifest.collections.map(({ path }) => path);
    expect(new Set(roles).size).toBe(17);
    expect(new Set(paths).size).toBe(17);
    expect(
      Object.fromEntries(
        manifest.collections.map(({ role, path, schemaId }) => [
          role,
          [path, schemaId],
        ]),
      ),
    ).toEqual(expectedCollections);

    for (const collection of manifest.collections) {
      const path = join(datasetRoot, collection.path);
      expect((await stat(path)).size, collection.path).toBe(0);
      expect(() => api.validate(collection.schemaId, null)).not.toThrow();
      const records = [];
      for await (const record of readJsonLines(createReadStream(path), {
        schemaId: collection.schemaId,
        validationApi: api,
      })) {
        records.push(record);
      }
      expect(records, collection.path).toEqual([]);
    }

    for (const dependency of manifest.dependencies) {
      const bytes = await readFile(join(repositoryRoot, dependency.path));
      const value = JSON.parse(bytes.toString("utf8")) as {
        readonly id?: unknown;
      };
      expect(
        createHash("sha256").update(bytes).digest("hex"),
        dependency.path,
      ).toBe(dependency.sha256);
      expect(api.validate(dependency.schemaId, value), dependency.path).toEqual(
        {
          valid: true,
        },
      );
      expect(value.id, dependency.path).toBe(dependency.id);
    }
  });
});
