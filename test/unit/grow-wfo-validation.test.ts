import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateGrowWfoDataset } from "../../src/curation/grow-wfo-validation.js";
import { getCompiledValidationApi } from "../support/compiled-validation-api.js";

const repositoryRoot = process.cwd();
const sourceDataset = join(repositoryRoot, "data/curation/grow-wfo-initial");

async function copyDataset(): Promise<string> {
  const parent = await mkdtemp(join("/tmp", "hortinis-c4-validation-"));
  const destination = join(parent, "dataset");
  await cp(sourceDataset, destination, { recursive: true });
  return destination;
}

async function readManifest(
  directory: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(directory, "dataset-manifest.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("GROW/WFO manifest-driven validation", () => {
  it("validates the empty tracked dataset from a clean checkout", async () => {
    const result = await validateGrowWfoDataset({ repositoryRoot });
    expect(result).toMatchObject({ valid: true, issues: [] });
    expect(result.loaded?.dataset.sourceManifestIds).toEqual([
      "source_manifest_grow_epd_2020",
      "source_manifest_wfo_plant_list_2026_06",
    ]);
  });

  it("rejects an unknown schema identifier and preserves deterministic diagnostics", async () => {
    const directory = await copyDataset();
    const manifest = await readManifest(directory);
    const collections = manifest.collections as Array<Record<string, unknown>>;
    collections[0] = {
      ...collections[0],
      schemaId: "urn:hortinis:plants:schema:unknown",
    };
    await writeFile(
      join(directory, "dataset-manifest.json"),
      `${JSON.stringify(manifest)}\n`,
    );
    const api = await getCompiledValidationApi();
    const first = await validateGrowWfoDataset({
      repositoryRoot,
      datasetDirectory: directory,
      validationApi: api,
    });
    const second = await validateGrowWfoDataset({
      repositoryRoot,
      datasetDirectory: directory,
      validationApi: api,
    });
    expect(first.valid).toBe(false);
    expect(first.issues).toEqual(second.issues);
    expect(first.issues).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_SCHEMA_ID" }),
    );
  });

  it("reports strict JSONL errors with the collection path and line number", async () => {
    const directory = await copyDataset();
    await writeFile(
      join(directory, "taxa.jsonl"),
      '{"id":"taxon_a","id":"taxon_b"}\n',
    );
    const result = await validateGrowWfoDataset({
      repositoryRoot,
      datasetDirectory: directory,
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "DUPLICATE_KEY",
        path: "taxa.jsonl",
        lineNumber: 1,
      }),
    );
  });

  it("detects a tracked dependency checksum change without loading authored records", async () => {
    const directory = await copyDataset();
    const manifest = await readManifest(directory);
    const dependencies = manifest.dependencies as Array<
      Record<string, unknown>
    >;
    dependencies[0] = { ...dependencies[0], sha256: "0".repeat(64) };
    await writeFile(
      join(directory, "dataset-manifest.json"),
      `${JSON.stringify(manifest)}\n`,
    );
    const result = await validateGrowWfoDataset({
      repositoryRoot,
      datasetDirectory: directory,
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "DEPENDENCY_CHECKSUM_MISMATCH" }),
    );
    expect(result.loaded).toBeUndefined();
  });
});
