import { join, resolve } from "node:path";
import {
  validateGrowWfoDataset,
  type GrowWfoValidationOptions,
} from "./grow-wfo-validation.js";
import { readGrowWfoDrafts } from "./grow-wfo-status.js";
import type { DatasetRecord, ValidationDataset } from "./validation-dataset.js";

type RecordValue = DatasetRecord;

export interface GrowWfoRecordView {
  readonly sourceRecordId: string;
  readonly validation: {
    readonly valid: boolean;
    readonly issueCount: number;
  };
  readonly sourceRecord: RecordValue;
  readonly identityReview?: RecordValue;
  readonly subjectReview?: RecordValue;
  readonly taxonomyCandidate?: RecordValue;
  readonly assertionReviews: readonly RecordValue[];
  readonly geographyReviews: readonly RecordValue[];
  readonly decisions: {
    readonly name: readonly RecordValue[];
    readonly subject: readonly RecordValue[];
    readonly geography: readonly RecordValue[];
    readonly assertion: readonly RecordValue[];
  };
  readonly authored: {
    readonly taxonomicNames: readonly RecordValue[];
    readonly crosswalks: readonly RecordValue[];
    readonly subjects: readonly RecordValue[];
    readonly contexts: readonly RecordValue[];
    readonly assertions: readonly RecordValue[];
    readonly evidence: readonly RecordValue[];
    readonly reviews: readonly RecordValue[];
    readonly curationIssues: readonly RecordValue[];
  };
}

export async function showGrowWfoRecord(
  sourceRecordId: string,
  options: GrowWfoValidationOptions = {},
): Promise<GrowWfoRecordView> {
  if (sourceRecordId.trim().length === 0)
    throw new Error("Source record ID must not be empty");
  const repositoryRoot = resolve(
    options.repositoryRoot ?? resolve(import.meta.dirname, "../.."),
  );
  const draftsDirectory = resolve(
    options.draftsDirectory ??
      join(repositoryRoot, ".cache/curation-drafts/grow-wfo/latest"),
  );
  const validation = await validateGrowWfoDataset({
    ...options,
    againstDrafts: true,
  });
  const loaded = validation.loaded;
  if (loaded === undefined)
    throw new Error("The tracked C4 authoring dataset could not be loaded");
  const drafts = await readGrowWfoDrafts(draftsDirectory);
  const identityReview = drafts.identityItems.find(
    (item) =>
      stringField(asRecord(item.sourceRecord), "sourceRecordId") ===
      sourceRecordId,
  );
  if (identityReview === undefined)
    throw new Error(
      `GROW source record ${sourceRecordId} was not found in the draft queue`,
    );

  const sourceRecord = asRecord(identityReview.sourceRecord);
  if (sourceRecord === undefined)
    throw new Error(
      `GROW source record ${sourceRecordId} is malformed in the draft queue`,
    );
  const taxonomyCandidate = asRecord(identityReview.taxonomyCandidate);
  const subjectReview = drafts.subjectItems.find(
    (item) => stringField(item, "sourceRecordId") === sourceRecordId,
  );
  const assertionReviews = drafts.assertionItems.filter(
    (item) =>
      stringField(asRecord(item.sourceCandidate), "sourceRecordId") ===
      sourceRecordId,
  );

  const candidateIds = new Set(
    assertionReviews
      .map((item) => stringField(asRecord(item.sourceCandidate), "id"))
      .filter((id): id is string => id !== undefined),
  );
  const geographyReviews = drafts.geographyItems.filter((item) =>
    assertionReviews.some((review) => {
      const geography = asRecord(
        asRecord(
          asRecord(asRecord(review.sourceCandidate)?.applicability)?.geography,
        ),
      );
      return stringArray(item.sourceCountryValues).includes(
        stringField(geography, "country") ?? "",
      );
    }),
  );

  const nameDecisions = filterBySourceRecord(
    loaded.dataset.sourceNameDecisions ?? [],
    sourceRecordId,
  );
  const subjectDecisions = filterBySourceRecord(
    loaded.dataset.sourceSubjectMappings ?? [],
    sourceRecordId,
  );
  const geographyDecisions = (
    loaded.dataset.sourceGeographyDecisions ?? []
  ).filter((decision) =>
    assertionReviews.some((review) => {
      const geography = asRecord(
        asRecord(
          asRecord(asRecord(review.sourceCandidate)?.applicability)?.geography,
        ),
      );
      const location = asRecord(decision.sourceLocation);
      return (
        stringField(geography, "sheetCode") ===
        stringField(location, "sheetCode")
      );
    }),
  );
  const assertionDecisions = (
    loaded.dataset.sourceAssertionDecisions ?? []
  ).filter((decision) =>
    candidateIds.has(stringField(decision, "sourceCandidateId") ?? ""),
  );

  const crosswalkIds = new Set(
    [...nameDecisions, ...subjectDecisions]
      .map((record) => stringField(record, "externalTaxonomyCrosswalkId"))
      .filter((id): id is string => id !== undefined),
  );
  const taxonIds = new Set(
    (loaded.dataset.externalTaxonomyCrosswalks ?? [])
      .filter((record) => crosswalkIds.has(stringField(record, "id") ?? ""))
      .map((record) => stringField(record, "taxonId"))
      .filter((id): id is string => id !== undefined),
  );
  const subjects = subjectDecisions
    .map((decision) => asRecord(decision.subject))
    .filter((subject): subject is RecordValue => subject !== undefined)
    .flatMap((subject) => findSubject(loaded.dataset, subject));
  const assertionIds = new Set(
    assertionDecisions
      .map((decision) => stringField(decision, "assertionId"))
      .filter((id): id is string => id !== undefined),
  );
  const assertions = loaded.dataset.assertions.filter((assertion) =>
    assertionIds.has(stringField(assertion, "id") ?? ""),
  );
  const contextIds = new Set(
    [...assertionDecisions]
      .map((decision) => stringField(decision, "contextId"))
      .filter((id): id is string => id !== undefined),
  );
  const evidenceIds = new Set(
    assertions.flatMap((assertion) =>
      stringArray(assertion.evidenceReferenceIds),
    ),
  );
  const reviewIds = new Set(
    [
      ...nameDecisions,
      ...subjectDecisions,
      ...geographyDecisions,
      ...assertionDecisions,
      ...assertions,
    ]
      .map((record) => stringField(record, "reviewId"))
      .filter((id): id is string => id !== undefined),
  );
  const crosswalks = (loaded.dataset.externalTaxonomyCrosswalks ?? []).filter(
    (record) => crosswalkIds.has(stringField(record, "id") ?? ""),
  );
  const taxonomicNames = (loaded.dataset.taxonomicNames ?? []).filter((name) =>
    taxonIds.has(stringField(name, "taxonId") ?? ""),
  );
  const contexts = loaded.dataset.contexts.filter((context) =>
    contextIds.has(stringField(context, "id") ?? ""),
  );
  const evidence = loaded.dataset.evidence.filter((record) =>
    evidenceIds.has(stringField(record, "id") ?? ""),
  );
  const reviews = loaded.dataset.reviews.filter((review) =>
    reviewIds.has(stringField(review, "id") ?? ""),
  );
  const curationIssues = (loaded.dataset.curationIssues ?? []).filter(
    (issue) => {
      const affected = stringArray(issue.affectedRecordIds);
      return (
        affected.includes(sourceRecordId) ||
        assertionReviews.some((review) =>
          affected.includes(
            stringField(asRecord(review.sourceCandidate), "id") ?? "",
          ),
        )
      );
    },
  );

  return {
    sourceRecordId,
    validation: {
      valid: validation.valid,
      issueCount: validation.issues.length,
    },
    sourceRecord,
    identityReview,
    ...(subjectReview === undefined ? {} : { subjectReview }),
    ...(taxonomyCandidate === undefined ? {} : { taxonomyCandidate }),
    assertionReviews,
    geographyReviews,
    decisions: {
      name: nameDecisions,
      subject: subjectDecisions,
      geography: geographyDecisions,
      assertion: assertionDecisions,
    },
    authored: {
      taxonomicNames,
      crosswalks,
      subjects,
      contexts,
      assertions,
      evidence,
      reviews,
      curationIssues,
    },
  };
}

function filterBySourceRecord(
  records: readonly RecordValue[],
  sourceRecordId: string,
): RecordValue[] {
  return records.filter(
    (record) => stringField(record, "sourceRecordId") === sourceRecordId,
  );
}

function findSubject(
  dataset: ValidationDataset,
  subject: RecordValue,
): RecordValue[] {
  const type = stringField(subject, "type");
  const id = stringField(subject, "id");
  if (type === "plant-concept")
    return dataset.plantConcepts.filter(
      (record) => stringField(record, "id") === id,
    );
  if (type === "cultivar-group")
    return (dataset.cultivarGroups ?? []).filter(
      (record) => stringField(record, "id") === id,
    );
  if (type === "cultivar")
    return dataset.cultivars.filter(
      (record) => stringField(record, "id") === id,
    );
  return [];
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

function asRecord(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}
