import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import {
  makeQualifiedSourceLocationKey,
  makeQualifiedSourceRecordKey,
  makeSourceReleaseKey,
  serializeSourceReleaseKey,
  type SourceReleaseKey,
} from "../domain/source-keys.js";
import {
  parseJsonStrict,
  serializeCanonicalJson,
} from "../serialization/canonical-json.js";
import { readJsonLines, writeJsonLines } from "../serialization/json-lines.js";

type RecordValue = Record<string, unknown>;

interface CollectionDescriptor {
  readonly role: string;
  readonly path: string;
  readonly format: "jsonl";
  readonly schemaId: string;
  readonly authority: "curator-authored";
}

interface CurationManifest extends RecordValue {
  readonly datasetVersion: string;
  readonly collections: readonly CollectionDescriptor[];
}

export interface V1AuthoringMigrationOptions {
  readonly sourceDirectory: string;
  readonly destinationDirectory: string;
  readonly permittedSourceReleases: readonly SourceReleaseKey[];
}

export interface V1AuthoringMigrationResult {
  readonly migratedCollections: readonly string[];
  readonly recordCounts: Readonly<Record<string, number>>;
}

/** A precise, one-shot transform from the pre-T7 V1 authoring layout. */
export async function migrateV1AuthoringDataset(
  options: V1AuthoringMigrationOptions,
): Promise<V1AuthoringMigrationResult> {
  const sourceDirectory = resolve(options.sourceDirectory);
  const destinationDirectory = resolve(options.destinationDirectory);
  if (sourceDirectory === destinationDirectory)
    throw new Error("Migration source and destination directories must differ");
  const permitted = new Set(
    options.permittedSourceReleases.map(serializeSourceReleaseKey),
  );
  if (permitted.size !== options.permittedSourceReleases.length)
    throw new Error(
      "Migration source-release registry contains a duplicate key",
    );

  const manifestPath = join(sourceDirectory, "dataset-manifest.json");
  const manifestValue = parseJsonStrict(await readFile(manifestPath));
  if (!isManifest(manifestValue))
    throw new Error("Migration input has no valid manifest");
  const manifest = manifestValue;
  const roles = new Set<string>();
  const paths = new Set<string>();
  for (const descriptor of manifest.collections) {
    if (roles.has(descriptor.role))
      throw new Error(
        `Migration input declares duplicate collection role ${descriptor.role}`,
      );
    if (paths.has(descriptor.path))
      throw new Error(
        `Migration input declares duplicate collection path ${descriptor.path}`,
      );
    roles.add(descriptor.role);
    paths.add(descriptor.path);
  }

  await rm(destinationDirectory, { recursive: true, force: true });
  await mkdir(destinationDirectory, { recursive: true });
  const recordCounts: Record<string, number> = {};
  try {
    for (const descriptor of manifest.collections) {
      const records = await readRecords(join(sourceDirectory, descriptor.path));
      const migrated = records.map((record, index) =>
        migrateRecord(
          descriptor.role,
          record,
          descriptor.path,
          index + 1,
          permitted,
        ),
      );
      migrated.sort(compareRecordIds);
      await writeRecords(join(destinationDirectory, descriptor.path), migrated);
      recordCounts[descriptor.role] = migrated.length;
    }

    const comparisonRole = "assertion-comparison-decisions";
    const migratedCollections = [...manifest.collections];
    if (!roles.has(comparisonRole)) {
      migratedCollections.push({
        role: comparisonRole,
        path: "assertion-comparison-decisions.jsonl",
        format: "jsonl",
        schemaId:
          "urn:hortinis:plants:schema:authoring:v1:assertion-comparison-decision",
        authority: "curator-authored",
      });
      await writeFile(
        join(destinationDirectory, "assertion-comparison-decisions.jsonl"),
        new Uint8Array(),
      );
      recordCounts[comparisonRole] = 0;
    }
    const nextManifest: RecordValue = {
      ...manifest,
      datasetVersion: "0.2.0",
      collections: migratedCollections,
    };
    await writeFile(
      join(destinationDirectory, "dataset-manifest.json"),
      Buffer.concat([
        Buffer.from(serializeCanonicalJson(nextManifest)),
        Buffer.from("\n"),
      ]),
    );
    return {
      migratedCollections: migratedCollections.map(({ role }) => role),
      recordCounts,
    };
  } catch (error) {
    await rm(destinationDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function readRecords(path: string): Promise<RecordValue[]> {
  const records: RecordValue[] = [];
  for await (const entry of readJsonLines(createReadStream(path))) {
    if (!isRecord(entry.value))
      throw new Error(
        `${path}:${entry.lineNumber} migration record must be an object`,
      );
    records.push(entry.value);
  }
  return records;
}

async function writeRecords(
  path: string,
  records: readonly RecordValue[],
): Promise<void> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of writeJsonLines(records)) chunks.push(chunk);
  await writeFile(path, Buffer.concat(chunks));
}

function migrateRecord(
  role: string,
  record: RecordValue,
  path: string,
  lineNumber: number,
  permitted: ReadonlySet<string>,
): RecordValue {
  switch (role) {
    case "evidence-references":
    case "source-name-decisions":
    case "source-subject-mappings":
      return migrateRecordKey(record, path, lineNumber, permitted);
    case "source-geography-decisions":
      return migrateLocationKey(record, path, lineNumber, permitted);
    case "taxonomic-names":
    case "external-taxonomy-crosswalks":
      assertExternalIdentifier(record, path, lineNumber, permitted);
      return record;
    default:
      return record;
  }
}

function assertExternalIdentifier(
  record: RecordValue,
  path: string,
  lineNumber: number,
  permitted: ReadonlySet<string>,
): void {
  const identifier = asRecord(record.externalIdentifier);
  const release =
    identifier === undefined ? undefined : flatRelease(identifier);
  if (release === undefined)
    fail(
      path,
      lineNumber,
      record,
      "has an incomplete external source reference",
    );
  assertPermitted(release, path, lineNumber, record, permitted);
}

function migrateRecordKey(
  record: RecordValue,
  path: string,
  lineNumber: number,
  permitted: ReadonlySet<string>,
): RecordValue {
  const nested = asRecord(record.sourceRecordKey);
  const flat = flatRelease(record);
  const recordId =
    stringValue(nested?.recordId) ?? stringValue(record.sourceRecordId);
  const release = nested === undefined ? flat : nestedRelease(nested);
  if (recordId === undefined || release === undefined)
    fail(path, lineNumber, record, "has an incomplete source-record reference");
  if (nested !== undefined && flat !== undefined && !sameRelease(release, flat))
    fail(
      path,
      lineNumber,
      record,
      "has conflicting flat and nested source references",
    );
  assertPermitted(release, path, lineNumber, record, permitted);
  return {
    ...without(record, [
      "sourceId",
      "sourceManifestId",
      "sourceReleaseId",
      "sourceRecordId",
      "sourceRecordKey",
    ]),
    sourceRecordKey: makeQualifiedSourceRecordKey(release, recordId),
  };
}

function migrateLocationKey(
  record: RecordValue,
  path: string,
  lineNumber: number,
  permitted: ReadonlySet<string>,
): RecordValue {
  const nested = asRecord(record.sourceLocationKey);
  const flat = flatRelease(record);
  const release = nested === undefined ? flat : nestedRelease(nested);
  const sourceLocation = asRecord(record.sourceLocation);
  const locationId =
    stringValue(nested?.locationId) ?? stringValue(sourceLocation?.sheetCode);
  if (release === undefined || locationId === undefined)
    fail(
      path,
      lineNumber,
      record,
      "has an incomplete source-location reference; a semantic locationId is required",
    );
  if (nested !== undefined && flat !== undefined && !sameRelease(release, flat))
    fail(
      path,
      lineNumber,
      record,
      "has conflicting flat and nested source references",
    );
  assertPermitted(release, path, lineNumber, record, permitted);
  return {
    ...without(record, [
      "sourceId",
      "sourceManifestId",
      "sourceReleaseId",
      "sourceLocationKey",
    ]),
    sourceLocationKey: makeQualifiedSourceLocationKey(release, locationId),
  };
}

function flatRelease(record: RecordValue): SourceReleaseKey | undefined {
  const sourceId = stringValue(record.sourceId);
  const sourceManifestId = stringValue(record.sourceManifestId);
  const sourceReleaseId = stringValue(record.sourceReleaseId);
  return sourceId === undefined ||
    sourceManifestId === undefined ||
    sourceReleaseId === undefined
    ? undefined
    : makeSourceReleaseKey(sourceId, sourceManifestId, sourceReleaseId);
}

function nestedRelease(key: RecordValue): SourceReleaseKey | undefined {
  return isRecord(key.source) ? flatRelease(key.source) : undefined;
}

function assertPermitted(
  release: SourceReleaseKey,
  path: string,
  lineNumber: number,
  record: RecordValue,
  permitted: ReadonlySet<string>,
): void {
  if (!permitted.has(serializeSourceReleaseKey(release)))
    fail(path, lineNumber, record, "references an unknown source release");
}

function sameRelease(left: SourceReleaseKey, right: SourceReleaseKey): boolean {
  return serializeSourceReleaseKey(left) === serializeSourceReleaseKey(right);
}

function compareRecordIds(left: RecordValue, right: RecordValue): number {
  const leftId = stringValue(left.id);
  const rightId = stringValue(right.id);
  if (leftId === undefined || rightId === undefined)
    throw new Error(
      "Migration cannot sort a collection containing a record without an id",
    );
  return leftId.localeCompare(rightId, "en");
}

function fail(
  path: string,
  lineNumber: number,
  record: RecordValue,
  message: string,
): never {
  const id = stringValue(record.id) ?? "<missing id>";
  throw new Error(`${path}:${lineNumber} ${id} ${message}`);
}

function isManifest(value: unknown): value is CurationManifest {
  return (
    isRecord(value) &&
    typeof value.datasetVersion === "string" &&
    Array.isArray(value.collections) &&
    value.collections.every(isCollection)
  );
}

function isCollection(value: unknown): value is CollectionDescriptor {
  return (
    isRecord(value) &&
    typeof value.role === "string" &&
    typeof value.path === "string" &&
    value.format === "jsonl" &&
    typeof value.schemaId === "string" &&
    value.authority === "curator-authored"
  );
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): RecordValue | undefined {
  return isRecord(value) ? value : undefined;
}

function without(record: RecordValue, keys: readonly string[]): RecordValue {
  const excluded = new Set(keys);
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !excluded.has(key)),
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
