import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseJsonStrict } from "../serialization/canonical-json.js";
import { readJsonLines } from "../serialization/json-lines.js";
import {
  validateGrowWfoDataset,
  type CurationValidationIssue,
  type GrowWfoValidationOptions,
  type LoadedCurationDataset,
} from "./grow-wfo-validation.js";
import type { DatasetRecord } from "./validation-dataset.js";
import { sourceRecordKey as qualifiedSourceRecordKey } from "../domain/source-keys.js";

type RecordValue = DatasetRecord;

export type CurationStatus =
  "planned" | "in progress" | "validated" | "blocked";

export interface GrowWfoDraftData {
  readonly manifestSha256: string;
  readonly sourceRecords: readonly RecordValue[];
  readonly taxonomyCandidates: readonly RecordValue[];
  readonly assertionCandidates: readonly RecordValue[];
  readonly assertionItems: readonly RecordValue[];
  readonly identityItems: readonly RecordValue[];
  readonly subjectItems: readonly RecordValue[];
  readonly geographyItems: readonly RecordValue[];
}

export interface CompletionGate {
  readonly status: CurationStatus;
  readonly total: number;
  readonly completed: number;
  readonly pending: number;
  readonly mapped?: number;
  readonly rejected?: number;
  readonly deferred?: number;
}

export interface GrowWfoStatusResult {
  readonly valid: boolean;
  readonly issues: readonly CurationValidationIssue[];
  readonly draftsAvailable: boolean;
  readonly draftManifestSha256?: string;
  readonly sourceRecords: CompletionGate;
  readonly assertionCandidates: CompletionGate;
  readonly gates: {
    readonly identity: CompletionGate;
    readonly subject: CompletionGate;
    readonly context: CompletionGate;
    readonly assertion: CompletionGate;
    readonly c4: CurationStatus;
  };
}

const draftFiles = {
  identity: "identity-review-queue.jsonl",
  subject: "subject-mapping-review-queue.jsonl",
  assertion: "assertion-review-queue.jsonl",
  geography: "geographic-context-review-queue.jsonl",
} as const;

export async function getGrowWfoStatus(
  options: GrowWfoValidationOptions = {},
): Promise<GrowWfoStatusResult> {
  const repositoryRoot = resolve(
    options.repositoryRoot ?? resolve(import.meta.dirname, "../.."),
  );
  const draftsDirectory = resolve(
    options.draftsDirectory ??
      join(repositoryRoot, ".cache/curation-drafts/grow-wfo/latest"),
  );
  const draftsAvailable = await directoryExists(draftsDirectory);
  const validation = await validateGrowWfoDataset({
    ...options,
    againstDrafts: draftsAvailable,
  });
  if (!draftsAvailable || validation.loaded === undefined) {
    const unavailable = unavailableGate();
    return {
      valid: validation.valid,
      issues: validation.issues,
      draftsAvailable: false,
      sourceRecords: unavailable,
      assertionCandidates: unavailable,
      gates: {
        identity: unavailable,
        subject: unavailable,
        context: unavailable,
        assertion: unavailable,
        c4: validation.valid ? "in progress" : "blocked",
      },
    };
  }

  let drafts: GrowWfoDraftData;
  try {
    drafts = await readGrowWfoDrafts(draftsDirectory);
  } catch (error) {
    const unavailable = unavailableGate();
    return {
      valid: false,
      issues: [
        ...validation.issues,
        {
          code: "DRAFT_STATUS_READ_FAILED",
          path: draftsDirectory,
          message: errorMessage(error),
        },
      ],
      draftsAvailable: true,
      sourceRecords: unavailable,
      assertionCandidates: unavailable,
      gates: {
        identity: unavailable,
        subject: unavailable,
        context: unavailable,
        assertion: unavailable,
        c4: "blocked",
      },
    };
  }
  const status = calculateCompletionStatus(
    validation.loaded,
    drafts,
    validation.valid,
  );
  return {
    ...status,
    valid: validation.valid,
    issues: validation.issues,
    draftsAvailable: true,
    draftManifestSha256: drafts.manifestSha256,
  };
}

export async function readGrowWfoDrafts(
  draftsDirectory: string,
): Promise<GrowWfoDraftData> {
  const manifestPath = join(draftsDirectory, "draft-manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = parseJsonStrict(manifestBytes);
  if (!isRecord(manifest)) throw new Error(`${manifestPath} must be an object`);

  const identityItems = await readRecords(
    join(draftsDirectory, draftFiles.identity),
  );
  const subjectItems = await readRecords(
    join(draftsDirectory, draftFiles.subject),
  );
  const assertionItems = await readRecords(
    join(draftsDirectory, draftFiles.assertion),
  );
  const geographyItems = await readRecords(
    join(draftsDirectory, draftFiles.geography),
  );
  const sourceRecords = identityItems
    .map((item) => asRecord(item.sourceRecord))
    .filter((record): record is RecordValue => record !== undefined);
  const taxonomyCandidates = identityItems
    .map((item) => asRecord(item.taxonomyCandidate))
    .filter((record): record is RecordValue => record !== undefined);
  const assertionCandidates = assertionItems
    .map((item) => asRecord(item.sourceCandidate))
    .filter((record): record is RecordValue => record !== undefined);

  return {
    manifestSha256: sha256(manifestBytes),
    sourceRecords,
    taxonomyCandidates,
    assertionCandidates,
    assertionItems,
    identityItems,
    subjectItems,
    geographyItems,
  };
}

function calculateCompletionStatus(
  loaded: LoadedCurationDataset,
  drafts: GrowWfoDraftData,
  valid: boolean,
): Omit<
  GrowWfoStatusResult,
  "valid" | "issues" | "draftsAvailable" | "draftManifestSha256"
> {
  const dataset = loaded.dataset;
  const reviews = new Map(
    dataset.reviews.map((review) => [stringField(review, "id"), review]),
  );
  const currentNames = currentByKey(
    dataset.sourceNameDecisions ?? [],
    qualifiedSourceRecordKey,
    "supersedesDecisionId",
  );
  const currentSubjects = currentByKey(
    dataset.sourceSubjectMappings ?? [],
    qualifiedSourceRecordKey,
    "supersedesMappingId",
  );
  const currentAssertions = currentByKey(
    dataset.sourceAssertionDecisions ?? [],
    candidateIdKey,
    "supersedesDecisionId",
  );
  const acceptedLimitations = new Set(
    (dataset.curationIssues ?? [])
      .filter((issue) => stringField(issue, "status") === "accepted-limitation")
      .flatMap((issue) => stringArray(issue.affectedRecordIds)),
  );

  const identityCompleted = drafts.sourceRecords.filter((record) => {
    const decision = currentNames.get(qualifiedSourceRecordKey(record) ?? "");
    if (!reviewAccepted(decision, reviews)) return false;
    return (
      stringField(decision, "decision") !== "unresolved" ||
      acceptedLimitations.has(qualifiedSourceRecordKey(record) ?? "")
    );
  });
  const identityGate = gate(
    drafts.sourceRecords.length,
    identityCompleted.length,
    valid,
  );

  const subjectRows = drafts.subjectItems.filter((item) => {
    const decision = currentSubjects.get(qualifiedSourceRecordKey(item) ?? "");
    return reviewAccepted(decision, reviews);
  });
  const mapped = subjectRows.filter(
    (item) =>
      stringField(
        currentSubjects.get(qualifiedSourceRecordKey(item) ?? ""),
        "decision",
      ) === "map",
  ).length;
  const rejected = subjectRows.filter(
    (item) =>
      stringField(
        currentSubjects.get(qualifiedSourceRecordKey(item) ?? ""),
        "decision",
      ) === "reject",
  ).length;
  const deferred = subjectRows.filter(
    (item) =>
      stringField(
        currentSubjects.get(qualifiedSourceRecordKey(item) ?? ""),
        "decision",
      ) === "defer",
  ).length;
  const subjectGate = gate(
    drafts.subjectItems.length,
    subjectRows.length,
    valid,
    {
      mapped,
      rejected,
      deferred,
    },
  );

  const acceptedAssertionDecisions = drafts.assertionCandidates.filter(
    (candidate) => {
      const decision = currentAssertions.get(
        stringField(candidate, "id") ?? "",
      );
      return (
        reviewAccepted(decision, reviews) &&
        stringField(decision, "decision") === "accept"
      );
    },
  );
  const contextComplete = acceptedAssertionDecisions.filter((candidate) => {
    const decision = currentAssertions.get(stringField(candidate, "id") ?? "");
    const contextId = stringField(decision, "contextId");
    return (
      contextId !== undefined &&
      dataset.contexts.some(
        (context) => stringField(context, "id") === contextId,
      )
    );
  }).length;
  const contextGate = gate(
    acceptedAssertionDecisions.length,
    contextComplete,
    valid,
  );

  const assertionCompleted = drafts.assertionCandidates.filter((candidate) => {
    const decision = currentAssertions.get(stringField(candidate, "id") ?? "");
    return reviewAccepted(decision, reviews);
  });
  const assertionMapped = assertionCompleted.filter(
    (candidate) =>
      stringField(
        currentAssertions.get(stringField(candidate, "id") ?? ""),
        "decision",
      ) === "accept",
  ).length;
  const assertionRejected = assertionCompleted.filter(
    (candidate) =>
      stringField(
        currentAssertions.get(stringField(candidate, "id") ?? ""),
        "decision",
      ) === "reject",
  ).length;
  const assertionDeferred = assertionCompleted.filter(
    (candidate) =>
      stringField(
        currentAssertions.get(stringField(candidate, "id") ?? ""),
        "decision",
      ) === "defer",
  ).length;
  const assertionGate = gate(
    drafts.assertionCandidates.length,
    assertionCompleted.length,
    valid,
    {
      mapped: assertionMapped,
      rejected: assertionRejected,
      deferred: assertionDeferred,
    },
  );

  const c4 = !valid
    ? "blocked"
    : [identityGate, subjectGate, contextGate, assertionGate].every(
          (current) => current.status === "validated",
        )
      ? "validated"
      : "in progress";
  return {
    sourceRecords: gate(
      drafts.sourceRecords.length,
      identityCompleted.length,
      valid,
    ),
    assertionCandidates: gate(
      drafts.assertionCandidates.length,
      assertionCompleted.length,
      valid,
    ),
    gates: {
      identity: identityGate,
      subject: subjectGate,
      context: contextGate,
      assertion: assertionGate,
      c4,
    },
  };
}

function gate(
  total: number,
  completed: number,
  valid: boolean,
  extras: Partial<CompletionGate> = {},
): CompletionGate {
  const pending = Math.max(0, total - completed);
  return {
    status: !valid ? "blocked" : pending === 0 ? "validated" : "in progress",
    total,
    completed,
    pending,
    ...extras,
  };
}

function unavailableGate(): CompletionGate {
  return { status: "in progress", total: 0, completed: 0, pending: 0 };
}

function currentByKey(
  records: readonly RecordValue[],
  key: (record: RecordValue) => string | undefined,
  supersessionField: string,
): Map<string, RecordValue> {
  const superseded = new Set(
    records
      .map((record) => stringField(record, supersessionField))
      .filter((id): id is string => id !== undefined),
  );
  const result = new Map<string, RecordValue>();
  for (const record of records) {
    const recordKey = key(record);
    const id = stringField(record, "id");
    if (recordKey !== undefined && id !== undefined && !superseded.has(id))
      result.set(recordKey, record);
  }
  return result;
}

function candidateIdKey(record: RecordValue | undefined): string | undefined {
  return stringField(record, "sourceCandidateId");
}

function reviewAccepted(
  record: RecordValue | undefined,
  reviews: ReadonlyMap<string | undefined, RecordValue>,
): boolean {
  const reviewId = stringField(record, "reviewId");
  return stringField(reviews.get(reviewId), "status") === "accepted";
}

async function readRecords(path: string): Promise<RecordValue[]> {
  const records: RecordValue[] = [];
  for await (const entry of readJsonLines(createReadStream(path))) {
    if (isRecord(entry.value)) records.push(entry.value);
  }
  return records;
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(join(path, "draft-manifest.json"));
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): RecordValue | undefined {
  return isRecord(value) ? value : undefined;
}

function stringField(
  record: RecordValue | undefined,
  field: string,
): string | undefined {
  const value = record?.[field];
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
