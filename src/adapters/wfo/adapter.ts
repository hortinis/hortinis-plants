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
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import {
  GROW_SOURCE_ID,
  GROW_PROVIDER_ID,
  GROW_SOURCE_MANIFEST_ID,
  GROW_SOURCE_RELEASE_ID,
  IMPORT_DIAGNOSTIC_SCHEMA,
  MATCH_METHOD,
  NAME_NORMALIZATION_ID,
  RECONCILIATION_MANIFEST_SCHEMA,
  SOURCE_MANIFEST_SCHEMA,
  TAXON_MATCH_CANDIDATE_SCHEMA,
  WFO_ARCHIVE_LOCATOR,
  WFO_ARCHIVE_MD5,
  WFO_ARCHIVE_BYTE_SIZE,
  WFO_PROVIDER_ID,
  WFO_SOURCE_ID,
  WFO_SOURCE_MANIFEST_ID,
  WFO_SOURCE_RELEASE_ID,
  WFO_TAXONOMIC_RECORD_SCHEMA,
} from "./constants.js";
import { readWfoSnapshot, WfoSnapshotError } from "./read-snapshot.js";
import type {
  GrowImportRecord,
  GrowNameRecord,
  TaxonMatchCandidate,
  TaxonMatchOutcome,
  WfoDiagnostic,
  WfoSnapshotRecord,
  WfoStatusCategory,
  WfoTaxonomicOutputRecord,
  WfoTaxonMatchAlternative,
} from "./types.js";
import { readJsonLines } from "../../serialization/json-lines.js";
import { serializeCanonicalJson } from "../../serialization/canonical-json.js";
import { validate, type ValidationApi } from "../../schema/validation-api.js";

const WFO_SOURCE_MANIFEST_PATH = "data/sources/wfo/source-manifest.json";
const GROW_SOURCE_MANIFEST_PATH = "data/sources/grow/source-manifest.json";
const RECONCILIATION_OUTPUTS = [
  {
    path: "taxon-match-candidates.jsonl",
    schemaId: TAXON_MATCH_CANDIDATE_SCHEMA,
  },
  {
    path: "wfo-taxonomic-records.jsonl",
    schemaId: WFO_TAXONOMIC_RECORD_SCHEMA,
  },
  {
    path: "diagnostics.jsonl",
    schemaId: IMPORT_DIAGNOSTIC_SCHEMA,
  },
] as const;

export interface WfoImportOptions {
  readonly growRunDirectory: string;
  readonly snapshotPath: string;
  readonly outputDirectory: string;
  readonly wfoSourceManifestPath?: string;
  readonly growSourceManifestPath?: string;
  readonly validationApi?: ValidationApi;
}

export interface WfoImportResult {
  readonly outputDirectory: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly candidates: readonly TaxonMatchCandidate[];
  readonly taxonomicRecords: readonly WfoTaxonomicOutputRecord[];
  readonly diagnostics: readonly WfoDiagnostic[];
}

interface SourceManifest {
  readonly id?: unknown;
  readonly provider?: { readonly id?: unknown };
  readonly release?: { readonly identifier?: unknown };
  readonly licenceReview?: {
    readonly status?: unknown;
    readonly declaredLicence?: unknown;
  };
  readonly profileEligibility?: readonly {
    readonly profile?: unknown;
    readonly decision?: unknown;
  }[];
  readonly resources?: readonly {
    readonly locator?: unknown;
    readonly checksum?: {
      readonly algorithm?: unknown;
      readonly value?: unknown;
    };
    readonly byteSize?: unknown;
  }[];
}

interface GrowRunManifest {
  readonly sourceManifest?: {
    readonly id?: unknown;
    readonly sha256?: unknown;
  };
  readonly outputs?: readonly {
    readonly path?: unknown;
    readonly sha256?: unknown;
    readonly byteSize?: unknown;
    readonly recordCount?: unknown;
  }[];
}

interface SourceInfo {
  readonly manifest: SourceManifest;
  readonly manifestBytes: Buffer;
  readonly sha256: string;
  readonly releaseId: string;
  readonly sourceId: string;
}

interface FileMetadata {
  readonly sha256: string;
  readonly md5: string;
  readonly byteSize: number;
}

export type WfoSelectionReason =
  WfoTaxonomicOutputRecord["selectionReasons"][number];

export interface SelectedWfoRecord {
  readonly row: WfoSnapshotRecord;
  readonly reasons: Set<WfoSelectionReason>;
}

export interface CandidateSourceMetadata {
  readonly sourceId: string;
  readonly sourceManifestId: string;
  readonly sourceReleaseId: string;
}

export class ExactWfoNameMatchIndex {
  readonly #requestedNames: ReadonlySet<string>;
  readonly #matches = new Map<string, WfoSnapshotRecord[]>();
  readonly #seenWfoIds = new Set<string>();
  #rowsScanned = 0;

  constructor(growNames: readonly GrowNameRecord[]) {
    this.#requestedNames = new Set(
      growNames.map((record) => normalizeScientificName(record.scientificName)),
    );
  }

  add(row: WfoSnapshotRecord): void {
    this.#rowsScanned += 1;
    if (this.#seenWfoIds.has(row.taxonID)) {
      throw new WfoSnapshotError(
        "UNSUPPORTED_FORMAT",
        `WFO snapshot repeats taxonID ${row.taxonID} at classification.csv record ${row.rowNumber}`,
      );
    }
    this.#seenWfoIds.add(row.taxonID);
    const normalized = normalizeScientificName(row.scientificName);
    if (!this.#requestedNames.has(normalized)) return;
    const rows = this.#matches.get(normalized) ?? [];
    rows.push(row);
    this.#matches.set(normalized, rows);
  }

  result(): {
    readonly matchesByName: Map<string, WfoSnapshotRecord[]>;
    readonly rowsScanned: number;
  } {
    for (const rows of this.#matches.values()) {
      rows.sort((left, right) => left.taxonID.localeCompare(right.taxonID));
    }
    return { matchesByName: this.#matches, rowsScanned: this.#rowsScanned };
  }
}

/** Reconcile every GROW source record against a locally pinned WFO snapshot. */
export async function importWfoSnapshot(
  options: WfoImportOptions,
): Promise<WfoImportResult> {
  const validationApi = options.validationApi ?? { validate };
  const outputDirectory = resolve(options.outputDirectory);
  const growRunDirectory = resolve(options.growRunDirectory);
  const wfoManifestPath = resolve(
    options.wfoSourceManifestPath ?? WFO_SOURCE_MANIFEST_PATH,
  );
  const growManifestPath = resolve(
    options.growSourceManifestPath ?? GROW_SOURCE_MANIFEST_PATH,
  );
  const snapshotPath = resolve(options.snapshotPath);

  const wfoSource = await readSourceInfo(wfoManifestPath, WFO_SOURCE_ID);
  assertSchema(
    validationApi,
    SOURCE_MANIFEST_SCHEMA,
    wfoSource.manifest,
    "WFO source manifest",
  );
  assertExpectedWfoSource(wfoSource.manifest);
  const growSource = await readSourceInfo(growManifestPath, GROW_SOURCE_ID);
  assertSchema(
    validationApi,
    SOURCE_MANIFEST_SCHEMA,
    growSource.manifest,
    "GROW source manifest",
  );
  assertExpectedGrowSource(growSource.manifest);
  const wfoResource = findDeclaredResource(
    wfoSource.manifest,
    WFO_ARCHIVE_LOCATOR,
  );
  assertPinnedWfoResource(wfoResource);
  await assertSnapshotAvailable(snapshotPath);
  const snapshotMetadata = await hashFile(snapshotPath);
  assertResourceMatches(snapshotMetadata, wfoResource, WFO_ARCHIVE_LOCATOR);

  const growRunManifestPath = join(
    growRunDirectory,
    "importer-run-manifest.json",
  );
  const growRunManifestBytes = await readFile(growRunManifestPath).catch(
    (error: unknown) => {
      throw new Error(
        `Unable to read GROW importer run manifest at ${growRunManifestPath}`,
        { cause: error },
      );
    },
  );
  const growRunManifestValue = parseJson(
    growRunManifestBytes,
    growRunManifestPath,
  );
  const growRunManifest = objectValue<GrowRunManifest>(growRunManifestValue);
  assertGrowRunSource(growRunManifest, growSource);
  const growRecordsOutput = findGrowRecordsOutput(growRunManifest);
  const growRecordsPath = join(growRunDirectory, growRecordsOutput.path);
  const growRecordsMetadata = await hashFile(growRecordsPath);
  if (growRecordsMetadata.sha256 !== growRecordsOutput.sha256) {
    throw new Error(
      `GROW source-record output checksum mismatch: expected ${growRecordsOutput.sha256}, got ${growRecordsMetadata.sha256}`,
    );
  }
  if (
    growRecordsOutput.byteSize !== undefined &&
    growRecordsMetadata.byteSize !== growRecordsOutput.byteSize
  ) {
    throw new Error(
      "GROW source-record output byte size does not match its run manifest",
    );
  }

  const growNames = await readGrowNames(growRecordsPath);
  if (
    growRecordsOutput.recordCount !== undefined &&
    growNames.length !== growRecordsOutput.recordCount
  ) {
    throw new Error(
      "GROW source-record output count does not match its run manifest",
    );
  }

  const { matchesByName, rowsScanned } = await findExactWfoMatches(
    snapshotPath,
    growNames,
  );
  const acceptedTargetSelection = await loadAcceptedTargets(
    snapshotPath,
    matchesByName,
  );
  const selectedRows = acceptedTargetSelection.selectedRows;
  const closureRowsScanned = await addTaxonomicClosure(
    snapshotPath,
    matchesByName,
    selectedRows,
  );
  const candidates = createTaxonMatchCandidates(
    growNames,
    matchesByName,
    selectedRows,
    candidateSourceMetadata(wfoSource),
    candidateSourceMetadata(growSource),
    snapshotMetadata.sha256,
  );
  const taxonomicRecords = [...selectedRows.values()]
    .map((selected) =>
      toTaxonomicOutput(
        selected.row,
        [...selected.reasons],
        candidateSourceMetadata(wfoSource),
      ),
    )
    .sort((left, right) =>
      left.externalIdentifier.identifier.localeCompare(
        right.externalIdentifier.identifier,
      ),
    );
  const diagnostics = createDiagnostics(candidates);

  const sourceManifests = [wfoSource, growSource]
    .map((source) => ({
      id: source.manifest.id as string,
      sha256: source.sha256,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const inputs = [
    {
      locator: WFO_ARCHIVE_LOCATOR,
      sha256: snapshotMetadata.sha256,
      byteSize: snapshotMetadata.byteSize,
      role: "source-snapshot",
    },
    {
      locator: "grow-import-run:importer-run-manifest.json",
      sha256: hashBuffer(growRunManifestBytes),
      byteSize: growRunManifestBytes.byteLength,
      role: "importer-output",
    },
    {
      locator: `grow-import-run:${growRecordsOutput.path}`,
      sha256: growRecordsMetadata.sha256,
      byteSize: growRecordsMetadata.byteSize,
      role: "importer-output",
    },
  ];
  const configuration = {
    wfoRelease: WFO_SOURCE_RELEASE_ID,
    growRelease: GROW_SOURCE_RELEASE_ID,
    classificationEntry: "classification.csv",
    nameNormalization: NAME_NORMALIZATION_ID,
    matchMethod: MATCH_METHOD,
    outputScope:
      "GROW exact-match candidate rows, accepted-name targets, their synonyms, genus and family rows",
  };
  const outputs = RECONCILIATION_OUTPUTS.map((output) => ({
    ...output,
    records:
      output.path === "taxon-match-candidates.jsonl"
        ? candidates
        : output.path === "wfo-taxonomic-records.jsonl"
          ? taxonomicRecords
          : diagnostics,
  }));
  const manifest = {
    schemaVersion: "1.0.0",
    job: { name: "grow-wfo-taxonomy-reconciliation", version: "0.1.0" },
    sourceManifests,
    inputs,
    configuration,
    configurationSha256: hashBuffer(serializeCanonicalJson(configuration)),
    tools: { csvParse: "6.2.1", unzipper: "0.10.14", node: process.version },
    outputs: [],
    counts: buildCounts(
      growNames,
      candidates,
      diagnostics,
      taxonomicRecords,
      rowsScanned + acceptedTargetSelection.rowsScanned + closureRowsScanned,
    ),
  };
  const published = await writeRun(
    outputDirectory,
    outputs,
    manifest,
    validationApi,
  );
  return {
    outputDirectory,
    manifest: published.manifest,
    candidates,
    taxonomicRecords,
    diagnostics,
  };
}

export function normalizeScientificName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

export function classifyWfoStatus(
  record: WfoSnapshotRecord,
): WfoStatusCategory {
  const status = record.taxonomicStatus.trim().toLocaleLowerCase("en");
  if (status === "accepted" || status === "accepted name") return "accepted";
  if (status.includes("unplaced")) return "unplaced";
  if (status.includes("synonym")) return "synonym";
  return "other";
}

async function readSourceInfo(
  path: string,
  sourceId: string,
): Promise<SourceInfo> {
  const manifestBytes = await readFile(path).catch((error: unknown) => {
    throw new Error(`Unable to read source manifest at ${path}`, {
      cause: error,
    });
  });
  const manifest = objectValue<SourceManifest>(parseJson(manifestBytes, path));
  const releaseId = stringValue(
    manifest.release?.identifier,
    "release.identifier",
  );
  stringValue(manifest.provider?.id, "provider.id");
  return {
    manifest,
    manifestBytes,
    sha256: hashBuffer(manifestBytes),
    releaseId,
    sourceId,
  };
}

function assertExpectedWfoSource(manifest: SourceManifest): void {
  if (
    manifest.id !== WFO_SOURCE_MANIFEST_ID ||
    manifest.provider?.id !== WFO_PROVIDER_ID ||
    manifest.release?.identifier !== WFO_SOURCE_RELEASE_ID
  ) {
    throw new Error(
      "WFO source manifest does not identify the pinned 2026-06 release",
    );
  }
  assertSourceRights(manifest, "CC0-1.0", "WFO");
}

function assertExpectedGrowSource(manifest: SourceManifest): void {
  if (
    manifest.id !== GROW_SOURCE_MANIFEST_ID ||
    manifest.provider?.id !== GROW_PROVIDER_ID ||
    manifest.release?.identifier !== GROW_SOURCE_RELEASE_ID
  ) {
    throw new Error(
      "GROW source manifest does not identify the pinned 2020 release",
    );
  }
  assertSourceRights(manifest, "CC-BY-4.0", "GROW");
}

function assertSourceRights(
  manifest: SourceManifest,
  expectedLicence: string,
  sourceName: string,
): void {
  if (
    manifest.licenceReview?.status !== "accepted" ||
    manifest.licenceReview.declaredLicence !== expectedLicence
  ) {
    throw new Error(
      `${sourceName} source manifest does not have an accepted ${expectedLicence} licence review`,
    );
  }
  for (const profile of ["commercial", "dev-validation"]) {
    if (
      !manifest.profileEligibility?.some(
        (entry) => entry.profile === profile && entry.decision === "eligible",
      )
    ) {
      throw new Error(
        `${sourceName} source manifest is not eligible for the ${profile} profile`,
      );
    }
  }
}

function assertGrowRunSource(run: GrowRunManifest, source: SourceInfo): void {
  if (
    run.sourceManifest?.id !== GROW_SOURCE_MANIFEST_ID ||
    run.sourceManifest.sha256 !== source.sha256
  ) {
    throw new Error(
      "GROW importer run does not reference the checked-in GROW source manifest",
    );
  }
}

async function readGrowNames(path: string): Promise<GrowNameRecord[]> {
  const names: GrowNameRecord[] = [];
  const seenIds = new Set<string>();
  for await (const entry of readJsonLines(createReadStream(path))) {
    const record = objectValue<GrowImportRecord>(entry.value);
    const sourceRecordId = stringValue(record.sourceRecordId, "sourceRecordId");
    const sourceLocator = stringValue(record.sourceLocator, "sourceLocator");
    const sourceName = record.fields?.["Full taxonomic name"];
    if (typeof sourceName !== "string" || sourceName.trim().length === 0) {
      throw new Error(
        `GROW source record ${sourceRecordId} has no scientific name at ${sourceLocator}`,
      );
    }
    if (seenIds.has(sourceRecordId)) {
      throw new Error(`GROW source-record output repeats ID ${sourceRecordId}`);
    }
    seenIds.add(sourceRecordId);
    names.push({ sourceRecordId, sourceLocator, scientificName: sourceName });
  }
  if (names.length === 0) throw new Error("GROW source-record output is empty");
  return names.sort((left, right) =>
    left.sourceRecordId.localeCompare(right.sourceRecordId, "en", {
      numeric: true,
    }),
  );
}

async function findExactWfoMatches(
  snapshotPath: string,
  growNames: readonly GrowNameRecord[],
): Promise<{
  readonly matchesByName: Map<string, WfoSnapshotRecord[]>;
  readonly rowsScanned: number;
}> {
  const index = new ExactWfoNameMatchIndex(growNames);
  for await (const row of readWfoSnapshot(snapshotPath)) {
    index.add(row);
  }
  return index.result();
}

async function loadAcceptedTargets(
  snapshotPath: string,
  matchesByName: ReadonlyMap<string, readonly WfoSnapshotRecord[]>,
): Promise<{
  readonly selectedRows: Map<string, SelectedWfoRecord>;
  readonly rowsScanned: number;
}> {
  const selected = new Map<string, SelectedWfoRecord>();
  const wantedAcceptedIds = new Set<string>();
  for (const rows of matchesByName.values()) {
    for (const row of rows) {
      addSelected(selected, row, "source-name-match");
      if (
        row.acceptedNameUsageID.length > 0 &&
        row.acceptedNameUsageID !== row.taxonID
      ) {
        wantedAcceptedIds.add(row.acceptedNameUsageID);
      }
    }
  }
  if (wantedAcceptedIds.size === 0) {
    return { selectedRows: selected, rowsScanned: 0 };
  }

  let rowsScanned = 0;
  for await (const row of readWfoSnapshot(snapshotPath)) {
    rowsScanned += 1;
    if (!wantedAcceptedIds.has(row.taxonID)) continue;
    addSelected(selected, row, "accepted-name-target");
  }
  // Missing targets are retained as unresolved candidate relationships; they are not fatal.
  return { selectedRows: selected, rowsScanned };
}

async function addTaxonomicClosure(
  snapshotPath: string,
  matchesByName: ReadonlyMap<string, readonly WfoSnapshotRecord[]>,
  selected: Map<string, SelectedWfoRecord>,
): Promise<number> {
  const acceptedIds = new Set<string>();
  for (const item of selected.values()) {
    if (classifyWfoStatus(item.row) === "accepted") {
      acceptedIds.add(item.row.taxonID);
    }
  }
  const genusNames = new Set<string>();
  const familyNames = new Set<string>();
  for (const item of selected.values()) {
    if (item.row.genus.length > 0)
      genusNames.add(normalizeScientificName(item.row.genus));
    if (item.row.family.length > 0)
      familyNames.add(normalizeScientificName(item.row.family));
  }
  const sourceMatchedIds = new Set<string>();
  for (const rows of matchesByName.values()) {
    for (const row of rows) sourceMatchedIds.add(row.taxonID);
  }

  let rowsScanned = 0;
  for await (const row of readWfoSnapshot(snapshotPath)) {
    rowsScanned += 1;
    const normalizedName = normalizeScientificName(row.scientificName);
    const rank = row.taxonRank.toLocaleLowerCase("en");
    if (
      row.acceptedNameUsageID.length > 0 &&
      acceptedIds.has(row.acceptedNameUsageID)
    ) {
      addSelected(selected, row, "synonym-of-selected-taxon");
    }
    if (sourceMatchedIds.has(row.taxonID)) {
      addSelected(selected, row, "source-name-match");
    }
    if (acceptedIds.has(row.taxonID)) {
      addSelected(selected, row, "accepted-name-target");
    }
    if (rank === "genus" && genusNames.has(normalizedName)) {
      addSelected(selected, row, "genus-ancestor");
    }
    if (rank === "family" && familyNames.has(normalizedName)) {
      addSelected(selected, row, "family-ancestor");
    }
  }
  return rowsScanned;
}

function addSelected(
  selected: Map<string, SelectedWfoRecord>,
  row: WfoSnapshotRecord,
  reason: WfoTaxonomicOutputRecord["selectionReasons"][number],
): void {
  const current = selected.get(row.taxonID);
  if (current === undefined) {
    selected.set(row.taxonID, { row, reasons: new Set([reason]) });
  } else {
    current.reasons.add(reason);
  }
}

export function createTaxonMatchCandidates(
  growNames: readonly GrowNameRecord[],
  matchesByName: ReadonlyMap<string, readonly WfoSnapshotRecord[]>,
  selectedRows: ReadonlyMap<string, SelectedWfoRecord>,
  wfoSource: CandidateSourceMetadata,
  growSource: CandidateSourceMetadata,
  snapshotSha256: string,
): TaxonMatchCandidate[] {
  return growNames.map((grow) => {
    const comparisonName = normalizeScientificName(grow.scientificName);
    const rows = matchesByName.get(comparisonName) ?? [];
    const alternatives = rows.map((row) =>
      toAlternative(row, selectedRows, wfoSource),
    );
    const outcome = determineOutcome(rows, selectedRows);
    return {
      id: stableId(
        `taxon_match_${grow.sourceRecordId}`,
        `${growSource.sourceManifestId}|${growSource.sourceReleaseId}|${grow.sourceRecordId}|${wfoSource.sourceReleaseId}`,
      ),
      source: {
        sourceId: growSource.sourceId,
        sourceManifestId: growSource.sourceManifestId,
        sourceReleaseId: growSource.sourceReleaseId,
        sourceRecordId: grow.sourceRecordId,
        sourceLocator: grow.sourceLocator,
      },
      snapshot: {
        sourceManifestId: wfoSource.sourceManifestId,
        sourceReleaseId: wfoSource.sourceReleaseId,
        sha256: snapshotSha256,
      },
      sourceName: grow.scientificName,
      comparisonName,
      normalization: NAME_NORMALIZATION_ID,
      outcome,
      alternatives,
      ...(rows.length === 0 ? {} : { matchMethod: MATCH_METHOD }),
      reviewState: "unreviewed",
    };
  });
}

function determineOutcome(
  rows: readonly WfoSnapshotRecord[],
  selected: ReadonlyMap<string, SelectedWfoRecord>,
): TaxonMatchOutcome {
  const row = rows.length === 1 ? rows[0] : undefined;
  const acceptedTarget =
    row === undefined || row.acceptedNameUsageID.length === 0
      ? undefined
      : selected.get(row.acceptedNameUsageID)?.row;
  return determineTaxonMatchOutcome(rows, acceptedTarget);
}

export function determineTaxonMatchOutcome(
  rows: readonly WfoSnapshotRecord[],
  acceptedTarget?: WfoSnapshotRecord,
): TaxonMatchOutcome {
  if (rows.length === 0) return "unmatched";
  if (rows.length > 1) return "ambiguous";
  const row = rows[0];
  if (row === undefined) return "unmatched";
  const category = classifyWfoStatus(row);
  if (category === "accepted") return "candidate-accepted";
  if (category === "unplaced") return "unplaced";
  if (category === "synonym") {
    return acceptedTarget !== undefined &&
      classifyWfoStatus(acceptedTarget) === "accepted"
      ? "candidate-synonym"
      : "unresolved-status";
  }
  return "unresolved-status";
}

function toAlternative(
  row: WfoSnapshotRecord,
  selected: ReadonlyMap<string, SelectedWfoRecord>,
  source: CandidateSourceMetadata,
): WfoTaxonMatchAlternative {
  const base = {
    externalIdentifier: externalIdentifier(row.taxonID, source),
    scientificName: row.scientificName,
    ...(row.scientificNameAuthorship.length === 0
      ? {}
      : { authorship: row.scientificNameAuthorship }),
    taxonRank: row.taxonRank,
    taxonomicStatus: row.taxonomicStatus,
    statusCategory: classifyWfoStatus(row),
    ...(row.acceptedNameUsageID.length === 0
      ? {}
      : { acceptedNameIdentifier: row.acceptedNameUsageID }),
    sourceLocator: wfoRowLocator(row),
  };
  const accepted =
    row.acceptedNameUsageID === row.taxonID
      ? undefined
      : selected.get(row.acceptedNameUsageID)?.row;
  return accepted === undefined
    ? base
    : {
        ...base,
        acceptedName: {
          externalIdentifier: externalIdentifier(accepted.taxonID, source),
          scientificName: accepted.scientificName,
          ...(accepted.scientificNameAuthorship.length === 0
            ? {}
            : { authorship: accepted.scientificNameAuthorship }),
          taxonRank: accepted.taxonRank,
          taxonomicStatus: accepted.taxonomicStatus,
          sourceLocator: wfoRowLocator(accepted),
        },
      };
}

function toTaxonomicOutput(
  row: WfoSnapshotRecord,
  reasons: WfoTaxonomicOutputRecord["selectionReasons"],
  source: CandidateSourceMetadata,
): WfoTaxonomicOutputRecord {
  return {
    externalIdentifier: externalIdentifier(row.taxonID, source),
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
    sourceLocator: wfoRowLocator(row),
    selectionReasons: [...new Set(reasons)].sort(),
  };
}

function createDiagnostics(
  candidates: readonly TaxonMatchCandidate[],
): WfoDiagnostic[] {
  const diagnostics: WfoDiagnostic[] = [];
  for (const candidate of candidates) {
    const source = candidate.source;
    if (
      candidate.outcome === "candidate-accepted" ||
      candidate.outcome === "candidate-synonym"
    )
      continue;
    const codeByOutcome: Readonly<
      Record<
        Exclude<TaxonMatchOutcome, "candidate-accepted" | "candidate-synonym">,
        string
      >
    > = {
      ambiguous: "AMBIGUOUS_TAXON_MATCH",
      unplaced: "UNPLACED_TAXON_NAME",
      "unresolved-status": "UNRESOLVED_TAXON_STATUS",
      unmatched: "UNMATCHED_TAXON_NAME",
    };
    diagnostics.push({
      kind: "unresolved-mapping",
      code: codeByOutcome[candidate.outcome],
      message: outcomeMessage(candidate.outcome),
      sourceRecordId: source.sourceRecordId,
      sourceLocator: source.sourceLocator,
      originalValue: candidate.sourceName,
      details: {
        outcome: candidate.outcome,
        comparisonName: candidate.comparisonName,
        alternativeWfoIds: candidate.alternatives.map(
          (alternative) => alternative.externalIdentifier.identifier,
        ),
      },
    });
  }
  return diagnostics.sort((left, right) =>
    `${left.code}\u0000${left.sourceRecordId ?? ""}`.localeCompare(
      `${right.code}\u0000${right.sourceRecordId ?? ""}`,
    ),
  );
}

function outcomeMessage(outcome: TaxonMatchOutcome): string {
  switch (outcome) {
    case "ambiguous":
      return "More than one WFO record has this conservatively normalized exact name; no record was selected.";
    case "unplaced":
      return "An exact WFO name exists but is unplaced in the snapshot.";
    case "unresolved-status":
      return "An exact WFO name exists but its taxonomic status or accepted-name relationship is unresolved.";
    case "unmatched":
      return "No exact WFO name match was found after documented conservative normalization.";
    case "candidate-accepted":
    case "candidate-synonym":
      return "";
  }
}

function buildCounts(
  growNames: readonly GrowNameRecord[],
  candidates: readonly TaxonMatchCandidate[],
  diagnostics: readonly WfoDiagnostic[],
  taxonomicRecords: readonly WfoTaxonomicOutputRecord[],
  wfoRowsScanned: number,
): Record<string, number> {
  const byOutcome = (outcome: TaxonMatchOutcome) =>
    candidates.filter((candidate) => candidate.outcome === outcome).length;
  return {
    growRecords: growNames.length,
    uniqueInputNames: new Set(
      growNames.map((item) => normalizeScientificName(item.scientificName)),
    ).size,
    candidateAccepted: byOutcome("candidate-accepted"),
    candidateSynonym: byOutcome("candidate-synonym"),
    ambiguous: byOutcome("ambiguous"),
    unplaced: byOutcome("unplaced"),
    unresolvedStatus: byOutcome("unresolved-status"),
    unmatched: byOutcome("unmatched"),
    wfoRowsScanned,
    selectedWfoRecords: taxonomicRecords.length,
    unresolvedMappings: diagnostics.length,
  };
}

async function writeRun(
  outputDirectory: string,
  outputs: readonly {
    readonly path: string;
    readonly schemaId: string;
    readonly records: readonly unknown[];
  }[],
  manifestBase: Readonly<Record<string, unknown>>,
  validationApi: ValidationApi,
): Promise<{ readonly manifest: Readonly<Record<string, unknown>> }> {
  const absoluteOutput = resolve(outputDirectory);
  const parent = dirname(absoluteOutput);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, ".wfo-reconciliation-"));
  try {
    const outputDescriptors = [];
    for (const output of outputs) {
      const result = await writeJsonlOutput(
        join(staging, output.path),
        output.records,
        output.schemaId,
        validationApi,
      );
      outputDescriptors.push({
        path: output.path,
        schemaId: output.schemaId,
        ...result,
      });
    }
    const manifest = { ...manifestBase, outputs: outputDescriptors };
    const validation = validationApi.validate(
      RECONCILIATION_MANIFEST_SCHEMA,
      manifest,
    );
    if (!validation.valid) {
      throw new Error(
        `Taxonomy reconciliation manifest failed validation: ${JSON.stringify(validation.errors)}`,
      );
    }
    await writeFile(
      join(staging, "reconciliation-run-manifest.json"),
      Buffer.concat([
        Buffer.from(serializeCanonicalJson(manifest)),
        Buffer.from("\n"),
      ]),
      { flag: "wx" },
    );
    await publishDirectory(staging, absoluteOutput);
    return { manifest };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function writeJsonlOutput(
  path: string,
  records: readonly unknown[],
  schemaId: string,
  validationApi: ValidationApi,
): Promise<{
  readonly sha256: string;
  readonly byteSize: number;
  readonly recordCount: number;
}> {
  const stream = createWriteStream(path, { flags: "wx" });
  const completion = finished(stream);
  void completion.catch(() => undefined);
  const hash = createHash("sha256");
  let byteSize = 0;
  let recordCount = 0;
  try {
    for (const record of records) {
      const validation = validationApi.validate(schemaId, record);
      if (!validation.valid) {
        throw new Error(
          `Output ${path} record ${recordCount + 1} failed ${schemaId}: ${JSON.stringify(validation.errors)}`,
        );
      }
      const framed = Buffer.concat([
        Buffer.from(serializeCanonicalJson(record)),
        Buffer.from("\n"),
      ]);
      if (!stream.write(framed)) await once(stream, "drain");
      hash.update(framed);
      byteSize += framed.byteLength;
      recordCount += 1;
    }
    stream.end();
    await completion;
  } catch (error) {
    stream.destroy();
    throw error;
  }
  return { sha256: hash.digest("hex"), byteSize, recordCount };
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

function findGrowRecordsOutput(run: GrowRunManifest): {
  readonly path: string;
  readonly sha256: string;
  readonly byteSize?: number;
  readonly recordCount?: number;
} {
  const output = run.outputs?.find(
    (item) => item.path === "source-records.jsonl",
  );
  if (
    output === undefined ||
    typeof output.path !== "string" ||
    typeof output.sha256 !== "string"
  ) {
    throw new Error("GROW run manifest does not declare source-records.jsonl");
  }
  return {
    path: output.path,
    sha256: output.sha256,
    ...(typeof output.byteSize === "number"
      ? { byteSize: output.byteSize }
      : {}),
    ...(typeof output.recordCount === "number"
      ? { recordCount: output.recordCount }
      : {}),
  };
}

function findDeclaredResource(
  manifest: SourceManifest,
  locator: string,
): {
  readonly checksum: { readonly algorithm?: unknown; readonly value?: unknown };
  readonly byteSize?: unknown;
} {
  const resource = manifest.resources?.find((item) => item.locator === locator);
  if (resource === undefined) {
    throw new Error(`Source manifest does not declare WFO resource ${locator}`);
  }
  const checksum = resource.checksum;
  if (checksum === undefined) {
    throw new Error(`WFO source manifest has no checksum for ${locator}`);
  }
  if (checksum.algorithm !== "sha256" && checksum.algorithm !== "md5") {
    throw new Error(
      `WFO source manifest has no supported checksum for ${locator}`,
    );
  }
  return {
    checksum,
    ...(resource.byteSize === undefined ? {} : { byteSize: resource.byteSize }),
  };
}

function assertResourceMatches(
  actual: FileMetadata,
  resource: ReturnType<typeof findDeclaredResource>,
  locator: string,
): void {
  const expectedChecksum = String(resource.checksum.value);
  const actualChecksum =
    resource.checksum.algorithm === "md5" ? actual.md5 : actual.sha256;
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `${String(resource.checksum.algorithm).toUpperCase()} mismatch for ${locator}: expected ${expectedChecksum}, got ${actualChecksum}`,
    );
  }
  if (
    typeof resource.byteSize === "number" &&
    actual.byteSize !== resource.byteSize
  ) {
    throw new Error(`Byte size mismatch for ${locator}`);
  }
}

function assertPinnedWfoResource(
  resource: ReturnType<typeof findDeclaredResource>,
): void {
  if (
    resource.checksum.algorithm !== "md5" ||
    resource.checksum.value !== WFO_ARCHIVE_MD5 ||
    resource.byteSize !== WFO_ARCHIVE_BYTE_SIZE
  ) {
    throw new Error(
      "WFO source manifest archive checksum or byte size differs from the pinned Zenodo 2026-06 file",
    );
  }
}

function assertSchema(
  validationApi: ValidationApi,
  schemaId: string,
  value: unknown,
  label: string,
): void {
  const validation = validationApi.validate(schemaId, value);
  if (!validation.valid) {
    throw new Error(
      `${label} failed ${schemaId}: ${JSON.stringify(validation.errors)}`,
    );
  }
}

function externalIdentifier(
  identifier: string,
  source: CandidateSourceMetadata,
) {
  return {
    sourceId: source.sourceId,
    sourceManifestId: source.sourceManifestId,
    sourceReleaseId: source.sourceReleaseId,
    identifier,
  };
}

function candidateSourceMetadata(source: SourceInfo): CandidateSourceMetadata {
  return {
    sourceId: source.sourceId,
    sourceManifestId: source.manifest.id as string,
    sourceReleaseId: source.releaseId,
  };
}

function wfoRowLocator(row: WfoSnapshotRecord): string {
  return `${WFO_ARCHIVE_LOCATOR}!classification.csv#row=${row.rowNumber}`;
}

function stableId(prefix: string, input: string): string {
  const digest = createHash("sha256").update(input).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

async function hashFile(path: string): Promise<FileMetadata> {
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    sha256.update(bytes);
    md5.update(bytes);
    byteSize += bytes.byteLength;
  }
  return { sha256: sha256.digest("hex"), md5: md5.digest("hex"), byteSize };
}

async function assertSnapshotAvailable(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if (isMissingFile(error)) {
      throw new WfoSnapshotError(
        "MISSING_SNAPSHOT",
        `WFO snapshot is missing: ${path}`,
        { cause: error },
      );
    }
    throw error;
  }
}

function hashBuffer(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(bytes: Buffer, locator: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${locator}`, { cause: error });
  }
}

function objectValue<T>(value: unknown): T {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  return value as T;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected a non-empty string for ${field}`);
  }
  return value;
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
