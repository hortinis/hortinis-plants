import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTaxonMatchCandidates,
  ExactWfoNameMatchIndex,
  normalizeScientificName,
  type SelectedWfoRecord,
} from "../../src/adapters/wfo/adapter.js";
import { WFO_CLASSIFICATION_FILENAME } from "../../src/adapters/wfo/constants.js";
import { readWfoSnapshot } from "../../src/adapters/wfo/read-snapshot.js";
import type {
  GrowNameRecord,
  WfoSnapshotRecord,
} from "../../src/adapters/wfo/types.js";
import { serializeCanonicalJson } from "../../src/serialization/canonical-json.js";
import { getCompiledValidationApi } from "../support/compiled-validation-api.js";

const fixtureDirectory = join(process.cwd(), "test/fixtures/wfo");

describe("WFO snapshot name matching", () => {
  it("matches exact accepted names and synonyms, retains ambiguity and unmatched names, and keeps duplicate GROW records distinct", async () => {
    const validationApi = await getCompiledValidationApi();
    const records = JSON.parse(
      await readFile(join(fixtureDirectory, "name-match-records.json"), "utf8"),
    ) as WfoSnapshotRecord[];
    const growNames: GrowNameRecord[] = [
      {
        sourceRecordId: "1",
        sourceLocator: "grow#1",
        scientificName: " Beta   vulgaris ",
      },
      {
        sourceRecordId: "2",
        sourceLocator: "grow#2",
        scientificName: "Beta vulgaris",
      },
      {
        sourceRecordId: "3",
        sourceLocator: "grow#3",
        scientificName: "Brassica oleracea var. capitata",
      },
      {
        sourceRecordId: "4",
        sourceLocator: "grow#4",
        scientificName: "Pisum sativum",
      },
      {
        sourceRecordId: "5",
        sourceLocator: "grow#5",
        scientificName: "Allium fictum",
      },
      {
        sourceRecordId: "6",
        sourceLocator: "grow#6",
        scientificName: "Beta vulgarius",
      },
      {
        sourceRecordId: "7",
        sourceLocator: "grow#7",
        scientificName: "Lactuca sativa var. fixture",
      },
    ];
    const index = new ExactWfoNameMatchIndex(growNames);
    for (const row of [...records].reverse()) index.add(row);
    const { matchesByName, rowsScanned } = index.result();
    const selected = new Map<string, SelectedWfoRecord>();
    const acceptedTargets = records.filter((row) =>
      ["wfo-brassica-accepted", "wfo-pea-a"].includes(row.taxonID),
    );
    for (const row of acceptedTargets) {
      selected.set(row.taxonID, {
        row,
        reasons: new Set(["accepted-name-target"]),
      });
    }

    const source = {
      sourceId: "source_world_flora_online_plant_list",
      sourceManifestId: "source_manifest_wfo_plant_list_2026_06",
      sourceReleaseId: "2026-06",
    };
    const growSource = {
      sourceId: "source_grow_edible_plant_database",
      sourceManifestId: "source_manifest_grow_epd_2020",
      sourceReleaseId: "doi:10.15132/10000157",
    };
    const candidates = createTaxonMatchCandidates(
      growNames,
      matchesByName,
      selected,
      source,
      growSource,
      "a".repeat(64),
    );

    expect(rowsScanned).toBe(records.length);
    expect(candidates.map((candidate) => candidate.outcome)).toEqual([
      "candidate-accepted",
      "candidate-accepted",
      "candidate-synonym",
      "ambiguous",
      "unplaced",
      "unmatched",
      "unresolved-status",
    ]);
    expect(
      candidates
        .slice(0, 2)
        .map((candidate) => candidate.source.sourceRecordId),
    ).toEqual(["1", "2"]);
    expect(candidates[2]?.alternatives[0]?.acceptedName).toMatchObject({
      scientificName: "Brassica oleracea",
      externalIdentifier: { identifier: "wfo-brassica-accepted" },
    });
    expect(
      candidates[3]?.alternatives.map(
        (item) => item.externalIdentifier.identifier,
      ),
    ).toEqual(["wfo-pea-a", "wfo-pea-b"]);
    expect(candidates[6]?.alternatives[0]?.acceptedNameIdentifier).toBe(
      "wfo-not-present",
    );
    for (const candidate of candidates) {
      expect(
        validationApi.validate(
          "urn:hortinis:plants:schema:v1:taxon-match-candidate",
          candidate,
        ).valid,
      ).toBe(true);
    }

    const repeated = createTaxonMatchCandidates(
      growNames,
      matchesByName,
      selected,
      source,
      growSource,
      "a".repeat(64),
    );
    expect(serializeCanonicalJson(candidates)).toEqual(
      serializeCanonicalJson(repeated),
    );
  });

  it("uses only NFC, trim, and whitespace collapse for automatic name normalization", () => {
    expect(normalizeScientificName("  Café\t\n plant  ")).toBe("Café plant");
    expect(normalizeScientificName("Solanum Lycopersicum")).not.toBe(
      normalizeScientificName("Solanum lycopersicum"),
    );
  });

  it("rejects a repeated WFO identifier in the streaming name index", async () => {
    const [row] = await readMatchRecords();
    if (row === undefined) throw new Error("WFO fixture row is missing");
    const index = new ExactWfoNameMatchIndex([
      {
        sourceRecordId: "1",
        sourceLocator: "grow#1",
        scientificName: row.scientificName,
      },
    ]);
    index.add(row);
    expect(() => index.add({ ...row, rowNumber: row.rowNumber + 1 })).toThrow(
      /repeats taxonID/u,
    );
  });

  it("fails clearly when a required classification.csv row field is empty", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wfo-malformed-"));
    const snapshotPath = join(directory, "synthetic.zip");
    try {
      const csv = await readFile(
        join(fixtureDirectory, "classification-malformed.csv"),
      );
      await writeFile(
        snapshotPath,
        createStoredZip(WFO_CLASSIFICATION_FILENAME, csv),
      );
      await expect(collectSnapshot(snapshotPath)).rejects.toMatchObject({
        code: "MISSING_REQUIRED_FIELD",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("streams a tab-delimited WFO classification.csv record from a synthetic ZIP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wfo-valid-"));
    const snapshotPath = join(directory, "synthetic.zip");
    try {
      const csv = Buffer.from(
        [
          "taxonID\tscientificName\tscientificNameAuthorship\ttaxonRank\ttaxonomicStatus\tacceptedNameUsageID\tparentNameUsageID\tgenus\tfamily",
          "wfo-test-1\tBeta vulgaris\tL.\tspecies\taccepted\t\twfo-beta\tBeta\tAmaranthaceae",
        ].join("\n") + "\n",
      );
      await writeFile(
        snapshotPath,
        createStoredZip(WFO_CLASSIFICATION_FILENAME, csv),
      );
      await expect(collectSnapshot(snapshotPath)).resolves.toMatchObject([
        {
          taxonID: "wfo-test-1",
          scientificName: "Beta vulgaris",
          taxonRank: "species",
          taxonomicStatus: "accepted",
          rowNumber: 2,
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports a missing local snapshot without trying a live service", async () => {
    await expect(
      collectSnapshot(join(tmpdir(), "missing-wfo-snapshot.zip")),
    ).rejects.toMatchObject({
      code: "MISSING_SNAPSHOT",
    });
  });
});

async function readMatchRecords(): Promise<WfoSnapshotRecord[]> {
  return JSON.parse(
    await readFile(join(fixtureDirectory, "name-match-records.json"), "utf8"),
  ) as WfoSnapshotRecord[];
}

async function collectSnapshot(path: string): Promise<WfoSnapshotRecord[]> {
  const rows: WfoSnapshotRecord[] = [];
  for await (const row of readWfoSnapshot(path)) rows.push(row);
  return rows;
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
