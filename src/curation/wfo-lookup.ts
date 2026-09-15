import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeScientificName } from "../adapters/wfo/adapter.js";
import type { WfoSnapshotRecord } from "../adapters/wfo/types.js";
import {
  WFO_ARCHIVE_BYTE_SIZE,
  WFO_ARCHIVE_LOCATOR,
  WFO_ARCHIVE_MD5,
  WFO_CLASSIFICATION_FILENAME,
  WFO_PROVIDER_ID,
  WFO_SOURCE_ID,
  WFO_SOURCE_MANIFEST_ID,
  WFO_SOURCE_RELEASE_ID,
} from "../adapters/wfo/constants.js";
import { readWfoSnapshot } from "../adapters/wfo/read-snapshot.js";
import { validate, type ValidationApi } from "../schema/validation-api.js";

export type WfoLookupQuery =
  | { readonly by: "name"; readonly value: string }
  | { readonly by: "id"; readonly value: string };

export interface WfoLookupResult {
  readonly kind: "wfo-lookup-proposal";
  readonly reviewState: "unreviewed";
  readonly snapshot: {
    readonly sourceManifestId: string;
    readonly sourceReleaseId: string;
    readonly sha256: string;
  };
  readonly query: WfoLookupQuery;
  readonly matches: readonly WfoLookupRecord[];
  readonly acceptedNameTargets: readonly WfoLookupRecord[];
}

export interface WfoLookupRecord {
  readonly externalIdentifier: {
    readonly sourceId: string;
    readonly sourceManifestId: string;
    readonly sourceReleaseId: string;
    readonly identifier: string;
  };
  readonly scientificName: string;
  readonly authorship?: string;
  readonly taxonRank: string;
  readonly taxonomicStatus: string;
  readonly acceptedNameUsageId?: string;
  readonly parentNameUsageId?: string;
  readonly genus?: string;
  readonly family?: string;
  readonly sourceLocator: string;
}

/** Verify the tracked WFO pin and return the exact archive SHA-256. */
export async function verifyPinnedWfoArchive(options: {
  readonly snapshotPath: string;
  readonly sourceManifestPath?: string;
  readonly validationApi?: ValidationApi;
}): Promise<{ readonly sha256: string }> {
  const repositoryRoot = resolve(
    fileURLToPath(new URL("../../", import.meta.url)),
  );
  const sourceManifestPath = resolve(
    options.sourceManifestPath ??
      join(repositoryRoot, "data/sources/wfo/source-manifest.json"),
  );
  const sourceBytes = await readFile(sourceManifestPath);
  const source = parseObject(sourceBytes, sourceManifestPath);
  const validationApi = options.validationApi ?? { validate };
  const manifestValidation = validationApi.validate(
    "urn:hortinis:plants:schema:v1:source-manifest",
    source,
  );
  if (!manifestValidation.valid) {
    throw new Error(
      `WFO source manifest failed validation: ${JSON.stringify(manifestValidation.errors)}`,
    );
  }
  const provider = asRecord(source.provider);
  const release = asRecord(source.release);
  if (
    stringField(source, "id") !== WFO_SOURCE_MANIFEST_ID ||
    stringField(provider, "id") !== WFO_PROVIDER_ID ||
    stringField(release, "identifier") !== WFO_SOURCE_RELEASE_ID
  ) {
    throw new Error(
      "Tracked WFO source manifest does not identify the pinned release",
    );
  }
  const archive = arrayField(source, "resources")
    .map(asRecord)
    .find(
      (resource) => stringField(resource, "locator") === WFO_ARCHIVE_LOCATOR,
    );
  const checksum = asRecord(archive?.checksum);
  if (
    archive === undefined ||
    stringField(checksum, "algorithm") !== "md5" ||
    stringField(checksum, "value") !== WFO_ARCHIVE_MD5 ||
    numberField(archive, "byteSize") !== WFO_ARCHIVE_BYTE_SIZE
  ) {
    throw new Error(
      "Tracked WFO archive metadata differs from the pinned release",
    );
  }
  const { sha256, md5, byteSize } = await digestFile(
    resolve(options.snapshotPath),
  );
  if (md5 !== WFO_ARCHIVE_MD5 || byteSize !== WFO_ARCHIVE_BYTE_SIZE) {
    throw new Error(
      "Local WFO archive does not match the pinned MD5 and byte size",
    );
  }
  return { sha256 };
}

/** Search the pinned snapshot with conservative exact-name matching or WFO ID. */
export async function lookupWfoSnapshot(
  snapshotPath: string,
  query: WfoLookupQuery,
): Promise<{
  readonly matches: readonly WfoSnapshotRecord[];
  readonly acceptedNameTargets: readonly WfoSnapshotRecord[];
}> {
  if (query.value.trim().length === 0) {
    throw new Error("WFO lookup value must not be empty");
  }
  const matches: WfoSnapshotRecord[] = [];
  const normalizedQuery =
    query.by === "name" ? normalizeScientificName(query.value) : undefined;
  for await (const row of readWfoSnapshot(snapshotPath)) {
    const isMatch =
      query.by === "id"
        ? row.taxonID === query.value
        : normalizeScientificName(row.scientificName) === normalizedQuery;
    if (isMatch) matches.push(row);
  }
  matches.sort((left, right) => compareStrings(left.taxonID, right.taxonID));
  if (new Set(matches.map((row) => row.taxonID)).size !== matches.length) {
    throw new Error(
      "WFO snapshot repeats an identifier returned by this lookup",
    );
  }
  const targetIds = new Set(
    matches
      .map((row) => row.acceptedNameUsageID)
      .filter(
        (id) => id.length > 0 && !matches.some((row) => row.taxonID === id),
      ),
  );
  const targets: WfoSnapshotRecord[] = [];
  if (targetIds.size > 0) {
    for await (const row of readWfoSnapshot(snapshotPath)) {
      if (targetIds.has(row.taxonID)) targets.push(row);
    }
  }
  targets.sort((left, right) => compareStrings(left.taxonID, right.taxonID));
  return { matches, acceptedNameTargets: targets };
}

export async function createWfoLookupProposal(options: {
  readonly snapshotPath: string;
  readonly query: WfoLookupQuery;
  readonly sourceManifestPath?: string;
  readonly validationApi?: ValidationApi;
}): Promise<WfoLookupResult> {
  const { sha256 } = await verifyPinnedWfoArchive(options);
  const result = await lookupWfoSnapshot(options.snapshotPath, options.query);
  return {
    kind: "wfo-lookup-proposal",
    reviewState: "unreviewed",
    snapshot: {
      sourceManifestId: WFO_SOURCE_MANIFEST_ID,
      sourceReleaseId: WFO_SOURCE_RELEASE_ID,
      sha256,
    },
    query: options.query,
    matches: result.matches.map(toLookupRecord),
    acceptedNameTargets: result.acceptedNameTargets.map(toLookupRecord),
  };
}

function toLookupRecord(row: WfoSnapshotRecord): WfoLookupRecord {
  return {
    externalIdentifier: {
      sourceId: WFO_SOURCE_ID,
      sourceManifestId: WFO_SOURCE_MANIFEST_ID,
      sourceReleaseId: WFO_SOURCE_RELEASE_ID,
      identifier: row.taxonID,
    },
    scientificName: row.scientificName,
    ...(row.scientificNameAuthorship.length === 0
      ? {}
      : { authorship: row.scientificNameAuthorship }),
    taxonRank: row.taxonRank,
    taxonomicStatus: row.taxonomicStatus,
    ...(row.acceptedNameUsageID.length === 0
      ? {}
      : { acceptedNameUsageId: row.acceptedNameUsageID }),
    ...(row.parentNameUsageID.length === 0
      ? {}
      : { parentNameUsageId: row.parentNameUsageID }),
    ...(row.genus.length === 0 ? {} : { genus: row.genus }),
    ...(row.family.length === 0 ? {} : { family: row.family }),
    sourceLocator: `${WFO_ARCHIVE_LOCATOR}!${WFO_CLASSIFICATION_FILENAME}#row=${row.rowNumber}`,
  };
}

async function digestFile(path: string): Promise<{
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

function parseObject(bytes: Buffer, locator: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${locator}`, { cause: error });
  }
  const object = asRecord(value);
  if (object === undefined)
    throw new Error(`${locator} must contain a JSON object`);
  return object;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function stringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
