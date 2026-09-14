import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runImporter } from "../../src/importer/runner.js";
import type {
  ImportEvent,
  ImporterDefinition,
} from "../../src/importer/types.js";
import { getCompiledValidationApi } from "../support/compiled-validation-api.js";

const fixtureDirectory = join(process.cwd(), "test/fixtures/importer-run/v1");
const locator = "fixture://release/source-records.json";

describe("generic importer runner", () => {
  it("verifies a publisher-declared MD5 and records the computed SHA-256", async () => {
    const validationApi = await getCompiledValidationApi();
    const directory = await mkdtemp(join(tmpdir(), "importer-md5-"));
    try {
      const sourceBytes = await readFile(
        join(fixtureDirectory, "source-records.json"),
      );
      const sourceManifest = JSON.parse(
        await readFile(join(fixtureDirectory, "source-manifest.json"), "utf8"),
      ) as {
        resources: {
          locator: string;
          checksum: { algorithm: string; value: string };
        }[];
      };
      const resource = sourceManifest.resources[0];
      if (resource === undefined)
        throw new Error("Fixture resource is missing");
      resource.checksum = {
        algorithm: "md5",
        value: createHash("md5").update(sourceBytes).digest("hex"),
      };
      const sourceManifestPath = join(directory, "source-manifest.json");
      await writeFile(sourceManifestPath, JSON.stringify(sourceManifest));

      const result = await runImporter({
        importer: fixtureImporter(),
        sourceManifestPath,
        resourceDirectory: fixtureDirectory,
        outputDirectory: join(directory, "output"),
        validationApi,
      });
      const manifest = result.manifest as {
        inputs: { locator: string; sha256: string; byteSize: number }[];
      };
      expect(manifest.inputs[0]).toEqual({
        locator,
        sha256: createHash("sha256").update(sourceBytes).digest("hex"),
        byteSize: sourceBytes.byteLength,
        role: "upstream",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("validates outputs and produces deterministic manifest and diagnostic summaries", async () => {
    const validationApi = await getCompiledValidationApi();
    const directory = await mkdtemp(join(tmpdir(), "importer-runner-"));
    try {
      const first = await runImporter({
        importer: fixtureImporter(),
        sourceManifestPath: join(fixtureDirectory, "source-manifest.json"),
        resourceDirectory: fixtureDirectory,
        outputDirectory: join(directory, "first"),
        validationApi,
      });
      const second = await runImporter({
        importer: fixtureImporter(),
        sourceManifestPath: join(fixtureDirectory, "source-manifest.json"),
        resourceDirectory: fixtureDirectory,
        outputDirectory: join(directory, "second"),
        validationApi,
      });
      expect(first.manifest).toEqual(second.manifest);
      expect(first.manifestSha256).toBe(second.manifestSha256);
      const manifest = first.manifest as {
        counts: Record<string, number>;
        outputs: {
          path: string;
          sha256: string;
          byteSize: number;
          recordCount: number;
        }[];
      };
      expect(manifest.counts).toEqual({
        assertions: 1,
        warnings: 1,
        rejectedRecords: 1,
        unresolvedMappings: 1,
      });
      expect(manifest.outputs).toHaveLength(3);
      for (const output of manifest.outputs) {
        const bytes = await readFile(join(first.outputDirectory, output.path));
        expect(bytes.byteLength).toBe(output.byteSize);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          output.sha256,
        );
      }
      const diagnostics = (
        await readFile(join(first.outputDirectory, "diagnostics.jsonl"), "utf8")
      )
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as { kind: string });
      expect(diagnostics.map(({ kind }) => kind).sort()).toEqual([
        "rejected-record",
        "unresolved-mapping",
        "warning",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not publish a run manifest or output directory after a checksum failure", async () => {
    const validationApi = await getCompiledValidationApi();
    const directory = await mkdtemp(join(tmpdir(), "importer-failed-"));
    try {
      const damaged = join(directory, "source-records.json");
      await writeFile(damaged, "tampered\n");
      await expect(
        runImporter({
          importer: fixtureImporter(),
          sourceManifestPath: join(fixtureDirectory, "source-manifest.json"),
          resourceDirectory: directory,
          outputDirectory: join(directory, "failed-output"),
          validationApi,
        }),
      ).rejects.toMatchObject({ code: "SOURCE_RESOURCE_MISMATCH" });
      await expect(
        readFile(
          join(directory, "failed-output", "importer-run-manifest.json"),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("removes staged output and publishes no manifest when transformation fails", async () => {
    const validationApi = await getCompiledValidationApi();
    const directory = await mkdtemp(
      join(tmpdir(), "importer-transform-failed-"),
    );
    const importer: ImporterDefinition = {
      ...fixtureImporter(),
      async *run(context): AsyncIterable<ImportEvent> {
        await readFile(context.resourcePath(locator), "utf8");
        yield diagnostic(
          "warning",
          "BEFORE_FAILURE",
          "record-1",
          "Staged diagnostic.",
        );
        throw new Error("Fixture transformation failure");
      },
    };
    const outputDirectory = join(directory, "failed-output");
    try {
      const failedRun = runImporter({
        importer,
        sourceManifestPath: join(fixtureDirectory, "source-manifest.json"),
        resourceDirectory: fixtureDirectory,
        outputDirectory,
        validationApi,
      });
      await expect(failedRun).rejects.toMatchObject({
        code: "IMPORTER_FAILED",
      });
      await expect(failedRun).rejects.toHaveProperty(
        "cause.message",
        "Fixture transformation failure",
      );
      await expect(
        readFile(join(outputDirectory, "importer-run-manifest.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(join(outputDirectory, "diagnostics.jsonl")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function fixtureImporter(): ImporterDefinition {
  return {
    name: "fixture-importer",
    version: "1.0.0",
    configuration: { normalize: "trim-v1" },
    inputs: [{ locator, path: "source-records.json", role: "upstream" }],
    outputs: [
      {
        name: "assertions",
        path: "assertions.jsonl",
        role: "assertions",
        mediaType: "application/jsonl",
        schemaId: "urn:hortinis:plants:schema:authoring:v1:assertion",
      },
      {
        name: "evidence",
        path: "evidence.jsonl",
        role: "evidence",
        mediaType: "application/jsonl",
        schemaId: "urn:hortinis:plants:schema:v1:evidence-reference",
      },
      {
        name: "diagnostics",
        path: "diagnostics.jsonl",
        role: "diagnostics",
        mediaType: "application/jsonl",
        schemaId: "urn:hortinis:plants:schema:v1:import-diagnostic",
      },
    ],
    tools: { fixtureParser: "1.0.0" },
    async *run(context): AsyncIterable<ImportEvent> {
      const content = JSON.parse(
        await readFile(context.resourcePath(locator), "utf8"),
      ) as {
        records: {
          id: string;
          subjectId: string | null;
          value: string | null;
        }[];
      };
      for (const record of content.records) {
        if (record.id === "tomato-1") {
          yield {
            output: "evidence",
            value: {
              id: "evidence_fixture_tomato",
              sourceId: "source_fixture",
              sourceManifestId: context.sourceManifestId,
              sourceReleaseId: "fixture-1",
              sourceRecordId: record.id,
              locator: "fixture://release/source-records.json#tomato-1",
              normalization: { originalValue: record.value, method: "trim-v1" },
              rights: {
                licenceId: "licence_fixture",
                decision: "eligible",
                reason: "Fixture rights review",
                reviewId: "review_fixture_rights",
              },
            },
          };
          yield {
            output: "assertions",
            value: {
              id: "assertion_fixture_tomato_name",
              subject: { type: "plant-concept", id: record.subjectId },
              predicate: "frost_sensitivity",
              value: "sensitive",
              contextId: "context_validation_unknown",
              evidenceReferenceIds: ["evidence_fixture_tomato"],
              reviewId: "review_fixture",
            },
          };
          yield diagnostic(
            "warning",
            "FIXTURE_NORMALIZATION",
            record.id,
            "Whitespace was trimmed.",
          );
        } else if (record.subjectId === null) {
          yield diagnostic(
            "unresolved-mapping",
            "UNMAPPED_SUBJECT",
            record.id,
            "No reviewed subject mapping exists.",
          );
        } else {
          yield diagnostic(
            "rejected-record",
            "MISSING_VALUE",
            record.id,
            "The source value is empty.",
          );
        }
      }
    },
  };
}

function diagnostic(
  kind: string,
  code: string,
  sourceRecordId: string,
  message: string,
): ImportEvent {
  return {
    output: "diagnostics",
    value: {
      kind,
      code,
      message,
      sourceRecordId,
      sourceLocator: `${locator}#${sourceRecordId}`,
    },
  };
}
