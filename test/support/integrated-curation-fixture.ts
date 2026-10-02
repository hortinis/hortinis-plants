import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  digest,
  contentDigest,
} from "../../src/curation/curation-artifacts.js";
import { generateIntegratedReviewPackets } from "../../src/curation/integrated-review-packets.js";
import { getCompiledValidationApi } from "./compiled-validation-api.js";

type RecordValue = Record<string, unknown>;

export async function fixtureRecord(filename: string): Promise<RecordValue> {
  return JSON.parse(
    await readFile(
      join(process.cwd(), "test/fixtures/schema-conformance/v1", filename),
      "utf8",
    ),
  ) as RecordValue;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

export async function createIntegratedFixture() {
  const root = await mkdtemp("/tmp/hortinis-integrated-");
  const dataset = join(root, "dataset");
  const drafts = join(root, "drafts");
  const grow = join(root, "grow");
  const crop = join(root, "crop");
  const wfo = join(root, "wfo");
  const taxref = join(root, "taxref");
  for (const directory of [grow, crop, wfo, taxref]) await mkdir(directory);
  await cp("data/curation/grow-wfo-initial", dataset, { recursive: true });
  const datasetManifest = JSON.parse(
    await readFile(join(dataset, "dataset-manifest.json"), "utf8"),
  ) as RecordValue;
  datasetManifest.reviewBaseline = [
    {
      role: "grow-importer-configuration",
      type: "configuration",
      sha256: contentDigest({}),
    },
  ];
  await writeJson(join(dataset, "dataset-manifest.json"), datasetManifest);
  const manifests = Object.fromEntries(
    ["grow", "cropgraph", "wfo", "taxref"].map((kind) => [
      kind,
      join(process.cwd(), `data/sources/${kind}/source-manifest.json`),
    ]),
  );
  const sourceManifests: Record<string, RecordValue> = {};
  for (const [kind, path] of Object.entries(manifests))
    sourceManifests[kind] = JSON.parse(
      await readFile(path, "utf8"),
    ) as RecordValue;
  const growKey = {
    source: {
      sourceId: "source_grow_edible_plant_database",
      sourceManifestId: "source_manifest_grow_epd_2020",
      sourceReleaseId: "doi:10.15132/10000157",
    },
    recordId: "1",
  };
  const cropKey = {
    source: {
      sourceId: "source_cropgraph",
      sourceManifestId: "source_manifest_cropgraph",
      sourceReleaseId: "e722c3415bcf2773277f3422e13a4de5efd29b48",
    },
    recordId: "1",
  };
  const growRecord = {
    sourceRecordKey: growKey,
    sourceLocator: "plant1.accdb#Edible plants.ID=1",
    fields: { "Common name": "Tomato" },
  };
  const unmatchedRecord = {
    ...growRecord,
    sourceRecordKey: { ...growKey, recordId: "2" },
    sourceLocator: "plant1.accdb#Edible plants.ID=2",
    fields: { "Common name": "Unknown crop" },
  };
  const growCandidate = {
    id: "candidate-grow-1",
    sourceRecordKey: growKey,
    sourceLocator: "grow.csv#row=1",
    predicate: "calendar_window",
    rawValue: "March",
    normalizedValue: {
      action: "outdoor_sowing_or_planting",
      startMonth: 3,
      endMonth: 4,
    },
    applicability: {
      geography: { country: "Ireland" },
      growingSystem: "outdoors",
    },
    reviewState: "unreviewed",
  };
  const cropRecord = await fixtureRecord("cropgraph-raw-record-valid.json");
  cropRecord.sourceRecordKey = cropKey;
  cropRecord.rawEntry = {
    slug: "1",
    commonName: "Tomato",
    scientificName: "Solanum lycopersicum",
  };
  const identity = await fixtureRecord(
    "cropgraph-identity-candidate-valid.json",
  );
  identity.sourceRecordKey = cropKey;
  identity.sourceClaimKey = {
    ...(identity.sourceClaimKey as RecordValue),
    sourceRecordKey: cropKey,
  };
  const cultivation = await fixtureRecord(
    "cropgraph-cultivation-candidate-valid.json",
  );
  cultivation.sourceRecordKey = cropKey;
  cultivation.sourceClaimKey = {
    ...(cultivation.sourceClaimKey as RecordValue),
    sourceRecordKey: cropKey,
  };
  const taxonomy = await fixtureRecord(
    "importer-taxon-match-candidate-valid.json",
  );
  const taxonomyCrop = {
    ...taxonomy,
    id: "taxonomy-crop-1",
    source: { sourceRecordKey: cropKey, sourceLocator: "crop.json#/entries/0" },
  };
  const taxonomyUnmatched = {
    ...taxonomy,
    id: "taxonomy-grow-2",
    source: {
      ...(taxonomy.source as RecordValue),
      sourceRecordId: "2",
      sourceLocator: unmatchedRecord.sourceLocator,
    },
    sourceName: "Unknown crop",
    comparisonName: "Unknown crop",
    outcome: "unmatched",
    alternatives: [],
  };
  const cohort = join(root, "cohort.json");
  await writeJson(cohort, {
    sourceReleaseId: cropKey.source.sourceReleaseId,
    include: ["1"],
    exclude: [],
  });
  const cohortSha256 = digest(await readFile(cohort));
  const api = await getCompiledValidationApi();
  const emptyCounts = {
    assertions: 0,
    warnings: 0,
    rejectedRecords: 0,
    unresolvedMappings: 0,
  };
  const sourceDirectories = {
    grow: join(root, "grow-resources"),
    cropgraph: join(root, "crop-resources"),
  };
  for (const directory of Object.values(sourceDirectories)) {
    await mkdir(directory);
    await writeFile(join(directory, "input.txt"), "Pinned fixture resource\n");
  }
  async function outputs(
    directory: string,
    collections: Record<string, unknown[]>,
    schemaIds: Record<string, string> = {},
  ) {
    const result: RecordValue[] = [];
    for (const [filename, rows] of Object.entries(collections)) {
      const bytes = Buffer.from(
        rows.map((row) => `${JSON.stringify(row)}\n`).join(""),
      );
      await writeFile(join(directory, filename), bytes);
      result.push({
        path: filename,
        role: "auxiliary",
        sha256: digest(bytes),
        byteSize: bytes.byteLength,
        recordCount: rows.length,
        mediaType: "application/jsonl",
        ...(schemaIds[filename] === undefined
          ? {}
          : { schemaId: schemaIds[filename] }),
      });
    }
    return result;
  }
  async function importer(
    directory: string,
    kind: string,
    configuration: RecordValue,
    collections: Record<string, unknown[]>,
    schemaIds: Record<string, string> = {},
  ) {
    await writeJson(join(directory, "importer-run-manifest.json"), {
      schemaVersion: "1.0.0",
      importer: { name: kind, version: "0.1.0" },
      sourceManifest: {
        id: sourceManifests[kind]!.id,
        sha256: digest(await readFile(manifests[kind]!)),
      },
      inputs: [
        {
          locator: "input.txt",
          role: "upstream",
          sha256: digest(Buffer.from("Pinned fixture resource\n")),
          byteSize: Buffer.byteLength("Pinned fixture resource\n"),
        },
      ],
      configuration,
      configurationSha256: contentDigest(configuration),
      tools: { node: "24.0.0" },
      outputs: await outputs(directory, collections, schemaIds),
      counts: emptyCounts,
    });
  }
  await importer(
    grow,
    "grow",
    {},
    {
      "source-records.jsonl": [growRecord, unmatchedRecord],
      "candidates.jsonl": [growCandidate],
    },
  );
  await importer(
    crop,
    "cropgraph",
    { cohortSha256 },
    {
      "selected-records.jsonl": [cropRecord],
      "identity-candidates.jsonl": [identity],
      "cultivation-candidates.jsonl": [cultivation],
    },
    {
      "selected-records.jsonl":
        "urn:hortinis:plants:schema:v1:cropgraph-raw-record",
      "identity-candidates.jsonl":
        "urn:hortinis:plants:schema:v1:cropgraph-identity-candidate",
      "cultivation-candidates.jsonl":
        "urn:hortinis:plants:schema:v1:cropgraph-cultivation-candidate",
    },
  );
  const reconciliationInputs: RecordValue[] = [];
  for (const kind of ["grow", "wfo"]) {
    const bytes = await readFile(manifests[kind]!);
    reconciliationInputs.push({
      role: `source-manifest-${kind}`,
      id: sourceManifests[kind]!.id,
      locator: manifests[kind],
      schemaId: "urn:hortinis:plants:schema:v1:source-manifest",
      sha256: digest(bytes),
      byteSize: bytes.byteLength,
    });
  }
  async function reconciliation(
    directory: string,
    collections: Record<string, unknown[]>,
    schemaIds: Record<string, string>,
  ) {
    await writeJson(join(directory, "reconciliation-run-manifest.json"), {
      schemaVersion: "1.0.0",
      job: { name: "fixture", version: "0.1.0" },
      inputs: reconciliationInputs,
      configuration: {},
      configurationSha256: contentDigest({}),
      tools: { node: "24.0.0" },
      outputs: await outputs(directory, collections, schemaIds),
      counts: [],
    });
  }
  await reconciliation(
    wfo,
    {
      "taxon-match-candidates.jsonl": [
        taxonomy,
        taxonomyCrop,
        taxonomyUnmatched,
      ],
    },
    {
      "taxon-match-candidates.jsonl":
        "urn:hortinis:plants:schema:v1:taxon-match-candidate",
    },
  );
  await reconciliation(
    taxref,
    { "link-outcomes.jsonl": [], "localization-proposals.jsonl": [] },
    {
      "link-outcomes.jsonl":
        "urn:hortinis:plants:schema:curation:v1:taxref-wfo-link-outcome",
      "localization-proposals.jsonl":
        "urn:hortinis:plants:schema:curation:v1:taxref-localization-proposal",
    },
  );
  const generatorOptions = {
    growRunDirectory: grow,
    cropGraphRunDirectory: crop,
    wfoRunDirectory: wfo,
    taxrefWfoRunDirectory: taxref,
    datasetDirectory: dataset,
    outputDirectory: drafts,
    cohortPath: cohort,
    sourceManifestPaths: manifests,
    validationApi: api,
  };
  await generateIntegratedReviewPackets(generatorOptions);
  return {
    root,
    dataset,
    drafts,
    grow,
    crop,
    wfo,
    taxref,
    cohort,
    growKey,
    cropKey,
    generatorOptions,
    options: {
      datasetDirectory: dataset,
      draftsDirectory: drafts,
      cohortPath: cohort,
      validationApi: api,
      sourceDirectories,
    },
  };
}

export async function authorReviewedIdentity(
  value: Awaited<ReturnType<typeof createIntegratedFixture>>,
) {
  const crosswalk = await fixtureRecord(
    "authoring-external-taxonomy-crosswalk-valid.json",
  );
  const name = await fixtureRecord("catalog-taxonomic-name-valid.json");
  const taxon = await fixtureRecord("catalog-taxon-valid.json");
  taxon.id = "taxon-tomato";
  taxon.scientificName = "Solanum lycopersicum";
  taxon.evidenceReferenceIds = ["evidence-wfo-tomato"];
  const evidence = await fixtureRecord("catalog-evidence-reference-valid.json");
  evidence.id = "evidence-wfo-tomato";
  evidence.sourceRecordKey = {
    source: {
      sourceId: "source_world_flora_online_plant_list",
      sourceManifestId: "source_manifest_wfo_plant_list_2026_06",
      sourceReleaseId: "2026-06",
    },
    recordId: "wfo-0000000010",
  };
  evidence.locator = crosswalk.locator;
  evidence.rights = {
    licenceId: "licence_cc0_1_0",
    decision: "eligible",
    reason: "Fixture rights review",
    reviewId: "review-rights",
  };
  const review = {
    id: "review-taxonomy-1",
    purpose: "content",
    status: "accepted",
    reviewedAt: "2026-10-02T00:00:00Z",
    reviewerId: "reviewer-fixture",
  };
  const decision = await fixtureRecord(
    "authoring-source-name-decision-valid.json",
  );
  const old: RecordValue = {
    ...decision,
    id: "name-decision-old",
    decision: "unresolved",
  };
  delete old.externalTaxonomyCrosswalkId;
  decision.supersedesDecisionId = old.id;
  const rows: Record<string, unknown[]> = {
    "taxa.jsonl": [taxon],
    "taxonomic-names.jsonl": [name],
    "evidence-references.jsonl": [evidence],
    "reviews.jsonl": [
      review,
      { ...review, id: "review-rights", purpose: "rights" },
    ],
    "external-taxonomy-crosswalks.jsonl": [crosswalk],
    "source-name-decisions.jsonl": [old, decision],
  };
  for (const [filename, values] of Object.entries(rows))
    await writeFile(
      join(value.dataset, filename),
      values.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  await generateIntegratedReviewPackets(value.generatorOptions);
  return crosswalk;
}
