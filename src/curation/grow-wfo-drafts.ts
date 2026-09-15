import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";
import { readJsonLines, writeJsonLines } from "../serialization/json-lines.js";
import { validate, type ValidationApi } from "../schema/validation-api.js";
import {
  GROW_SOURCE_ID,
  GROW_PROVIDER_ID,
  GROW_SOURCE_MANIFEST_ID as EXPECTED_GROW_MANIFEST_ID,
  GROW_SOURCE_RELEASE_ID as EXPECTED_GROW_RELEASE_ID,
  WFO_ARCHIVE_BYTE_SIZE,
  WFO_ARCHIVE_LOCATOR,
  WFO_ARCHIVE_MD5,
  WFO_PROVIDER_ID,
  WFO_SOURCE_ID,
  WFO_SOURCE_MANIFEST_ID,
  WFO_SOURCE_RELEASE_ID,
} from "../adapters/wfo/constants.js";
import { fileURLToPath } from "node:url";

type RecordValue = Readonly<Record<string, unknown>>;

export interface GrowWfoDraftOptions {
  readonly growRunDirectory: string;
  readonly wfoRunDirectory: string;
  readonly outputDirectory: string;
  readonly growResourceDirectory?: string;
  readonly wfoSnapshotPath?: string;
  readonly growSourceManifestPath?: string;
  readonly wfoSourceManifestPath?: string;
  /** Override the archive pin in fixture-backed tests; the CLI always uses the tracked release pin. */
  readonly expectedWfoArchive?: {
    readonly md5: string;
    readonly byteSize: number;
  };
  readonly validationApi?: ValidationApi;
}

export interface GrowWfoDraftResult {
  readonly outputDirectory: string;
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * Materialize an explicitly unreviewed C4 queue from successful GROW and WFO
 * runs. The queue is a review aid, not authoring data and never emits accepted
 * crosswalks, subject mappings, assertions, or consumer records.
 */
export async function generateGrowWfoDrafts(
  options: GrowWfoDraftOptions,
): Promise<GrowWfoDraftResult> {
  const validationApi = options.validationApi ?? { validate };
  const growRunDirectory = resolve(options.growRunDirectory);
  const wfoRunDirectory = resolve(options.wfoRunDirectory);
  const outputDirectory = resolve(options.outputDirectory);
  const repositoryRoot = resolve(
    fileURLToPath(new URL("../../", import.meta.url)),
  );
  const growResourceDirectory = resolve(
    options.growResourceDirectory ??
      join(repositoryRoot, "data/sources/grow/releases/2020"),
  );
  const wfoSnapshotPath = resolve(
    options.wfoSnapshotPath ??
      join(
        repositoryRoot,
        ".cache/source-inputs/wfo/2026-06/_DwC_backbone_R.zip",
      ),
  );
  const expectedWfoArchive = options.expectedWfoArchive ?? {
    md5: WFO_ARCHIVE_MD5,
    byteSize: WFO_ARCHIVE_BYTE_SIZE,
  };
  const growSourceManifestPath = resolve(
    options.growSourceManifestPath ??
      join(repositoryRoot, "data/sources/grow/source-manifest.json"),
  );
  const wfoSourceManifestPath = resolve(
    options.wfoSourceManifestPath ??
      join(repositoryRoot, "data/sources/wfo/source-manifest.json"),
  );
  const growRunManifestPath = join(
    growRunDirectory,
    "importer-run-manifest.json",
  );
  const wfoRunManifestPath = join(
    wfoRunDirectory,
    "reconciliation-run-manifest.json",
  );
  const [growRunBytes, wfoRunBytes, growSourceBytes, wfoSourceBytes] =
    await Promise.all([
      readFile(growRunManifestPath),
      readFile(wfoRunManifestPath),
      readFile(growSourceManifestPath),
      readFile(wfoSourceManifestPath),
    ]);
  const growManifest = parseObject(growRunBytes, growRunManifestPath);
  const wfoManifest = parseObject(wfoRunBytes, wfoRunManifestPath);
  const growSourceManifest = parseObject(
    growSourceBytes,
    growSourceManifestPath,
  );
  const wfoSourceManifest = parseObject(wfoSourceBytes, wfoSourceManifestPath);
  assertSchema(
    validationApi,
    "urn:hortinis:plants:schema:v1:importer-run-manifest",
    growManifest,
    growRunManifestPath,
  );
  assertSchema(
    validationApi,
    "urn:hortinis:plants:schema:v1:taxonomy-reconciliation-manifest",
    wfoManifest,
    wfoRunManifestPath,
  );
  assertSchema(
    validationApi,
    "urn:hortinis:plants:schema:v1:source-manifest",
    growSourceManifest,
    growSourceManifestPath,
  );
  assertSchema(
    validationApi,
    "urn:hortinis:plants:schema:v1:source-manifest",
    wfoSourceManifest,
    wfoSourceManifestPath,
  );
  assertSourceIdentity(
    growSourceManifest,
    GROW_SOURCE_ID,
    GROW_PROVIDER_ID,
    EXPECTED_GROW_MANIFEST_ID,
    EXPECTED_GROW_RELEASE_ID,
    growSourceManifestPath,
  );
  assertSourceIdentity(
    wfoSourceManifest,
    WFO_SOURCE_ID,
    WFO_PROVIDER_ID,
    WFO_SOURCE_MANIFEST_ID,
    WFO_SOURCE_RELEASE_ID,
    wfoSourceManifestPath,
  );
  await verifyGrowRun(
    growManifest,
    growSourceManifest,
    growSourceBytes,
    growRunDirectory,
    growResourceDirectory,
    validationApi,
  );
  await verifyWfoRun(
    wfoManifest,
    growManifest,
    wfoSourceManifest,
    growSourceManifest,
    growRunBytes,
    growSourceBytes,
    wfoSourceBytes,
    wfoRunDirectory,
    wfoSnapshotPath,
    expectedWfoArchive,
    validationApi,
  );

  const [sourceRecords, growCandidates, taxonCandidates] = await Promise.all([
    readRecords(join(growRunDirectory, "source-records.jsonl")),
    readRecords(join(growRunDirectory, "candidates.jsonl")),
    readRecords(join(wfoRunDirectory, "taxon-match-candidates.jsonl")),
  ]);
  assertSourceCandidateCoverage(sourceRecords, taxonCandidates);

  const taxonBySourceRecord = new Map<string, RecordValue>();
  for (const candidate of taxonCandidates) {
    const source = asRecord(candidate.source);
    const sourceRecordId = stringField(source, "sourceRecordId");
    if (sourceRecordId === undefined)
      throw new Error("WFO taxon candidate has no sourceRecordId");
    if (taxonBySourceRecord.has(sourceRecordId))
      throw new Error(
        `WFO taxon candidates repeat source record ${sourceRecordId}`,
      );
    taxonBySourceRecord.set(sourceRecordId, candidate);
  }

  const identityQueue = sourceRecords
    .map((record) => {
      const sourceRecordId = requiredString(record, "sourceRecordId");
      const candidate = taxonBySourceRecord.get(sourceRecordId);
      if (candidate === undefined)
        throw new Error(
          `GROW source record ${sourceRecordId} has no WFO candidate`,
        );
      return {
        id: `identity_review_${sourceRecordId}`,
        reviewState: "unreviewed",
        sourceRecord: record,
        taxonomyCandidate: candidate,
        proposedNextStep: identityNextStep(candidate),
      };
    })
    .sort(compareId);

  const subjectQueue = sourceRecords
    .map((record) => {
      const sourceRecordId = requiredString(record, "sourceRecordId");
      const fields = asRecord(record.fields);
      return {
        id: `subject_mapping_review_${sourceRecordId}`,
        reviewState: "unreviewed",
        sourceRecordId,
        sourceLocator: requiredString(record, "sourceLocator"),
        sourceScientificName: stringField(fields, "Full taxonomic name"),
        sourceCommonName: stringField(fields, "Common name"),
        taxonomyCandidateId: requiredString(
          taxonBySourceRecord.get(sourceRecordId),
          "id",
        ),
        proposedNextStep: "decide-new-or-existing-hortinis-subject",
      };
    })
    .sort(compareId);

  const assertionQueue = growCandidates.map(assertionDraft).sort(compareId);

  const crosswalkQueue = consolidateCrosswalkDrafts(taxonCandidates);

  const geographyQueue = geographyDrafts(growCandidates).sort(compareId);

  const issueQueue = [
    ...taxonCandidates
      .filter((candidate) => !isAutomaticIdentityCandidate(candidate))
      .map((candidate) => ({
        id: `issue_taxonomy_${requiredString(candidate, "id")}`,
        kind: "unresolved-mapping",
        status: "open",
        reviewState: "unreviewed",
        affectedRecordIds: [requiredString(candidate, "id")],
        reason: taxonomyIssueReason(candidate),
      })),
    ...sourceRecords.map((record) => ({
      id: `issue_subject_mapping_${requiredString(record, "sourceRecordId")}`,
      kind: "unresolved-mapping",
      status: "open",
      reviewState: "unreviewed",
      affectedRecordIds: [requiredString(record, "sourceRecordId")],
      reason:
        "No reviewed GROW source-record-to-Hortinis-subject mapping has been authored.",
    })),
  ].sort(compareId);

  const stagingParent = dirname(outputDirectory);
  await mkdir(stagingParent, { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(stagingParent, ".grow-wfo-drafts-"),
  );
  try {
    const queues = [
      {
        path: "identity-review-queue.jsonl",
        schemaId: "urn:hortinis:plants:schema:curation:v1:identity-review-item",
        records: identityQueue,
      },
      {
        path: "subject-mapping-review-queue.jsonl",
        schemaId: "urn:hortinis:plants:schema:curation:v1:subject-review-item",
        records: subjectQueue,
      },
      {
        path: "assertion-review-queue.jsonl",
        schemaId:
          "urn:hortinis:plants:schema:curation:v1:assertion-review-item",
        records: assertionQueue,
      },
      {
        path: "taxonomy-crosswalk-review-queue.jsonl",
        schemaId:
          "urn:hortinis:plants:schema:curation:v1:crosswalk-review-item",
        records: crosswalkQueue,
      },
      {
        path: "geographic-context-review-queue.jsonl",
        schemaId:
          "urn:hortinis:plants:schema:curation:v1:geography-review-item",
        records: geographyQueue,
      },
      {
        path: "curation-issues.jsonl",
        schemaId:
          "urn:hortinis:plants:schema:curation:v1:curation-issue-review-item",
        records: issueQueue,
      },
    ] as const;
    const outputs = await Promise.all(
      queues.map(async (queue) => {
        for (const record of queue.records)
          assertSchema(
            validationApi,
            queue.schemaId,
            record,
            `${queue.path} record ${requiredString(record, "id")}`,
          );
        return {
          role: queue.path.replaceAll(".jsonl", ""),
          path: queue.path,
          mediaType: "application/jsonl",
          schemaId: queue.schemaId,
          ...(await writeRecords(
            join(stagingDirectory, queue.path),
            queue.records,
          )),
        };
      }),
    );

    const counts = {
      sourceRecords: sourceRecords.length,
      identityReviewItems: identityQueue.length,
      subjectMappingReviewItems: subjectQueue.length,
      assertionReviewItems: assertionQueue.length,
      taxonomyCrosswalkReviewItems: crosswalkQueue.length,
      geographicContextReviewItems: geographyQueue.length,
      openCurationIssues: issueQueue.length,
    };
    const draftManifest = {
      schemaVersion: "1.0.0",
      kind: "grow-wfo-c4-review-drafts",
      reviewState: "unreviewed",
      inputs: {
        growImporterRun: {
          sha256: sha256(growRunBytes),
          configurationSha256: stringField(growManifest, "configurationSha256"),
        },
        wfoReconciliationRun: {
          sha256: sha256(wfoRunBytes),
          configurationSha256: stringField(wfoManifest, "configurationSha256"),
        },
        growSourceManifest: {
          id: requiredString(growSourceManifest, "id"),
          sha256: sha256(growSourceBytes),
        },
        wfoSourceManifest: {
          id: requiredString(wfoSourceManifest, "id"),
          sha256: sha256(wfoSourceBytes),
        },
        wfoSnapshotSha256: await hashFileSha256(wfoSnapshotPath),
      },
      counts,
      outputs: outputs.sort((a, b) => a.path.localeCompare(b.path)),
    };
    assertSchema(
      validationApi,
      "urn:hortinis:plants:schema:curation:v1:draft-manifest",
      draftManifest,
      "draft manifest",
    );
    await writeFile(
      join(stagingDirectory, "draft-manifest.json"),
      withNewline(draftManifest),
      { flag: "wx" },
    );
    await publishDirectory(stagingDirectory, outputDirectory);
    return { outputDirectory, counts };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function readRecords(path: string): Promise<RecordValue[]> {
  const records: RecordValue[] = [];
  for await (const { value } of readJsonLines(createReadStream(path))) {
    const record = asRecord(value);
    if (record === undefined)
      throw new Error(`${path} contains a non-object record`);
    records.push(record);
  }
  return records;
}

async function writeRecords(
  path: string,
  records: readonly RecordValue[],
): Promise<{
  readonly sha256: string;
  readonly byteSize: number;
  readonly recordCount: number;
}> {
  const hash = createHash("sha256");
  let byteSize = 0;
  let recordCount = 0;
  const serialized = async function* (): AsyncGenerator<Uint8Array> {
    for await (const bytes of writeJsonLines(records)) {
      hash.update(bytes);
      byteSize += bytes.byteLength;
      recordCount += 1;
      yield bytes;
    }
  };
  await pipeline(
    Readable.from(serialized()),
    createWriteStream(path, { flags: "w" }),
  );
  return { sha256: hash.digest("hex"), byteSize, recordCount };
}

async function verifyGrowRun(
  run: RecordValue,
  sourceManifest: RecordValue,
  sourceManifestBytes: Buffer,
  runDirectory: string,
  resourceDirectory: string,
  validationApi: ValidationApi,
): Promise<void> {
  if (
    requiredString(asRecord(run.importer), "name") !==
    "grow-edible-plant-database"
  ) {
    throw new Error("GROW importer run manifest identifies the wrong importer");
  }
  const sourceReference = asRecord(run.sourceManifest);
  if (
    requiredString(sourceReference, "id") !==
      requiredString(sourceManifest, "id") ||
    requiredString(sourceReference, "sha256") !== sha256(sourceManifestBytes)
  ) {
    throw new Error("GROW importer run references a different source manifest");
  }
  assertConfigurationDigest(run, "GROW importer run");
  await verifyDeclaredOutputs(run, runDirectory, validationApi, "GROW");

  const sourceResources = arrayField(sourceManifest, "resources");
  const declaredInputs = arrayField(run, "inputs");
  const inputsByLocator = new Map<string, RecordValue>();
  for (const value of declaredInputs) {
    const input = asRecord(value);
    if (input === undefined)
      throw new Error("GROW run has a malformed input descriptor");
    const locator = requiredString(input, "locator");
    if (inputsByLocator.has(locator)) {
      throw new Error(`GROW importer run repeats input ${locator}`);
    }
    inputsByLocator.set(locator, input);
    if (!isSafeRelativePath(locator)) {
      throw new Error(`GROW importer input locator is unsafe: ${locator}`);
    }
    const actual = await fileDigests(
      join(resourceDirectory, ...locator.split("/")),
    );
    if (
      actual.sha256 !== requiredString(input, "sha256") ||
      actual.byteSize !== numberField(input, "byteSize")
    ) {
      throw new Error(
        `GROW importer input ${locator} does not match its run manifest`,
      );
    }
    const sourceResource = sourceResources
      .map(asRecord)
      .find((resource) => stringField(resource, "locator") === locator);
    if (sourceResource === undefined) {
      if (stringField(input, "role") !== "derived") {
        throw new Error(
          `GROW input ${locator} is not declared by its source manifest`,
        );
      }
      continue;
    }
    if (stringField(input, "role") !== "upstream") {
      throw new Error(
        `GROW source resource ${locator} must be an upstream input`,
      );
    }
    const checksum = asRecord(sourceResource.checksum);
    const algorithm = requiredString(checksum, "algorithm");
    const expectedChecksum = requiredString(checksum, "value");
    const actualChecksum =
      algorithm === "sha256"
        ? actual.sha256
        : algorithm === "md5"
          ? actual.md5
          : undefined;
    if (
      actualChecksum !== expectedChecksum ||
      actual.byteSize !== numberField(sourceResource, "byteSize")
    ) {
      throw new Error(
        `GROW source resource ${locator} differs from its tracked source manifest`,
      );
    }
  }
  for (const value of sourceResources) {
    const resource = asRecord(value);
    if (resource === undefined) continue;
    const locator = requiredString(resource, "locator");
    if (!inputsByLocator.has(locator)) {
      throw new Error(`GROW run does not declare source resource ${locator}`);
    }
  }
}

async function verifyWfoRun(
  run: RecordValue,
  growRun: RecordValue,
  wfoSourceManifest: RecordValue,
  growSourceManifest: RecordValue,
  growRunBytes: Buffer,
  growSourceManifestBytes: Buffer,
  wfoSourceManifestBytes: Buffer,
  runDirectory: string,
  snapshotPath: string,
  expectedArchive: { readonly md5: string; readonly byteSize: number },
  validationApi: ValidationApi,
): Promise<void> {
  const job = asRecord(run.job);
  if (requiredString(job, "name") !== "grow-wfo-taxonomy-reconciliation") {
    throw new Error("WFO reconciliation manifest identifies the wrong job");
  }
  assertConfigurationDigest(run, "WFO reconciliation run");
  await verifyDeclaredOutputs(run, runDirectory, validationApi, "WFO");
  const sourceManifests = arrayField(run, "sourceManifests").map(asRecord);
  const expectedSources = [wfoSourceManifest, growSourceManifest];
  for (const expected of expectedSources) {
    const id = requiredString(expected, "id");
    const ref = sourceManifests.find(
      (entry) => stringField(entry, "id") === id,
    );
    const sourceBytes =
      id === requiredString(wfoSourceManifest, "id")
        ? wfoSourceManifestBytes
        : growSourceManifestBytes;
    if (
      ref === undefined ||
      requiredString(ref, "sha256") !== sha256(sourceBytes)
    ) {
      throw new Error(
        `WFO reconciliation run references a different source manifest ${id}`,
      );
    }
  }
  if (sourceManifests.length !== expectedSources.length) {
    throw new Error(
      "WFO reconciliation run declares unexpected source manifests",
    );
  }

  const inputs = arrayField(run, "inputs").map(asRecord);
  const archiveInput = inputs.find(
    (input) => stringField(input, "locator") === WFO_ARCHIVE_LOCATOR,
  );
  const growManifestInput = inputs.find(
    (input) =>
      stringField(input, "locator") ===
      "grow-import-run:importer-run-manifest.json",
  );
  const growRecordsInput = inputs.find(
    (input) =>
      stringField(input, "locator") === "grow-import-run:source-records.jsonl",
  );
  if (
    archiveInput === undefined ||
    growManifestInput === undefined ||
    growRecordsInput === undefined
  ) {
    throw new Error(
      "WFO reconciliation run is missing a required declared input",
    );
  }
  if (
    requiredString(growManifestInput, "sha256") !== sha256(growRunBytes) ||
    numberField(growManifestInput, "byteSize") !== growRunBytes.byteLength
  ) {
    throw new Error(
      "WFO reconciliation run was built from a different GROW run manifest",
    );
  }
  const growSourceOutput = outputDescriptor(growRun, "source-records.jsonl");
  if (
    requiredString(growRecordsInput, "sha256") !==
      requiredString(growSourceOutput, "sha256") ||
    numberField(growRecordsInput, "byteSize") !==
      numberField(growSourceOutput, "byteSize")
  ) {
    throw new Error(
      "WFO reconciliation run was built from different GROW source records",
    );
  }
  const wfoResource = arrayField(wfoSourceManifest, "resources")
    .map(asRecord)
    .find(
      (resource) => stringField(resource, "locator") === WFO_ARCHIVE_LOCATOR,
    );
  if (wfoResource === undefined) {
    throw new Error(
      "Tracked WFO source manifest does not declare the pinned archive",
    );
  }
  const checksum = asRecord(wfoResource.checksum);
  if (
    stringField(checksum, "algorithm") !== "md5" ||
    stringField(checksum, "value") !== expectedArchive.md5 ||
    numberField(wfoResource, "byteSize") !== expectedArchive.byteSize
  ) {
    throw new Error(
      "Tracked WFO archive metadata no longer matches the pinned release",
    );
  }
  const actualArchive = await fileDigests(snapshotPath);
  if (
    actualArchive.md5 !== expectedArchive.md5 ||
    actualArchive.byteSize !== expectedArchive.byteSize ||
    actualArchive.sha256 !== requiredString(archiveInput, "sha256") ||
    actualArchive.byteSize !== numberField(archiveInput, "byteSize")
  ) {
    throw new Error(
      "Pinned WFO archive does not match its source and run manifests",
    );
  }
}

async function verifyDeclaredOutputs(
  run: RecordValue,
  directory: string,
  validationApi: ValidationApi,
  label: string,
): Promise<void> {
  const outputs = arrayField(run, "outputs");
  const seen = new Set<string>();
  for (const value of outputs) {
    const output = asRecord(value);
    if (output === undefined)
      throw new Error(`${label} run has a malformed output descriptor`);
    const path = requiredString(output, "path");
    if (!isSafeRelativePath(path) || seen.has(path)) {
      throw new Error(
        `${label} run has an unsafe or duplicate output path ${path}`,
      );
    }
    seen.add(path);
    const actual = await fileDigests(join(directory, ...path.split("/")));
    if (
      actual.sha256 !== requiredString(output, "sha256") ||
      actual.byteSize !== numberField(output, "byteSize")
    ) {
      throw new Error(`${label} run output ${path} checksum or size mismatch`);
    }
    let recordCount = 0;
    const schemaId = stringField(output, "schemaId");
    for await (const entry of readJsonLines(
      createReadStream(join(directory, ...path.split("/"))),
      {
        ...(schemaId === undefined ? {} : { schemaId, validationApi }),
      },
    )) {
      if (entry.value !== undefined) recordCount += 1;
    }
    if (recordCount !== numberField(output, "recordCount")) {
      throw new Error(`${label} run output ${path} record count mismatch`);
    }
  }
}

function assertSourceIdentity(
  manifest: RecordValue,
  sourceId: string,
  providerId: string,
  manifestId: string,
  releaseId: string,
  label: string,
): void {
  const provider = asRecord(manifest.provider);
  const release = asRecord(manifest.release);
  if (
    requiredString(manifest, "id") !== manifestId ||
    requiredString(provider, "id") !== providerId ||
    requiredString(release, "identifier") !== releaseId
  ) {
    throw new Error(
      `${label} does not identify the pinned ${sourceId} release`,
    );
  }
}

function assertConfigurationDigest(run: RecordValue, label: string): void {
  const configuration = run.configuration;
  const expected = requiredString(run, "configurationSha256");
  if (sha256(serializeCanonicalJson(configuration)) !== expected) {
    throw new Error(`${label} configuration checksum mismatch`);
  }
}

function assertSourceCandidateCoverage(
  sourceRecords: readonly RecordValue[],
  candidates: readonly RecordValue[],
): void {
  const sourceById = new Map(
    sourceRecords.map((record) => [
      requiredString(record, "sourceRecordId"),
      record,
    ]),
  );
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const source = asRecord(candidate.source);
    const sourceRecordId = requiredString(source, "sourceRecordId");
    const record = sourceById.get(sourceRecordId);
    if (record === undefined || seen.has(sourceRecordId)) {
      throw new Error(
        `WFO candidate source-record coverage is invalid for ${sourceRecordId}`,
      );
    }
    seen.add(sourceRecordId);
    const fields = asRecord(record.fields);
    if (
      requiredString(source, "sourceLocator") !==
        requiredString(record, "sourceLocator") ||
      requiredString(candidate, "sourceName") !==
        requiredString(fields, "Full taxonomic name")
    ) {
      throw new Error(
        `WFO candidate does not match GROW source record ${sourceRecordId}`,
      );
    }
  }
  if (seen.size !== sourceById.size) {
    throw new Error("WFO candidates do not cover every GROW source record");
  }
}

function outputDescriptor(run: RecordValue, path: string): RecordValue {
  const output = arrayField(run, "outputs")
    .map(asRecord)
    .find((entry) => stringField(entry, "path") === path);
  if (output === undefined)
    throw new Error(`Run manifest does not declare ${path}`);
  return output;
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

function assertSchema(
  validationApi: ValidationApi,
  schemaId: string,
  value: unknown,
  locator: string,
): void {
  const result = validationApi.validate(schemaId, value);
  if (!result.valid) {
    throw new Error(
      `${locator} failed ${schemaId}: ${JSON.stringify(result.errors)}`,
    );
  }
}

async function fileDigests(path: string): Promise<{
  readonly sha256: string;
  readonly md5: string;
  readonly byteSize: number;
}> {
  const hash256 = createHash("sha256");
  const hashMd5 = createHash("md5");
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    hash256.update(bytes);
    hashMd5.update(bytes);
    byteSize += bytes.byteLength;
  }
  return {
    sha256: hash256.digest("hex"),
    md5: hashMd5.digest("hex"),
    byteSize,
  };
}

async function hashFileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function publishDirectory(
  staging: string,
  destination: string,
): Promise<void> {
  const backup = `${destination}.backup-${randomUUID()}`;
  let movedOld = false;
  try {
    await access(destination);
    await rename(destination, backup);
    movedOld = true;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  try {
    await rename(staging, destination);
  } catch (error) {
    if (movedOld) await rename(backup, destination);
    throw error;
  }
  if (movedOld) await rm(backup, { recursive: true, force: true });
}

function numberField(record: RecordValue | undefined, key: string): number {
  const value = record?.[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Record is missing integer ${key}`);
  }
  return value;
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

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function identityNextStep(candidate: RecordValue): string {
  switch (stringField(candidate, "outcome")) {
    case "candidate-accepted":
      return "review-exact-accepted-name-crosswalk";
    case "candidate-synonym":
      return "review-exact-synonym-crosswalk-and-accepted-target";
    default:
      return "record-manual-decision-or-accepted-limitation";
  }
}

function assertionNextStep(candidate: RecordValue): string {
  switch (stringField(candidate, "predicate")) {
    case "calendar_window":
      return "review-country-context-and-source-native-action";
    case "days_to_first_harvest":
      return "retain-unreviewed-until-harvest-anchor-is-defined";
    case "temperature_class":
      return "review-temperature-class-to-frost-semantics-mapping";
    default:
      return "review-source-value-context-and-subject-scope";
  }
}

function assertionDraft(candidate: RecordValue): RecordValue {
  const temperatureClassProposal = temperatureClassDraft(candidate);
  return {
    id: `assertion_review_${requiredString(candidate, "id")}`,
    reviewState: "unreviewed",
    sourceCandidate: candidate,
    proposedNextStep: assertionNextStep(candidate),
    ...(temperatureClassProposal === undefined
      ? {}
      : { proposedAuthoringAssertion: temperatureClassProposal }),
  };
}

function temperatureClassDraft(
  candidate: RecordValue,
): RecordValue | undefined {
  if (stringField(candidate, "predicate") !== "temperature_class")
    return undefined;
  const sourceClass = stringField(candidate, "normalizedValue");
  const value =
    sourceClass === "very_tender" || sourceClass === "tender"
      ? "sensitive"
      : sourceClass === "half_hardy"
        ? "unknown"
        : sourceClass === "hardy" || sourceClass === "very_hardy"
          ? "hardy"
          : undefined;
  if (value === undefined)
    throw new Error(
      `Unknown normalized GROW temperature class ${sourceClass ?? "<missing>"}`,
    );
  return {
    predicate: "frost_sensitivity",
    value,
    normalization: {
      method: "grow-temperature-class-to-frost-sensitivity-v1",
      originalValue: candidate.rawValue,
    },
  };
}

function consolidateCrosswalkDrafts(
  candidates: readonly RecordValue[],
): RecordValue[] {
  const drafts = new Map<
    string,
    {
      readonly row: RecordValue;
      readonly proposalRoles: Set<string>;
      readonly methods: Set<string>;
      readonly candidateIds: Set<string>;
      readonly sourceRecordIds: Set<string>;
      readonly sourceNames: Set<string>;
      readonly acceptedNameIdentifiers: Set<string>;
    }
  >();
  for (const candidate of candidates) {
    if (!isAutomaticIdentityCandidate(candidate)) continue;
    const alternative = asRecord(arrayField(candidate, "alternatives")[0]);
    if (alternative === undefined) {
      throw new Error(
        `WFO candidate ${requiredString(candidate, "id")} has no alternative`,
      );
    }
    const role =
      stringField(candidate, "outcome") === "candidate-synonym"
        ? "matched-synonym"
        : "matched-accepted-name";
    addCrosswalkDraft(drafts, candidate, alternative, role);
    const acceptedName = asRecord(alternative.acceptedName);
    if (acceptedName !== undefined) {
      addCrosswalkDraft(
        drafts,
        candidate,
        acceptedName,
        "accepted-name-target",
      );
    }
  }
  return [...drafts.entries()]
    .map(([key, draft]) => ({
      id: `crosswalk_review_${sha256(Buffer.from(key)).slice(0, 24)}`,
      reviewState: "unreviewed",
      proposedStatus: "accepted",
      proposalRoles: [...draft.proposalRoles].sort(),
      proposedMatchMethod:
        draft.methods.size === 1 ? [...draft.methods][0] : "review-required",
      requiredBeforeAuthoring: "mint-or-select-reviewed-hortinis-taxon-id",
      referringSourceRecordIds: [...draft.sourceRecordIds].sort(compareStrings),
      sourceTaxonomyCandidateIds: [...draft.candidateIds].sort(compareStrings),
      sourceNames: [...draft.sourceNames].sort(compareStrings),
      proposedExternalTaxonomyCrosswalk: {
        externalIdentifier: draft.row.externalIdentifier,
        externalName: requiredString(draft.row, "scientificName"),
        ...(stringField(draft.row, "authorship") === undefined
          ? {}
          : { authorship: stringField(draft.row, "authorship") }),
        taxonRank: requiredString(draft.row, "taxonRank"),
        taxonomicStatus: requiredString(draft.row, "taxonomicStatus"),
        ...(draft.acceptedNameIdentifiers.size === 0
          ? {}
          : {
              acceptedNameIdentifier: [...draft.acceptedNameIdentifiers].sort(
                compareStrings,
              )[0],
            }),
        locator: requiredString(draft.row, "sourceLocator"),
      },
    }))
    .sort(compareId);
}

function addCrosswalkDraft(
  drafts: Map<
    string,
    {
      readonly row: RecordValue;
      readonly proposalRoles: Set<string>;
      readonly methods: Set<string>;
      readonly candidateIds: Set<string>;
      readonly sourceRecordIds: Set<string>;
      readonly sourceNames: Set<string>;
      readonly acceptedNameIdentifiers: Set<string>;
    }
  >,
  candidate: RecordValue,
  row: RecordValue,
  proposalRole: string,
): void {
  const identifier = asRecord(row.externalIdentifier);
  if (identifier === undefined) {
    throw new Error(
      `WFO candidate ${requiredString(candidate, "id")} has an alternative without an external identifier`,
    );
  }
  const key = [
    requiredString(identifier, "sourceId"),
    requiredString(identifier, "sourceManifestId"),
    requiredString(identifier, "sourceReleaseId"),
    requiredString(identifier, "identifier"),
  ].join("\u0000");
  let draft = drafts.get(key);
  if (draft === undefined) {
    draft = {
      row,
      proposalRoles: new Set(),
      methods: new Set(),
      candidateIds: new Set(),
      sourceRecordIds: new Set(),
      sourceNames: new Set(),
      acceptedNameIdentifiers: new Set(),
    };
    drafts.set(key, draft);
  } else if (
    requiredString(draft.row, "sourceLocator") !==
      requiredString(row, "sourceLocator") ||
    requiredString(draft.row, "scientificName") !==
      requiredString(row, "scientificName")
  ) {
    throw new Error(
      `WFO identifier ${key.replaceAll("\u0000", "/")} has conflicting row data`,
    );
  }
  draft.proposalRoles.add(proposalRole);
  if (proposalRole === "matched-synonym") draft.methods.add("exact-synonym");
  if (proposalRole === "matched-accepted-name") draft.methods.add("exact-name");
  draft.candidateIds.add(requiredString(candidate, "id"));
  draft.sourceRecordIds.add(
    requiredString(asRecord(candidate.source), "sourceRecordId"),
  );
  draft.sourceNames.add(requiredString(candidate, "sourceName"));
  const acceptedNameIdentifier = stringField(row, "acceptedNameIdentifier");
  if (acceptedNameIdentifier !== undefined) {
    draft.acceptedNameIdentifiers.add(acceptedNameIdentifier);
  }
  if (proposalRole === "matched-synonym") {
    const acceptedName = asRecord(row.acceptedName);
    const acceptedIdentifier = asRecord(acceptedName?.externalIdentifier);
    const value = stringField(acceptedIdentifier, "identifier");
    if (value !== undefined) draft.acceptedNameIdentifiers.add(value);
  }
}

function geographyDrafts(candidates: readonly RecordValue[]): RecordValue[] {
  const locations = new Map<
    string,
    { sourceCountryValues: Set<string>; candidates: RecordValue[] }
  >();
  for (const candidate of candidates) {
    if (stringField(candidate, "predicate") !== "calendar_window") continue;
    const applicability = asRecord(candidate.applicability);
    const geography = asRecord(applicability?.geography);
    const country = stringField(geography, "country");
    if (country === undefined) continue;
    const normalizedCountry = normalizeGrowCalendarCountry(country);
    const existing = locations.get(normalizedCountry) ?? {
      sourceCountryValues: new Set<string>(),
      candidates: [],
    };
    existing.sourceCountryValues.add(country);
    existing.candidates.push(candidate);
    locations.set(normalizedCountry, existing);
  }
  return [...locations.entries()].map(([country, entry]) => ({
    id: `geographic_context_review_${slug(country)}`,
    reviewState: "unreviewed",
    proposedKind: "administrative-area",
    proposedName: country,
    proposedScope: "country-named-by-grow-calendar-location",
    sourceCountryValues: [...entry.sourceCountryValues].sort(),
    sourceLocationNames: uniqueStrings(
      entry.candidates.map((candidate) =>
        stringField(
          asRecord(asRecord(candidate.applicability)?.geography),
          "name",
        ),
      ),
    ),
    calendarCandidateCount: entry.candidates.length,
  }));
}

function taxonomyIssueReason(candidate: RecordValue): string {
  const outcome = stringField(candidate, "outcome") ?? "unknown";
  return `WFO reconciliation outcome ${outcome} requires a documented curator decision; no taxonomy crosswalk is implied by this draft.`;
}

function isAutomaticIdentityCandidate(candidate: RecordValue): boolean {
  const outcome = stringField(candidate, "outcome");
  return outcome === "candidate-accepted" || outcome === "candidate-synonym";
}

function compareId(left: RecordValue, right: RecordValue): number {
  const leftId = requiredString(left, "id");
  const rightId = requiredString(right, "id");
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function asRecord(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function arrayField(record: RecordValue, key: string): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function stringField(
  record: RecordValue | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function requiredString(record: RecordValue | undefined, key: string): string {
  const value = stringField(record, key);
  if (value === undefined) throw new Error(`Record is missing string ${key}`);
  return value;
}

function withNewline(value: unknown): Uint8Array {
  const json = serializeCanonicalJson(value);
  const result = new Uint8Array(json.byteLength + 1);
  result.set(json);
  result[json.byteLength] = 0x0a;
  return result;
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => value !== undefined)),
  ].sort();
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
}

function normalizeGrowCalendarCountry(value: string): string {
  return value === "Irland" ? "Ireland" : value;
}
