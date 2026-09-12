export interface DatasetValidationIssue {
  readonly code:
    | "DUPLICATE_ID"
    | "MISSING_REFERENCE"
    | "INVALID_SCOPE"
    | "CULTIVAR_RULES_NOT_DISTINCT";
  readonly recordId: string;
  readonly message: string;
}

export type DatasetRecord = Readonly<Record<string, unknown>>;

export interface ValidationDataset {
  readonly taxa: readonly DatasetRecord[];
  readonly plantConcepts: readonly DatasetRecord[];
  readonly cultivars: readonly DatasetRecord[];
  readonly contexts: readonly DatasetRecord[];
  readonly rules: readonly DatasetRecord[];
  readonly assertions: readonly DatasetRecord[];
  readonly evidence: readonly DatasetRecord[];
  readonly reviews: readonly DatasetRecord[];
}

export function validateValidationDataset(
  dataset: ValidationDataset,
): DatasetValidationIssue[] {
  const issues: DatasetValidationIssue[] = [];
  const ids = new Map<string, Set<string>>();
  for (const [kind, records] of Object.entries(dataset)) {
    const seen = new Set<string>();
    ids.set(kind, seen);
    for (const record of records) {
      const id = stringField(record, "id");
      if (id === undefined) continue;
      if (seen.has(id)) {
        issues.push({
          code: "DUPLICATE_ID",
          recordId: id,
          message: `Duplicate ${kind} identifier ${id}`,
        });
      }
      seen.add(id);
    }
  }

  const has = (kind: string, id: string): boolean =>
    ids.get(kind)?.has(id) ?? false;
  for (const record of dataset.cultivars) {
    const id = stringField(record, "id") ?? "<missing>";
    const parent = stringField(record, "plantConceptId");
    if (parent !== undefined && !has("plantConcepts", parent)) {
      issues.push({
        code: "MISSING_REFERENCE",
        recordId: id,
        message: `Cultivar references missing plant concept ${parent}`,
      });
    }
  }
  for (const record of dataset.assertions) {
    const id = stringField(record, "id") ?? "<missing>";
    const subjectType = stringField(record, "subjectType");
    const subjectId = stringField(record, "subjectId");
    const subjectKind =
      subjectType === "plant-concept"
        ? "plantConcepts"
        : subjectType === "cultivar"
          ? "cultivars"
          : undefined;
    if (
      subjectKind === undefined ||
      subjectId === undefined ||
      !has(subjectKind, subjectId)
    ) {
      issues.push({
        code: "INVALID_SCOPE",
        recordId: id,
        message: `Assertion subject ${subjectType ?? "<missing>"}/${subjectId ?? "<missing>"} is not in the dataset`,
      });
    }
    checkReferences(
      record,
      "evidenceReferenceIds",
      "evidence",
      has,
      id,
      issues,
    );
    const reviewId = stringField(record, "reviewId");
    if (reviewId !== undefined && !has("reviews", reviewId)) {
      issues.push({
        code: "MISSING_REFERENCE",
        recordId: id,
        message: `Assertion references missing review ${reviewId}`,
      });
    }
  }
  for (const record of dataset.rules) {
    const id = stringField(record, "id") ?? "<missing>";
    const plant = stringField(record, "plantConceptId");
    const cultivar = stringField(record, "cultivarId");
    if ((plant === undefined) === (cultivar === undefined)) {
      issues.push({
        code: "INVALID_SCOPE",
        recordId: id,
        message: "Rule must target exactly one plant concept or cultivar",
      });
    }
  }
  const cultivarWindows = dataset.rules
    .filter((record) => stringField(record, "cultivarId") !== undefined)
    .map((record) => JSON.stringify(record.timing));
  if (
    cultivarWindows.length > 1 &&
    new Set(cultivarWindows).size !== cultivarWindows.length
  ) {
    issues.push({
      code: "CULTIVAR_RULES_NOT_DISTINCT",
      recordId: "dataset",
      message:
        "Cultivar validation rules must retain distinct reviewed parameters",
    });
  }
  return issues;
}

function checkReferences(
  record: DatasetRecord,
  field: string,
  kind: string,
  has: (kind: string, id: string) => boolean,
  recordId: string,
  issues: DatasetValidationIssue[],
): void {
  const references = record[field];
  if (!Array.isArray(references)) return;
  for (const reference of references) {
    if (typeof reference === "string" && !has(kind, reference)) {
      issues.push({
        code: "MISSING_REFERENCE",
        recordId,
        message: `References missing ${kind} record ${reference}`,
      });
    }
  }
}

function stringField(record: DatasetRecord, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}
