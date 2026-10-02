import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { readJsonLines, writeJsonLines } from "../serialization/json-lines.js";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";
import { validate, type ValidationApi } from "../schema/validation-api.js";
import {
  qualifiedSourceRecordKey,
  serializeQualifiedSourceRecordKey,
} from "../domain/source-keys.js";
import { validateGrowWfoDataset } from "./grow-wfo-validation.js";
import { GROW_SOURCE_ID } from "../adapters/grow/constants.js";
import { CROPGRAPH_SOURCE_ID } from "../adapters/cropgraph/constants.js";
import { WFO_SOURCE_ID } from "../adapters/wfo/constants.js";
import { TAXREF_SOURCE_ID } from "../adapters/taxref/constants.js";
import {
  compareIntegratedPackets,
  type ComparisonPacket,
} from "./integrated-assertion-comparisons.js";

type RecordValue = Readonly<Record<string, unknown>>;
type MutableRecord = Record<string, unknown>;

const SOURCE_MANIFEST_SCHEMA = "urn:hortinis:plants:schema:v1:source-manifest";
const IMPORTER_RUN_SCHEMA =
  "urn:hortinis:plants:schema:v1:importer-run-manifest";
const RECONCILIATION_RUN_SCHEMA =
  "urn:hortinis:plants:schema:v1:taxonomy-reconciliation-manifest";
const DRAFT_SCHEMA = "urn:hortinis:plants:schema:curation:v1:draft-manifest";
const PACKET_SCHEMA =
  "urn:hortinis:plants:schema:curation:v1:integrated-review-packet";
const QUEUE_SCHEMA =
  "urn:hortinis:plants:schema:curation:v1:integrated-review-queue-item";
const SCOPE_SCHEMA =
  "urn:hortinis:plants:schema:curation:v1:integrated-review-scope";
const COMPARISON_SCHEMA =
  "urn:hortinis:plants:schema:curation:v1:assertion-comparison";

export interface IntegratedReviewPacketOptions {
  readonly repositoryRoot?: string;
  readonly growRunDirectory: string;
  readonly cropGraphRunDirectory: string;
  readonly wfoRunDirectory: string;
  readonly taxrefWfoRunDirectory: string;
  readonly outputDirectory: string;
  readonly datasetDirectory?: string;
  readonly sourceManifestPaths?: Partial<
    Readonly<Record<"grow" | "cropgraph" | "wfo" | "taxref", string>>
  >;
  readonly cohortPath?: string;
  /** An existing frozen scope must agree exactly; it cannot silently narrow inputs. */
  readonly scopePath?: string;
  readonly validationApi?: ValidationApi;
}

export interface IntegratedReviewPacketResult {
  readonly outputDirectory: string;
  readonly counts: readonly { readonly role: string; readonly count: number }[];
}

type SourceKind = "grow" | "cropgraph";

interface RunInput {
  readonly value: RecordValue;
  readonly bytes: Buffer;
  readonly directory: string;
  readonly manifestPath: string;
  readonly outputs: readonly OutputDescriptor[];
}

interface OutputDescriptor {
  role: string;
  path: string;
  sha256: string;
  byteSize: number;
  recordCount?: number;
  schemaId?: string;
  mediaType?: string;
}

interface ArtifactStats {
  readonly sha256: string;
  readonly byteSize: number;
  readonly recordCount?: number;
}

export async function generateIntegratedReviewPackets(
  options: IntegratedReviewPacketOptions,
): Promise<IntegratedReviewPacketResult> {
  const repositoryRoot = resolve(
    options.repositoryRoot ??
      resolve(fileURLToPath(new URL("../../", import.meta.url))),
  );
  const validationApi = options.validationApi ?? { validate };
  const outputDirectory = resolve(options.outputDirectory);
  const datasetDirectory = resolve(
    options.datasetDirectory ??
      join(repositoryRoot, "data/curation/grow-wfo-initial"),
  );
  const sourceManifestPaths = {
    grow: resolve(
      options.sourceManifestPaths?.grow ??
        join(repositoryRoot, "data/sources/grow/source-manifest.json"),
    ),
    cropgraph: resolve(
      options.sourceManifestPaths?.cropgraph ??
        join(repositoryRoot, "data/sources/cropgraph/source-manifest.json"),
    ),
    wfo: resolve(
      options.sourceManifestPaths?.wfo ??
        join(repositoryRoot, "data/sources/wfo/source-manifest.json"),
    ),
    taxref: resolve(
      options.sourceManifestPaths?.taxref ??
        join(repositoryRoot, "data/sources/taxref/source-manifest.json"),
    ),
  } as const;
  const cohortPath = resolve(
    options.cohortPath ??
      join(repositoryRoot, "data/sources/cropgraph/cohort.json"),
  );
  const protectedDirectories = [
    datasetDirectory,
    resolve(options.growRunDirectory),
    resolve(options.cropGraphRunDirectory),
    resolve(options.wfoRunDirectory),
    resolve(options.taxrefWfoRunDirectory),
    ...Object.values(sourceManifestPaths).map(dirname),
  ];
  const outputPhysicalPath = await physicalPath(outputDirectory);
  for (const directory of protectedDirectories) {
    const within = (parent: string, child: string) => {
      const suffix = relative(parent, child);
      return (
        suffix === "" ||
        (!suffix.startsWith("../") && suffix !== ".." && !isAbsolute(suffix))
      );
    };
    const inputPhysicalPath = await physicalPath(directory);
    if (
      within(inputPhysicalPath, outputPhysicalPath) ||
      within(outputPhysicalPath, inputPhysicalPath)
    )
      throw new Error(
        `Generated output overlaps protected input directory ${directory}`,
      );
  }
  const cohortSuffix = relative(
    outputPhysicalPath,
    await physicalPath(cohortPath),
  );
  if (
    cohortSuffix === "" ||
    (cohortSuffix !== ".." &&
      !cohortSuffix.startsWith("../") &&
      !isAbsolute(cohortSuffix))
  )
    throw new Error("Generated output overlaps the cohort input");

  const datasetResult = await validateGrowWfoDataset({
    repositoryRoot,
    datasetDirectory,
    validationApi,
  });
  if (!datasetResult.valid || datasetResult.loaded === undefined)
    throw new Error(
      `Curation dataset is not valid for integrated packets: ${datasetResult.issues
        .slice(0, 5)
        .map((issue) => issue.message)
        .join("; ")}`,
    );

  const growRun = await readRun(
    resolve(options.growRunDirectory),
    "importer-run-manifest.json",
    IMPORTER_RUN_SCHEMA,
    validationApi,
  );
  const cropGraphRun = await readRun(
    resolve(options.cropGraphRunDirectory),
    "importer-run-manifest.json",
    IMPORTER_RUN_SCHEMA,
    validationApi,
  );
  const wfoRun = await readRun(
    resolve(options.wfoRunDirectory),
    "reconciliation-run-manifest.json",
    RECONCILIATION_RUN_SCHEMA,
    validationApi,
  );
  const taxrefWfoRun = await readRun(
    resolve(options.taxrefWfoRunDirectory),
    "reconciliation-run-manifest.json",
    RECONCILIATION_RUN_SCHEMA,
    validationApi,
  );

  const sourceManifests = await readSourceManifests(
    sourceManifestPaths,
    validationApi,
  );
  await assertRunSource(
    growRun.value,
    sourceManifests.grow,
    sourceManifestPaths.grow,
    "GROW",
  );
  await assertRunSource(
    cropGraphRun.value,
    sourceManifests.cropgraph,
    sourceManifestPaths.cropgraph,
    "CropGraph",
  );
  await assertRunInputs(
    wfoRun.value,
    sourceManifests,
    sourceManifestPaths,
    "WFO reconciliation",
  );
  await assertRunInputs(
    taxrefWfoRun.value,
    sourceManifests,
    sourceManifestPaths,
    "TAXREF localization",
  );
  const cohort = await readJsonObject(cohortPath);
  const cohortBytes = await readFile(cohortPath);
  const cropConfiguration = asRecord(cropGraphRun.value.configuration);
  const declaredCohortSha256 = stringField(cropConfiguration, "cohortSha256");
  if (
    declaredCohortSha256 !== undefined &&
    declaredCohortSha256 !== sha256(cohortBytes)
  )
    throw new Error(
      "CropGraph run references a different cohort configuration",
    );
  const datasetManifestPath = join(datasetDirectory, "dataset-manifest.json");
  const datasetManifestBytes = await readFile(datasetManifestPath);
  const datasetManifest = parseObject(
    datasetManifestBytes,
    datasetManifestPath,
  );
  assertSchema(
    validationApi,
    "urn:hortinis:plants:schema:authoring:v1:curation-dataset-manifest",
    datasetManifest,
    datasetManifestPath,
  );

  const growRecords = await readOutputRecords(
    growRun,
    "source-records.jsonl",
    validationApi,
  );
  const growCandidates = await readOutputRecords(
    growRun,
    "candidates.jsonl",
    validationApi,
  );
  const cropRecords = await readOutputRecords(
    cropGraphRun,
    "selected-records.jsonl",
    validationApi,
  );
  const included = arrayField(cohort, "include");
  const selectedIds = cropRecords.map(
    (record) => qualifiedSourceRecordKey(record)?.recordId,
  );
  if (
    included.some((id) => typeof id !== "string") ||
    new Set(included).size !== included.length ||
    cohort.sourceReleaseId !==
      asRecord(sourceManifests.cropgraph.release)?.identifier ||
    JSON.stringify([...included].sort()) !==
      JSON.stringify([...selectedIds].sort())
  )
    throw new Error(
      "Selected CropGraph records differ from the explicit cohort",
    );
  const cropIdentityCandidates = await readOutputRecords(
    cropGraphRun,
    "identity-candidates.jsonl",
    validationApi,
  );
  const cropCultivationCandidates = await readOutputRecords(
    cropGraphRun,
    "cultivation-candidates.jsonl",
    validationApi,
  );
  const taxonomyCandidates = await readOutputRecords(
    wfoRun,
    "taxon-match-candidates.jsonl",
    validationApi,
  );
  const taxrefOutcomes = await readOutputRecords(
    taxrefWfoRun,
    "link-outcomes.jsonl",
    validationApi,
  );
  const localizationProposals = await readOutputRecords(
    taxrefWfoRun,
    "localization-proposals.jsonl",
    validationApi,
  );

  const growRecordMap = indexBySourceRecordKey(
    growRecords,
    "GROW source records",
  );
  const cropRecordMap = indexBySourceRecordKey(
    cropRecords,
    "CropGraph selected records",
  );
  const growCandidateMap = groupBySourceRecordKey(
    growCandidates,
    "GROW candidates",
  );
  const cropIdentityMap = groupBySourceRecordKey(
    cropIdentityCandidates,
    "CropGraph identity candidates",
  );
  const cropCultivationMap = groupBySourceRecordKey(
    cropCultivationCandidates,
    "CropGraph cultivation candidates",
  );
  const taxonomyMap = groupBySourceRecordKey(
    taxonomyCandidates,
    "WFO taxonomy candidates",
  );
  const outcomesByWfoIdentifier = groupByString(taxrefOutcomes, (record) =>
    stringField(record, "wfoIdentifier"),
  );
  const proposalsByTaxon = groupByString(localizationProposals, (record) =>
    stringField(record, "taxonId"),
  );

  assertCandidateKeys(growRecordMap, growCandidateMap, "GROW");
  assertCandidateKeys(cropRecordMap, cropIdentityMap, "CropGraph identity");
  assertCandidateKeys(
    cropRecordMap,
    cropCultivationMap,
    "CropGraph cultivation",
  );
  assertTaxonomyCoverage(growRecordMap, cropRecordMap, taxonomyMap);

  const authored = authoredIndexes(datasetResult.loaded.dataset);
  const packets: MutableRecord[] = [];
  const queue: MutableRecord[] = [];
  const allSources: readonly [SourceKind, Map<string, RecordValue>][] = [
    ["grow", growRecordMap],
    ["cropgraph", cropRecordMap],
  ];
  for (const [sourceKind, records] of allSources) {
    for (const [key, sourceRecord] of records) {
      const sourceRecordKey = qualifiedSourceRecordKey(sourceRecord);
      if (sourceRecordKey === undefined)
        throw new Error(
          `${sourceKind} source record has no qualified source key`,
        );
      const taxonomy = taxonomyMap.get(key) ?? [];
      const identities =
        sourceKind === "grow" ? [] : (cropIdentityMap.get(key) ?? []);
      const cultivation =
        sourceKind === "grow"
          ? (growCandidateMap.get(key) ?? [])
          : (cropCultivationMap.get(key) ?? []);
      const wfoIdentifiers = taxonomy.flatMap(wfoIdentifiersFromCandidate);
      const outcomes = uniqueRecords(
        wfoIdentifiers.flatMap(
          (identifier) => outcomesByWfoIdentifier.get(identifier) ?? [],
        ),
      );
      const taxonIds = new Set(
        outcomes
          .map((record) => stringField(record, "taxonId"))
          .filter((value): value is string => value !== undefined),
      );
      const proposals = uniqueRecords(
        [...taxonIds].flatMap((taxonId) => proposalsByTaxon.get(taxonId) ?? []),
      );
      const authoredDecisions = collectAuthoredDecisions(
        authored,
        key,
        wfoIdentifiers,
        outcomes,
        proposals,
        [...identities, ...cultivation].map((candidate) =>
          requiredString(candidate, "id"),
        ),
      );
      const rightsEvidence = rightsForSource(sourceKind, sourceManifests, [
        ...identities,
        ...cultivation,
      ]);
      const packetId = `review-packet-${sha256(
        Buffer.from(`${sourceKind}\u0000${key}`),
      ).slice(0, 32)}`;
      const queueMembership = reviewKinds(
        taxonomy,
        outcomes,
        identities,
        cultivation,
        sourceKind,
      );
      const packetWithoutDigest: MutableRecord = {
        id: packetId,
        packetVersion: "1.0.0",
        reviewState: "unreviewed",
        grouping: "qualified-source-record-v1",
        sourceKind,
        sourceRecordKey,
        sourceRecord,
        identityCandidates: identities,
        cultivationCandidates: cultivation,
        taxonomyOutcomes: taxonomy,
        localizationOutcomes: outcomes,
        localizationProposals: proposals,
        authoredDecisions,
        rightsEvidence,
        queueMembership,
        comparisonIds: [],
        dependencies: packetDependencies(
          growRun,
          cropGraphRun,
          wfoRun,
          taxrefWfoRun,
          datasetManifestBytes,
        ),
      };
      packets.push(packetWithoutDigest);
      const taxonomyOutcomes = uniqueStrings(
        taxonomy
          .map((record) => stringField(record, "outcome"))
          .filter((value): value is string => value !== undefined),
      );
      queue.push({
        id: `review-queue-${sha256(Buffer.from(packetId)).slice(0, 32)}`,
        packetId,
        reviewState: "unreviewed",
        sourceKind,
        sourceRecordKey,
        reviewKinds: queueMembership,
        candidateCounts: {
          identity: identities.length,
          cultivation: cultivation.length,
          taxonomy: taxonomy.length,
          localization: proposals.length,
          comparison: 0,
        },
        taxonomyOutcomes,
        rightsStatus:
          stringField(rightsEvidence, "commercialDecision") ?? "unknown",
      });
    }
  }
  const { comparisons, idsByPacket } = compareIntegratedPackets(
    packets as unknown as ComparisonPacket[],
  );
  for (const packet of packets) {
    const packetId = requiredString(packet, "id");
    const comparisonIds = idsByPacket.get(packetId) ?? [];
    packet.comparisonIds = comparisonIds;
    const comparisonDecisions = sortedRecords(
      (authored.assertionComparisonDecisions ?? []).filter((record) =>
        comparisonIds.includes(stringField(record, "comparisonId") ?? ""),
      ),
    );
    if (comparisonDecisions.length > 0)
      packet.authoredDecisions = {
        ...(asRecord(packet.authoredDecisions) ?? {}),
        assertionComparisonDecisions: comparisonDecisions,
      };
    if (comparisonIds.length > 0)
      packet.queueMembership = uniqueStrings([
        ...arrayField(packet, "queueMembership").map(String),
        "comparison",
      ]);
    packet.contentSha256 = sha256(serializeCanonicalJson(packet));
    assertSchema(validationApi, PACKET_SCHEMA, packet, packetId);
  }
  for (const item of queue) {
    const packetId = requiredString(item, "packetId");
    const comparisonCount = (idsByPacket.get(packetId) ?? []).length;
    const counts = asRecord(item.candidateCounts);
    if (counts === undefined) throw new Error("Queue has no candidate counts");
    item.candidateCounts = { ...counts, comparison: comparisonCount };
    if (comparisonCount > 0)
      item.reviewKinds = uniqueStrings([
        ...arrayField(item, "reviewKinds").map(String),
        "comparison",
      ]);
    assertSchema(validationApi, QUEUE_SCHEMA, item, requiredString(item, "id"));
  }
  packets.sort((left, right) =>
    compareStrings(requiredString(left, "id"), requiredString(right, "id")),
  );
  queue.sort((left, right) =>
    compareStrings(requiredString(left, "id"), requiredString(right, "id")),
  );

  const inputDescriptors = await buildInputDescriptors(
    [
      ["grow-importer-run-manifest", growRun],
      ["cropgraph-importer-run-manifest", cropGraphRun],
      ["wfo-reconciliation-run-manifest", wfoRun],
      ["taxref-wfo-reconciliation-run-manifest", taxrefWfoRun],
    ],
    sourceManifests,
    sourceManifestPaths,
    datasetManifestPath,
    datasetManifestBytes,
    repositoryRoot,
    cohortPath,
    cohortBytes,
  );
  const scope = {
    schemaVersion: "1.0.0",
    reviewState: "unreviewed",
    policy: "qualified-source-record-v1",
    sources: [
      sourceDescriptor("grow", sourceManifests.grow),
      sourceDescriptor("cropgraph", sourceManifests.cropgraph),
      sourceDescriptor("wfo", sourceManifests.wfo),
      sourceDescriptor("taxref", sourceManifests.taxref),
    ],
    fingerprints: [
      ...inputDescriptors.map((input) => ({
        role: input.role,
        sha256: input.sha256,
        byteSize: input.byteSize,
        ...(input.recordCount === undefined
          ? {}
          : { recordCount: input.recordCount }),
      })),
    ].sort((left, right) =>
      compareStrings(String(left.role), String(right.role)),
    ),
    counts: [
      { role: "grow-source-records", count: growRecords.length },
      { role: "cropgraph-selected-records", count: cropRecords.length },
      { role: "integrated-packets", count: packets.length },
      { role: "integrated-queue-items", count: queue.length },
      { role: "assertion-comparisons", count: comparisons.length },
      { role: "taxonomy-outcomes", count: taxonomyCandidates.length },
      { role: "localization-proposals", count: localizationProposals.length },
    ].sort((left, right) => compareStrings(left.role, right.role)),
  };
  assertSchema(validationApi, SCOPE_SCHEMA, scope, "integrated review scope");
  if (options.scopePath !== undefined) {
    const expectedScope = await readJsonObject(resolve(options.scopePath));
    if (
      sha256(serializeCanonicalJson(expectedScope)) !==
      sha256(serializeCanonicalJson(scope))
    )
      throw new Error(
        "Explicit frozen scope differs from the generated review scope",
      );
  }

  const parent = dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, ".integrated-review-"));
  try {
    const packetStats = await writeJsonlArtifact(
      join(staging, "integrated-review-packets.jsonl"),
      packets,
      PACKET_SCHEMA,
      validationApi,
    );
    const queueStats = await writeJsonlArtifact(
      join(staging, "integrated-review-queue.jsonl"),
      queue,
      QUEUE_SCHEMA,
      validationApi,
    );
    const comparisonStats = await writeJsonlArtifact(
      join(staging, "assertion-comparisons.jsonl"),
      comparisons,
      COMPARISON_SCHEMA,
      validationApi,
    );
    const scopeBytes = Buffer.concat([
      Buffer.from(serializeCanonicalJson(scope)),
      Buffer.from("\n"),
    ]);
    await writeFile(join(staging, "review-scope.json"), scopeBytes, {
      flag: "wx",
    });
    const scopeStats = {
      sha256: sha256(scopeBytes),
      byteSize: scopeBytes.byteLength,
      recordCount: 1,
    };
    const draft = {
      schemaVersion: "1.0.0",
      kind: "integrated-review-drafts",
      reviewState: "unreviewed",
      inputs: inputDescriptors,
      scopes: [
        artifact(
          "integrated-review-scope",
          "review-scope.json",
          SCOPE_SCHEMA,
          scopeStats,
        ),
      ],
      queues: [
        artifact(
          "integrated-review-queue",
          "integrated-review-queue.jsonl",
          QUEUE_SCHEMA,
          queueStats,
        ),
      ],
      packets: [
        artifact(
          "integrated-review-packets",
          "integrated-review-packets.jsonl",
          PACKET_SCHEMA,
          packetStats,
        ),
      ],
      outputs: [
        artifact(
          "assertion-comparisons",
          "assertion-comparisons.jsonl",
          COMPARISON_SCHEMA,
          comparisonStats,
        ),
      ],
      counts: scope.counts,
    };
    assertSchema(
      validationApi,
      DRAFT_SCHEMA,
      draft,
      "integrated draft manifest",
    );
    await writeFile(
      join(staging, "draft-manifest.json"),
      Buffer.concat([
        Buffer.from(serializeCanonicalJson(draft)),
        Buffer.from("\n"),
      ]),
      { flag: "wx" },
    );
    await publishDirectory(staging, outputDirectory);
    return { outputDirectory, counts: scope.counts };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!isMissingFile(error) || dirname(path) === path) throw error;
    return join(await physicalPath(dirname(path)), basename(path));
  }
}

async function readRun(
  directory: string,
  filename: string,
  schemaId: string,
  validationApi: ValidationApi,
): Promise<RunInput> {
  const manifestPath = join(directory, filename);
  const bytes = await readFile(manifestPath);
  const value = parseObject(bytes, manifestPath);
  assertSchema(validationApi, schemaId, value, manifestPath);
  assertConfigurationDigest(value, manifestPath);
  const outputs = await verifyOutputs(value, directory, validationApi);
  return { value, bytes, directory, manifestPath, outputs };
}

async function readSourceManifests(
  paths: Readonly<Record<"grow" | "cropgraph" | "wfo" | "taxref", string>>,
  validationApi: ValidationApi,
): Promise<
  Readonly<Record<"grow" | "cropgraph" | "wfo" | "taxref", RecordValue>>
> {
  const result: Partial<
    Record<"grow" | "cropgraph" | "wfo" | "taxref", RecordValue>
  > = {};
  for (const kind of ["grow", "cropgraph", "wfo", "taxref"] as const) {
    const path = paths[kind];
    const value = parseObject(await readFile(path), path);
    assertSchema(validationApi, SOURCE_MANIFEST_SCHEMA, value, path);
    result[kind] = value;
  }
  return result as Readonly<
    Record<"grow" | "cropgraph" | "wfo" | "taxref", RecordValue>
  >;
}

async function readOutputRecords(
  run: RunInput,
  path: string,
  validationApi: ValidationApi,
): Promise<RecordValue[]> {
  const output = run.outputs.find((item) => item.path === path);
  if (output === undefined)
    throw new Error(`Run ${run.manifestPath} does not declare ${path}`);
  const records: RecordValue[] = [];
  for await (const entry of readJsonLines(
    createReadStream(join(run.directory, output.path)),
    {
      ...(output.schemaId === undefined
        ? {}
        : { schemaId: output.schemaId, validationApi }),
    },
  )) {
    const record = asRecord(entry.value);
    if (record === undefined)
      throw new Error(`${path} contains a non-object record`);
    records.push(record);
  }
  return records;
}

async function verifyOutputs(
  manifest: RecordValue,
  directory: string,
  validationApi: ValidationApi,
): Promise<OutputDescriptor[]> {
  const raw = arrayField(manifest, "outputs");
  const seenPaths = new Set<string>();
  const outputs: OutputDescriptor[] = [];
  for (const value of raw) {
    const output = asRecord(value);
    if (output === undefined)
      throw new Error("Run manifest contains a malformed output");
    const role = requiredString(output, "role");
    const path = requiredString(output, "path");
    if (!isSafeRelativePath(path))
      throw new Error(`Run output path is unsafe: ${path}`);
    if (seenPaths.has(path))
      throw new Error(`Run manifest repeats output path ${path}`);
    seenPaths.add(path);
    const actual = await fileStats(
      join(directory, path),
      true,
      validationApi,
      stringField(output, "schemaId"),
    );
    if (
      actual.sha256 !== requiredString(output, "sha256") ||
      actual.byteSize !== numberField(output, "byteSize")
    )
      throw new Error(`Run output ${path} checksum or size mismatch`);
    if (
      output.recordCount !== undefined &&
      actual.recordCount !== numberField(output, "recordCount")
    )
      throw new Error(`Run output ${path} record count mismatch`);
    const descriptor: OutputDescriptor = {
      role,
      path,
      sha256: actual.sha256,
      byteSize: actual.byteSize,
    };
    if (actual.recordCount !== undefined)
      descriptor.recordCount = actual.recordCount;
    const schemaId = stringField(output, "schemaId");
    if (schemaId !== undefined) descriptor.schemaId = schemaId;
    const mediaType = stringField(output, "mediaType");
    if (mediaType !== undefined) descriptor.mediaType = mediaType;
    outputs.push(descriptor);
  }
  return outputs;
}

async function fileStats(
  path: string,
  countJsonl: boolean,
  validationApi: ValidationApi,
  schemaId: string | undefined,
): Promise<ArtifactStats> {
  const hash = createHash("sha256");
  let byteSize = 0;
  let recordCount = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    byteSize += (chunk as Buffer).byteLength;
  }
  if (countJsonl) {
    for await (const entry of readJsonLines(createReadStream(path), {
      ...(schemaId === undefined ? {} : { schemaId, validationApi }),
    })) {
      if (entry.value !== undefined) recordCount += 1;
    }
  }
  return {
    sha256: hash.digest("hex"),
    byteSize,
    ...(countJsonl ? { recordCount } : {}),
  };
}

async function writeJsonlArtifact(
  path: string,
  records: readonly unknown[],
  schemaId: string,
  validationApi: ValidationApi,
): Promise<ArtifactStats> {
  const hash = createHash("sha256");
  let byteSize = 0;
  let recordCount = 0;
  const stream = async function* (): AsyncGenerator<Uint8Array> {
    for await (const bytes of writeJsonLines(records, {
      schemaId,
      validationApi,
    })) {
      hash.update(bytes);
      byteSize += bytes.byteLength;
      recordCount += 1;
      yield bytes;
    }
  };
  await pipeline(
    Readable.from(stream()),
    createWriteStream(path, { flags: "wx" }),
  );
  return { sha256: hash.digest("hex"), byteSize, recordCount };
}

async function buildInputDescriptors(
  runs: readonly (readonly [string, RunInput])[],
  sourceManifests: Readonly<
    Record<"grow" | "cropgraph" | "wfo" | "taxref", RecordValue>
  >,
  sourceManifestPaths: Readonly<
    Record<"grow" | "cropgraph" | "wfo" | "taxref", string>
  >,
  datasetManifestPath: string,
  datasetManifestBytes: Buffer,
  root: string,
  cohortPath: string,
  cohortBytes: Buffer,
): Promise<RecordValue[]> {
  const descriptors: RecordValue[] = [];
  for (const [role, run] of runs) {
    descriptors.push({
      role,
      locator: stableLocator(run.manifestPath, root),
      schemaId:
        run.value.job === undefined
          ? IMPORTER_RUN_SCHEMA
          : RECONCILIATION_RUN_SCHEMA,
      sha256: sha256(run.bytes),
      byteSize: run.bytes.byteLength,
      ...(stringField(run.value, "configurationSha256") === undefined
        ? {}
        : {
            configurationSha256: stringField(run.value, "configurationSha256"),
          }),
    });
    for (const output of run.outputs) {
      descriptors.push({
        role: `${role}-${output.role}-${sha256(Buffer.from(output.path)).slice(0, 12)}`,
        locator: `${role}:${output.path}`,
        ...(output.schemaId === undefined ? {} : { schemaId: output.schemaId }),
        sha256: output.sha256,
        byteSize: output.byteSize,
        ...(output.recordCount === undefined
          ? {}
          : { recordCount: output.recordCount }),
      });
    }
  }
  for (const [kind, manifest] of Object.entries(sourceManifests)) {
    const path = sourceManifestPaths[kind as keyof typeof sourceManifestPaths];
    const bytes = await readFile(path);
    descriptors.push({
      role: `source-manifest-${kind}`,
      id: requiredString(manifest, "id"),
      locator: stableLocator(path, root),
      schemaId: SOURCE_MANIFEST_SCHEMA,
      sha256: sha256(bytes),
      byteSize: bytes.byteLength,
    });
  }
  descriptors.push({
    role: "cropgraph-cohort",
    locator: stableLocator(cohortPath, root),
    sha256: sha256(cohortBytes),
    byteSize: cohortBytes.byteLength,
  });
  descriptors.push({
    role: "authoring-dataset-manifest",
    locator: stableLocator(datasetManifestPath, root),
    schemaId:
      "urn:hortinis:plants:schema:authoring:v1:curation-dataset-manifest",
    sha256: sha256(datasetManifestBytes),
    byteSize: datasetManifestBytes.byteLength,
  });
  const datasetManifest = parseObject(
    datasetManifestBytes,
    datasetManifestPath,
  );
  for (const value of arrayField(datasetManifest, "collections")) {
    const collection = asRecord(value);
    if (collection === undefined) continue;
    const role = requiredString(collection, "role");
    const path = join(
      dirname(datasetManifestPath),
      requiredString(collection, "path"),
    );
    const bytes = await readFile(path);
    descriptors.push({
      role: `authoring-collection-${role}`,
      locator: stableLocator(path, root),
      schemaId: requiredString(collection, "schemaId"),
      sha256: sha256(bytes),
      byteSize: bytes.byteLength,
    });
  }
  const seen = new Set<string>();
  for (const descriptor of descriptors) {
    const role = requiredString(descriptor, "role");
    if (seen.has(role))
      throw new Error(`Integrated draft repeats input role ${role}`);
    seen.add(role);
  }
  return descriptors.sort((left, right) =>
    compareStrings(requiredString(left, "role"), requiredString(right, "role")),
  );
}

function sourceDescriptor(
  kind: "grow" | "cropgraph" | "wfo" | "taxref",
  manifest: RecordValue,
): RecordValue {
  const release = asRecord(manifest.release);
  const sourceIds = {
    grow: GROW_SOURCE_ID,
    cropgraph: CROPGRAPH_SOURCE_ID,
    wfo: WFO_SOURCE_ID,
    taxref: TAXREF_SOURCE_ID,
  } as const;
  return {
    kind,
    sourceId: sourceIds[kind],
    sourceManifestId: requiredString(manifest, "id"),
    sourceReleaseId: requiredString(release, "identifier"),
    ...(manifest.licenceReview === undefined
      ? {}
      : { rights: manifest.licenceReview }),
  };
}

async function assertRunSource(
  run: RecordValue,
  manifest: RecordValue,
  manifestPath: string,
  label: string,
): Promise<void> {
  const reference = asRecord(run.sourceManifest);
  if (reference === undefined) return;
  if (
    stringField(reference, "id") !== requiredString(manifest, "id") ||
    stringField(reference, "sha256") !== sha256(await readFile(manifestPath))
  )
    throw new Error(`${label} run references a different source manifest`);
}

async function assertRunInputs(
  run: RecordValue,
  manifests: Readonly<
    Record<"grow" | "cropgraph" | "wfo" | "taxref", RecordValue>
  >,
  paths: Readonly<Record<"grow" | "cropgraph" | "wfo" | "taxref", string>>,
  label: string,
): Promise<void> {
  const inputs = arrayField(run, "inputs")
    .map(asRecord)
    .filter((value): value is RecordValue => value !== undefined);
  for (const [kind, manifest] of Object.entries(manifests)) {
    const id = requiredString(manifest, "id");
    const expected = sha256(await readFile(paths[kind as keyof typeof paths]));
    const input = inputs.find((candidate) => {
      const candidateId = stringField(candidate, "id");
      const role = stringField(candidate, "role") ?? "";
      const locator = stringField(candidate, "locator") ?? "";
      return (
        candidateId === id ||
        role === `${kind}-source-manifest` ||
        locator.endsWith(`data/sources/${kind}/source-manifest.json`)
      );
    });
    if (input !== undefined && stringField(input, "sha256") !== expected)
      throw new Error(
        `${label} run references a changed ${kind} source manifest`,
      );
  }
}

function authoredIndexes(
  dataset: unknown,
): Readonly<Record<string, readonly RecordValue[]>> {
  return dataset as Readonly<Record<string, readonly RecordValue[]>>;
}

export function collectAuthoredDecisions(
  datasetValue: unknown,
  sourceKey: string,
  wfoIdentifiers: readonly string[],
  outcomes: readonly RecordValue[],
  proposals: readonly RecordValue[],
  candidateIds: readonly string[],
): MutableRecord {
  const dataset = authoredIndexes(datasetValue);
  const result: MutableRecord = {};
  const sourceCollections = [
    "packetDecisions",
    "sourceNameDecisions",
    "sourceSubjectMappings",
    "sourceGeographyDecisions",
    "sourceAssertionDecisions",
    "assertions",
    "evidence",
    "curationIssues",
  ];
  for (const collection of sourceCollections) {
    const records = sortedRecords(
      (dataset[collection] ?? []).filter(
        (record) =>
          serializeRecordKey(record) === sourceKey ||
          (collection === "packetDecisions" &&
            serializeRecordKey(asRecord(record.source) ?? {}) === sourceKey) ||
          (collection === "sourceAssertionDecisions" &&
            candidateIds.includes(
              stringField(record, "sourceCandidateId") ?? "",
            )),
      ),
    );
    if (records.length > 0) result[collection] = records;
  }
  const relevantCrosswalks = sortedRecords(
    (dataset.externalTaxonomyCrosswalks ?? []).filter((record) =>
      wfoIdentifiers.includes(
        stringField(asRecord(record.externalIdentifier), "identifier") ?? "",
      ),
    ),
  );
  if (relevantCrosswalks.length > 0)
    result.externalTaxonomyCrosswalks = relevantCrosswalks;
  const relevantReviews = sortedRecords(
    (dataset.reviews ?? []).filter((review) => {
      const id = stringField(review, "id");
      return (
        relevantCrosswalks.some(
          (record) => stringField(record, "reviewId") === id,
        ) ||
        outcomes.some((record) => stringField(record, "wfoReviewId") === id)
      );
    }),
  );
  if (relevantReviews.length > 0) result.reviews = relevantReviews;
  if (proposals.length > 0) {
    const taxonIds = new Set(
      proposals
        .map((record) => stringField(record, "taxonId"))
        .filter((value): value is string => value !== undefined),
    );
    const taxa = sortedRecords(
      (dataset.taxa ?? []).filter((record) =>
        taxonIds.has(requiredString(record, "id")),
      ),
    );
    if (taxa.length > 0) result.taxa = taxa;
    const localized = sortedRecords(
      (dataset.localizedNames ?? []).filter((record) =>
        taxonIds.has(stringField(asRecord(record.subject), "id") ?? ""),
      ),
    );
    if (localized.length > 0) result.localizedNames = localized;
  }
  return result;
}

export function rightsForSource(
  sourceKind: SourceKind,
  manifests: Readonly<
    Record<"grow" | "cropgraph" | "wfo" | "taxref", RecordValue>
  >,
  candidates: readonly RecordValue[],
): MutableRecord {
  const manifest = manifests[sourceKind];
  const licence = asRecord(manifest.licenceReview);
  const profile = arrayField(manifest, "profileEligibility").find(
    (value) => stringField(asRecord(value), "profile") === "commercial",
  );
  const profileRecord = asRecord(profile);
  const decisions = uniqueStrings(
    candidates
      .map((candidate) => stringField(candidate, "commercialRights"))
      .filter((value): value is string => value !== undefined),
  );
  const profileEligibility = arrayField(manifest, "profileEligibility")
    .map(asRecord)
    .filter((value): value is RecordValue => value !== undefined)
    .sort((left, right) =>
      compareStrings(
        stringField(left, "profile") ?? "",
        stringField(right, "profile") ?? "",
      ),
    );
  return {
    sourceManifestId: requiredString(manifest, "id"),
    declaredLicence: stringField(licence, "declaredLicence") ?? "unknown",
    licenceReviewStatus: stringField(licence, "status") ?? "unknown",
    commercialDecision: stringField(profileRecord, "decision") ?? "unknown",
    candidateCommercialRights: decisions,
    ...(licence === undefined ? {} : { licenceEvidence: licence }),
    profileEligibility,
    ...(profileRecord === undefined
      ? {}
      : { commercialProfile: profileRecord }),
  };
}

function reviewKinds(
  taxonomy: readonly RecordValue[],
  outcomes: readonly RecordValue[],
  identities: readonly RecordValue[],
  cultivation: readonly RecordValue[],
  sourceKind: SourceKind,
): string[] {
  const kinds = ["identity", "subject"];
  if (outcomes.length > 0 || taxonomy.length === 0) kinds.push("localization");
  if (cultivation.length > 0) kinds.push("cultivation");
  kinds.push("rights");
  if (
    taxonomy.length === 0 ||
    taxonomy.some(
      (record) =>
        !["candidate-accepted", "candidate-synonym"].includes(
          stringField(record, "outcome") ?? "",
        ),
    ) ||
    (sourceKind === "cropgraph" && identities.length === 0)
  )
    kinds.push("issue");
  return uniqueStrings(kinds);
}

function packetDependencies(
  growRun: RunInput,
  cropRun: RunInput,
  wfoRun: RunInput,
  taxrefRun: RunInput,
  datasetManifestBytes: Buffer,
): RecordValue[] {
  const roles: readonly (readonly [SourceKind, RunInput, string])[] = [
    ["grow", growRun, "source-records.jsonl"],
    ["grow", growRun, "candidates.jsonl"],
    ["cropgraph", cropRun, "selected-records.jsonl"],
    ["cropgraph", cropRun, "identity-candidates.jsonl"],
    ["cropgraph", cropRun, "cultivation-candidates.jsonl"],
  ];
  const dependencies: RecordValue[] = roles.map(([kind, run, path]) => {
    const output = run.outputs.find((item) => item.path === path);
    if (output === undefined)
      throw new Error(`Missing packet dependency ${path}`);
    return {
      role: `${kind}-${path.replaceAll(".jsonl", "")}`,
      sha256: output.sha256,
      ...(output.recordCount === undefined
        ? {}
        : { recordCount: output.recordCount }),
    };
  });
  for (const [prefix, run] of [
    ["wfo", wfoRun],
    ["taxref", taxrefRun],
  ] as const)
    dependencies.push({
      role: `${prefix}-run-manifest`,
      sha256: sha256(run.bytes),
    });
  dependencies.push({
    role: "authoring-dataset-manifest",
    sha256: sha256(datasetManifestBytes),
  });
  return dependencies.sort((left, right) =>
    compareStrings(requiredString(left, "role"), requiredString(right, "role")),
  );
}

function indexBySourceRecordKey(
  records: readonly RecordValue[],
  label: string,
): Map<string, RecordValue> {
  const map = new Map<string, RecordValue>();
  for (const record of records) {
    const key = serializeRecordKey(record);
    if (key === undefined)
      throw new Error(
        `${label} contains a record without a qualified source key`,
      );
    if (map.has(key)) throw new Error(`${label} repeats source record ${key}`);
    map.set(key, record);
  }
  return map;
}

function groupBySourceRecordKey(
  records: readonly RecordValue[],
  label: string,
): Map<string, RecordValue[]> {
  const map = new Map<string, RecordValue[]>();
  for (const record of records) {
    const key = serializeRecordKey(record);
    if (key === undefined)
      throw new Error(
        `${label} contains a record without a qualified source key`,
      );
    const values = map.get(key) ?? [];
    values.push(record);
    map.set(key, values);
  }
  for (const values of map.values())
    values.sort((left, right) =>
      compareStrings(recordId(left), recordId(right)),
    );
  return map;
}

function groupByString(
  records: readonly RecordValue[],
  getter: (record: RecordValue) => string | undefined,
): Map<string, RecordValue[]> {
  const map = new Map<string, RecordValue[]>();
  for (const record of records) {
    const key = getter(record);
    if (key === undefined) continue;
    const values = map.get(key) ?? [];
    values.push(record);
    map.set(key, values);
  }
  return map;
}

function assertCandidateKeys(
  records: ReadonlyMap<string, RecordValue>,
  candidates: ReadonlyMap<string, readonly RecordValue[]>,
  label: string,
): void {
  for (const key of candidates.keys())
    if (!records.has(key))
      throw new Error(
        `${label} candidate references unknown source record ${key}`,
      );
}

function assertTaxonomyCoverage(
  growRecords: ReadonlyMap<string, RecordValue>,
  cropRecords: ReadonlyMap<string, RecordValue>,
  taxonomy: ReadonlyMap<string, readonly RecordValue[]>,
): void {
  const expected = new Set([...growRecords.keys(), ...cropRecords.keys()]);
  for (const key of expected)
    if (!taxonomy.has(key))
      throw new Error(`WFO reconciliation has no candidate for ${key}`);
  for (const key of taxonomy.keys())
    if (!expected.has(key))
      throw new Error(`WFO reconciliation has an unknown source record ${key}`);
}

export function wfoIdentifiersFromCandidate(candidate: RecordValue): string[] {
  const alternatives = arrayField(candidate, "alternatives");
  const values: string[] = [];
  for (const value of alternatives) {
    const alternative = asRecord(value);
    const identifier = stringField(
      asRecord(alternative?.externalIdentifier),
      "identifier",
    );
    if (identifier !== undefined) values.push(identifier);
    const accepted = asRecord(alternative?.acceptedName);
    const acceptedIdentifier = stringField(
      asRecord(accepted?.externalIdentifier),
      "identifier",
    );
    if (acceptedIdentifier !== undefined) values.push(acceptedIdentifier);
  }
  return uniqueStrings(values);
}

function uniqueRecords(records: readonly RecordValue[]): RecordValue[] {
  const map = new Map<string, RecordValue>();
  for (const record of records)
    map.set(recordId(record) || sha256(serializeCanonicalJson(record)), record);
  return [...map.values()].sort((left, right) =>
    compareStrings(recordId(left), recordId(right)),
  );
}

function sortedRecords(records: readonly RecordValue[]): RecordValue[] {
  return [...records].sort((left, right) =>
    compareStrings(recordId(left), recordId(right)),
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function serializeRecordKey(record: RecordValue): string | undefined {
  const key =
    qualifiedSourceRecordKey(record) ??
    qualifiedSourceRecordKey(asRecord(record.source));
  return key === undefined ? undefined : serializeQualifiedSourceRecordKey(key);
}

function artifact(
  role: string,
  path: string,
  schemaId: string,
  stats: ArtifactStats,
): RecordValue {
  return {
    role,
    path,
    mediaType: path.endsWith(".jsonl")
      ? "application/jsonl"
      : "application/json",
    schemaId,
    ...stats,
  };
}

function stableLocator(path: string, root: string): string {
  const value = relative(root, path).replaceAll("\\", "/");
  return value.startsWith(".") ? path : value;
}

function isSafeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    path
      .split("/")
      .every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function assertConfigurationDigest(run: RecordValue, locator: string): void {
  const configuration = run.configuration;
  const expected = requiredString(run, "configurationSha256");
  if (sha256(serializeCanonicalJson(configuration)) !== expected)
    throw new Error(`${locator} configuration checksum mismatch`);
}

function assertSchema(
  validationApi: ValidationApi,
  schemaId: string,
  value: unknown,
  locator: string,
): void {
  const result = validationApi.validate(schemaId, value);
  if (!result.valid)
    throw new Error(
      `${locator} failed ${schemaId}: ${JSON.stringify(result.errors)}`,
    );
}

async function readJsonObject(path: string): Promise<RecordValue> {
  return parseObject(await readFile(path), path);
}

function parseObject(bytes: Buffer, locator: string): RecordValue {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${locator}`, { cause: error });
  }
  const record = asRecord(value);
  if (record === undefined)
    throw new Error(`${locator} must contain a JSON object`);
  return record;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function recordId(record: RecordValue): string {
  return stringField(record, "id") ?? "";
}
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function asRecord(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}
function stringField(
  record: RecordValue | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function requiredString(record: RecordValue | undefined, key: string): string {
  const value = stringField(record, key);
  if (value === undefined) throw new Error(`Record is missing string ${key}`);
  return value;
}
function numberField(record: RecordValue | undefined, key: string): number {
  const value = record?.[key];
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Error(`Record is missing integer ${key}`);
  return value;
}
function arrayField(record: RecordValue | undefined, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}

async function publishDirectory(
  staging: string,
  destination: string,
): Promise<void> {
  const backup = `${destination}.backup-${randomUUID()}`;
  let moved = false;
  try {
    await rename(destination, backup);
    moved = true;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  try {
    await rename(staging, destination);
  } catch (error) {
    if (moved) await rename(backup, destination);
    throw error;
  }
  if (moved) await rm(backup, { recursive: true, force: true });
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
