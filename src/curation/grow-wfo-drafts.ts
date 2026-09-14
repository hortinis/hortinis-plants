import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";
import { readJsonLines, writeJsonLines } from "../serialization/json-lines.js";

type RecordValue = Readonly<Record<string, unknown>>;

export interface GrowWfoDraftOptions {
  readonly growRunDirectory: string;
  readonly wfoRunDirectory: string;
  readonly outputDirectory: string;
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
  const growRunDirectory = resolve(options.growRunDirectory);
  const wfoRunDirectory = resolve(options.wfoRunDirectory);
  const outputDirectory = resolve(options.outputDirectory);
  const [sourceRecords, growCandidates, taxonCandidates] = await Promise.all([
    readRecords(join(growRunDirectory, "source-records.jsonl")),
    readRecords(join(growRunDirectory, "candidates.jsonl")),
    readRecords(join(wfoRunDirectory, "taxon-match-candidates.jsonl")),
  ]);
  const [growManifest, wfoManifest] = await Promise.all([
    readJson(join(growRunDirectory, "importer-run-manifest.json")),
    readJson(join(wfoRunDirectory, "reconciliation-run-manifest.json")),
  ]);

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
          taxonBySourceRecord.get(sourceRecordId)!,
          "id",
        ),
        proposedNextStep: "decide-new-or-existing-hortinis-subject",
      };
    })
    .sort(compareId);

  const assertionQueue = growCandidates.map(assertionDraft).sort(compareId);

  const crosswalkQueue = taxonCandidates
    .filter(isAutomaticIdentityCandidate)
    .map((candidate) => crosswalkDraft(candidate))
    .sort(compareId);

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

  const stagingDirectory = `${outputDirectory}.staging`;
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });
  await Promise.all([
    writeRecords(
      join(stagingDirectory, "identity-review-queue.jsonl"),
      identityQueue,
    ),
    writeRecords(
      join(stagingDirectory, "subject-mapping-review-queue.jsonl"),
      subjectQueue,
    ),
    writeRecords(
      join(stagingDirectory, "assertion-review-queue.jsonl"),
      assertionQueue,
    ),
    writeRecords(
      join(stagingDirectory, "taxonomy-crosswalk-review-queue.jsonl"),
      crosswalkQueue,
    ),
    writeRecords(
      join(stagingDirectory, "geographic-context-review-queue.jsonl"),
      geographyQueue,
    ),
    writeRecords(join(stagingDirectory, "curation-issues.jsonl"), issueQueue),
  ]);

  const counts = {
    sourceRecords: sourceRecords.length,
    identityReviewItems: identityQueue.length,
    subjectMappingReviewItems: subjectQueue.length,
    assertionReviewItems: assertionQueue.length,
    taxonomyCrosswalkReviewItems: crosswalkQueue.length,
    geographicContextReviewItems: geographyQueue.length,
    openCurationIssues: issueQueue.length,
  };
  await writeFile(
    join(stagingDirectory, "draft-manifest.json"),
    withNewline({
      kind: "grow-wfo-c4-review-drafts",
      reviewState: "unreviewed",
      inputs: {
        growImporterRun: outputSummary(growManifest),
        wfoReconciliationRun: outputSummary(wfoManifest),
      },
      counts,
      files: [
        "identity-review-queue.jsonl",
        "subject-mapping-review-queue.jsonl",
        "assertion-review-queue.jsonl",
        "taxonomy-crosswalk-review-queue.jsonl",
        "geographic-context-review-queue.jsonl",
        "curation-issues.jsonl",
      ],
    }),
  );

  await mkdir(dirname(outputDirectory), { recursive: true });
  await rm(outputDirectory, { recursive: true, force: true });
  await rename(stagingDirectory, outputDirectory);
  return { outputDirectory, counts };
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

async function readJson(path: string): Promise<RecordValue> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  const record = asRecord(value);
  if (record === undefined)
    throw new Error(`${path} must contain a JSON object`);
  return record;
}

async function writeRecords(
  path: string,
  records: readonly RecordValue[],
): Promise<void> {
  await pipeline(
    Readable.from(writeJsonLines(records)),
    createWriteStream(path, { flags: "w" }),
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

function crosswalkDraft(candidate: RecordValue): RecordValue {
  const alternatives = arrayField(candidate, "alternatives");
  const alternative = asRecord(alternatives[0]);
  if (alternative === undefined)
    throw new Error(
      `WFO candidate ${requiredString(candidate, "id")} has no alternative`,
    );
  const acceptedName = asRecord(alternative.acceptedName);
  const target = acceptedName ?? alternative;
  const externalIdentifier = asRecord(target.externalIdentifier);
  if (externalIdentifier === undefined)
    throw new Error(
      `WFO candidate ${requiredString(candidate, "id")} has no external identifier`,
    );
  return {
    id: `crosswalk_review_${requiredString(candidate, "id")}`,
    reviewState: "unreviewed",
    proposedStatus: "accepted",
    proposedMatchMethod:
      stringField(candidate, "outcome") === "candidate-synonym"
        ? "exact-synonym"
        : "exact-name",
    requiredBeforeAuthoring: "mint-or-select-reviewed-hortinis-taxon-id",
    sourceTaxonomyCandidateId: requiredString(candidate, "id"),
    sourceRecordId: requiredString(
      asRecord(candidate.source)!,
      "sourceRecordId",
    ),
    proposedExternalTaxonomyCrosswalk: {
      externalIdentifier,
      externalName: requiredString(target, "scientificName"),
      ...(stringField(target, "authorship") === undefined
        ? {}
        : { authorship: stringField(target, "authorship") }),
      taxonRank: requiredString(target, "taxonRank"),
      taxonomicStatus: requiredString(target, "taxonomicStatus"),
      acceptedNameIdentifier:
        stringField(alternative, "acceptedNameIdentifier") ??
        stringField(asRecord(target.externalIdentifier), "identifier"),
      locator: requiredString(target, "sourceLocator"),
    },
  };
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

function outputSummary(manifest: RecordValue): RecordValue {
  return {
    configurationSha256: stringField(manifest, "configurationSha256"),
    outputs: manifest.outputs,
    sourceManifests: manifest.sourceManifests ?? manifest.sourceManifest,
  };
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

function requiredString(record: RecordValue, key: string): string {
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
