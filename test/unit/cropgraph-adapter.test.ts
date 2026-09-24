import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importCropGraphSource } from "../../src/adapters/cropgraph/adapter.js";
import { serializeCanonicalJson } from "../../src/serialization/canonical-json.js";

const releaseId = "e722c3415bcf2773277f3422e13a4de5efd29b48";
const sourceDirectory = join(process.cwd(), "data/sources/cropgraph");
const originalDirectory = join(sourceDirectory, "releases", releaseId);
const calendarLocator = "packages/core/src/data/crop-calendar.json";
const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("CropGraph raw staging", () => {
  it("accounts for all pinned entries and produces byte-identical reruns", async () => {
    const root = await mkdtemp(join(tmpdir(), "cropgraph-t10-"));
    scratch.push(root);
    const options = { inputDirectory: originalDirectory };
    const first = await importCropGraphSource({
      ...options,
      outputDirectory: join(root, "first"),
    });
    const second = await importCropGraphSource({
      ...options,
      outputDirectory: join(root, "second"),
    });
    expect(first.manifestSha256).toBe(second.manifestSha256);
    const inventory = JSON.parse(
      (await readFile(join(root, "first/inventory.jsonl"), "utf8")).trim(),
    ) as {
      totalRecords: number;
      includedRecords: number;
      excludedRecords: number;
      pinnedSchemaExceptions: number;
      excludedResources: string[];
    };
    expect(inventory).toMatchObject({
      totalRecords: 5006,
      includedRecords: 5006,
      excludedRecords: 0,
      pinnedSchemaExceptions: 21,
    });
    expect(inventory.excludedResources).toHaveLength(80);
    const records = (
      await readFile(join(root, "first/source-records.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    const selected = (
      await readFile(join(root, "first/selected-records.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    expect(records).toHaveLength(5006);
    expect(selected).toEqual(records);
    expect(
      (await readFile(join(root, "first/diagnostics.jsonl"), "utf8"))
        .trim()
        .split("\n"),
    ).toHaveLength(21);
    const tomato = JSON.parse(
      records.find((line) => line.includes('"recordId":"tomato"'))!,
    ) as {
      citationLevel: string;
      rawEntry: { slug: string };
      commercialRights: string;
    };
    expect(tomato).toMatchObject({
      citationLevel: "calendar",
      rawEntry: { slug: "tomato" },
      commercialRights: "pending-review",
    });
  }, 20000);

  it("keeps selected record keys stable when the source array is reordered", async () => {
    const fixture = await makeFixture((entries) => entries.reverse());
    const result = await importCropGraphSource({
      ...fixture.options,
      outputDirectory: join(fixture.root, "run"),
    });
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    const selected = (
      await readFile(join(fixture.root, "run/selected-records.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    expect(selected).toHaveLength(5006);
    const expected = JSON.parse(
      await readFile(join(sourceDirectory, "cohort.json"), "utf8"),
    ) as { include: string[] };
    expect(
      selected.map(
        (line) =>
          (JSON.parse(line) as { sourceRecordKey: { recordId: string } })
            .sourceRecordKey.recordId,
      ),
    ).toEqual(expected.include);
    expect(
      JSON.parse(selected[0]!) as { sourceRecordKey: { recordId: string } },
    ).toMatchObject({ sourceRecordKey: { recordId: "abaca-manila-hemp" } });
  });

  it("fails atomically for a malformed entry and for a duplicate slug", async () => {
    for (const [name, change, message] of [
      [
        "malformed",
        (entries: Record<string, unknown>[]) => {
          entries[0]!.commonName = "";
        },
        "Invalid CropGraph entry",
      ],
      [
        "duplicate",
        (entries: Record<string, unknown>[]) => {
          entries[1]!.slug = entries[0]!.slug;
        },
        "Duplicate CropGraph slug",
      ],
    ] as const) {
      const fixture = await makeFixture(change);
      const outputDirectory = join(fixture.root, name);
      let failure: unknown;
      try {
        await importCropGraphSource({ ...fixture.options, outputDirectory });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(((failure as Error).cause as Error).message).toContain(message);
      await expect(
        readFile(join(outputDirectory, "importer-run-manifest.json")),
      ).rejects.toThrow();
    }
  });

  it("rejects a cohort that omits a pinned slug", async () => {
    const root = await mkdtemp(join(tmpdir(), "cropgraph-t10-scope-"));
    scratch.push(root);
    const cohort = JSON.parse(
      await readFile(join(sourceDirectory, "cohort.json"), "utf8"),
    ) as {
      sourceReleaseId: string;
      calendarSha256: string;
      rationale: string;
      include: string[];
      exclude: unknown[];
      fingerprint: string;
    };
    cohort.include.pop();
    cohort.fingerprint = digest(
      serializeCanonicalJson({
        sourceReleaseId: cohort.sourceReleaseId,
        calendarSha256: cohort.calendarSha256,
        rationale: cohort.rationale,
        include: cohort.include,
        exclude: cohort.exclude,
      }),
    );
    const cohortFile = join(root, "cohort.json");
    await writeFile(cohortFile, JSON.stringify(cohort));
    let failure: unknown;
    try {
      await importCropGraphSource({
        inputDirectory: originalDirectory,
        outputDirectory: join(root, "run"),
        cohortFile,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(((failure as Error).cause as Error).message).toContain(
      "does not account for every pinned calendar slug",
    );
  });
});

async function makeFixture(
  change: (entries: Record<string, unknown>[]) => void,
) {
  const root = await mkdtemp(join(tmpdir(), "cropgraph-t10-fixture-"));
  scratch.push(root);
  const inputDirectory = join(root, "input");
  for (const locator of [
    calendarLocator,
    "packages/core/src/data/crop-calendar.schema.json",
    "LICENSE",
    "packages/core/README.md",
  ]) {
    await mkdir(dirname(join(inputDirectory, locator)), { recursive: true });
    await copyFile(
      join(originalDirectory, locator),
      join(inputDirectory, locator),
    );
  }
  const calendar = JSON.parse(
    await readFile(join(inputDirectory, calendarLocator), "utf8"),
  ) as { entries: Record<string, unknown>[] };
  change(calendar.entries);
  const calendarBytes = Buffer.from(JSON.stringify(calendar));
  await writeFile(join(inputDirectory, calendarLocator), calendarBytes);
  const calendarSha256 = digest(calendarBytes);
  const manifest = JSON.parse(
    await readFile(join(sourceDirectory, "source-manifest.json"), "utf8"),
  ) as {
    resources: {
      locator: string;
      checksum: { value: string };
      byteSize: number;
    }[];
  };
  const resource = manifest.resources.find(
    (item) => item.locator === calendarLocator,
  )!;
  resource.checksum.value = calendarSha256;
  resource.byteSize = calendarBytes.length;
  const sourceManifestPath = join(root, "source-manifest.json");
  await writeFile(sourceManifestPath, JSON.stringify(manifest));
  const cohort = JSON.parse(
    await readFile(join(sourceDirectory, "cohort.json"), "utf8"),
  ) as {
    sourceReleaseId: string;
    calendarSha256: string;
    rationale: string;
    include: string[];
    exclude: unknown[];
    fingerprint: string;
  };
  cohort.calendarSha256 = calendarSha256;
  cohort.fingerprint = digest(
    serializeCanonicalJson({
      sourceReleaseId: cohort.sourceReleaseId,
      calendarSha256,
      rationale: cohort.rationale,
      include: cohort.include,
      exclude: cohort.exclude,
    }),
  );
  const cohortFile = join(root, "cohort.json");
  await writeFile(cohortFile, JSON.stringify(cohort));
  const exceptions = JSON.parse(
    await readFile(join(sourceDirectory, "schema-exceptions.json"), "utf8"),
  ) as { calendarSha256: string };
  exceptions.calendarSha256 = calendarSha256;
  const schemaExceptionsFile = join(root, "schema-exceptions.json");
  await writeFile(schemaExceptionsFile, JSON.stringify(exceptions));
  return {
    root,
    options: {
      inputDirectory,
      sourceManifestPath,
      cohortFile,
      schemaExceptionsFile,
    },
  };
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
