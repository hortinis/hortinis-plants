import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WFO_ARCHIVE_LOCATOR } from "../../src/adapters/wfo/constants.js";
import { generateGrowWfoDrafts } from "../../src/curation/grow-wfo-drafts.js";
import { lookupWfoSnapshot } from "../../src/curation/wfo-lookup.js";
import { serializeCanonicalJson } from "../../src/serialization/canonical-json.js";
import {
  readJsonLines,
  writeJsonLines,
} from "../../src/serialization/json-lines.js";
import { getCompiledValidationApi } from "../support/compiled-validation-api.js";

const repositoryRoot = process.cwd();

describe("GROW/WFO C4 draft generation", () => {
  it("produces byte-identical queues and verifiable output descriptors", async () => {
    const fixture = await createFixture();
    try {
      const first = join(fixture.root, "draft-one");
      const second = join(fixture.root, "draft-two");
      await generate(fixture, first);
      await generate(fixture, second);

      const filenames = [
        "draft-manifest.json",
        "identity-review-queue.jsonl",
        "subject-mapping-review-queue.jsonl",
        "assertion-review-queue.jsonl",
        "taxonomy-crosswalk-review-queue.jsonl",
        "geographic-context-review-queue.jsonl",
        "curation-issues.jsonl",
      ];
      for (const filename of filenames) {
        expect(await readFile(join(first, filename))).toEqual(
          await readFile(join(second, filename)),
        );
      }

      const manifest = JSON.parse(
        await readFile(join(first, "draft-manifest.json"), "utf8"),
      ) as {
        outputs: {
          path: string;
          sha256: string;
          byteSize: number;
          recordCount: number;
          schemaId: string;
        }[];
      };
      const api = await getCompiledValidationApi();
      expect(
        api.validate(
          "urn:hortinis:plants:schema:curation:v1:draft-manifest",
          manifest,
        ),
      ).toEqual({ valid: true });
      for (const output of manifest.outputs) {
        const bytes = await readFile(join(first, output.path));
        expect(bytes.byteLength).toBe(output.byteSize);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          output.sha256,
        );
        let count = 0;
        for await (const row of readJsonLines(singleChunk(bytes), {
          schemaId: output.schemaId,
          validationApi: api,
        })) {
          expect(row.value).toBeDefined();
          count += 1;
        }
        expect(count).toBe(output.recordCount);
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("consolidates shared identifiers while keeping synonym-row provenance and record references", async () => {
    const fixture = await createFixture();
    try {
      const output = join(fixture.root, "drafts");
      await generate(fixture, output);
      const crosswalks = await readRecords(
        join(output, "taxonomy-crosswalk-review-queue.jsonl"),
      );
      const beta = crosswalks.find(
        (item) =>
          field(
            object(item.proposedExternalTaxonomyCrosswalk).externalIdentifier,
            "identifier",
          ) === "wfo-beta",
      );
      expect(beta).toMatchObject({
        proposalRoles: ["matched-accepted-name"],
        referringSourceRecordIds: ["1", "2"],
        sourceTaxonomyCandidateIds: ["taxon_match_c4_1", "taxon_match_c4_2"],
      });

      const synonym = crosswalks.find(
        (item) =>
          field(
            object(item.proposedExternalTaxonomyCrosswalk).externalIdentifier,
            "identifier",
          ) === "wfo-pea-synonym",
      );
      expect(synonym).toMatchObject({
        proposalRoles: ["matched-synonym"],
        referringSourceRecordIds: ["4"],
        proposedMatchMethod: "exact-synonym",
        proposedExternalTaxonomyCrosswalk: {
          externalName: "Pisum sativum",
          taxonomicStatus: "Synonym",
          acceptedNameIdentifier: "wfo-pea",
          locator: `${WFO_ARCHIVE_LOCATOR}!classification.csv#row=4`,
        },
      });
      expect(
        crosswalks.some(
          (item) =>
            field(
              object(item.proposedExternalTaxonomyCrosswalk).externalIdentifier,
              "identifier",
            ) === "wfo-pea" &&
            array(item.proposalRoles).includes("accepted-name-target"),
        ),
      ).toBe(true);
      const identity = await readRecords(
        join(output, "identity-review-queue.jsonl"),
      );
      expect(identity).toHaveLength(4);
      expect(identity.map((item) => item.id)).toContain("identity_review_1");
      expect(identity.map((item) => item.id)).toContain("identity_review_2");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails on a changed run output and preserves the last published draft", async () => {
    const fixture = await createFixture();
    try {
      const output = join(fixture.root, "drafts");
      await generate(fixture, output);
      const before = await readTree(output);
      await writeFile(
        join(fixture.wfoRun, "taxon-match-candidates.jsonl"),
        "{}\n",
      );
      await expect(generate(fixture, output)).rejects.toThrow(
        /checksum or size mismatch/u,
      );
      expect(await readTree(output)).toEqual(before);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

describe("pinned WFO lookup row selection", () => {
  it("finds normalized exact names and includes a synonym accepted-name target", async () => {
    const fixture = await createFixture();
    try {
      const nameResult = await lookupWfoSnapshot(fixture.snapshotPath, {
        by: "name",
        value: "  Beta   vulgaris ",
      });
      expect(nameResult.matches.map((row) => row.taxonID)).toEqual([
        "wfo-beta",
      ]);

      const synonymResult = await lookupWfoSnapshot(fixture.snapshotPath, {
        by: "id",
        value: "wfo-pea-synonym",
      });
      expect(synonymResult.matches.map((row) => row.taxonID)).toEqual([
        "wfo-pea-synonym",
      ]);
      expect(
        synonymResult.acceptedNameTargets.map((row) => row.taxonID),
      ).toEqual(["wfo-pea"]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

interface Fixture {
  readonly root: string;
  readonly growRun: string;
  readonly wfoRun: string;
  readonly growResources: string;
  readonly snapshotPath: string;
  readonly growSourceManifestPath: string;
  readonly wfoSourceManifestPath: string;
  readonly archiveMd5: string;
  readonly archiveByteSize: number;
}

async function generate(
  fixture: Fixture,
  outputDirectory: string,
): Promise<void> {
  await generateGrowWfoDrafts({
    growRunDirectory: fixture.growRun,
    wfoRunDirectory: fixture.wfoRun,
    outputDirectory,
    growResourceDirectory: fixture.growResources,
    wfoSnapshotPath: fixture.snapshotPath,
    growSourceManifestPath: fixture.growSourceManifestPath,
    wfoSourceManifestPath: fixture.wfoSourceManifestPath,
    expectedWfoArchive: {
      md5: fixture.archiveMd5,
      byteSize: fixture.archiveByteSize,
    },
    validationApi: await getCompiledValidationApi(),
  });
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "grow-wfo-c4-fixture-"));
  const growRun = join(root, "grow-run");
  const wfoRun = join(root, "wfo-run");
  const growResources = join(root, "grow-resources");
  const sourceManifests = join(root, "source-manifests");
  for (const directory of [growRun, wfoRun, growResources, sourceManifests]) {
    await mkdir(directory, { recursive: true });
  }

  const sourceRows = [
    sourceRecord("1", "Beta vulgaris"),
    sourceRecord("2", "Beta vulgaris"),
    sourceRecord("3", "Brassica oleracea"),
    sourceRecord("4", "Pisum sativum"),
  ];
  const growCandidateRows = [
    {
      id: "candidate_c4_1",
      sourceRecordId: "1",
      predicate: "sun_requirement",
      rawValue: "full sun",
      normalizedValue: "full_sun",
      applicability: {},
      reviewStatus: "unreviewed",
    },
  ];
  const inputBytes = Buffer.from("fixture GROW input\n");
  const inputPath = join(growResources, "grow-input.txt");
  await writeFile(inputPath, inputBytes);
  const growSourceManifest = sourceManifest(
    "grow",
    "grow-input.txt",
    {
      algorithm: "sha256",
      value: hash("sha256", inputBytes),
    },
    inputBytes.byteLength,
  );
  const growSourceManifestPath = join(
    sourceManifests,
    "grow-source-manifest.json",
  );
  const growSourceBytes = canonicalJsonLine(growSourceManifest);
  await writeFile(growSourceManifestPath, growSourceBytes);

  const archiveBytes = createStoredZip(
    "classification.csv",
    Buffer.from(classificationCsv(), "utf8"),
  );
  const snapshotPath = join(root, "wfo.zip");
  await writeFile(snapshotPath, archiveBytes);
  const archiveMd5 = hash("md5", archiveBytes);
  const wfoSourceManifest = sourceManifest(
    "wfo",
    WFO_ARCHIVE_LOCATOR,
    { algorithm: "md5", value: archiveMd5 },
    archiveBytes.byteLength,
  );
  const wfoSourceManifestPath = join(
    sourceManifests,
    "wfo-source-manifest.json",
  );
  const wfoSourceBytes = canonicalJsonLine(wfoSourceManifest);
  await writeFile(wfoSourceManifestPath, wfoSourceBytes);

  const growOutputs = [
    await writeOutput(growRun, "source-records.jsonl", "auxiliary", sourceRows),
    await writeOutput(
      growRun,
      "candidates.jsonl",
      "auxiliary",
      growCandidateRows,
    ),
  ];
  const growConfiguration = { fixture: true };
  const growRunManifest = {
    schemaVersion: "1.0.0",
    importer: { name: "grow-edible-plant-database", version: "0.2.0" },
    sourceManifest: {
      id: "source_manifest_grow_epd_2020",
      sha256: hash("sha256", growSourceBytes),
    },
    inputs: [
      {
        locator: "grow-input.txt",
        sha256: hash("sha256", inputBytes),
        byteSize: inputBytes.byteLength,
        role: "upstream",
      },
    ],
    configuration: growConfiguration,
    configurationSha256: hash(
      "sha256",
      serializeCanonicalJson(growConfiguration),
    ),
    tools: { node: "v24.0.0" },
    outputs: growOutputs,
    counts: {
      assertions: 0,
      warnings: 0,
      rejectedRecords: 0,
      unresolvedMappings: 0,
    },
  };
  const growRunBytes = canonicalJsonLine(growRunManifest);
  await writeFile(join(growRun, "importer-run-manifest.json"), growRunBytes);

  const wfoCandidates = buildWfoCandidates(sourceRows, archiveBytes);
  const wfoOutputs = [
    await writeOutput(
      wfoRun,
      "taxon-match-candidates.jsonl",
      "auxiliary",
      wfoCandidates,
      "urn:hortinis:plants:schema:v1:taxon-match-candidate",
      false,
    ),
    await writeOutput(
      wfoRun,
      "wfo-taxonomic-records.jsonl",
      "auxiliary",
      [],
      "urn:hortinis:plants:schema:v1:wfo-taxonomic-record",
      false,
    ),
    await writeOutput(
      wfoRun,
      "diagnostics.jsonl",
      "diagnostics",
      [],
      "urn:hortinis:plants:schema:v1:import-diagnostic",
      false,
    ),
  ];
  const wfoConfiguration = { fixture: true };
  const wfoRunManifest = {
    schemaVersion: "1.0.0",
    job: { name: "grow-wfo-taxonomy-reconciliation", version: "0.1.0" },
    sourceManifests: [
      {
        id: "source_manifest_grow_epd_2020",
        sha256: hash("sha256", growSourceBytes),
      },
      {
        id: "source_manifest_wfo_plant_list_2026_06",
        sha256: hash("sha256", wfoSourceBytes),
      },
    ].sort((left, right) => compare(left.id, right.id)),
    inputs: [
      {
        locator: WFO_ARCHIVE_LOCATOR,
        sha256: hash("sha256", archiveBytes),
        byteSize: archiveBytes.byteLength,
        role: "source-snapshot",
      },
      {
        locator: "grow-import-run:importer-run-manifest.json",
        sha256: hash("sha256", growRunBytes),
        byteSize: growRunBytes.byteLength,
        role: "importer-output",
      },
      {
        locator: "grow-import-run:source-records.jsonl",
        sha256: growOutputs[0]!.sha256,
        byteSize: growOutputs[0]!.byteSize,
        role: "importer-output",
      },
    ],
    configuration: wfoConfiguration,
    configurationSha256: hash(
      "sha256",
      serializeCanonicalJson(wfoConfiguration),
    ),
    tools: { node: "v24.0.0" },
    outputs: wfoOutputs,
    counts: {
      growRecords: sourceRows.length,
      uniqueInputNames: 3,
      candidateAccepted: 3,
      candidateSynonym: 1,
      ambiguous: 0,
      unplaced: 0,
      unresolvedStatus: 0,
      unmatched: 0,
      wfoRowsScanned: 4,
      selectedWfoRecords: 0,
      unresolvedMappings: 0,
    },
  };
  await writeFile(
    join(wfoRun, "reconciliation-run-manifest.json"),
    canonicalJsonLine(wfoRunManifest),
  );

  return {
    root,
    growRun,
    wfoRun,
    growResources,
    snapshotPath,
    growSourceManifestPath,
    wfoSourceManifestPath,
    archiveMd5,
    archiveByteSize: archiveBytes.byteLength,
  };
}

function sourceManifest(
  source: "grow" | "wfo",
  locator: string,
  checksum: { readonly algorithm: string; readonly value: string },
  byteSize: number,
): Record<string, unknown> {
  const path = join(
    repositoryRoot,
    source === "grow"
      ? "data/sources/grow/source-manifest.json"
      : "data/sources/wfo/source-manifest.json",
  );
  const original = JSON.parse(requireFile(path)) as Record<string, unknown>;
  return {
    ...original,
    resources: [
      {
        locator,
        checksum,
        byteSize,
        mediaType: source === "grow" ? "text/plain" : "application/zip",
      },
    ],
  };
}

function requireFile(path: string): string {
  return readFileSync(path, "utf8");
}

function sourceRecord(
  id: string,
  scientificName: string,
): Record<string, unknown> {
  return {
    sourceRecordId: id,
    sourceLocator: `plant1.accdb#record=${id}`,
    fields: {
      "Full taxonomic name": scientificName,
      "Common name": `Name ${id}`,
    },
  };
}

function buildWfoCandidates(
  records: readonly Record<string, unknown>[],
  archiveBytes: Buffer,
): Record<string, unknown>[] {
  const release = "2026-06";
  const archiveHash = hash("sha256", archiveBytes);
  return records.map((record, index) => {
    const sourceRecordId = String(record.sourceRecordId);
    const sourceName = String(object(record.fields)["Full taxonomic name"]);
    const source = {
      sourceId: "source_grow_edible_plant_database",
      sourceManifestId: "source_manifest_grow_epd_2020",
      sourceReleaseId: "doi:10.15132/10000157",
      sourceRecordId,
      sourceLocator: String(record.sourceLocator),
    };
    const base = {
      sourceId: "source_world_flora_online_plant_list",
      sourceManifestId: "source_manifest_wfo_plant_list_2026_06",
      sourceReleaseId: release,
    };
    const alternative =
      sourceRecordId === "1" || sourceRecordId === "2"
        ? wfoAlternative(
            base,
            "wfo-beta",
            "Beta vulgaris",
            "Accepted",
            "accepted",
            2,
          )
        : sourceRecordId === "3"
          ? wfoAlternative(
              base,
              "wfo-brassica",
              "Brassica oleracea",
              "Accepted",
              "accepted",
              3,
            )
          : {
              ...wfoAlternative(
                base,
                "wfo-pea-synonym",
                "Pisum sativum",
                "Synonym",
                "synonym",
                4,
              ),
              acceptedNameIdentifier: "wfo-pea",
              acceptedName: {
                externalIdentifier: { ...base, identifier: "wfo-pea" },
                scientificName: "Lathyrus oleraceus",
                taxonRank: "species",
                taxonomicStatus: "Accepted",
                sourceLocator: `${WFO_ARCHIVE_LOCATOR}!classification.csv#row=5`,
              },
            };
    return {
      id: `taxon_match_c4_${index + 1}`,
      source,
      snapshot: {
        sourceManifestId: "source_manifest_wfo_plant_list_2026_06",
        sourceReleaseId: release,
        sha256: archiveHash,
      },
      sourceName,
      comparisonName: sourceName,
      normalization: "unicode-nfc-trim-collapse-whitespace-v1",
      outcome:
        sourceRecordId === "4" ? "candidate-synonym" : "candidate-accepted",
      alternatives: [alternative],
      matchMethod: "exact-conservative-normalization-v1",
      reviewState: "unreviewed",
    };
  });
}

function wfoAlternative(
  base: Record<string, string>,
  id: string,
  scientificName: string,
  taxonomicStatus: string,
  statusCategory: string,
  row: number,
): Record<string, unknown> {
  return {
    externalIdentifier: { ...base, identifier: id },
    scientificName,
    taxonRank: "species",
    taxonomicStatus,
    statusCategory,
    sourceLocator: `${WFO_ARCHIVE_LOCATOR}!classification.csv#row=${row}`,
  };
}

function classificationCsv(): string {
  return (
    [
      "taxonID\tscientificName\tscientificNameAuthorship\ttaxonRank\ttaxonomicStatus\tacceptedNameUsageID\tparentNameUsageID\tgenus\tfamily",
      "wfo-beta\tBeta vulgaris\tL.\tspecies\tAccepted\t\twfo-beta-genus\tBeta\tAmaranthaceae",
      "wfo-brassica\tBrassica oleracea\tL.\tspecies\tAccepted\t\twfo-brassica-genus\tBrassica\tBrassicaceae",
      "wfo-pea-synonym\tPisum sativum\tL.\tspecies\tSynonym\twfo-pea\twfo-lathyrus\tPisum\tFabaceae",
      "wfo-pea\tLathyrus oleraceus\tLam.\tspecies\tAccepted\t\twfo-lathyrus\tLathyrus\tFabaceae",
    ].join("\n") + "\n"
  );
}

async function writeOutput(
  directory: string,
  path: string,
  role: string,
  values: readonly unknown[],
  schemaId?: string,
  includeRoleMetadata = true,
): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of writeJsonLines(values)) chunks.push(chunk);
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  await writeFile(join(directory, path), bytes);
  return {
    path,
    ...(includeRoleMetadata ? { role, mediaType: "application/jsonl" } : {}),
    ...(schemaId === undefined ? {} : { schemaId }),
    sha256: hash("sha256", bytes),
    byteSize: bytes.byteLength,
    recordCount: values.length,
  };
}

async function readRecords(path: string): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  for await (const { value } of readJsonLines(
    singleChunk(await readFile(path)),
  )) {
    records.push(object(value));
  }
  return records;
}

async function* singleChunk(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  await Promise.resolve();
  yield bytes;
}

async function readTree(directory: string): Promise<Record<string, string>> {
  const filenames = [
    "draft-manifest.json",
    "identity-review-queue.jsonl",
    "subject-mapping-review-queue.jsonl",
    "assertion-review-queue.jsonl",
    "taxonomy-crosswalk-review-queue.jsonl",
    "geographic-context-review-queue.jsonl",
    "curation-issues.jsonl",
  ];
  const entries: Array<[string, string]> = await Promise.all(
    filenames.map(async (filename): Promise<[string, string]> => [
      filename,
      (await readFile(join(directory, filename))).toString("base64"),
    ]),
  );
  return Object.fromEntries(entries);
}

function canonicalJsonLine(value: unknown): Buffer {
  return Buffer.concat([
    Buffer.from(serializeCanonicalJson(value)),
    Buffer.from("\n"),
  ]);
}

function hash(algorithm: "sha256" | "md5", bytes: Uint8Array): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object");
  }
  return value as Record<string, unknown>;
}

function field(value: unknown, key: string): unknown {
  return object(value)[key];
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createStoredZip(filename: string, data: Buffer): Buffer {
  const name = Buffer.from(filename, "utf8");
  const checksum = crc32(data);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(data.byteLength, 18);
  localHeader.writeUInt32LE(data.byteLength, 22);
  localHeader.writeUInt16LE(name.byteLength, 26);
  const localEntry = Buffer.concat([localHeader, name, data]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(data.byteLength, 20);
  centralHeader.writeUInt32LE(data.byteLength, 24);
  centralHeader.writeUInt16LE(name.byteLength, 28);
  const centralEntry = Buffer.concat([centralHeader, name]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralEntry.byteLength, 12);
  end.writeUInt32LE(localEntry.byteLength, 16);
  return Buffer.concat([localEntry, centralEntry, end]);
}

function crc32(bytes: Buffer): number {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum =
        (checksum & 1) === 1 ? (checksum >>> 1) ^ 0xedb88320 : checksum >>> 1;
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}
