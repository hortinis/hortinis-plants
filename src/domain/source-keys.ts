/**
 * Stable identities for records and semantic children of upstream releases.
 *
 * The serialized form is deliberately JSON rather than a delimiter-joined
 * string: upstream identifiers are opaque and may contain any printable
 * character.  Object property order is fixed by the constructors below.
 */

export interface SourceReleaseKey {
  readonly sourceId: string;
  readonly sourceManifestId: string;
  readonly sourceReleaseId: string;
}

export interface QualifiedSourceRecordKey {
  readonly source: SourceReleaseKey;
  readonly recordId: string;
}

export interface SemanticSubrecordPart {
  readonly kind: string;
  readonly id: string;
}

export interface SemanticSubrecordKey {
  readonly sourceRecordKey: QualifiedSourceRecordKey;
  readonly path: readonly SemanticSubrecordPart[];
}

export interface QualifiedSourceLocationKey {
  readonly source: SourceReleaseKey;
  readonly locationId: string;
}

export function makeSourceReleaseKey(
  sourceId: string,
  sourceManifestId: string,
  sourceReleaseId: string,
): SourceReleaseKey {
  return { sourceId, sourceManifestId, sourceReleaseId };
}

export function makeQualifiedSourceRecordKey(
  source: SourceReleaseKey,
  recordId: string,
): QualifiedSourceRecordKey {
  return { source, recordId };
}

export function makeQualifiedSourceLocationKey(
  source: SourceReleaseKey,
  locationId: string,
): QualifiedSourceLocationKey {
  return { source, locationId };
}

export function makeSemanticSubrecordKey(
  sourceRecordKey: QualifiedSourceRecordKey,
  path: readonly SemanticSubrecordPart[],
): SemanticSubrecordKey {
  if (path.length === 0) throw new Error("Semantic subrecord path is empty");
  return { sourceRecordKey, path };
}

export function serializeSourceReleaseKey(key: SourceReleaseKey): string {
  return JSON.stringify({
    sourceId: key.sourceId,
    sourceManifestId: key.sourceManifestId,
    sourceReleaseId: key.sourceReleaseId,
  });
}

export function serializeQualifiedSourceRecordKey(
  key: QualifiedSourceRecordKey,
): string {
  return JSON.stringify({
    source: {
      sourceId: key.source.sourceId,
      sourceManifestId: key.source.sourceManifestId,
      sourceReleaseId: key.source.sourceReleaseId,
    },
    recordId: key.recordId,
  });
}

export function serializeQualifiedSourceLocationKey(
  key: QualifiedSourceLocationKey,
): string {
  return JSON.stringify({
    source: {
      sourceId: key.source.sourceId,
      sourceManifestId: key.source.sourceManifestId,
      sourceReleaseId: key.source.sourceReleaseId,
    },
    locationId: key.locationId,
  });
}

export function serializeSemanticSubrecordKey(
  key: SemanticSubrecordKey,
): string {
  return JSON.stringify({
    sourceRecordKey: {
      source: {
        sourceId: key.sourceRecordKey.source.sourceId,
        sourceManifestId: key.sourceRecordKey.source.sourceManifestId,
        sourceReleaseId: key.sourceRecordKey.source.sourceReleaseId,
      },
      recordId: key.sourceRecordKey.recordId,
    },
    path: key.path.map((part) => ({ kind: part.kind, id: part.id })),
  });
}

/** Extract a qualified record key from a migrated record or source object. */
export function qualifiedSourceRecordKey(
  value: unknown,
): QualifiedSourceRecordKey | undefined {
  const record = asRecord(value);
  const nested = asRecord(record?.sourceRecordKey);
  const source = asRecord(nested?.source);
  const nestedRecordId = stringValue(nested?.recordId);
  if (source !== undefined && nestedRecordId !== undefined) {
    const release = sourceReleaseKey(source);
    return release === undefined
      ? undefined
      : makeQualifiedSourceRecordKey(release, nestedRecordId);
  }
  const release = sourceReleaseKey(record);
  const recordId =
    stringValue(record?.sourceRecordId) ?? stringValue(record?.recordId);
  return release === undefined || recordId === undefined
    ? undefined
    : makeQualifiedSourceRecordKey(release, recordId);
}

/** Return the canonical map key for a migrated or legacy-shaped record. */
export function sourceRecordKey(value: unknown): string | undefined {
  const key = qualifiedSourceRecordKey(value);
  return key === undefined ? undefined : serializeQualifiedSourceRecordKey(key);
}

export function qualifiedSourceLocationKey(
  value: unknown,
): QualifiedSourceLocationKey | undefined {
  const record = asRecord(value);
  const nested = asRecord(record?.sourceLocationKey);
  const source = asRecord(nested?.source);
  const nestedLocationId = stringValue(nested?.locationId);
  if (source !== undefined && nestedLocationId !== undefined) {
    const release = sourceReleaseKey(source);
    return release === undefined
      ? undefined
      : makeQualifiedSourceLocationKey(release, nestedLocationId);
  }
  const release = sourceReleaseKey(record);
  const location = asRecord(record?.sourceLocation);
  const locationId =
    stringValue(record?.locationId) ??
    stringValue(location?.locationId) ??
    stringValue(location?.locator) ??
    stringValue(location?.sheetCode);
  return release === undefined || locationId === undefined
    ? undefined
    : makeQualifiedSourceLocationKey(release, locationId);
}

export function sourceLocationKey(value: unknown): string | undefined {
  const key = qualifiedSourceLocationKey(value);
  return key === undefined
    ? undefined
    : serializeQualifiedSourceLocationKey(key);
}

function sourceReleaseKey(
  value: RecordValue | undefined,
): SourceReleaseKey | undefined {
  const source = asRecord(value?.source);
  const record = source ?? value;
  const sourceId = stringValue(record?.sourceId);
  const sourceManifestId = stringValue(record?.sourceManifestId);
  const sourceReleaseId = stringValue(record?.sourceReleaseId);
  return sourceId === undefined ||
    sourceManifestId === undefined ||
    sourceReleaseId === undefined
    ? undefined
    : makeSourceReleaseKey(sourceId, sourceManifestId, sourceReleaseId);
}

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
