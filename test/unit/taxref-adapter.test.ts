import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importTaxrefSource } from "../../src/adapters/taxref/adapter.js";
import {
  CHANGE_HEADERS,
  CHANGES_MEMBER,
  HABITATS_MEMBER,
  HABITAT_HEADERS,
  RANKS_MEMBER,
  RANK_HEADERS,
  REMOVED_HEADERS,
  REMOVED_MEMBER,
  STATUSES_MEMBER,
  STATUS_HEADERS,
  TAXONOMY_HEADERS,
  TAXONOMY_MEMBER,
  TAXREF_ARCHIVE_LOCATOR,
  VERNACULAR_HEADERS,
  VERNACULAR_MEMBER,
} from "../../src/adapters/taxref/constants.js";
import { getCompiledValidationApi } from "../support/compiled-validation-api.js";

const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("TAXREF extraction and localization candidates", () => {
  it("stages accepted, synonym, homonym, localization, status and identifier-history records deterministically", async () => {
    const fixture = await makeFixture();
    const validationApi = await getCompiledValidationApi();
    const first = await importTaxrefSource({
      ...fixture.options,
      outputDirectory: join(fixture.root, "first"),
      validationApi,
    });
    const second = await importTaxrefSource({
      ...fixture.options,
      outputDirectory: join(fixture.root, "second"),
      validationApi,
    });
    expect(first.manifestSha256).toBe(second.manifestSha256);

    const taxonomic = await readJsonLines(
      join(first.outputDirectory, "taxonomic-records.jsonl"),
    );
    expect(taxonomic).toHaveLength(4);
    expect(taxonomic[1]).toMatchObject({
      sourceRecordKey: { recordId: "100" },
      taxonomicStatus: "accepted",
      acceptedTaxonIdentifier: "100",
      rank: { code: "ES", label: "Espèce" },
      rawRecord: {
        LB_NOM: "Solanum fixture",
        NOM_VERN: "Tomate, Pomme d'amour",
      },
    });
    expect(taxonomic[2]).toMatchObject({
      sourceRecordKey: { recordId: "101" },
      taxonomicStatus: "synonym",
      acceptedTaxonIdentifier: "100",
    });
    expect(
      taxonomic
        .filter(
          (record) =>
            (record.rawRecord as Record<string, string>).LB_NOM ===
            "Solanum fixture",
        )
        .map(
          (record) => (record.sourceRecordKey as { recordId: string }).recordId,
        ),
    ).toEqual(["100", "101", "102"]);

    const candidates = await readJsonLines(
      join(first.outputDirectory, "localization-candidates.jsonl"),
    );
    expect(candidates).toHaveLength(3);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(3);
    expect(
      candidates.find(
        (candidate) => candidate.rawValue === "Tomate, Pomme d'amour",
      ),
    ).toMatchObject({
      value: {
        text: "Tomate, Pomme d'amour",
        languageTag: "fr",
        delimiterInterpretation: "preserved-unsplit",
      },
      commercialRights: "eligible",
      reviewState: "unreviewed",
    });
    expect(
      candidates.find(
        (candidate) => candidate.rawValue === "Tomate fixture, Pomme fixture",
      ),
    ).toMatchObject({
      value: {
        nameUsageTerritoryOriginal: "France",
        taxonBiogeographicStatuses: [
          { territoryCode: "FR", statusCode: "P", statusLabel: "Présent" },
        ],
      },
    });

    const diagnostics = await readJsonLines(
      join(first.outputDirectory, "diagnostics.jsonl"),
    );
    expect(diagnostics.map((item) => item.code).sort()).toEqual([
      "FRENCH_LANGUAGE_FIELDS_DISAGREE",
      "MISSING_PARENT_TARGET",
    ]);
    expect(
      await readJsonLines(
        join(first.outputDirectory, "removed-identifiers.jsonl"),
      ),
    ).toMatchObject([
      { identifier: "50", replacementTaxonIdentifier: "100" },
      { identifier: "51" },
    ]);
    const vocabulary = await readJsonLines(
      join(first.outputDirectory, "vocabularies.jsonl"),
    );
    const speciesRank = vocabulary.find(
      (record) => record.vocabulary === "rank" && record.code === "ES",
    );
    expect(speciesRank?.rawRecord).toMatchObject({ DETAIL: "Espèce" });
    const inventory = (
      await readJsonLines(join(first.outputDirectory, "inventory.jsonl"))
    )[0];
    expect(inventory).toMatchObject({
      externalLinksMaterialized: false,
      counts: {
        taxonomicRecords: 4,
        vernacularRecords: 3,
        localizationCandidates: 3,
        changeRecords: 1,
        removedIdentifiers: 2,
        diagnostics: 2,
      },
    });
  }, 15000);

  it.each([
    [
      "missing accepted-name target",
      (rows: Record<string, string>[]) => {
        rows[1]!.CD_REF = "9999";
      },
      "missing CD_REF 9999",
    ],
    [
      "parent cycle",
      (rows: Record<string, string>[]) => {
        rows[1]!.CD_SUP = "102";
        rows[3]!.CD_SUP = "100";
      },
      "CD_SUP cycle",
    ],
    [
      "duplicate identifier",
      (rows: Record<string, string>[]) => {
        rows[3]!.CD_NOM = "100";
      },
      "Duplicate TAXREF taxonomic identifier 100",
    ],
  ])("fails atomically for a %s", async (_name, mutate, message) => {
    const valid = await makeFixture();
    const validationApi = await getCompiledValidationApi();
    const outputDirectory = join(valid.root, "run");
    await importTaxrefSource({
      ...valid.options,
      outputDirectory,
      validationApi,
    });
    const manifestBefore = await readFile(
      join(outputDirectory, "importer-run-manifest.json"),
    );

    const malformed = await makeFixture({ mutateTaxonomy: mutate });
    await expect(
      importTaxrefSource({
        ...malformed.options,
        outputDirectory,
        validationApi,
      }),
    ).rejects.toHaveProperty("cause.message", expect.stringContaining(message));
    expect(
      await readFile(join(outputDirectory, "importer-run-manifest.json")),
    ).toEqual(manifestBefore);
  });

  it("rejects malformed UTF-8 before publishing output", async () => {
    const fixture = await makeFixture({ malformedVernacularUtf8: true });
    const validationApi = await getCompiledValidationApi();
    const outputDirectory = join(fixture.root, "run");
    await expect(
      importTaxrefSource({
        ...fixture.options,
        outputDirectory,
        validationApi,
      }),
    ).rejects.toThrow();
    await expect(
      readFile(join(outputDirectory, "importer-run-manifest.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a missing target from a non-French vernacular row", async () => {
    const fixture = await makeFixture({
      mutateVernacular(rows) {
        rows[1]!.CD_NOM = "9999";
      },
    });
    const validationApi = await getCompiledValidationApi();
    await expect(
      importTaxrefSource({
        ...fixture.options,
        outputDirectory: join(fixture.root, "run"),
        validationApi,
      }),
    ).rejects.toHaveProperty(
      "cause.message",
      expect.stringContaining("missing taxonomic target(s), including 9999"),
    );
  });
});

async function makeFixture(
  options: {
    readonly mutateTaxonomy?: (rows: Record<string, string>[]) => void;
    readonly mutateVernacular?: (rows: Record<string, string>[]) => void;
    readonly malformedVernacularUtf8?: boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "taxref-t12-"));
  scratch.push(root);
  const taxonomy = [
    taxon({
      CD_NOM: "1",
      CD_REF: "1",
      RANG: "KD",
      LB_NOM: "Plantae",
      NOM_COMPLET: "Plantae",
      NOM_VALIDE: "Plantae",
      NOM_VERN: "Règne végétal",
    }),
    taxon({
      CD_NOM: "100",
      CD_TAXSUP: "1",
      CD_SUP: "999",
      CD_REF: "100",
      RANG: "ES",
      LB_NOM: "Solanum fixture",
      LB_AUTEUR: "L.",
      NOM_COMPLET: "Solanum fixture L.",
      NOM_VALIDE: "Solanum fixture L.",
      NOM_VERN: "Tomate, Pomme d'amour",
      FR: "P",
    }),
    taxon({
      CD_NOM: "101",
      CD_TAXSUP: "1",
      CD_SUP: "1",
      CD_REF: "100",
      RANG: "ES",
      LB_NOM: "Solanum fixture",
      NOM_COMPLET: "Solanum fixture auct.",
      NOM_VALIDE: "Solanum fixture L.",
      FR: "P",
    }),
    taxon({
      CD_NOM: "102",
      CD_TAXSUP: "1",
      CD_SUP: "1",
      CD_REF: "102",
      RANG: "ES",
      LB_NOM: "Solanum fixture",
      NOM_COMPLET: "Solanum fixture Fixture",
      NOM_VALIDE: "Solanum fixture Fixture",
      FR: "I",
    }),
  ];
  options.mutateTaxonomy?.(taxonomy);
  const vernacular = vernacularRows();
  options.mutateVernacular?.(vernacular);

  const vernacularBytes = options.malformedVernacularUtf8
    ? Buffer.concat([
        table(VERNACULAR_HEADERS, vernacular),
        Buffer.from([0xc3, 0x28]),
      ])
    : table(VERNACULAR_HEADERS, vernacular);
  const members = new Map<string, Buffer>([
    [REMOVED_MEMBER, table(REMOVED_HEADERS, removedRows())],
    [
      HABITATS_MEMBER,
      table(
        HABITAT_HEADERS,
        [
          {
            HABITAT: "3",
            LB_HABITAT: "Terrestre",
            DEFINITION: "Espèces terrestres.",
          },
        ],
        "latin1",
      ),
    ],
    [
      RANKS_MEMBER,
      table(
        RANK_HEADERS,
        [
          { RG_LEVEL: "20", RANG: "KD", DETAIL: "Règne", DETAIL_EN: "Kingdom" },
          {
            RG_LEVEL: "290",
            RANG: "ES",
            DETAIL: "Espèce",
            DETAIL_EN: "Species",
          },
        ],
        "latin1",
      ),
    ],
    [
      STATUSES_MEMBER,
      table(
        STATUS_HEADERS,
        [
          {
            ORDRE: "10",
            STATUT: "P",
            DESCRIPTION: "Présent",
            DEFINITION: "Présent.",
          },
          {
            ORDRE: "60",
            STATUT: "I",
            DESCRIPTION: "Introduit",
            DEFINITION: "Introduit.",
          },
        ],
        "latin1",
      ),
    ],
    [TAXONOMY_MEMBER, table(TAXONOMY_HEADERS, taxonomy)],
    [
      CHANGES_MEMBER,
      table(CHANGE_HEADERS, [
        {
          CD_NOM: "100",
          NUM_VERSION_INIT: "17.0",
          NUM_VERSION_FINAL: "18.0",
          CHAMP: "FR",
          VALEUR_INIT: "M",
          VALEUR_FINAL: "P",
          TYPE_CHANGE: "MODIFICATION",
        },
      ]),
    ],
    [
      "TAXREF_LIENS.txt",
      Buffer.from(
        '"CT_NAME"\t"CT_TYPE"\t"CT_AUTHORS"\t"CT_TITLE"\t"CT_URL"\t"CD_NOM"\t"CT_SP_ID"\t"URL_SP"\r\n',
      ),
    ],
    [VERNACULAR_MEMBER, vernacularBytes],
    ["TAXREFv18.pdf", Buffer.from("%PDF-1.4\n%%EOF\n")],
  ]);
  const archiveBytes = createStoredZip(members);
  const archivePath = join(root, "TAXREF_v18_2025.zip");
  await writeFile(archivePath, archiveBytes);
  const sourceManifest = JSON.parse(
    await readFile("data/sources/taxref/source-manifest.json", "utf8"),
  ) as {
    resources: {
      locator: string;
      checksum: { algorithm: string; value: string };
      byteSize: number;
    }[];
  };
  sourceManifest.resources = [
    {
      locator: TAXREF_ARCHIVE_LOCATOR,
      checksum: { algorithm: "sha256", value: sha256(archiveBytes) },
      byteSize: archiveBytes.byteLength,
    },
  ];
  const sourceManifestPath = join(root, "source-manifest.json");
  await writeFile(sourceManifestPath, JSON.stringify(sourceManifest));
  const archiveIndexPath = join(root, "archive-index.json");
  await writeFile(
    archiveIndexPath,
    JSON.stringify({
      release: "18.0",
      archiveLocator: TAXREF_ARCHIVE_LOCATOR,
      members: [...members].map(([path, bytes]) => ({
        path,
        byteSize: bytes.byteLength,
        sha256: sha256(bytes),
        role: "fixture",
      })),
    }),
  );
  return {
    root,
    options: { archivePath, sourceManifestPath, archiveIndexPath },
  };
}

function taxon(overrides: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    TAXONOMY_HEADERS.map((header) => [header, overrides[header] ?? ""]),
  );
}

function vernacularRows(): Record<string, string>[] {
  return [
    {
      CD_VERN: "200",
      CD_NOM: "100",
      LB_VERN: "Tomate fixture, Pomme fixture",
      NOM_VERN_SOURCE: "Fixture source",
      LANGUE: "Français",
      ISO639_3: "fra",
      PAYS: "France",
    },
    {
      CD_VERN: "201",
      CD_NOM: "100",
      LB_VERN: "Fixture tomato",
      NOM_VERN_SOURCE: "",
      LANGUE: "Anglais",
      ISO639_3: "eng",
      PAYS: "France",
    },
    {
      CD_VERN: "202",
      CD_NOM: "100",
      LB_VERN: "Marqueur incohérent",
      NOM_VERN_SOURCE: "",
      LANGUE: "Français",
      ISO639_3: "eng",
      PAYS: "France",
    },
  ];
}

function removedRows(): Record<string, string>[] {
  return [
    {
      CD_NOM: "50",
      PLUS_RECENTE_DIFFUSION: "17.0",
      CD_NOM_REMPLACEMENT: "100",
      CD_RAISON_SUPPRESSION: "1",
      RAISON_SUPPRESSION: "Doublon",
    },
    {
      CD_NOM: "51",
      PLUS_RECENTE_DIFFUSION: "17.0",
      CD_NOM_REMPLACEMENT: "",
      CD_RAISON_SUPPRESSION: "2",
      RAISON_SUPPRESSION: "Retiré",
    },
  ];
}

function table(
  headers: readonly string[],
  rows: readonly Record<string, string>[],
  encoding: BufferEncoding = "utf8",
): Buffer {
  const lines = [
    headers
      .map(quote)
      .join(
        headers === RANK_HEADERS ||
          headers === HABITAT_HEADERS ||
          headers === STATUS_HEADERS
          ? ";"
          : "\t",
      ),
    ...rows.map((row) =>
      headers
        .map((header) => quote(row[header] ?? ""))
        .join(
          headers === RANK_HEADERS ||
            headers === HABITAT_HEADERS ||
            headers === STATUS_HEADERS
            ? ";"
            : "\t",
        ),
    ),
  ];
  return Buffer.from(`${lines.join("\r\n")}\r\n`, encoding);
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function createStoredZip(members: ReadonlyMap<string, Buffer>): Buffer {
  const localEntries: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let offset = 0;
  for (const [filename, data] of members) {
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
    localEntries.push(localEntry);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.byteLength, 20);
    centralHeader.writeUInt32LE(data.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralEntries.push(Buffer.concat([centralHeader, name]));
    offset += localEntry.byteLength;
  }
  const centralDirectory = Buffer.concat(centralEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(members.size, 8);
  end.writeUInt16LE(members.size, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localEntries, centralDirectory, end]);
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

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJsonLines(path: string): Promise<Record<string, unknown>[]> {
  return (await readFile(path, "utf8"))
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
