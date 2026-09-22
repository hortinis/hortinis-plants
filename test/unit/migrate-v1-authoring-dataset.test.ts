import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateV1AuthoringDataset } from "../../src/curation/migrate-v1-authoring-dataset.js";
import { validateGrowWfoDataset } from "../../src/curation/grow-wfo-validation.js";
import {
  writeJsonLines,
  readJsonLines,
} from "../../src/serialization/json-lines.js";

const repositoryRoot = process.cwd();
const trackedDataset = join(repositoryRoot, "data/curation/grow-wfo-initial");
const fixturePath = join(
  repositoryRoot,
  "test/fixtures/authoring-migration/v1/pre-t7-records.json",
);
const growRelease = {
  sourceId: "source_grow_edible_plant_database",
  sourceManifestId: "source_manifest_grow_epd_2020",
  sourceReleaseId: "doi:10.15132/10000157",
};

type Fixture = Record<string, Array<Record<string, unknown>>>;

describe("V1 authoring dataset migration", () => {
  it("migrates every declared collection without changing authored links", async () => {
    const parent = await mkdtemp(join("/tmp", "hortinis-t7-migration-"));
    const source = join(parent, "source");
    const first = join(parent, "first");
    const second = join(parent, "second");
    const fixture = await populate(source);

    const result = await migrate(source, first);
    await migrate(source, second);

    expect(result.recordCounts["assertion-comparison-decisions"]).toBe(0);
    expect(result.migratedCollections).toContain(
      "assertion-comparison-decisions",
    );
    expect(
      await validateGrowWfoDataset({ repositoryRoot, datasetDirectory: first }),
    ).toMatchObject({ valid: true, issues: [] });

    const firstManifest = await manifest(first);
    expect(firstManifest.datasetVersion).toBe("0.2.0");
    expect(firstManifest.collections).toHaveLength(18);
    for (const descriptor of firstManifest.collections) {
      const before = fixture[descriptor.role] ?? [];
      const after = await records(join(first, descriptor.path));
      expect(after.map(({ id }) => id).sort()).toEqual(
        before.map(({ id }) => id).sort(),
      );
    }
    const nameDecisions = await records(
      join(first, "source-name-decisions.jsonl"),
    );
    expect(
      nameDecisions.find(({ id }) => id === "name_decision_current"),
    ).toMatchObject({
      id: "name_decision_current",
      supersedesDecisionId: "name_decision_old",
      sourceRecordKey: { source: growRelease, recordId: "1" },
    });
    const geography = await records(
      join(first, "source-geography-decisions.jsonl"),
    );
    expect(geography[0]).toMatchObject({
      sourceLocationKey: { source: growRelease, locationId: "ATC" },
      sourceLocation: fixture["source-geography-decisions"]![0]!.sourceLocation,
    });
    await expectDirectoriesEqual(
      first,
      second,
      firstManifest.collections.map(({ path }) => path),
    );
  });

  it("refuses incomplete and unknown source references", async () => {
    const parent = await mkdtemp(
      join("/tmp", "hortinis-t7-migration-invalid-"),
    );
    const source = join(parent, "source");
    await populate(source);
    const evidence = await records(join(source, "evidence-references.jsonl"));
    delete evidence[0]!.sourceRecordId;
    await writeRecords(join(source, "evidence-references.jsonl"), evidence);
    await expect(migrate(source, join(parent, "incomplete"))).rejects.toThrow(
      "incomplete source-record reference",
    );

    await populate(source);
    const names = await records(join(source, "source-name-decisions.jsonl"));
    names[0]!.sourceManifestId = "source_manifest_unknown";
    await writeRecords(join(source, "source-name-decisions.jsonl"), names);
    await expect(migrate(source, join(parent, "unknown"))).rejects.toThrow(
      "unknown source release",
    );
  });
});

async function populate(directory: string): Promise<Fixture> {
  await cp(trackedDataset, directory, { recursive: true });
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
  const current = await manifest(directory);
  for (const descriptor of current.collections) {
    await writeRecords(
      join(directory, descriptor.path),
      fixture[descriptor.role] ?? [],
    );
  }
  const legacyManifest = {
    ...current,
    datasetVersion: "0.1.0",
    collections: current.collections.filter(
      ({ role }) => role !== "assertion-comparison-decisions",
    ),
  };
  await writeFile(
    join(directory, "dataset-manifest.json"),
    `${JSON.stringify(legacyManifest)}\n`,
  );
  return fixture;
}

async function migrate(source: string, destination: string) {
  return migrateV1AuthoringDataset({
    sourceDirectory: source,
    destinationDirectory: destination,
    permittedSourceReleases: [growRelease],
  });
}

async function manifest(directory: string): Promise<{
  datasetVersion: string;
  collections: Array<{ role: string; path: string }>;
}> {
  return JSON.parse(
    await readFile(join(directory, "dataset-manifest.json"), "utf8"),
  ) as {
    datasetVersion: string;
    collections: Array<{ role: string; path: string }>;
  };
}

async function records(path: string): Promise<Array<Record<string, unknown>>> {
  const result: Array<Record<string, unknown>> = [];
  for await (const entry of readJsonLines(createReadStream(path)))
    result.push(entry.value as Record<string, unknown>);
  return result;
}

async function writeRecords(
  path: string,
  values: readonly Record<string, unknown>[],
): Promise<void> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of writeJsonLines(values)) chunks.push(chunk);
  await writeFile(path, Buffer.concat(chunks));
}

async function expectDirectoriesEqual(
  left: string,
  right: string,
  paths: readonly string[],
): Promise<void> {
  for (const path of [...paths, "dataset-manifest.json"]) {
    expect(await readFile(join(left, path))).toEqual(
      await readFile(join(right, path)),
    );
  }
}
