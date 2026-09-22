import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { runImporter } from "../../src/importer/runner.js";
import type {
  ImportEvent,
  ImporterDefinition,
} from "../../src/importer/types.js";

const sourceDirectory = join(process.cwd(), "data/sources/cropgraph");
const releaseId = "e722c3415bcf2773277f3422e13a4de5efd29b48";
const releaseDirectory = join(sourceDirectory, "releases", releaseId);
const sourceManifestPath = join(sourceDirectory, "source-manifest.json");
const calendarLocator = "packages/core/src/data/crop-calendar.json";

interface SourceManifestResource {
  readonly locator: string;
  readonly checksum: { readonly algorithm: string; readonly value: string };
  readonly byteSize: number;
}

interface CropGraphSourceManifest {
  readonly id: string;
  readonly release: { readonly identifier: string };
  readonly resources: readonly SourceManifestResource[];
  readonly licenceReview: {
    readonly status: string;
    readonly declaredLicence: string;
  };
  readonly profileEligibility: readonly {
    readonly profile: string;
    readonly decision: string;
  }[];
}

describe("CropGraph source metadata", () => {
  it("validates the source, declared data licence and pinned manifest", async () => {
    const source = JSON.parse(
      await readFile(join(sourceDirectory, "source.json"), "utf8"),
    ) as unknown;
    const licence = JSON.parse(
      await readFile(join(sourceDirectory, "licence.json"), "utf8"),
    ) as unknown;
    const manifest = JSON.parse(
      await readFile(sourceManifestPath, "utf8"),
    ) as CropGraphSourceManifest;
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    for (const path of [
      "schemas/catalog/v1/common.schema.json",
      "schemas/catalog/v1/source.schema.json",
      "schemas/catalog/v1/licence.schema.json",
      "schemas/source-manifest/v1/source-manifest.schema.json",
    ]) {
      const schema = JSON.parse(await readFile(path, "utf8")) as object;
      ajv.addSchema(schema);
    }

    for (const [schemaId, value] of [
      ["urn:hortinis:plants:schema:v1:source", source],
      ["urn:hortinis:plants:schema:v1:licence", licence],
      ["urn:hortinis:plants:schema:v1:source-manifest", manifest],
    ] as const) {
      const validate = ajv.getSchema(schemaId);
      expect(validate).toBeDefined();
      expect(validate?.(value), JSON.stringify(validate?.errors)).toBe(true);
    }
    expect(manifest).toMatchObject({
      id: "source_manifest_cropgraph",
      release: { identifier: releaseId },
      licenceReview: {
        status: "unreviewed",
        declaredLicence: "CC-BY-4.0",
      },
    });
    expect(
      manifest.profileEligibility.find(
        ({ profile }) => profile === "commercial",
      )?.decision,
    ).toBe("pending-review");
    expect(
      manifest.profileEligibility.find(
        ({ profile }) => profile === "dev-validation",
      )?.decision,
    ).toBe("eligible");
    expect(licence).toMatchObject({
      id: "licence_cropgraph_data_declared_cc_by_4_0",
      expression: "CC-BY-4.0",
      commercialUse: "unknown",
    });
  });

  it("verifies every vendored resource against its exact bytes", async () => {
    const manifest = JSON.parse(
      await readFile(sourceManifestPath, "utf8"),
    ) as CropGraphSourceManifest;

    expect(manifest.resources.map(({ locator }) => locator)).toEqual([
      calendarLocator,
      "packages/core/src/data/crop-calendar.schema.json",
      "LICENSE",
      "packages/core/README.md",
    ]);
    for (const resource of manifest.resources) {
      expect(resource.checksum.algorithm, resource.locator).toBe("sha256");
      const bytes = await readFile(join(releaseDirectory, resource.locator));
      expect(bytes.byteLength, resource.locator).toBe(resource.byteSize);
      expect(
        createHash("sha256").update(bytes).digest("hex"),
        resource.locator,
      ).toBe(resource.checksum.value);
    }
  });

  it("records direct and inherited citation scope without treating it as a rights grant", async () => {
    const calendar = JSON.parse(
      await readFile(join(releaseDirectory, calendarLocator), "utf8"),
    ) as {
      readonly license: string;
      readonly source: string;
      readonly entries: readonly { readonly source?: string }[];
    };
    const directSources = calendar.entries.flatMap((entry) =>
      entry.source === undefined ? [] : [entry.source],
    );
    const catalogPattern = /catalog|yearbook|descriptor|nursery|seed/iu;

    expect(calendar.license).toBe("CC-BY-4.0");
    expect(calendar.source.length).toBeGreaterThan(0);
    expect(calendar.entries).toHaveLength(5006);
    expect(directSources).toHaveLength(4856);
    expect(calendar.entries.length - directSources.length).toBe(150);
    expect(new Set(directSources).size).toBe(2209);
    expect(
      directSources.filter((source) => /^https?:\/\//u.test(source)),
    ).toHaveLength(0);
    expect(
      directSources.filter((source) => catalogPattern.test(source)),
    ).toHaveLength(2088);
  });

  it("rejects changed calendar bytes before transformation starts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cropgraph-pin-"));
    const damagedPath = join(directory, calendarLocator);
    let transformationStarted = false;
    const importer: ImporterDefinition = {
      name: "cropgraph-pin-verification",
      version: "0.0.0-test",
      configuration: {},
      inputs: [
        {
          locator: calendarLocator,
          path: calendarLocator,
          role: "upstream",
        },
      ],
      outputs: [
        {
          name: "diagnostics",
          path: "diagnostics.jsonl",
          role: "diagnostics",
          mediaType: "application/jsonl",
          schemaId: "urn:hortinis:plants:schema:v1:import-diagnostic",
        },
      ],
      tools: {},
      async *run(): AsyncIterable<ImportEvent> {
        transformationStarted = true;
        await Promise.resolve();
        yield {
          output: "diagnostics",
          value: {
            kind: "warning",
            code: "UNEXPECTED_TRANSFORMATION",
            message: "Transformation must not start for changed source bytes.",
          },
        };
      },
    };

    try {
      await mkdir(dirname(damagedPath), { recursive: true });
      await copyFile(join(releaseDirectory, calendarLocator), damagedPath);
      await appendFile(damagedPath, "\n");

      await expect(
        runImporter({
          importer,
          sourceManifestPath,
          resourceDirectory: directory,
          outputDirectory: join(directory, "output"),
          validationApi: { validate: () => ({ valid: true }) },
        }),
      ).rejects.toMatchObject({ code: "SOURCE_RESOURCE_MISMATCH" });
      expect(transformationStarted).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
